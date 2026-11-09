/* ============================================================
   M'Hunters Clan Ladder — shared feed item renderers
   Plain vanilla script (no modules). Load AFTER js/insignia.js and
   BEFORE the page script (js/app.js / js/feed.js).
   Exposes:
     window.FeedItems = {
       feedTime(iso[, nowMs]),       // '6m' / '6h' / 'July 10, 2026'
       feedStamp(iso[, nowMs]),      // row stamp {main:'6h'/'NOV 7', year:''/'2025'}
       buildResultItem(r, ctx),      // result row (opens warzone.com)
       buildHonorItem(g, ctx),       // honor card (league / rank)
       buildDayHeader(iso, ctx),     // 'TODAY' / 'YESTERDAY' / 'NOV 8' divider
       dayKey(iso), dayLabel(iso[, nowMs]),
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

  /* row stamp: '6m' / '6h' under 24h, then the local day ('NOV 7').
     Items from an earlier year also get year: '2025', shown under the day. */
  function feedStamp(iso, nowMs) {
    var t = tsOf(iso);
    if (!t) return { main: '', year: '' };
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    if (now - t < 86400000) return { main: feedTime(iso, now), year: '' };
    var d = new Date(t);
    var y = d.getFullYear();
    return {
      main: MONTHS[d.getMonth()] + ' ' + d.getDate(),
      year: y === new Date(now).getFullYear() ? '' : String(y)
    };
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

  /* local calendar day of an ISO time → 'YYYY-MM-DD' ('' when unparseable) */
  function dayKey(iso) {
    var t = tsOf(iso);
    if (!t) return '';
    var d = new Date(t);
    var mo = d.getMonth() + 1, da = d.getDate();
    return d.getFullYear() + '-' + (mo < 10 ? '0' : '') + mo + '-' + (da < 10 ? '0' : '') + da;
  }

  /* day-header label: 'TODAY' / 'YESTERDAY' / 'NOV 8' / 'DEC 28, 2025'
     (year only when it isn't the current one). nowMs is injectable. */
  function dayLabel(iso, nowMs) {
    var t = tsOf(iso);
    if (!t) return '';
    var now = new Date(typeof nowMs === 'number' ? nowMs : Date.now());
    var today = dayKey(now.toISOString());
    var yest = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString());
    var key = dayKey(iso);
    if (key === today) return 'TODAY';
    if (key === yest) return 'YESTERDAY';
    var d = new Date(t);
    var label = MONTHS[d.getMonth()] + ' ' + d.getDate();
    return d.getFullYear() === now.getFullYear() ? label : label + ', ' + d.getFullYear();
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

    // feedStamp — relative under 24h, local day after, year only when different
    var NOWL = new Date(2026, 6, 10, 12).getTime();
    eq(feedStamp(new Date(2026, 6, 10, 6).toISOString(), NOWL), { main: '6h', year: '' }, 'feedStamp 6h');
    eq(feedStamp(new Date(2026, 6, 7, 15).toISOString(), NOWL), { main: 'JUL 7', year: '' }, 'feedStamp this year → JUL 7');
    eq(feedStamp(new Date(2025, 11, 28, 15).toISOString(), NOWL), { main: 'DEC 28', year: '2025' }, 'feedStamp last year → DEC 28 + 2025');
    eq(feedStamp('junk', NOWL), { main: '', year: '' }, 'feedStamp junk → empty');

    // feedTime — null-safety
    eq(feedTime(null, NOW), '', 'feedTime null → empty');
    eq(feedTime(undefined, NOW), '', 'feedTime undefined → empty');
    eq(feedTime('junk', NOW), '', 'feedTime junk → empty');

    // gazette date + kind markers (moved from app.js — helpers live here now)
    eq(formatGazetteDate('2026-07-09'), 'JUL 9', 'gazette date plain');
    eq(formatGazetteDate('2025-12-28T14:03:00Z'), 'DEC 28', 'gazette date with time');
    eq(formatGazetteDate('junk'), '', 'gazette date junk → empty');

    // day headers (local time — built from local dates so any TZ passes)
    var LNOW = new Date(2026, 10, 9, 15, 0).getTime();
    var at = function (y, m, d, h) { return new Date(y, m, d, h, 0).toISOString(); };
    eq(dayLabel(at(2026, 10, 9, 1), LNOW), 'TODAY', 'dayLabel same day → TODAY');
    eq(dayLabel(at(2026, 10, 8, 23), LNOW), 'YESTERDAY', 'dayLabel previous day → YESTERDAY');
    eq(dayLabel(at(2026, 10, 6, 9), LNOW), 'NOV 6', 'dayLabel this year → NOV 6');
    eq(dayLabel(at(2025, 11, 28, 9), LNOW), 'DEC 28, 2025', 'dayLabel other year adds the year');
    eq(dayLabel(at(2026, 0, 1, 9), new Date(2026, 0, 2, 9).getTime()), 'YESTERDAY', 'dayLabel yesterday across a month');
    eq(dayLabel('junk', LNOW), '', 'dayLabel junk → empty');
    eq(dayKey(at(2026, 6, 4, 13)), '2026-07-04', 'dayKey local date');

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


  /* the M'Hunters clan icon, downscaled from the hi-res source */
  function clanTagImg(docRef) {
    var img = docRef.createElement('img');
    img.className = 'clan-tag';
    img.src = 'assets/clan-tag.png';
    img.alt = '';
    img.width = 16;
    img.height = 15;
    return img;
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

  /* Attach the row stamp ('6h' / 'NOV 7', plus the year under it for
     items from an earlier year) to a feed item. */
  function attachFeedTime(item, iso, docRef) {
    var st = feedStamp(iso);
    if (!st.main) return;
    var span = docRef.createElement('span');
    span.className = 'feed-time';
    span.textContent = st.main;
    if (st.year) {
      var yr = docRef.createElement('span');
      yr.className = 'feed-time__year';
      yr.textContent = st.year;
      span.appendChild(yr);
      span.setAttribute('aria-label', st.main + ' ' + st.year);
    }
    item.appendChild(span);
  }

  /* 'TODAY' / 'YESTERDAY' / 'NOV 8' divider placed above each day's items */
  function buildDayHeader(iso, ctx) {
    var div = ctxDoc(ctx).createElement('div');
    div.className = 'feed-day';
    div.setAttribute('role', 'separator');
    div.textContent = dayLabel(iso);
    return div;
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

    // scoreboard: winner bright on top, loser dimmed beneath
    var board = doc.createElement('div');
    board.className = 'fr-board';
    board.appendChild(side(r.winner, r.winnerId, 'fr-side fr-side--win', '+' + r.change));
    board.appendChild(side(r.loser, r.loserId, 'fr-side fr-side--lose', '−' + r.change));
    item.setAttribute('aria-label', r.winner + ' beat ' + r.loser + ', ' + r.change + ' points, on ' + r.map);

    // right side: map over turns, centred across both rows so it belongs to
    // the game rather than either player; time in its own column
    var meta = doc.createElement('div');
    meta.className = 'fr-meta';
    var where = doc.createElement('span');
    where.className = 'fr-where';
    where.title = r.map + (r.turns != null ? ' · ' + r.turns + ' turns' : '');
    var mapName = doc.createElement('span');
    mapName.className = 'fr-map';
    mapName.textContent = r.map;
    where.appendChild(mapName);
    if (r.turns != null) {
      var turns = doc.createElement('span');
      turns.className = 'fr-turns';
      turns.textContent = r.turns + (r.turns === 1 ? ' TURN' : ' TURNS');
      where.appendChild(turns);
    }
    meta.appendChild(where);
    var when = doc.createElement('span');
    when.className = 'fr-when';
    attachFeedTime(when, r.date, doc);
    meta.appendChild(when);

    function side(name, id, cls, swing) {
      var row = doc.createElement('div');
      row.className = cls;
      row.appendChild(nameLink(name, 'fr-name', id, ctx));
      var sw = doc.createElement('span');
      sw.className = 'fr-swing';
      sw.textContent = swing;
      row.appendChild(sw);
      return row;
    }

    item.appendChild(board);
    item.appendChild(meta);
    return item;

  }

  /* league changes: ceremony card — name + PROMOTED TO / RELEGATED TO, the new
     league big and metallic beneath, card washed in the league's metal.
     rank promotions: interim compact style (distinct treatment being designed). */
  /* 'GOLD → ORICHALCUM': the old value small and faded, the new one big.
     A league's old value is a small chip in that league's metal. */
  function fromTo(doc, prev, next, wordCls, prevLeagueKey) {
    var wrap = doc.createElement('span');
    wrap.className = 'fh-change';
    if (prev) {
      var from = doc.createElement('span');
      from.className = 'fh-from' + (prevLeagueKey ? ' fh-from--league' : '');
      from.textContent = String(prev).toUpperCase();
      if (prevLeagueKey && window.Insignia && typeof window.Insignia.leagueStops === 'function') {
        var st = window.Insignia.leagueStops(prevLeagueKey);
        from.style.background = 'linear-gradient(120deg, ' + st[0] + ', ' + st[1] + ' 55%, ' + st[2] + ')';
        // dark text on bright metals, light text on dark ones
        var h = st[1].replace('#', '');
        var lum = 0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16);
        from.style.color = lum > 140 ? '#15161A' : '#F2F4F6';
      }
      wrap.appendChild(from);
      var arrow = doc.createElement('span');
      arrow.className = 'fh-arrow';
      arrow.setAttribute('aria-label', 'to');
      arrow.textContent = '→';
      wrap.appendChild(arrow);
    }
    var word = doc.createElement('span');
    word.className = 'fh-word ' + wordCls;
    word.textContent = next;
    wrap.appendChild(word);
    return wrap;
  }

  function buildHonorItem(g, ctx) {
    var doc = ctxDoc(ctx);
    var div = doc.createElement('div');
    div.title = g.text || '';

    if (g.kind === 'ascension' || g.kind === 'demotion') {
      div.className = 'feed-item feed-item--honor feed-item--league lg-' + (g.leagueKey || 'steel');

      var mark = doc.createElement('span');
      mark.className = 'fh-mark';
      mark.textContent = g.kind === 'ascension' ? '▲' : '▼';
      mark.setAttribute('aria-label', g.kind === 'ascension' ? 'Promoted to' : 'Relegated to');
      div.appendChild(mark);
      div.appendChild(clanTagImg(doc));
      div.appendChild(nameLink(g.playerName, 'fh-name', g.playerId, ctx));
      div.appendChild(fromTo(doc, g.prevLeagueName, (g.leagueName || '').toUpperCase(),
        'fh-league-word', g.prevLeagueKey));
      attachFeedTime(div, g.date, doc);
      return div;
    }

    // rank promotion: certificate card in M'Hunters steel — new shield,
    // name, then OLD RANK → NEW RANK in the engraved-steel wordmark gradient
    div.className = 'feed-item feed-item--honor feed-item--rank';

    var badge = doc.createElement('span');
    badge.className = 'fh-badge fh-badge--cert';
    try {
      var tint = (ctx && ctx.leagueById && ctx.leagueById[String(g.playerId)]) || 'steel';
      badge.innerHTML = window.Insignia.svg(g.rankIndex, tint, 34);
    } catch (err) { /* badge optional */ }
    div.appendChild(badge);

    div.appendChild(clanTagImg(doc));
    div.appendChild(nameLink(g.playerName, 'fh-name', g.playerId, ctx));
    div.appendChild(fromTo(doc, g.prevRankName, (g.rankName || '').toUpperCase(), 'fh-rank-word', null));
    attachFeedTime(div, g.date, doc);
    return div;
  }

  window.FeedItems = {
    feedTime: feedTime,
    feedStamp: feedStamp,
    buildResultItem: buildResultItem,
    buildHonorItem: buildHonorItem,
    buildDayHeader: buildDayHeader,
    dayKey: dayKey,
    dayLabel: dayLabel,
    formatGazetteDate: formatGazetteDate,
    gazetteKindMarker: gazetteKindMarker,
    nameLink: nameLink,
    nameSpan: nameSpan
  };
})();
