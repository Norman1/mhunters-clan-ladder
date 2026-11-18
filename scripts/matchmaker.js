const fs = require('fs');
const path = require('path');
const { createGame } = require('./api');
const { isLadderEligible } = require('./player_eligibility');

const PLAYERS_FILE = path.join(__dirname, '../data/players.json');
const ACTIVE_GAMES_FILE = path.join(__dirname, '../data/active_games.json');
const TEMPLATES_FILE = path.join(__dirname, '../data/templates.json');

const { UNRELIABLE_STRIKE_THRESHOLD, getUnreliableCooldownMs } = require('./reliability');

// --- Helper Functions ---

function loadJSON(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Warzone rejects game names over 50 characters (CreateGame API limit), so
// the template name is clipped when the full title would not fit.
const GAME_NAME_MAX = 50;

function ladderGameName(templateName) {
    if (!templateName) return "M'Hunters Ladder";
    const full = `MH Ladder: ${templateName}`;
    if (full.length <= GAME_NAME_MAX) return full;
    return `${full.slice(0, GAME_NAME_MAX - 3).trimEnd()}...`;
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

function pairKey(first, second) {
    return [String(first), String(second)].sort().join(':');
}

function planPairs(activeSlots, inactiveSlots, players, activeGames) {
    const blockedPairs = new Set(activeGames.map(game => pairKey(game.p1_id, game.p2_id)));
    for (const [id, player] of Object.entries(players)) {
        if (player?.last_opponent != null) blockedPairs.add(pairKey(id, player.last_opponent));
    }

    const pairs = [];
    function matchSlots(slots, opponents) {
        const waiting = [];
        while (slots.length && opponents.length) {
            const first = slots.pop();
            const index = opponents.findIndex(second => first !== second && !blockedPairs.has(pairKey(first, second)));
            if (index === -1) {
                // Keep this slot for the mixed tier and try the other players.
                waiting.push(first);
                continue;
            }
            const [second] = opponents.splice(index, 1);
            blockedPairs.add(pairKey(first, second));
            pairs.push([first, second]);
        }
        slots.push(...waiting);
    }

    matchSlots(activeSlots, activeSlots);
    matchSlots(inactiveSlots, inactiveSlots);
    matchSlots(activeSlots, inactiveSlots);
    return pairs;
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
        if (!isLadderEligible(p)) return;
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

    // 3. Prefer opponents in the same reliability tier, then pair remaining slots.
    shuffle(activeSlots);
    shuffle(inactiveSlots);
    const pairs = planPairs(activeSlots, inactiveSlots, players, activeGames);

    console.log(`Created ${pairs.length} pairs.`);

    // Calculate Ranks
    const rankedIds = Object.entries(players)
        .filter(([, p]) => isLadderEligible(p) && (Number(p.game_cap) || 0) > 0 && (Number(p.missed_games) || 0) < UNRELIABLE_STRIKE_THRESHOLD)
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
            const rankLabel1 = rank1 > 0 ? `Rank ${rank1}` : 'Unranked';
            const rankLabel2 = rank2 > 0 ? `Rank ${rank2}` : 'Unranked';

            const description = `This is an automatically generated game from the M'Hunters clan ladder.
Contender 1: ${p1.name}, ${rankLabel1} with ${p1.elo} Elo
Contender 2: ${p2.name}, ${rankLabel2} with ${p2.elo} Elo

IMPORTANT: Please join this game even if your opponent declines! This is how the ladder knows you are active. Active players get matched against other active players.

Ask a ladder maintainer to change your settings via https://norman1.github.io/mhunters-clan-ladder/ . You can reach the maintainers in our clan Discord.`;

            const result = await createGame(template.id, playersPayload, ladderGameName(template.name), description);

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

if (require.main === module) runMatchmaker();

module.exports = { runMatchmaker, planPairs };
