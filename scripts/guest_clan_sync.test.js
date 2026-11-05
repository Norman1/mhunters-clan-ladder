const { test } = require('node:test');
const assert = require('node:assert/strict');
const { syncGuestClans, iconVersion } = require('./guest_clan_sync');

const clone = value => JSON.parse(JSON.stringify(value));
const member = { name: 'Member', elo: 1000, game_cap: 2, missed_games: 0, in_clan: true };
const guest = { name: 'Guest', elo: 1200, game_cap: 2, missed_games: 0, in_clan: false, guest: true };
const STACKERS = {
    clanId: '90962', clanName: 'Stackers',
    iconUrl: 'https://warappcdn.com/s3/Data/Clans/90962/Icon/626818011.png'
};

// In-memory doubles: no network, no files written.
function run(players, info, { downloadError = false } = {}) {
    const downloads = [];
    const fetchInfo = async id => {
        if (info instanceof Error) throw info;
        return typeof info === 'function' ? info(id) : info;
    };
    const download = async (clanId, iconUrl) => {
        if (downloadError) throw new Error('download failed');
        downloads.push([clanId, iconUrl]);
    };
    return syncGuestClans(players, fetchInfo, download).then(changed => ({ changed, downloads }));
}

test('iconVersion extracts the published icon filename', () => {
    assert.equal(iconVersion(STACKERS.iconUrl), '626818011.png');
    assert.equal(iconVersion(null), null);
    assert.equal(iconVersion('https://warappcdn.com/other.png'), null);
});

test('sync stores a guest clan and mirrors its icon; members are untouched', async () => {
    const players = { 1: clone(member), 2: clone(guest) };
    const { changed, downloads } = await run(players, STACKERS);
    assert.equal(changed, true);
    assert.deepEqual(players[2].clan, { id: '90962', name: 'Stackers', icon_v: '626818011.png' });
    assert.deepEqual(downloads, [['90962', STACKERS.iconUrl]]);
    assert.equal('clan' in players[1], false);
});

test('a failed lookup leaves the stored clan untouched', async () => {
    const stored = { id: '90962', name: 'Stackers', icon_v: '626818011.png' };
    const players = { 2: { ...clone(guest), clan: clone(stored) } };
    const { changed } = await run(players, new Error('lookup failed'));
    assert.equal(changed, false);
    assert.deepEqual(players[2].clan, stored);
});

test('a clanless guest has their stored clan cleared', async () => {
    const players = { 2: { ...clone(guest), clan: { id: '90962', name: 'Stackers', icon_v: 'x.png' } } };
    const { changed } = await run(players, null);
    assert.equal(changed, true);
    assert.equal('clan' in players[2], false);

    const again = await run(players, null);
    assert.equal(again.changed, false);
});

test('a failed icon download keeps the stale version so the next run retries', async () => {
    const players = { 2: clone(guest) };
    const first = await run(players, STACKERS, { downloadError: true });
    assert.equal(first.changed, true);
    assert.deepEqual(players[2].clan, { id: '90962', name: 'Stackers', icon_v: null });

    const second = await run(players, STACKERS);
    assert.equal(second.changed, true);
    assert.equal(players[2].clan.icon_v, '626818011.png');
    assert.deepEqual(second.downloads, [['90962', STACKERS.iconUrl]]);
});

test('switching clans replaces the stored clan and fetches the new icon', async () => {
    const players = { 2: { ...clone(guest), clan: { id: '90962', name: 'Stackers', icon_v: 'x.png' } } };
    const next = { clanId: '90671', clanName: 'Undisputed', iconUrl: 'https://cdn/s3/Data/Clans/90671/Icon/439519665.png' };
    const { changed, downloads } = await run(players, next);
    assert.equal(changed, true);
    assert.deepEqual(players[2].clan, { id: '90671', name: 'Undisputed', icon_v: '439519665.png' });
    assert.deepEqual(downloads, [['90671', next.iconUrl]]);
});

test('a clan without an icon stores name only and downloads nothing', async () => {
    const players = { 2: clone(guest) };
    const { changed, downloads } = await run(players, { clanId: '90500', clanName: 'NoIcon', iconUrl: null });
    assert.equal(changed, true);
    assert.deepEqual(players[2].clan, { id: '90500', name: 'NoIcon', icon_v: null });
    assert.deepEqual(downloads, []);
});
