
const REPO_OWNER = 'norman'; // TODO: Change this to actual owner if known, or make dynamic?

// Helper to get repo URL
function getRepoURL() {
    const host = window.location.hostname;
    if (host.includes('github.io')) {
        const user = host.split('.')[0];
        const repo = window.location.pathname.split('/')[1];
        return `https://github.com/${user}/${repo}`;
    }
    return 'https://github.com/YOUR_USER/YOUR_REPO'; // Fallback
}

// ─── Utility Functions ───

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(isoString) {
    if (!isoString) return 'N/A';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'N/A';
    const now = new Date();
    const month = MONTH_NAMES[d.getUTCMonth()];
    const day = d.getUTCDate();
    const year = d.getUTCFullYear();
    const dateStr = `${month} ${day}, ${year}`;
    // If today (UTC), append time
    if (d.getUTCFullYear() === now.getUTCFullYear() &&
        d.getUTCMonth() === now.getUTCMonth() &&
        d.getUTCDate() === now.getUTCDate()) {
        let h = d.getUTCHours();
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        const min = String(d.getUTCMinutes()).padStart(2, '0');
        const sec = String(d.getUTCSeconds()).padStart(2, '0');
        return `${dateStr} ${h}:${min}:${sec} ${ampm} UTC`;
    }
    return dateStr;
}

function getStreakBuff(streak) {
    if (!streak || !streak.type || streak.count < 3) return { tier: 0, emojis: '', cssClass: '' };
    const c = streak.count;
    if (streak.type === 'W') {
        if (c >= 50) return { tier: 5, emojis: '\uD83D\uDD25\uD83D\uDD25\uD83D\uDD25\uD83D\uDD25\uD83D\uDD25', cssClass: 'streak-hot-5' };
        if (c >= 25) return { tier: 4, emojis: '\uD83D\uDD25\uD83D\uDD25\uD83D\uDD25\uD83D\uDD25', cssClass: 'streak-hot-4' };
        if (c >= 10) return { tier: 3, emojis: '\uD83D\uDD25\uD83D\uDD25\uD83D\uDD25', cssClass: 'streak-hot-3' };
        if (c >= 5)  return { tier: 2, emojis: '\uD83D\uDD25\uD83D\uDD25', cssClass: 'streak-hot-2' };
        return { tier: 1, emojis: '\uD83D\uDD25', cssClass: 'streak-hot-1' };
    } else {
        if (c >= 50) return { tier: 5, emojis: '\u2744\uFE0F\u2744\uFE0F\u2744\uFE0F\u2744\uFE0F\u2744\uFE0F', cssClass: 'streak-cold-5' };
        if (c >= 25) return { tier: 4, emojis: '\u2744\uFE0F\u2744\uFE0F\u2744\uFE0F\u2744\uFE0F', cssClass: 'streak-cold-4' };
        if (c >= 10) return { tier: 3, emojis: '\u2744\uFE0F\u2744\uFE0F\u2744\uFE0F', cssClass: 'streak-cold-3' };
        if (c >= 5)  return { tier: 2, emojis: '\u2744\uFE0F\u2744\uFE0F', cssClass: 'streak-cold-2' };
        return { tier: 1, emojis: '\u2744\uFE0F', cssClass: 'streak-cold-1' };
    }
}

// Format turn for active games using game_state and numberOfTurns
function formatTurn(apiValue, gameState) {
    if (gameState === 'WaitingForPlayers') return 'Waiting to Start';
    if (gameState === 'DistributingTerritories') return 'Distributing';
    if (apiValue == null) return '-';
    if (apiValue < 0) return '-';
    return apiValue + 1; // 0 → Turn 1, 1 → Turn 2, etc.
}

// Format turns for completed games: same offset, -2/-1 shouldn't appear but handle gracefully
function formatTurnsCompleted(apiValue) {
    if (apiValue == null) return '-';
    if (apiValue <= 0) return '-';
    return apiValue + 1;
}

function isVoidGame(entry) {
    const note = entry.note || '';
    return note === 'Timed Out (Lobby)' || note === 'Declined' || note === 'Terminated';
}

function calculateEloClient(winnerElo, loserElo) {
    const K = 40;
    const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
    const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));
    const newWinnerElo = Math.round(winnerElo + K * (1 - expectedWinner));
    const newLoserElo = Math.round(loserElo + K * (0 - expectedLoser));
    return { newWinnerElo, newLoserElo, change: newWinnerElo - winnerElo };
}

function createPaginator(items, pageSize) {
    const paginator = {
        items: items,
        pageSize: pageSize,
        page: 1,
        get total() { return Math.max(1, Math.ceil(this.items.length / this.pageSize)); },
        get hasNext() { return this.page < this.total; },
        get hasPrev() { return this.page > 1; },
        getPage() {
            const start = (this.page - 1) * this.pageSize;
            return this.items.slice(start, start + this.pageSize);
        },
        next() { if (this.hasNext) this.page++; },
        prev() { if (this.hasPrev) this.page--; }
    };
    return paginator;
}

