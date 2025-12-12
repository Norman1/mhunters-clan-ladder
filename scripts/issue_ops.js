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
    // Signup: [PlayerID] Name: [Name] (Name is optional for backward compatibility, but preferred)
    const regexSignup = /^Signup:\s*(\d+)(?:\s+Name:\s*(.+))?$/i;
    const regexUpdate = /^Update:\s*(\d+)\s+Cap:\s*(\d+)$/i;

    let matched = false;

    // 1. Signup: [PlayerID] [Name: ... ]
    if (regexSignup.test(title)) {
        const match = title.match(regexSignup);
        const playerId = match[1];
        const playerName = match[2] ? match[2].trim() : `Player_${playerId}`;

        if (players[playerId]) {
            console.log(`Player ${playerId} already exists.`);
        } else {
            players[playerId] = {
                name: playerName,
                elo: 1000,
                game_cap: 3,
                missed_games: 0
            };
            console.log(`Registered new player: ${playerId} as ${playerName}`);
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

    // 3. Remove: [PlayerID]
    else if (/^Remove:\s*(\d+)$/i.test(title)) {
        const match = title.match(/^Remove:\s*(\d+)$/i);
        const playerId = match[1];

        if (players[playerId]) {
            delete players[playerId];
            console.log(`Removed player: ${playerId}`);
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
