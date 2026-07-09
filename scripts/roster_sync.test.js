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