function buildMatchupTds(p1Name, p2Name, p1EloHtml, p2EloHtml, p1CellClass, p2CellClass, gameId) {
    const p1Content = p1EloHtml
        ? `<span class="name-text">${p1Name}</span><br><span>${p1EloHtml}</span>`
        : `<span class="name-text">${p1Name}</span>`;
    const p2Content = p2EloHtml
        ? `<span class="name-text">${p2Name}</span><br><span>${p2EloHtml}</span>`
        : `<span class="name-text">${p2Name}</span>`;
    const vsContent = gameId
        ? `<a href="https://www.warzone.com/MultiPlayer?GameID=${gameId}" target="_blank" class="vs-link">vs</a>`
        : 'vs';
    return `
        <td class="mu-p1 ${p1CellClass}">${p1Content}</td>
        <td class="mu-vs">${vsContent}</td>
        <td class="mu-p2 ${p2CellClass}">${p2Content}</td>
    `;
}

function buildResultRow(game, players) {
    const p1Id = game.p1_id || game.winner_id || '?';
    const p2Id = game.p2_id || game.loser_id || '?';
    const p1Name = players[p1Id] ? players[p1Id].name : p1Id;
    const p2Name = players[p2Id] ? players[p2Id].name : p2Id;

    const mapName = (window.templates && window.templates[game.template_id])
        ? window.templates[game.template_id].name
        : (game.template_id || '-');

    let p1CellClass = '', p2CellClass = '', p1Elo = '', p2Elo = '';

    if (game.note === 'Draw' || !game.winner_id) {
        p1CellClass = 'cell-draw';
        p2CellClass = 'cell-draw';
    } else {
        const eloChange = game.elo_change || 0;
        if (String(game.winner_id) === String(p1Id)) {
            p1CellClass = 'cell-win';
            p2CellClass = 'cell-loss';
            if (eloChange) {
                p1Elo = `<span class="elo-change elo-change--pos">+${eloChange}</span>`;
                p2Elo = `<span class="elo-change elo-change--neg">-${eloChange}</span>`;
            }
        } else if (String(game.winner_id) === String(p2Id)) {
            p1CellClass = 'cell-loss';
            p2CellClass = 'cell-win';
            if (eloChange) {
                p1Elo = `<span class="elo-change elo-change--neg">-${eloChange}</span>`;
                p2Elo = `<span class="elo-change elo-change--pos">+${eloChange}</span>`;
            }
        }
    }

    const turns = formatTurnsCompleted(game.turns);
    const tr = document.createElement('tr');
    tr.innerHTML = `
        ${buildMatchupTds(p1Name, p2Name, p1Elo, p2Elo, p1CellClass, p2CellClass, game.game_id)}
        <td>${mapName}</td>
        <td>${turns}</td>
        <td>${formatDate(game.finished_at)}</td>
    `;
    return tr;
}

function buildPaginationControls(paginator, renderCallback) {
    const div = document.createElement('div');
    div.className = 'pagination';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'pagination__btn';
    prevBtn.textContent = 'Prev';
    prevBtn.disabled = !paginator.hasPrev;
    prevBtn.onclick = () => { paginator.prev(); renderCallback(); };

    const info = document.createElement('span');
    info.className = 'pagination__info';
    info.textContent = `Page ${paginator.page} of ${paginator.total}`;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'pagination__btn';
    nextBtn.textContent = 'Next';
    nextBtn.disabled = !paginator.hasNext;
    nextBtn.onclick = () => { paginator.next(); renderCallback(); };

    div.appendChild(prevBtn);
    div.appendChild(info);
    div.appendChild(nextBtn);
    return div;
}

// ─── Computation Functions ───

function calculateRankChanges(players, history) {
    const changes = new Map();
    const allPlayers = Object.entries(players).map(([id, p]) => ({ id, ...p }));

    // Current ranks (active only)
    const currentActive = allPlayers
        .filter(p => p.game_cap > 0 && p.missed_games < 2)
        .sort((a, b) => b.elo - a.elo);
    const currentRanks = new Map();
    currentActive.forEach((p, i) => currentRanks.set(p.id, i + 1));

    // Build ELO deltas from last 7 days of history
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentGames = history.filter(g => {
        if (!g.finished_at || isVoidGame(g)) return false;
        return new Date(g.finished_at).getTime() >= sevenDaysAgo;
    });

    // Track cumulative ELO changes per player from recent games
    const eloDeltas = {};
    recentGames.forEach(g => {
        if (!g.winner_id || !g.elo_change) return;
        const change = g.elo_change;
        const winnerId = String(g.winner_id);
        const loserId = g.loser_id ? String(g.loser_id) : null;
        eloDeltas[winnerId] = (eloDeltas[winnerId] || 0) + change;
        if (loserId) eloDeltas[loserId] = (eloDeltas[loserId] || 0) - change;
    });

    // Reconstruct previous ELO by undoing recent changes
    const previousElos = {};
    allPlayers.forEach(p => {
        previousElos[p.id] = p.elo - (eloDeltas[p.id] || 0);
    });

    // Previous ranks
    const previousActive = allPlayers
        .filter(p => p.game_cap > 0 && p.missed_games < 2)
        .map(p => ({ id: p.id, elo: previousElos[p.id] }))
        .sort((a, b) => b.elo - a.elo);
    const previousRanks = new Map();
    previousActive.forEach((p, i) => previousRanks.set(p.id, i + 1));

    // Calculate changes
    allPlayers.forEach(p => {
        const curr = currentRanks.get(p.id);
        const prev = previousRanks.get(p.id);

        if (curr && !prev) {
            // Newly ranked
            changes.set(p.id, { change: 'NEW' });
        } else if (curr && prev) {
            changes.set(p.id, { change: prev - curr }); // positive = moved up
        } else {
            changes.set(p.id, { change: 0 });
        }
    });

    return changes;
}

