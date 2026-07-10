/* Node test for js/derive.js — run from redesign-prototype/:  node js/derive.test.js
   Loads the real data files from disk, monkeypatches fetch, runs LadderData.load(),
   and asserts INVARIANTS recomputed independently from the raw data files. The data
   refreshes from production, so nothing here pins a snapshot value — the suite must
   pass against ANY data state. */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ---- monkeypatch fetch to serve the real data files from disk ----
globalThis.fetch = function (url) {
  const file = path.join(ROOT, url);
  return new Promise((resolve, reject) => {
    fs.readFile(file, 'utf8', (err, text) => {
      if (err) {
        resolve({ ok: false, status: 404, json: () => Promise.reject(err) });
        return;
      }
      resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(text)) });
    });
  });
};

// derive.js attaches to globalThis when window is undefined
require('./derive.js');

const results = [];
function assert(name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
  if (!cond) process.exitCode = 1;
}

/* ---------------------------------------------------------------------- *
 * Independent expectations, computed straight from the raw data files
 * (deliberately re-implements the domain rules — do not import derive.js
 * internals for these; the point is a second opinion).
 * ---------------------------------------------------------------------- */

const rawPlayers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/players.json'), 'utf8'));
const rawHistory = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/history.json'), 'utf8'));
const rawActive = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/active_games.json'), 'utf8'));
const rawTemplates = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/templates.json'), 'utf8'));

const VOID_NOTES = { 'Timed Out (Lobby)': true, 'Declined': true, 'Terminated': true };
const tsafe = (iso) => { const t = Date.parse(iso); return isNaN(t) ? 0 : t; };
const onRoster = (pid) => !!(rawPlayers[pid] && rawPlayers[pid].in_clan !== false);

// Decisive game = has p1_id AND winner_id, note not in the void set.
const decisiveRaw = rawHistory
  .filter((g) => g && g.p1_id && g.winner_id && !(g.note && VOID_NOTES[g.note]))
  .sort((a, b) => tsafe(a.finished_at) - tsafe(b.finished_at));
const expGames = decisiveRaw.length;

// Roster classification (same rules as the site): in_clan !== false only;
// missed_games >= 2 -> INACTIVE (wins over) game_cap === 0 -> PAUSED; else ACTIVE.
let expActive = 0;
let expPaused = 0;
let expInactive = 0;
let expTopElo = -Infinity;
for (const id of Object.keys(rawPlayers)) {
  const pl = rawPlayers[id];
  if (pl.in_clan === false) continue;
  if (pl.missed_games >= 2) expInactive++;
  else if (pl.game_cap === 0) expPaused++;
  else { expActive++; if (pl.elo > expTopElo) expTopElo = pl.elo; }
}

// Independent per-player replay of the decisive games (chronological):
// wins, losses, peak rating, peak date, first game date.
const EMPTY_REC = { wins: 0, losses: 0, rating: 1000, peak: 1000, peakIso: null, firstIso: null };
const recs = {};
function recFor(pid) {
  if (!recs[pid]) recs[pid] = { wins: 0, losses: 0, rating: 1000, peak: 1000, peakIso: null, firstIso: null };
  return recs[pid];
}
for (const g of decisiveRaw) {
  const change = typeof g.elo_change === 'number' ? g.elo_change : 0;
  for (const [pid, won] of [[g.winner_id, true], [g.loser_id, false]]) {
    if (!pid) continue;
    const r = recFor(pid);
    r.rating += won ? change : -change;
    if (won) r.wins++; else r.losses++;
    if (r.rating > r.peak) { r.peak = r.rating; r.peakIso = g.finished_at; }
    if (!r.firstIso) r.firstIso = g.finished_at;
  }
}

