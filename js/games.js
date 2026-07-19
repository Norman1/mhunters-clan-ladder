/* ============================================================
   M'Hunters Clan Ladder — Games page wiring (Track C)
   Plain vanilla script (no modules). Depends on:
     window.LadderData (js/derive.js) — LadderData.load()
   DOM contract (provided by games.html / track B):
     #tab-live #tab-results #live-view #results-view
     #live-list #results-list #results-toolbar
     #filter-player (+ #player-options datalist) #filter-map
     #filter-from #filter-to #filter-clear #results-count
     #results-sentinel #live-empty #results-empty
   URL params: ?tab=live|results & p=<playerId|text> & map=<name>
               & from=YYYY-MM & to=YYYY-MM
   Self-test: `node js/games.js` runs the pure-helper test suite.
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

  /* NFKD-normalize, strip combining marks, strip everything that is not a
     letter or digit (unicode-aware), lowercase — same fold as app.js. */
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

  /* ISO date → 'JUL 9 2026' (parses the date part directly; no TZ drift) */
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

  /* inclusive month-range check; from/to are 'YYYY-MM' or '' (open end) */
  function inMonthRange(iso, from, to) {
    var k = monthKey(iso);
    if (!k) return !from && !to;
    if (from && k < from) return false;
    if (to && k > to) return false;
    return true;
  }

  /* player filter matches EITHER side by folded-name substring */
  function matchesPlayer(r, qNorm) {
    if (!qNorm) return true;
    return normalizeName(r.winner).indexOf(qNorm) !== -1 ||
           normalizeName(r.loser).indexOf(qNorm) !== -1;
  }

  /* AND-combine all filters. f = { player (raw text), map, from, to } */
  function applyFilters(list, f) {
    f = f || {};
    var qNorm = normalizeName(f.player || '');
    var map = f.map || '';
    var from = f.from || '';
    var to = f.to || '';
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (qNorm && !matchesPlayer(r, qNorm)) continue;
      if (map && r.map !== map) continue;
      if ((from || to) && !inMonthRange(r.date, from, to)) continue;
      out.push(r);
    }
    return out;
  }

  /* chunking math: index one past the last row of the next chunk */
  function chunkEnd(start, size, total) {
    return Math.min(start + size, total);
  }

  function countText(n, filtered) {
    var base = Number(n || 0).toLocaleString('en-US') + ' GAMES';
    return filtered ? base + ' · FILTERED' : base;
  }

  /* live phase → display text */
  function phaseText(phase) {
    if (phase === 'lobby') return 'NOT STARTED';
    if (phase === 'picks') return 'PICKS';
    return phase ? String(phase).toUpperCase() : '—';
  }

  /* filter text → URL p param: roster player's id when the text names one
     (raw match first, then folded match), otherwise the raw text.
     roster = [{ id, name }] */
  function textToParam(text, roster) {
    var t = String(text == null ? '' : text).trim();
    if (!t) return '';
    var i;
    for (i = 0; i < roster.length; i++) {
      if (roster[i].name === t) return String(roster[i].id);
    }
    var n = normalizeName(t);
    if (n) {
      for (i = 0; i < roster.length; i++) {
        if (normalizeName(roster[i].name) === n) return String(roster[i].id);
      }
    }
    return t;
  }

  /* URL p param → filter text: roster name when p is a roster id, else raw */
  function paramToText(p, nameById) {
    var key = String(p == null ? '' : p);
    return (nameById && nameById[key]) || key;
  }

  function validMonth(s) {
    return /^\d{4}-\d{2}$/.test(String(s || '')) ? s : '';
  }

  function tabCountLabel(label, n) {
    return label + ' · ' + Number(n || 0).toLocaleString('en-US');
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

    console.log('games.js pure-helper self-test');

    // name folding
    eq(normalizeName('Farah♦'), 'farah', 'normalizeName folds Farah♦ → farah');
    eq(normalizeName('(CZ-SK)eXitus'), 'czskexitus', 'normalizeName strips punctuation');
    eq(normalizeName(null), '', 'normalizeName null-safe');

    // player matching (either side, substring, folded)
    eq(matchesPlayer({ winner: 'Farah♦', loser: 'Gatsu12' }, 'farah'), true,
      "player match: 'farah' hits winner Farah♦");
    eq(matchesPlayer({ winner: 'Tim', loser: 'Farah' }, 'farah'), true,
      "player match: 'farah' hits loser Farah");
    eq(matchesPlayer({ winner: 'Tim', loser: 'Ree' }, 'farah'), false,
      'player match: no side matches');
    eq(matchesPlayer({ winner: 'Gatsu12', loser: 'Tim' }, normalizeName('gAtSu')), true,
      'player match: case-insensitive substring');
    eq(matchesPlayer({ winner: 'Tim', loser: 'Ree' }, ''), true,
      'player match: empty query matches all');

    // month-range inclusivity
    eq(inMonthRange('2026-07-09T12:00:00Z', '2026-07', '2026-07'), true,
      'month range: from == to == game month is inclusive');
    eq(inMonthRange('2026-07-01T00:00:00Z', '2026-07', ''), true,
      'month range: first day of from-month included');
    eq(inMonthRange('2026-07-31T23:59:59Z', '', '2026-07'), true,
      'month range: last day of to-month included');
    eq(inMonthRange('2026-06-30T23:59:59Z', '2026-07', ''), false,
      'month range: month before from excluded');
    eq(inMonthRange('2026-08-01T00:00:00Z', '', '2026-07'), false,
      'month range: month after to excluded');
    eq(inMonthRange('2026-07-09T12:00:00Z', '', ''), true,
      'month range: open range matches');

    // month markers
    eq(monthChanged(null, '2026-07-09'), false, 'month marker: never above the first row');
    eq(monthChanged('2026-07-30', '2026-07-01'), false, 'month marker: same month → none');
    eq(monthChanged('2026-07-02', '2026-06-28'), true, 'month marker: month rolls over');
    eq(monthChanged('2026-01-05', '2025-12-28'), true, 'month marker: year boundary');
    eq(monthLabel('2026-07'), 'JULY 2026', 'month label JULY 2026');
    eq(monthLabel('2025-12'), 'DECEMBER 2025', 'month label DECEMBER 2025');
    eq(monthKey('2026-07-09T01:02:03Z'), '2026-07', 'monthKey from ISO');

    // dates
    eq(formatDate('2026-07-09T01:02:03Z'), 'JUL 9 2026', "formatDate → 'JUL 9 2026'");
    eq(formatDate('2025-12-16T01:40:32.270Z'), 'DEC 16 2025', 'formatDate december');
    eq(formatDate('junk'), '', 'formatDate junk → empty');

    // chunking math
    eq(chunkEnd(0, 60, 1220), 60, 'chunk 1 ends at 60');
    eq(chunkEnd(60, 60, 1220), 120, 'chunk 2 ends at 120');
    eq(chunkEnd(1200, 60, 1220), 1220, 'final partial chunk clamps to total');
    eq(chunkEnd(0, 60, 25), 25, 'short list: single partial chunk');
    eq(Math.ceil(1220 / 60), 21, '1,220 games → 21 chunks');

    // count readout
    eq(countText(1220, false), '1,220 GAMES', 'count plain');
    eq(countText(312, true), '312 GAMES · FILTERED', 'count filtered');

    // live phase text
    eq(phaseText('lobby'), 'NOT STARTED', 'phase lobby → NOT STARTED');
    eq(phaseText('picks'), 'PICKS', 'phase picks → PICKS');
    eq(phaseText('T6'), 'T6', 'phase T6 passes through');

    // combined filters (AND)
    var fx = [
      { date: '2026-07-09T10:00:00Z', winner: 'Farah♦', loser: 'Gatsu12', map: 'Strat 1v1' },
      { date: '2026-06-15T10:00:00Z', winner: 'Tim', loser: 'Farah', map: 'Guiroma' },
      { date: '2025-12-20T10:00:00Z', winner: 'Ree', loser: 'Tim', map: 'Strat 1v1' }
    ];
    eq(applyFilters(fx, { player: 'farah' }).length, 2, 'filter: player only');
    eq(applyFilters(fx, { map: 'Strat 1v1' }).length, 2, 'filter: map only');
    eq(applyFilters(fx, { from: '2025-12', to: '2025-12' }).length, 1, 'filter: single-month range');
    eq(applyFilters(fx, { player: 'tim', from: '2026-06', to: '2026-07' }).length, 1,
      'filter: player AND range');
    eq(applyFilters(fx, { player: 'farah', map: 'Guiroma' }).length, 1, 'filter: player AND map');
    eq(applyFilters(fx, {}).length, 3, 'filter: none active → all');

    // URL p param resolution
    var roster = [{ id: '2', name: 'Farah♦' }, { id: '9', name: 'Gatsu12' }];
    var byId = { 2: 'Farah♦', 9: 'Gatsu12' };
    eq(textToParam('Farah♦', roster), '2', 'p param: exact roster name → id');
    eq(textToParam('farah', roster), '2', 'p param: folded roster name → id');
    eq(textToParam('far', roster), 'far', 'p param: partial text stays text');
    eq(textToParam('  ', roster), '', 'p param: blank → empty');
    eq(paramToText('9', byId), 'Gatsu12', 'p param: id → roster name');
    eq(paramToText('far', byId), 'far', 'p param: non-id text passes through');

    // misc
    eq(validMonth('2026-07'), '2026-07', 'validMonth accepts YYYY-MM');
    eq(validMonth('july'), '', 'validMonth rejects junk');
    eq(tabCountLabel('RESULTS', 1220), 'RESULTS · 1,220', 'tab badge label');

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
    data: null,
    all: [],            // allResults (decisive, newest first)
    live: [],           // live games (newest started first)
    rosterNameById: {}, // playerId → name (active + reserve)
    rosterList: [],     // [{ id, name }] for p-param resolution
    filtered: [],
    rendered: 0,        // rows of state.filtered already in the DOM
    lastIso: null,      // date of the last rendered row (month markers)
    tab: 'live',
    io: null,
    ioFallback: false,  // sentinel acts as a LOAD MORE button
    filterTimer: null,
    loaded: false
  };

  /* Zero-specificity fallback styles for everything games.js creates
     (rows, month markers, skeletons, error state). css/games.css owns the
     real look — :where() keeps these at specificity 0 so it always wins. */
  function injectTransientStyles() {
    if ($('games-transient-styles')) return;
    var css = [
      ':where(.g-skel){display:block;height:40px;margin:8px 12px;border-radius:4px;',
      'background:var(--line-soft,#222429);animation:g-sk 1.2s ease-in-out infinite}',
      '@keyframes g-sk{50%{opacity:.4}}',
      ':where(.load-error){font-family:"IBM Plex Mono",monospace;color:var(--muted,#9AA1AB);',
      'text-align:center;padding:2em 1em;letter-spacing:.05em}',
      ':where(.load-error) a{color:var(--red,#D22730)}',
      ':where(#results-list .g-row,#live-list .g-row){position:relative;display:block;',
      'padding:10px 110px 10px 12px;border-bottom:1px solid var(--line-soft,#222429);',
      'cursor:pointer;font-size:13px}',
      ':where(#results-list .g-row:hover,#live-list .g-row:hover){background:#1B1D22}',
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
      ':where(#results-list .g-row:hover .fr-go,#live-list .g-row:hover .fr-go){color:var(--red,#D22730)}',
      ':where(.g-row .g-date){position:absolute;top:12px;right:12px;',
      'font-family:"IBM Plex Mono",monospace;font-size:10.5px;color:var(--dim,#8A919C);',
      'letter-spacing:.05em;white-space:nowrap}',
      ':where(.g-live-dot){color:var(--red,#D22730);margin-right:.45em}',
      ':where(.g-month){font-family:"IBM Plex Mono",monospace;font-size:10.5px;',
      'letter-spacing:.14em;color:var(--dim,#8A919C);padding:16px 12px 6px;',
      'border-bottom:1px solid var(--line-soft,#222429)}',
      '@media (prefers-reduced-motion:reduce){:where(.g-skel){animation:none}}'
    ].join('');
    var style = doc.createElement('style');
    style.id = 'games-transient-styles';
    style.textContent = css;
    doc.head.appendChild(style);
  }

  /* ---------- masthead (same stats as index.html) ---------- */

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

  /* ---------- shared row bits ---------- */

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
     anchors are invalid HTML) — click / Enter opens the game in a new tab.
     Open/keyboard handling is delegated per list in wireRowLinks(). */
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

  /* ---------- results rows ---------- */

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

  /* '● ANAME 1342 vs BNAME 1262' + map tag · T6 · STARTED JUN 26 2026 */
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

  function renderLive() {
    var list = $('live-list');
    var empty = $('live-empty');
    if (empty) empty.textContent = 'NO LIVE GAMES — NORMAN RUNS EVERY 2 HOURS';
    if (!list) return;
    list.textContent = '';
    if (!state.live.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    state.live.forEach(function (g) {
      list.appendChild(buildLiveRow(g));
    });
  }

  /* ---------- results rendering (chunked + month markers) ---------- */

  function sentinelEl() { return $('results-sentinel'); }

  /* rows are appended before the sentinel when it lives inside #results-list */
  function appendToResults(node) {
    var list = $('results-list');
    if (!list) return;
    var s = sentinelEl();
    if (s && s.parentNode === list) list.insertBefore(node, s);
    else list.appendChild(node);
  }

  function clearResultsList() {
    var list = $('results-list');
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
    appendToResults(frag);
    state.rendered = end;
    updateSentinel();
  }

  function anyFilterActive() {
    var f = currentFilters();
    return !!(f.player || f.map || f.from || f.to);
  }

  function currentFilters() {
    var player = $('filter-player');
    var map = $('filter-map');
    var from = $('filter-from');
    var to = $('filter-to');
    return {
      player: player ? player.value.trim() : '',
      map: map ? map.value : '',
      from: from ? validMonth(from.value) : '',
      to: to ? validMonth(to.value) : ''
    };
  }

  function renderResultsFresh() {
    state.filtered = applyFilters(state.all, currentFilters());
    state.rendered = 0;
    state.lastIso = null;
    clearResultsList();
    setText('results-count', countText(state.filtered.length, anyFilterActive()));
    var empty = $('results-empty');
    if (empty) {
      if (!empty.textContent.trim()) empty.textContent = 'NO GAMES MATCH THESE FILTERS';
      empty.hidden = state.filtered.length > 0;
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

  /* ---------- tabs ---------- */

  function setTab(tab, writeToUrl) {
    state.tab = tab === 'live' ? 'live' : 'results';
    var tl = $('tab-live'), tr = $('tab-results');
    var vl = $('live-view'), vr = $('results-view');
    if (tl) {
      tl.setAttribute('aria-selected', state.tab === 'live' ? 'true' : 'false');
      tl.classList.toggle('active', state.tab === 'live');
    }
    if (tr) {
      tr.setAttribute('aria-selected', state.tab === 'results' ? 'true' : 'false');
      tr.classList.toggle('active', state.tab === 'results');
    }
    if (vl) vl.hidden = state.tab !== 'live';
    if (vr) vr.hidden = state.tab !== 'results';
    if (writeToUrl) writeUrl();
  }

  /* tab badge: 'LIVE · 17' — fills a dedicated count element when the button
     has one ([data-count] / .tab-count), otherwise sets the whole label */
  function setTabBadge(btn, label, n) {
    if (!btn) return;
    var slot = btn.querySelector('[data-count], .tab-count, .tab__count, .count');
    if (slot) slot.textContent = Number(n || 0).toLocaleString('en-US');
    else btn.textContent = tabCountLabel(label, n);
  }

  function updateTabCounts() {
    setTabBadge($('tab-live'), 'LIVE', state.live.length);
    setTabBadge($('tab-results'), 'RESULTS', state.all.length);
  }

  function wireTabs() {
    var tl = $('tab-live'), tr = $('tab-results');
    if (tl) tl.addEventListener('click', function () { setTab('live', true); });
    if (tr) tr.addEventListener('click', function () { setTab('results', true); });
    // two-tab roving with arrow keys
    function arrows(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var next = state.tab === 'live' ? 'results' : 'live';
      setTab(next, true);
      var btn = $(next === 'live' ? 'tab-live' : 'tab-results');
      if (btn) btn.focus();
    }
    if (tl) tl.addEventListener('keydown', arrows);
    if (tr) tr.addEventListener('keydown', arrows);
  }

  /* ---------- URL sync (deep links work both ways) ---------- */

  function writeUrl() {
    var params = new URLSearchParams();
    if (state.tab === 'results') params.set('tab', 'results');
    var f = currentFilters();
    var p = textToParam(f.player, state.rosterList);
    if (p) params.set('p', p);
    if (f.map) params.set('map', f.map);
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
    var qs = params.toString();
    try {
      history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
    } catch (err) { /* file:// etc. — non-fatal */ }
  }

  function readParams() {
    try {
      return new URLSearchParams(window.location.search);
    } catch (err) {
      return { get: function () { return null; } };
    }
  }

  /* set the filter controls from the URL (after options are populated) */
  function applyParamsToControls(params) {
    var player = $('filter-player');
    var map = $('filter-map');
    var from = $('filter-from');
    var to = $('filter-to');
    var p = params.get('p');
    if (player && p) player.value = paramToText(p, state.rosterNameById);
    var m = params.get('map');
    if (map && m) {
      for (var i = 0; i < map.options.length; i++) {
        if (map.options[i].value === m) { map.value = m; break; }
      }
    }
    if (from) from.value = validMonth(params.get('from'));
    if (to) to.value = validMonth(params.get('to'));
  }

  /* ---------- filter controls ---------- */

  function fillPlayerOptions() {
    var dl = $('player-options');
    if (!dl) return;
    dl.textContent = '';
    var names = state.rosterList.map(function (r) { return r.name; });
    names.sort(function (a, b) {
      return normalizeName(a) < normalizeName(b) ? -1 : 1;
    });
    names.forEach(function (n) {
      var opt = doc.createElement('option');
      opt.value = n;
      dl.appendChild(opt);
    });
  }

  function fillMapOptions() {
    var sel = $('filter-map');
    if (!sel) return;
    var seen = {};
    var maps = [];
    state.all.forEach(function (r) {
      if (r.map && !seen[r.map]) { seen[r.map] = true; maps.push(r.map); }
    });
    maps.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
    sel.textContent = '';
    var all = doc.createElement('option');
    all.value = '';
    all.textContent = 'ALL TEMPLATES';
    sel.appendChild(all);
    maps.forEach(function (m) {
      var opt = doc.createElement('option');
      opt.value = m;
      opt.textContent = m;
      sel.appendChild(opt);
    });
  }

  function onFilterChange() {
    if (!state.loaded) return;
    writeUrl();
    renderResultsFresh();
  }

  function wireFilters() {
    var player = $('filter-player');
    if (player) {
      player.addEventListener('input', function () {
        if (state.filterTimer) clearTimeout(state.filterTimer);
        state.filterTimer = setTimeout(onFilterChange, 200);
      });
      player.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && player.value) {
          player.value = '';
          onFilterChange();
        }
      });
    }
    ['filter-map', 'filter-from', 'filter-to'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', onFilterChange);
    });
    var clear = $('filter-clear');
    if (clear) {
      clear.addEventListener('click', function () {
        var ids = { 'filter-player': '', 'filter-map': '', 'filter-from': '', 'filter-to': '' };
        Object.keys(ids).forEach(function (id) {
          var el = $(id);
          if (el) el.value = ids[id];
        });
        onFilterChange();
      });
    }
  }

  /* ---------- loading / error states ---------- */

  function renderSkeleton() {
    ['results-list', 'live-list'].forEach(function (id) {
      var list = $(id);
      if (!list) return;
      if (id === 'results-list') clearResultsList(); else list.textContent = '';
      for (var i = 0; i < 8; i++) {
        var bar = doc.createElement('div');
        bar.className = 'g-skel';
        bar.setAttribute('aria-hidden', 'true');
        if (id === 'results-list') appendToResults(bar); else list.appendChild(bar);
      }
    });
    var s = sentinelEl();
    if (s) s.hidden = true;
  }

  function renderLoadError() {
    ['results-list', 'live-list'].forEach(function (id) {
      var list = $(id);
      if (!list) return;
      if (id === 'results-list') clearResultsList(); else list.textContent = '';
      var div = doc.createElement('div');
      div.className = 'load-error';
      div.appendChild(doc.createTextNode('LADDER DATA UNREACHABLE — '));
      var a = doc.createElement('a');
      a.href = '#';
      a.textContent = 'RETRY';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        window.location.reload();
      });
      div.appendChild(a);
      if (id === 'results-list') appendToResults(div); else list.appendChild(div);
    });
    var s = sentinelEl();
    if (s) s.hidden = true;
  }

  /* ---------- main ---------- */

  function buildRoster(data) {
    state.rosterNameById = {};
    state.rosterList = [];
    (data.active || []).concat(data.reserve || []).forEach(function (p) {
      if (p == null || p.id == null) return;
      state.rosterNameById[String(p.id)] = p.name;
      state.rosterList.push({ id: String(p.id), name: p.name });
    });
  }

  function onData(data) {
    state.data = data || {};
    // allResults/live per the shared contract; results (capped 60) is a
    // safety net so the page still functions if the data layer lags behind.
    state.all = state.data.allResults || state.data.results || [];
    state.live = state.data.live || [];
    state.loaded = true;

    buildRoster(state.data);
    renderMasthead(state.data.meta);
    fillPlayerOptions();
    fillMapOptions();
    applyParamsToControls(readParams());
    updateTabCounts();
    renderLive();
    renderResultsFresh();
    writeUrl(); // normalize the URL (resolves p → id form, drops junk params)
  }

  function init() {
    doc.title = "M'HUNTERS — Games";
    injectTransientStyles();
    wireTabs();
    wireFilters();
    wireSentinel();
    wireRowLinks($('results-list'));
    wireRowLinks($('live-list'));
    setTab(readParams().get('tab') === 'results' ? 'results' : 'live', false);
    renderSkeleton();

    if (!window.LadderData || typeof window.LadderData.load !== 'function') {
      console.error('[games] window.LadderData.load is missing — is js/derive.js loaded before js/games.js?');
      renderLoadError();
      return;
    }

    window.LadderData.load().then(onData).catch(function (err) {
      console.error('[games] ladder data load failed', err);
      renderLoadError();
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
