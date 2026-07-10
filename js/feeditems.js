/* ============================================================
   M'Hunters Clan Ladder — shared feed item renderers
   Plain vanilla script (no modules). Load AFTER js/insignia.js and
   BEFORE the page script (js/app.js / js/feed.js).
   Exposes:
     window.FeedItems = {
       feedTime(iso[, nowMs]),       // '6m' / '6h' / 'July 10, 2026'
       buildResultItem(r, ctx),      // result row (opens warzone.com)
       buildHonorItem(g, ctx),       // honor card (league / rank)
       // shared internals the page scripts also consume:
       formatGazetteDate(iso),       // 'JUL 9' (honor tooltips/labels)
       gazetteKindMarker(kind),      // ★ ▲ ▼ ·
       nameLink(name, cls, id, ctx), // plink anchor / plain span
       nameSpan(name, cls, doc)
     }
   ctx = {
     posById,    // playerId → current ladder position (actives)
     leagueById, // playerId → league key (badge tint lookups)
     honorTips,  // playerId → latest honor sentence (tooltips)
     rosterIds,  // Set (or plain map keyed by id) → plink eligibility
     doc         // document (defaults to window.document)
   }
   Self-test: `node js/feeditems.js` runs the pure-helper test suite.
   ============================================================ */

(function () {
  'use strict';

  /* ------------------------------------------------------------
     Pure helpers (no DOM — testable in node)
     ------------------------------------------------------------ */

  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

  function tsOf(iso) {
    var t = Date.parse(iso);
    return isNaN(t) ? 0 : t;
  }

  /* ISO → 'July 10, 2026' (parses the date part directly; no TZ drift) */
  function formatFullDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (m) {
      var mo = parseInt(m[2], 10);
      if (mo >= 1 && mo <= 12) {
        return MONTHS_LONG[mo - 1] + ' ' + parseInt(m[3], 10) + ', ' + m[1];
      }
    }
    var d = new Date(iso);
    if (!isNaN(d.getTime())) {
      return MONTHS_LONG[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }
    return '';
  }

  /* per-item timestamp: relative under 24h ('6m' / '6h'), the entry's full
     date from 24h on ('July 10, 2026'). nowMs is injectable for tests. */
  function feedTime(iso, nowMs) {
    var t = tsOf(iso);
    if (!t) return '';
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var mins = Math.floor((now - t) / 60000);
    if (mins < 60) return Math.max(1, mins) + 'm';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h';
    return formatFullDate(iso);
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

    console.log('feeditems.js pure-helper self-test');

    // feedTime — relative style under 24h (fixed clock)
    var NOW = Date.parse('2026-07-10T12:00:00Z');
    eq(feedTime('2026-07-10T11:54:00Z', NOW), '6m', 'feedTime 6 minutes → 6m');
    eq(feedTime('2026-07-10T11:59:30Z', NOW), '1m', 'feedTime <1 minute floors at 1m');
    eq(feedTime('2026-07-10T06:00:00Z', NOW), '6h', 'feedTime 6 hours → 6h');
    eq(feedTime('2026-07-09T12:00:01Z', NOW), '23h', 'feedTime 23h59m59s → 23h');

    // feedTime — full date from 24h on
    eq(feedTime('2026-07-09T12:00:00Z', NOW), 'July 9, 2026', 'feedTime exactly 24h → full date');
    eq(feedTime('2026-07-08T09:00:00Z', NOW), 'July 8, 2026', 'feedTime 2 days → July 8, 2026');
    eq(feedTime('2025-12-28T14:03:00Z', NOW), 'December 28, 2025', 'feedTime december w/ time part');
    eq(feedTime('2026-02-01T00:00:00Z', NOW), 'February 1, 2026', 'feedTime no zero-padded day');

    // feedTime — all twelve month names come out in full
    var monthsSeen = [];
    for (var mi = 1; mi <= 12; mi++) {
      var mm = (mi < 10 ? '0' : '') + mi;
      monthsSeen.push(feedTime('2025-' + mm + '-10T00:00:00Z', NOW).split(' ')[0]);
    }
    eq(monthsSeen.join(','),
      'January,February,March,April,May,June,July,August,September,October,November,December',
      'feedTime full month names Jan–Dec');

    // feedTime — null-safety
    eq(feedTime(null, NOW), '', 'feedTime null → empty');
    eq(feedTime(undefined, NOW), '', 'feedTime undefined → empty');
    eq(feedTime('junk', NOW), '', 'feedTime junk → empty');

    // gazette date + kind markers (moved from app.js — helpers live here now)
    eq(formatGazetteDate('2026-07-09'), 'JUL 9', 'gazette date plain');
    eq(formatGazetteDate('2025-12-28T14:03:00Z'), 'DEC 28', 'gazette date with time');
    eq(formatGazetteDate('junk'), '', 'gazette date junk → empty');

    eq(gazetteKindMarker('promotion'), '★', 'promotion marker');
    eq(gazetteKindMarker('ascension'), '▲', 'ascension marker');
    eq(gazetteKindMarker('demotion'), '▼', 'demotion marker');
    eq(gazetteKindMarker('mystery'), '·', 'unknown kind → dot');

    console.log(failures === 0
      ? 'ALL ' + checks + ' CHECKS PASSED'
      : failures + '/' + checks + ' CHECKS FAILED');
    if (typeof process !== 'undefined') process.exitCode = failures ? 1 : 0;
    return;
  }

  /* ------------------------------------------------------------
     DOM builders (browser only)
     ------------------------------------------------------------ */

  function ctxDoc(ctx) {
    return (ctx && ctx.doc) || document;
  }

  /* roster check — ctx.rosterIds is a Set of id strings or a plain map
     keyed by id (app.js passes its leagueById map, which covers every
     active + reserve id) */
  function inRoster(ctx, id) {
    if (id == null || !ctx || !ctx.rosterIds) return false;
    var key = String(id);
    var r = ctx.rosterIds;
    if (typeof r.has === 'function') return r.has(key);
    return r[key] !== undefined;
  }

  function nameSpan(name, cls, docRef) {
    var span = (docRef || document).createElement('span');
    span.className = cls || '';
    span.textContent = name;
    return span;
  }

  /* player-name node: <a.plink> to the profile when the id resolves to a
     current roster player; plain span otherwise ('Former member' etc.) */
  function nameLink(name, cls, id, ctx) {
    if (!inRoster(ctx, id)) return nameSpan(name, cls, ctxDoc(ctx));
    var a = ctxDoc(ctx).createElement('a');
    a.className = cls ? 'plink ' + cls : 'plink';
    a.href = 'profile.html?p=' + encodeURIComponent(id);
    a.textContent = name;
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    return a;
  }

  /* Attach the timestamp to a feed item. Date-style stamps ('July 10, 2026')
     are much wider than relative ones ('6h') — the item gets a class that
     reserves a wider right column so content never runs underneath. */
  function attachFeedTime(item, iso, docRef) {
    var text = feedTime(iso);
    if (!text) return;
    var span = docRef.createElement('span');
    span.className = 'feed-time';
    span.textContent = text;
    if (text.indexOf(',') !== -1) item.classList.add('feed-item--dated');
    item.appendChild(span);
  }

  /* result rows open the game on warzone.com. The row is a div[role=link]
     (not an anchor: the names inside are real profile links and nested
     anchors are invalid HTML) — click / Enter opens the game. */
  function buildResultItem(r, ctx) {
    var doc = ctxDoc(ctx);
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
    line.appendChild(nameLink(r.winner, 'fr-winner', r.winnerId, ctx));
    var wch = doc.createElement('span');
    wch.className = 'fr-up';
    wch.textContent = ' +' + r.change + ' ';
    line.appendChild(wch);
    var mid = doc.createElement('span');
    mid.className = 'fr-mid';
    mid.textContent = 'defeats ';
    line.appendChild(mid);
    line.appendChild(nameLink(r.loser, 'fr-loser', r.loserId, ctx));
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
    attachFeedTime(item, r.date, doc);
    return item;
  }

  /* league changes: ceremony card — name + PROMOTED TO / RELEGATED TO, the new
     league big and metallic beneath, card washed in the league's metal.
     rank promotions: interim compact style (distinct treatment being designed). */
  function buildHonorItem(g, ctx) {
    var doc = ctxDoc(ctx);
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
      line.appendChild(nameLink(g.playerName, 'fh-name', g.playerId, ctx));
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
      attachFeedTime(div, g.date, doc);
      return div;
    }

    // rank promotion: certificate card in M'Hunters steel — shield large,
    // ACHIEVED THE RANK OF, rank word in the engraved-steel wordmark gradient
    div.className = 'feed-item feed-item--honor feed-item--rank';

    var badge = doc.createElement('span');
    badge.className = 'fh-badge fh-badge--cert';
    try {
      var tint = (ctx && ctx.leagueById && ctx.leagueById[String(g.playerId)]) || 'steel';
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
    pline.appendChild(nameLink(g.playerName, 'fh-name', g.playerId, ctx));
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
    attachFeedTime(div, g.date, doc);
    return div;
  }

  window.FeedItems = {
    feedTime: feedTime,
    buildResultItem: buildResultItem,
    buildHonorItem: buildHonorItem,
    formatGazetteDate: formatGazetteDate,
    gazetteKindMarker: gazetteKindMarker,
    nameLink: nameLink,
    nameSpan: nameSpan
  };
})();
