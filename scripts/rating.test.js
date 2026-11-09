const test = require('node:test');
const assert = require('node:assert');
const { kFactor, calculateElo, countDecisiveGames, SLIDE_GAMES } = require('./rating');

test('K slides from 40 down to 20 over 60 games, then stays at 20', () => {
    assert.strictEqual(kFactor(0), 40);
    assert.strictEqual(kFactor(3), 39);
    assert.strictEqual(kFactor(30), 30);
    assert.strictEqual(kFactor(SLIDE_GAMES), 20);
    assert.strictEqual(kFactor(500), 20);
    for (let n = 1; n <= 70; n++) assert.ok(kFactor(n) <= kFactor(n - 1), 'never rises');
});

test('equal established players move 10 each way', () => {
    const r = calculateElo(1000, 1000, 60, 60);
    assert.deepStrictEqual(r, { newWinnerElo: 1010, newLoserElo: 990, gain: 10, loss: 10 });
});

test('equal new players move 20 each way', () => {
    const r = calculateElo(1000, 1000, 0, 0);
    assert.strictEqual(r.gain, 20);
    assert.strictEqual(r.loss, 20);
});

test('newcomer beating a regular: newcomer gains on a high K, regular loses on K 20', () => {
    const r = calculateElo(1000, 1000, 0, 80);
    assert.strictEqual(r.gain, 20);
    assert.strictEqual(r.loss, 10);
});

test('mid-slide player (30 games, K 30) vs equal player moves 15', () => {
    const r = calculateElo(1000, 1000, 30, 30);
    assert.strictEqual(r.gain, 15);
    assert.strictEqual(r.loss, 15);
});

test('upsets pay more than expected wins', () => {
    const upset = calculateElo(1000, 1400, 50, 50);
    const expected = calculateElo(1400, 1000, 50, 50);
    assert.ok(upset.gain > 15 && expected.gain < 5, JSON.stringify({ upset, expected }));
});

test('counts only decisive, non-void games', () => {
    const h = [
        { p1_id: '1', p2_id: '2', winner_id: '1', loser_id: '2' },
        { p1_id: '1', p2_id: '3', winner_id: '3', loser_id: '1' },
        { p1_id: '1', p2_id: '2', note: 'Draw' },
        { p1_id: '1', p2_id: '2', winner_id: '2', loser_id: '1', note: 'Terminated' },
        { p1_id: '1', p2_id: '2', note: 'Declined' },
        { game_id: 9 }
    ];
    assert.strictEqual(countDecisiveGames(h, '1'), 2);
    assert.strictEqual(countDecisiveGames(h, 1), 2);
    assert.strictEqual(countDecisiveGames(h, '2'), 1);
    assert.strictEqual(countDecisiveGames(h, '4'), 0);
});
