const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isLadderEligible } = require('./player_eligibility');
const { computeRosterDiff, shouldAbortSync, applyRosterDiff, voidLeaverGames } = require('./roster_sync');
require('../js/derive');

const clone = value => JSON.parse(JSON.stringify(value));
const NOW = '2026-11-05T15:00:00.000Z';
class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return Date.parse(NOW); }
}
const member = { name: 'Member', elo: 1000, game_cap: 2, missed_games: 0, in_clan: true };
const guest = { name: 'Guest', elo: 1200, game_cap: 2, missed_games: 0, in_clan: false, guest: true };

// Run the actual scripts with in-memory data, mocked GitHub/Warzone calls and
// a fixed clock. No production files, API calls or real games are touched.
function sandbox(script, players, { title, clanId = null, lookupError = false, activeGames = [] } = {}) {
    const files = { 'players.json': clone(players), 'active_games.json': clone(activeGames),
        'templates.json': [{ id: 1, name: 'Map' }] };
    const writes = [];
    const games = [];
    const comments = [];
    let lookups = 0;
    const filename = path.join(__dirname, script);
    const module = { exports: {} };
    const mockedRequire = name => {
        if (name === 'fs') return {
            existsSync: file => Object.hasOwn(files, path.basename(file)),
            readFileSync: file => JSON.stringify(files[path.basename(file)]),
            writeFileSync: (file, text) => {
                files[path.basename(file)] = JSON.parse(text);
                writes.push(path.basename(file));
            }
        };
        if (name === 'path') return path;
        if (name === './clan_roster') return { fetchPlayerClanId: async () => {
            lookups++;
            if (lookupError) throw new Error('lookup failed');
            return clanId;
        } };
        if (name === './api') return { createGame: async (...args) => {
            games.push(args);
            return { gameID: 500 + games.length };
        } };
        if (['./config', './player_eligibility', './reliability'].includes(name)) return require(name);
        throw new Error(`Unexpected dependency: ${name}`);
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        __dirname, module, require: mockedRequire, Date: FixedDate,
        console: { log() {}, warn() {}, error() {} },
        process: { env: { ISSUE_TITLE: title, GITHUB_TOKEN: 'mock', GITHUB_REPOSITORY: 'mock/repo', ISSUE_NUMBER: '1' } },
        fetch: async (url, options) => {
            assert.equal(url, 'https://api.github.com/repos/mock/repo/issues/1/comments');
            comments.push(JSON.parse(options.body).body);
            return { ok: true };
        }
    }, { filename });
    return { exports: module.exports, files, writes, games, comments, get lookups() { return lookups; } };
}

async function issue(title, players = {}, options = {}) {
    const run = sandbox('issue_ops.js', players, { ...options, title });
    await run.exports.runIssueOps();
    return run;
}

test('eligibility preserves legacy members and requires an explicit guest grant for outsiders', () => {
    for (const [player, expected] of [[{}, true], [member, true], [guest, true],
        [{ in_clan: false }, false], [{ in_clan: false, guest: 'true' }, false], [null, false]]) {
        assert.equal(isLadderEligible(player), expected);
    }
});

test('admission creates an outside guest at the requested cap without a membership lookup', async () => {
    const run = await issue('AdmitGuest: 123 Cap: 2 Name: New Friend');
    assert.deepEqual(run.files['players.json']['123'], {
        name: 'New Friend', elo: 1000, game_cap: 2, missed_games: 0, in_clan: false, guest: true
    });
    assert.equal(run.lookups, 0);
    assert.deepEqual(run.writes, ['players.json']);
});

test('admission preserves rating, strikes, cooldowns, opponent and factual membership', async () => {
    const previous = { ...member, elo: 1351, game_cap: 0, missed_games: 4,
        last_assigned_at: NOW, last_opponent: '456', custom: 'preserved' };
    const run = await issue('AdmitGuest: 123 Cap: 3 Name: New Name', { 123: previous });
    assert.deepEqual(run.files['players.json']['123'], { ...previous, name: 'New Name', game_cap: 3, guest: true });
});

for (const cap of ['4', '999999999999999999999', '-1', '1.5', 'two']) {
    test(`invalid admission cap ${cap} never writes state`, async () => {
        const run = await issue(`AdmitGuest: 123 Cap: ${cap} Name: Friend`);
        assert.deepEqual(run.writes, []);
        assert.deepEqual(run.files['players.json'], {});
    });
}
test('empty guest name never writes state', async () => {
    assert.deepEqual((await issue('AdmitGuest: 123 Cap: 2 Name:   ')).writes, []);
});

