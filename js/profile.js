/* ============================================================
   M'Hunters Clan Ladder — Player profile page wiring (Track C)
   Plain vanilla script (no modules). Depends on:
     window.LadderData (js/derive.js)   — LadderData.load()
     window.Insignia   (js/insignia.js) — Insignia.svg / leagueColor
   URL contract: profile.html?p=<playerId>
   DOM contract (provided by profile.html / track B):
     #profile-root #hero-insignia #hero-name #hero-rank #hero-league
     #hero-meta #prog-rank #prog-league #career-strip #rating-chart
     #records #opponents-list #maps-list #timeline #gamelog-body
     #gamelog-pager #reliability #profile-error
   Every section renders defensively: a missing id skips that
   section without throwing.
   Self-test: `node js/profile.js` runs the pure-helper suite.
   ============================================================ */

(function () {
  'use strict';

  /* ------------------------------------------------------------
     Domain constants (mirror derive.js exactly — non-negotiable)
     ------------------------------------------------------------ */

  var RANK_THRESHOLDS = [
    0, 10, 25, 50, 75, 100, 150, 200, 250, 300, 350, 400,
    450, 500, 600, 700, 800, 900, 1000, 1250, 1500, 2000, 2500
  ];

  var RANK_NAMES = [
    'Recruit', 'Private', 'Private First Class', 'Trooper', 'Corporal',
    'Gunner', 'Sharpshooter', 'Pathfinder', 'Ranger',
    'Raider', 'Commando', 'Shock Trooper',
    'Second Lieutenant', 'First Lieutenant', 'Captain', 'Major',
    'Lieutenant Colonel', 'Colonel', '1 Star General', '2 Star General',
    '3 Star General', '4 Star General', '5 Star General'
  ];

  var LEAGUES = [
    { key: 'lumber',     name: 'Lumber',     lo: -Infinity },
    { key: 'stone',      name: 'Stone',      lo: 700 },
    { key: 'iron',       name: 'Iron',       lo: 800 },
    { key: 'steel',      name: 'Steel',      lo: 900 },
    { key: 'cobalt',     name: 'Cobalt',     lo: 1000 },
    { key: 'silver',     name: 'Silver',     lo: 1100 },
    { key: 'gold',       name: 'Gold',       lo: 1200 },
    { key: 'obsidian',   name: 'Obsidian',   lo: 1300 },
    { key: 'bloodsteel', name: 'Bloodsteel', lo: 1400 },
    { key: 'warlord',    name: 'Warlord',    lo: 1500 }
  ];

  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  var GAME_URL = 'https://www.warzone.com/MultiPlayer?GameID=';
  var PER_PAGE = 20;
  /* Lumber has no lower bound; the progress bar needs a finite span,
     so it uses a nominal 150-pt window below the Stone floor. */
  var FLINT_SPAN = 150;
  /* Obsidian's metal (#24262C) is illegible on the dark plate —
     swap to steel-dim for text/fills (contract rule). */
  var OBSIDIAN_LEGIBLE = '#8A919C';

  /* ------------------------------------------------------------
     Pure helpers (no DOM — testable in node)
     ------------------------------------------------------------ */

  function clamp01(v) {
    if (!isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  function rankIndexForWins(wins) {
    var i = RANK_THRESHOLDS.length - 1;
    while (i > 0 && wins < RANK_THRESHOLDS[i]) i--;
    return i;
  }

  function leagueIndexForElo(elo) {
    var i = LEAGUES.length - 1;
    while (i > 0 && elo < LEAGUES[i].lo) i--;
    return i;
  }

  /* ISO date/datetime → 'MAY 13 2026' (parses the date part directly; no TZ drift) */
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    var mo = parseInt(m[2], 10);
    if (mo < 1 || mo > 12) return '';
    return MONTHS[mo - 1] + ' ' + parseInt(m[3], 10) + ' ' + m[1];
  }

  /* Rank progress bar: label + fill fraction between the current
     rank threshold and the next one. Highest rank → full bar. */
  function rankProgress(wins) {
    var w = typeof wins === 'number' && isFinite(wins) ? wins : 0;
    var idx = rankIndexForWins(w);
    if (idx >= RANK_THRESHOLDS.length - 1) {
      return { label: 'HIGHEST RANK', frac: 1 };
    }
    var cur = RANK_THRESHOLDS[idx];
    var next = RANK_THRESHOLDS[idx + 1];
    var n = next - w;
    return {
      label: n + (n === 1 ? ' WIN TO ' : ' WINS TO ') + RANK_NAMES[idx + 1].toUpperCase(),
      frac: clamp01((w - cur) / (next - cur))
    };
  }

  /* League progress bar: fill over the elo span between the current
     league floor and the next floor. Warlord → top league, full bar. */
  function leagueProgress(elo) {
    var e = typeof elo === 'number' && isFinite(elo) ? elo : 1000;
    var idx = leagueIndexForElo(e);
    if (idx >= LEAGUES.length - 1) {
      return { label: 'TOP LEAGUE', frac: 1 };
    }
    var next = LEAGUES[idx + 1];
    var curLo = LEAGUES[idx].lo;
    if (!isFinite(curLo)) curLo = next.lo - FLINT_SPAN;
    var n = next.lo - e;
    return {
      label: n + (n === 1 ? ' PT TO ' : ' PTS TO ') + next.name.toUpperCase() + ' LEAGUE',
      frac: clamp01((e - curLo) / (next.lo - curLo))
    };
  }

  /* Longest run of the given result, walking the log oldest → newest
     (gameLog arrives newest first, so iterate from the tail).
     Returns { len, start, end } — start/end are the first/last game
     objects of the run (earliest run wins ties); nulls when no run. */
  function longestRun(gameLog, wantWon) {
    var log = gameLog || [];
    var best = { len: 0, start: null, end: null };
    var run = 0, runStart = null;
    for (var i = log.length - 1; i >= 0; i--) {
      var g = log[i];
      if (g && !!g.won === !!wantWon) {
        if (run === 0) runStart = g;
        run++;
        if (run > best.len) best = { len: run, start: runStart, end: g };
      } else {
        run = 0;
      }
    }
    return best;
  }

  function longestWinStreak(gameLog) {
    return longestRun(gameLog, true).len;
  }

  function longestStreakText(n) {
    return n > 0 ? 'W' + n : '—';
  }

  /* Streak date range, compact: 'MAY 19 – JUN 4 2026' · same month
     'JUN 2 – JUN 9 2026' · same day collapses to a single date ·
     across years both sides carry their year. */
  function dateRangeText(isoA, isoB) {
    var re = /^(\d{4})-(\d{2})-(\d{2})/;
    var a = re.exec(String(isoA || ''));
    var b = re.exec(String(isoB || ''));
    if (!a && !b) return '';
    if (!a || !b) return fmtDate(isoA || isoB);
    var moA = parseInt(a[2], 10), moB = parseInt(b[2], 10);
    if (moA < 1 || moA > 12 || moB < 1 || moB > 12) return '';
    var dA = MONTHS[moA - 1] + ' ' + parseInt(a[3], 10);
    var dB = MONTHS[moB - 1] + ' ' + parseInt(b[3], 10);
    if (a[1] === b[1]) {
      if (dA === dB) return dA + ' ' + a[1];
      return dA + ' – ' + dB + ' ' + a[1];
    }
    return dA + ' ' + a[1] + ' – ' + dB + ' ' + b[1];
  }

  /* Top N wins by opponent rating at game time, best first. */
  function topVictories(gameLog, n) {
    var lim = n == null ? 3 : n;
    return (gameLog || [])
      .filter(function (g) { return g && g.won; })
      .sort(function (a, b) { return (b.oppRating || 0) - (a.oppRating || 0); })
      .slice(0, lim);
  }

  /* Chart y-domain: player min/max padded, minimum span 150 centered.
     null when there are fewer than two trajectory points. */
  function chartDomain(traj) {
    if (!traj || traj.length < 2) return null;
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < traj.length; i++) {
      if (traj[i] < lo) lo = traj[i];
      if (traj[i] > hi) hi = traj[i];
    }
    lo -= 12; hi += 12;
    if (hi - lo < 150) {
      var mid = (lo + hi) / 2;
      lo = mid - 75;
      hi = mid + 75;
    }
    return { lo: lo, hi: hi };
  }

  /* League floors that fall inside the chart domain (finite floors only). */
  function floorsInDomain(lo, hi) {
    return LEAGUES.filter(function (l) {
      return isFinite(l.lo) && l.lo >= lo && l.lo <= hi;
    });
  }

  /* Y-axis tick values: round multiples — 50s when they fit, else
     100s / 200s / 500s / 1000s — inside [lo, hi], at most 5 ticks. */
  function yTicks(lo, hi) {
    var steps = [50, 100, 200, 500, 1000];
    var vals = [];
    for (var s = 0; s < steps.length; s++) {
      var step = steps[s];
      vals = [];
      for (var v = Math.ceil(lo / step) * step; v <= hi; v += step) vals.push(v);
      if (vals.length <= 5) return vals;
    }
    return vals.slice(0, 5);
  }

  /* Per-point timestamps (ms) for the trajectory — the chart x-axis is
     TIME-scaled, so equal time differences render as equal distances.
     Chronological game times come from the newest-first log; when traj
     leads with starting-rating point(s), they sit ~1% of the total time
     span before the first game so the line has a visible start (flat
     span → 1 day back). Unparseable dates inherit the nearest earlier
     game's time. Returns null when no game date parses (caller falls
     back to even index spacing). */
  function trajTimes(gameLog, trajLen) {
    var log = (gameLog || []).slice().reverse(); /* oldest → newest */
    var times = [], i, t;
    for (i = 0; i < log.length; i++) {
      t = Date.parse(String((log[i] && log[i].date) || ''));
      if (isFinite(t)) times.push(t);
      else times.push(times.length ? times[times.length - 1] : NaN);
    }
    var firstValid = null;
    for (i = 0; i < times.length; i++) {
      if (isFinite(times[i])) { firstValid = times[i]; break; }
    }
    if (firstValid == null) return null;
    for (i = 0; i < times.length && !isFinite(times[i]); i++) times[i] = firstValid;
    var lead = (trajLen || 0) - times.length;
    if (lead < 0) times = times.slice(-trajLen);
    if (lead > 0) {
      var span = times[times.length - 1] - times[0];
      var back = span > 0 ? span * 0.01 : 86400000;
      for (i = 0; i < lead; i++) times.unshift(times[0] - back);
    }
    return times;
  }

  /* X-axis month ticks for a time domain [t0, t1] (ms): one tick at
     each calendar-month boundary (the 1st, UTC) inside the domain,
     labeled 'mm-yyyy', thinned evenly to maxTicks. */
  function monthTicks(t0, t1, maxTicks) {
    var max = maxTicks == null ? 6 : Math.max(2, maxTicks);
    if (!isFinite(t0) || !isFinite(t1) || t1 < t0) return [];
    var d = new Date(t0);
    var b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    if (b < t0) b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    var ticks = [];
    while (b <= t1) {
      var bd = new Date(b);
      var mo = bd.getUTCMonth() + 1;
      ticks.push({
        t: b,
        label: (mo < 10 ? '0' + mo : String(mo)) + '-' + bd.getUTCFullYear()
      });
      b = Date.UTC(bd.getUTCFullYear(), bd.getUTCMonth() + 1, 1);
    }
    if (ticks.length > max) {
      var thin = [];
      for (var j = 0; j < max; j++) {
        var pick = ticks[Math.round(j * (ticks.length - 1) / (max - 1))];
        if (thin[thin.length - 1] !== pick) thin.push(pick);
      }
      ticks = thin;
    }
    return ticks;
  }

  /* League bands intersecting the chart domain, clipped to [lo, hi].
     Each band spans a league floor → the next floor (flint opens at
     -Infinity, warlord at +Infinity). */
  function leagueBandsInDomain(lo, hi) {
    var out = [];
    for (var i = 0; i < LEAGUES.length; i++) {
      var bandLo = LEAGUES[i].lo;
      var bandHi = i + 1 < LEAGUES.length ? LEAGUES[i + 1].lo : Infinity;
      var a = Math.max(lo, bandLo);
      var b = Math.min(hi, bandHi);
      if (a < b) out.push({ key: LEAGUES[i].key, lo: a, hi: b });
    }
    return out;
  }

  /* Group the game log by opponent: newest-first meetings per group,
     name taken from the newest meeting, sorted by win% desc
     (ties: more games, then name). */
  function groupByOpponent(gameLog) {
    var by = {}, order = [];
    (gameLog || []).forEach(function (g) {
      if (!g) return;
      var k = String(g.oppId);
      if (!by[k]) {
        by[k] = { oppId: g.oppId, name: g.opp, w: 0, l: 0, games: [] };
        order.push(by[k]);
      }
      var r = by[k];
      if (g.won) r.w++; else r.l++;
      r.games.push(g);
    });
    order.forEach(function (r) {
      r.count = r.w + r.l;
      r.winRate = r.count > 0 ? Math.round((r.w / r.count) * 100) : 0;
    });
    order.sort(function (a, b) {
      return (b.w / b.count) - (a.w / a.count)
        || b.count - a.count
        || String(a.name).localeCompare(String(b.name));
    });
    return order;
  }

  /* Group the game log by map name: same shape plus win rate. */
  function groupByMap(gameLog) {
    var by = {}, order = [];
    (gameLog || []).forEach(function (g) {
      if (!g) return;
      var k = String(g.map);
      if (!by[k]) {
        by[k] = { map: g.map, w: 0, l: 0, games: [] };
        order.push(by[k]);
      }
      var r = by[k];
      if (g.won) r.w++; else r.l++;
      r.games.push(g);
    });
    order.forEach(function (r) {
      r.count = r.w + r.l;
      r.winRate = r.count > 0 ? Math.round((r.w / r.count) * 100) : 0;
    });
    order.sort(function (a, b) {
      return (b.w / b.count) - (a.w / a.count)
        || b.count - a.count
        || String(a.map).localeCompare(String(b.map));
    });
    return order;
  }

  /* Voided-games value split for rendering: main count + dim
     parenthetical detail — { main: '11', detail: '(4 TIMEOUTS · 7 DECLINED)' }
     · zero voids → { main: 'NONE', detail: '' }. */
  function voidsParts(v) {
    if (!v || !v.total) return { main: 'NONE', detail: '' };
    var t = v.timeouts || 0;
    var d = v.declines || 0;
    return {
      main: String(v.total),
      detail: '(' + t + (t === 1 ? ' TIMEOUT' : ' TIMEOUTS') + ' · ' + d + ' DECLINED)'
    };
  }

  /* Voided-games line as plain text: '11 (4 TIMEOUTS · 7 DECLINED)' or 'NONE'. */
  function voidsText(v) {
    var parts = voidsParts(v);
    return parts.detail ? parts.main + ' ' + parts.detail : parts.main;
  }

  /* 'ACTIVE' / 'PAUSED' / 'INACTIVE · 3 MISSED' */
  function statusVal(p) {
    p = p || {};
    var s = p.status || 'ACTIVE';
    var missed = p.missed || 0;
    return missed > 0 ? s + ' · ' + missed + ' MISSED' : s;
  }

  /* Hero meta line: '#3' (active position) or the status text for
     reserves ('INACTIVE · 4 MISSED') — the rating lives in the career
     strip, never here. */
  function heroMeta(p) {
    p = p || {};
    return p.rank != null ? '#' + p.rank : statusVal(p);
  }

  /* streak {type,count} → { text:'W2', cls:'w' } / em-dash when none */
  function streakText(streak) {
    if (!streak || !streak.type || !streak.count) return { text: '—', cls: '' };
    return {
      text: streak.type + streak.count,
      cls: streak.type === 'W' ? 'w' : 'l'
    };
  }

  /* rating swing → '+12' red / '−12' steel (U+2212 minus) */
  function swingParts(won, change) {
    var c = typeof change === 'number' && isFinite(change) ? change : 0;
    return won
      ? { text: '+' + c, cls: 'up' }
      : { text: '−' + c, cls: 'down' };
  }

  function totalPages(count, per) {
    return Math.max(1, Math.ceil((count || 0) / (per || PER_PAGE)));
  }

  function pagerText(page, pages) {
    return 'PAGE ' + page + ' OF ' + pages;
  }

  function turnsText(turns) {
    return (typeof turns === 'number' && isFinite(turns)) ? String(turns) : '—';
  }

  /* live phase → display ('lobby' shows as NOT STARTED) */
  function phaseText(phase) {
    if (phase === 'lobby') return 'NOT STARTED';
    return String(phase || '').toUpperCase();
  }

  function capText(cap) {
    return (typeof cap === 'number' && isFinite(cap)) ? cap + ' CONCURRENT' : '—';
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

    console.log('profile.js pure-helper self-test');

    /* date formatting */
    eq(fmtDate('2026-05-13T14:03:00Z'), 'MAY 13 2026', 'fmtDate datetime');
    eq(fmtDate('2026-05-03'), 'MAY 3 2026', 'fmtDate no leading zero');
    eq(fmtDate('2025-12-28'), 'DEC 28 2025', 'fmtDate december');
    eq(fmtDate('junk'), '', 'fmtDate junk → empty');
    eq(fmtDate(null), '', 'fmtDate null → empty');

    /* rank progress */
    eq(rankProgress(33), { label: '17 WINS TO TROOPER', frac: (33 - 25) / 25 },
      'rankProgress 33 wins (PFC → Trooper)');
    eq(rankProgress(0), { label: '10 WINS TO PRIVATE', frac: 0 }, 'rankProgress 0 wins');
    eq(rankProgress(24), { label: '1 WIN TO PRIVATE FIRST CLASS', frac: 14 / 15 },
      'rankProgress singular WIN');
    eq(rankProgress(2500), { label: 'HIGHEST RANK', frac: 1 }, 'rankProgress at cap');
    eq(rankProgress(9999), { label: 'HIGHEST RANK', frac: 1 }, 'rankProgress beyond cap');
    eq(rankProgress(10), { label: '15 WINS TO PRIVATE FIRST CLASS', frac: 0 },
      'rankProgress exactly at threshold');

    /* league progress */
    eq(leagueProgress(1152), { label: '48 PTS TO GOLD LEAGUE', frac: (1152 - 1100) / 100 },
      'leagueProgress silver → gold');
    eq(leagueProgress(1500), { label: 'TOP LEAGUE', frac: 1 }, 'leagueProgress warlord');
    eq(leagueProgress(1650), { label: 'TOP LEAGUE', frac: 1 }, 'leagueProgress above warlord');
    eq(leagueProgress(800), { label: '100 PTS TO STEEL LEAGUE', frac: 0 },
      'leagueProgress exactly at iron floor');
    eq(leagueProgress(600), { label: '100 PTS TO STONE LEAGUE', frac: 50 / 150 },
      'leagueProgress lumber uses nominal window');
    eq(leagueProgress(500), { label: '200 PTS TO STONE LEAGUE', frac: 0 },
      'leagueProgress deep lumber clamps to 0');
    eq(leagueProgress(899), { label: '1 PT TO STEEL LEAGUE', frac: 99 / 100 },
      'leagueProgress singular PT');
    eq(leagueProgress(1000), { label: '100 PTS TO SILVER LEAGUE', frac: 0 },
      'leagueProgress exactly at cobalt floor');

    /* longest win streak (gameLog is newest first; oldest→newest walk) */
    var W = function (r) { return { won: true, oppRating: r || 1000 }; };
    var L = function () { return { won: false, oppRating: 1000 }; };
    /* oldest→newest: W W L W W W  → newest-first input reversed */
    var seq = [W(), W(), L(), W(), W(), W()].reverse();
    eq(longestWinStreak(seq), 3, 'longestWinStreak 3 at the end');
    eq(longestWinStreak([W(), W(), L(), L()]), 2, 'longestWinStreak run at the start');
    eq(longestWinStreak([L(), L()]), 0, 'longestWinStreak all losses');
    eq(longestWinStreak([]), 0, 'longestWinStreak empty');
    eq(longestWinStreak([W(), W(), W(), W()]), 4, 'longestWinStreak all wins');
    eq(longestStreakText(7), 'W7', 'longestStreakText W7');
    eq(longestStreakText(0), '—', 'longestStreakText none');

    /* longest run with endpoints (newest-first log, oldest→newest walk) */
    var Wd = function (d) { return { won: true, date: d }; };
    var Ld = function (d) { return { won: false, date: d }; };
    /* oldest→newest: W may19 · W may26 · L jun1 · L jun2 · L jun4 · W jun9 */
    var runLog = [Wd('2026-06-09'), Ld('2026-06-04'), Ld('2026-06-02'),
                  Ld('2026-06-01'), Wd('2026-05-26'), Wd('2026-05-19')];
    var wr = longestRun(runLog, true);
    eq([wr.len, wr.start.date, wr.end.date], [2, '2026-05-19', '2026-05-26'],
      'longestRun wins: length + start/end games');
    var lr = longestRun(runLog, false);
    eq([lr.len, lr.start.date, lr.end.date], [3, '2026-06-01', '2026-06-04'],
      'longestRun losses: length + start/end games');
    eq(longestRun([Wd('2026-06-09')], false), { len: 0, start: null, end: null },
      'longestRun no losses → nulls');
    eq(longestRun([], true), { len: 0, start: null, end: null }, 'longestRun empty log');
    /* equal-length runs: the earliest (oldest) run wins */
    var twinLog = [Wd('2026-07-04'), Wd('2026-07-01'), Ld('2026-06-20'),
                   Wd('2026-06-10'), Wd('2026-06-05')];
    var tw = longestRun(twinLog, true);
    eq([tw.len, tw.start.date, tw.end.date], [2, '2026-06-05', '2026-06-10'],
      'longestRun tie keeps the earliest run');

    /* streak date ranges */
    eq(dateRangeText('2026-05-19', '2026-06-04'), 'MAY 19 – JUN 4 2026',
      'dateRangeText cross-month');
    eq(dateRangeText('2026-06-02', '2026-06-09'), 'JUN 2 – JUN 9 2026',
      'dateRangeText same month');
    eq(dateRangeText('2025-12-28', '2026-01-03'), 'DEC 28 2025 – JAN 3 2026',
      'dateRangeText cross-year');
    eq(dateRangeText('2026-06-09T12:00:00Z', '2026-06-09'), 'JUN 9 2026',
      'dateRangeText same day collapses');
    eq(dateRangeText(null, '2026-06-09'), 'JUN 9 2026', 'dateRangeText one side missing');
    eq(dateRangeText(null, null), '', 'dateRangeText both missing → empty');

    /* top victories */
    var vics = [
      { won: true, oppRating: 1100, gameId: 'a' },
      { won: false, oppRating: 1400, gameId: 'b' },
      { won: true, oppRating: 1247, gameId: 'c' },
      { won: true, oppRating: 990, gameId: 'd' },
      { won: true, oppRating: 1180, gameId: 'e' }
    ];
    eq(topVictories(vics).map(function (g) { return g.gameId; }), ['c', 'e', 'a'],
      'topVictories best 3 wins by oppRating');
    eq(topVictories([{ won: true, oppRating: 900, gameId: 'x' }]).map(function (g) { return g.gameId; }),
      ['x'], 'topVictories fewer than 3');
    eq(topVictories([L()]), [], 'topVictories zero wins');

    /* chart domain */
    eq(chartDomain([1000]), null, 'chartDomain single point → null');
    eq(chartDomain([1000, 1010]), { lo: 930, hi: 1080 }, 'chartDomain min span 150 centered');
    eq(chartDomain([1000, 1400]), { lo: 988, hi: 1412 }, 'chartDomain padded min/max');

    /* league floors in domain */
    eq(floorsInDomain(930, 1080).map(function (l) { return l.key; }),
      ['cobalt'], 'floorsInDomain 930–1080');
    eq(floorsInDomain(1290, 1550).map(function (l) { return l.key; }),
      ['obsidian', 'bloodsteel', 'warlord'], 'floorsInDomain top end');
    eq(floorsInDomain(-2000, 500), [], 'floorsInDomain none (lumber has no floor)');

    /* y-axis ticks (round values inside the domain, at most 5) */
    eq(yTicks(930, 1080), [950, 1000, 1050], 'yTicks 150 span → 50s');
    eq(yTicks(988, 1412), [1000, 1100, 1200, 1300, 1400], 'yTicks wide span → 100s');
    eq(yTicks(1000, 1150), [1000, 1050, 1100, 1150], 'yTicks inclusive bounds');
    eq(yTicks(0, 2400), [0, 500, 1000, 1500, 2000], 'yTicks huge span → 500s');

    /* trajectory timestamps (time-scaled x-axis; gameLog newest first) */
    var T = function (iso) { return Date.parse(iso); };
    var tlog = [{ date: '2026-07-02' }, { date: '2026-06-20' }, { date: '2026-05-30' }];
    eq(trajTimes(tlog, 3), [T('2026-05-30'), T('2026-06-20'), T('2026-07-02')],
      'trajTimes chronological, no lead point');
    var tt4 = trajTimes(tlog, 4);
    eq(tt4.slice(1), [T('2026-05-30'), T('2026-06-20'), T('2026-07-02')],
      'trajTimes lead point keeps game times');
    eq(tt4[0], T('2026-05-30') - (T('2026-07-02') - T('2026-05-30')) * 0.01,
      'trajTimes lead point sits ~1% of the span before the first game');
    eq(trajTimes([{ date: '2026-06-09' }], 2),
      [T('2026-06-09') - 86400000, T('2026-06-09')],
      'trajTimes flat span → lead point 1 day back');
    eq(trajTimes([{ date: 'junk' }, { date: '2026-05-30' }], 2),
      [T('2026-05-30'), T('2026-05-30')],
      'trajTimes junk date inherits the neighbouring time');
    eq(trajTimes([{ date: 'junk' }], 1), null, 'trajTimes no parseable dates → null');
    eq(trajTimes([], 0), null, 'trajTimes empty log → null');

    /* x-axis month ticks: calendar-month boundaries inside a time domain */
    eq(monthTicks(T('2026-05-30'), T('2026-07-02'), 6),
      [{ t: T('2026-06-01'), label: '06-2026' }, { t: T('2026-07-01'), label: '07-2026' }],
      'monthTicks boundaries inside the domain');
    eq(monthTicks(T('2026-06-01'), T('2026-06-09'), 6),
      [{ t: T('2026-06-01'), label: '06-2026' }],
      'monthTicks boundary at the domain start included');
    eq(monthTicks(T('2026-06-02'), T('2026-06-20'), 6), [],
      'monthTicks no boundary inside the domain');
    eq(monthTicks(T('2025-11-15'), T('2026-02-10'), 6).map(function (t) { return t.label; }),
      ['12-2025', '01-2026', '02-2026'], 'monthTicks year rollover');
    eq(monthTicks(T('2025-01-15'), T('2026-01-15'), 4).map(function (t) { return t.label; }),
      ['02-2025', '06-2025', '09-2025', '01-2026'],
      'monthTicks thins evenly to maxTicks');
    eq(monthTicks(NaN, T('2026-06-09'), 6), [], 'monthTicks invalid domain → empty');

    /* league bands in domain (chart zone fills) */
    eq(leagueBandsInDomain(930, 1080),
      [{ key: 'steel', lo: 930, hi: 1000 },
       { key: 'cobalt', lo: 1000, hi: 1080 }],
      'leagueBandsInDomain clips bands to the domain');
    eq(leagueBandsInDomain(1520, 1600),
      [{ key: 'warlord', lo: 1520, hi: 1600 }],
      'leagueBandsInDomain open-ended warlord');
    eq(leagueBandsInDomain(400, 700),
      [{ key: 'lumber', lo: 400, hi: 700 }],
      'leagueBandsInDomain lumber below all floors');

    /* grouping */
    var glog = [
      { oppId: 'p2', opp: 'Crouton', won: true, map: 'Guiroma', oppRating: 1300 },
      { oppId: 'p3', opp: 'Gatsu12', won: false, map: 'MME', oppRating: 1340 },
      { oppId: 'p2', opp: 'Crouton', won: false, map: 'MME', oppRating: 1290 },
      { oppId: 'p2', opp: 'Crouton', won: true, map: 'Guiroma', oppRating: 1280 }
    ];
    var opps = groupByOpponent(glog);
    eq(opps.map(function (o) { return o.oppId; }), ['p2', 'p3'],
      'groupByOpponent sort by win% desc');
    eq([opps[0].w, opps[0].l, opps[0].count], [2, 1, 3], 'groupByOpponent W–L and count');
    eq(opps[0].winRate, 67, 'groupByOpponent winRate rounded');
    eq(opps[0].name, 'Crouton', 'groupByOpponent name from newest meeting');
    eq(opps[0].games.length, 3, 'groupByOpponent keeps all meetings');
    /* win% ties: more games first, then name */
    var tieLog = [
      { oppId: 'z9', opp: 'Zulu', won: true, map: 'Alpha Map' },
      { oppId: 'z9', opp: 'Zulu', won: false, map: 'Alpha Map' },
      { oppId: 'b2', opp: 'Bravo', won: true, map: 'Beta Map' },
      { oppId: 'b2', opp: 'Bravo', won: false, map: 'Beta Map' },
      { oppId: 'b2', opp: 'Bravo', won: true, map: 'Beta Map' },
      { oppId: 'b2', opp: 'Bravo', won: false, map: 'Beta Map' },
      { oppId: 'a1', opp: 'Anvil', won: true, map: 'Gamma Map' },
      { oppId: 'a1', opp: 'Anvil', won: false, map: 'Gamma Map' }
    ];
    eq(groupByOpponent(tieLog).map(function (o) { return o.name; }),
      ['Bravo', 'Anvil', 'Zulu'],
      'groupByOpponent win% tie → more games, then name');
    var maps = groupByMap(glog);
    eq(maps.map(function (m) { return m.map; }), ['Guiroma', 'MME'],
      'groupByMap sort by win% desc');
    eq([maps[0].w, maps[0].l, maps[0].winRate], [2, 0, 100], 'groupByMap record + rate');
    eq(maps[1].winRate, 0, 'groupByMap losing map rate');
    eq(groupByMap(tieLog).map(function (m) { return m.map; }),
      ['Beta Map', 'Alpha Map', 'Gamma Map'],
      'groupByMap win% tie → more games, then name');

    /* status (reliability) text */
    eq(voidsText({ total: 12, timeouts: 1, declines: 11 }), '12 (1 TIMEOUT · 11 DECLINED)',
      'voidsText singular timeout');
    eq(voidsText({ total: 11, timeouts: 4, declines: 7 }), '11 (4 TIMEOUTS · 7 DECLINED)',
      'voidsText plural timeouts');
    eq(voidsText({ total: 0, timeouts: 0, declines: 0 }), 'NONE', 'voidsText zero → NONE');
    eq(voidsText(null), 'NONE', 'voidsText null → NONE');
    eq(voidsParts({ total: 11, timeouts: 4, declines: 7 }),
      { main: '11', detail: '(4 TIMEOUTS · 7 DECLINED)' }, 'voidsParts main + dim detail');
    eq(voidsParts({ total: 0 }), { main: 'NONE', detail: '' }, 'voidsParts zero → NONE');
    eq(voidsParts(null), { main: 'NONE', detail: '' }, 'voidsParts null → NONE');
    eq(statusVal({ status: 'ACTIVE', missed: 0 }), 'ACTIVE', 'statusVal active clean');
    eq(statusVal({ status: 'ACTIVE', missed: 1 }), 'ACTIVE · 1 MISSED', 'statusVal active strike');
    eq(statusVal({ status: 'INACTIVE', missed: 3 }), 'INACTIVE · 3 MISSED', 'statusVal inactive');
    eq(statusVal({}), 'ACTIVE', 'statusVal default');
    eq(capText(2), '2 CONCURRENT', 'capText 2');
    eq(capText(0), '0 CONCURRENT', 'capText 0');
    eq(capText(null), '—', 'capText missing');

    /* hero meta — position or status only, never the rating */
    eq(heroMeta({ rank: 3, elo: 1265 }), '#3', 'heroMeta active is position only');
    eq(heroMeta({ rank: null, status: 'PAUSED', missed: 0, elo: 1044 }),
      'PAUSED', 'heroMeta reserve paused');
    eq(heroMeta({ rank: null, status: 'INACTIVE', missed: 4, elo: 987 }),
      'INACTIVE · 4 MISSED', 'heroMeta reserve inactive');

    /* streak + swing */
    eq(streakText({ type: 'W', count: 2 }), { text: 'W2', cls: 'w' }, 'streakText W2');
    eq(streakText({ type: 'L', count: 4 }), { text: 'L4', cls: 'l' }, 'streakText L4');
    eq(streakText(null), { text: '—', cls: '' }, 'streakText none');
    eq(swingParts(true, 12), { text: '+12', cls: 'up' }, 'swing win');
    eq(swingParts(false, 12), { text: '−12', cls: 'down' }, 'swing loss U+2212');

    /* pagination */
    eq(totalPages(54, 20), 3, 'totalPages 54 → 3');
    eq(totalPages(0, 20), 1, 'totalPages 0 → 1');
    eq(totalPages(20, 20), 1, 'totalPages exact boundary');
    eq(totalPages(21, 20), 2, 'totalPages boundary + 1');
    eq(pagerText(1, 3), 'PAGE 1 OF 3', 'pagerText');

    /* misc formatting */
    eq(turnsText(null), '—', 'turnsText null');
    eq(turnsText(14), '14', 'turnsText value');
    eq(phaseText('lobby'), 'NOT STARTED', 'phaseText lobby');
    eq(phaseText('T6'), 'T6', 'phaseText turn');
    eq(phaseText('picks'), 'PICKS', 'phaseText picks uppercased');

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

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function leagueColor(key) {
    try {
      if (window.Insignia && typeof window.Insignia.leagueColor === 'function') {
        return window.Insignia.leagueColor(key);
      }
    } catch (err) { /* fall through */ }
    return '#7E8B9B';
  }

  /* Obsidian metal is near-black — swap for legibility on text/fills. */
  function legibleLeagueColor(key) {
    return key === 'obsidian' ? OBSIDIAN_LEGIBLE : leagueColor(key);
  }

  function gameLink(gameId) {
    return GAME_URL + encodeURIComponent(gameId == null ? '' : gameId);
  }

  function el(tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function gameAnchor(gameId, cls, text) {
    var a = el('a', cls, text);
    a.href = gameLink(gameId);
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }

  /* roster ids (active + reserve) — only current members get profile links */
  var rosterIds = {};

  function setRoster(data) {
    rosterIds = {};
    (data.active || []).concat(data.reserve || []).forEach(function (pl) {
      if (pl && pl.id != null) rosterIds[String(pl.id)] = true;
    });
  }

  /* player-name node: <a.plink> to the profile when the id resolves to a
     current roster player; plain span otherwise ('Former member' etc.).
     stopPropagation so clickable ancestors (accordion rows) never toggle. */
  function nameNode(cls, text, pid) {
    if (pid == null || !rosterIds[String(pid)]) return el('span', cls, text);
    var a = el('a', cls ? 'plink ' + cls : 'plink', text);
    a.href = 'profile.html?p=' + encodeURIComponent(pid);
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    return a;
  }

  /* Baseline styles for everything this script renders, injected at
     zero specificity (:where()) so css/profile.css always wins. */
  function injectTransientStyles() {
    if ($('profile-transient-styles')) return;
    var mono = '"IBM Plex Mono",monospace';
    var disp = '"Barlow Condensed","Arial Narrow",sans-serif';
    var css = [
      /* progress bars */
      ':where(.prog){margin:.55em 0}',
      ':where(.prog-label){display:flex;justify-content:space-between;font-family:' + mono + ';',
      'font-size:.66rem;letter-spacing:.08em;color:var(--dim,#8A919C);margin-bottom:.3em;text-transform:uppercase}',
      ':where(.prog-track){height:6px;background:var(--card,#1B1D21);border:1px solid var(--line-soft,#222429);overflow:hidden}',
      ':where(.prog-fill){height:100%;background:var(--silver,#C6CDD6)}',
      /* career strip */
      ':where(#career-strip){display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.6em}',
      ':where(.tile){background:var(--card,#1B1D21);border:1px solid var(--line-soft,#222429);padding:.6em .4em;text-align:center}',
      ':where(.tile-value){font-family:' + disp + ';font-weight:700;font-size:1.7rem;line-height:1.1;color:var(--white,#F2F4F6)}',
      ':where(.tile-value.w){color:var(--red,#D22730)}',
      ':where(.tile-value.l){color:var(--dim,#8A919C)}',
      ':where(.tile-label){font-family:' + mono + ';font-size:.62rem;letter-spacing:.1em;color:var(--dim,#8A919C);margin-top:.25em}',
      /* records — victories card gets the double track */
      ':where(#records){display:grid;grid-template-columns:1fr 1fr 2fr;gap:.6em}',
      ':where(.rec-card){background:var(--card,#1B1D21);border:1px solid var(--line-soft,#222429);padding:.7em .85em}',
      ':where(.rec-label){font-family:' + mono + ';font-size:.62rem;letter-spacing:.1em;color:var(--dim,#8A919C)}',
      ':where(.rec-value){font-family:' + disp + ';font-weight:700;font-size:1.9rem;line-height:1.15;color:var(--white,#F2F4F6)}',
      ':where(.rec-value.w){color:var(--red,#D22730)}',
      ':where(.rec-value.l){color:var(--steel-down,#8FA3B8)}',
      ':where(.rec-sub){font-family:' + mono + ';font-size:.68rem;letter-spacing:.06em;color:var(--dim,#8A919C)}',
      /* victory rows: one shared column template (fixed tracks constant
         across rows, fr tracks resolve identically) so columns align */
      ':where(.rec-vic){display:grid;grid-template-columns:minmax(0,1.1fr) 4ch minmax(0,1fr) 11ch 1.1em;',
      'gap:0 10px;align-items:baseline;font-family:' + mono + ';font-size:.7rem;padding:.32em 0;',
      'color:var(--silver,#C6CDD6);border-bottom:1px solid var(--line-soft,#222429);text-decoration:none}',
      ':where(.rec-vic:hover){color:var(--white,#F2F4F6)}',
      /* .v-name/.v-go carry real specificity: .v-name can be an a.plink
         (color:inherit) and .v-go an anchor (base `a` rule) — the plink
         hover rule (a.plink:hover) still outranks .rec-vic .v-name */
      '.rec-vic .v-name{color:var(--white,#F2F4F6);font-weight:600;overflow:hidden;',
      'text-overflow:ellipsis;white-space:nowrap}',
      ':where(.rec-vic .v-rating){text-align:right;font-variant-numeric:tabular-nums;color:var(--white,#F2F4F6)}',
      ':where(.rec-vic .v-map){overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dim,#8A919C)}',
      ':where(.rec-vic .v-date){text-align:right;white-space:nowrap;color:var(--dim,#8A919C)}',
      '.rec-vic a.v-go{color:var(--red,#D22730);text-decoration:none;text-align:right}',
      '.rec-vic a.v-go:hover{color:var(--red-hover,#E23640)}',
      /* opponents / maps explorer */
      ':where(.xp-row){display:flex;align-items:baseline;gap:.8em;padding:.5em .35em;',
      'border-bottom:1px solid var(--line-soft,#222429);cursor:pointer;font-family:' + mono + ';font-size:.78rem}',
      ':where(.xp-row:hover){background:rgba(255,255,255,.02)}',
      ':where(.xp-name){flex:1;color:var(--white,#F2F4F6);font-weight:600;letter-spacing:.03em;min-width:0;',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      ':where(.xp-rec){color:var(--silver,#C6CDD6);white-space:nowrap}',
      ':where(.xp-rate){color:var(--dim,#8A919C);white-space:nowrap}',
      ':where(.xp-count){color:var(--dim,#8A919C);white-space:nowrap}',
      ':where(.xp-chev){color:var(--dim,#8A919C);transition:transform .18s ease}',
      ':where(.xp-row[aria-expanded="true"] .xp-chev){transform:rotate(180deg)}',
      ':where(.xp-detail){background:var(--card,#1B1D21);border-bottom:1px solid var(--line-soft,#222429);padding:.45em .6em}',
      /* mini-log */
      ':where(.ml-row){display:flex;gap:.9em;align-items:baseline;font-family:' + mono + ';',
      'font-size:.72rem;padding:.22em 0;color:var(--silver,#C6CDD6)}',
      ':where(.ml-date){color:var(--dim,#8A919C);white-space:nowrap;min-width:8.5em}',
      ':where(.ml-res){font-weight:600}',
      ':where(.ml-res.w){color:var(--red,#D22730)}',
      ':where(.ml-res.l){color:var(--dim,#8A919C)}',
      ':where(.ml-swing.up){color:var(--red,#D22730)}',
      ':where(.ml-swing.down){color:var(--dim,#8A919C)}',
      ':where(.ml-what){flex:1;color:var(--muted,#9AA1AB);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      ':where(.ml-turns){color:var(--dim,#8A919C);white-space:nowrap}',
      ':where(a.ml-link){color:var(--red,#D22730);text-decoration:none}',
      ':where(a.ml-link:hover){color:var(--red-hover,#E23640)}',
      /* timeline */
      ':where(.tl-entry){display:flex;gap:.7em;align-items:baseline;padding:.4em .2em;',
      'border-bottom:1px solid var(--line-soft,#222429);font-family:' + mono + ';font-size:.75rem;color:var(--silver,#C6CDD6)}',
      ':where(.tl-date){color:var(--dim,#8A919C);white-space:nowrap;min-width:8.5em}',
      ':where(.tl-mark){width:1.1em;text-align:center}',
      ':where(.tl-mark.promotion){color:var(--red,#D22730)}',
      ':where(.tl-mark.ascension){color:var(--silver,#C6CDD6)}',
      ':where(.tl-mark.demotion){color:var(--dim,#8A919C)}',
      ':where(.tl-chip){width:.65em;height:.65em;border-radius:2px;flex:none;align-self:center}',
      ':where(.tl-text){flex:1}',
      /* game log */
      ':where(#gamelog-body td){padding:.42em .6em;border-bottom:1px solid var(--line-soft,#222429);font-size:.78rem}',
      ':where(td.gl-date),:where(td.gl-turns){font-family:' + mono + ';color:var(--dim,#8A919C);white-space:nowrap;font-size:.72rem}',
      ':where(.gl-opp .o-name){color:var(--white,#F2F4F6);font-weight:600}',
      ':where(.gl-opp .o-rating){font-family:' + mono + ';color:var(--dim,#8A919C);font-size:.72rem;margin-left:.5em}',
      ':where(td.gl-res){font-family:' + mono + ';font-weight:600}',
      ':where(td.gl-res.w){color:var(--red,#D22730)}',
      ':where(td.gl-res.l){color:var(--dim,#8A919C)}',
      ':where(td.gl-swing){font-family:' + mono + '}',
      ':where(td.gl-swing.up){color:var(--red,#D22730)}',
      ':where(td.gl-swing.down){color:var(--dim,#8A919C)}',
      ':where(td.gl-map){color:var(--muted,#9AA1AB)}',
      ':where(td.gl-link a){color:var(--red,#D22730);text-decoration:none}',
      ':where(td.gl-link a:hover){color:var(--red-hover,#E23640)}',
      /* pager */
      ':where(#gamelog-pager){display:flex;align-items:center;justify-content:center;gap:1.2em;padding:.8em 0 .2em}',
      ':where(.pager-btn){font-family:' + mono + ';font-size:.68rem;letter-spacing:.1em;',
      'background:var(--card,#1B1D21);border:1px solid var(--line,#2A2D33);color:var(--silver,#C6CDD6);padding:.4em 1em;cursor:pointer}',
      ':where(.pager-btn:hover:not(:disabled)){border-color:var(--red,#D22730);color:var(--white,#F2F4F6)}',
      ':where(.pager-btn:disabled){opacity:.35;cursor:default}',
      ':where(.pager-info){font-family:' + mono + ';font-size:.68rem;letter-spacing:.1em;color:var(--dim,#8A919C)}',
      /* reliability */
      ':where(#reliability .kv){display:flex;justify-content:space-between;gap:1.5em;padding:.42em .2em;',
      'border-bottom:1px solid var(--line-soft,#222429);font-family:' + mono + ';font-size:.74rem}',
      ':where(.kv-key){color:var(--dim,#8A919C);letter-spacing:.08em;white-space:nowrap}',
      ':where(.kv-val){color:var(--silver,#C6CDD6);text-align:right;min-width:0}',
      ':where(.kv-val .kv-live){display:block}',
      '.kv-val a.kv-live-go{color:var(--red,#D22730);text-decoration:none}',
      '.kv-val a.kv-live-go:hover{color:var(--red-hover,#E23640)}',
      /* chart */
      ':where(#rating-chart){position:relative}',
      ':where(#rating-chart svg){display:block}',
      ':where(.chart-wrap){position:relative}',
      ':where(.chart-lab){position:absolute;transform:translateY(-50%);font-family:' + mono + ';',
      'font-size:9px;letter-spacing:.08em;padding-left:7px;white-space:nowrap;pointer-events:none}',
      ':where(.chart-dot){position:absolute;width:7px;height:7px;border-radius:50%;',
      'background:var(--red,#D22730);transform:translate(-50%,-50%);pointer-events:none}',
      ':where(.chart-ylab){position:absolute;left:0;transform:translateY(-50%);text-align:right;',
      'box-sizing:border-box;padding-right:8px;font-family:' + mono + ';font-size:9px;',
      'letter-spacing:.06em;color:var(--dim,#8A919C);font-variant-numeric:tabular-nums;pointer-events:none}',
      ':where(.chart-xlab){position:absolute;transform:translateX(-50%);padding-top:5px;',
      'font-family:' + mono + ';font-size:9px;letter-spacing:.06em;color:var(--dim,#8A919C);',
      'white-space:nowrap;pointer-events:none}',
      ':where(.chart-peak-dot){position:absolute;width:5px;height:5px;border-radius:50%;',
      'background:var(--silver,#C6CDD6);transform:translate(-50%,-50%);pointer-events:none}',
      ':where(.chart-peak-lab){position:absolute;font-family:' + mono + ';font-size:9px;',
      'letter-spacing:.08em;color:var(--silver,#C6CDD6);background:rgba(19,20,23,.78);',
      'padding:1px 4px;border-radius:2px;white-space:nowrap;pointer-events:none}',
      /* shared bits */
      ':where(.pf-empty){font-family:' + mono + ';font-size:.74rem;color:var(--dim,#8A919C);letter-spacing:.06em;padding:.6em .2em}',
      ':where(.pk-flat){font-family:' + mono + ';font-size:.72rem;color:var(--dim,#8A919C);padding:1.5em 0;text-align:center;letter-spacing:.08em}',
      ':where(#profile-error){font-family:' + mono + ';color:var(--muted,#9AA1AB);text-align:center;padding:2.2em 1em;letter-spacing:.05em}',
      ':where(#profile-error a){color:var(--red,#D22730)}',
      '@media (prefers-reduced-motion:reduce){:where(.xp-chev){transition:none}}'
    ].join('');
    var style = doc.createElement('style');
    style.id = 'profile-transient-styles';
    style.textContent = css;
    doc.head.appendChild(style);
  }

  /* ---------- hero ---------- */

  function renderHero(p) {
    var ins = $('hero-insignia');
    if (ins) {
      /* the hero insignia never pulses — no fresh-honor class here */
      try {
        if (window.Insignia && typeof window.Insignia.svg === 'function') {
          ins.innerHTML = window.Insignia.svg(p.rankIndex, p.league, 72);
        }
      } catch (err) {
        console.warn('[profile] Insignia.svg failed', err);
      }
    }
    setText('hero-name', String(p.name || '').toUpperCase());
    setText('hero-rank', String(p.rankName || '').toUpperCase());
    var lg = $('hero-league');
    if (lg) {
      lg.textContent = String(p.leagueName || '').toUpperCase() + ' LEAGUE';
      /* opaque metallic plate: the global .lg-<key> class supplies the
         --lg-* custom properties; profile.css paints the badge */
      lg.className = 'lg-' + (p.league || 'lumber');
    }
    setText('hero-meta', heroMeta(p));
  }

  function renderBar(container, pr, fillColor) {
    if (!container) return;
    container.textContent = '';
    var wrap = el('div', 'prog');
    var label = el('div', 'prog-label');
    label.appendChild(el('span', 'prog-text', pr.label));
    label.appendChild(el('span', 'prog-pct', Math.round(pr.frac * 100) + '%'));
    wrap.appendChild(label);
    var track = el('div', 'prog-track');
    var fill = el('div', 'prog-fill');
    fill.style.width = (pr.frac * 100).toFixed(1) + '%';
    if (fillColor) fill.style.background = fillColor;
    track.appendChild(fill);
    wrap.appendChild(track);
    container.appendChild(wrap);
  }

  function renderProgress(p) {
    renderBar($('prog-rank'), rankProgress(p.wins), '');
    renderBar($('prog-league'), leagueProgress(p.elo), legibleLeagueColor(p.league));
  }

  /* ---------- career strip ---------- */

  function renderCareer(p) {
    var strip = $('career-strip');
    if (!strip) return;
    strip.textContent = '';
    var st = streakText(p.streak);
    var tiles = [
      { value: p.wins + '–' + p.losses, label: 'W–L' },
      { value: p.gamesPlayed > 0 ? p.winRate + '%' : '—', label: 'WIN %' },
      { value: p.elo != null ? String(p.elo) : '—', label: 'RATING' },
      { value: st.text, label: 'STREAK', cls: st.cls }
    ];
    tiles.forEach(function (t) {
      var tile = el('div', 'tile');
      tile.appendChild(el('div', 'tile-value' + (t.cls ? ' ' + t.cls : ''), t.value));
      tile.appendChild(el('div', 'tile-label', t.label));
      strip.appendChild(tile);
    });
  }

  /* ---------- rating chart ---------- */

  function renderChart(p) {
    var box = $('rating-chart');
    if (!box) return;
    box.textContent = '';

    var traj = p.traj || [];
    var dom = chartDomain(traj);
    if (!dom) {
      box.appendChild(el('div', 'pk-flat',
        'NOT ENOUGH GAMES — ' + (p.gamesPlayed || 0) + ' PLAYED'));
      return;
    }

    /* axis gutters — left: rating ticks · right: league names · bottom:
       month ticks. Fixed CSS-px sizes converted into svg units from the
       rendered width, so they hold at any viewport. The plot (zone
       rects, polyline, dots) ends before every gutter, so the
       current-rating dot can never collide with axis or league labels. */
    var W = 600, H = 190;
    var k = 1; /* svg units per CSS px */
    try {
      var rect = box.getBoundingClientRect();
      var bcs = window.getComputedStyle(box);
      var innerW = rect.width -
        (parseFloat(bcs.paddingLeft) || 0) - (parseFloat(bcs.paddingRight) || 0);
      if (innerW > 0) k = W / innerW;
    } catch (err) { /* keep 1:1 */ }
    var GUT_R = Math.max(20, Math.min(240, 58 * k)); /* league names */
    var GUT_L = Math.max(14, Math.min(170, 40 * k)); /* rating labels */
    var GUT_B = Math.max(8, Math.min(80, 18 * k));   /* month labels */
    var TICK = 4 * k;
    var padL = GUT_L, padR = GUT_R, padT = 10, padB = GUT_B + 8;
    var lo = dom.lo, hi = dom.hi;

    /* time-scaled x: every point sits at its game's finish time, so
       equal time differences are equal horizontal distances (degenerate
       time data falls back to even index spacing) */
    var log = p.gameLog || [];
    var times = trajTimes(log, traj.length);
    var tMin = times ? times[0] : 0;
    var tMax = times ? times[times.length - 1] : 0;
    if (!times || !(tMax > tMin)) times = null;
    function xAt(t) {
      return padL + (t - tMin) / (tMax - tMin) * (W - padL - padR);
    }
    function x(i) {
      return times
        ? xAt(times[i])
        : padL + i * (W - padL - padR) / (traj.length - 1);
    }
    function y(v) { return padT + (hi - v) / (hi - lo) * (H - padT - padB); }

    var parts = [];
    parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H +
      '" preserveAspectRatio="none" aria-label="Rating history chart" role="img">');

    /* league zone fills — one low-opacity rect per band intersecting the
       y-domain, floor → next floor, beneath everything else */
    leagueBandsInDomain(lo, hi).forEach(function (b) {
      var top = y(b.hi), bot = y(b.lo);
      parts.push('<rect x="' + padL + '" y="' + top.toFixed(1) +
        '" width="' + (W - padL - padR) + '" height="' + (bot - top).toFixed(1) +
        '" fill="' + leagueColor(b.key) + '" fill-opacity="0.09"/>');
    });

    /* dashed 1000 baseline */
    if (1000 >= lo && 1000 <= hi) {
      var by = y(1000).toFixed(1);
      parts.push('<line x1="' + padL + '" y1="' + by + '" x2="' + (W - padR) + '" y2="' + by +
        '" stroke="#2A2D33" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>');
    }

    /* league floor lines (labels are HTML overlays — text inside a
       preserveAspectRatio:none svg would distort) */
    var floors = floorsInDomain(lo, hi);
    floors.forEach(function (f) {
      var fy = y(f.lo).toFixed(1);
      parts.push('<line x1="' + padL + '" y1="' + fy + '" x2="' + (W - padR) + '" y2="' + fy +
        '" stroke="' + leagueColor(f.key) + '" stroke-opacity="0.35" stroke-width="1" vector-effect="non-scaling-stroke"/>');
    });

    /* axes: rating ticks at the plot's left edge · baseline + month
       ticks along the bottom (labels are HTML overlays, added below) */
    var yt = yTicks(lo, hi);
    yt.forEach(function (v) {
      var ty = y(v).toFixed(1);
      parts.push('<line x1="' + (padL - TICK).toFixed(1) + '" y1="' + ty +
        '" x2="' + padL.toFixed(1) + '" y2="' + ty +
        '" stroke="#3A3D45" stroke-width="1" vector-effect="non-scaling-stroke"/>');
    });
    var xBase = (H - GUT_B).toFixed(1);
    parts.push('<line x1="' + padL.toFixed(1) + '" y1="' + xBase +
      '" x2="' + (W - padR).toFixed(1) + '" y2="' + xBase +
      '" stroke="#2A2D33" stroke-width="1" vector-effect="non-scaling-stroke"/>');
    var plotPx = (W - padL - padR) / k;
    var mt = times
      ? monthTicks(tMin, tMax, Math.max(2, Math.min(6, Math.floor(plotPx / 55))))
      : [];
    mt.forEach(function (t) {
      var tx = xAt(t.t).toFixed(1);
      parts.push('<line x1="' + tx + '" y1="' + xBase + '" x2="' + tx +
        '" y2="' + (H - GUT_B + TICK).toFixed(1) +
        '" stroke="#3A3D45" stroke-width="1" vector-effect="non-scaling-stroke"/>');
    });

    /* trajectory */
    var pts = [];
    for (var i = 0; i < traj.length; i++) {
      pts.push(x(i).toFixed(1) + ',' + y(traj[i]).toFixed(1));
    }
    parts.push('<polyline points="' + pts.join(' ') +
      '" fill="none" stroke="#C6CDD6" stroke-width="1.8" vector-effect="non-scaling-stroke"/>');
    parts.push('</svg>');

    /* wrapper matches the svg box exactly, so %-positioned overlays
       (labels, dot) track the svg at any rendered size */
    var wrap = el('div', 'chart-wrap');
    wrap.innerHTML = parts.join('');
    box.appendChild(wrap);

    /* floor labels — tiny mono in the right gutter (outside the plot),
       league colored */
    floors.forEach(function (f) {
      var lab = el('span', 'chart-lab', f.name.toUpperCase());
      lab.style.top = (y(f.lo) / H * 100).toFixed(2) + '%';
      lab.style.left = ((W - padR) / W * 100).toFixed(2) + '%';
      lab.style.color = legibleLeagueColor(f.key);
      wrap.appendChild(lab);
    });

    /* y-axis rating labels — right-aligned into the left gutter */
    yt.forEach(function (v) {
      var lab = el('span', 'chart-ylab', String(v));
      lab.style.top = (y(v) / H * 100).toFixed(2) + '%';
      lab.style.width = (padL / W * 100).toFixed(2) + '%';
      wrap.appendChild(lab);
    });

    /* x-axis month labels — 'mm-yyyy' centered under their tick */
    mt.forEach(function (t) {
      var lab = el('span', 'chart-xlab', t.label);
      lab.style.left = (xAt(t.t) / W * 100).toFixed(2) + '%';
      lab.style.top = ((H - GUT_B) / H * 100).toFixed(2) + '%';
      wrap.appendChild(lab);
    });

    /* peak marker + label — offset toward the plot's interior so it
       clears the edges, the gutters and the current-rating dot */
    var peakVal = -Infinity, pi = 0;
    for (var j = 0; j < traj.length; j++) {
      if (traj[j] > peakVal) { peakVal = traj[j]; pi = j; }
    }
    var pkDot = el('span', 'chart-peak-dot');
    pkDot.style.left = (x(pi) / W * 100).toFixed(2) + '%';
    pkDot.style.top = (y(peakVal) / H * 100).toFixed(2) + '%';
    wrap.appendChild(pkDot);
    var pkLab = el('span', 'chart-peak-lab', 'PEAK ' + Math.round(peakVal));
    pkLab.style.left = (x(pi) / W * 100).toFixed(2) + '%';
    pkLab.style.top = (y(peakVal) / H * 100).toFixed(2) + '%';
    var xFrac = (x(pi) - padL) / (W - padL - padR);
    var yFrac = (y(peakVal) - padT) / (H - padT - padB);
    pkLab.style.transform = 'translate(' +
      (xFrac > 0.55 ? 'calc(-100% - 9px)' : '9px') + ',' +
      (yFrac > 0.55 ? 'calc(-100% - 6px)' : '7px') + ')';
    wrap.appendChild(pkLab);

    /* endpoint dot on the last value (added last — layers above) */
    var dot = el('span', 'chart-dot');
    dot.style.left = (x(traj.length - 1) / W * 100).toFixed(2) + '%';
    dot.style.top = (y(traj[traj.length - 1]) / H * 100).toFixed(2) + '%';
    wrap.appendChild(dot);
  }

  /* ---------- records ---------- */

  function renderRecords(p) {
    var box = $('records');
    if (!box) return;
    box.textContent = '';
    var log = p.gameLog || [];

    /* (the peak now lives on the rating chart — no PEAK RATING card) */

    /* longest win streak — value + the run's date range */
    var winRun = longestRun(log, true);
    var streak = el('div', 'rec-card');
    streak.appendChild(el('div', 'rec-label', 'LONGEST WIN STREAK'));
    streak.appendChild(el('div', 'rec-value' + (winRun.len > 0 ? ' w' : ''),
      longestStreakText(winRun.len)));
    streak.appendChild(el('div', 'rec-sub', winRun.len > 0
      ? dateRangeText(winRun.start.date, winRun.end.date)
      : 'NO WINS YET'));
    box.appendChild(streak);

    /* longest loss streak — steel-blue value + its date range */
    var lossRun = longestRun(log, false);
    var lstreak = el('div', 'rec-card');
    lstreak.appendChild(el('div', 'rec-label', 'LONGEST LOSS STREAK'));
    lstreak.appendChild(el('div', 'rec-value' + (lossRun.len > 0 ? ' l' : ''),
      lossRun.len > 0 ? 'L' + lossRun.len : '—'));
    lstreak.appendChild(el('div', 'rec-sub', lossRun.len > 0
      ? dateRangeText(lossRun.start.date, lossRun.end.date)
      : 'NO LOSSES YET'));
    box.appendChild(lstreak);

    /* top victories */
    var vic = el('div', 'rec-card');
    vic.appendChild(el('div', 'rec-label', 'TOP VICTORIES'));
    var best = topVictories(log, 3);
    if (!best.length) {
      vic.appendChild(el('div', 'pf-empty', 'NO VICTORIES YET'));
    } else {
      best.forEach(function (g) {
        /* grid row with a fixed column template (opponent · rating ·
           map · date · ↗) so the columns align across rows; the name
           links to the profile (plink), the ↗ to the game */
        var row = el('div', 'rec-vic');
        row.appendChild(nameNode('v-name', 'VS ' + String(g.opp || '').toUpperCase(), g.oppId));
        row.appendChild(el('span', 'v-rating', String(g.oppRating != null ? g.oppRating : '—')));
        var mapCell = el('span', 'v-map', g.map != null ? String(g.map) : '—');
        mapCell.title = g.map != null ? String(g.map) : '';
        row.appendChild(mapCell);
        row.appendChild(el('span', 'v-date', fmtDate(g.date)));
        var go = gameAnchor(g.gameId, 'v-go', '↗');
        go.setAttribute('aria-label', 'View this game on warzone.com');
        row.appendChild(go);
        vic.appendChild(row);
      });
    }
    box.appendChild(vic);
  }

  /* ---------- mini-log (accordion detail rows) ---------- */

  /* whatNode: builds the middle column node (map text vs opponent link) */
  function buildMiniLog(games, whatNode) {
    var frag = doc.createDocumentFragment();
    games.forEach(function (g) {
      var row = el('div', 'ml-row');
      row.appendChild(el('span', 'ml-date', fmtDate(g.date)));
      row.appendChild(el('span', 'ml-res ' + (g.won ? 'w' : 'l'), g.won ? 'W' : 'L'));
      var sw = swingParts(g.won, g.change);
      row.appendChild(el('span', 'ml-swing ' + sw.cls, sw.text));
      var what = el('span', 'ml-what');
      what.appendChild(whatNode(g));
      row.appendChild(what);
      row.appendChild(el('span', 'ml-turns',
        g.turns != null ? turnsText(g.turns) + ' TURNS' : '—'));
      row.appendChild(gameAnchor(g.gameId, 'ml-link', '↗'));
      frag.appendChild(row);
    });
    return frag;
  }

  /* Accordion list shared by OPPONENTS and MAPS: one open detail per
     list, same interaction pattern as the standings quick-peek. */
  function renderAccordionList(container, groups, buildRowCells, buildDetail) {
    if (!container) return;
    container.textContent = '';
    if (!groups.length) {
      container.appendChild(el('div', 'pf-empty', 'NO GAMES YET'));
      return;
    }
    var open = null; /* { row, detail } */

    function close() {
      if (!open) return;
      open.row.setAttribute('aria-expanded', 'false');
      open.detail.hidden = true;
      open = null;
    }

    groups.forEach(function (grp) {
      var row = el('div', 'xp-row');
      row.setAttribute('role', 'button');
      row.setAttribute('aria-expanded', 'false');
      row.tabIndex = 0;
      buildRowCells(row, grp);
      row.appendChild(el('span', 'xp-chev', '▾'));

      var detail = el('div', 'xp-detail');
      detail.hidden = true;

      function toggle() {
        if (open && open.row === row) { close(); return; }
        close();
        if (!detail.childNodes.length) detail.appendChild(buildDetail(grp));
        detail.hidden = false;
        row.setAttribute('aria-expanded', 'true');
        open = { row: row, detail: detail };
      }

      row.addEventListener('click', toggle);
      row.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        /* Enter on a focused name link navigates, never toggles */
        if (e.target && e.target.closest && e.target.closest('a')) return;
        e.preventDefault();
        toggle();
      });

      container.appendChild(row);
      container.appendChild(detail);
    });
  }

  function renderOpponents(p) {
    var groups = groupByOpponent(p.gameLog || []);
    renderAccordionList($('opponents-list'), groups,
      function (row, grp) {
        row.appendChild(nameNode('xp-name', String(grp.name || '').toUpperCase(), grp.oppId));
        row.appendChild(el('span', 'xp-rec', grp.w + '–' + grp.l));
        row.appendChild(el('span', 'xp-count', '(' + grp.winRate + '%)'));
      },
      function (grp) {
        return buildMiniLog(grp.games, function (g) {
          return doc.createTextNode(g.map);
        });
      });
  }

  function renderMaps(p) {
    var groups = groupByMap(p.gameLog || []);
    renderAccordionList($('maps-list'), groups,
      function (row, grp) {
        row.appendChild(el('span', 'xp-name', String(grp.map || '').toUpperCase()));
        row.appendChild(el('span', 'xp-rec', grp.w + '–' + grp.l));
        row.appendChild(el('span', 'xp-count', grp.winRate + '% (' + grp.count + ')'));
      },
      function (grp) {
        return buildMiniLog(grp.games, function (g) {
          return nameNode('', String(g.opp || '').toUpperCase(), g.oppId);
        });
      });
  }

  /* ---------- timeline (personal gazette) ---------- */

  function timelineMarker(kind) {
    if (kind === 'promotion') return '★';
    if (kind === 'ascension') return '▲';
    if (kind === 'demotion') return '▼';
    return '·';
  }

  function renderTimeline(p, gazette) {
    var box = $('timeline');
    if (!box) return;
    box.textContent = '';
    var mine = (gazette || []).filter(function (g) {
      return g && String(g.playerId) === String(p.id);
    }); /* gazette arrives newest first */
    if (!mine.length) {
      box.appendChild(el('div', 'pf-empty', 'NO HONORS YET — FIRST PROMOTION AT 10 WINS'));
      return;
    }
    mine.forEach(function (g) {
      var row = el('div', 'tl-entry tl-entry--' + (g.kind || 'unknown'));
      row.appendChild(el('span', 'tl-date', fmtDate(g.date)));
      row.appendChild(el('span', 'tl-mark ' + (g.kind || ''), timelineMarker(g.kind)));
      if (g.leagueKey) {
        var chip = el('span', 'tl-chip');
        chip.style.background = leagueColor(g.leagueKey);
        chip.title = (g.leagueName || '') + ' League';
        row.appendChild(chip);
      }
      row.appendChild(el('span', 'tl-text', g.text || ''));
      box.appendChild(row);
    });
  }

  /* ---------- game log (paginated) ---------- */

  function buildGameRow(g) {
    var tr = doc.createElement('tr');

    tr.appendChild(el('td', 'gl-date', fmtDate(g.date)));

    var opp = el('td', 'gl-opp');
    opp.appendChild(nameNode('o-name', String(g.opp || '').toUpperCase(), g.oppId));
    opp.appendChild(el('span', 'o-rating', String(g.oppRating != null ? g.oppRating : '—')));
    tr.appendChild(opp);

    tr.appendChild(el('td', 'gl-res ' + (g.won ? 'w' : 'l'), g.won ? 'W' : 'L'));

    var sw = swingParts(g.won, g.change);
    tr.appendChild(el('td', 'gl-swing ' + sw.cls, sw.text));

    tr.appendChild(el('td', 'gl-map', g.map != null ? String(g.map) : '—'));
    tr.appendChild(el('td', 'gl-turns', turnsText(g.turns)));

    var link = el('td', 'gl-link');
    var a = gameAnchor(g.gameId, '', '↗');
    a.setAttribute('aria-label', 'View this game on warzone.com');
    link.appendChild(a);
    tr.appendChild(link);

    return tr;
  }

  function renderGameLog(p) {
    var body = $('gamelog-body');
    if (!body) return;
    var pager = $('gamelog-pager');
    var log = p.gameLog || [];
    var pages = totalPages(log.length, PER_PAGE);
    var page = 1;

    var prevBtn = null, nextBtn = null, info = null;
    if (pager) {
      pager.textContent = '';
      prevBtn = el('button', 'pager-btn', 'PREV');
      prevBtn.type = 'button';
      nextBtn = el('button', 'pager-btn', 'NEXT');
      nextBtn.type = 'button';
      info = el('span', 'pager-info', pagerText(page, pages));
      pager.appendChild(prevBtn);
      pager.appendChild(info);
      pager.appendChild(nextBtn);
      prevBtn.addEventListener('click', function () { go(page - 1); });
      nextBtn.addEventListener('click', function () { go(page + 1); });
    }

    function draw() {
      body.textContent = '';
      if (!log.length) {
        var tr = doc.createElement('tr');
        var td = el('td', 'pf-empty', 'NO GAMES YET');
        td.colSpan = 7;
        tr.appendChild(td);
        body.appendChild(tr);
      } else {
        log.slice((page - 1) * PER_PAGE, page * PER_PAGE).forEach(function (g) {
          body.appendChild(buildGameRow(g));
        });
      }
      if (pager) {
        prevBtn.disabled = page <= 1;
        nextBtn.disabled = page >= pages;
        info.textContent = pagerText(page, pages);
      }
    }

    function go(next) {
      var clamped = Math.max(1, Math.min(pages, next));
      if (clamped === page) return;
      page = clamped;
      draw();
      /* bring the log panel back into view on page change */
      var panel = body.closest ? (body.closest('.panel') || body.closest('section')) : null;
      var target = panel || body;
      try {
        target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } catch (err) {
        target.scrollIntoView();
      }
    }

    draw();
  }

  /* ---------- reliability ---------- */

  function kvLine(key, val) {
    var row = el('div', 'kv');
    row.appendChild(el('span', 'kv-key', key));
    if (typeof val === 'string') {
      row.appendChild(el('span', 'kv-val', val));
    } else {
      row.appendChild(val); /* prebuilt .kv-val node */
    }
    return row;
  }

  function renderReliability(p) {
    var box = $('reliability');
    if (!box) return;
    box.textContent = '';

    box.appendChild(kvLine('STATUS', statusVal(p)));
    box.appendChild(kvLine('GAME CAP', capText(p.cap)));

    /* voided games: count, then a dim parenthetical breakdown */
    var vp = voidsParts(p.voids);
    var voidsVal = el('span', 'kv-val', vp.main);
    if (vp.detail) {
      var detail = el('span', '', ' ' + vp.detail);
      detail.style.color = 'var(--dim)';
      voidsVal.appendChild(detail);
    }
    box.appendChild(kvLine('VOIDED GAMES', voidsVal));

    box.appendChild(kvLine('ENLISTED', fmtDate(p.firstGameAt) || '—'));

    var liveVal = el('span', 'kv-val');
    var live = p.liveGames || [];
    if (!live.length) {
      liveVal.textContent = 'NO ACTIVE GAMES';
    } else {
      live.forEach(function (lg) {
        /* div line: opponent name links to their profile, the ↗ to the game */
        var lineEl = el('div', 'kv-live');
        lineEl.appendChild(doc.createTextNode('● vs '));
        lineEl.appendChild(nameNode('', String(lg.opp || '').toUpperCase(), lg.oppId));
        lineEl.appendChild(doc.createTextNode(' · ' + lg.map + ' · ' + phaseText(lg.phase) + ' '));
        var go = gameAnchor(lg.gameId, 'kv-live-go', '↗');
        go.setAttribute('aria-label', 'View this game on warzone.com');
        lineEl.appendChild(go);
        liveVal.appendChild(lineEl);
      });
    }
    box.appendChild(kvLine('LIVE NOW', liveVal));
  }

  /* ---------- error states ---------- */

  function setRootState(cls) {
    var root = $('profile-root');
    if (!root) return;
    root.classList.remove('is-loading', 'is-ready', 'is-error');
    root.classList.add(cls);
  }

  function showError(prefix, linkText, onClick, href) {
    setRootState('is-error');
    var err = $('profile-error');
    if (!err) return;
    err.hidden = false;
    err.textContent = '';
    err.appendChild(doc.createTextNode(prefix + ' — '));
    var a = doc.createElement('a');
    a.href = href || '#';
    a.textContent = linkText;
    if (onClick) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        onClick();
      });
    }
    err.appendChild(a);
  }

  function showNotFound() {
    showError('PLAYER NOT FOUND', 'BACK TO STANDINGS', null, 'index.html');
  }

  function showLoadError() {
    showError('LADDER DATA UNREACHABLE', 'RETRY', function () {
      window.location.reload();
    });
  }

  /* ---------- main ---------- */

  function findPlayer(data, pid) {
    if (pid == null || pid === '') return null;
    var pools = [data.active || [], data.reserve || []];
    for (var k = 0; k < pools.length; k++) {
      for (var i = 0; i < pools[k].length; i++) {
        if (String(pools[k][i].id) === String(pid)) return pools[k][i];
      }
    }
    return null;
  }

  function renderAll(p, data) {
    doc.title = String(p.name || '').toUpperCase() + " — M'HUNTERS LADDER";
    renderHero(p);
    renderProgress(p);
    renderCareer(p);
    renderChart(p);
    renderRecords(p);
    renderOpponents(p);
    renderMaps(p);
    renderTimeline(p, data.gazette);
    renderGameLog(p);
    renderReliability(p);
    setRootState('is-ready');
  }

  function init() {
    injectTransientStyles();
    setRootState('is-loading');

    var pid = null;
    try {
      pid = new URLSearchParams(window.location.search).get('p');
    } catch (err) {
      pid = null;
    }

    if (!window.LadderData || typeof window.LadderData.load !== 'function') {
      console.error('[profile] window.LadderData.load is missing — is js/derive.js loaded before js/profile.js?');
      showLoadError();
      return;
    }

    window.LadderData.load().then(function (data) {
      data = data || {};
      setRoster(data);
      var p = findPlayer(data, pid);
      if (!p) {
        showNotFound();
        return;
      }
      try {
        renderAll(p, data);
      } catch (err) {
        console.error('[profile] render failed', err);
        showLoadError();
      }
    }).catch(function (err) {
      console.error('[profile] ladder data load failed', err);
      showLoadError();
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
