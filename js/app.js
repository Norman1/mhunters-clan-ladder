/* ============================================================
   M'Hunters Clan Ladder — Standings page wiring (Track D)
   Plain vanilla script (no modules). Depends on:
     window.LadderData (js/derive.js)  — LadderData.load()
     window.Insignia   (js/insignia.js) — Insignia.svg(rankIndex, leagueKey, sizePx)
   DOM contract (provided by index.html / track C):
     #standings-body #reserve-bar #reserve-count #reserve-section
     #reserve-body #gazette-list #search-input
     #stat-active #stat-live #stat-games #stat-updated
   Self-test: `node js/app.js` runs the pure-helper test suite.
   ============================================================ */

(function () {
  'use strict';

  /* ------------------------------------------------------------
     Pure helpers (no DOM — testable in node)
     ------------------------------------------------------------ */

  var RANK_NAMES = [
    'Recruit', 'Private', 'Private First Class', 'Specialist', 'Corporal',
    'Sergeant', 'Staff Sergeant', 'Sergeant First Class', 'Master Sergeant',
    'First Sergeant', 'Sergeant Major', 'Command Sgt. Major',
    'Second Lieutenant', 'First Lieutenant', 'Captain', 'Major',
    'Lieutenant Colonel', 'Colonel', 'Brigadier General', 'Major General',
    'Lieutenant General', 'General', 'General of the Army'
  ];

  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  /* NFKD-normalize, strip combining marks, strip everything that is not a
     letter or digit (unicode-aware, so non-Latin names stay searchable),
     lowercase. */
  function normalizeName(s) {
    var out = String(s == null ? '' : s)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    try {
      out = out.replace(/[^\p{L}\p{N}]/gu, '');
    } catch (e) {
      out = out.replace(/[^a-z0-9]/g, ''); // engines without \p support
    }
    return out;
  }

  /* delta7 → { text, cls } for td.c-delta (.up/.down); blank when unchanged */
  function formatDelta(d) {
    if (typeof d !== 'number' || !isFinite(d) || d === 0) {
      return { text: '', cls: 'flat' };
    }
    return d > 0
      ? { text: '▲' + d, cls: 'up' }
      : { text: '▼' + Math.abs(d), cls: 'down' };
  }

  /* streak {type,count} → { val, cls } for td.c-streak (.w/.l); plain value, no markers */
  function formatStreak(streak) {
    if (!streak || !streak.type || !streak.count) {
      return { val: '—', cls: '' };
    }
    return {
      val: streak.type + streak.count,
      cls: streak.type === 'W' ? 'w' : 'l'
    };
  }

  /* streak magnitude → font-size px: 12px at 1 game, growing linearly to 36px
     at a 30-game streak (nearly the full 44px row), capped there */
  function streakFontSize(count) {
    if (!count || count < 1) return null;
    var c = Math.min(count, 30);
    return Math.round((12 + ((c - 1) / 29) * 24) * 10) / 10;
  }

  /* ISO date → 'JUL 9' (parses the date part directly; no TZ drift) */
  function formatGazetteDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (m) {
      var mo = parseInt(m[2], 10);
      if (mo >= 1 && mo <= 12) return MONTHS[mo - 1] + ' ' + parseInt(m[3], 10);
    }
    var d = new Date(iso);
    if (!isNaN(d.getTime())) return MONTHS[d.getMonth()] + ' ' + d.getDate();
    return '';
  }

  function gazetteKindMarker(kind) {
    if (kind === 'promotion') return '★';  // ★
    if (kind === 'ascension') return '▲';  // ▲
    if (kind === 'demotion') return '▼';   // ▼
    return '·';                            // ·
  }

  function rankProgressText(p) {
    if (!p || p.winsToNextRank == null) return 'HIGHEST RANK PENDING';
    var next = (typeof p.rankIndex === 'number' && RANK_NAMES[p.rankIndex + 1])
      ? RANK_NAMES[p.rankIndex + 1].toUpperCase()
      : 'NEXT RANK';
    var n = p.winsToNextRank;
    return n + (n === 1 ? ' WIN TO ' : ' WINS TO ') + next;
  }

  /* Reserve status badge text: 'PAUSED' / 'INACTIVE · 3 MISSED' */
  function statusText(p) {
    p = p || {};
    var s = p.status === 'PAUSED' ? 'PAUSED' : (p.status || 'INACTIVE');
    var missed = p.missed || 0;
    return missed > 0 ? s + ' · ' + missed + ' MISSED' : s;
  }

  function reserveCountText(meta) {
    meta = meta || {};
    return (meta.pausedCount || 0) + ' PAUSED · ' +
           (meta.inactiveCount || 0) + ' INACTIVE';
  }

  function mastheadTexts(meta) {
    meta = meta || {};
    return {
      active: (meta.activeCount || 0) + ' ACTIVE',
      games: Number(meta.gamesPlayed || 0).toLocaleString('en-US') + ' GAMES',
      updated: 'Last Update ' + String(meta.lastUpdatedText || '—').toLowerCase()
    };
  }

  /* ------------------------------------------------------------
     Node self-test (browser never reaches this block)
     ------------------------------------------------------------ */
  if (typeof window === 'undefined') {
    var checks = 0, failures = 0;
    var eq = function (actual, expected, label) {
      checks++;
      var a = JSON.stringify(actual), e = JSON.stringify(expected);
      if (a === e) {
        console.log('  PASS  ' + label);
      } else {
        failures++;
        console.log('  FAIL  ' + label + '\n        expected ' + e + '\n        got      ' + a);
      }
    };

    console.log('app.js pure-helper self-test');

    eq(normalizeName('Vēntura'), 'ventura', 'normalizeName strips diacritics');
    eq(normalizeName('Gatsu 12!'), 'gatsu12', 'normalizeName strips space/punct');
    eq(normalizeName('Иван!'), 'иван', 'normalizeName keeps non-Latin letters');
    eq(normalizeName(null), '', 'normalizeName null-safe');

    eq(formatDelta(3), { text: '▲3', cls: 'up' }, 'delta +3 → ▲3 .up');
    eq(formatDelta(-2), { text: '▼2', cls: 'down' }, 'delta -2 → ▼2 .down');
    eq(formatDelta(0), { text: '', cls: 'flat' }, 'delta 0 → blank');
    eq(formatDelta(null), { text: '', cls: 'flat' }, 'delta null → blank');

    eq(formatStreak({ type: 'W', count: 5 }), { val: 'W5', cls: 'w' }, 'W5 → plain value');
    eq(formatStreak({ type: 'W', count: 1 }), { val: 'W1', cls: 'w' }, 'W1 → plain value');
    eq(formatStreak({ type: 'L', count: 3 }), { val: 'L3', cls: 'l' }, 'L3 → plain value');
    eq(formatStreak({ type: null, count: 0 }), { val: '—', cls: '' }, 'null streak → —');

    eq(streakFontSize(1), 12, 'streak size floor: 1 game → 12px');
    eq(streakFontSize(30), 36, 'streak size max: 30 games → 36px');
    eq(streakFontSize(45), 36, 'streak size caps beyond 30');
    eq(streakFontSize(8), 17.8, 'streak size scales linearly (W8 → 17.8px)');
    eq(streakFontSize(0), null, 'no streak → no size');

    eq(formatGazetteDate('2026-07-09'), 'JUL 9', 'gazette date plain');
    eq(formatGazetteDate('2025-12-28T14:03:00Z'), 'DEC 28', 'gazette date with time');
    eq(formatGazetteDate('junk'), '', 'gazette date junk → empty');

    eq(gazetteKindMarker('promotion'), '★', 'promotion marker');
    eq(gazetteKindMarker('ascension'), '▲', 'ascension marker');
    eq(gazetteKindMarker('demotion'), '▼', 'demotion marker');

    eq(rankProgressText({ winsToNextRank: 10, rankIndex: 5 }),
      '10 WINS TO STAFF SERGEANT', 'rank progress plural');
    eq(rankProgressText({ winsToNextRank: 1, rankIndex: 0 }),
      '1 WIN TO PRIVATE', 'rank progress singular');
    eq(rankProgressText({ winsToNextRank: null, rankIndex: 22 }),
      'HIGHEST RANK PENDING', 'rank progress at cap');

    eq(statusText({ status: 'PAUSED', missed: 0 }), 'PAUSED', 'status paused clean');
    eq(statusText({ status: 'PAUSED', missed: 1 }), 'PAUSED · 1 MISSED', 'status paused with strike');
    eq(statusText({ status: 'INACTIVE', missed: 3 }), 'INACTIVE · 3 MISSED', 'status inactive');

    eq(reserveCountText({ pausedCount: 2, inactiveCount: 59 }), '2 PAUSED · 59 INACTIVE', 'reserve count');

    eq(mastheadTexts({ activeCount: 21, liveCount: 17, gamesPlayed: 1220, lastUpdatedText: '2H AGO' }),
      { active: '21 ACTIVE', games: '1,220 GAMES', updated: 'Last Update 2h ago' },
      'masthead texts');

    console.log(failures === 0
      ? 'ALL ' + checks + ' CHECKS PASSED'
      : failures + '/' + checks + ' CHECKS FAILED');
    if (typeof process !== 'undefined') process.exitCode = failures ? 1 : 0;
    return;
  }

  /* ------------------------------------------------------------
     Browser wiring
     ------------------------------------------------------------ */

  var doc = document;

  function $(id) { return doc.getElementById(id); }

  var state = {
    rows: [],          // [{ player, el, norm, reserve }] — active first, then reserve
    peekRow: null,     // the injected tr.peek (one at a time)
    peekOwner: null,   // the tr.row that owns it
    posById: {},       // playerId → current ladder position (actives only)
    leagueById: {},    // playerId → league key (badge tint lookups)
    reserveOpen: false,
    flashEl: null,
    flashTimer: null,
    shakeTimer: null,
    searchTimer: null,
    data: null,                      // last loaded LadderData payload
    honorTips: {},                   // playerId → latest honor sentence (tooltips)
    sort: { key: 'pos', dir: 1 }     // standings sort state
  };

  /* Styles for app-transient states not covered by the shared contract
     (skeleton shimmer, search flash/shake, status badge, peek internals).
     :where() keeps specificity at zero so css/styles.css always wins. */
  function injectTransientStyles() {
    if ($('app-transient-styles')) return;
    var css = [
      ':where(tr.skeleton .sk){display:block;height:12px;border-radius:3px;',
      'background:var(--line-soft,#222429);animation:app-sk 1.2s ease-in-out infinite}',
      '@keyframes app-sk{50%{opacity:.4}}',
      ':where(tr.row--flash) td{background:rgba(210,39,48,.14);',
      'box-shadow:inset 0 1px 0 var(--red,#D22730),inset 0 -1px 0 var(--red,#D22730)}',
      ':where(.shake){animation:app-shake .3s linear}',
      '@keyframes app-shake{25%{transform:translateX(-4px)}50%{transform:translateX(3px)}75%{transform:translateX(-2px)}}',
      ':where(.p-status){font-family:"IBM Plex Mono",monospace;font-size:.68em;font-weight:500;',
      'letter-spacing:.06em;color:var(--dim,#8A919C);margin-left:.6em;white-space:nowrap}',
      ':where(.peek-inner){display:flex;flex-wrap:wrap;gap:.5em 1.5em;align-items:baseline;',
      'justify-content:space-between;font-family:"IBM Plex Mono",monospace;font-size:.82em;',
      'color:var(--silver,#C6CDD6);padding:.4em .25em}',
      ':where(.peek-link){color:var(--red,#D22730);text-decoration:none;font-weight:600;white-space:nowrap}',
      ':where(.peek-link):hover{color:var(--red-hover,#E23640)}',
      ':where(.gz-entry){display:flex;gap:.75em;align-items:baseline;font-family:"IBM Plex Mono",monospace}',
      ':where(.gz-date){color:var(--dim,#8A919C);white-space:nowrap}',
      ':where(.load-error){font-family:"IBM Plex Mono",monospace;color:var(--muted,#9AA1AB);',
      'text-align:center;padding:2em 1em;letter-spacing:.05em}',
      ':where(.load-error) a{color:var(--red,#D22730)}',
      '@media (prefers-reduced-motion:reduce){:where(tr.skeleton .sk),:where(.shake){animation:none}}'
    ].join('');
    var style = doc.createElement('style');
    style.id = 'app-transient-styles';
    style.textContent = css;
    doc.head.appendChild(style);
  }

  /* ---------- masthead ---------- */

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function renderMasthead(meta) {
    var t = mastheadTexts(meta);
    setText('stat-active', t.active);
    setText('stat-games', t.games);
    setText('stat-updated', t.updated);
    var live = $('stat-live');
    if (live && live.parentNode) live.parentNode.removeChild(live);
  }

  /* ---------- row builders ---------- */

  function buildInsigniaCell(p) {
    var td = doc.createElement('td');
    td.className = 'c-insignia';
    var tip = (p.rankName || '') + ' · ' + (p.leagueName || '') + ' League';
    if (p.freshHonor) {
      var honor = state.honorTips[String(p.id)];
      tip = (honor ? honor : 'New honors this week') + '\n' + tip;
      td.classList.add('insignia--fresh');
    }
    td.title = tip;
    try {
      if (window.Insignia && typeof window.Insignia.svg === 'function') {
        td.innerHTML = window.Insignia.svg(p.rankIndex, p.league, 20);
      }
    } catch (err) {
      console.warn('[app] Insignia.svg failed for ' + (p.name || '?'), err);
    }
    return td;
  }

  function buildWinRateCell(p) {
    var td = doc.createElement('td');
    td.className = 'c-winrate';
    td.textContent = (p.gamesPlayed > 0 && p.winRate != null) ? p.winRate + '%' : '—';
    return td;
  }

  function buildStreakCell(p) {
    var s = formatStreak(p.streak);
    var td = doc.createElement('td');
    td.className = 'c-streak' + (s.cls ? ' ' + s.cls : '');
    td.textContent = s.val;
    var size = p.streak && p.streak.type ? streakFontSize(p.streak.count) : null;
    if (size) {
      td.style.fontSize = size + 'px';
      td.style.lineHeight = '1';
    }
    return td;
  }

  function buildPlayerCell(p, withStatus) {
    var td = doc.createElement('td');
    td.className = 'c-player';
    var name;
    if (p.id != null) {
      /* name links to the profile; stopPropagation so the row's
         quick-peek toggle never fires on a name click */
      name = doc.createElement('a');
      name.className = 'plink p-name';
      name.href = 'profile.html?p=' + encodeURIComponent(p.id);
      name.addEventListener('click', function (e) { e.stopPropagation(); });
    } else {
      name = doc.createElement('span');
      name.className = 'p-name';
    }
    name.textContent = String(p.name || '').toUpperCase();
    td.appendChild(name);
    if (withStatus) {
      var badge = doc.createElement('span');
      badge.className = 'p-status p-status--' + String(p.status || 'inactive').toLowerCase();
      badge.textContent = statusText(p);
      td.appendChild(badge);
    }
    return td;
  }

  function decorateRow(tr, p) {
    if (p.freshHonor) tr.classList.add('row--fresh');
    tr.dataset.playerId = String(p.id != null ? p.id : '');
    tr.setAttribute('aria-expanded', 'false');
    tr.tabIndex = 0;
  }

  function buildStandingsRow(p) {
    var tr = doc.createElement('tr');
    tr.className = 'row';
    decorateRow(tr, p);

    var d = formatDelta(p.delta7);
    var dTd = doc.createElement('td');
    dTd.className = 'c-delta ' + d.cls;
    dTd.textContent = d.text;
    tr.appendChild(dTd);

    var pos = doc.createElement('td');
    pos.className = 'c-pos';
    pos.textContent = p.rank != null ? String(p.rank) : '—';
    tr.appendChild(pos);

    tr.appendChild(buildInsigniaCell(p));
    tr.appendChild(buildPlayerCell(p, false));

    var rating = doc.createElement('td');
    rating.className = 'c-rating';
    rating.textContent = p.elo != null ? String(p.elo) : '—';
    tr.appendChild(rating);

    tr.appendChild(buildWinRateCell(p));
    tr.appendChild(buildStreakCell(p));
    return tr;
  }

  /* Reserve rows: same shape minus the delta cell, status badge after name */
  function buildReserveRow(p) {
    var tr = doc.createElement('tr');
    tr.className = 'row row--reserve';
    decorateRow(tr, p);

    var pos = doc.createElement('td');
    pos.className = 'c-pos';
    pos.textContent = '—';
    tr.appendChild(pos);

    tr.appendChild(buildInsigniaCell(p));
    tr.appendChild(buildPlayerCell(p, true));

    var rating = doc.createElement('td');
    rating.className = 'c-rating';
    rating.textContent = p.elo != null ? String(p.elo) : '—';
    tr.appendChild(rating);

    tr.appendChild(buildWinRateCell(p));
    tr.appendChild(buildStreakCell(p));
    return tr;
  }

  /* ---------- quick-peek ---------- */

  function closePeek() {
    if (state.peekRow && state.peekRow.parentNode) {
      state.peekRow.parentNode.removeChild(state.peekRow);
    }
    if (state.peekOwner) state.peekOwner.setAttribute('aria-expanded', 'false');
    state.peekRow = null;
    state.peekOwner = null;
  }

  /* trajectory sparkline (R10: per-player domain, min 150-pt span, 1000 baseline).
     Fluid width: viewBox scales to the cell, strokes stay crisp. */
  function trajectorySVG(traj, width, height) {
    var w = width, h = height, pad = 3;
    if (!traj || traj.length < 2) {
      return '<div class="pk-flat">NOT ENOUGH GAMES — ' +
        (traj ? traj.length - 1 : 0) + ' PLAYED</div>';
    }
    var lo = Math.min.apply(null, traj);
    var hi = Math.max.apply(null, traj);
    var mid = (lo + hi) / 2;
    var span = Math.max(hi - lo, 150);
    lo = mid - span / 2; hi = mid + span / 2;
    var y = function (v) { return pad + (hi - v) / (hi - lo) * (h - pad * 2); };
    var pts = [];
    for (var i = 0; i < traj.length; i++) {
      pts.push((pad + i * (w - pad * 2) / (traj.length - 1)).toFixed(1) + ',' + y(traj[i]).toFixed(1));
    }
    var base = '';
    if (1000 >= lo && 1000 <= hi) {
      var by = y(1000).toFixed(1);
      base = '<line x1="' + pad + '" y1="' + by + '" x2="' + (w - pad) + '" y2="' + by +
        '" stroke="#2A2D33" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>';
    }
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h +
      '" preserveAspectRatio="none" aria-hidden="true">' + base +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#C6CDD6" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>';
  }

  /* 'DEC 16 2025' from an ISO date */
  function startDateText(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    var mo = parseInt(m[2], 10);
    if (mo < 1 || mo > 12) return null;
    return MONTHS[mo - 1] + ' ' + parseInt(m[3], 10) + ' ' + m[1];
  }

  function peekSection(label) {
    var col = doc.createElement('div');
    col.className = 'pk-col';
    var lab = doc.createElement('div');
    lab.className = 'pk-label';
    lab.textContent = label;
    col.appendChild(lab);
    return col;
  }

  function mapLine(label, m) {
    var div = doc.createElement('div');
    div.className = 'pk-map';
    var b = doc.createElement('span');
    b.className = 'pk-map__tag';
    b.textContent = label;
    div.appendChild(b);
    var v = doc.createElement('span');
    v.textContent = m ? ' ' + m.name + ' ' : ' — ';
    div.appendChild(v);
    if (m) {
      var rec = doc.createElement('span');
      rec.className = 'pk-map__rec';
      rec.textContent = m.w + '–' + m.l;
      div.appendChild(rec);
    }
    return div;
  }

  function togglePeek(rowEl, p) {
    if (state.peekOwner === rowEl) { closePeek(); return; }
    closePeek();

    var tr = doc.createElement('tr');
    tr.className = 'peek';
    var td = doc.createElement('td');
    td.className = 'peek-cell';
    td.colSpan = rowEl.children.length || 6;

    var inner = doc.createElement('div');
    inner.className = 'peek-grid';

    // 1 — rating change since first game
    var started = startDateText(p.firstGameAt);
    var cTraj = peekSection(started ? 'RATING CHANGE — SINCE ' + started : 'RATING CHANGE');
    var graph = doc.createElement('div');
    graph.className = 'pk-graph';
    graph.innerHTML = trajectorySVG(p.traj, 250, 56);
    cTraj.appendChild(graph);
    if (p.gamesPlayed > 0) {
      var axis = doc.createElement('div');
      axis.className = 'pk-axis';
      axis.innerHTML = '<span>START 1000</span><span>PEAK ' + p.peak + '</span><span>NOW ' + p.elo + '</span>';
      cTraj.appendChild(axis);
    }
    inner.appendChild(cTraj);

    // 2 — best/worst maps
    var cMaps = peekSection('MAPS (MIN. 3 GAMES)');
    cMaps.appendChild(mapLine('BEST', p.bestMap));
    cMaps.appendChild(mapLine('WORST', p.worstMap));
    inner.appendChild(cMaps);

    // 3 — record + progress to next rank (with the next rank's badge)
    var cSvc = peekSection('RECORD');
    var rec = doc.createElement('div');
    rec.className = 'pk-line pk-record';
    rec.textContent = p.wins + '–' + p.losses;
    cSvc.appendChild(rec);
    var prog = doc.createElement('div');
    prog.className = 'pk-line pk-progress';
    if (p.winsToNextRank != null && RANK_NAMES[p.rankIndex + 1]) {
      var n = p.winsToNextRank;
      prog.appendChild(doc.createTextNode(n + (n === 1 ? ' WIN TO ' : ' WINS TO ')));
      var nb = doc.createElement('span');
      nb.className = 'pk-next-badge';
      try { nb.innerHTML = window.Insignia.svg(p.rankIndex + 1, p.league, 18); } catch (err) {}
      prog.appendChild(nb);
      prog.appendChild(doc.createTextNode(' ' + RANK_NAMES[p.rankIndex + 1].toUpperCase()));
    } else {
      prog.textContent = 'HIGHEST RANK PENDING';
    }
    cSvc.appendChild(prog);
    inner.appendChild(cSvc);

    // 4 — live now + profile link
    var cLive = peekSection('LIVE NOW');
    if (p.liveGames && p.liveGames.length) {
      p.liveGames.forEach(function (lg) {
        /* plain div line: opponent name links to their profile, the ↗ to
           the game — the line itself is no longer an anchor */
        var lineEl = doc.createElement('div');
        lineEl.className = 'pk-live';
        var phase = lg.phase === 'lobby' ? 'NOT STARTED' : lg.phase;
        lineEl.appendChild(doc.createTextNode('● vs '));
        lineEl.appendChild(nameLink(lg.opp, '', lg.oppId));
        lineEl.appendChild(doc.createTextNode(' · ' + lg.map + ' · ' + phase + ' '));
        var go = doc.createElement('a');
        go.className = 'pk-live-go';
        go.href = 'https://www.warzone.com/MultiPlayer?GameID=' + encodeURIComponent(lg.gameId);
        go.target = '_blank';
        go.rel = 'noopener';
        go.textContent = '↗';
        go.setAttribute('aria-label', 'View this game on warzone.com');
        go.addEventListener('click', function (e) { e.stopPropagation(); });
        lineEl.appendChild(go);
        cLive.appendChild(lineEl);
      });
    } else {
      var none = doc.createElement('div');
      none.className = 'pk-line pk-dim';
      none.textContent = 'NO ACTIVE GAMES';
      cLive.appendChild(none);
    }
    var link = doc.createElement('a');
    link.className = 'peek-link';
    link.href = 'profile.html?p=' + encodeURIComponent(p.id);
    link.textContent = 'FULL PROFILE →';
    link.addEventListener('click', function (e) {
      e.stopPropagation();
    });
    cLive.appendChild(link);
    inner.appendChild(cLive);

    td.appendChild(inner);
    tr.appendChild(td);
    rowEl.insertAdjacentElement('afterend', tr);
    rowEl.setAttribute('aria-expanded', 'true');
    state.peekRow = tr;
    state.peekOwner = rowEl;
  }

  function findRowRecord(rowEl) {
    for (var i = 0; i < state.rows.length; i++) {
      if (state.rows[i].el === rowEl) return state.rows[i];
    }
    return null;
  }

  function wireRowEvents(tbody) {
    if (!tbody) return;
    tbody.addEventListener('click', function (e) {
      var rowEl = e.target && e.target.closest ? e.target.closest('tr.row') : null;
      if (!rowEl || !tbody.contains(rowEl)) return;
      var rec = findRowRecord(rowEl);
      if (rec) togglePeek(rowEl, rec.player);
    });
    tbody.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      /* Enter on a focused name link should navigate, not toggle the peek */
      if (e.target && e.target.closest && e.target.closest('a')) return;
      var rowEl = e.target && e.target.closest ? e.target.closest('tr.row') : null;
      if (!rowEl || !tbody.contains(rowEl)) return;
      e.preventDefault();
      var rec = findRowRecord(rowEl);
      if (rec) togglePeek(rowEl, rec.player);
    });
  }

  /* ---------- reserve section ---------- */

  function setReserveOpen(open) {
    state.reserveOpen = !!open;
    var bar = $('reserve-bar');
    var section = $('reserve-section');
    if (bar) {
      bar.setAttribute('aria-expanded', open ? 'true' : 'false');
      bar.classList.toggle('open', !!open);
    }
    if (section) {
      section.hidden = !open;
      section.classList.toggle('open', !!open);
    }
  }

  function wireReserveBar() {
    var bar = $('reserve-bar');
    if (!bar) return;
    bar.addEventListener('click', function () {
      setReserveOpen(!state.reserveOpen);
    });
  }

  /* ---------- feed (honors + results, merged, newest first) ---------- */

  function tsOf(iso) {
    var t = Date.parse(iso);
    return isNaN(t) ? 0 : t;
  }

  /* time since the event: '6h' under a day; older entries carry no timestamp */
  function feedTime(iso) {
    var t = tsOf(iso);
    if (!t) return '';
    var diff = Date.now() - t;
    var mins = Math.floor(diff / 60000);
    if (mins < 60) return Math.max(1, mins) + 'm';
    var hours = Math.floor(mins / 60);
    return hours < 24 ? hours + 'h' : '';
  }

  function feedTimeSpan(iso) {
    var text = feedTime(iso);
    if (!text) return doc.createDocumentFragment();
    var span = doc.createElement('span');
    span.className = 'feed-time';
    span.textContent = text;
    return span;
  }

  function nameSpan(name, cls) {
    var span = doc.createElement('span');
    span.className = cls;
    span.textContent = name;
    return span;
  }

  /* current roster check — state.leagueById covers every active + reserve id */
  function isRosterId(id) {
    return id != null && state.leagueById[String(id)] !== undefined;
  }

  /* player-name node: <a.plink> to the profile when the id resolves to a
     current roster player; plain span otherwise ('Former member' etc.) */
  function nameLink(name, cls, id) {
    if (!isRosterId(id)) return nameSpan(name, cls);
    var a = doc.createElement('a');
    a.className = cls ? 'plink ' + cls : 'plink';
    a.href = 'profile.html?p=' + encodeURIComponent(id);
    a.textContent = name;
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    return a;
  }

  /* result rows open the game on warzone.com. The row is a div[role=link]
     (not an anchor: the names inside are real profile links and nested
     anchors are invalid HTML) — click / Enter opens the game. */
  function buildResultItem(r) {
    var url = 'https://www.warzone.com/MultiPlayer?GameID=' + encodeURIComponent(r.gameId || '');
    var item = doc.createElement('div');
    item.className = 'feed-item feed-item--result';
    item.setAttribute('role', 'link');
    item.tabIndex = 0;
    item.title = 'View this game on warzone.com';
    item.addEventListener('click', function () {
      window.open(url, '_blank', 'noopener');
    });
    item.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.target && e.target.closest && e.target.closest('a')) return;
      e.preventDefault();
      window.open(url, '_blank', 'noopener');
    });

    var body = doc.createElement('div');
    body.className = 'feed-result';

    var line = doc.createElement('div');
    line.className = 'feed-result__line';
    line.appendChild(nameLink(r.winner, 'fr-winner', r.winnerId));
    var wch = doc.createElement('span');
    wch.className = 'fr-up';
    wch.textContent = ' +' + r.change + ' ';
    line.appendChild(wch);
    var mid = doc.createElement('span');
    mid.className = 'fr-mid';
    mid.textContent = 'defeats ';
    line.appendChild(mid);
    line.appendChild(nameLink(r.loser, 'fr-loser', r.loserId));
    var lch = doc.createElement('span');
    lch.className = 'fr-down';
    lch.textContent = ' −' + r.change;
    line.appendChild(lch);
    body.appendChild(line);

    var sub = doc.createElement('div');
    sub.className = 'feed-result__sub';
    var mapTag = doc.createElement('span');
    mapTag.className = 'fr-map';
    mapTag.textContent = r.map;
    sub.appendChild(mapTag);
    if (r.turns != null) {
      sub.appendChild(doc.createTextNode(' ' + r.turns + ' Turns'));
    }
    var go = doc.createElement('span');
    go.className = 'fr-go';
    go.textContent = '↗';
    go.setAttribute('aria-hidden', 'true');
    sub.appendChild(go);
    body.appendChild(sub);

    item.appendChild(body);
    item.appendChild(feedTimeSpan(r.date));
    return item;
  }

  /* league changes: ceremony card — name + PROMOTED TO / RELEGATED TO, the new
     league big and metallic beneath, card washed in the league's metal.
     rank promotions: interim compact style (distinct treatment being designed). */
  function buildHonorItem(g) {
    var div = doc.createElement('div');
    div.title = g.text || '';

    if (g.kind === 'ascension' || g.kind === 'demotion') {
      div.className = 'feed-item feed-item--honor feed-item--league lg-' + (g.leagueKey || 'steel');

      var body = doc.createElement('div');
      body.className = 'fh-body';

      var line = doc.createElement('div');
      line.className = 'fh-line';
      var mark = doc.createElement('span');
      mark.className = 'fh-mark';
      mark.textContent = g.kind === 'ascension' ? '▲' : '▼';
      line.appendChild(mark);
      line.appendChild(nameLink(g.playerName, 'fh-name', g.playerId));
      var action = doc.createElement('span');
      action.className = 'fh-action';
      action.textContent = g.kind === 'ascension' ? 'PROMOTED TO' : 'RELEGATED TO';
      line.appendChild(action);
      body.appendChild(line);

      var word = doc.createElement('div');
      word.className = 'fh-league-word';
      word.textContent = (g.leagueName || '').toUpperCase() + ' LEAGUE';
      body.appendChild(word);

      var sub = doc.createElement('div');
      sub.className = 'feed-result__sub';
      sub.textContent = g.kind === 'ascension'
        ? 'reached ' + g.boundary + ' ELO'
        : 'fell below ' + g.boundary + ' ELO';
      body.appendChild(sub);

      div.appendChild(body);
      div.appendChild(feedTimeSpan(g.date));
      return div;
    }

    // rank promotion: certificate card in M'Hunters steel — shield large,
    // ACHIEVED THE RANK OF, rank word in the engraved-steel wordmark gradient
    div.className = 'feed-item feed-item--honor feed-item--rank';

    var badge = doc.createElement('span');
    badge.className = 'fh-badge fh-badge--cert';
    try {
      var tint = state.leagueById[String(g.playerId)] || 'steel';
      badge.innerHTML = window.Insignia.svg(g.rankIndex, tint, 34);
    } catch (err) { /* badge optional */ }
    div.appendChild(badge);

    var pbody = doc.createElement('div');
    pbody.className = 'fh-body';
    var pline = doc.createElement('div');
    pline.className = 'fh-line';
    var star = doc.createElement('span');
    star.className = 'fh-mark fh-mark--star';
    star.textContent = '★';
    pline.appendChild(star);
    pline.appendChild(nameLink(g.playerName, 'fh-name', g.playerId));
    var paction = doc.createElement('span');
    paction.className = 'fh-action';
    paction.textContent = 'ACHIEVED THE RANK OF';
    pline.appendChild(paction);
    pbody.appendChild(pline);

    var rword = doc.createElement('div');
    rword.className = 'fh-rank-word';
    rword.textContent = (g.rankName || '').toUpperCase();
    pbody.appendChild(rword);

    var psub = doc.createElement('div');
    psub.className = 'feed-result__sub';
    psub.textContent = g.threshold + ' career wins';
    pbody.appendChild(psub);

    div.appendChild(pbody);
    div.appendChild(feedTimeSpan(g.date));
    return div;
  }

  function renderFeed(gazette, results) {
    var list = $('feed-list');
    if (!list) return;
    list.textContent = '';
    var items = [];
    (gazette || []).forEach(function (g) { items.push({ at: tsOf(g.date), honor: g }); });
    (results || []).forEach(function (r) { items.push({ at: tsOf(r.date), result: r }); });
    items.sort(function (a, b) { return b.at - a.at; });
    items.slice(0, 30).forEach(function (it) {
      list.appendChild(it.honor ? buildHonorItem(it.honor) : buildResultItem(it.result));
    });
  }

  /* ---------- gazette (legacy renderer, unused when #feed-list exists) ---------- */

  function renderGazette(entries) {
    var list = $('gazette-list');
    if (!list) return;
    list.textContent = '';
    (entries || []).slice(0, 8).forEach(function (g) {
      var div = doc.createElement('div');
      div.className = 'gz-entry gz-entry--' + (g.kind || 'unknown');
      if (g.playerId != null) div.dataset.playerId = String(g.playerId);

      var date = doc.createElement('span');
      date.className = 'gz-date';
      date.textContent = formatGazetteDate(g.date);
      div.appendChild(date);

      var kind = doc.createElement('span');
      kind.className = 'gz-kind gz-kind--' + (g.kind || 'unknown');
      kind.textContent = gazetteKindMarker(g.kind);
      div.appendChild(kind);

      var text = doc.createElement('span');
      text.className = 'gz-text';
      text.textContent = g.text || '';
      div.appendChild(text);

      list.appendChild(div);
    });
  }

  /* ---------- search ---------- */

  function clearFlash() {
    if (state.flashTimer) { clearTimeout(state.flashTimer); state.flashTimer = null; }
    if (state.flashEl) { state.flashEl.classList.remove('row--flash'); state.flashEl = null; }
  }

  function flashRow(el) {
    clearFlash();
    el.classList.add('row--flash');
    state.flashEl = el;
    state.flashTimer = setTimeout(clearFlash, 2000);
  }

  function shakeInput(input) {
    input.classList.remove('shake');
    void input.offsetWidth; // restart animation
    input.classList.add('shake');
    if (state.shakeTimer) clearTimeout(state.shakeTimer);
    state.shakeTimer = setTimeout(function () {
      input.classList.remove('shake');
    }, 400);
  }

  function runSearch(input) {
    var q = normalizeName(input.value);
    if (!q) { clearFlash(); return; }

    var hit = null;
    for (var i = 0; i < state.rows.length; i++) { // active first, then reserve
      if (state.rows[i].norm.indexOf(q) !== -1) { hit = state.rows[i]; break; }
    }

    if (!hit) {
      clearFlash();
      shakeInput(input);
      return;
    }

    if (hit.reserve && !state.reserveOpen) setReserveOpen(true);
    try {
      hit.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (err) {
      hit.el.scrollIntoView();
    }
    flashRow(hit.el);
  }

  function wireSearch() {
    var input = $('search-input');
    if (!input) return;
    input.addEventListener('input', function () {
      if (state.searchTimer) clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(function () { runSearch(input); }, 200);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (state.searchTimer) { clearTimeout(state.searchTimer); state.searchTimer = null; }
        input.value = '';
        clearFlash();
      }
    });
  }

  /* ---------- loading / error states ---------- */

  function renderSkeleton() {
    var tbody = $('standings-body');
    if (!tbody) return;
    tbody.textContent = '';
    var cells = ['c-delta', 'c-pos', 'c-insignia', 'c-player', 'c-rating', 'c-winrate', 'c-streak'];
    for (var i = 0; i < 8; i++) {
      var tr = doc.createElement('tr');
      tr.className = 'row skeleton';
      for (var j = 0; j < cells.length; j++) {
        var td = doc.createElement('td');
        td.className = cells[j];
        var bar = doc.createElement('div');
        bar.className = 'sk';
        td.appendChild(bar);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function renderError() {
    var tbody = $('standings-body');
    if (!tbody) return;
    tbody.textContent = '';
    var tr = doc.createElement('tr');
    var td = doc.createElement('td');
    td.colSpan = 6;
    td.className = 'load-error';
    td.appendChild(doc.createTextNode('LADDER DATA UNREACHABLE — '));
    var a = doc.createElement('a');
    a.href = '#';
    a.textContent = 'RETRY';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      window.location.reload();
    });
    td.appendChild(a);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  /* ---------- sorting ---------- */

  var SORTERS = {
    pos:    { dir: 1,  cmp: function (a, b) { return (a.rank || 0) - (b.rank || 0); } },
    rank:   { dir: -1, cmp: function (a, b) { return (a.wins || 0) - (b.wins || 0) || (a.elo || 0) - (b.elo || 0); } },
    player: { dir: 1,  cmp: function (a, b) { return normalizeName(a.name) < normalizeName(b.name) ? -1 : 1; } },
    rating: { dir: -1, cmp: function (a, b) { return (a.elo || 0) - (b.elo || 0); } },
    winrate: { dir: -1, cmp: function (a, b) {
      var d = (a.winRate || 0) - (b.winRate || 0);
      return d !== 0 ? d : (a.gamesPlayed || 0) - (b.gamesPlayed || 0);
    } },
    delta:  { dir: -1, cmp: function (a, b) { return (a.delta7 || 0) - (b.delta7 || 0); } },
    streak: { dir: -1, cmp: function (a, b) { return signedStreak(a) - signedStreak(b); } }
  };

  function signedStreak(p) {
    var s = p.streak;
    if (!s || !s.type || !s.count) return 0;
    return s.type === 'W' ? s.count : -s.count;
  }

  function sortedActive() {
    var active = (state.data && state.data.active || []).slice();
    var s = SORTERS[state.sort.key] || SORTERS.pos;
    active.sort(function (a, b) { return s.cmp(a, b) * s.dir * state.sort.dir; });
    return active;
  }

  function renderStandingsBody() {
    var tbody = $('standings-body');
    if (!tbody) return;
    closePeek();
    tbody.textContent = '';
    var activeRecs = [];
    sortedActive().forEach(function (p) {
      var el = buildStandingsRow(p);
      tbody.appendChild(el);
      activeRecs.push({ player: p, el: el, norm: normalizeName(p.name), reserve: false });
    });
    state.rows = activeRecs.concat(state.rows.filter(function (r) { return r.reserve; }));
  }

  function updateSortHeaders() {
    var ths = doc.querySelectorAll('.standings-table thead th[data-sort]');
    Array.prototype.forEach.call(ths, function (th) {
      var key = th.getAttribute('data-sort');
      th.classList.remove('sort-asc', 'sort-desc');
      if (key === state.sort.key) {
        var effective = SORTERS[key].dir * state.sort.dir;
        th.classList.add(effective === 1 ? 'sort-asc' : 'sort-desc');
        th.setAttribute('aria-sort', effective === 1 ? 'ascending' : 'descending');
      } else {
        th.removeAttribute('aria-sort');
      }
    });
  }

  function wireSorting() {
    var ths = doc.querySelectorAll('.standings-table thead th[data-sort]');
    Array.prototype.forEach.call(ths, function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (!SORTERS[key]) return;
        if (state.sort.key === key) {
          state.sort.dir = -state.sort.dir;
        } else {
          state.sort = { key: key, dir: 1 };
        }
        renderStandingsBody();
        updateSortHeaders();
      });
    });
  }

  /* ---------- main render ---------- */

  function buildHonorTips(gazette) {
    var tips = {};
    (gazette || []).forEach(function (g) {
      // newest first — keep the first promotion/ascension seen per player
      if (!g || !g.playerId) return;
      if (g.kind !== 'promotion' && g.kind !== 'ascension') return;
      var id = String(g.playerId);
      if (!tips[id]) tips[id] = formatGazetteDate(g.date) + ' — ' + (g.text || '');
    });
    return tips;
  }

  function renderAll(data) {
    data = data || {};
    var reserve = data.reserve || [];
    var meta = data.meta || {};

    state.data = data;
    state.honorTips = buildHonorTips(data.gazette);
    state.posById = {};
    state.leagueById = {};
    (data.active || []).forEach(function (p) {
      state.posById[String(p.id)] = p.rank;
      state.leagueById[String(p.id)] = p.league;
    });
    (data.reserve || []).forEach(function (p) {
      state.leagueById[String(p.id)] = p.league;
    });
    renderMasthead(meta);
    state.rows = [];

    setText('reserve-count', reserveCountText(meta));

    var rbody = $('reserve-body');
    if (rbody) {
      rbody.textContent = '';
      reserve.forEach(function (p) {
        var el = buildReserveRow(p);
        rbody.appendChild(el);
        state.rows.push({ player: p, el: el, norm: normalizeName(p.name), reserve: true });
      });
    }

    renderStandingsBody();
    updateSortHeaders();
    renderFeed(data.gazette, data.results);
    renderGazette(data.gazette);
    setReserveOpen(false);
  }

  function init() {
    injectTransientStyles();
    renderSkeleton();
    wireRowEvents($('standings-body'));
    wireRowEvents($('reserve-body'));
    wireReserveBar();
    wireSearch();
    wireSorting();
    setReserveOpen(false);

    if (!window.LadderData || typeof window.LadderData.load !== 'function') {
      console.error('[app] window.LadderData.load is missing — is js/derive.js loaded before js/app.js?');
      renderError();
      return;
    }

    window.LadderData.load().then(renderAll).catch(function (err) {
      console.error('[app] ladder data load failed', err);
      renderError();
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
