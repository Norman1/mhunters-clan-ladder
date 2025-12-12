const fs = require('fs');
const path = require('path');
const { createGame } = require('./api');

const PLAYERS_FILE = path.join(__dirname, '../data/players.json');
const ACTIVE_GAMES_FILE = path.join(__dirname, '../data/active_games.json');
const TEMPLATES_FILE = path.join(__dirname, '../data/templates.json');

// --- Helper Functions ---

function loadJSON(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- Main Matchmaker Logic ---

async function runMatchmaker() {
    console.log('--- Starting Matchmaker ---');

    // 1. Load Data
    const players = loadJSON(PLAYERS_FILE);
    const activeGames = loadJSON(ACTIVE_GAMES_FILE);
    const templates = loadJSON(TEMPLATES_FILE);

    if (!players || !activeGames || !templates) {
        console.error('CRITICAL: Missing data files.');
        process.exit(1);
    }

    // 2. Filter Candidates
    const candidates = [];

    // Count active games per player
    const playerGameCounts = {};
    activeGames.forEach(game => {
        playerGameCounts[game.p1_id] = (playerGameCounts[game.p1_id] || 0) + 1;
        playerGameCounts[game.p2_id] = (playerGameCounts[game.p2_id] || 0) + 1;
    });

    Object.keys(players).forEach(id => {
        const p = players[id];
        const currentGames = playerGameCounts[id] || 0;

        if (p.active && p.game_cap > 0 && currentGames < p.game_cap) {
            candidates.push({ id: id, ...p });
        }
    });

    console.log(`Found ${candidates.length} eligible candidates.`);
    if (candidates.length < 2) {
        console.log('Not enough players to create a match.');
        return;
    }

    // 3. Pairing Logic (Simple Shuffle for now)
    // TODO: Implement Flake vs Flake priority if needed
    shuffle(candidates);

    while (candidates.length >= 2) {
        const p1 = candidates.pop();
        const p2 = candidates.pop();

        console.log(`Pairing: ${p1.name} vs ${p2.name}`);

        // 4. Select Template (Random weighted could be better, just picking random for now)
        const template = templates[Math.floor(Math.random() * templates.length)];

        // 5. Create Game
        try {
            const result = await createGame(template.id, [
                { PlayerID: p1.id, Team: 0 },
                { PlayerID: p2.id, Team: 1 }
            ], `Ladder: ${p1.name} vs ${p2.name}`);

            console.log(`Game Created! ID: ${result.gameID}`);

            // 6. Update Active Games
            activeGames.push({
                game_id: result.gameID,
                created_at: new Date().toISOString(),
                p1_id: p1.id,
                p2_id: p2.id,
                template_id: template.id
            });

        } catch (err) {
            console.error(`Failed to create game for ${p1.name} vs ${p2.name}:`, err.message);
            // Put them back? Or just skip to next cycle. Skipping for safety.
        }
    }

    // 7. Save State
    saveJSON(ACTIVE_GAMES_FILE, activeGames);
    console.log('Matchmaker run complete.');
}

runMatchmaker();
