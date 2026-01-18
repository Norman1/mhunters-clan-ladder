const fs = require('fs');
const path = require('path');
const { createGame } = require('./api');

const PLAYERS_FILE = path.join(__dirname, '../data/players.json');
const ACTIVE_GAMES_FILE = path.join(__dirname, '../data/active_games.json');
const TEMPLATES_FILE = path.join(__dirname, '../data/templates.json');

const UNRELIABLE_STRIKE_THRESHOLD = 2;
const UNRELIABLE_MAX_COOLDOWN_WEEKS = 8;
const UNRELIABLE_COOLDOWN_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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

function parseDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getUnreliableCooldownMs(missedGames) {
    const weeks = Math.min(
        UNRELIABLE_MAX_COOLDOWN_WEEKS,
        Math.max(1, missedGames - (UNRELIABLE_STRIKE_THRESHOLD - 1))
    );

    return weeks * UNRELIABLE_COOLDOWN_WEEK_MS;
}

function getLastAssignedAt(id, players, activeGames) {
    const stored = parseDate(players[id]?.last_assigned_at);
    if (stored) return stored;

    let latest = null;
    activeGames.forEach(game => {
        if (String(game.p1_id) === String(id) || String(game.p2_id) === String(id)) {
            const createdAt = parseDate(game.created_at);
            if (createdAt && (!latest || createdAt > latest)) {
                latest = createdAt;
            }
        }
    });

    return latest;
}

function popDistinctPair(slots, players) {
    if (slots.length < 2) return null;

    const first = slots.pop();

    // Helper to check if two players were each other's last opponent
    const wereLastOpponents = (id1, id2) => {
        const p1 = players[id1];
        const p2 = players[id2];
        return (p1 && String(p1.last_opponent) === String(id2)) ||
            (p2 && String(p2.last_opponent) === String(id1));
    };

    // Try to find a valid opponent (not same player, not last opponent)
    for (let i = slots.length - 1; i >= 0; i--) {
        const candidate = slots[i];
        if (candidate !== first && !wereLastOpponents(first, candidate)) {
            slots.splice(i, 1);
            return [first, candidate];
        }
    }

    // No valid opponent found; restore first and stop pairing.
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
    const now = new Date();
    let playersUpdated = false;

    if (!players || !activeGames || !templates) {
        console.error('CRITICAL: Missing data files.');
        process.exit(1);
    }

    if (templates.length === 0) {
        console.warn('WARNING: No templates configured. Cannot create games.');
        console.log('Add templates via GitHub issue: AddTemplate: <ID> Name: <MapName>');
        return;
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
        const missedGames = Number(p.missed_games) || 0;
        const isReliable = missedGames < UNRELIABLE_STRIKE_THRESHOLD;
        const currentGames = playerGameCounts[id] || 0;
        const cap = Number(p.game_cap) || 0;
        const effectiveCap = isReliable ? cap : Math.min(cap, 1);
        const openSlots = Math.max(0, effectiveCap - currentGames);

        // Condition: Must have open slots.
        if (openSlots <= 0) return;

        if (!isReliable) {
            const lastAssignedAt = getLastAssignedAt(id, players, activeGames);
            const cooldownMs = getUnreliableCooldownMs(missedGames);
            if (lastAssignedAt && (now - lastAssignedAt) < cooldownMs) {
                return;
            }
        }

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
    while ((pair = popDistinctPair(activeSlots, players))) {
        pairs.push(pair);
    }

    // Match Inactives (fill their open slots)
    while ((pair = popDistinctPair(inactiveSlots, players))) {
        pairs.push(pair);
    }

    // If we have leftovers from both, maybe match them?
    // User said: "active players don't get annoyed by geting paired too often with inactives"
    // implies it's okay sometimes.
    // Helper to check if two players were each other's last opponent
    const wereLastOpponents = (id1, id2) => {
        const p1 = players[id1];
        const p2 = players[id2];
        return (p1 && String(p1.last_opponent) === String(id2)) ||
            (p2 && String(p2.last_opponent) === String(id1));
    };

    while (activeSlots.length > 0 && inactiveSlots.length > 0) {
        const activePlayer = activeSlots.pop();
        // Find an inactive player who isn't the last opponent
        let matchedIndex = -1;
        for (let i = inactiveSlots.length - 1; i >= 0; i--) {
            if (!wereLastOpponents(activePlayer, inactiveSlots[i])) {
                matchedIndex = i;
                break;
            }
        }
        if (matchedIndex >= 0) {
            const inactivePlayer = inactiveSlots.splice(matchedIndex, 1)[0];
            console.log("Matching leftover Active vs Inactive...");
            pairs.push([activePlayer, inactivePlayer]);
        } else {
            // No valid match, put active player back and stop
            activeSlots.push(activePlayer);
            break;
        }
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

IMPORTANT: Please join this game even if your opponent declines! This is how the ladder knows you are active. Active players get matched against other active players.

You can change your ladder settings online via https://norman1.github.io/mhunters-clan-ladder/ or you can ask in our clans discord for someone to do it for you.`;

            const result = await createGame(template.id, playersPayload, "M'Hunters Ladder", description);

            console.log(`Game Created! ID: ${result.gameID}`);

            // 6. Update Active Games
            const assignedAt = new Date().toISOString();
            players[p1Id].last_assigned_at = assignedAt;
            players[p2Id].last_assigned_at = assignedAt;
            playersUpdated = true;

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
    if (playersUpdated) {
        saveJSON(PLAYERS_FILE, players);
    }
    console.log('Matchmaker run complete.');
}

runMatchmaker();
