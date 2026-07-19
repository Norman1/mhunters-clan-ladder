/* ============================================================
   M'Hunters Clan Ladder — Templates pool index wiring (Track C)
   Plain vanilla script (no modules). Depends on:
     window.LadderData (js/derive.js) — LadderData.load()
       → data.maps: [{ id, name, games, liveCount, firstPlayed,
                       lastPlayed, avgTurns, mostActive, topPlayer,
                       board }] sorted games desc (track A)
   DOM contract (provided by templates.html / track B):
     #maps-count (page-title '(17 IN POOL)' badge)
     #tab-cards #tab-table (CARDS | TABLE segmented control)
     #cards-view > #maps-grid (cards container) · #maps-error (hidden)
     #table-view > .maps-table > #maps-table-body (comparison table)
   Card = <a href="template.html?t=<id>"> with map name, '<games> GAMES',
   '● <n> LIVE' (red, only when >0), 'TOP PLAYER: <name> <rating>' or
   'NO RANKINGS YET'.
   Table = TEMPLATE · GAMES · TOP PLAYER · FIRST PLAYED · AVG TURNS, sortable
   headers (index.html pattern, GAMES desc default, nulls always last).
   URL param: ?view=table (CARDS is the unmarked default) via
   history.replaceState — deep links work.
   Self-test: `node js/templates.js` runs the pure-helper test suite.
   ============================================================ */