for (const title of ['Remove: 123', 'Update: 123 Cap: 0']) {
    test(`${title} pauses without revoking admission`, async () => {
        const run = await issue(title, { 123: guest });
        assert.deepEqual(run.files['players.json']['123'], { ...guest, game_cap: 0 });
        assert.equal(isLadderEligible(run.files['players.json']['123']), true);
    });
}
test('cap changes resume a paused guest without requiring clan membership', async () => {
    const run = await issue('Update: 123 Cap: 2', { 123: { ...guest, game_cap: 0 } });
    assert.deepEqual(run.files['players.json']['123'], guest);
});
test('signup does not reset an admitted outside guest', async () => {
    const run = await issue('Signup: 123 Name: Reset Attempt', { 123: guest });
    assert.equal(run.lookups, 0);
    assert.deepEqual(run.writes, []);
    assert.deepEqual(run.files['players.json']['123'], guest);
});
test('ordinary signup still rejects outsiders and admits actual clan members', async () => {
    const denied = await issue('Signup: 123 Name: Member');
    assert.deepEqual(denied.writes, []);
    const allowed = await issue('Signup: 123 Name: Member', {}, { clanId: '141' });
    assert.deepEqual(allowed.files['players.json']['123'], member);
});
for (const clanId of [null, '42', '141']) {
    test(`revocation uses live clan membership (${clanId}) and preserves all game records`, async () => {
        const previous = { ...guest, in_clan: clanId !== '141', last_opponent: '456', last_assigned_at: NOW };
        const run = await issue('RevokeGuest: 123', { 123: previous }, { clanId });
        const player = run.files['players.json']['123'];
        assert.equal(run.lookups, 1);
        assert.equal(Object.hasOwn(player, 'guest'), false);
        assert.equal(player.in_clan, clanId === '141');
        assert.equal(isLadderEligible(player), clanId === '141');
        for (const key of ['name', 'elo', 'game_cap', 'missed_games', 'last_opponent', 'last_assigned_at']) {
            assert.equal(player[key], previous[key]);
        }
        assert.deepEqual(run.writes, ['players.json']);
        assert.deepEqual(run.games, []);
    });
}
test('failed revocation lookup retains the guest grant unchanged', async () => {
    const run = await issue('RevokeGuest: 123', { 123: guest }, { lookupError: true });
    assert.deepEqual(run.writes, []);
    assert.deepEqual(run.files['players.json']['123'], guest);
    assert.match(run.comments[0], /unchanged/);
});
test('a revoked outsider can be readmitted without losing their record', async () => {
    const previous = { ...guest, missed_games: 3, last_assigned_at: NOW, last_opponent: '456' };
    const revoked = await issue('RevokeGuest: 123', { 123: previous });
    assert.equal(isLadderEligible(revoked.files['players.json']['123']), false);
    const restored = await issue('AdmitGuest: 123 Cap: 1 Name: Guest', revoked.files['players.json']);
    assert.deepEqual(restored.files['players.json']['123'], {
        ...previous, game_cap: 1, departed_at: NOW
    });
    assert.equal(isLadderEligible(restored.files['players.json']['123']), true);
});
test('revocation does not affect ordinary members or unknown players', async () => {
    for (const players of [{}, { 123: member }]) {
        const run = await issue('RevokeGuest: 123', players);
        assert.deepEqual(run.writes, []);
        assert.equal(run.lookups, 0);
        assert.deepEqual(run.files['players.json'], players);
    }
});

test('a guest can join and leave the clan repeatedly without retirement or record resets', async () => {
    const players = { 123: { ...guest, missed_games: 3, last_assigned_at: NOW } };
    const original = clone(players['123']);
    let diff = computeRosterDiff([{ id: '123', name: 'Renamed Guest' }], players);
    assert.deepEqual(diff.rejoiners, ['123']);
    assert.deepEqual(applyRosterDiff(players, diff, NOW), []);
    assert.equal(players['123'].in_clan, true);
    diff = computeRosterDiff([], players);
    assert.deepEqual(diff.leavers, ['123']);
    const retired = applyRosterDiff(players, diff, NOW);
    assert.deepEqual(retired, []);
    assert.equal(players['123'].in_clan, false);
    assert.equal(players['123'].guest, true);
    for (const key of ['elo', 'game_cap', 'missed_games', 'last_assigned_at']) {
        assert.equal(players['123'][key], original[key]);
    }
    const active = [{ game_id: 1, p1_id: '123', p2_id: '456' }];
    const history = [];
    const remaining = await voidLeaverGames(retired, active, history, async () => assert.fail('Guest game deleted'), NOW);
    assert.deepEqual(remaining, active);
    assert.deepEqual(history, []);
    assert.deepEqual(computeRosterDiff([], players).leavers, []);
});
test('ordinary departures still retire and rejoining restores the same rating and cap', () => {
    const players = { 123: { ...member, elo: 1240, game_cap: 0 } };
    assert.deepEqual(applyRosterDiff(players, computeRosterDiff([], players), NOW), ['123']);
    assert.equal(isLadderEligible(players['123']), false);
    applyRosterDiff(players, computeRosterDiff([{ id: '123', name: 'Member' }], players), NOW);
    assert.deepEqual(players['123'], { ...member, elo: 1240, game_cap: 0 });
});
test('automatic enrollment still creates ordinary members at cap 2 and initial Elo', () => {
    const players = { 123: guest };
    applyRosterDiff(players, computeRosterDiff([{ id: '456', name: 'Member' }], players), NOW);
    assert.deepEqual(players['456'], member);
    assert.deepEqual(players['123'], guest);
});
test('outside guests do not cause false departures or enrollment', () => {
    const players = { 123: member, 456: guest };
    const roster = [{ id: '123', name: 'Member' }];
    assert.deepEqual(computeRosterDiff(roster, players).leavers, []);
    assert.equal(shouldAbortSync(roster, players), null);
});
test('guests do not dilute or trigger the departure breaker', () => {
    const players = { 123: member };
    const guests = Array.from({ length: 10 }, (_, i) => ({ id: String(500 + i), name: 'Guest' }));
    for (const g of guests) players[g.id] = { ...guest, in_clan: true };
    assert.match(shouldAbortSync(guests, players), /would mark 1 of 1/);
    assert.equal(shouldAbortSync([{ id: '123', name: 'Member' }], players), null);
});
test('guests do not dilute the enrollment breaker or bypass empty-scrape protection', () => {
    const players = { 123: member };
    const guests = Array.from({ length: 10 }, (_, i) => ({ id: String(500 + i), name: 'Guest' }));
    for (const g of guests) players[g.id] = guest;
    assert.match(shouldAbortSync([{ id: '123' }, { id: '999' }, ...guests], players), /would enroll 1 new players from a roster of 2/);
    assert.match(shouldAbortSync([], players), /no members/);
    assert.equal(shouldAbortSync(guests, players), 'would mark 1 of 1 registered players departed');
    delete players['123'];
    assert.equal(shouldAbortSync(guests, players), null);
});

