
const REPO_OWNER = 'norman'; // TODO: Change this to actual owner if known, or make dynamic? 
// For GitHub Pages, it usually knows where it is. But for constructing Issue Links, we need the repo URL.
// We can ask user to configure, or just assume relative links won't work for Issues.
// Let's assume the user edits this variable or we parse it from window.location for Pages.

// Helper to get repo URL
function getRepoURL() {
    // If hosted on username.github.io/repo-name
    const parts = window.location.pathname.split('/');
    // parts[1] is usually repo name
    // But for now, let's just make the Issue Link generic or ask user to fill it.
    // Better: use relative link to ../../issues/new ?
    // No, Pages is static. Issues are on github.com.
    // Let's try to construct it from window.location.hostname

    // Example: https://norman.github.io/vibe-clan-ladder/ -> https://github.com/norman/vibe-clan-ladder

    const host = window.location.hostname;
    if (host.includes('github.io')) {
        const user = host.split('.')[0];
        const repo = window.location.pathname.split('/')[1];
        return `https://github.com/${user}/${repo}`;
    }

    return 'https://github.com/YOUR_USER/YOUR_REPO'; // Fallback
}

async function loadData() {
    try {
        const [playersRes, gamesRes, historyRes, templatesRes] = await Promise.all([
            fetch('data/players.json'),
            fetch('data/active_games.json'),
            fetch('data/history.json'),
            fetch('data/templates.json')
        ]);

        if (![playersRes, gamesRes, historyRes, templatesRes].every(r => r.ok)) {
            throw new Error('One or more data files failed to load.');
        }

        const players = await playersRes.json();
        const games = await gamesRes.json();
        const history = await historyRes.json();
        const templates = await templatesRes.json();

        window.players = players;

        // Map Templates by ID for easy lookup
        window.templates = {};
        templates.forEach(t => {
            window.templates[t.id] = t;
        });

        renderLeaderboard(players);
        renderGames(games, players);
        renderHistory(history, players);
    } catch (err) {
        console.error('Error loading data:', err);
        document.querySelector('main').innerHTML += `<p style="color:red">Error loading data. Is this hosted correctly?</p>`;
    }
}

function normalizePlayerId(value) {
    return String(value || '').trim();
}

function requireLoadedPlayers() {
    if (!window.players || typeof window.players !== 'object') {
        alert('Data is still loading. Please wait a moment and try again.');
        return null;
    }

    return window.players;
}

function validatePlayerId(id) {
    if (!id) return 'Enter Player ID';
    if (!/^\d+$/.test(id)) return 'Player ID must be numeric';
    return null;
}

