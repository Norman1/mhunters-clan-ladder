/* ============================================================
   M'Hunters Clan Ladder — full feed page wiring (feed.html)
   Plain vanilla script (no modules). Depends on:
     window.LadderData (js/derive.js)   — LadderData.load()
     window.Insignia   (js/insignia.js) — badge SVGs (used via FeedItems)
     window.FeedItems  (js/feeditems.js) — shared feed item renderers
   DOM contract (provided by feed.html):
     #feed-list #feed-sentinel #stat-active #stat-games #stat-updated
   Stream: ALL honors (data.gazette) + ALL results (data.allResults),
   merged newest first, lazy-loaded in chunks of 60 with 'JULY 2026'
   month dividers between months (games.js pattern).
   Self-test: `node js/feed.js` runs the pure-helper test suite.
   ============================================================ */

(function () {
  'use strict';

  var CHUNK = 60;

  /* ------------------------------------------------------------
     Pure helpers (no DOM — testable in node)
     ------------------------------------------------------------ */

  var MONTHS_FULL = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
                     'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  function tsOf(iso) {
    var t = Date.parse(iso);
    return isNaN(t) ? 0 : t;
  }

  /* merge honors + results into one stream, newest first.
     Wrappers: { at, date, honor } | { at, date, result }. On identical
     timestamps honors sort ahead of results (the ceremony reads above the
     game that produced it — same order the home feed renders), original
     order otherwise preserved. */
  function mergeStream(gazette, results) {
    var items = [];
    (gazette || []).forEach(function (g, i) {
      items.push({ at: tsOf(g.date), date: g.date, honor: g, pri: 0, ord: i });
    });
    (results || []).forEach(function (r, i) {
      items.push({ at: tsOf(r.date), date: r.date, result: r, pri: 1, ord: i });
    });
    items.sort(function (a, b) {
      return (b.at - a.at) || (a.pri - b.pri) || (a.ord - b.ord);
    });
    return items;
  }

  /* ISO date → 'YYYY-MM' month key ('' when unparseable) */
  function monthKey(iso) {
    var m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    return m ? m[1] + '-' + m[2] : '';
  }

  /* 'YYYY-MM' → 'JULY 2026' month-divider label */
  function monthLabel(key) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
    if (!m) return '';
    var mo = parseInt(m[2], 10);
    if (mo < 1 || mo > 12) return '';
    return MONTHS_FULL[mo - 1] + ' ' + m[1];
  }

  /* month divider goes BETWEEN consecutive rendered items — never above the first */
  function monthChanged(prevIso, iso) {
    if (!prevIso) return false;
    return monthKey(prevIso) !== monthKey(iso);
  }

  /* chunking math: index one past the last row of the next chunk */
  function chunkEnd(start, size, total) {
    return Math.min(start + size, total);
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

    console.log('feed.js pure-helper self-test');

    // merge order — newest first across both sources
    var gz = [
      { date: '2026-07-09T10:00:00Z', kind: 'promotion', playerName: 'Farah♦' },
      { date: '2026-06-01T08:00:00Z', kind: 'ascension', playerName: 'Gatsu12' }
    ];
    var rs = [
      { date: '2026-07-10T12:00:00Z', gameId: 'g3', winner: 'Tim' },
      { date: '2026-07-01T09:00:00Z', gameId: 'g2', winner: 'Ree' },
      { date: '2025-12-28T14:00:00Z', gameId: 'g1', winner: 'Ventura' }
    ];
    var merged = mergeStream(gz, rs);
    eq(merged.length, 5, 'merge: all honors + all results present');
    eq(merged.map(function (w) { return w.honor ? 'H' : 'R'; }).join(''),
      'RHRHR', 'merge: interleaved by date, newest first');
    eq(merged.map(function (w) { return w.date; }), [
      '2026-07-10T12:00:00Z', '2026-07-09T10:00:00Z', '2026-07-01T09:00:00Z',
      '2026-06-01T08:00:00Z', '2025-12-28T14:00:00Z'
    ], 'merge: strictly descending dates');

    // merge order — identical timestamp: honor reads above its result
    var tied = mergeStream(
      [{ date: '2026-07-09T10:00:00Z', kind: 'promotion' }],
      [{ date: '2026-07-09T10:00:00Z', gameId: 'gX' }]
    );
    eq(tied.map(function (w) { return w.honor ? 'H' : 'R'; }).join(''),
      'HR', 'merge: tie → honor before result');

    // merge order — same-source ties keep original order
    var sameTs = mergeStream([], [
      { date: '2026-07-09T10:00:00Z', gameId: 'first' },
      { date: '2026-07-09T10:00:00Z', gameId: 'second' }
    ]);
    eq(sameTs.map(function (w) { return w.result.gameId; }), ['first', 'second'],
      'merge: same-source tie keeps input order');

    // merge — null-safety
    eq(mergeStream(null, null).length, 0, 'merge: null inputs → empty stream');

    // chunking math
    eq(chunkEnd(0, 60, 1300), 60, 'chunk 1 ends at 60');
    eq(chunkEnd(60, 60, 1300), 120, 'chunk 2 ends at 120');
    eq(chunkEnd(1260, 60, 1300), 1300, 'final partial chunk clamps to total');
    eq(chunkEnd(0, 60, 25), 25, 'short stream: single partial chunk');
    eq(Math.ceil(1300 / 60), 22, '1,300 items → 22 chunks');

    // month dividers
    eq(monthChanged(null, '2026-07-09'), false, 'divider: never above the first item');
    eq(monthChanged('2026-07-30T10:00:00Z', '2026-07-01T10:00:00Z'), false,
      'divider: same month → none');
    eq(monthChanged('2026-07-02T10:00:00Z', '2026-06-28T10:00:00Z'), true,
      'divider: month rolls over');
    eq(monthChanged('2026-01-05T10:00:00Z', '2025-12-28T10:00:00Z'), true,
      'divider: year boundary');
    eq(monthKey('2026-07-09T01:02:03Z'), '2026-07', 'monthKey from ISO');
    eq(monthLabel('2026-07'), 'JULY 2026', "month label 'JULY 2026'");
    eq(monthLabel('2025-12'), 'DECEMBER 2025', "month label 'DECEMBER 2025'");
    eq(monthLabel('junk'), '', 'month label junk → empty');

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
    stream: [],        // merged wrappers, newest first
    rendered: 0,       // wrappers already in the DOM
    lastIso: null,     // date of the last rendered item (month dividers)
    ctx: null,         // shared FeedItems context
    io: null,
    ioFallback: false, // sentinel acts as a LOAD MORE button
    loaded: false
  };

  /* Zero-specificity styles for the bits feed.js creates that styles.css
     doesn't cover (#feed-list itself is reused verbatim): skeleton shimmer,
     month dividers, back link, error state, LOAD MORE fallback. */
  function injectTransientStyles() {
    if ($('feed-transient-styles')) return;
    var css = [
      ':where(.backlink){align-self:flex-start;font-family:"IBM Plex Mono",monospace;',
      'font-weight:600;font-size:11px;letter-spacing:.14em;color:var(--muted,#9AA1AB);',
      'transition:color var(--speed,.15s) ease}',
      ':where(.backlink):hover{color:var(--red,#D22730)}',
      ':where(.feed-skel){display:block;height:40px;margin:8px 0;border-radius:4px;',
      'background:var(--line-soft,#222429);animation:feed-sk 1.2s ease-in-out infinite}',
      '@keyframes feed-sk{50%{opacity:.4}}',
      /* 'JULY 2026' mono divider — games.css month-marker look, inside #feed-list */
      ':where(#feed-list .feed-month){display:flex;align-items:center;gap:10px;',
      'padding:18px 0 8px;font-family:"IBM Plex Mono",monospace;font-weight:600;',
      'font-size:10px;letter-spacing:.18em;text-transform:uppercase;',
      'color:var(--dim,#8A919C);cursor:default}',
      ':where(#feed-list .feed-month)::after{content:"";flex:1;height:1px;',
      'background:var(--line-soft,#222429)}',
      ':where(.load-error){font-family:"IBM Plex Mono",monospace;color:var(--muted,#9AA1AB);',
      'text-align:center;padding:2em 1em;letter-spacing:.05em}',
      ':where(.load-error) a{color:var(--red,#D22730)}',
      ':where(#feed-sentinel){min-height:1px}',
      ':where(#feed-sentinel[role="button"]){display:block;margin:14px auto 18px;',
      'padding:9px 24px;width:max-content;border:1px solid var(--line,#2A2D33);',
      'border-radius:4px;font-family:"IBM Plex Mono",monospace;font-weight:600;',
      'font-size:10.5px;letter-spacing:.14em;color:var(--muted,#9AA1AB);cursor:pointer}',
      ':where(#feed-sentinel[role="button"]):hover{color:var(--white,#EDEFF2)}',
      '@media (prefers-reduced-motion:reduce){:where(.feed-skel){animation:none}}'
    ].join('');
    var style = doc.createElement('style');
    style.id = 'feed-transient-styles';
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
  }

  /* ---------- FeedItems context ---------- */

  /* leagueById covers every active + reserve id, so it doubles as the
     rosterIds map for plink eligibility — same behavior as the home feed */
  function buildCtx(data) {
    var posById = {};
    var leagueById = {};
    (data.active || []).forEach(function (p) {
      posById[String(p.id)] = p.rank;
      leagueById[String(p.id)] = p.league;
    });
    (data.reserve || []).forEach(function (p) {
      leagueById[String(p.id)] = p.league;
    });
    var honorTips = {};
    (data.gazette || []).forEach(function (g) {
      // newest first — keep the first promotion/ascension seen per player
      if (!g || !g.playerId) return;
      if (g.kind !== 'promotion' && g.kind !== 'ascension') return;
      var id = String(g.playerId);
      if (!honorTips[id]) {
        honorTips[id] = window.FeedItems.formatGazetteDate(g.date) + ' — ' + (g.text || '');
      }
    });
    return {
      posById: posById,
      leagueById: leagueById,
      honorTips: honorTips,
      rosterIds: leagueById,
      doc: doc
    };
  }

  /* ---------- stream rendering (chunked + month dividers) ---------- */

  function buildMonthDivider(iso) {
    var div = doc.createElement('div');
    div.className = 'feed-month';
    div.textContent = monthLabel(monthKey(iso));
    div.setAttribute('role', 'separator');
    return div;
  }

  function updateSentinel() {
    var s = $('feed-sentinel');
    if (!s) return;
    var done = state.rendered >= state.stream.length;
    s.hidden = done;
    if (state.ioFallback) {
      s.textContent = done ? '' : 'LOAD MORE';
    }
  }

  function renderChunk() {
    var list = $('feed-list');
    if (!list) return;
    if (state.rendered >= state.stream.length) { updateSentinel(); return; }
    var end = chunkEnd(state.rendered, CHUNK, state.stream.length);
    var frag = doc.createDocumentFragment();
    for (var i = state.rendered; i < end; i++) {
      var it = state.stream[i];
      if (monthChanged(state.lastIso, it.date)) frag.appendChild(buildMonthDivider(it.date));
      frag.appendChild(it.honor
        ? window.FeedItems.buildHonorItem(it.honor, state.ctx)
        : window.FeedItems.buildResultItem(it.result, state.ctx));
      state.lastIso = it.date;
    }
    list.appendChild(frag);
    state.rendered = end;
    updateSentinel();
  }

  function wireSentinel() {
    var s = $('feed-sentinel');
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

  /* ---------- loading / error states ---------- */

  function renderSkeleton() {
    var list = $('feed-list');
    if (!list) return;
    list.textContent = '';
    for (var i = 0; i < 8; i++) {
      var bar = doc.createElement('div');
      bar.className = 'feed-skel';
      bar.setAttribute('aria-hidden', 'true');
      list.appendChild(bar);
    }
    var s = $('feed-sentinel');
    if (s) s.hidden = true;
  }

  function renderError() {
    var list = $('feed-list');
    if (!list) return;
    list.textContent = '';
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
    list.appendChild(div);
    var s = $('feed-sentinel');
    if (s) s.hidden = true;
  }

  /* ---------- main ---------- */

  function onData(data) {
    data = data || {};
    state.ctx = buildCtx(data);
    // the full archive (allResults); capped results is a safety net only
    state.stream = mergeStream(data.gazette, data.allResults || data.results || []);
    state.rendered = 0;
    state.lastIso = null;
    state.loaded = true;
    renderMasthead(data.meta);
    var list = $('feed-list');
    if (list) list.textContent = '';
    renderChunk();
  }

  function init() {
    doc.title = "M'HUNTERS — Feed";
    injectTransientStyles();
    renderSkeleton();
    wireSentinel();

    if (!window.LadderData || typeof window.LadderData.load !== 'function') {
      console.error('[feed] window.LadderData.load is missing — is js/derive.js loaded before js/feed.js?');
      renderError();
      return;
    }

    if (!window.FeedItems || typeof window.FeedItems.buildResultItem !== 'function') {
      console.error('[feed] window.FeedItems is missing — is js/feeditems.js loaded before js/feed.js?');
      renderError();
      return;
    }

    window.LadderData.load().then(onData).catch(function (err) {
      console.error('[feed] ladder data load failed', err);
      renderError();
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
