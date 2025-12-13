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

function popDistinctPair(slots) {
    if (slots.length < 2) return null;

    const first = slots.pop();
    let second = slots.pop();

    if (first !== second) {
        return [first, second];
    }

    // Put the duplicate back and find a different opponent.
    slots.push(second);

    for (let i = slots.length - 1; i >= 0; i--) {
        if (slots[i] !== first) {
            second = slots.splice(i, 1)[0];
            return [first, second];
        }
    }

    // No valid opponent; restore and stop pairing.
    slots.push(first);
    return null;
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


    // 2. Build Candidate Slots (Fill up to cap in one run)
    const activeSlots = [];
    const inactiveSlots = [];
    const activePlayers = new Set();
    const inactivePlayers = new Set();

    // Count active games per player (current state)
    const playerGameCounts = {};
    activeGames.forEach(game => {
        playerGameCounts[game.p1_id] = (playerGameCounts[game.p1_id] || 0) + 1;
        playerGameCounts[game.p2_id] = (playerGameCounts[game.p2_id] || 0) + 1;
    });

    Object.entries(players).forEach(([id, p]) => {
        const currentGames = playerGameCounts[id] || 0;
        const cap = Number(p.game_cap) || 0;
        const openSlots = Math.max(0, cap - currentGames);

        // Condition: Must have open slots.
        if (openSlots <= 0) return;

        // Pool A: Reliable (0-1 Strikes)
        // Pool B: Unreliable (>= 2 Strikes)
        const missedGames = Number(p.missed_games) || 0;
        const isReliable = missedGames < 2;

        const slots = isReliable ? activeSlots : inactiveSlots;
        const set = isReliable ? activePlayers : inactivePlayers;
        set.add(id);

        for (let i = 0; i < openSlots; i++) {
            slots.push(id);
        }
    });

    console.log(`Found ${activePlayers.size} Active (${activeSlots.length} slots) and ${inactivePlayers.size} Inactive (${inactiveSlots.length} slots).`);

    // 3. Pairing Logic (Tiered)
    // Priority 1: Active vs Active
    // Priority 2: Inactive vs Inactive
    // Priority 3: Active vs Inactive (Fillers - optional, user said "PREFER" pairing inactives with inactives)

    shuffle(activeSlots);
    shuffle(inactiveSlots);

    const pairs = [];

    // Match Actives (fill their open slots)
    let pair = null;
    while ((pair = popDistinctPair(activeSlots))) {
        pairs.push(pair);
    }

    // Match Inactives (fill their open slots)
    while ((pair = popDistinctPair(inactiveSlots))) {
        pairs.push(pair);
    }

    // If we have leftovers from both, maybe match them?
    // User said: "active players don't get annoyed by geting paired too often with inactives"
    // implies it's okay sometimes.
    while (activeSlots.length > 0 && inactiveSlots.length > 0) {
        console.log("Matching leftover Active vs Inactive...");
        pairs.push([activeSlots.pop(), inactiveSlots.pop()]);
    }

    console.log(`Created ${pairs.length} pairs.`);

    // Calculate Ranks
    const rankedIds = Object.entries(players)
        .filter(([, p]) => (Number(p.game_cap) || 0) > 0)
        .sort((a, b) => (Number(b[1].elo) || 0) - (Number(a[1].elo) || 0))
        .map(([id]) => String(id));

    const rankById = new Map(rankedIds.map((id, index) => [id, index + 1]));
    const getRank = (id) => rankById.get(String(id)) || 0; // 1-based rank (0 if unranked)

    for (const [p1Id, p2Id] of pairs) {
        const p1 = players[p1Id];
        const p2 = players[p2Id];

        if (!p1 || !p2) {
            console.warn(`Skipping pair with missing player(s): ${p1Id} vs ${p2Id}`);
            continue;
        }

        console.log(`Pairing: ${p1.name} vs ${p2.name}`);

        // 4. Select Template (Random weighted could be better, just picking random for now)
        const template = templates[Math.floor(Math.random() * templates.length)];

        // 5. Create Game
        try {
            const playersPayload = [
                { token: p1Id, team: '0' },
                { token: p2Id, team: '1' }
            ];

            const rank1 = getRank(p1Id);
            const rank2 = getRank(p2Id);

            const description = `This is an automatically generated game from the M'Hunters clan ladder.
Contender 1: ${p1.name}, Rank ${rank1} with ${p1.elo} Elo
Contender 2: ${p2.name}, Rank ${rank2} with ${p2.elo} Elo
You can change your ladder settings online via https://norman1.github.io/mhunters-clan-ladder/ or you can ask in our clans discord for someone to do it for you.`;

            const result = await createGame(template.id, playersPayload, "M'Hunters Ladder", description);

            console.log(`Game Created! ID: ${result.gameID}`);

            // 6. Update Active Games
            activeGames.push({
                game_id: result.gameID,
                created_at: new Date().toISOString(),
                p1_id: p1Id,
                p2_id: p2Id,
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
