const { test } = require('node:test');
const assert = require('node:assert');
const { computeRosterDiff, shouldAbortSync } = require('./roster_sync');

const roster = [
    { id: '111', name: 'Alice' },
    { id: '222', name: 'Bobby' },   // renamed (was Bob)
    { id: '444', name: 'Newguy' },  // not registered yet
];

const players = {
    '111': { name: 'Alice', elo: 1100, game_cap: 2, missed_games: 0 },
    '222': { name: 'Bob', elo: 900, game_cap: 2, missed_games: 0 },
    '333': { name: 'Gone', elo: 1000, game_cap: 2, missed_games: 0 },              // left the clan
    '555': { name: 'Back', elo: 1050, game_cap: 1, missed_games: 3, in_clan: false }, // departed earlier, still gone
};

test('computeRosterDiff buckets new members, leavers, rejoiners, renames', () => {
    const diff = computeRosterDiff(roster, players);
    assert.deepEqual(diff.newMembers, [{ id: '444', name: 'Newguy' }]);
    assert.deepEqual(diff.leavers, ['333']);
    assert.deepEqual(diff.rejoiners, []);
    assert.deepEqual(diff.renames, [{ id: '222', name: 'Bobby' }]);
});

test('rejoiner detected when departed player is back in roster', () => {
    const diff = computeRosterDiff([...roster, { id: '555', name: 'Back' }], players);
    assert.deepEqual(diff.rejoiners, ['555']);
    assert.deepEqual(diff.leavers, ['333']);
});

test('already-departed player absent from roster is NOT a leaver again', () => {
    const diff = computeRosterDiff(roster, players);
    assert.ok(!diff.leavers.includes('555'));
});

test('null roster name does not produce a rename', () => {
    const diff = computeRosterDiff([{ id: '111', name: null }], { '111': { name: 'Alice' } });
    assert.deepEqual(diff.renames, []);
});

test('circuit breaker trips on empty roster', () => {
    assert.ok(shouldAbortSync([], players));
    assert.ok(shouldAbortSync(null, players));
});

test('circuit breaker trips when >20% of in-clan players would depart', () => {
    // 4 registered, 3 counted as in-clan ('555' already departed); 1 leaver of 3 = 33% > 20%
    assert.ok(shouldAbortSync(roster, players));
    // With the leaver also in the roster, nobody departs: no abort
    assert.equal(shouldAbortSync([...roster, { id: '333', name: 'Gone' }], players), null);
});

test('duplicate roster entries produce a single newMembers entry', () => {
    const diff = computeRosterDiff([...roster, { id: '444', name: 'Newguy' }], players);
    assert.deepEqual(diff.newMembers, [{ id: '444', name: 'Newguy' }]);
});

test('breaker does NOT trip at exactly 20% departures', () => {
    const fivePlayers = {
        '1': { name: 'P1' },
        '2': { name: 'P2' },
        '3': { name: 'P3' },
        '4': { name: 'P4' },
        '5': { name: 'P5' }, // the one leaver: 1 of 5 = exactly 20%
    };
    const fourRoster = [
        { id: '1', name: 'P1' },
        { id: '2', name: 'P2' },
        { id: '3', name: 'P3' },
        { id: '4', name: 'P4' },
    ];
    assert.equal(shouldAbortSync(fourRoster, fivePlayers), null);
});

test('numeric roster id matches string players key', () => {
    const diff = computeRosterDiff([{ id: 444, name: 'Newguy' }], { '444': { name: 'Newguy' } });
    assert.deepEqual(diff.newMembers, []);
    assert.deepEqual(diff.leavers, []);
});

test('empty players object trips the enrollment breaker (any roster is 100% new)', () => {
    const reason = shouldAbortSync(roster, {});
    assert.ok(reason);
    assert.match(reason, /enroll/);
});

test('rejoiner with changed name appears in BOTH rejoiners and renames', () => {
    const diff = computeRosterDiff([...roster, { id: '555', name: 'BackAgain' }], players);
    assert.deepEqual(diff.rejoiners, ['555']);
    assert.ok(diff.renames.some(r => r.id === '555' && r.name === 'BackAgain'));
});

test('mass-enrollment breaker trips when >25% of roster is unregistered', () => {
    const twoPlayers = {
        '1': { name: 'P1' },
        '2': { name: 'P2' },
    };
    const fourRoster = [
        { id: '1', name: 'P1' },
        { id: '2', name: 'P2' },
        { id: '8', name: 'New1' },
        { id: '9', name: 'New2' }, // 2 new of 4 = 50% > 25%
    ];
    const reason = shouldAbortSync(fourRoster, twoPlayers);
    assert.ok(reason);
    assert.match(reason, /enroll/);
});

test('duplicated roster entries do NOT dilute the enrollment breaker', () => {
    const twoPlayers = {
        '1': { name: 'P1' },
        '2': { name: 'P2' },
    };
    const fourRoster = [
        { id: '1', name: 'P1' },
        { id: '2', name: 'P2' },
        { id: '8', name: 'New1' },
        { id: '9', name: 'New2' }, // 2 new of 4 unique = 50% > 25%
    ];
    // Every entry duplicated: raw length 8 would dilute the ratio to 25% (no trip)
    const duplicatedRoster = [...fourRoster, ...fourRoster];
    const reason = shouldAbortSync(duplicatedRoster, twoPlayers);
    assert.ok(reason);
    assert.match(reason, /enroll/);
});

const { voidLeaverGames } = require('./roster_sync');

test('voidLeaverGames deletes lobby games, untracks in-progress, archives all as Left Clan', async () => {
    const activeGames = [
        { game_id: 1, created_at: 'c1', p1_id: '333', p2_id: '111', template_id: 9, game_state: 'WaitingForPlayers' },
        { game_id: 2, created_at: 'c2', p1_id: '111', p2_id: '333', template_id: 9, game_state: 'Playing' },
        { game_id: 3, created_at: 'c3', p1_id: '333', p2_id: '222', template_id: 9 }, // no state yet = lobby
        { game_id: 4, created_at: 'c4', p1_id: '111', p2_id: '222', template_id: 9, game_state: 'Playing' }, // no leaver
    ];
    const history = [];
    const deleted = [];
    const fakeDelete = async (id) => deleted.push(id);

    const remaining = await voidLeaverGames(['333'], activeGames, history, fakeDelete, 'NOW');

    assert.deepEqual(remaining.map(g => g.game_id), [4]);
    assert.deepEqual(deleted, [1, 3]); // only lobby games get API deletion
    assert.equal(history.length, 3);
    assert.ok(history.every(h => h.note === 'Left Clan' && h.finished_at === 'NOW'));
    assert.deepEqual(history.map(h => h.game_id), [1, 2, 3]);
});

test('voidLeaverGames survives a failing delete API call', async () => {
    const activeGames = [
        { game_id: 7, created_at: 'c', p1_id: '333', p2_id: '111', template_id: 9, game_state: 'WaitingForPlayers' },
    ];
    const history = [];
    const failingDelete = async () => { throw new Error('already deleted'); };

    const remaining = await voidLeaverGames(['333'], activeGames, history, failingDelete, 'NOW');

    assert.deepEqual(remaining, []);
    assert.equal(history.length, 1); // still archived as void
});