(function () {
  'use strict';

  /* ------------------------------------------------------------
     Pure helpers (no DOM — testable in node)
     ------------------------------------------------------------ */

  function fmtInt(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  /* card games line: '1,220 GAMES' */
  function gamesText(n) {
    return fmtInt(n) + ' GAMES';
  }

  /* card live line: '● 3 LIVE' — empty string when nothing is live */
  function liveText(n) {
    return n > 0 ? '● ' + fmtInt(n) + ' LIVE' : '';
  }

  /* card footer: 'TOP PLAYER: <name> <rating>' or 'NO RANKINGS YET'
     (topPlayer is null while no one has >= 3 decisive games on the map) */
  function topText(top) {
    if (!top || top.name == null) return 'NO RANKINGS YET';
    return 'TOP PLAYER: ' + top.name + ' ' + top.rating;
  }

  function detailUrl(id) {
    return 'template.html?t=' + encodeURIComponent(id == null ? '' : id);
  }

  /* page title count: '(17 IN POOL)' — '(— IN POOL)' pre-data */
  function rotationText(n) {
    return '(' + (n == null ? '—' : fmtInt(n)) + ' IN POOL)';
  }

  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  /* ISO date → 'DEC 19 2025' (js/template.js twin — parses the date part
     directly, no TZ drift); '—' when the map has never been played */
  function firstPlayedText(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (m) {
      var mo = parseInt(m[2], 10);
      if (mo >= 1 && mo <= 12) {
        return MONTHS[mo - 1] + ' ' + parseInt(m[3], 10) + ' ' + m[1];
      }
    }
    return '—';
  }

  /* AVG TURNS cell: one decimal ('23.0', '18.4') or '—' when null */
  function avgTurnsText(v) {
    return (typeof v === 'number' && isFinite(v)) ? v.toFixed(1) : '—';
  }

  /* ?view=table|cards — 'cards' is the default for anything else */
  function parseView(search) {
    var m = /[?&]view=([^&]*)/.exec(String(search || ''));
    return (m && m[1] === 'table') ? 'table' : 'cards';
  }

  /* ---------- table sorting (index.html SORTERS pattern) ----------
     Each key carries its sensible default direction (dir); state.dir
     flips it on the second click. `nul` marks rows with no value for
     the column — those ALWAYS sort last, in either direction. */

  function nameKey(m) {
    return String(m && m.name != null ? m.name : '').toUpperCase();
  }

  function firstPlayedTs(m) {
    var t = Date.parse(m && m.firstPlayed ? m.firstPlayed : '');
    return isNaN(t) ? null : t;
  }

  var MAP_SORTERS = {
    map:   { dir: 1,  cmp: function (a, b) { return nameKey(a) < nameKey(b) ? -1 : (nameKey(a) > nameKey(b) ? 1 : 0); } },
    games: { dir: -1, cmp: function (a, b) { return (a.games || 0) - (b.games || 0); } },
    top:   { dir: -1,
             nul: function (m) { return !m.topPlayer || m.topPlayer.rating == null; },
             cmp: function (a, b) { return a.topPlayer.rating - b.topPlayer.rating; } },
    first: { dir: 1,
             nul: function (m) { return firstPlayedTs(m) == null; },
             cmp: function (a, b) { return firstPlayedTs(a) - firstPlayedTs(b); } },
    turns: { dir: -1,
             nul: function (m) { return typeof m.avgTurns !== 'number' || !isFinite(m.avgTurns); },
             cmp: function (a, b) { return a.avgTurns - b.avgTurns; } }
  };

  /* new sorted copy; dir: 1 = the column's default direction, -1 = flipped.
     Ties (and null-vs-null) fall back to map name alpha for stability. */
  function sortMaps(maps, key, dir) {
    var s = MAP_SORTERS[key] || MAP_SORTERS.games;
    var arr = (maps || []).slice();
    arr.sort(function (a, b) {
      var an = s.nul ? s.nul(a) : false;
      var bn = s.nul ? s.nul(b) : false;
      if (an !== bn) return an ? 1 : -1; // nulls always last
      var d = an ? 0 : s.cmp(a, b) * s.dir * (dir || 1);
      if (d) return d;
      return nameKey(a) < nameKey(b) ? -1 : (nameKey(a) > nameKey(b) ? 1 : 0);
    });
    return arr;
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

    console.log('templates.js pure-helper self-test');

    eq(fmtInt(1220), '1,220', 'fmtInt groups thousands');
    eq(fmtInt(0), '0', 'fmtInt zero');
    eq(fmtInt(null), '0', 'fmtInt null-safe');

    eq(gamesText(1220), '1,220 GAMES', 'gamesText 1,220 GAMES');
    eq(gamesText(0), '0 GAMES', 'gamesText zero');

    eq(liveText(3), '● 3 LIVE', 'liveText shows dot + count when > 0');
    eq(liveText(1), '● 1 LIVE', 'liveText single live game');
    eq(liveText(0), '', 'liveText hidden at zero');
    eq(liveText(undefined), '', 'liveText null-safe');

    eq(topText({ id: '2', name: 'Farah♦', rating: 1342 }), 'TOP PLAYER: Farah♦ 1342',
      'topText names the #1 with map rating');
    eq(topText(null), 'NO RANKINGS YET', 'topText null → NO RANKINGS YET');

    eq(detailUrl('1390041'), 'template.html?t=1390041', 'detailUrl plain id');
    eq(detailUrl('a b'), 'template.html?t=a%20b', 'detailUrl encodes');
    eq(detailUrl(null), 'template.html?t=', 'detailUrl null-safe');

    eq(rotationText(17), '(17 IN POOL)', 'rotationText 17 maps');
    eq(rotationText(null), '(— IN POOL)', 'rotationText pre-data em-dash');

    eq(firstPlayedText('2025-12-19T01:40:32.270Z'), 'DEC 19 2025', "firstPlayedText → 'DEC 19 2025'");
    eq(firstPlayedText('2026-07-04T13:22:49.367Z'), 'JUL 4 2026', 'firstPlayedText strips leading zero');
    eq(firstPlayedText(null), '—', 'firstPlayedText null → em-dash');

    eq(avgTurnsText(23), '23.0', 'avgTurnsText pads to one decimal');
    eq(avgTurnsText(18.4), '18.4', 'avgTurnsText keeps one decimal');
    eq(avgTurnsText(null), '—', 'avgTurnsText null → em-dash');

    eq(parseView('?view=table'), 'table', 'parseView table');
    eq(parseView('?view=cards'), 'cards', 'parseView cards');
    eq(parseView(''), 'cards', 'parseView default cards');
    eq(parseView('?foo=1&view=table'), 'table', 'parseView table among other params');
    eq(parseView('?view=TABLE'), 'cards', 'parseView strict — unknown value falls back to cards');
    eq(parseView(null), 'cards', 'parseView null-safe');

    /* ---- sortMaps fixtures: nulls (no rankings / never played) mixed in ---- */
    var F = [
      { id: '1', name: 'Belarus',   games: 300, topPlayer: { id: 'p1', name: 'Crouton', rating: 1160 },
        firstPlayed: '2025-12-19T00:00:00Z', avgTurns: 12.5 },
      { id: '2', name: 'Aseria',    games: 500, topPlayer: { id: 'p2', name: 'Farah', rating: 1342 },
        firstPlayed: '2026-01-02T00:00:00Z', avgTurns: 9.1 },
      { id: '3', name: 'Zion',      games: 500, topPlayer: null,
        firstPlayed: '2025-12-16T00:00:00Z', avgTurns: null },
      { id: '4', name: 'Freshmap',  games: 0,   topPlayer: null,
        firstPlayed: null, avgTurns: null }
    ];
    var ids = function (arr) { return arr.map(function (m) { return m.id; }).join(','); };

    eq(ids(sortMaps(F, 'games', 1)), '2,3,1,4', 'sortMaps games desc default (tie → name alpha)');
    eq(ids(sortMaps(F, 'games', -1)), '4,1,2,3', 'sortMaps games flipped asc');
    eq(ids(sortMaps(F, 'map', 1)), '2,1,4,3', 'sortMaps map alpha asc default');
    eq(ids(sortMaps(F, 'map', -1)), '3,4,1,2', 'sortMaps map flipped desc');
    eq(ids(sortMaps(F, 'top', 1)), '2,1,4,3', 'sortMaps top rating desc — null topPlayer last');
    eq(ids(sortMaps(F, 'top', -1)), '1,2,4,3', 'sortMaps top flipped asc — nulls STILL last');
    eq(ids(sortMaps(F, 'first', 1)), '3,1,2,4', 'sortMaps first chronological — never-played last');
    eq(ids(sortMaps(F, 'first', -1)), '2,1,3,4', 'sortMaps first flipped — nulls STILL last');
    eq(ids(sortMaps(F, 'turns', 1)), '1,2,4,3', 'sortMaps turns desc — null avgTurns last (alpha among nulls)');
    eq(ids(sortMaps(F, 'turns', -1)), '2,1,4,3', 'sortMaps turns flipped asc — nulls STILL last');
    eq(ids(sortMaps(F, 'bogus', 1)), '2,3,1,4', 'sortMaps unknown key falls back to games desc');
    eq(ids(sortMaps(null, 'games', 1)), '', 'sortMaps null-safe input');

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
    view: 'cards',                    // 'cards' | 'table'
    sort: { key: 'games', dir: 1 },   // table sort; dir 1 = column default
    maps: null                        // data.maps once loaded
  };

  /* Zero-specificity fallback styles for everything maps.js creates.
     css/templates.css (track B) owns the real look — :where() keeps these at
     specificity 0 so it always wins. */
  function injectTransientStyles() {
    if ($('maps-transient-styles')) return;
    var css = [
      ':where(#maps-grid){display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}',
      ':where(#maps-grid .map-card){display:block;background:var(--card,#1B1D21);',
      'border:1px solid var(--line,#2A2D33);border-radius:6px;padding:14px 16px;',
      'transition:transform 180ms ease,border-color 180ms ease}',
      ':where(#maps-grid .map-card:hover){transform:translateY(-2px);border-color:var(--dim,#8A919C)}',
      ':where(.map-card__name){font-family:"Barlow Condensed","Arial Narrow",sans-serif;',
      'font-weight:700;font-size:20px;line-height:1.15;letter-spacing:.02em;',
      'color:var(--white,#F2F4F6);text-transform:uppercase}',
      ':where(.map-card__stats){display:flex;flex-wrap:wrap;gap:10px;margin-top:6px;',
      'font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.05em;',
      'color:var(--muted,#9AA1AB)}',
      ':where(.map-card__live){color:var(--red,#D22730)}',
      ':where(.map-card__top){margin-top:10px;font-family:"IBM Plex Mono",monospace;',
      'font-size:10.5px;letter-spacing:.08em;color:var(--dim,#8A919C);text-transform:uppercase}',
      ':where(.map-card__top-rating){font-family:"Barlow Condensed","Arial Narrow",sans-serif;',
      'font-weight:700;font-size:13px;color:var(--silver,#C6CDD6)}',
      ':where(.mcard-skel){display:block;height:112px;border-radius:6px;',
      'background:var(--line-soft,#222429);animation:m-sk 1.2s ease-in-out infinite}',
      '@keyframes m-sk{50%{opacity:.4}}',
      ':where(#maps-error){font-family:"IBM Plex Mono",monospace;color:var(--muted,#9AA1AB);',
      'text-align:center;padding:2em 1em;letter-spacing:.05em}',
      ':where(#maps-error) a{color:var(--red,#D22730)}',
      ':where(.title-count){font-family:"IBM Plex Mono",monospace;font-size:11px;',
      'letter-spacing:.08em;color:var(--dim,#8A919C)}',
      ':where(.mtabs){display:flex;gap:24px;border-bottom:1px solid var(--line,#2A2D33)}',
      ':where(.mtab){font-family:"Barlow Condensed","Arial Narrow",sans-serif;',
      'font-weight:700;font-size:20px;color:var(--muted,#9AA1AB);padding:6px 2px 10px;',
      'border-bottom:2px solid transparent}',
      ':where(.mtab[aria-selected="true"]){color:var(--white,#F2F4F6);',
      'border-bottom-color:var(--red,#D22730)}',
      ':where(.maps-table td){text-align:center}:where(.maps-table td.c-map){text-align:left}',
      ':where(.maps-table td.c-top .tp-rating){color:var(--dim,#8A919C);margin-left:6px}',
      '@media (prefers-reduced-motion:reduce){:where(.mcard-skel){animation:none}',
      ':where(#maps-grid .map-card:hover){transform:none}}'
    ].join('');
    var style = doc.createElement('style');
    style.id = 'maps-transient-styles';
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
    setText('stat-updated', 'Last Activity ' + String(meta.lastUpdatedText || '—').toLowerCase());
    var live = $('stat-live');
    if (live && live.parentNode) live.parentNode.removeChild(live);
  }

  /* ---------- cards ---------- */

  /* Card background: the map's real board (captured from warzone) etched
     behind the text — probe assets/maps/<id>.jpg; cards without an image
     simply keep the flat panel. */
  function applyCardArt(card, id) {
    // absolute URL: a relative url() inside a custom property resolves
    // against the consuming stylesheet (css/), not the document
    var src = new URL('assets/maps/' + id + '.jpg', doc.baseURI).href;
    var probe = new Image();
    probe.onload = function () {
      card.classList.add('map-card--art');
      card.style.setProperty('--card-art', 'url("' + src + '")');
    };
    probe.src = src;
  }

  function buildCard(m) {
    var a = doc.createElement('a');
    a.className = 'map-card';
    a.href = detailUrl(m.id);
    applyCardArt(a, m.id);

    var name = doc.createElement('h2');
    name.className = 'map-card__name';
    name.textContent = m.name != null ? m.name : 'TEMPLATE ' + m.id;
    a.appendChild(name);

    var stats = doc.createElement('div');
    stats.className = 'map-card__stats';
    var games = doc.createElement('span');
    games.className = 'map-card__games';
    games.textContent = gamesText(m.games);
    stats.appendChild(games);
    if (m.liveCount > 0) {
      var live = doc.createElement('span');
      live.className = 'map-card__live';
      live.textContent = liveText(m.liveCount);
      stats.appendChild(live);
    }
    a.appendChild(stats);

    var top = doc.createElement('div');
    if (m.topPlayer && m.topPlayer.name != null) {
      top.className = 'map-card__top';
      top.appendChild(doc.createTextNode('TOP PLAYER: '));
      var tn = doc.createElement('span');
      tn.className = 'map-card__top-name';
      tn.textContent = m.topPlayer.name;
      top.appendChild(tn);
      top.appendChild(doc.createTextNode(' '));
      var tr = doc.createElement('span');
      tr.className = 'map-card__top-rating';
      tr.textContent = String(m.topPlayer.rating);
      top.appendChild(tr);
    } else {
      top.className = 'map-card__top map-card__top--none';
      top.textContent = 'NO RANKINGS YET';
    }
    a.appendChild(top);

    return a;
  }

  function renderCards(maps) {
    var grid = $('maps-grid');
    if (!grid) return;
    grid.textContent = '';
    var frag = doc.createDocumentFragment();
    for (var i = 0; i < maps.length; i++) frag.appendChild(buildCard(maps[i]));
    grid.appendChild(frag);
  }

  /* ---------- CARDS | TABLE view toggle (games.js setTab lineage) ---------- */

  function setView(view, writeToUrl) {
    state.view = view === 'table' ? 'table' : 'cards';
    var tc = $('tab-cards'), tt = $('tab-table');
    var vc = $('cards-view'), vt = $('table-view');
    if (tc) tc.setAttribute('aria-selected', state.view === 'cards' ? 'true' : 'false');
    if (tt) tt.setAttribute('aria-selected', state.view === 'table' ? 'true' : 'false');
    if (vc) vc.hidden = state.view !== 'cards';
    if (vt) vt.hidden = state.view !== 'table';
    if (writeToUrl) writeViewToUrl();
  }

  /* ?view=table in the URL (CARDS is the unmarked default) — replaceState
     keeps toggling out of the back-button history; deep links work */
  function writeViewToUrl() {
    if (!window.history || typeof history.replaceState !== 'function') return;
    try {
      var params = new URLSearchParams(window.location.search);
      if (state.view === 'table') params.set('view', 'table');
      else params.delete('view');
      var qs = params.toString();
      history.replaceState(null, '',
        window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    } catch (e) { /* sandboxed/file: contexts — the toggle still works */ }
  }

  function wireTabs() {
    var tc = $('tab-cards'), tt = $('tab-table');
    if (tc) tc.addEventListener('click', function () { setView('cards', true); });
    if (tt) tt.addEventListener('click', function () { setView('table', true); });
    // two-tab roving with arrow keys (games.js parity)
    function onArrow(e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var next = state.view === 'cards' ? 'table' : 'cards';
      setView(next, true);
      var btn = $(next === 'cards' ? 'tab-cards' : 'tab-table');
      if (btn) btn.focus();
    }
    if (tc) tc.addEventListener('keydown', onArrow);
    if (tt) tt.addEventListener('keydown', onArrow);
  }

  /* ---------- comparison table ---------- */

  /* top-player name node: a.plink for roster players; departed players
     (board rows flagged by the data layer) are plain text, standings-wide */
  function topPlayerNode(m) {
    var departed = !!(m.board && m.board[0] && m.board[0].departed);
    var node;
    if (!departed && m.topPlayer.id != null) {
      node = doc.createElement('a');
      node.className = 'plink';
      node.href = 'profile.html?p=' + encodeURIComponent(m.topPlayer.id);
    } else {
      node = doc.createElement('span');
      if (departed) node.className = 'departed';
    }
    node.textContent = m.topPlayer.name;
    return node;
  }

  function buildTableRow(m) {
    var tr = doc.createElement('tr');

    var tdMap = doc.createElement('td');
    tdMap.className = 'c-map';
    var link = doc.createElement('a');
    link.href = detailUrl(m.id);
    link.textContent = m.name != null ? m.name : 'TEMPLATE ' + m.id;
    tdMap.appendChild(link);
    tr.appendChild(tdMap);

    var tdGames = doc.createElement('td');
    tdGames.className = 'c-games';
    tdGames.textContent = fmtInt(m.games);
    tr.appendChild(tdGames);

    var tdTop = doc.createElement('td');
    tdTop.className = 'c-top';
    if (m.topPlayer && m.topPlayer.name != null) {
      tdTop.appendChild(topPlayerNode(m));
      tdTop.appendChild(doc.createTextNode(' '));
      var rating = doc.createElement('span');
      rating.className = 'tp-rating';
      rating.textContent = String(m.topPlayer.rating);
      tdTop.appendChild(rating);
    } else {
      tdTop.className = 'c-top tp-none';
      tdTop.textContent = '—'; // no rankings yet
    }
    tr.appendChild(tdTop);

    var tdFirst = doc.createElement('td');
    tdFirst.className = 'c-first';
    tdFirst.textContent = firstPlayedText(m.firstPlayed);
    tr.appendChild(tdFirst);

    var tdTurns = doc.createElement('td');
    tdTurns.className = 'c-turns';
    tdTurns.textContent = avgTurnsText(m.avgTurns);
    tr.appendChild(tdTurns);

    return tr;
  }

  function renderTableBody() {
    var tbody = $('maps-table-body');
    if (!tbody || !state.maps) return;
    tbody.textContent = '';
    var sorted = sortMaps(state.maps, state.sort.key, state.sort.dir);
    var frag = doc.createDocumentFragment();
    for (var i = 0; i < sorted.length; i++) frag.appendChild(buildTableRow(sorted[i]));
    tbody.appendChild(frag);
  }

  /* ▲/▼ indicator + aria-sort on the active header (app.js pattern) */
  function updateSortHeaders() {
    var ths = doc.querySelectorAll('.maps-table thead th[data-sort]');
    Array.prototype.forEach.call(ths, function (th) {
      var key = th.getAttribute('data-sort');
      th.classList.remove('sort-asc', 'sort-desc');
      if (key === state.sort.key && MAP_SORTERS[key]) {
        var effective = MAP_SORTERS[key].dir * state.sort.dir;
        th.classList.add(effective === 1 ? 'sort-asc' : 'sort-desc');
        th.setAttribute('aria-sort', effective === 1 ? 'ascending' : 'descending');
      } else {
        th.removeAttribute('aria-sort');
      }
    });
  }

  function wireSorting() {
    var ths = doc.querySelectorAll('.maps-table thead th[data-sort]');
    Array.prototype.forEach.call(ths, function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (!MAP_SORTERS[key]) return;
        if (state.sort.key === key) {
          state.sort.dir = -state.sort.dir; // second click flips
        } else {
          state.sort = { key: key, dir: 1 }; // fresh column → its default dir
        }
        renderTableBody();
        updateSortHeaders();
      });
    });
  }

  /* ---------- loading / error states ---------- */

  function renderSkeleton() {
    var grid = $('maps-grid');
    if (!grid) return;
    grid.textContent = '';
    for (var i = 0; i < 9; i++) {
      var card = doc.createElement('div');
      card.className = 'mcard-skel';
      card.setAttribute('aria-hidden', 'true');
      grid.appendChild(card);
    }
  }

  function hideError() {
    var err = $('maps-error');
    if (err) err.hidden = true;
  }

  function renderLoadError() {
    var grid = $('maps-grid');
    if (grid) grid.textContent = '';
    var tbody = $('maps-table-body');
    if (tbody) tbody.textContent = '';
    var err = $('maps-error');
    if (!err) return;
    err.textContent = '';
    err.appendChild(doc.createTextNode('LADDER DATA UNREACHABLE — '));
    var a = doc.createElement('a');
    a.href = '#';
    a.textContent = 'RETRY';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      window.location.reload();
    });
    err.appendChild(a);
    err.hidden = false;
  }

  /* ---------- main ---------- */

  function onData(data) {
    data = data || {};
    renderMasthead(data.meta);
    var maps = data.maps;
    if (!maps || typeof maps.length !== 'number') {
      console.error('[maps] data.maps missing from the LadderData payload — is track A’s derive.js in place?');
      renderLoadError();
      return;
    }
    hideError();
    state.maps = maps;
    setText('maps-count', rotationText(maps.length)); // 'MAPS (17 IN ROTATION)'
    renderCards(maps);   // already sorted games desc by the data layer
    renderTableBody();   // both views render from the same payload
    updateSortHeaders();
  }

  function init() {
    doc.title = "M'HUNTERS — Templates";
    injectTransientStyles();
    renderSkeleton();

    wireTabs();
    wireSorting();
    setView(parseView(window.location.search), false); // deep links: ?view=table
    updateSortHeaders();

    if (!window.LadderData || typeof window.LadderData.load !== 'function') {
      console.error('[maps] window.LadderData.load is missing — is js/derive.js loaded before js/templates.js?');
      renderLoadError();
      return;
    }

    window.LadderData.load().then(onData).catch(function (err) {
      console.error('[maps] ladder data load failed', err);
      renderLoadError();
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