function renderLeaderboard(players) {
    const tbody = document.getElementById('leaderboard-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const allPlayers = Object.entries(players).map(([id, p]) => ({ ...p, id }));

    // Split into Active (Cap > 0) and Inactive (Cap == 0)
    const active = allPlayers.filter(p => p.game_cap > 0).sort((a, b) => b.elo - a.elo);
    const inactive = allPlayers.filter(p => p.game_cap == 0).sort((a, b) => b.elo - a.elo);

    // Merge: Active first, then Inactive
    const list = [...active, ...inactive];

    list.forEach((p, index) => {
        // Determine Rank Display
        let rankDisplay;
        if (p.game_cap == 0) {
            rankDisplay = '<span style="color: grey; font-style: italic;">Unranked</span>';
        } else {
            // Rank is index + 1 relative to ACTIVE list only? 
            // Or relative to full list? 
            // Usually Unranked means they don't hold a rank number.
            // So Active players get 1..N.
            // We need to know the index within 'active' array to give correct rank number.
            // But we are iterating the merged list.

            // Check if player is in active list
            const activeIndex = active.indexOf(p);
            if (activeIndex !== -1) {
                rankDisplay = activeIndex + 1;
            } else {
                // Should be covered by p.game_cap == 0 check, but safe fallback
                rankDisplay = '-';
            }
        }

        // Main Row
        const row = document.createElement('tr');
        row.classList.add('player-row');
        row.onclick = () => toggleDetails(p.id);
        row.innerHTML = `
            <td>${rankDisplay}</td>
            <td>${p.name} ${p.missed_games >= 2 ? '<span class="status-warn">⚠️</span>' : ''}</td>
            <td>${p.elo}</td>
        `;
        tbody.appendChild(row);

        // Details Row
        const detailsRow = document.createElement('tr');
        detailsRow.id = `details-${p.id}`;
        detailsRow.classList.add('details-row');
        detailsRow.style.display = 'none';

        // Resolve last opponent name
        const lastOpponentName = p.last_opponent
            ? (players[p.last_opponent] ? players[p.last_opponent].name : p.last_opponent)
            : 'None';

        detailsRow.innerHTML = `
            <td colspan="3">
                <div class="player-details">
                    <p><strong>ID:</strong> ${p.id}</p>
                    <p><strong>Status:</strong> ${p.missed_games < 2 ? '✅ Reliable' : '⚠️ Unreliable (Missed >2 Games)'}</p>
                    <p><strong>Missed Games:</strong> ${p.missed_games}</p>
                    <p><strong>Game Cap:</strong> ${p.game_cap}</p>
                    <p><strong>Last Opponent:</strong> ${lastOpponentName}</p>
                </div>
            </td>
        `;
        tbody.appendChild(detailsRow);
    });
}

function toggleDetails(id) {
    const row = document.getElementById(`details-${id}`);
    if (row.style.display === 'none') {
        row.style.display = 'table-row';
    } else {
        row.style.display = 'none';
    }
}

function renderGames(games, players) {
    const container = document.getElementById('games-list');
    if (!container) return;
    container.innerHTML = '';

    if (games.length === 0) {
        container.innerHTML = '<p>No active games.</p>';
        return;
    }

    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>P1</th>
                <th>P2</th>
                <th>Started</th>
                <th>Link</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    games.forEach(g => {
        const p1 = players[g.p1_id] ? players[g.p1_id].name : g.p1_id;
        const p2 = players[g.p2_id] ? players[g.p2_id].name : g.p2_id;
        const date = new Date(g.created_at).toLocaleString();

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${p1}</td>
            <td>${p2}</td>
            <td>${date}</td>
            <td><a href="https://www.warzone.com/MultiPlayer?GameID=${g.game_id}" target="_blank">View</a></td>
        `;
        tbody.appendChild(tr);
    });

    container.appendChild(table);
}

function renderHistory(history, players, { limit = null, containerId = 'history-list' } = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    let validGames = history
        .filter(h => h.winner_id || (h.note === 'Draw') || (h.note && !h.note.includes('Timed Out') && !h.note.includes('Terminated')))
        .reverse();

    if (limit) {
        validGames = validGames.slice(0, limit);
    }

    if (validGames.length === 0) {
        container.innerHTML = '<p>No history available yet.</p>';
        return;
    }

    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Player 1</th>
                <th>Player 2</th>
                <th>Map</th>
                <th>Link</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    validGames.forEach(g => {
        // Fallback for old history without p1_id/p2_id
        const p1Id = g.p1_id || g.winner_id || '?';
        const p2Id = g.p2_id || g.loser_id || '?';

        const p1Name = players[p1Id] ? players[p1Id].name : p1Id;
        const p2Name = players[p2Id] ? players[p2Id].name : p2Id;

        // Map Name
        const mapName = (window.templates && window.templates[g.template_id])
            ? window.templates[g.template_id].name
            : (g.template_id || '-');

        // Determine Status
        let p1Class = '';
        let p2Class = '';

        if (g.note === 'Draw' || !g.winner_id) {
            p1Class = 'status-draw';
            p2Class = 'status-draw';
        } else {
            // Check if P1 is the winner
            // Note: matching IDs. g.winner_id is a string/int. JSON might mix types?
            // Safer to use == or String() comparison.
            if (String(g.winner_id) === String(p1Id)) {
                p1Class = 'status-win';
                p2Class = 'status-loss';
            } else if (String(g.winner_id) === String(p2Id)) {
                p1Class = 'status-loss';
                p2Class = 'status-win';
            } else {
                // Winner ID isn't either P1 or P2? (Maybe removed player or alias fallback?)
                // Just leave empty or draw?
                console.warn('Winner ID matches neither P1 nor P2', g);
            }
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="${p1Class}">${p1Name}</td>
            <td class="${p2Class}">${p2Name}</td>
            <td>${mapName}</td>
            <td><a href="https://www.warzone.com/MultiPlayer?GameID=${g.game_id}" target="_blank">View</a></td>
        `;
        tbody.appendChild(tr);
    });

    container.appendChild(table);
}

function joinLadder() {
    const name = String(document.getElementById('join-name').value || '').trim();
    const id = normalizePlayerId(document.getElementById('join-id').value);

    const idError = validatePlayerId(id);
    if (idError) return alert(idError);
    if (!name) return alert('Enter Warzone Username');

    const players = requireLoadedPlayers();
    if (!players) return;

    if (players[id]) {
        return alert(`Player ID ${id} is already registered as "${players[id].name}". Use "Update Settings" instead.`);
    }

    const repo = getRepoURL();
    // Format: "Signup: 12345 Name: MyName"
    const title = encodeURIComponent(`Signup: ${id} Name: ${name}`);
    const body = encodeURIComponent(`I want to join the ladder!`);

    window.open(`${repo}/issues/new?title=${title}&body=${body}`, '_blank');
}

function updateSettings() {
    const id = normalizePlayerId(document.getElementById('update-id').value);
    const cap = document.getElementById('update-cap').value;

    const idError = validatePlayerId(id);
    if (idError) return alert(idError);

    const players = requireLoadedPlayers();
    if (!players) return;

    if (!players[id]) {
        return alert(`Player ID ${id} is not registered. Use "Join Ladder" first.`);
    }

    const repo = getRepoURL();
    const title = encodeURIComponent(`Update: ${id} Cap: ${cap}`);
    const body = encodeURIComponent(`Updating my game cap.`);

    window.open(`${repo}/issues/new?title=${title}&body=${body}`, '_blank');
}

function removePlayer() {
    const id = normalizePlayerId(document.getElementById('remove-id').value);

    const idError = validatePlayerId(id);
    if (idError) return alert(idError);

    const players = requireLoadedPlayers();
    if (!players) return;

    if (!players[id]) {
        return alert(`Player ID ${id} was not found.`);
    }

    // Confirmation
    if (!confirm(`Are you sure you want to remove player ${id}?`)) return;

    const repo = getRepoURL();
    const title = encodeURIComponent(`Remove: ${id}`);
    const body = encodeURIComponent(`Please remove this player from the ladder.`);

    window.open(`${repo}/issues/new?title=${title}&body=${body}`, '_blank');
}

// Init
loadData();