function calculateStreaks(players, history) {
    const streaks = new Map();

    // Sort history newest first (by finished_at)
    const sorted = [...history]
        .filter(g => !isVoidGame(g) && (g.winner_id || g.note === 'Draw'))
        .sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at));

    // For each player, walk their games newest-first
    Object.keys(players).forEach(pid => {
        const playerGames = sorted.filter(g =>
            String(g.p1_id) === String(pid) || String(g.p2_id) === String(pid) ||
            String(g.winner_id) === String(pid) || String(g.loser_id) === String(pid)
        );

        if (playerGames.length === 0) {
            streaks.set(pid, { type: null, count: 0 });
            return;
        }

        let streakType = null;
        let count = 0;

        for (const g of playerGames) {
            if (g.note === 'Draw' || !g.winner_id) {
                // Draw resets streak
                if (streakType === null) {
                    streaks.set(pid, { type: null, count: 0 });
                    return;
                }
                break;
            }

            const isWinner = String(g.winner_id) === String(pid);
            const thisType = isWinner ? 'W' : 'L';

            if (streakType === null) {
                streakType = thisType;
                count = 1;
            } else if (thisType === streakType) {
                count++;
            } else {
                break;
            }
        }

        streaks.set(pid, { type: streakType, count });
    });

    return streaks;
}

function calculateLast10(players, history, filterTemplateId) {
    const results = new Map();
    const sorted = [...history]
        .filter(g => {
            if (isVoidGame(g)) return false;
            if (!(g.winner_id || g.note === 'Draw')) return false;
            if (filterTemplateId && String(g.template_id) !== String(filterTemplateId)) return false;
            return true;
        })
        .sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at));

    Object.keys(players).forEach(pid => {
        const playerGames = sorted.filter(g =>
            String(g.p1_id) === String(pid) || String(g.p2_id) === String(pid) ||
            String(g.winner_id) === String(pid) || String(g.loser_id) === String(pid)
        ).slice(0, 10);

        let wins = 0, losses = 0, draws = 0;
        playerGames.forEach(g => {
            if (g.note === 'Draw' || !g.winner_id) { draws++; }
            else if (String(g.winner_id) === String(pid)) { wins++; }
            else { losses++; }
        });
        results.set(pid, { wins, losses, draws, total: playerGames.length });
    });
    return results;
}

function calculateTemplateElo(history, templateId) {
    const templateGames = history
        .filter(g => String(g.template_id) === String(templateId) && !isVoidGame(g) && g.winner_id)
        .sort((a, b) => new Date(a.finished_at) - new Date(b.finished_at)); // chronological

    const elos = {};
    const records = {};

    templateGames.forEach(g => {
        const wId = String(g.winner_id);
        const lId = g.loser_id ? String(g.loser_id) : null;

        if (!elos[wId]) { elos[wId] = 1000; records[wId] = { wins: 0, losses: 0 }; }
        if (lId && !elos[lId]) { elos[lId] = 1000; records[lId] = { wins: 0, losses: 0 }; }

        if (lId) {
            const { newWinnerElo, newLoserElo } = calculateEloClient(elos[wId], elos[lId]);
            elos[wId] = newWinnerElo;
            elos[lId] = newLoserElo;
            records[wId].wins++;
            records[lId].losses++;
        }
    });

    // Handle draws — count players involved but no ELO change
    history
        .filter(g => String(g.template_id) === String(templateId) && g.note === 'Draw')
        .forEach(g => {
            [g.p1_id, g.p2_id].forEach(pid => {
                if (pid) {
                    const id = String(pid);
                    if (!elos[id]) { elos[id] = 1000; records[id] = { wins: 0, losses: 0 }; }
                }
            });
        });

    return Object.entries(elos)
        .map(([playerId, elo]) => ({
            playerId,
            elo,
            wins: records[playerId] ? records[playerId].wins : 0,
            losses: records[playerId] ? records[playerId].losses : 0
        }))
        .sort((a, b) => b.elo - a.elo);
}

// ─── Data Loading ───

