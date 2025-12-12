const fs = require('fs');
const path = require('path');

const PLAYERS_FILE = path.join(__dirname, '../data/players.json');

function loadJSON(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function runIssueOps() {
    console.log('--- Starting IssueOps ---');

    console.log(`ENV check: ISSUE_TITLE='${process.env.ISSUE_TITLE}'`);

    const title = process.env.ISSUE_TITLE;
    const players = loadJSON(PLAYERS_FILE);

    if (!players) {
        console.error('CRITICAL: Missing players.json');
        process.exit(1);
    }

    if (!title) {
        console.error('No ISSUE_TITLE found in env.');
        // Maybe we just exit? Depending on trigger, this might happen.
        return;
    }

    // Regex Parsers
    const regexSignup = /^Signup:\s*(\d+)$/i;
    const regexUpdate = /^Update:\s*(\d+)\s+Cap:\s*(\d+)$/i;

    let matched = false;

    // 1. Signup: [PlayerID]
    if (regexSignup.test(title)) {
        const match = title.match(regexSignup);
        const playerId = match[1];

        if (players[playerId]) {
            console.log(`Player ${playerId} already exists.`);
        } else {
            players[playerId] = {
                name: `Player_${playerId}`, // Default name, maybe user can update later?
                clan_tag: "",
                elo: 1000,
                game_cap: 3,
                active: true,
                missed_games: 0
            };
            console.log(`Registered new player: ${playerId}`);
            matched = true;
        }
    }

    // 2. Update: [PlayerID] Cap: [0-5]
    else if (regexUpdate.test(title)) {
        const match = title.match(regexUpdate);
        const playerId = match[1];
        const newCap = parseInt(match[2], 10);

        if (players[playerId]) {
            players[playerId].game_cap = newCap;
            console.log(`Updated ${playerId} game_cap to ${newCap}`);
            matched = true;
        } else {
            console.error(`Player ${playerId} not found.`);
        }
    }

    else {
        console.log('Issue title did not match any known commands.');
    }

    if (matched) {
        saveJSON(PLAYERS_FILE, players);
        console.log('Player registry updated.');
    }
}

runIssueOps();
