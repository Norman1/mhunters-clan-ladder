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
    const activeCandidates = [];
    const inactiveCandidates = [];

    // Count active games per player
    const playerGameCounts = {};
    activeGames.forEach(game => {
        playerGameCounts[game.p1_id] = (playerGameCounts[game.p1_id] || 0) + 1;
        playerGameCounts[game.p2_id] = (playerGameCounts[game.p2_id] || 0) + 1;
    });

    Object.keys(players).forEach(id => {
        const p = players[id];
        const currentGames = playerGameCounts[id] || 0;

        // Condition: Must have open slots.
        // NOTE: We now include p.active=false players too!
        if (p.game_cap > 0 && currentGames < p.game_cap) {
            if (p.active) {
                activeCandidates.push({ id: id, ...p });
            } else {
                inactiveCandidates.push({ id: id, ...p });
            }
        }
    });

    console.log(`Found ${activeCandidates.length} Active and ${inactiveCandidates.length} Inactive candidates.`);

    // 3. Pairing Logic (Tiered)
    // Priority 1: Active vs Active
    // Priority 2: Inactive vs Inactive
    // Priority 3: Active vs Inactive (Fillers - optional, user said "PREFER" pairing inactives with inactives)

    shuffle(activeCandidates);
    shuffle(inactiveCandidates);

    const pairs = [];

    // Match Actives
    while (activeCandidates.length >= 2) {
        pairs.push([activeCandidates.pop(), activeCandidates.pop()]);
    }

    // Match Inactives
    while (inactiveCandidates.length >= 2) {
        pairs.push([inactiveCandidates.pop(), inactiveCandidates.pop()]);
    }

    // If we have leftovers from both, maybe match them?
    // User said: "active players don't get annoyed by geting paired too often with inactives"
    // implies it's okay sometimes.
    if (activeCandidates.length > 0 && inactiveCandidates.length > 0) {
        console.log("Matching leftover Active vs Inactive...");
        pairs.push([activeCandidates.pop(), inactiveCandidates.pop()]);
    }

    console.log(`Created ${pairs.length} pairs.`);

    for (const [p1, p2] of pairs) {
        console.log(`Pairing: ${p1.name} vs ${p2.name}`);

        // 4. Select Template (Random weighted could be better, just picking random for now)
        const template = templates[Math.floor(Math.random() * templates.length)];

        // 5. Create Game
        try {
            const players = [
                { token: p1.id, team: '0' },
                { token: p2.id, team: '1' }
            ];
            const result = await createGame(template.id, players, `Ladder: ${p1.name} vs ${p2.name}`);

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
        }
    }

    // 7. Save State
    saveJSON(ACTIVE_GAMES_FILE, activeGames);
    console.log('Matchmaker run complete.');
}

runMatchmaker();