async function loadData() {
    try {
        const cacheBust = '?v=' + Date.now();
        const [playersRes, gamesRes, historyRes, templatesRes] = await Promise.all([
            fetch('data/players.json' + cacheBust),
            fetch('data/active_games.json' + cacheBust),
            fetch('data/history.json' + cacheBust),
            fetch('data/templates.json' + cacheBust)
        ]);

        if (![playersRes, gamesRes, historyRes, templatesRes].every(r => r.ok)) {
            throw new Error('One or more data files failed to load.');
        }

        const players = await playersRes.json();
        const games = await gamesRes.json();
        const ladderHistory = await historyRes.json();
        const templates = await templatesRes.json();

        window.players = players;
        window.ladderHistory = ladderHistory;

        // Map Templates by ID for easy lookup
        window.templates = {};
        window.templatesArray = templates;
        templates.forEach(t => {
            window.templates[t.id] = t;
        });

        // Route based on current page
        const page = window.location.pathname.split('/').pop() || 'index.html';

        if (page === 'index.html' || page === '' || page === '/') {
            renderLeaderboard(players, ladderHistory);
            renderGamesResults(ladderHistory, players);
            renderGamesLive(games, players);
            // Default to Results tab
            switchGamesTab('results');
        } else if (page === 'history.html') {
            renderHistory(ladderHistory, players);
        } else if (page === 'templates.html') {
            renderTemplateCards(templates);
        } else if (page === 'template.html') {
            const params = new URLSearchParams(window.location.search);
            const templateId = params.get('id');
            if (templateId) {
                renderTemplateDetail(templateId, games, ladderHistory, players);
            } else {
                const heading = document.getElementById('template-heading');
                if (heading) heading.textContent = 'Template not found';
                const gamesEl = document.getElementById('template-games');
                if (gamesEl) gamesEl.innerHTML = '<p>No template ID specified in URL.</p>';
                const recordsEl = document.getElementById('template-records');
                if (recordsEl) recordsEl.innerHTML = '';
            }
        } else if (page === 'actions.html') {
            renderTemplates(templates);
        }
    } catch (err) {
        console.error('Error loading data:', err);
        document.querySelector('main').innerHTML += `<p style="color:red">Error loading data. Is this hosted correctly?</p>`;
    }
}

// ─── Leaderboard (Phase 4) ───

