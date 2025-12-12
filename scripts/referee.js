const fs = require('fs');
const path = require('path');
const { pollGameStatus } = require('./api');

const PLAYERS_FILE = path.join(__dirname, '../data/players.json');
const ACTIVE_GAMES_FILE = path.join(__dirname, '../data/active_games.json');
const HISTORY_FILE = path.join(__dirname, '../data/history.json');

// --- Helper Functions ---

function loadJSON(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function calculateElo(winnerElo, loserElo) {
    const K = 30;
    const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));

    const newWinnerElo = Math.round(winnerElo + K * (1 - expectedWinner));
    const newLoserElo = Math.round(loserElo + K * (0 - expectedLoser));

    return { newWinnerElo, newLoserElo };
}

// --- Main Referee Logic ---

async function runReferee() {
    console.log('--- Starting Referee ---');

    const players = loadJSON(PLAYERS_FILE);
    const activeGames = loadJSON(ACTIVE_GAMES_FILE);
    const history = loadJSON(HISTORY_FILE);

    if (!players || !activeGames || !history) {
        console.error('CRITICAL: Missing data files.');
        process.exit(1);
    }

    const remainingGames = [];
    let stateChanged = false;

    for (const game of activeGames) {
        try {
            console.log(`Checking Game ID: ${game.game_id}`);
            const status = await pollGameStatus(game.game_id);

            // 1. Game Finished
            if (status.state === 'Finished') {
                console.log(`Game ${game.game_id} Finished.`);

                const winnerId = status.winnerID; // Verify API response field name
                // Assume logic to determine loser based on p1_id/p2_id vs winnerId
                const loserId = (winnerId == game.p1_id) ? game.p2_id : game.p1_id;

                if (players[winnerId] && players[loserId]) {
                    // Update ELO
                    const { newWinnerElo, newLoserElo } = calculateElo(players[winnerId].elo, players[loserId].elo);
                    players[winnerId].elo = newWinnerElo;
                    players[loserId].elo = newLoserElo;

                    // Reset Flakes & Active
                    players[winnerId].missed_games = 0;
                    players[loserId].missed_games = 0;
                    players[winnerId].active = true;
                    players[loserId].active = true;

                    console.log(`ELO Update: ${winnerId} (${newWinnerElo}) vs ${loserId} (${newLoserElo})`);
                }

                // Archive
                history.push({
                    game_id: game.game_id,
                    winner_id: winnerId,
                    loser_id: loserId,
                    finished_at: new Date().toISOString(),
                    template_id: game.template_id
                });
                stateChanged = true;

            }
            // 2. Game Terminated (Declined/Expired/Deleted)
            else if (status.state === 'Terminated') {
                console.log(`Game ${game.game_id} Terminated.`);

                // Need to identify offender. 
                // Simple logic: If it never started, who didn't join?
                // API might provide detail, or we assume both are flakes if we can't tell.
                // For this V1, let's just mark it as a wash for now to avoid unfair punishment without data.
                // Or: Poll detailed state to see who is "WaitingFor" or "Declined".

                // Archive as Void
                history.push({
                    game_id: game.game_id,
                    winner_id: null,
                    loser_id: null,
                    finished_at: new Date().toISOString(),
                    note: "Terminated"
                });
                stateChanged = true;
            }
            // 3. Game Running or Waiting
            else {
                remainingGames.push(game);
            }

        } catch (err) {
            console.error(`Error checking game ${game.game_id}:`, err.message);
            remainingGames.push(game); // Keep it to try again later
        }
    }

    if (stateChanged) {
        saveJSON(ACTIVE_GAMES_FILE, remainingGames);
        saveJSON(PLAYERS_FILE, players);
        saveJSON(HISTORY_FILE, history);
        console.log('State updated.');
    } else {
        console.log('No games finished.');
    }
}

runReferee();
