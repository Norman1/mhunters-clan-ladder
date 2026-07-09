const { test } = require('node:test');
const assert = require('node:assert');
const { getUnreliableCooldownMs, UNRELIABLE_STRIKE_THRESHOLD } = require('./reliability');

const WEEK = 7 * 24 * 60 * 60 * 1000;

test('cooldown is 2 weeks per strike above threshold, capped at 12', () => {
    assert.equal(getUnreliableCooldownMs(2), 2 * WEEK);
    assert.equal(getUnreliableCooldownMs(3), 4 * WEEK);
    assert.equal(getUnreliableCooldownMs(4), 6 * WEEK);
    assert.equal(getUnreliableCooldownMs(5), 8 * WEEK);
    assert.equal(getUnreliableCooldownMs(6), 10 * WEEK);
    assert.equal(getUnreliableCooldownMs(7), 12 * WEEK);
    assert.equal(getUnreliableCooldownMs(50), 12 * WEEK); // cap
});

test('threshold is exported and unchanged', () => {
    assert.equal(UNRELIABLE_STRIKE_THRESHOLD, 2);
});