function renderLeaderboard(players, history) {
    const tbody = document.getElementById('leaderboard-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Set last-updated from most recent history entry
    const lastUpdatedEl = document.getElementById('last-updated');
    if (lastUpdatedEl && history.length > 0) {
        const mostRecent = history.reduce((latest, g) => {
            if (!g.finished_at) return latest;
            const t = new Date(g.finished_at).getTime();
            return t > latest ? t : latest;
        }, 0);
        if (mostRecent > 0) {
            const d = new Date(mostRecent);
            const now = Date.now();
            const diffMs = now - mostRecent;
            const diffH = Math.floor(diffMs / (1000 * 60 * 60));
            const diffM = Math.floor(diffMs / (1000 * 60));
            let ago;
            if (diffM < 1) ago = 'just now';
            else if (diffM < 60) ago = `${diffM}m ago`;
            else if (diffH < 24) ago = `${diffH}h ago`;
            else ago = `${Math.floor(diffH / 24)}d ago`;
            lastUpdatedEl.textContent = `Updated ${ago}`;
        }
    }

    const rankChanges = calculateRankChanges(players, history);
    const streaks = calculateStreaks(players, history);
    const last10 = calculateLast10(players, history);

    const allPlayers = Object.entries(players).map(([id, p]) => ({ ...p, id }));
    const active = allPlayers.filter(p => p.game_cap > 0 && p.missed_games < 2).sort((a, b) => b.elo - a.elo);
    const unranked = allPlayers.filter(p => p.game_cap == 0 || p.missed_games >= 2).sort((a, b) => b.elo - a.elo);
    const list = [...active, ...unranked];

    list.forEach((p) => {
        const isActive = p.game_cap > 0 && p.missed_games < 2;
        let rankDisplay;
        const activeIndex = active.indexOf(p);
        if (!isActive) {
            rankDisplay = '<span style="color: grey; font-style: italic;">Unranked</span>';
        } else if (activeIndex !== -1) {
            const rank = activeIndex + 1;
            if (rank === 1) rankDisplay = '<span class="rank-medal rank-gold">1</span>';
            else if (rank === 2) rankDisplay = '<span class="rank-medal rank-silver">2</span>';
            else if (rank === 3) rankDisplay = '<span class="rank-medal rank-bronze">3</span>';
            else rankDisplay = `<span class="rank-num">${rank}</span>`;
        } else {
            rankDisplay = '<span class="rank-num" style="color: grey; font-style: italic; width: auto;">Unranked</span>';
        }

        // Rank change
        const rc = rankChanges.get(p.id) || { change: 0 };
        let changeHtml;
        if (rc.change === 'NEW') {
            changeHtml = '<span class="rank-new">NEW</span>';
        } else if (rc.change > 0) {
            changeHtml = `<span class="rank-up">&#9650; ${rc.change}</span>`;
        } else if (rc.change < 0) {
            changeHtml = `<span class="rank-down">&#9660; ${Math.abs(rc.change)}</span>`;
        } else {
            changeHtml = '<span class="rank-same">-</span>';
        }

        // Streak + buff (only active players get buffs)
        const s = streaks.get(p.id) || { type: null, count: 0 };
        const buff = isActive ? getStreakBuff(s) : { tier: 0, emojis: '', cssClass: '' };
        let streakHtml;
        if (s.type === 'W' && s.count > 0) {
            streakHtml = `<span class="streak-win">W${s.count}</span>`;
        } else if (s.type === 'L' && s.count > 0) {
            streakHtml = `<span class="streak-loss">L${s.count}</span>`;
        } else {
            streakHtml = '<span class="streak-none">-</span>';
        }

        // Emojis only to the RIGHT of the name
        const nameDisplay = buff.emojis ? `${p.name} ${buff.emojis}` : p.name;

        // Last 10
        const l10 = last10.get(p.id) || { wins: 0, losses: 0, draws: 0, total: 0 };
        const last10Html = l10.total > 0
            ? `${l10.wins}-${l10.losses}${l10.draws ? '-' + l10.draws : ''}`
            : '-';

        // Main Row
        const row = document.createElement('tr');
        row.classList.add('player-row');
        if (buff.cssClass) row.classList.add(buff.cssClass);
        row.onclick = () => toggleDetails(p.id);
        row.innerHTML = `
            <td>${rankDisplay}</td>
            <td>${changeHtml}</td>
            <td>${nameDisplay}</td>
            <td>${p.elo}</td>
            <td>${streakHtml}</td>
            <td>${last10Html}</td>
        `;
        tbody.appendChild(row);

        // Details Row
        const detailsRow = document.createElement('tr');
        detailsRow.id = `details-${p.id}`;
        detailsRow.classList.add('details-row');
        detailsRow.style.display = 'none';

        const lastOpponentName = p.last_opponent
            ? (players[p.last_opponent] ? players[p.last_opponent].name : p.last_opponent)
            : 'None';

        detailsRow.innerHTML = `
            <td colspan="6">
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
    if (!row) return;
    if (row.style.display === 'none') {
        row.style.display = 'table-row';
    } else {
        row.style.display = 'none';
    }
}

// ─── Games Section — Results/Live Toggle (Phase 5) ───

function switchGamesTab(tab) {
    const resultsBtn = document.getElementById('tab-results');
    const liveBtn = document.getElementById('tab-live');
    const resultsView = document.getElementById('games-results-view');
    const liveView = document.getElementById('games-live-view');
    if (!resultsBtn || !liveBtn || !resultsView || !liveView) return;

    const eyebrow = document.getElementById('games-eyebrow');
    const heading = document.getElementById('games-heading');

    if (tab === 'results') {
        resultsBtn.classList.add('active');
        liveBtn.classList.remove('active');
        resultsView.style.display = 'block';
        liveView.style.display = 'none';
        if (eyebrow) eyebrow.textContent = 'Match Results';
        if (heading) heading.textContent = 'Completed Games';
    } else {
        liveBtn.classList.add('active');
        resultsBtn.classList.remove('active');
        resultsView.style.display = 'none';
        liveView.style.display = 'block';
        if (eyebrow) eyebrow.textContent = 'Matches';
        if (heading) heading.textContent = 'Currently Active';
    }
}

let resultsPaginator = null;

function renderGamesResults(history, players) {
    const container = document.getElementById('games-results-view');
    if (!container) return;

    const validGames = history
        .filter(h => !isVoidGame(h) && (h.winner_id || h.note === 'Draw'))
        .reverse(); // newest first

    if (validGames.length === 0) {
        container.innerHTML = '<p>No results yet.</p>';
        return;
    }

    resultsPaginator = createPaginator(validGames, 20);

    function renderPage() {
        container.innerHTML = '';
        const table = document.createElement('table');
        table.innerHTML = `
            <thead>
                <tr>
                    <th colspan="3">Matchup</th>
                    <th>Template</th>
                    <th>Turns</th>
                    <th>Date</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');
        resultsPaginator.getPage().forEach(g => {
            tbody.appendChild(buildResultRow(g, players));
        });
        container.appendChild(table);
        if (resultsPaginator.total > 1) {
            container.appendChild(buildPaginationControls(resultsPaginator, renderPage));
        }
    }

    renderPage();
}

function renderGamesLive(games, players) {
    const container = document.getElementById('games-live-view');
    if (!container) return;
    container.innerHTML = '';

    if (games.length === 0) {
        container.innerHTML = '<p>No active games.</p>';
        return;
    }

    // Sort by status: Playing (highest turn first), then Distributing, then WaitingForPlayers
    const stateOrder = { 'Playing': 0, 'Finished': 0, 'DistributingTerritories': 1, 'WaitingForPlayers': 2 };
    const sorted = [...games].sort((a, b) => {
        const aOrder = stateOrder[a.game_state] ?? 1.5;
        const bOrder = stateOrder[b.game_state] ?? 1.5;
        if (aOrder !== bOrder) return aOrder - bOrder;
        // Within same state, highest turn first (for Playing), newest first otherwise
        if (aOrder === 0) return (b.current_turn || 0) - (a.current_turn || 0);
        return new Date(b.created_at) - new Date(a.created_at);
    });

    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th colspan="3">Matchup</th>
                <th>Template</th>
                <th>Turn</th>
                <th>Started</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    sorted.forEach(g => {
        const p1 = players[g.p1_id] ? players[g.p1_id].name : g.p1_id;
        const p2 = players[g.p2_id] ? players[g.p2_id].name : g.p2_id;
        const mapName = (window.templates && window.templates[g.template_id])
            ? window.templates[g.template_id].name
            : (g.template_id || '-');

        const turn = formatTurn(g.current_turn, g.game_state);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            ${buildMatchupTds(p1, p2, '', '', '', '', g.game_id)}
            <td>${mapName}</td>
            <td>${turn}</td>
            <td>${formatDate(g.created_at)}</td>
        `;
        tbody.appendChild(tr);
    });

    container.appendChild(table);
}

// ─── History Page (Phase 6) ───

let historyPaginator = null;

function renderHistory(history, players) {
    const container = document.getElementById('history-list');
    if (!container) return;

    const validGames = history
        .filter(h => !isVoidGame(h) && (h.winner_id || h.note === 'Draw'))
        .reverse();

    if (validGames.length === 0) {
        container.innerHTML = '<p>No history available yet.</p>';
        return;
    }

    historyPaginator = createPaginator(validGames, 20);

    function renderPage() {
        container.innerHTML = '';
        const table = document.createElement('table');
        table.innerHTML = `
            <thead>
                <tr>
                    <th colspan="3">Matchup</th>
                    <th>Template</th>
                    <th>Turns</th>
                    <th>Date</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');
        historyPaginator.getPage().forEach(g => {
            tbody.appendChild(buildResultRow(g, players));
        });
        container.appendChild(table);
        if (historyPaginator.total > 1) {
            container.appendChild(buildPaginationControls(historyPaginator, renderPage));
        }
    }

    renderPage();
}

// ─── Templates Listing Page (Phase 8) ───

function renderTemplateCards(templates) {
    const container = document.getElementById('template-grid');
    if (!container) return;
    container.innerHTML = '';

    if (!templates || templates.length === 0) {
        container.innerHTML = '<p>No templates configured.</p>';
        return;
    }

    templates.forEach(t => {
        const card = document.createElement('a');
        card.className = 'template-card';
        card.href = `template.html?id=${t.id}`;
        card.textContent = t.name;
        container.appendChild(card);
    });
}

// ─── Template Detail Page (Phase 9) ───

function renderTemplateDetail(templateId, games, history, players) {
    const template = window.templates[templateId];
    if (!template) {
        document.querySelector('main').innerHTML = '<p style="color:red">Template not found.</p>';
        return;
    }

    // Set heading
    const heading = document.getElementById('template-heading');
    if (heading) {
        heading.innerHTML = `${template.name} <a class="link-chip" href="https://www.warzone.com/MultiPlayer?TemplateID=${templateId}" target="_blank">View on Warzone</a>`;
    }

    // Render leaderboard first, then games
    renderTemplatePlayerRecords(templateId, history, players);
    renderTemplateGames(templateId, games, history, players);
}

function renderTemplateGames(templateId, games, history, players) {
    const container = document.getElementById('template-games');
    if (!container) return;
    container.innerHTML = '';

    // Active games for this template
    const activeGames = games
        .filter(g => String(g.template_id) === String(templateId))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Completed games for this template
    const completedGames = history
        .filter(g => String(g.template_id) === String(templateId) && !isVoidGame(g) && (g.winner_id || g.note === 'Draw'))
        .sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at));

    const allGames = [...activeGames.map(g => ({ ...g, _isLive: true })), ...completedGames];

    if (allGames.length === 0) {
        container.innerHTML = '<p>No games for this template yet.</p>';
        return;
    }

    const paginator = createPaginator(allGames, 20);

    function renderPage() {
        container.innerHTML = '';
        const table = document.createElement('table');
        table.innerHTML = `
            <thead>
                <tr>
                    <th colspan="3">Matchup</th>
                    <th>Status</th>
                    <th>Turns</th>
                    <th>Date</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');

        paginator.getPage().forEach(g => {
            if (g._isLive) {
                const p1 = players[g.p1_id] ? players[g.p1_id].name : g.p1_id;
                const p2 = players[g.p2_id] ? players[g.p2_id].name : g.p2_id;
                const turn = formatTurn(g.current_turn, g.game_state);
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    ${buildMatchupTds(p1, p2, '', '', '', '', g.game_id)}
                    <td><span class="chip chip--live">Active</span></td>
                    <td>${turn}</td>
                    <td>${formatDate(g.created_at)}</td>
                `;
                tbody.appendChild(tr);
            } else {
                const p1Id = g.p1_id || g.winner_id || '?';
                const p2Id = g.p2_id || g.loser_id || '?';
                const p1Name = players[p1Id] ? players[p1Id].name : p1Id;
                const p2Name = players[p2Id] ? players[p2Id].name : p2Id;

                let p1CellClass = '', p2CellClass = '', p1Elo = '', p2Elo = '';
                if (g.note === 'Draw' || !g.winner_id) {
                    p1CellClass = 'cell-draw';
                    p2CellClass = 'cell-draw';
                } else {
                    const eloChange = g.elo_change || 0;
                    if (String(g.winner_id) === String(p1Id)) {
                        p1CellClass = 'cell-win';
                        p2CellClass = 'cell-loss';
                        if (eloChange) {
                            p1Elo = `<span class="elo-change elo-change--pos">+${eloChange}</span>`;
                            p2Elo = `<span class="elo-change elo-change--neg">-${eloChange}</span>`;
                        }
                    } else {
                        p1CellClass = 'cell-loss';
                        p2CellClass = 'cell-win';
                        if (eloChange) {
                            p1Elo = `<span class="elo-change elo-change--neg">-${eloChange}</span>`;
                            p2Elo = `<span class="elo-change elo-change--pos">+${eloChange}</span>`;
                        }
                    }
                }

                const statusText = g.note === 'Draw' ? 'Draw' : 'Finished';
                const turns = formatTurnsCompleted(g.turns);
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    ${buildMatchupTds(p1Name, p2Name, p1Elo, p2Elo, p1CellClass, p2CellClass, g.game_id)}
                    <td>${statusText}</td>
                    <td>${turns}</td>
                    <td>${formatDate(g.finished_at)}</td>
                `;
                tbody.appendChild(tr);
            }
        });

        container.appendChild(table);
        if (paginator.total > 1) {
            container.appendChild(buildPaginationControls(paginator, renderPage));
        }
    }

    renderPage();
}

function renderTemplatePlayerRecords(templateId, history, players) {
    const container = document.getElementById('template-records');
    if (!container) return;
    container.innerHTML = '';

    const records = calculateTemplateElo(history, templateId);

    if (records.length === 0) {
        container.innerHTML = '<p>No player records for this template yet.</p>';
        return;
    }

    // Calculate streaks and last 10 per template
    const templateHistory = history.filter(g => String(g.template_id) === String(templateId));
    const templatePlayersMap = Object.fromEntries(records.map(r => [r.playerId, players[r.playerId] || { name: r.playerId }]));
    const templateStreaks = calculateStreaks(templatePlayersMap, templateHistory);
    const templateLast10 = calculateLast10(templatePlayersMap, history, templateId);

    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>#</th>
                <th>Player</th>
                <th>ELO</th>
                <th>W-L</th>
                <th>Streak</th>
                <th>Last 10</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    records.forEach((r, i) => {
        const playerName = players[r.playerId] ? players[r.playerId].name : r.playerId;
        const playerData = players[r.playerId];
        const isActive = playerData && playerData.game_cap > 0 && playerData.missed_games < 2;

        // Streak + buff (only active players get buffs)
        const s = templateStreaks.get(r.playerId) || { type: null, count: 0 };
        const buff = isActive ? getStreakBuff(s) : { tier: 0, emojis: '', cssClass: '' };
        let streakHtml;
        if (s.type === 'W' && s.count > 0) {
            streakHtml = `<span class="streak-win">W${s.count}</span>`;
        } else if (s.type === 'L' && s.count > 0) {
            streakHtml = `<span class="streak-loss">L${s.count}</span>`;
        } else {
            streakHtml = '<span class="streak-none">-</span>';
        }

        // Rank display with medal for top 3
        const rank = i + 1;
        let rankDisplay;
        if (rank === 1) rankDisplay = '<span class="rank-medal rank-gold">1</span>';
        else if (rank === 2) rankDisplay = '<span class="rank-medal rank-silver">2</span>';
        else if (rank === 3) rankDisplay = '<span class="rank-medal rank-bronze">3</span>';
        else rankDisplay = `<span class="rank-num">${rank}</span>`;

        // Emojis only to the RIGHT of the name
        const nameDisplay = buff.emojis ? `${playerName} ${buff.emojis}` : playerName;

        // Last 10 for this template
        const l10 = templateLast10.get(r.playerId) || { wins: 0, losses: 0, draws: 0, total: 0 };
        const last10Html = l10.total > 0
            ? `${l10.wins}-${l10.losses}${l10.draws ? '-' + l10.draws : ''}`
            : '-';

        const row = document.createElement('tr');
        row.classList.add('player-row');
        if (buff.cssClass) row.classList.add(buff.cssClass);
        row.onclick = () => toggleTemplatePlayerGames(r.playerId, templateId, history, players);
        row.innerHTML = `
            <td>${rankDisplay}</td>
            <td>${nameDisplay}</td>
            <td>${r.elo}</td>
            <td>${r.wins}-${r.losses}</td>
            <td>${streakHtml}</td>
            <td>${last10Html}</td>
        `;
        tbody.appendChild(row);

        // Expandable detail row
        const detailsRow = document.createElement('tr');
        detailsRow.id = `template-player-${r.playerId}`;
        detailsRow.classList.add('details-row');
        detailsRow.style.display = 'none';
        detailsRow.innerHTML = `<td colspan="6"><div class="player-details" id="template-player-games-${r.playerId}"></div></td>`;
        tbody.appendChild(detailsRow);
    });

    container.appendChild(table);
}

function toggleTemplatePlayerGames(playerId, templateId, history, players) {
    const row = document.getElementById(`template-player-${playerId}`);
    if (!row) return;

    if (row.style.display === 'table-row') {
        row.style.display = 'none';
        return;
    }

    row.style.display = 'table-row';
    const container = document.getElementById(`template-player-games-${playerId}`);
    if (!container) return;

    // Already populated?
    if (container.children.length > 0) return;

    const playerGames = history
        .filter(g =>
            String(g.template_id) === String(templateId) &&
            !isVoidGame(g) &&
            (String(g.p1_id) === String(playerId) || String(g.p2_id) === String(playerId) ||
             String(g.winner_id) === String(playerId) || String(g.loser_id) === String(playerId))
        )
        .sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at));

    if (playerGames.length === 0) {
        container.innerHTML = '<p>No games.</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'nested-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Opponent</th>
                <th>Result</th>
                <th>ELO Change</th>
                <th>Date</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    playerGames.forEach(g => {
        const isP1 = String(g.p1_id) === String(playerId) || String(g.winner_id) === String(playerId);
        let opponentId, result, eloChangeHtml;

        if (g.note === 'Draw' || !g.winner_id) {
            opponentId = String(g.p1_id) === String(playerId) ? g.p2_id : g.p1_id;
            result = '<span class="status-draw">Draw</span>';
            eloChangeHtml = '-';
        } else if (String(g.winner_id) === String(playerId)) {
            opponentId = g.loser_id || (String(g.p1_id) === String(playerId) ? g.p2_id : g.p1_id);
            result = '<span class="status-win">Win</span>';
            eloChangeHtml = g.elo_change ? `<span class="elo-change elo-change--pos">+${g.elo_change}</span>` : '-';
        } else {
            opponentId = g.winner_id;
            result = '<span class="status-loss">Loss</span>';
            eloChangeHtml = g.elo_change ? `<span class="elo-change elo-change--neg">-${g.elo_change}</span>` : '-';
        }

        const opponentName = players[opponentId] ? players[opponentId].name : opponentId;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${opponentName}</td>
            <td>${result}</td>
            <td>${eloChangeHtml}</td>
            <td>${formatDate(g.finished_at)}</td>
        `;
        tbody.appendChild(tr);
    });

    container.appendChild(table);
}

