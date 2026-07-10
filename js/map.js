/* ============================================================
   M'Hunters Clan Ladder — Map detail wiring (Track C)
   Plain vanilla script (no modules). Depends on:
     window.LadderData (js/derive.js) — LadderData.load()
       → data.maps (per-pool-template entries, track A)
       → data.allResults / data.live entries carry templateId
   DOM contract (provided by map.html / track B):
     #map-name · #map-facts · #map-board-body · #map-board-empty
     #map-live-list · #map-live-empty
     #map-games-list · #map-games-sentinel · #map-error
   URL: map.html?t=<templateId> (legacy ids resolve through the
   data layer's resolver when it exposes one).
   Self-test: `node js/map.js` runs the pure-helper test suite.
   ============================================================ */

(function () {
  'use strict';

  var CHUNK = 60;

  /* ------------------------------------------------------------
     Pure helpers (no DOM — testable in node)
     ------------------------------------------------------------ */

  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  var MONTHS_FULL = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
                     'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  /* ISO date → 'DEC 16 2025' (parses the date part directly; no TZ drift) */
  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (m) {
      var mo = parseInt(m[2], 10);
      if (mo >= 1 && mo <= 12) {
        return MONTHS[mo - 1] + ' ' + parseInt(m[3], 10) + ' ' + m[1];
      }
    }
    var d = new Date(iso);
    if (!isNaN(d.getTime())) {
      return MONTHS[d.getMonth()] + ' ' + d.getDate() + ' ' + d.getFullYear();
    }
    return '';
  }

  /* ISO date → 'YYYY-MM' month key ('' when unparseable) */
  function monthKey(iso) {
    var m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    return m ? m[1] + '-' + m[2] : '';
  }

  /* 'YYYY-MM' → 'JULY 2026' month-marker label */
  function monthLabel(key) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
    if (!m) return '';
    var mo = parseInt(m[2], 10);
    if (mo < 1 || mo > 12) return '';
    return MONTHS_FULL[mo - 1] + ' ' + m[1];
  }

  /* month marker goes BETWEEN consecutive rendered rows — never above the first */
  function monthChanged(prevIso, iso) {
    if (!prevIso) return false;
    return monthKey(prevIso) !== monthKey(iso);
  }

  /* chunking math: index one past the last row of the next chunk */
  function chunkEnd(start, size, total) {
    return Math.min(start + size, total);
  }

  /* live phase → display text */
  function phaseText(phase) {
    if (phase === 'lobby') return 'NOT STARTED';
    if (phase === 'picks') return 'PICKS';
    return phase ? String(phase).toUpperCase() : '—';
  }

  function fmtInt(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  /* avg turns (number|null, already 1 decimal from the data layer) → '41.3' / '—' */
  function fmtAvg(n) {
    if (n == null || typeof n !== 'number' || isNaN(n)) return '—';
    return n.toFixed(1);
  }

  /* leaderboard W–L cell: '12–4' (en dash) */
  function wlText(w, l) {
    return Number(w || 0) + '–' + Number(l || 0);
  }

  /* find a pool-map entry by canonical id OR any of its legacy ids —
     old deep links keep working after a template migration */
  function findMap(maps, id) {
    var key = String(id == null ? '' : id).trim();
    if (!key || !maps) return null;
    for (var i = 0; i < maps.length; i++) {
      if (maps[i] && String(maps[i].id) === key) return maps[i];
    }
    for (var j = 0; j < maps.length; j++) {
      var lg = maps[j] && maps[j].legacyIds;
      if (lg && lg.indexOf(key) !== -1) return maps[j];
    }
    return null;
  }

  /* filter allResults / live entries by canonical templateId (NOT map name) */
  function filterByTemplate(list, id) {
    var key = String(id == null ? '' : id);
    var out = [];
    if (!list) return out;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].templateId != null &&
          String(list[i].templateId) === key) out.push(list[i]);
    }
    return out;
  }

  /* fact strip: GAMES HOSTED · FIRST PLAYED · LAST PLAYED · AVG TURNS · MOST ACTIVE */
  function buildFacts(m) {
    m = m || {};
    return [
      { label: 'GAMES HOSTED', value: fmtInt(m.games) },
      { label: 'FIRST PLAYED', value: m.firstPlayed ? formatDate(m.firstPlayed) : '—' },
      { label: 'LAST PLAYED', value: m.lastPlayed ? formatDate(m.lastPlayed) : '—' },
      { label: 'AVG TURNS', value: fmtAvg(m.avgTurns) },
      { label: 'MOST ACTIVE', value: (m.mostActive && m.mostActive.name != null) ? m.mostActive.name : '—' }
    ];
  }

  /* document.title for a resolved map: 'STRAT 1V1 — M'HUNTERS LADDER' */
  function pageTitle(name) {
    return String(name == null ? '' : name).toUpperCase() + " — M'HUNTERS LADDER";
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

    console.log('map.js pure-helper self-test');

    // dates
    eq(formatDate('2025-12-16T01:40:32.270Z'), 'DEC 16 2025', "formatDate → 'DEC 16 2025'");
    eq(formatDate('2026-07-09T01:02:03Z'), 'JUL 9 2026', 'formatDate july');
    eq(formatDate('junk'), '', 'formatDate junk → empty');

    // month markers
    eq(monthChanged(null, '2026-07-09'), false, 'month marker: never above the first row');
    eq(monthChanged('2026-07-30', '2026-07-01'), false, 'month marker: same month → none');
    eq(monthChanged('2026-07-02', '2026-06-28'), true, 'month marker: month rolls over');
    eq(monthChanged('2026-01-05', '2025-12-28'), true, 'month marker: year boundary');
    eq(monthLabel('2026-07'), 'JULY 2026', 'month label JULY 2026');
    eq(monthKey('2026-07-09T01:02:03Z'), '2026-07', 'monthKey from ISO');

    // chunking math
    eq(chunkEnd(0, 60, 431), 60, 'chunk 1 ends at 60');
    eq(chunkEnd(420, 60, 431), 431, 'final partial chunk clamps to total');
    eq(chunkEnd(0, 60, 12), 12, 'short list: single partial chunk');

    // live phase text
    eq(phaseText('lobby'), 'NOT STARTED', 'phase lobby → NOT STARTED');
    eq(phaseText('picks'), 'PICKS', 'phase picks → PICKS');
    eq(phaseText('T6'), 'T6', 'phase T6 passes through');

    // number / stat formatting
    eq(fmtInt(1220), '1,220', 'fmtInt groups thousands');
    eq(fmtAvg(41.3), '41.3', 'fmtAvg keeps 1 decimal');
    eq(fmtAvg(12), '12.0', 'fmtAvg pads whole numbers');
    eq(fmtAvg(null), '—', 'fmtAvg null → em dash');
    eq(wlText(12, 4), '12–4', 'wlText en dash');
    eq(wlText(0, 0), '0–0', 'wlText zeros');

    // map resolution (string-safe)
    var pool = [{ id: '1390041', name: 'Strat 1v1' }, { id: '1579658', name: 'Guiroma' }];
    eq(findMap(pool, '1579658').name, 'Guiroma', 'findMap by string id');
    eq(findMap(pool, 1390041).name, 'Strat 1v1', 'findMap number id coerces');
    eq(findMap(pool, ' 1390041 ').name, 'Strat 1v1', 'findMap trims whitespace');
    eq(findMap(pool, '999'), null, 'findMap unknown id → null');
    eq(findMap([{ id: '1587197', name: 'Strategic 1v1', legacyIds: ['1390041'] }], '1390041').name,
      'Strategic 1v1', 'findMap resolves legacy ids to the canonical map');
    eq(findMap(pool, ''), null, 'findMap empty id → null');
    eq(findMap(null, '1'), null, 'findMap null pool → null');

    // templateId filtering (canonical ids, never names)
    var rows = [
      { gameId: 1, templateId: '1390041' },
      { gameId: 2, templateId: 1390041 },
      { gameId: 3, templateId: '1579658' },
      { gameId: 4 } // data-layer lag: no templateId → never matches
    ];
    eq(filterByTemplate(rows, '1390041').length, 2, 'filterByTemplate matches across types');
    eq(filterByTemplate(rows, '1579658').length, 1, 'filterByTemplate other map');
    eq(filterByTemplate(rows, '999').length, 0, 'filterByTemplate unknown → empty');
    eq(filterByTemplate(null, '1').length, 0, 'filterByTemplate null list → empty');

    // fact strip
    var facts = buildFacts({
      games: 1220, firstPlayed: '2025-12-16T01:40:32.270Z',
      lastPlayed: '2026-07-09T10:00:00Z', avgTurns: 11.4,
      mostActive: { id: '2', name: 'Farah♦', games: 78 }
    });
    eq(facts.length, 5, 'facts: five entries');
    eq(facts[0], { label: 'GAMES HOSTED', value: '1,220' }, 'facts: games hosted');
    eq(facts[1], { label: 'FIRST PLAYED', value: 'DEC 16 2025' }, 'facts: first played');
    eq(facts[2], { label: 'LAST PLAYED', value: 'JUL 9 2026' }, 'facts: last played');
    eq(facts[3], { label: 'AVG TURNS', value: '11.4' }, 'facts: avg turns');
    eq(facts[4], { label: 'MOST ACTIVE', value: 'Farah♦' }, 'facts: most active');
    var bare = buildFacts({ games: 0, firstPlayed: null, lastPlayed: null, avgTurns: null, mostActive: null });
    eq(bare[1].value, '—', 'facts: null first played → em dash');
    eq(bare[3].value, '—', 'facts: null avg turns → em dash');
    eq(bare[4].value, '—', 'facts: null most active → em dash');

    // title
    eq(pageTitle('Strat 1v1'), "STRAT 1V1 — M'HUNTERS LADDER", 'pageTitle uppercases the map');

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
    map: null,          // resolved pool-map entry from data.maps
    games: [],          // this map's decisive games (newest first)
    rosterNameById: {}, // playerId → name (active + reserve)
    filtered: [],       // alias of state.games (chunked rendering source)
    rendered: 0,
    lastIso: null,
    io: null,
    ioFallback: false,  // sentinel acts as a LOAD MORE button
    loaded: false
  };

  /* Zero-specificity fallback styles for everything map.js creates
     (rows, board cells, facts, month markers, skeletons, error state).
     css/maps.css owns the real look — :where() keeps these at
     specificity 0 so it always wins. */
  function injectTransientStyles() {
    if ($('map-transient-styles')) return;
    var css = [
      ':where(.g-skel){display:block;height:40px;margin:8px 12px;border-radius:4px;',
      'background:var(--line-soft,#222429);animation:g-sk 1.2s ease-in-out infinite}',
      '@keyframes g-sk{50%{opacity:.4}}',
      ':where(.load-error){font-family:"IBM Plex Mono",monospace;color:var(--muted,#9AA1AB);',
      'text-align:center;padding:2em 1em;letter-spacing:.05em}',
      ':where(.load-error) a,:where(#map-error) a{color:var(--red,#D22730)}',
      ':where(#map-error){font-family:"IBM Plex Mono",monospace;color:var(--muted,#9AA1AB);',
      'text-align:center;padding:2em 1em;letter-spacing:.05em}',
      /* fact strip */
      ':where(#map-facts){display:flex;flex-wrap:wrap;gap:8px 28px;padding:10px 12px}',
      ':where(#map-facts .fact){display:flex;flex-direction:column;gap:2px}',
      ':where(#map-facts .fact__label){font-family:"IBM Plex Mono",monospace;font-size:10px;',
      'letter-spacing:.14em;color:var(--dim,#8A919C)}',
      ':where(#map-facts .fact__value){font-family:"IBM Plex Mono",monospace;font-size:12.5px;',
      'letter-spacing:.05em;color:var(--white,#EDEFF2);text-transform:uppercase}',
      /* leaderboard cells */
      ':where(#map-board-body td){padding:8px 12px;border-bottom:1px solid var(--line-soft,#222429)}',
      ':where(#map-board-body .mb-rank){font-family:"IBM Plex Mono",monospace;color:var(--dim,#8A919C)}',
      ':where(#map-board-body .mb-rating){font-family:"Barlow Condensed","Arial Narrow",sans-serif;',
      'font-weight:700;font-size:16px;color:var(--white,#EDEFF2)}',
      ':where(#map-board-body .mb-wl){font-family:"IBM Plex Mono",monospace;white-space:nowrap}',
      ':where(#map-board-body .mb-games){font-family:"IBM Plex Mono",monospace;color:var(--dim,#8A919C)}',
      ':where(#map-board-body .mb-former){color:var(--muted,#9AA1AB)}',
      /* game / live rows — same anatomy + look as games.html */
      ':where(#map-games-list .g-row,#map-live-list .g-row){position:relative;display:block;',
      'padding:10px 110px 10px 12px;border-bottom:1px solid var(--line-soft,#222429);',
      'cursor:pointer;font-size:13px}',
      ':where(#map-games-list .g-row:hover,#map-live-list .g-row:hover){background:#1B1D22}',
      ':where(.g-row .feed-result__line){color:var(--white,#EDEFF2)}',
      ':where(.g-row .fr-winner){font-weight:600}',
      ':where(.g-row .fr-up){color:var(--red,#D22730);font-weight:600}',
      ':where(.g-row .fr-mid){color:var(--dim,#8A919C)}',
      ':where(.g-row .fr-loser){color:var(--muted,#9AA1AB)}',
      ':where(.g-row .fr-down){color:#7E8B9B}',
      ':where(.g-row .g-rating){font-family:"IBM Plex Mono",monospace;font-size:.85em;',
      'color:var(--dim,#8A919C);margin:0 .4em}',
      ':where(.g-row .feed-result__sub){display:flex;align-items:center;gap:8px;margin-top:4px;',
      'font-family:"IBM Plex Mono",monospace;font-size:10.5px;color:var(--dim,#8A919C);',
      'letter-spacing:.04em}',
      ':where(.g-row .fr-map){border:1px solid var(--line,#2A2D33);border-radius:3px;',
      'padding:1px 6px;white-space:nowrap}',
      ':where(.g-row .fr-go){color:var(--line,#2A2D33)}',
      ':where(#map-games-list .g-row:hover .fr-go,#map-live-list .g-row:hover .fr-go){color:var(--red,#D22730)}',
      ':where(.g-row .g-date){position:absolute;top:12px;right:12px;',
      'font-family:"IBM Plex Mono",monospace;font-size:10.5px;color:var(--dim,#8A919C);',
      'letter-spacing:.05em;white-space:nowrap}',
      ':where(.g-live-dot){color:var(--red,#D22730);margin-right:.45em}',
      ':where(.g-month){font-family:"IBM Plex Mono",monospace;font-size:10.5px;',
      'letter-spacing:.14em;color:var(--dim,#8A919C);padding:16px 12px 6px;',
      'border-bottom:1px solid var(--line-soft,#222429)}',
      ':where(.mg-empty){font-family:"IBM Plex Mono",monospace;color:var(--dim,#8A919C);',
      'text-align:center;padding:1.6em 1em;letter-spacing:.05em}',
      '@media (prefers-reduced-motion:reduce){:where(.g-skel){animation:none}}'
    ].join('');
    var style = doc.createElement('style');
    style.id = 'map-transient-styles';
    style.textContent = css;
    doc.head.appendChild(style);
  }

  /* ---------- masthead (same stats as index.html / games.html) ---------- */

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function renderMasthead(meta) {
    meta = meta || {};
    setText('stat-active', (meta.activeCount || 0) + ' ACTIVE');
    setText('stat-games', Number(meta.gamesPlayed || 0).toLocaleString('en-US') + ' GAMES');
    setText('stat-updated', 'Last Update ' + String(meta.lastUpdatedText || '—').toLowerCase());
    var live = $('stat-live');
    if (live && live.parentNode) live.parentNode.removeChild(live);
  }

  /* ---------- shared row bits (games.js conventions) ---------- */

  function isRosterId(id) {
    return id != null && state.rosterNameById[String(id)] !== undefined;
  }

  /* player-name node: <a.plink> to the profile for current roster players,
     plain span otherwise ('Former member' etc.) */
  function nameLink(name, cls, id) {
    var node;
    if (isRosterId(id)) {
      node = doc.createElement('a');
      node.className = cls ? 'plink ' + cls : 'plink';
      node.href = 'profile.html?p=' + encodeURIComponent(id);
    } else {
      node = doc.createElement('span');
      node.className = cls || '';
    }
    node.textContent = name;
    return node;
  }

  function ratingSpan(rating) {
    var span = doc.createElement('span');
    span.className = 'g-rating';
    span.textContent = rating != null ? String(rating) : '—';
    return span;
  }

  function dateSpan(text) {
    var span = doc.createElement('span');
    span.className = 'feed-time g-date';
    span.textContent = text;
    return span;
  }

  function gameUrl(gameId) {
    return 'https://www.warzone.com/MultiPlayer?GameID=' + encodeURIComponent(gameId || '');
  }

  /* rows are div[role=link] (names inside are real profile anchors; nested
     anchors are invalid HTML) — click / Enter opens the game in a new tab. */
  function rowShell(gameId, extraCls) {
    var item = doc.createElement('div');
    item.className = 'feed-item feed-item--result g-row' + (extraCls ? ' ' + extraCls : '');
    item.setAttribute('role', 'link');
    item.tabIndex = 0;
    item.title = 'View this game on warzone.com';
    item.dataset.url = gameUrl(gameId);
    return item;
  }

  function wireRowLinks(list) {
    if (!list) return;
    function open(e) {
      if (e.target && e.target.closest && e.target.closest('a')) return null;
      var row = e.target && e.target.closest ? e.target.closest('.g-row[data-url]') : null;
      return row && list.contains(row) ? row : null;
    }
    list.addEventListener('click', function (e) {
      var row = open(e);
      if (row) window.open(row.dataset.url, '_blank', 'noopener');
    });
    list.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var row = open(e);
      if (row) {
        e.preventDefault();
        window.open(row.dataset.url, '_blank', 'noopener');
      }
    });
  }

  /* ---------- result rows (same anatomy as games.html) ---------- */

  /* 'WINNER 1342 +12 def. LOSER 1262 −12' + map tag · T9 · JUL 9 2026 */
  function buildResultRow(r) {
    var item = rowShell(r.gameId);

    var line = doc.createElement('div');
    line.className = 'feed-result__line';
    line.appendChild(nameLink(r.winner, 'fr-winner', r.winnerId));
    line.appendChild(ratingSpan(r.wRating));
    var up = doc.createElement('span');
    up.className = 'fr-up';
    up.textContent = '+' + r.change;
    line.appendChild(up);
    var mid = doc.createElement('span');
    mid.className = 'fr-mid';
    mid.textContent = ' def. ';
    line.appendChild(mid);
    line.appendChild(nameLink(r.loser, 'fr-loser', r.loserId));
    line.appendChild(ratingSpan(r.lRating));
    var down = doc.createElement('span');
    down.className = 'fr-down';
    down.textContent = '−' + r.change;
    line.appendChild(down);
    item.appendChild(line);

    var sub = doc.createElement('div');
    sub.className = 'feed-result__sub';
    var mapTag = doc.createElement('span');
    mapTag.className = 'fr-map';
    mapTag.textContent = r.map;
    sub.appendChild(mapTag);
    if (r.turns != null) {
      var turns = doc.createElement('span');
      turns.className = 'g-turns';
      turns.textContent = 'T' + r.turns;
      sub.appendChild(turns);
    }
    var go = doc.createElement('span');
    go.className = 'fr-go';
    go.textContent = '↗';
    go.setAttribute('aria-hidden', 'true');
    sub.appendChild(go);
    item.appendChild(sub);

    item.appendChild(dateSpan(formatDate(r.date)));
    return item;
  }

  function buildMonthMarker(iso) {
    var div = doc.createElement('div');
    div.className = 'g-month';
    div.textContent = monthLabel(monthKey(iso));
    div.setAttribute('role', 'separator');
    return div;
  }

  /* ---------- live rows ---------- */

  /* '● ANAME 1342 vs BNAME 1262' + map tag · NOT STARTED · STARTED JUN 26 2026 */
  function buildLiveRow(g) {
    var item = rowShell(g.gameId, 'g-row--live');

    var line = doc.createElement('div');
    line.className = 'feed-result__line';
    var dot = doc.createElement('span');
    dot.className = 'g-live-dot';
    dot.textContent = '●';
    dot.setAttribute('aria-hidden', 'true');
    line.appendChild(dot);
    line.appendChild(nameLink(g.aName, 'fr-winner g-name', g.aId));
    line.appendChild(ratingSpan(g.aRating));
    var vs = doc.createElement('span');
    vs.className = 'fr-mid';
    vs.textContent = ' vs ';
    line.appendChild(vs);
    line.appendChild(nameLink(g.bName, 'fr-winner g-name', g.bId));
    line.appendChild(ratingSpan(g.bRating));
    item.appendChild(line);

    var sub = doc.createElement('div');
    sub.className = 'feed-result__sub';
    var mapTag = doc.createElement('span');
    mapTag.className = 'fr-map';
    mapTag.textContent = g.map;
    sub.appendChild(mapTag);
    var phase = doc.createElement('span');
    phase.className = 'g-phase';
    phase.textContent = phaseText(g.phase);
    sub.appendChild(phase);
    var go = doc.createElement('span');
    go.className = 'fr-go';
    go.textContent = '↗';
    go.setAttribute('aria-hidden', 'true');
    sub.appendChild(go);
    item.appendChild(sub);

    item.appendChild(dateSpan('STARTED ' + formatDate(g.started)));
    return item;
  }

  function renderLive(liveOnMap) {
    var list = $('map-live-list');
    var empty = $('map-live-empty');
    if (empty && !empty.textContent.trim()) {
      empty.textContent = 'NO LIVE GAMES ON THIS MAP';
    }
    if (!list) return;
    list.textContent = '';
    if (!liveOnMap.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    liveOnMap.forEach(function (g) {
      list.appendChild(buildLiveRow(g));
    });
  }

  /* ---------- fact strip ---------- */

  function renderFacts(m) {
    var strip = $('map-facts');
    if (!strip) return;
    strip.textContent = '';
    buildFacts(m).forEach(function (f) {
      var item = doc.createElement('div');
      item.className = 'fact';
      var label = doc.createElement('span');
      label.className = 'fact__label';
      label.textContent = f.label;
      item.appendChild(label);
      var value = doc.createElement('span');
      value.className = 'fact__value';
      value.textContent = f.value;
      if (f.label === 'MOST ACTIVE' && m.mostActive && m.mostActive.games != null) {
        value.title = m.mostActive.games + ' games on this map';
      }
      item.appendChild(value);
      strip.appendChild(item);
    });
  }

  /* ---------- per-map ELO leaderboard ---------- */

  function td(cls, text) {
    var cell = doc.createElement('td');
    cell.className = cls;
    cell.textContent = text;
    return cell;
  }

  /* rank number plain (no medals, no insignia — locked decision);
     departed players listed but NOT linked to a profile */
  function buildBoardRow(entry, rankNum) {
    var tr = doc.createElement('tr');
    tr.appendChild(td('mb-rank', String(rankNum)));

    var player = doc.createElement('td');
    player.className = 'mb-player';
    if (entry.departed) {
      var span = doc.createElement('span');
      span.className = 'mb-former';
      span.textContent = entry.name;
      span.title = 'No longer in the clan';
      player.appendChild(span);
    } else {
      var a = doc.createElement('a');
      a.className = 'plink';
      a.href = 'profile.html?p=' + encodeURIComponent(entry.id);
      a.textContent = entry.name;
      player.appendChild(a);
    }
    tr.appendChild(player);

    tr.appendChild(td('mb-rating', String(entry.rating)));
    tr.appendChild(td('mb-wl', wlText(entry.w, entry.l)));
    tr.appendChild(td('mb-games', fmtInt(entry.games)));
    return tr;
  }

  function renderBoard(board) {
    var body = $('map-board-body');
    var empty = $('map-board-empty');
    if (empty) {
      empty.textContent = 'NO RANKINGS YET — 3 GAMES ON THIS MAP TO BE RANKED';
    }
    if (!body) return;
    body.textContent = '';
    board = board || [];
    if (!board.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    var frag = doc.createDocumentFragment();
    for (var i = 0; i < board.length; i++) {
      frag.appendChild(buildBoardRow(board[i], i + 1));
    }
    body.appendChild(frag);
  }

  /* ---------- games list (chunked + month markers) ---------- */

  function sentinelEl() { return $('map-games-sentinel'); }

  /* rows are appended before the sentinel when it lives inside #map-games-list */
  function appendToGames(node) {
    var list = $('map-games-list');
    if (!list) return;
    var s = sentinelEl();
    if (s && s.parentNode === list) list.insertBefore(node, s);
    else list.appendChild(node);
  }

  function clearGamesList() {
    var list = $('map-games-list');
    if (!list) return;
    var s = sentinelEl();
    if (s && s.parentNode === list) {
      var node = list.firstChild;
      while (node) {
        var next = node.nextSibling;
        if (node !== s) list.removeChild(node);
        node = next;
      }
    } else {
      list.textContent = '';
    }
  }

  function updateSentinel() {
    var s = sentinelEl();
    if (!s) return;
    var done = state.rendered >= state.filtered.length;
    s.hidden = done;
    if (state.ioFallback) {
      s.textContent = done ? '' : 'LOAD MORE';
    }
  }

  function renderChunk() {
    if (state.rendered >= state.filtered.length) { updateSentinel(); return; }
    var end = chunkEnd(state.rendered, CHUNK, state.filtered.length);
    var frag = doc.createDocumentFragment();
    for (var i = state.rendered; i < end; i++) {
      var r = state.filtered[i];
      if (monthChanged(state.lastIso, r.date)) frag.appendChild(buildMonthMarker(r.date));
      frag.appendChild(buildResultRow(r));
      state.lastIso = r.date;
    }
    appendToGames(frag);
    state.rendered = end;
    updateSentinel();
  }

  function renderGamesFresh() {
    state.filtered = state.games;
    state.rendered = 0;
    state.lastIso = null;
    clearGamesList();
    if (!state.filtered.length) {
      var note = doc.createElement('div');
      note.className = 'mg-empty';
      note.textContent = 'NO GAMES ON THIS MAP YET';
      appendToGames(note);
      updateSentinel();
      return;
    }
    renderChunk();
  }

  function wireSentinel() {
    var s = sentinelEl();
    if (!s) return;
    if (typeof IntersectionObserver === 'function') {
      state.io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            if (state.loaded) renderChunk();
            return;
          }
        }
      }, { rootMargin: '400px 0px' });
      state.io.observe(s);
    } else {
      // fallback: the sentinel behaves as a LOAD MORE button
      state.ioFallback = true;
      s.setAttribute('role', 'button');
      s.tabIndex = 0;
      s.textContent = 'LOAD MORE';
      s.addEventListener('click', function () { renderChunk(); });
      s.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          renderChunk();
        }
      });
    }
  }

  /* ---------- loading / error / not-found states ---------- */

  function renderSkeleton() {
    var facts = $('map-facts');
    if (facts) {
      facts.textContent = '';
      var fbar = doc.createElement('div');
      fbar.className = 'g-skel';
      fbar.style.width = '60%';
      fbar.setAttribute('aria-hidden', 'true');
      facts.appendChild(fbar);
    }
    var body = $('map-board-body');
    if (body) {
      body.textContent = '';
      for (var i = 0; i < 5; i++) {
        var tr = doc.createElement('tr');
        var cell = doc.createElement('td');
        cell.colSpan = 5;
        var bar = doc.createElement('div');
        bar.className = 'g-skel';
        bar.setAttribute('aria-hidden', 'true');
        cell.appendChild(bar);
        tr.appendChild(cell);
        body.appendChild(tr);
      }
    }
    ['map-live-list', 'map-games-list'].forEach(function (id) {
      var list = $(id);
      if (!list) return;
      if (id === 'map-games-list') clearGamesList(); else list.textContent = '';
      var n = id === 'map-games-list' ? 6 : 3;
      for (var j = 0; j < n; j++) {
        var row = doc.createElement('div');
        row.className = 'g-skel';
        row.setAttribute('aria-hidden', 'true');
        if (id === 'map-games-list') appendToGames(row); else list.appendChild(row);
      }
    });
    var s = sentinelEl();
    if (s) s.hidden = true;
  }

  function clearAllZones() {
    var facts = $('map-facts');
    if (facts) facts.textContent = '';
    var body = $('map-board-body');
    if (body) body.textContent = '';
    var live = $('map-live-list');
    if (live) live.textContent = '';
    clearGamesList();
    var s = sentinelEl();
    if (s) s.hidden = true;
    ['map-board-empty', 'map-live-empty'].forEach(function (id) {
      var el = $(id);
      if (el) el.hidden = true;
    });
  }

  /* page-level error slot (#map-error) hosts both failure modes:
     unknown template id → MAP NOT FOUND, fetch failure → RETRY */
  function showPageError(kind) {
    clearAllZones();
    var err = $('map-error');
    if (!err) return;
    err.textContent = '';
    var a = doc.createElement('a');
    if (kind === 'notfound') {
      err.appendChild(doc.createTextNode('MAP NOT FOUND — '));
      a.href = 'maps.html';
      a.textContent = 'ALL MAPS';
    } else {
      err.appendChild(doc.createTextNode('LADDER DATA UNREACHABLE — '));
      a.href = '#';
      a.textContent = 'RETRY';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        window.location.reload();
      });
    }
    err.appendChild(a);
    err.hidden = false;
  }

  /* ---------- main ---------- */

  function readTemplateParam() {
    try {
      var t = new URLSearchParams(window.location.search).get('t');
      return t == null ? '' : t.trim();
    } catch (err) {
      return '';
    }
  }

  /* resolve a raw ?t= value to the canonical current template id.
     Track A's data layer owns legacy-id resolution — use its resolver when
     exposed; otherwise the raw id doubles as canonical (no legacy ids today). */
  function canonicalId(raw) {
    var api = window.LadderData;
    if (api && typeof api.resolveTemplateId === 'function') {
      try {
        var r = api.resolveTemplateId(raw);
        if (r != null && r !== '') return String(r);
      } catch (err) { /* fall through to raw */ }
    }
    return String(raw == null ? '' : raw).trim();
  }

  function buildRoster(data) {
    state.rosterNameById = {};
    (data.active || []).concat(data.reserve || []).forEach(function (p) {
      if (p == null || p.id == null) return;
      state.rosterNameById[String(p.id)] = p.name;
    });
  }

  function onData(data) {
    data = data || {};
    renderMasthead(data.meta);

    if (!data.maps || typeof data.maps.length !== 'number') {
      console.error('[map] data.maps missing from the LadderData payload — is track A’s derive.js in place?');
      showPageError('load');
      return;
    }

    var id = canonicalId(readTemplateParam());
    var map = findMap(data.maps, id);
    if (!map) {
      showPageError('notfound');
      return;
    }

    state.map = map;
    state.loaded = true;
    buildRoster(data);

    var errSlot = $('map-error');
    if (errSlot) errSlot.hidden = true;

    doc.title = pageTitle(map.name);
    setText('map-name', map.name);

    renderFacts(map);
    renderBoard(map.board);
    renderLive(filterByTemplate(data.live, map.id));
    state.games = filterByTemplate(data.allResults, map.id); // newest first already
    renderGamesFresh();
  }

  function init() {
    injectTransientStyles();
    wireSentinel();
    wireRowLinks($('map-games-list'));
    wireRowLinks($('map-live-list'));
    renderSkeleton();

    if (!window.LadderData || typeof window.LadderData.load !== 'function') {
      console.error('[map] window.LadderData.load is missing — is js/derive.js loaded before js/map.js?');
      showPageError('load');
      return;
    }

    window.LadderData.load().then(onData).catch(function (err) {
      console.error('[map] ladder data load failed', err);
      showPageError('load');
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