// Voids: every raw history entry with a p1_id and a void note counts once per
// participant. Only rostered (in-clan) participants surface in active+reserve.
let expVoidSum = 0;
const expVoidsByPlayer = {};
for (const g of rawHistory) {
  if (!g.p1_id || !g.note || !VOID_NOTES[g.note]) continue;
  const kind = g.note === 'Timed Out (Lobby)' ? 'timeouts' : 'declines';
  for (const pid of [g.p1_id, g.p2_id]) {
    if (!pid) continue;
    if (!expVoidsByPlayer[pid]) expVoidsByPlayer[pid] = { total: 0, timeouts: 0, declines: 0 };
    expVoidsByPlayer[pid].total++;
    expVoidsByPlayer[pid][kind]++;
    if (onRoster(pid)) expVoidSum++;
  }
}

globalThis.LadderData.load().then((data) => {
  const { active, reserve, gazette, meta } = data;
  const everyone = active.concat(reserve);
  const rankIndexForWins = globalThis.LadderData._rankIndexForWins;

  // ---- meta counts (vs independent classification of players.json) ----
  assert('meta.activeCount matches players.json classification', meta.activeCount === expActive,
    `got ${meta.activeCount}, expected ${expActive}`);
  assert('meta.pausedCount matches players.json classification', meta.pausedCount === expPaused,
    `got ${meta.pausedCount}, expected ${expPaused}`);
  assert('meta.inactiveCount matches players.json classification', meta.inactiveCount === expInactive,
    `got ${meta.inactiveCount}, expected ${expInactive}`);
  assert('meta.gamesPlayed === decisive history count', meta.gamesPlayed === expGames,
    `got ${meta.gamesPlayed}, expected ${expGames}`);
  assert('meta.liveCount === active_games.json length', meta.liveCount === rawActive.length,
    `got ${meta.liveCount}, expected ${rawActive.length}`);
  assert('meta.lastUpdatedText matches XM/XH/XD AGO', /^\d+[MHD] AGO$/.test(meta.lastUpdatedText), `got "${meta.lastUpdatedText}"`);
  assert('meta.lastUpdatedMs is a positive int', Number.isInteger(meta.lastUpdatedMs) && meta.lastUpdatedMs > 0, `got ${meta.lastUpdatedMs}`);

  // ---- every roster record matches the independent replay ----
  const recordsOk = everyone.every((p) => {
    const r = recs[p.id] || EMPTY_REC;
    return p.wins === r.wins && p.losses === r.losses && p.peak === r.peak &&
      p.gamesPlayed === r.wins + r.losses;
  });
  assert('every roster wins/losses/peak match independent replay', recordsOk);

  // ---- the throne: rank 1 = highest stored elo among actives ----
  assert('rank 1 has the highest elo among actives',
    active.length === 0 || (active[0].rank === 1 && active[0].elo === expTopElo),
    active.length ? `top ${active[0].name} @ ${active[0].elo}, max stored ${expTopElo}` : 'no actives');

  // ---- Ventura (conditional: only when on the roster) ----
  const ventura = everyone.find((p) => p.name === 'Ventura');
  if (ventura) {
    const r = recs[ventura.id] || EMPTY_REC;
    assert('Ventura record matches history replay',
      ventura.wins === r.wins && ventura.losses === r.losses,
      `got ${ventura.wins}-${ventura.losses}, expected ${r.wins}-${r.losses}`);
    assert('Ventura elo === stored players.json elo',
      ventura.elo === rawPlayers[ventura.id].elo, `got ${ventura.elo}`);
    assert('Ventura rankIndex matches replayed wins',
      ventura.rankIndex === rankIndexForWins(r.wins), `got ${ventura.rankIndex}`);
  }

  // ---- Gatsu12 (conditional) ----
  const gatsu = everyone.find((p) => p.name === 'Gatsu12');
  if (gatsu) {
    const r = recs[gatsu.id] || EMPTY_REC;
    assert('Gatsu12 wins match history replay', gatsu.wins === r.wins,
      `got ${gatsu.wins}, expected ${r.wins}`);
    assert('Gatsu12 rankIndex matches replayed wins',
      gatsu.rankIndex === rankIndexForWins(r.wins), `got ${gatsu.rankIndex}`);
  }

  // ---- Crouton (conditional) ----
  const crouton = everyone.find((p) => p.name === 'Crouton');
  if (crouton) {
    const r = recs[crouton.id] || EMPTY_REC;
    assert('Crouton record matches history replay',
      crouton.wins === r.wins && crouton.losses === r.losses,
      `got ${crouton.wins}-${crouton.losses}, expected ${r.wins}-${r.losses}`);
  }

  // ---- contiguous ranks 1..activeCount, none null ----
  const ranksOk = active.length === expActive && active.every((p, i) => p.rank === i + 1);
  assert('active ranks contiguous 1..activeCount', ranksOk, `ranks: ${active.map((p) => p.rank).join(',')}`);
  assert('no active entry has null rank', active.every((p) => p.rank !== null));
  assert('no active entry has null delta7', active.every((p) => Number.isInteger(p.delta7)));

  // ---- reserve ----
  assert('reserve.length === paused + inactive', reserve.length === expPaused + expInactive,
    `got ${reserve.length}, expected ${expPaused + expInactive}`);
  assert('reserve ranks/delta7 all null', reserve.every((p) => p.rank === null && p.delta7 === null));
  assert('reserve statuses valid', reserve.every((p) => p.status === 'PAUSED' || p.status === 'INACTIVE'));
  assert('reserve sorted by elo desc', reserve.every((p, i) => i === 0 || reserve[i - 1].elo >= p.elo));
  assert('reserve missed is an int', reserve.every((p) => Number.isInteger(p.missed)));

  // ---- gazette ----
  assert('gazette is non-empty', gazette.length > 0, `got ${gazette.length}`);
  const newestFirst = gazette.every((e, i) => i === 0 || Date.parse(gazette[i - 1].date) >= Date.parse(e.date));
  assert('gazette dates newest first', newestFirst);

  if (gatsu && gatsu.rankIndex >= 1) {
    const gatsuPromotion = gazette.find(
      (e) => e.kind === 'promotion' && e.playerId === gatsu.id && e.rankIndex === gatsu.rankIndex
    );
    assert('gazette records Gatsu12 promotion to current rank', !!gatsuPromotion,
      gatsuPromotion ? gatsuPromotion.date : 'not found');
  }

  const grammar = {
    promotion: /^.+ achieved the status of .+ for reaching \d+ career wins on the ladder!$/,
    ascension: /^.+ was promoted to the .+ League for reaching an ELO rating of \d+!$/,
    demotion: /^.+ was relegated to the .+ League for dropping below an ELO rating of \d+!$/
  };
  const badText = gazette.find((e) => !grammar[e.kind] || !grammar[e.kind].test(e.text));
  assert('every gazette text follows dispatch grammar', !badText, badText ? `bad: [${badText.kind}] "${badText.text}"` : '');

  // ---- results stream ----
  const gameResults = data.results || [];
  assert('results length === min(60, gamesPlayed)', gameResults.length === Math.min(60, expGames),
    `got ${gameResults.length}, expected ${Math.min(60, expGames)}`);
  const resNewestFirst = gameResults.every((r, i) => i === 0 || Date.parse(gameResults[i - 1].date) >= Date.parse(gameResults[i].date));
  assert('results newest first', resNewestFirst);
  const resShapeOk = gameResults.every((r) =>
    typeof r.winner === 'string' && typeof r.loser === 'string' &&
    Number.isInteger(r.change) && typeof r.map === 'string' &&
    (r.turns === null || (Number.isInteger(r.turns) && r.turns >= 1)));
  assert('results shape ok (junk turns nulled)', resShapeOk);

  // ---- allResults (games page: every decisive game) ----
  const allResults = data.allResults || [];
  assert('allResults.length === decisive history count', allResults.length === expGames,
    `got ${allResults.length}, expected ${expGames}`);
  const allNewestFirst = allResults.every((r, i) =>
    i === 0 || Date.parse(allResults[i - 1].date) >= Date.parse(r.date));
  assert('allResults newest first', allNewestFirst);
  const allShapeOk = allResults.every((r) =>
    typeof r.date === 'string' && !isNaN(Date.parse(r.date)) &&
    r.gameId &&
    typeof r.winnerId === 'string' && typeof r.winner === 'string' &&
    typeof r.loserId === 'string' && typeof r.loser === 'string' &&
    Number.isInteger(r.wRating) && Number.isInteger(r.lRating) &&
    Number.isInteger(r.change) && r.change >= 0 &&
    typeof r.map === 'string' &&
    (r.turns === null || (Number.isInteger(r.turns) && r.turns >= 1)));
  assert('allResults entries shape-valid (pre-game ratings ints, junk turns nulled)', allShapeOk);
  const r0 = allResults[0];
  const feed0 = (data.results || [])[0];
  const overlapOk = !!r0 && !!feed0 &&
    r0.date === feed0.date && r0.gameId === feed0.gameId &&
    r0.winnerId === feed0.winnerId && r0.winner === feed0.winner &&
    r0.loserId === feed0.loserId && r0.loser === feed0.loser &&
    r0.change === Math.abs(feed0.change) &&
    r0.map === feed0.map && r0.turns === feed0.turns;
  assert('allResults[0] matches results[0] on overlapping fields', overlapOk,
    overlapOk ? '' : `all: ${JSON.stringify(r0)} feed: ${JSON.stringify(feed0)}`);

  // ---- live (games page: every active game) ----
  const live = data.live || [];
  assert('live.length === active_games.json length', live.length === rawActive.length,
    `got ${live.length}, expected ${rawActive.length}`);
  const liveSorted = live.every((g, i) =>
    i === 0 || Date.parse(live[i - 1].started) >= Date.parse(g.started));
  assert('live sorted by started desc', liveSorted);
  assert('live phases match lobby|picks|T<n>',
    live.every((g) => /^(lobby|picks|T\d+)$/.test(g.phase)));
  const liveRatingsOk = live.every((g) =>
    [[g.aId, g.aRating], [g.bId, g.bRating]].every(([id, rating]) =>
      rawPlayers[id] ? rating === rawPlayers[id].elo : rating === null));
  assert('live ratings = stored elo when on players.json, null only off-roster', liveRatingsOk);
  const liveShapeOk = live.every((g) =>
    g.gameId && typeof g.aName === 'string' && typeof g.bName === 'string' &&
    typeof g.map === 'string' &&
    typeof g.started === 'string' && !isNaN(Date.parse(g.started)));
  assert('live entries shape-valid', liveShapeOk);

  // ---- peek/dossier fields ----
  const trajOk = everyone.every((p) =>
    Array.isArray(p.traj) && p.traj[0] === 1000 && p.traj.length === p.gamesPlayed + 1);
  assert('traj arrays: start 1000, one point per game', trajOk);
  // Traj is the replayed chain; stored elo is display truth and may drift when a
  // history entry lacks elo_change (derive warns and shows stored elo). The true
  // invariant is replay-vs-replay: traj must end at the independently replayed rating.
  const trajEndsOk = everyone.every((p) => {
    const r = recs[p.id] || EMPTY_REC;
    return p.traj[p.traj.length - 1] === r.rating;
  });
  assert('traj final value === independently replayed rating', trajEndsOk);
  const mapsOk = everyone.every((p) =>
    (p.bestMap === null || (typeof p.bestMap.name === 'string' && p.bestMap.w + p.bestMap.l >= 3)) &&
    (p.worstMap === null || (typeof p.worstMap.name === 'string' && p.worstMap.w + p.worstMap.l >= 3)));
  assert('best/worst maps respect min-3 threshold', mapsOk);
  const liveOk = everyone.every((p) =>
    Array.isArray(p.liveGames) && p.liveGames.length === p.liveCount &&
    p.liveGames.every((lg) => typeof lg.opp === 'string' && typeof lg.oppId === 'string' &&
      typeof lg.map === 'string' &&
      /^(lobby|picks|T\d+)$/.test(lg.phase) && lg.gameId));
  assert('liveGames match liveCount with oppId and valid phases', liveOk);
  const totalLive = everyone.reduce((n, p) => n + p.liveGames.length, 0);
  assert('liveGames total = 2 per live game', totalLive === meta.liveCount * 2, `got ${totalLive}`);

  // ---- shape sanity ----
  const shapeOk = active.every((p) =>
    typeof p.id === 'string' && typeof p.name === 'string' &&
    Number.isInteger(p.elo) && Number.isInteger(p.wins) && Number.isInteger(p.losses) &&
    Number.isInteger(p.winRate) && p.winRate >= 0 && p.winRate <= 100 &&
    Number.isInteger(p.gamesPlayed) && Number.isInteger(p.peak) &&
    typeof p.rankName === 'string' && Number.isInteger(p.rankIndex) &&
    p.rankIndex >= 0 && p.rankIndex <= 22 &&
    typeof p.league === 'string' && typeof p.leagueName === 'string' &&
    (p.winsToNextRank === null || Number.isInteger(p.winsToNextRank)) &&
    typeof p.freshHonor === 'boolean' && Number.isInteger(p.liveCount) &&
    p.streak && (p.streak.type === 'W' || p.streak.type === 'L' || p.streak.type === null) &&
    Number.isInteger(p.streak.count)
  );
  assert('active entries match contract shape', shapeOk);

  // ---- profile fields: gameLog ----
  const logLenOk = everyone.every((p) => Array.isArray(p.gameLog) && p.gameLog.length === p.gamesPlayed);
  assert('gameLog length === gamesPlayed for everyone', logLenOk);

  const logNewestFirst = everyone.every((p) =>
    p.gameLog.every((e, i) => i === 0 || Date.parse(p.gameLog[i - 1].date) >= Date.parse(e.date)));
  assert('gameLog newest first for everyone', logNewestFirst);

  const logShapeOk = everyone.every((p) => p.gameLog.every((e) =>
    typeof e.date === 'string' && !isNaN(Date.parse(e.date)) &&
    typeof e.oppId === 'string' && typeof e.opp === 'string' &&
    typeof e.won === 'boolean' &&
    Number.isInteger(e.change) && e.change >= 0 &&
    typeof e.map === 'string' &&
    (e.turns === null || (Number.isInteger(e.turns) && e.turns >= 1)) &&
    e.gameId && Number.isInteger(e.rating)));
  assert('gameLog entries match contract shape', logShapeOk);

  const oppRatingOk = everyone.every((p) => p.gameLog.every((e) =>
    Number.isInteger(e.oppRating) && e.oppRating >= 400 && e.oppRating <= 2000));
  assert('every gameLog oppRating is a plausible int (400..2000)', oppRatingOk);

  // ---- Swisster dossier (conditional; recomputed from history) ----
  const swisster = everyone.find((p) => p.name === 'Swisster');
  if (swisster) {
    const r = recs[swisster.id] || EMPTY_REC;
    assert('Swisster record matches history replay',
      swisster.wins === r.wins && swisster.losses === r.losses,
      `got ${swisster.wins}-${swisster.losses}, expected ${r.wins}-${r.losses}`);
    assert('Swisster peak matches history replay', swisster.peak === r.peak,
      `got ${swisster.peak}, expected ${r.peak}`);
    assert('Swisster gameLog length matches replayed game count',
      swisster.gameLog.length === r.wins + r.losses,
      `got ${swisster.gameLog.length}, expected ${r.wins + r.losses}`);
    const swOldest = swisster.gameLog[swisster.gameLog.length - 1];
    assert('Swisster oldest gameLog entry is the first history game',
      r.firstIso === null ? swisster.gameLog.length === 0 : (!!swOldest && swOldest.date === r.firstIso),
      swOldest ? `got ${swOldest.date}, expected ${r.firstIso}` : 'no games');
    // Rating chain: walking backward from newest, each entry's rating equals the
    // previous (older) entry's rating +/- its change; the oldest starts from 1000.
    let chainOk = true;
    for (let i = 0; i < swisster.gameLog.length; i++) {
      const e = swisster.gameLog[i];
      const older = swisster.gameLog[i + 1];
      const base = older ? older.rating : 1000;
      if (e.rating !== base + (e.won ? e.change : -e.change)) { chainOk = false; break; }
    }
    assert('Swisster gameLog rating chain consistent (back to 1000)', chainOk);
    if (swisster.gameLog.length > 0) {
      assert('Swisster gameLog[0].rating === independently replayed rating',
        swisster.gameLog[0].rating === r.rating,
        `got ${swisster.gameLog[0].rating}, expected ${r.rating}`);
    }
    assert('Swisster peakDate matches replayed peak game',
      swisster.peakDate === (r.peakIso || r.firstIso || null),
      `got ${swisster.peakDate}, expected ${r.peakIso || r.firstIso || null}`);
    const expSwVoids = expVoidsByPlayer[swisster.id] || { total: 0, timeouts: 0, declines: 0 };
    assert('Swisster voids match history recount',
      swisster.voids.total === expSwVoids.total &&
      swisster.voids.timeouts === expSwVoids.timeouts &&
      swisster.voids.declines === expSwVoids.declines,
      `got ${JSON.stringify(swisster.voids)}, expected ${JSON.stringify(expSwVoids)}`);
  }

  // ---- peakDate: present iff games played; traj value at that game === peak ----
  const peakDateOk = everyone.every((p) => {
    if (p.gamesPlayed === 0) return p.peakDate === null;
    if (p.peakDate === null) return false;
    if (p.peak === 1000) {
      // Peak never exceeded the starting rating: peakDate is the first game.
      return Date.parse(p.peakDate) === Date.parse(p.gameLog[p.gameLog.length - 1].date);
    }
    // Some game set the peak: at its date the player's replayed rating (= traj
    // value after that game) equals peak.
    return p.gameLog.some((e) => e.date === p.peakDate && e.rating === p.peak);
  });
  assert('peakDate present iff games > 0 and matches the peak game', peakDateOk);

  // ---- voids ----
  const voidsShapeOk = everyone.every((p) =>
    p.voids && Number.isInteger(p.voids.total) && Number.isInteger(p.voids.timeouts) &&
    Number.isInteger(p.voids.declines) && p.voids.total === p.voids.timeouts + p.voids.declines);
  assert('voids shape ok (total = timeouts + declines)', voidsShapeOk);
  const voidsSum = everyone.reduce((n, p) => n + p.voids.total, 0);
  assert('voids sum across roster === per-participant void recount', voidsSum === expVoidSum,
    `got ${voidsSum}, expected ${expVoidSum}`);
  const voidsPerPlayerOk = everyone.every((p) => {
    const exp = expVoidsByPlayer[p.id] || { total: 0, timeouts: 0, declines: 0 };
    return p.voids.total === exp.total && p.voids.timeouts === exp.timeouts &&
      p.voids.declines === exp.declines;
  });
  assert('every roster voids breakdown matches history recount', voidsPerPlayerOk);

  // ---- cap / missed / status ----
  const capOk = everyone.every((p) =>
    Number.isInteger(p.cap) && Number.isInteger(p.missed) &&
    (p.status === 'ACTIVE' || p.status === 'PAUSED' || p.status === 'INACTIVE'));
  assert('cap/missed/status present and valid for everyone', capOk);
  assert("all active entries have status 'ACTIVE'", active.every((p) => p.status === 'ACTIVE'));

  // ---- maps (pool surface: per-map stats + map ELO boards) ----
  const maps = data.maps || [];
  assert('maps.length === templates.json length', maps.length === rawTemplates.length,
    `got ${maps.length}, expected ${rawTemplates.length}`);
  assert('sum of maps[].games === gamesPlayed', maps.reduce((n, m) => n + m.games, 0) === expGames,
    `got ${maps.reduce((n, m) => n + m.games, 0)}, expected ${expGames}`);
  assert('maps sorted by games desc', maps.every((m, i) => i === 0 || maps[i - 1].games >= m.games));
  const mapShapeOk = maps.every((m) =>
    typeof m.id === 'string' && typeof m.name === 'string' &&
    Number.isInteger(m.games) && Number.isInteger(m.liveCount) && m.liveCount >= 0 &&
    (m.firstPlayed === null || !isNaN(Date.parse(m.firstPlayed))) &&
    (m.lastPlayed === null || !isNaN(Date.parse(m.lastPlayed))) &&
    (m.mostActive === null || (typeof m.mostActive.id === 'string' &&
      typeof m.mostActive.name === 'string' && Number.isInteger(m.mostActive.games))) &&
    Array.isArray(m.board));
  assert('maps entries shape-valid', mapShapeOk);
  assert('avgTurns null-or-number (1 decimal)', maps.every((m) =>
    m.avgTurns === null ||
    (typeof m.avgTurns === 'number' && Math.abs(m.avgTurns * 10 - Math.round(m.avgTurns * 10)) < 1e-9)));
  assert('firstPlayed <= lastPlayed on every map', maps.every((m) =>
    (m.firstPlayed === null && m.lastPlayed === null) ||
    (m.firstPlayed !== null && m.lastPlayed !== null &&
      Date.parse(m.firstPlayed) <= Date.parse(m.lastPlayed))));
  const boardEntriesOk = maps.every((m) => m.board.every((b) =>
    typeof b.id === 'string' && typeof b.name === 'string' &&
    Number.isInteger(b.rating) && Number.isInteger(b.w) && Number.isInteger(b.l) &&
    b.games >= 3 && b.games === b.w + b.l));
  assert('every board entry has games >= 3 and int rating', boardEntriesOk);
  assert('every board sorted by rating desc', maps.every((m) =>
    m.board.every((b, i) => i === 0 || m.board[i - 1].rating >= b.rating)));
  const topPlayerOk = maps.every((m) => m.board.length === 0
    ? m.topPlayer === null
    : (!!m.topPlayer && m.topPlayer.id === m.board[0].id &&
       m.topPlayer.name === m.board[0].name && m.topPlayer.rating === m.board[0].rating));
  assert('topPlayer === board[0] (null when board empty)', topPlayerOk);

  // ---- lineage regression: the template carrying legacy id 1390041 ----
  // (historically 'Strategic 1v1'; the canonical id may change on re-creation,
  // but the legacy link and its history must survive any data refresh)
  const strat = maps.find((m) => Array.isArray(m.legacyIds) && m.legacyIds.indexOf('1390041') !== -1);
  assert('lineage map with legacy id 1390041 exists', !!strat, strat ? strat.name : 'missing');
  if (strat) {
    assert('lineage map games >= 132 (history only grows)', strat.games >= 132, `got ${strat.games}`);
    assert('lineage map board[0] exists with rating > 1000',
      !!strat.board[0] && strat.board[0].rating > 1000,
      strat.board[0] ? `got ${strat.board[0].name} @ ${strat.board[0].rating}` : 'empty board');
  }

  // ---- templateId on allResults + live (canonical; non-pool preserved verbatim) ----
  const poolIds = new Set(maps.map((m) => m.id));
  const rawTidByGame = {};
  rawHistory.concat(rawActive).forEach((g) => { rawTidByGame[g.game_id] = String(g.template_id); });
  const tidOk = (entries) => entries.every((e) =>
    typeof e.templateId === 'string' &&
    (poolIds.has(e.templateId) || e.templateId === rawTidByGame[e.gameId]));
  assert('allResults templateIds in pool or preserved verbatim', tidOk(allResults));
  assert('live templateIds in pool or preserved verbatim', tidOk(live));

  // ---- report ----
  const pad = Math.max(...results.map((r) => r.name.length));
  let passed = 0;
  for (const r of results) {
    if (r.pass) passed++;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(pad)}${r.pass || !r.detail ? '' : '  -> ' + r.detail}`);
  }
  console.log(`\n${passed}/${results.length} assertions passed`);
  if (passed !== results.length) process.exitCode = 1;
}).catch((err) => {
  console.error('load() failed:', err);
  process.exitCode = 1;
});