// ─── Actions Page — Template Admin List ───

function renderTemplates(templates) {
    const container = document.getElementById('templates-list');
    if (!container) return;
    container.innerHTML = '';

    if (!templates || templates.length === 0) {
        container.innerHTML = '<p>No templates configured.</p>';
        return;
    }

    const table = document.createElement('table');
    table.innerHTML = `
        <thead>
            <tr>
                <th>ID</th>
                <th>Name</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    templates.forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${t.id}</td>
            <td>${t.name}</td>
        `;
        tbody.appendChild(tr);
    });

    container.appendChild(table);
}

// ─── Player Actions (GitHub Issue Integration) ───

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

    if (!confirm(`Are you sure you want to remove player ${id}?`)) return;

    const repo = getRepoURL();
    const title = encodeURIComponent(`Remove: ${id}`);
    const body = encodeURIComponent(`Please remove this player from the ladder.`);
    window.open(`${repo}/issues/new?title=${title}&body=${body}`, '_blank');
}

// ─── Template Management ───

function addTemplate() {
    const id = document.getElementById('template-id')?.value?.trim();
    const name = document.getElementById('template-name')?.value?.trim();

    if (!id || !/^\d+$/.test(id)) {
        return alert('Enter a valid numeric Template ID');
    }
    if (!name) {
        return alert('Enter a Template Name');
    }

    if (window.templates && window.templates[id]) {
        return alert(`Template ID ${id} already exists as "${window.templates[id].name}".`);
    }

    const repo = getRepoURL();
    const title = encodeURIComponent(`AddTemplate: ${id} Name: ${name}`);
    const body = encodeURIComponent(`Please add this Warzone template to the ladder map pool.`);
    window.open(`${repo}/issues/new?title=${title}&body=${body}`, '_blank');
}

function removeTemplate() {
    const id = document.getElementById('remove-template-id')?.value?.trim();

    if (!id || !/^\d+$/.test(id)) {
        return alert('Enter a valid numeric Template ID');
    }

    if (!window.templates || !window.templates[id]) {
        return alert(`Template ID ${id} is not in the current pool.`);
    }

    if (!confirm(`Are you sure you want to remove template "${window.templates[id].name}" (${id})?`)) {
        return;
    }

    const repo = getRepoURL();
    const title = encodeURIComponent(`RemoveTemplate: ${id}`);
    const body = encodeURIComponent(`Please remove this template from the ladder map pool.`);
    window.open(`${repo}/issues/new?title=${title}&body=${body}`, '_blank');
}

// Init
loadData();