test('matchmaker fills guest slots up to cap and includes the guest in rank labels', async () => {
    const run = sandbox('matchmaker.js', { 123: guest, 456: member });
    await run.exports.runMatchmaker();
    assert.equal(run.games.length, 2);
    for (const [, participants, , description] of run.games) {
        assert.deepEqual(Array.from(participants, p => p.token).sort(), ['123', '456']);
        assert.match(description, /Guest, Rank 1 with 1200 Elo/);
    }
});
for (const [label, player] of [
    ['paused', { ...guest, game_cap: 0 }],
    ['cooldown', { ...guest, missed_games: 3, last_assigned_at: NOW }],
    ['revoked', { ...guest, guest: false }],
    ['full cap', guest]
]) {
    test(`matchmaker respects ${label} guest status`, async () => {
        const activeGames = label === 'full cap'
            ? [{ p1_id: '123', p2_id: '789' }, { p1_id: '123', p2_id: '789' }] : [];
        const run = sandbox('matchmaker.js', { 123: player, 456: member }, { activeGames });
        await run.exports.runMatchmaker();
        assert.equal(run.games.length, 0);
    });
}
test('unreliable guests after cooldown receive at most one game like ordinary players', async () => {
    const run = sandbox('matchmaker.js', { 123: { ...guest, missed_games: 3, last_assigned_at: '2026-01-01' }, 456: member });
    await run.exports.runMatchmaker();
    assert.equal(run.games.length, 1);
});

test('frontend ranks guests, preserves profile/map history, and hides only revoked outsiders', () => {
    const history = Array.from({ length: 3 }, (_, i) => ({ game_id: i + 1, p1_id: '123', p2_id: '456',
        winner_id: '123', loser_id: '456', elo_change: 20, template_id: 1, finished_at: NOW }));
    const players = { 123: guest, 456: member };
    const derive = globalThis.LadderData._derive;
    const before = derive(players, history, [], [{ id: 1, name: 'Map' }]);
    assert.equal(before.active[0].id, '123');
    assert.equal(before.active[0].rank, 1);
    assert.equal(before.active[0].guest, true);
    assert.equal(before.active[0].inClan, false);
    assert.equal(before.active[0].gameLog.length, 3);
    assert.equal(before.maps[0].board.find(p => p.id === '123').departed, undefined);
    players['123'] = { ...guest, guest: false };
    const after = derive(players, history, [], [{ id: 1, name: 'Map' }]);
    assert.deepEqual(after.active.map(p => p.id), ['456']);
    assert.equal(after.allResults.length, 3);
    assert.equal(after.allResults[0].winner, 'Guest');
    assert.equal(after.maps[0].board.find(p => p.id === '123').departed, true);
});
test('frontend keeps paused and unreliable guests in the normal reserve lists', () => {
    const derived = globalThis.LadderData._derive({
        123: { ...guest, game_cap: 0 }, 456: { ...guest, missed_games: 3 }
    }, [], [], []);
    assert.equal(derived.active.length, 0);
    assert.equal(derived.reserve.length, 2);
    assert.equal(derived.reserve.find(p => p.id === '123').status, 'PAUSED');
    assert.equal(derived.reserve.find(p => p.id === '456').status, 'INACTIVE');
});
