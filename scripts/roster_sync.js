const fs = require('fs');
const path = require('path');

const { CLAN_ID } = require('./config');
const { fetchClanRoster } = require('./clan_roster');
const { deleteGame } = require('./api');

const PLAYERS_FILE = path.join(__dirname, '../data/players.json');
const ACTIVE_GAMES_FILE = path.join(__dirname, '../data/active_games.json');
const HISTORY_FILE = path.join(__dirname, '../data/history.json');

// Abort the sync if more than this fraction of registered in-clan players
// would be marked departed at once (guards against scrape breakage).
const MAX_DEPART_FRACTION = 0.2;

// Abort the sync if more than this fraction of the scraped roster is
// unregistered (guards against a junk scrape bulk-enrolling bogus accounts).
const MAX_NEW_FRACTION = 0.25;

function loadJSON(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Diffs the scraped clan roster against the player registry.
 * @param {Array<{id: string, name: string|null}>} roster
 * @param {Object} players - players.json contents keyed by ID
 * @returns {{newMembers: Array, leavers: string[], rejoiners: string[], renames: Array}}
 */
function computeRosterDiff(roster, players) {
    const rosterById = new Map(roster.map(m => [String(m.id), m]));
    const newMembers = [];
    const leavers = [];
    const rejoiners = [];
    const renames = [];

    for (const member of rosterById.values()) {
        if (!players[String(member.id)]) newMembers.push(member);
    }

    for (const [id, p] of Object.entries(players)) {
        const member = rosterById.get(String(id));
        const departed = p.in_clan === false;

        if (member && departed) rejoiners.push(id);
        if (!member && !departed) leavers.push(id);
        if (member && member.name && member.name !== p.name) {
            renames.push({ id, name: member.name });
        }
    }

    return { newMembers, leavers, rejoiners, renames };
}

/**
 * Returns a reason string if the sync must be aborted, else null.
 */
function shouldAbortSync(roster, players) {
    if (!roster || roster.length === 0) return 'roster scrape returned no members';

    const inClanCount = Object.values(players).filter(p => p.in_clan !== false).length;
    const { leavers, newMembers } = computeRosterDiff(roster, players);

    if (inClanCount > 0 && leavers.length / inClanCount > MAX_DEPART_FRACTION) {
        return `would mark ${leavers.length} of ${inClanCount} registered players departed`;
    }

    const uniqueCount = new Set(roster.map(m => String(m.id))).size;
    if (newMembers.length / uniqueCount > MAX_NEW_FRACTION) {
        return `would enroll ${newMembers.length} new players from a roster of ${uniqueCount}`;
    }

    return null;
}

/**
 * Voids all active games involving departed players.
 * Lobby games are deleted via the API; in-progress games cannot be
 * force-ended, so they are just untracked. All are archived as void.
 * Does NOT strike or set last_opponent — the opponent did nothing wrong.
 * @returns remaining active games (leaver games removed). Mutates `history`.
 */
async function voidLeaverGames(leaverIds, activeGames, history, deleteGameFn, nowIso) {
    const leaverSet = new Set(leaverIds.map(String));
    const remaining = [];

    for (const game of activeGames) {
        const hasLeaver = leaverSet.has(String(game.p1_id)) || leaverSet.has(String(game.p2_id));
        if (!hasLeaver) {
            remaining.push(game);
            continue;
        }

        const inLobby = !game.game_state || game.game_state === 'WaitingForPlayers';
        if (inLobby) {
            try {
                await deleteGameFn(game.game_id);
            } catch (e) {
                console.error(`Failed to delete game ${game.game_id} (may already be gone): ${e.message}`);
            }
        }

        history.push({
            game_id: game.game_id,
            created_at: game.created_at,
            p1_id: game.p1_id,
            p2_id: game.p2_id,
            template_id: game.template_id,
            finished_at: nowIso,
            note: 'Left Clan'
        });
    }

    return remaining;
}

async function main() {
    console.log('--- Starting Roster Sync ---');
    const dryRun = process.argv.includes('--dry-run');

    const players = loadJSON(PLAYERS_FILE);
    const activeGames = loadJSON(ACTIVE_GAMES_FILE);
    const history = loadJSON(HISTORY_FILE);

    if (!players || !activeGames || !history) {
        console.error('CRITICAL: Missing data files.');
        process.exit(1);
    }

    let roster;
    try {
        roster = await fetchClanRoster(CLAN_ID);
    } catch (err) {
        // A flaky scrape must never block referee/matchmaker: skip the sync.
        console.error(`Roster scrape failed, skipping sync: ${err.message}`);
        return;
    }
    console.log(`Scraped ${roster.length} clan members.`);

    const abortReason = shouldAbortSync(roster, players);
    if (abortReason) {
        console.error(`CIRCUIT BREAKER: aborting sync — ${abortReason}. No changes applied. If this is expected (e.g. a mass clan-membership change), apply the change manually via players.json or adjust the breaker thresholds in this file.`);
        return;
    }

    const diff = computeRosterDiff(roster, players);
    console.log(`New members: ${diff.newMembers.length}, leavers: ${diff.leavers.length}, rejoiners: ${diff.rejoiners.length}, renames: ${diff.renames.length}`);
    diff.newMembers.forEach(m => console.log(`  + enroll ${m.name || m.id} (${m.id})`));
    diff.leavers.forEach(id => console.log(`  - depart ${players[id].name} (${id})`));
    diff.rejoiners.forEach(id => console.log(`  ~ rejoin ${players[id].name} (${id})`));
    diff.renames.forEach(r => console.log(`  ~ rename ${players[r.id].name} -> ${r.name} (${r.id})`));

    if (dryRun) {
        console.log('DRY RUN: no changes written.');
        return;
    }

    const nowIso = new Date().toISOString();

    for (const m of diff.newMembers) {
        players[String(m.id)] = {
            name: m.name || `Player_${m.id}`,
            elo: 1000,
            game_cap: 2,
            missed_games: 0,
            in_clan: true
        };
    }
    for (const id of diff.leavers) {
        players[id].in_clan = false;
        players[id].departed_at = nowIso;
    }
    for (const id of diff.rejoiners) {
        players[id].in_clan = true;
        delete players[id].departed_at;
    }
    for (const r of diff.renames) {
        players[r.id].name = r.name;
    }

    const remainingGames = await voidLeaverGames(diff.leavers, activeGames, history, deleteGame, nowIso);

    saveJSON(PLAYERS_FILE, players);
    saveJSON(ACTIVE_GAMES_FILE, remainingGames);
    saveJSON(HISTORY_FILE, history);
    console.log('Roster sync complete.');
}

if (require.main === module) main();

module.exports = { computeRosterDiff, shouldAbortSync, voidLeaverGames };
