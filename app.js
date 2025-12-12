
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
        const [playersRes, gamesRes, historyRes] = await Promise.all([
            fetch('data/players.json'),
            fetch('data/active_games.json'),
            fetch('data/history.json')
        ]);

        const players = await playersRes.json();
        const games = await gamesRes.json();
        const history = await historyRes.json();

        renderLeaderboard(players);
        renderGames(games, players);
        renderHistory(history, players);
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
        // Main Row
        const row = document.createElement('tr');
        row.classList.add('player-row');
        row.onclick = () => toggleDetails(p.id);
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${p.name} ${p.missed_games >= 2 ? '<span class="status-warn">⚠️</span>' : ''}</td>
            <td>${p.elo}</td>
        `;
        tbody.appendChild(row);

        // Details Row
        const detailsRow = document.createElement('tr');
        detailsRow.id = `details-${p.id}`;
        detailsRow.classList.add('details-row');
        detailsRow.style.display = 'none';
        detailsRow.innerHTML = `
            <td colspan="3">
                <div class="player-details">
                    <p><strong>ID:</strong> ${p.id}</p>
                    <p><strong>Status:</strong> ${p.missed_games < 2 ? '✅ Reliable' : '⚠️ Unreliable (Missed >2 Games)'}</p>
                    <p><strong>Missed Games:</strong> ${p.missed_games}</p>
                    <p><strong>Game Cap:</strong> ${p.game_cap}</p>
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

function renderHistory(history, players) {
    const container = document.getElementById('history-list');
    container.innerHTML = '';

    // Filter: Only include valid games (not Timed Out or Terminated without result)
    // We look for games that have a winner_id OR are explicitly draws (though current logic usually sets winner_id).
    // The safest check is: Exclude games with "Timed Out" or "Terminated" in notes, IF they don't have a result.
    // Actually, referee props:
    // Void/Timeout: { game_id, finished_at, note: "Timed Out..." } -> No winner_id
    // Finished: { game_id, winner_id, loser_id, ... }

    const validGames = history
        .filter(h => h.winner_id || (h.note && !h.note.includes('Timed Out') && !h.note.includes('Terminated')))
        .reverse() // Newest first
        .slice(0, 20); // Limit to last 20

    if (validGames.length === 0) {
        container.innerHTML = '<p>No recent history.</p>';
        return;
    }

    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>Winner</th>
                <th>Loser</th>
                <th>Date</th>
                <th>Link</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    validGames.forEach(g => {
        const winner = players[g.winner_id] ? players[g.winner_id].name : (g.winner_id || 'Draw');
        const loser = players[g.loser_id] ? players[g.loser_id].name : (g.loser_id || '-');
        const date = new Date(g.finished_at).toLocaleDateString();

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${winner}</strong></td>
            <td>${loser}</td>
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
