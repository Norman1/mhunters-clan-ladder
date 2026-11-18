const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planPairs } = require('./matchmaker');

test('an active game blocks the pair in either order, including legacy numeric IDs', () => {
    const activeGames = [{ p1_id: 2, p2_id: '1' }];
    assert.deepEqual(planPairs(['2', '1'], [], {}, activeGames), []);
    assert.deepEqual(planPairs(['1', '2'], [], {}, activeGames), []);
});

test('multiple free slots allow only one game against the same opponent per batch', () => {
    const pairs = planPairs(['1', '2', '2', '1'], [], {}, []);
    assert.equal(pairs.length, 1);
    assert.deepEqual(pairs[0].sort(), ['1', '2']);
});

test('a player with no legal opponent does not prevent other same-tier matches', () => {
    const players = { 1: { last_opponent: '3' }, 3: { last_opponent: 2 } };
    const pairs = planPairs(['1', '2', '3'], [], players, []);
    assert.equal(pairs.length, 1);
    assert.deepEqual(pairs[0].sort(), ['1', '2']);
});

test('mixed-tier pairing skips blocked players and finds a legal remaining match', () => {
    const activeGames = [
        { p1_id: '1', p2_id: '2' },
        { p1_id: '3', p2_id: '4' },
        { p1_id: '3', p2_id: '1' },
    ];
    const players = { 1: { last_opponent: '4' } };
    const pairs = planPairs(['1', '2'], ['3', '4'], players, activeGames);
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0][0], '2');
    assert.ok(['3', '4'].includes(pairs[0][1]));
});
