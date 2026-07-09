const fs = require('fs');
const path = require('path');

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

module.exports = { computeRosterDiff, shouldAbortSync };
