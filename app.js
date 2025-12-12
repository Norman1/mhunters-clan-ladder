
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
        const [playersRes, gamesRes] = await Promise.all([
            fetch('data/players.json'),
            fetch('data/active_games.json')
        ]);

        const players = await playersRes.json();
        const games = await gamesRes.json();

        renderLeaderboard(players);
        renderGames(games, players);
    } catch (err) {
        console.error('Error loading data:', err);
        document.querySelector('main').innerHTML += `<p style="color:red">Error loading data. Is this hosted correctly?</p>`;
    }
}

function renderLeaderboard(players) {
    const tbody = document.getElementById('leaderboard-body');
    tbody.innerHTML = '';

    const list = Object.entries(players)
        .map(([id, p]) => ({ ...p, id })) // Inject ID into object
        .sort((a, b) => b.elo - a.elo);

    list.forEach((p, index) => {
        const row = document.createElement('tr');
        // Player ID is the key in the object, but we are iterating over values.
        // We need to make sure 'p' has the ID or we find it. 
        // Wait, Object.values(players) loses the key if it's not in the object.
        // Let's refactor the sort to keep keys.

        row.innerHTML = `
            <td>${index + 1}</td>
            <td><small>${p.id || '?'}</small></td> 
            <td>${p.name} ${!p.active ? '<span class="offline">(Inactive)</span>' : ''}</td>
            <td>${p.elo}</td>
            <td>${p.missed_games > 0 ? `⚠️ ${p.missed_games} Missed` : 'OK'}</td>
        `;
        tbody.appendChild(row);
    });
}

function renderGames(games, players) {
    const container = document.getElementById('games-list');
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

function joinLadder() {
    const name = document.getElementById('join-name').value;
    const id = document.getElementById('join-id').value;

    if (!id) return alert('Enter Player ID');
    if (!name) return alert('Enter Warzone Username');

    const repo = getRepoURL();
    // Format: "Signup: 12345 Name: MyName"
    const title = encodeURIComponent(`Signup: ${id} Name: ${name}`);
    const body = encodeURIComponent(`I want to join the ladder!`);

    window.open(`${repo}/issues/new?title=${title}&body=${body}`, '_blank');
}

function updateSettings() {
    const id = document.getElementById('update-id').value;
    const cap = document.getElementById('update-cap').value;

    if (!id) return alert('Enter Player ID');

    const repo = getRepoURL();
    const title = encodeURIComponent(`Update: ${id} Cap: ${cap}`);
    const body = encodeURIComponent(`Updating my game cap.`);

    window.open(`${repo}/issues/new?title=${title}&body=${body}`, '_blank');
}

function removePlayer() {
    const id = document.getElementById('remove-id').value;
    if (!id) return alert('Enter Player ID');

    // Confirmation
    if (!confirm(`Are you sure you want to remove player ${id}?`)) return;

    const repo = getRepoURL();
    const title = encodeURIComponent(`Remove: ${id}`);
    const body = encodeURIComponent(`Please remove this player from the ladder.`);

    window.open(`${repo}/issues/new?title=${title}&body=${body}`, '_blank');
}

// Init
loadData();
