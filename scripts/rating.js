// Elo rating with a sliding K-factor.
// New players move fast so they settle quickly; K then slides down steadily
// so established players can't swing across leagues in a couple of games.
// Applies to games finished from Nov 2026 on; older games keep their stored changes.

const K_START = 40;      // K for a player's first game
const K_FLOOR = 20;      // K once fully established
const SLIDE_GAMES = 60;  // decisive games to slide from K_START to K_FLOOR (1 less every 3 games)

const VOID_NOTES = new Set(['Timed Out (Lobby)', 'Declined', 'Terminated']);

function kFactor(gamesPlayed) {
    const k = K_START - (K_START - K_FLOOR) * gamesPlayed / SLIDE_GAMES;
    return Math.max(K_FLOOR, k);
}

// Decisive games (a winner, not voided) a player has finished, from history.
function countDecisiveGames(history, playerId) {
    const id = String(playerId);
    let n = 0;
    for (const g of history || []) {
        if (!g || !g.p1_id || !g.winner_id || !g.loser_id) continue;
        if (g.note && VOID_NOTES.has(g.note)) continue;
        if (String(g.winner_id) === id || String(g.loser_id) === id) n++;
    }
    return n;
}

// Each side uses its own K, so the winner's gain and the loser's loss can differ.
function calculateElo(winnerElo, loserElo, winnerGames = 0, loserGames = 0) {
    const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    const gain = Math.round(kFactor(winnerGames) * (1 - expectedWinner));
    const loss = Math.round(kFactor(loserGames) * (1 - expectedWinner));
    return {
        newWinnerElo: winnerElo + gain,
        newLoserElo: loserElo - loss,
        gain,
        loss
    };
}

module.exports = {
    K_START,
    K_FLOOR,
    SLIDE_GAMES,
    kFactor,
    countDecisiveGames,
    calculateElo
};
