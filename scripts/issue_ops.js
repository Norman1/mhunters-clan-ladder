const fs = require('fs');
const path = require('path');

const PLAYERS_FILE = path.join(__dirname, '../data/players.json');
const TEMPLATES_FILE = path.join(__dirname, '../data/templates.json');

const MIN_GAME_CAP = 0;
const MAX_GAME_CAP = 3;

function loadJSON(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function postIssueComment(message) {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    const issueNumber = process.env.ISSUE_NUMBER;

    if (!token || !repo || !issueNumber) return;

    try {
        const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({ body: message })
        });

        if (!res.ok) {
            const text = await res.text();
            console.warn(`Failed to post issue comment (${res.status}): ${text}`);
        }
    } catch (err) {
        console.warn(`Failed to post issue comment: ${err.message}`);
    }
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
        const requestedName = match[2] ? match[2].trim() : '';

        if (match[2] && !requestedName) {
            console.log(`Invalid signup (empty name) for ${playerId}.`);
            await postIssueComment(
                `❌ Signup rejected: name cannot be empty.\n\nUse: \`Signup: ${playerId} Name: Your_Warzone_Username\``
            );
            return;
        }

        if (players[playerId]) {
            console.log(`Player ${playerId} already exists.`);
            await postIssueComment(
                `❌ Signup rejected: Player ID \`${playerId}\` is already registered as **${players[playerId].name}**.\n\n` +
                `Use:\n- \`Update: ${playerId} Cap: ${MIN_GAME_CAP}-${MAX_GAME_CAP}\`\n- \`Remove: ${playerId}\``
            );
        } else {
            const playerName = requestedName || `Player_${playerId}`;
            players[playerId] = {
                name: playerName,
                elo: 1000,
                game_cap: 2,
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
            if (!Number.isInteger(newCap) || newCap < MIN_GAME_CAP || newCap > MAX_GAME_CAP) {
                console.error(`Invalid cap '${match[2]}' for ${playerId}.`);
                await postIssueComment(
                    `❌ Update rejected: cap must be an integer between ${MIN_GAME_CAP} and ${MAX_GAME_CAP}.\n\n` +
                    `Use: \`Update: ${playerId} Cap: ${MIN_GAME_CAP}-${MAX_GAME_CAP}\``
                );
                return;
            }

            players[playerId].game_cap = newCap;
            console.log(`Updated ${playerId} game_cap to ${newCap}`);
            matched = true;
        } else {
            console.error(`Player ${playerId} not found.`);
            await postIssueComment(
                `❌ Update rejected: Player ID \`${playerId}\` is not registered.\n\nUse: \`Signup: ${playerId} Name: Your_Warzone_Username\``
            );
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
            await postIssueComment(
                `❌ Remove rejected: Player ID \`${playerId}\` is not registered.`
            );
        }
    }

    // 4. AddTemplate: [TemplateID] Name: [Name]
    else if (/^AddTemplate:\s*(\d+)\s+Name:\s*(.+)$/i.test(title)) {
        const match = title.match(/^AddTemplate:\s*(\d+)\s+Name:\s*(.+)$/i);
        const templateId = parseInt(match[1], 10);
        const templateName = match[2].trim();

        const templates = loadJSON(TEMPLATES_FILE) || [];

        const existing = templates.find(t => t.id === templateId);
        if (existing) {
            console.log(`Template ${templateId} already exists.`);
            await postIssueComment(
                `❌ AddTemplate rejected: Template ID \`${templateId}\` already exists as **${existing.name}**.`
            );
        } else if (!templateName) {
            console.log(`Invalid template name for ${templateId}.`);
            await postIssueComment(
                `❌ AddTemplate rejected: Template name cannot be empty.`
            );
        } else {
            templates.push({ id: templateId, name: templateName });
            saveJSON(TEMPLATES_FILE, templates);
            console.log(`Added template: ${templateId} - ${templateName}`);
            await postIssueComment(
                `✅ Template **${templateName}** (ID: \`${templateId}\`) has been added to the map pool.`
            );
        }
    }

    // 5. RemoveTemplate: [TemplateID]
    else if (/^RemoveTemplate:\s*(\d+)$/i.test(title)) {
        const match = title.match(/^RemoveTemplate:\s*(\d+)$/i);
        const templateId = parseInt(match[1], 10);

        const templates = loadJSON(TEMPLATES_FILE) || [];
        const templateIndex = templates.findIndex(t => t.id === templateId);

        if (templateIndex === -1) {
            console.error(`Template ${templateId} not found.`);
            await postIssueComment(
                `❌ RemoveTemplate rejected: Template ID \`${templateId}\` is not in the pool.`
            );
        } else {
            const removed = templates.splice(templateIndex, 1)[0];
            saveJSON(TEMPLATES_FILE, templates);
            console.log(`Removed template: ${templateId}`);
            await postIssueComment(
                `✅ Template **${removed.name}** (ID: \`${templateId}\`) has been removed from the map pool.`
            );
        }
    }

    else {
        console.log('Issue title did not match any known commands.');
        await postIssueComment(
            `❌ Unrecognized command.\n\nUse one of:\n` +
            `- \`Signup: <PlayerID> Name: <Warzone_Username>\`\n` +
            `- \`Update: <PlayerID> Cap: ${MIN_GAME_CAP}-${MAX_GAME_CAP}\`\n` +
            `- \`Remove: <PlayerID>\`\n` +
            `- \`AddTemplate: <TemplateID> Name: <MapName>\`\n` +
            `- \`RemoveTemplate: <TemplateID>\``
        );
    }

    if (matched) {
        saveJSON(PLAYERS_FILE, players);
        console.log('Player registry updated.');
    }
}

runIssueOps();
