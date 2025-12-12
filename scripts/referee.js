const fs = require('fs');
const path = require('path');
const { pollGameStatus, deleteGame } = require('./api');

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
    const K = 40;
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
        let keepGame = true;

        try {
            console.log(`Checking Game ID: ${game.game_id}`);
            const status = await pollGameStatus(game.game_id);
            const now = new Date();
            const createdDate = new Date(game.created_at);
            const hoursSinceCreation = (now - createdDate) / (1000 * 60 * 60);

            // --- 1. LOBBY TIMEOUT (3 Days) ---
            if (status.state === 'WaitingForSignups' && hoursSinceCreation > 72) {
                console.log(`Game ${game.game_id} timed out in lobby (>72h). Deleting...`);

                // Note: API response structure assumed. Adjust if needed.
                // Based on Java 'GamePlayerQueryResponse': { id, state, team }
                // and 'GameQueryResponse': { state, players: [...] }
                if (status.players) {
                    status.players.forEach(p => {
                        // Check for both cases just in case API varies
                        const pState = p.State || p.state;
                        const pId = p.ID || p.id;

                        if (pState === 'Invited' || pState === 'Declined') {
                            if (players[pId]) {
                                players[pId].missed_games = (players[pId].missed_games || 0) + 1;
                                console.log(`Strike for ${players[pId].name} (Failed to join). Strikes: ${players[pId].missed_games}`);
                            }
                        }
                    });
                } else {
                    console.warn(`Could not determine player states for timeout game ${game.game_id}`);
                }

                await deleteGame(game.game_id);

                // Archive as Void
                history.push({
                    game_id: game.game_id,
                    finished_at: now.toISOString(),
                    note: "Timed Out (Lobby)"
                });

                keepGame = false;
                stateChanged = true;
            }

            // --- 2. TERMINATED (Declined/Deleted by someone else) ---
            else if (status.state === 'Terminated') {
                console.log(`Game ${game.game_id} was Terminated.`);

                if (status.players) {
                    status.players.forEach(p => {
                        const pState = p.State || p.state;
                        const pId = p.ID || p.id;

                        if (pState === 'Declined') {
                            if (players[pId]) {
                                players[pId].missed_games = (players[pId].missed_games || 0) + 1;
                                console.log(`Strike for ${players[pId].name} (Declined). Strikes: ${players[pId].missed_games}`);
                            }
                        }
                    });
                }

                history.push({
                    game_id: game.game_id,
                    finished_at: now.toISOString(),
                    note: "Terminated"
                });

                keepGame = false;
                stateChanged = true;
            }

            // --- 3. FINISHED ---
            else if (status.state === 'Finished') {
                console.log(`Game ${game.game_id} Finished.`);

                const winnerId = status.WinnerID || status.winnerID;

                // Explicit Draw Handling
                if (!winnerId) {
                    console.log(`Game ${game.game_id} ended in a Draw (Vote to End). No ELO change.`);
                    // We still proceed to cleanup the game and reset strikes.
                }
                else {
                    const loserId = (winnerId == game.p1_id) ? game.p2_id : game.p1_id;

                    if (players[winnerId] && players[loserId]) {
                        // Update ELO
                        const { newWinnerElo, newLoserElo } = calculateElo(players[winnerId].elo, players[loserId].elo);
                        players[winnerId].elo = newWinnerElo;
                        players[loserId].elo = newLoserElo;

                        console.log(`ELO Update: ${winnerId} (${newWinnerElo}) vs ${loserId} (${newLoserElo})`);
                    }
                }

                // SUCCESS: Reset strikes and Auto-Reactivate
                [game.p1_id, game.p2_id].forEach(pid => {
                    if (players[pid]) {
                        players[pid].missed_games = 0;
                        if (players[pid].active === false) {
                            console.log(`Auto-reactivating player ${players[pid].name} (Completed game).`);
                            players[pid].active = true;
                        }
                    }
                });

                history.push({
                    game_id: game.game_id,
                    winner_id: winnerId,
                    loser_id: loserId,
                    finished_at: now.toISOString(),
                    template_id: game.template_id
                });

                keepGame = false;
                stateChanged = true;
            }

            // --- 4. RUNNING / PLAYING ---
            else if (status.state === 'Playing') {
                // If the game started, they joined. Reset strikes immediately? 
                // Requirement: "The way a players gets active again is if he once joins a game properly."
                // So yes, if it's Playing, they joined.

                [game.p1_id, game.p2_id].forEach(pid => {
                    if (players[pid]) {
                        // Only reset if they have strikes?
                        // User said: "active again if he once joins a game properly".
                        // Use this moment to clear strikes/reactivate.
                        if (players[pid].missed_games > 0 || !players[pid].active) {
                            players[pid].missed_games = 0;
                            players[pid].active = true;
                            stateChanged = true;
                        }
                    }
                });
            }

        } catch (err) {
            console.error(`Error checking game ${game.game_id}:`, err.message);
        }

        if (keepGame) {
            remainingGames.push(game);
        }
    }

    // --- 5. CHECK STRIKES ---
    Object.keys(players).forEach(pid => {
        if (players[pid].missed_games >= 2 && players[pid].active) {
            console.log(`Player ${players[pid].name} has ${players[pid].missed_games} strikes. Deactivating.`);
            players[pid].active = false;
            stateChanged = true;
        }
    });

    if (stateChanged) {
        saveJSON(ACTIVE_GAMES_FILE, remainingGames);
        saveJSON(PLAYERS_FILE, players);
        saveJSON(HISTORY_FILE, history);
        console.log('State updated.');
    } else {
        console.log('No state changes.');
    }
}

runReferee();
