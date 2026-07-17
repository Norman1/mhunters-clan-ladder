/* =========================================================================
   M'Hunters Clan Ladder — data layer (track A)
   Exposes window.LadderData.load() ->
     Promise<{active, reserve, gazette, results, allResults, live, meta}>
   Plain script, no modules. Runs in browser and (for tests) in node.
   ========================================================================= */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- *
   * Constants (domain rules — non-negotiable)
   * ---------------------------------------------------------------- */

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

  var VOID_NOTES = { 'Timed Out (Lobby)': true, 'Declined': true, 'Terminated': true };

  var WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  var START_RATING = 1000;

  /* ---------------------------------------------------------------- *
   * Small helpers
   * ---------------------------------------------------------------- */

  // Decisive game = has p1_id AND winner_id, and is not a void.
  // Voids and stubs (no p1_id) are NEVER games.
  function isDecisive(g) {
    if (!g || !g.p1_id || !g.winner_id) return false;
    if (g.note && VOID_NOTES[g.note]) return false;
    return true;
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

  function winsToNextRank(wins) {
    var idx = rankIndexForWins(wins);
    if (idx >= RANK_THRESHOLDS.length - 1) return null;
    return RANK_THRESHOLDS[idx + 1] - wins;
  }

  function ts(iso) {
    var t = Date.parse(iso);
    return isNaN(t) ? 0 : t;
  }

  function relativeText(ms, nowMs) {
    var diff = Math.max(0, nowMs - ms);
    var mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'M AGO';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'H AGO';
    var days = Math.floor(hours / 24);
    return days + 'D AGO';
  }

  /* ---------------------------------------------------------------- *
   * Core derivation
   * ---------------------------------------------------------------- */

  function derive(players, history, activeGames, templates) {
    var i, g, id;

    // template id → name (recent games use current ids; unknowns fall back)
    var mapNames = {};
    (templates || []).forEach(function (t) {
      if (t && t.id != null) mapNames[String(t.id)] = t.name || ('TEMPLATE ' + t.id);
    });

    // Legacy template-id resolution (mirrors production buildLegacyIdMap):
    // when a template is re-created it gets a new Warzone id; legacy_ids on the
    // current template keep old history linked. legacy id → canonical id.
    var legacyIdMap = {};
    (templates || []).forEach(function (t) {
      if (t && t.legacy_ids) {
        t.legacy_ids.forEach(function (lid) {
          legacyIdMap[String(lid)] = String(t.id);
        });
      }
    });
    function resolveTemplateId(rawId) {
      var sid = String(rawId);
      return legacyIdMap[sid] || sid;
    }

    function mapName(tid) {
      return mapNames[resolveTemplateId(tid)] || (tid != null ? 'TEMPLATE ' + tid : '—');
    }
    function playerName(pid) {
      return players[pid] ? players[pid].name : 'Former member';
    }

    // ----- classify + order the decisive games (finished_at ascending) -----
    var decisive = [];
    for (i = 0; i < history.length; i++) {
      if (isDecisive(history[i])) decisive.push(history[i]);
    }
    decisive.sort(function (a, b) {
      return ts(a.finished_at) - ts(b.finished_at);
    });

    // Newest finished_at in the data (reference clock for delta7 / freshHonor)
    var newestFinished = 0;
    for (i = 0; i < history.length; i++) {
      var ft = history[i].finished_at ? ts(history[i].finished_at) : 0;
      if (ft > newestFinished) newestFinished = ft;
    }
    var weekAgo = newestFinished - WEEK_MS;

    // ----- full replay: trajectories, wins, peaks, per-map records, gazette -----
    // state per player id: { rating, wins, peak, games, traj, maps: {tid: {w,l}},
    //                        log (chronological game-log entries), peakAt, firstIso }
    var state = {};
    function st(pid) {
      if (!state[pid]) {
        state[pid] = {
          rating: START_RATING, wins: 0, losses: 0, peak: START_RATING,
          games: [], traj: [START_RATING], maps: {},
          log: [], peakAt: null, firstIso: null
        };
      }
      return state[pid];
    }

    var gazette = [];
    var allResults = []; // every decisive game (built chronologically, reversed below)

    for (i = 0; i < decisive.length; i++) {
      g = decisive[i];
      var change = typeof g.elo_change === 'number' ? g.elo_change : 0;
      var when = g.finished_at;

      var pair = [
        { pid: g.winner_id, won: true },
        { pid: g.loser_id, won: false }
      ];

      // Ratings as they stood BEFORE this game (for gameLog oppRating)
      var beforeRating = {};
      for (var k0 = 0; k0 < pair.length; k0++) {
        if (pair[k0].pid) beforeRating[pair[k0].pid] = st(pair[k0].pid).rating;
      }

      // Global results list entry (pre-game replayed ratings on both sides)
      allResults.push({
        date: when,
        gameId: g.game_id,
        winnerId: g.winner_id,
        winner: playerName(g.winner_id),
        wRating: beforeRating[g.winner_id],
        loserId: g.loser_id,
        loser: playerName(g.loser_id),
        lRating: g.loser_id ? beforeRating[g.loser_id] : null,
        change: Math.abs(change),
        map: mapName(g.template_id),
        templateId: resolveTemplateId(g.template_id),
        turns: (typeof g.turns === 'number' && g.turns >= 1) ? g.turns : null
      });

      for (var k = 0; k < pair.length; k++) {
        var pid = pair[k].pid;
        if (!pid) continue;
        var s = st(pid);
        var won = pair[k].won;
        var oppId = pair[1 - k].pid || null;

        var leagueBefore = leagueIndexForElo(s.rating);
        var rankBefore = rankIndexForWins(s.wins);

        s.rating += won ? change : -change;
        if (won) s.wins += 1; else s.losses += 1;
        if (s.rating > s.peak) { s.peak = s.rating; s.peakAt = when; }
        if (!s.firstIso) s.firstIso = when;
        s.games.push({ won: won, change: change, at: ts(when) });
        s.traj.push(s.rating);
        s.log.push({
          date: when,
          oppId: oppId,
          opp: playerName(oppId),
          won: won,
          change: Math.abs(change),
          map: mapName(g.template_id),
          turns: (typeof g.turns === 'number' && g.turns >= 1) ? g.turns : null,
          gameId: g.game_id,
          oppRating: oppId != null ? beforeRating[oppId] : null,
          rating: s.rating
        });
        var mkey = String(g.template_id);
        if (!s.maps[mkey]) s.maps[mkey] = { w: 0, l: 0 };
        if (won) s.maps[mkey].w += 1; else s.maps[mkey].l += 1;

        var player = players[pid];
        var name = player ? player.name : null;

        // Rank promotion (career wins cross a threshold — never decreases)
        var rankAfter = rankIndexForWins(s.wins);
        if (rankAfter > rankBefore && name) {
          gazette.push({
            date: when,
            text: name + ' achieved the status of ' + RANK_NAMES[rankAfter] +
              ' for reaching ' + RANK_THRESHOLDS[rankAfter] + ' career wins on the ladder!',
            kind: 'promotion',
            playerId: pid,
            playerName: name,
            rankIndex: rankAfter,
            rankName: RANK_NAMES[rankAfter],
            threshold: RANK_THRESHOLDS[rankAfter]
          });
        }

        // League crossing (moves both ways)
        var leagueAfter = leagueIndexForElo(s.rating);
        if (leagueAfter !== leagueBefore && name) {
          if (leagueAfter > leagueBefore) {
            gazette.push({
              date: when,
              text: name + ' was promoted to the ' + LEAGUES[leagueAfter].name +
                ' League for reaching an ELO rating of ' + LEAGUES[leagueAfter].lo + '!',
              kind: 'ascension',
              playerId: pid,
              playerName: name,
              leagueKey: LEAGUES[leagueAfter].key,
              leagueName: LEAGUES[leagueAfter].name,
              boundary: LEAGUES[leagueAfter].lo
            });
          } else {
            gazette.push({
              date: when,
              text: name + ' was relegated to the ' + LEAGUES[leagueAfter].name +
                ' League for dropping below an ELO rating of ' + LEAGUES[leagueBefore].lo + '!',
              kind: 'demotion',
              playerId: pid,
              playerName: name,
              leagueKey: LEAGUES[leagueAfter].key,
              leagueName: LEAGUES[leagueAfter].name,
              boundary: LEAGUES[leagueBefore].lo
            });
          }
        }
      }
    }

    // Gazette newest first (stable: later replay order first on identical dates)
    gazette = gazette
      .map(function (e, idx) { return { e: e, idx: idx }; })
      .sort(function (a, b) {
        var d = ts(b.e.date) - ts(a.e.date);
        return d !== 0 ? d : b.idx - a.idx;
      })
      .map(function (w) { return w.e; });

    // ----- voids per player (voids are NEVER games — counted separately) -----
    // Every raw history entry with a p1_id and a void note counts once for
    // each participant. 'Timed Out (Lobby)' → timeouts; 'Declined'/'Terminated' → declines.
    var voidsByPlayer = {};
    for (i = 0; i < history.length; i++) {
      g = history[i];
      if (!g.p1_id || !g.note || !VOID_NOTES[g.note]) continue;
      var vKind = g.note === 'Timed Out (Lobby)' ? 'timeouts' : 'declines';
      var vParts = [g.p1_id, g.p2_id];
      for (var vi = 0; vi < vParts.length; vi++) {
        var vPid = vParts[vi];
        if (!vPid) continue;
        if (!voidsByPlayer[vPid]) voidsByPlayer[vPid] = { total: 0, timeouts: 0, declines: 0 };
        voidsByPlayer[vPid].total += 1;
        voidsByPlayer[vPid][vKind] += 1;
      }
    }

    // ----- fresh honor: promotion/ascension within 7 days of newest data -----
    var freshIds = {};
    for (i = 0; i < gazette.length; i++) {
      var entry = gazette[i];
      if ((entry.kind === 'promotion' || entry.kind === 'ascension') &&
          ts(entry.date) >= weekAgo) {
        freshIds[entry.playerId] = true;
      }
    }

    // ----- reconcile replayed rating with stored elo -----
    for (id in players) {
      if (!Object.prototype.hasOwnProperty.call(players, id)) continue;
      var replayed = state[id] ? state[id].rating : START_RATING;
      if (Math.abs(replayed - players[id].elo) > 1) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('LadderData: replay mismatch for ' + players[id].name +
            ' (' + id + '): replayed ' + replayed + ' vs stored ' + players[id].elo +
            ' — using stored elo.');
        }
      }
    }

    // ----- live games per player (phase per domain rule R4: absent fields = lobby) -----
    function livePhase(lg) {
      if (lg.game_state == null || lg.game_state === 'WaitingForPlayers') return 'lobby';
      if (lg.game_state === 'DistributingTerritories' ||
          (typeof lg.current_turn === 'number' && lg.current_turn < 0)) return 'picks';
      return 'T' + ((typeof lg.current_turn === 'number' ? lg.current_turn : 0) + 1);
    }
    var liveByPlayer = {};
    var liveListByPlayer = {};
    function addLive(pid, oppId, lg) {
      if (!pid) return;
      liveByPlayer[pid] = (liveByPlayer[pid] || 0) + 1;
      if (!liveListByPlayer[pid]) liveListByPlayer[pid] = [];
      liveListByPlayer[pid].push({
        opp: playerName(oppId),
        oppId: oppId || null,
        map: mapName(lg.template_id),
        phase: livePhase(lg),
        gameId: lg.game_id
      });
    }
    for (i = 0; i < activeGames.length; i++) {
      g = activeGames[i];
      addLive(g.p1_id, g.p2_id, g);
      addLive(g.p2_id, g.p1_id, g);
    }

    // ----- global live-games list (games page) -----
    // Rating = current stored elo whenever the id is in players.json (departed
    // members included); null only for ids missing from players.json entirely.
    var live = [];
    for (i = 0; i < activeGames.length; i++) {
      g = activeGames[i];
      live.push({
        gameId: g.game_id,
        aId: g.p1_id,
        aName: playerName(g.p1_id),
        aRating: players[g.p1_id] ? players[g.p1_id].elo : null,
        bId: g.p2_id,
        bName: playerName(g.p2_id),
        bRating: players[g.p2_id] ? players[g.p2_id].elo : null,
        map: mapName(g.template_id),
        templateId: resolveTemplateId(g.template_id),
        phase: livePhase(g),
        started: g.created_at
      });
    }
    live.sort(function (a, b) { return ts(b.started) - ts(a.started); });

    // ----- maps: per-pool-template stats + per-map ELO boards -----
    // Each map is its own ladder: replay that map's decisive games in
    // chronological order with the production formula (calculateEloClient,
    // app.js:110-118 — K=40, expected = 1/(1+10^((opp-own)/400)), everyone
    // starts at 1000, ROUND after each game, per-map ratings on both sides).
    // Every participant is replayed; the 3-game threshold only gates LISTING
    // on the board.
    var MAP_K = 40;
    var mapAgg = {}; // canonical tid → { games, turnsSum, turnsN, first, last, players: {pid: {rating,w,l}} }
    function mapAggFor(tid) {
      if (!mapAgg[tid]) {
        mapAgg[tid] = { games: 0, turnsSum: 0, turnsN: 0, first: null, last: null, players: {} };
      }
      return mapAgg[tid];
    }
    function mapPlayerFor(agg, pid) {
      if (!agg.players[pid]) agg.players[pid] = { rating: START_RATING, w: 0, l: 0 };
      return agg.players[pid];
    }
    for (i = 0; i < decisive.length; i++) { // decisive is finished_at ascending
      g = decisive[i];
      var mTid = resolveTemplateId(g.template_id);
      var agg = mapAggFor(mTid);
      agg.games += 1;
      if (typeof g.turns === 'number' && g.turns >= 1) {
        agg.turnsSum += g.turns;
        agg.turnsN += 1;
      }
      if (!agg.first) agg.first = g.finished_at || null;
      if (g.finished_at) agg.last = g.finished_at;
      var mw = mapPlayerFor(agg, g.winner_id);
      mw.w += 1;
      if (g.loser_id) {
        var ml = mapPlayerFor(agg, g.loser_id);
        ml.l += 1;
        // calculateEloClient, per-map ratings on both sides
        var wElo = mw.rating;
        var lElo = ml.rating;
        var expectedWinner = 1 / (1 + Math.pow(10, (lElo - wElo) / 400));
        var expectedLoser = 1 / (1 + Math.pow(10, (wElo - lElo) / 400));
        mw.rating = Math.round(wElo + MAP_K * (1 - expectedWinner));
        ml.rating = Math.round(lElo + MAP_K * (0 - expectedLoser));
      }
    }

    var liveCountByMap = {};
    for (i = 0; i < activeGames.length; i++) {
      var lTid = resolveTemplateId(activeGames[i].template_id);
      liveCountByMap[lTid] = (liveCountByMap[lTid] || 0) + 1;
    }

    var maps = (templates || []).map(function (t) {
      var tid = String(t.id);
      var a = mapAgg[tid] || { games: 0, turnsSum: 0, turnsN: 0, first: null, last: null, players: {} };

      var board = [];
      var mostActive = null;
      for (var pid in a.players) {
        if (!Object.prototype.hasOwnProperty.call(a.players, pid)) continue;
        var mp = a.players[pid];
        var n = mp.w + mp.l;
        var pName = playerName(pid);
        // Most active: most games; ties → more wins, then name.
        if (!mostActive || n > mostActive.games ||
            (n === mostActive.games && (mp.w > mostActive._w ||
              (mp.w === mostActive._w && pName.localeCompare(mostActive.name) < 0)))) {
          mostActive = { id: pid, name: pName, games: n, _w: mp.w };
        }
        if (n < 3) continue; // threshold gates listing only
        var row = { id: pid, name: pName, rating: mp.rating, w: mp.w, l: mp.l, games: n };
        // Departed players stay on the board (their games happened) but the
        // UI must skip profile links for them.
        if (!players[pid] || players[pid].in_clan === false) row.departed = true;
        board.push(row);
      }
      board.sort(function (x, y) {
        if (y.rating !== x.rating) return y.rating - x.rating;
        if (y.games !== x.games) return y.games - x.games;
        return x.name.localeCompare(y.name);
      });
      if (mostActive) mostActive = { id: mostActive.id, name: mostActive.name, games: mostActive.games };

      return {
        id: tid,
        legacyIds: (t.legacy_ids || []).map(String),
        name: t.name || ('TEMPLATE ' + t.id),
        games: a.games,
        liveCount: liveCountByMap[tid] || 0,
        firstPlayed: a.first,
        lastPlayed: a.last,
        avgTurns: a.turnsN > 0 ? Math.round((a.turnsSum / a.turnsN) * 10) / 10 : null,
        mostActive: mostActive,
        topPlayer: board.length
          ? { id: board[0].id, name: board[0].name, rating: board[0].rating }
          : null,
        board: board
      };
    });
    maps.sort(function (x, y) {
      if (y.games !== x.games) return y.games - x.games;
      return x.name.localeCompare(y.name);
    });

    // ----- best/worst map per player (min 3 decisive games on the map) -----
    function mapExtremes(s) {
      var qualified = [];
      for (var tid in s.maps) {
        if (!Object.prototype.hasOwnProperty.call(s.maps, tid)) continue;
        var m = s.maps[tid];
        var n = m.w + m.l;
        if (n >= 3) qualified.push({ name: mapName(tid), w: m.w, l: m.l, rate: m.w / n, n: n });
      }
      if (!qualified.length) return { best: null, worst: null };
      qualified.sort(function (a, b) { return b.rate - a.rate || b.n - a.n || b.w - a.w; });
      var best = qualified[0];
      var worst = qualified[qualified.length - 1];
      if (qualified.length === 1) worst = null;
      return {
        best: { name: best.name, w: best.w, l: best.l },
        worst: worst ? { name: worst.name, w: worst.w, l: worst.l } : null
      };
    }

    // ----- per-player derived entries -----
    function buildEntry(pid) {
      var p = players[pid];
      var s = state[pid] || {
        rating: START_RATING, wins: 0, losses: 0, peak: START_RATING,
        games: [], log: [], peakAt: null, firstIso: null
      };

      // Streak: consecutive same-result run, newest backward (voids never break)
      var streak = { type: null, count: 0 };
      if (s.games.length > 0) {
        var lastWon = s.games[s.games.length - 1].won;
        var count = 0;
        for (var j = s.games.length - 1; j >= 0; j--) {
          if (s.games[j].won === lastWon) count++;
          else break;
        }
        streak = { type: lastWon ? 'W' : 'L', count: count };
      }

      var gamesPlayed = s.wins + s.losses;
      var rankIdx = rankIndexForWins(s.wins);
      var leagueIdx = leagueIndexForElo(p.elo);
      var extremes = mapExtremes(s);

      var v = voidsByPlayer[pid];

      return {
        // Game log: NEWEST first. peakDate: the game that set the peak; for
        // players whose peak is still the starting rating, the first game
        // (the peak was carried into it) — null only when no games at all.
        gameLog: (s.log || []).slice().reverse(),
        peakDate: s.peakAt || s.firstIso || null,
        voids: v
          ? { total: v.total, timeouts: v.timeouts, declines: v.declines }
          : { total: 0, timeouts: 0, declines: 0 },
        cap: p.game_cap,
        missed: p.missed_games,
        traj: (s.traj || [START_RATING]).slice(),
        firstGameAt: s.games.length ? new Date(s.games[0].at).toISOString() : null,
        bestMap: extremes.best,
        worstMap: extremes.worst,
        liveGames: liveListByPlayer[pid] || [],
        id: pid,
        name: p.name,
        elo: p.elo,                       // stored elo is display truth
        rank: null,                       // assigned below for actives
        delta7: null,                     // assigned below for actives
        streak: streak,
        wins: s.wins,
        losses: s.losses,
        winRate: gamesPlayed > 0 ? Math.round((s.wins / gamesPlayed) * 100) : 0,
        // rolling form: win rate over the player's last 100 decisive games
        // (over all games while under 100 played; 0 with no games)
        winRateLast100: (function () {
          var last = s.games.slice(-100);
          if (!last.length) return 0;
          var w = last.reduce(function (n, g) { return n + (g.won ? 1 : 0); }, 0);
          return Math.round((w / last.length) * 100);
        })(),
        gamesPlayed: gamesPlayed,
        peak: s.peak,
        rankName: RANK_NAMES[rankIdx],
        rankIndex: rankIdx,
        league: LEAGUES[leagueIdx].key,
        leagueName: LEAGUES[leagueIdx].name,
        winsToNextRank: winsToNextRank(s.wins),
        freshHonor: !!freshIds[pid],
        liveCount: liveByPlayer[pid] || 0
      };
    }

    // ----- split active vs reserve -----
    // Active = game_cap > 0 AND missed_games < 2; paused = cap 0;
    // inactive = missed >= 2 (inactive wins over paused).
    var active = [];
    var reserve = [];
    var pausedCount = 0;
    var inactiveCount = 0;

    for (id in players) {
      if (!Object.prototype.hasOwnProperty.call(players, id)) continue;
      var pl = players[id];
      // Departed clan members (roster sync marks in_clan: false) are excluded
      // from standings AND inactive players entirely; their name stays
      // resolvable for past results via playerName().
      if (pl.in_clan === false) continue;
      var e = buildEntry(id);
      if (pl.missed_games >= 2) {
        e.status = 'INACTIVE';
        reserve.push(e);
        inactiveCount++;
      } else if (pl.game_cap === 0) {
        e.status = 'PAUSED';
        reserve.push(e);
        pausedCount++;
      } else {
        e.status = 'ACTIVE';
        active.push(e);
      }
    }

    // Sort actives: elo desc, then more wins, then name — contiguous ranks 1..N
    active.sort(function (a, b) {
      if (b.elo !== a.elo) return b.elo - a.elo;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.name.localeCompare(b.name);
    });
    for (i = 0; i < active.length; i++) active[i].rank = i + 1;

    // Reserve: players who have actually played come first (elo desc),
    // never-played signups after them (also elo desc; same tiebreaks)
    reserve.sort(function (a, b) {
      var ap = a.gamesPlayed > 0 ? 0 : 1;
      var bp = b.gamesPlayed > 0 ? 0 : 1;
      if (ap !== bp) return ap - bp;
      if (b.elo !== a.elo) return b.elo - a.elo;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.name.localeCompare(b.name);
    });

    // ----- delta7: re-rank the current-active set on 7-days-ago ratings -----
    // 7-days-ago rating = current elo minus net elo_change of the player's
    // decisive games finished in the last 7 days.
    var then = active.map(function (e) {
      var s = state[e.id];
      var net = 0;
      var recentWins = 0;
      if (s) {
        for (var j = s.games.length - 1; j >= 0; j--) {
          var gm = s.games[j];
          if (gm.at <= weekAgo) break;
          net += gm.won ? gm.change : -gm.change;
          if (gm.won) recentWins++;
        }
      }
      return { id: e.id, name: e.name, rating7: e.elo - net, wins7: e.wins - recentWins };
    });
    then.sort(function (a, b) {
      if (b.rating7 !== a.rating7) return b.rating7 - a.rating7;
      if (b.wins7 !== a.wins7) return b.wins7 - a.wins7;
      return a.name.localeCompare(b.name);
    });
    var rank7ById = {};
    for (i = 0; i < then.length; i++) rank7ById[then[i].id] = i + 1;
    for (i = 0; i < active.length; i++) {
      // positive = climbed since a week ago
      active[i].delta7 = rank7ById[active[i].id] - active[i].rank;
    }

    // ----- meta -----
    var lastUpdatedMs = newestFinished;
    for (i = 0; i < history.length; i++) {
      var ct = history[i].created_at ? ts(history[i].created_at) : 0;
      if (ct > lastUpdatedMs) lastUpdatedMs = ct;
    }
    for (i = 0; i < activeGames.length; i++) {
      var at = activeGames[i].created_at ? ts(activeGames[i].created_at) : 0;
      if (at > lastUpdatedMs) lastUpdatedMs = at;
    }

    var meta = {
      activeCount: active.length,
      pausedCount: pausedCount,
      inactiveCount: inactiveCount,
      liveCount: activeGames.length,
      gamesPlayed: decisive.length,
      lastUpdatedText: relativeText(lastUpdatedMs, Date.now()),
      lastUpdatedMs: lastUpdatedMs
    };

    // ----- results stream (newest first; feed shows these merged with the gazette) -----
    var results = [];
    for (i = decisive.length - 1; i >= 0 && results.length < 60; i--) {
      g = decisive[i];
      results.push({
        date: g.finished_at,
        winner: playerName(g.winner_id),
        loser: playerName(g.loser_id),
        winnerId: g.winner_id,
        loserId: g.loser_id,
        change: typeof g.elo_change === 'number' ? g.elo_change : 0,
        map: mapName(g.template_id),
        turns: (typeof g.turns === 'number' && g.turns >= 1) ? g.turns : null,
        gameId: g.game_id
      });
    }

    // allResults: EVERY decisive game, newest first (built chronologically above)
    allResults.reverse();

    return {
      active: active, reserve: reserve, gazette: gazette, results: results,
      allResults: allResults, live: live, maps: maps, meta: meta
    };
  }

  /* ---------------------------------------------------------------- *
   * Public API
   * ---------------------------------------------------------------- */

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('LadderData: failed to fetch ' + url + ' (' + r.status + ')');
      return r.json();
    });
  }

  function load() {
    return Promise.all([
      getJSON('data/players.json'),
      getJSON('data/history.json'),
      getJSON('data/active_games.json'),
      getJSON('data/templates.json')
    ]).then(function (res) {
      return derive(res[0], res[1], res[2], res[3]);
    });
  }

  global.LadderData = {
    load: load,
    // internals exposed for testing / reuse (not part of the page contract)
    _derive: derive,
    _isDecisive: isDecisive,
    _rankIndexForWins: rankIndexForWins,
    _leagueIndexForElo: leagueIndexForElo
  };

})(typeof window !== 'undefined' ? window : globalThis);
