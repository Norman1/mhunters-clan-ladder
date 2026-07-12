/* ============================================================
   M'Hunters Clan Ladder — Actions page wiring
   Plain vanilla script (no modules). Depends on:
     window.LadderData (js/derive.js) — LadderData.load()
     window.Insignia  (js/insignia.js) — Insignia.svg()
   DOM contract (provided by actions.html):
     #form-join   #join-name #join-name-msg #join-id #join-id-msg #join-submit
     #form-cap    #cap-player #cap-picks #cap-chip #cap-msg #cap-select #cap-submit
     #form-addmap #tmpl-id #tmpl-id-msg #tmpl-name #tmpl-submit
     #form-rmmap  #rm-select #rm-id #rm-id-msg #rm-submit
     #form-rmplayer #rmplayer-player #rmplayer-picks #rmplayer-chip
                  #rmplayer-msg #rmplayer-confirm #rmplayer-submit
   If LadderData fails to load the forms degrade silently to
   format-only validation (numeric id, non-empty name).
   Self-test: `node js/actions.js` runs the pure-helper test suite.
   ============================================================ */

(function () {
  'use strict';

  /* ------------------------------------------------------------
     Pure helpers (no DOM — testable in node)
     ------------------------------------------------------------ */

  var ISSUE_BASE = 'https://github.com/Norman1/mhunters-clan-ladder/issues/new?title=';

  /* title builders — byte-exact bot command formats */
  function signupTitle(id, name) { return 'Signup: ' + id + ' Name: ' + name; }
  function capTitle(id, cap) { return 'Update: ' + id + ' Cap: ' + cap; }
  function removeTitle(id) { return 'Remove: ' + id; }
  function addTemplateTitle(id, name) { return 'AddTemplate: ' + id + ' Name: ' + name; }
  function removeTemplateTitle(id) { return 'RemoveTemplate: ' + id; }

  function issueUrl(title) { return ISSUE_BASE + encodeURIComponent(title); }

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

  /* Warzone player id: digits only; observed roster ids run 2–11 digits */
  function isValidWzId(s) {
    return /^[0-9]{2,11}$/.test(String(s == null ? '' : s).trim());
  }

  /* Warzone template id: digits only, non-zero (current pool ids are 7 digits) */
  function isValidTemplateId(s) {
    var t = String(s == null ? '' : s).trim();
    return /^[0-9]{1,12}$/.test(t) && /[1-9]/.test(t);
  }

  /* Name-or-id lookup against the roster ([{id, name, ...}]).
     Exact hits (id equal, or folded name equal) outrank substring hits.
     One candidate → resolved; several → picks (choice required); the
     Farah case ('farah' folds equal to BOTH 'Farah' and 'Farah♦') lands
     in picks. Returns { resolved, picks }. */
  function resolveLookup(query, roster) {
    var q = String(query == null ? '' : query).trim();
    if (!q || !roster || !roster.length) return { resolved: null, picks: [] };
    var qn = normalizeName(q);
    var exact = [];
    var partial = [];
    for (var i = 0; i < roster.length; i++) {
      var r = roster[i];
      var nn = normalizeName(r.name);
      if (String(r.id) === q || (qn && nn === qn)) exact.push(r);
      else if (qn && nn.indexOf(qn) !== -1) partial.push(r);
    }
    var pool = exact.length ? exact : partial;
    if (pool.length === 1) return { resolved: pool[0], picks: [] };
    return { resolved: null, picks: pool.slice(0, 8) };
  }

  /* Signup id check against the RAW players map (departed entries included).
     in_clan !== false → current member (block); in_clan === false → departed
     (rejoin fine); unknown id → free. */
  function checkJoinId(id, playersRaw) {
    var key = String(id == null ? '' : id).trim();
    if (!playersRaw || !Object.prototype.hasOwnProperty.call(playersRaw, key)) {
      return { status: 'free', name: null };
    }
    var p = playersRaw[key];
    return {
      status: p.in_clan === false ? 'departed' : 'registered',
      name: p.name || null
    };
  }

  /* Folded-equality name collision against current members; the colliding
     member (or null). */
  function nameCollision(name, roster) {
    var qn = normalizeName(name);
    if (!qn || !roster) return null;
    for (var i = 0; i < roster.length; i++) {
      if (normalizeName(roster[i].name) === qn) return roster[i];
    }
    return null;
  }

  /* Template id → pool map (or null). maps = [{id, name, games}] */
  function findInPool(id, maps) {
    var key = String(id == null ? '' : id).trim();
    if (!key || !maps) return null;
    for (var i = 0; i < maps.length; i++) {
      if (String(maps[i].id) === key) return maps[i];
    }
    return null;
  }

  /* '<NAME> — <games> GAMES' option label for the remove-map select */
  function poolOptionLabel(m) {
    return m.name + ' — ' + Number(m.games || 0).toLocaleString('en-US') + ' GAMES';
  }

  /* chip meta line: '#6 · CAP 2' for actives, 'PAUSED · CAP 0' for reserves */
  function capChipMeta(entry) {
    var pos = entry.status === 'ACTIVE' && entry.rank != null
      ? '#' + entry.rank
      : (entry.status || '—');
    var cap = entry.cap != null ? entry.cap : '—';
    return pos + ' · CAP ' + cap;
  }

  /* chip meta line: '12–8 · 1042' (record W–L, rating) */
  function removeChipMeta(entry) {
    var w = entry.wins != null ? entry.wins : 0;
    var l = entry.losses != null ? entry.losses : 0;
    var elo = entry.elo != null ? entry.elo : '—';
    return w + '–' + l + ' · ' + elo;
  }

  /* pick meta line: position/status + rating */
  function pickMeta(entry) {
    var pos = entry.status === 'ACTIVE' && entry.rank != null
      ? '#' + entry.rank
      : (entry.status || '—');
    return pos + ' · ' + (entry.elo != null ? entry.elo : '—');
  }

  /* remove gate: the confirm field must spell REMOVE (case-insensitive) */
  function removeConfirmed(text) {
    return String(text == null ? '' : text).trim().toUpperCase() === 'REMOVE';
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

    console.log('actions.js pure-helper self-test');

    // title builders — byte-exact
    eq(signupTitle('430635', 'Farah♦'), 'Signup: 430635 Name: Farah♦', 'signup title');
    eq(capTitle('49', '2'), 'Update: 49 Cap: 2', 'cap title');
    eq(capTitle('49', 0), 'Update: 49 Cap: 0', 'cap title PAUSE (0)');
    eq(removeTitle('28867016'), 'Remove: 28867016', 'remove title');
    eq(addTemplateTitle('1390041', 'Strat 1v1'), 'AddTemplate: 1390041 Name: Strat 1v1',
      'add-template title');
    eq(removeTemplateTitle('1390041'), 'RemoveTemplate: 1390041', 'remove-template title');

    // issue URLs — byte-exact incl. unicode percent-encoding (♦ = %E2%99%A6)
    eq(issueUrl(signupTitle('430635', 'Farah♦')),
      'https://github.com/Norman1/mhunters-clan-ladder/issues/new?title=Signup%3A%20430635%20Name%3A%20Farah%E2%99%A6',
      'signup url encodes unicode name byte-exact');
    eq(issueUrl(capTitle('28867016', '1')),
      'https://github.com/Norman1/mhunters-clan-ladder/issues/new?title=Update%3A%2028867016%20Cap%3A%201',
      'cap url encodes colon + spaces');
    eq(issueUrl(removeTitle('49')),
      'https://github.com/Norman1/mhunters-clan-ladder/issues/new?title=Remove%3A%2049',
      'remove url');
    eq(issueUrl(addTemplateTitle('1573498', 'Imperium Romanum - 35/85')),
      'https://github.com/Norman1/mhunters-clan-ladder/issues/new?title=AddTemplate%3A%201573498%20Name%3A%20Imperium%20Romanum%20-%2035%2F85',
      'add-template url encodes slash in map name');
    eq(issueUrl(removeTemplateTitle('1390041')),
      'https://github.com/Norman1/mhunters-clan-ladder/issues/new?title=RemoveTemplate%3A%201390041',
      'remove-template url');

    // id format validation
    eq(isValidWzId('49'), true, 'wz id: 2 digits ok');
    eq(isValidWzId('4555082823'), true, 'wz id: 10 digits ok');
    eq(isValidWzId('71155120841'), true, 'wz id: 11 digits ok');
    eq(isValidWzId(' 28867016 '), true, 'wz id: trims whitespace');
    eq(isValidWzId('7'), false, 'wz id: 1 digit rejected');
    eq(isValidWzId('123456789012'), false, 'wz id: 12 digits rejected');
    eq(isValidWzId('12a4'), false, 'wz id: letters rejected');
    eq(isValidWzId(''), false, 'wz id: empty rejected');
    eq(isValidWzId(null), false, 'wz id: null-safe');
    eq(isValidTemplateId('1390041'), true, 'template id: 7 digits ok');
    eq(isValidTemplateId('0'), false, 'template id: zero rejected');
    eq(isValidTemplateId('abc'), false, 'template id: letters rejected');
    eq(isValidTemplateId(''), false, 'template id: empty rejected');

    // name folding
    eq(normalizeName('Farah♦'), 'farah', 'normalizeName folds Farah♦ → farah');
    eq(normalizeName('(CZ-SK)eXitus'), 'czskexitus', 'normalizeName strips punctuation');
    eq(normalizeName(null), '', 'normalizeName null-safe');

    // lookup resolution
    var roster = [
      { id: '430635', name: 'Farah♦', status: 'ACTIVE', rank: 12, elo: 1000 },
      { id: '4543063534', name: 'Farah', status: 'INACTIVE', rank: null, elo: 898 },
      { id: '28867016', name: 'Swisster', status: 'ACTIVE', rank: 1, elo: 1151 }
    ];
    var r1 = resolveLookup('farah', roster);
    eq([r1.resolved, r1.picks.length], [null, 2],
      "lookup: 'farah' is ambiguous → 2 picks, none resolved");
    eq(r1.picks.map(function (p) { return p.name; }), ['Farah♦', 'Farah'],
      'lookup: ambiguous picks list both Farahs');
    var r2 = resolveLookup('Farah♦', roster);
    eq([r2.resolved, r2.picks.length], [null, 2],
      "lookup: literal 'Farah♦' still folds equal to both → picks");
    eq(resolveLookup('swiss', roster).resolved.id, '28867016',
      'lookup: unique substring resolves');
    eq(resolveLookup('SWISSTER', roster).resolved.id, '28867016',
      'lookup: exact folded name resolves case-insensitively');
    eq(resolveLookup('430635', roster).resolved.name, 'Farah♦',
      'lookup: numeric id resolves directly');
    eq(resolveLookup('zzz', roster), { resolved: null, picks: [] },
      'lookup: no match → nothing');
    eq(resolveLookup('  ', roster), { resolved: null, picks: [] },
      'lookup: blank → nothing');
    eq(resolveLookup('farah', []), { resolved: null, picks: [] },
      'lookup: empty roster (degraded) → nothing');

    // signup id checks (raw players map, departed included)
    var raw = {
      '28867016': { name: 'Swisster', elo: 1151 },
      '4555082823': { name: 'Super Smoove', elo: 1003, in_clan: false }
    };
    eq(checkJoinId('28867016', raw), { status: 'registered', name: 'Swisster' },
      'join check: current member id blocks');
    eq(checkJoinId('4555082823', raw), { status: 'departed', name: 'Super Smoove' },
      'join check: departed id → welcome back');
    eq(checkJoinId('99', raw), { status: 'free', name: null },
      'join check: unknown id is free');
    eq(checkJoinId('99', null), { status: 'free', name: null },
      'join check: no data (degraded) → free');

    // name collision (folded equality, non-blocking)
    eq(nameCollision('FARAH', roster).name, 'Farah♦',
      'name collision: folded equality hits');
    eq(nameCollision('swisster ', roster).name, 'Swisster',
      'name collision: trims + case-folds');
    eq(nameCollision('NewGuy', roster), null, 'name collision: fresh name clear');
    eq(nameCollision('', roster), null, 'name collision: empty clear');

    // map pool checks + labels
    var pool = [{ id: '1390041', name: 'Strat 1v1', games: 391 }];
    eq(findInPool('1390041', pool).name, 'Strat 1v1', 'pool: existing id found');
    eq(findInPool(' 1390041 ', pool).name, 'Strat 1v1', 'pool: trims');
    eq(findInPool('9999999', pool), null, 'pool: unknown id clear');
    eq(poolOptionLabel({ name: 'Strat 1v1', games: 1391 }), 'Strat 1v1 — 1,391 GAMES',
      'pool option label');

    // chip metas
    eq(capChipMeta({ status: 'ACTIVE', rank: 6, cap: 2 }), '#6 · CAP 2', 'cap chip: active');
    eq(capChipMeta({ status: 'PAUSED', rank: null, cap: 0 }), 'PAUSED · CAP 0',
      'cap chip: reserve shows status');
    eq(removeChipMeta({ wins: 41, losses: 23, elo: 1151 }), '41–23 · 1151', 'remove chip meta');
    eq(pickMeta({ status: 'INACTIVE', rank: null, elo: 898 }), 'INACTIVE · 898', 'pick meta');

    // remove gate
    eq(removeConfirmed('REMOVE'), true, 'remove gate: REMOVE passes');
    eq(removeConfirmed(' remove '), true, 'remove gate: case/space-insensitive');
    eq(removeConfirmed('REMOV'), false, 'remove gate: partial fails');
    eq(removeConfirmed('LEAVE'), false, 'remove gate: old LEAVE word fails');
    eq(removeConfirmed(''), false, 'remove gate: empty fails');

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
    roster: [],     // derived entries, active + reserve (current members)
    rawPlayers: null, // raw players.json map (departed entries included)
    maps: []        // data.maps (current pool)
  };

  function openIssue(title) {
    window.open(issueUrl(title), '_blank', 'noopener');
  }

  /* ---------- message lines ---------- */

  function clearMsg(el) {
    if (!el) return;
    el.textContent = '';
    el.className = 'af__msg';
    el.hidden = true;
  }

  /* parts: strings and/or nodes */
  function setMsg(el, kind, parts) {
    if (!el) return;
    el.textContent = '';
    el.className = 'af__msg af__msg--' + kind;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      el.appendChild(typeof p === 'string' ? doc.createTextNode(p) : p);
    }
    el.hidden = false;
  }

  function profileLink(id, name) {
    var a = doc.createElement('a');
    a.href = 'profile.html?p=' + encodeURIComponent(id);
    a.textContent = name;
    return a;
  }

  /* ---------- chips + picks ---------- */

  function insigniaNode(entry, size) {
    var span = doc.createElement('span');
    span.className = 'pchip__ins';
    if (window.Insignia && typeof entry.rankIndex === 'number') {
      span.innerHTML = window.Insignia.svg(entry.rankIndex, entry.league, size);
    }
    return span;
  }

  function renderChip(chipEl, entry, metaText) {
    chipEl.textContent = '';
    if (typeof entry.rankIndex === 'number') {
      chipEl.appendChild(insigniaNode(entry, 18));
    }
    var name = doc.createElement('span');
    name.className = 'pchip__name';
    name.textContent = entry.name;
    chipEl.appendChild(name);
    var meta = doc.createElement('span');
    meta.className = 'pchip__meta';
    meta.textContent = metaText;
    chipEl.appendChild(meta);
    chipEl.hidden = false;
  }

  /* One name-or-id lookup widget (SET CAP and REMOVE PLAYER both use this).
     Degraded mode (roster never loaded): a well-formed numeric id counts
     as resolved — format-only validation, no roster chip data. */
  function lookupWidget(opts) {
    var input = $(opts.input);
    var picksEl = $(opts.picks);
    var chipEl = $(opts.chip);
    var msgEl = $(opts.msg);
    var w = { resolved: null };

    function settle(entry) {
      w.resolved = entry;
      picksEl.hidden = true;
      picksEl.textContent = '';
      if (entry) {
        renderChip(chipEl, entry, opts.meta(entry));
      } else {
        chipEl.hidden = true;
        chipEl.textContent = '';
      }
      opts.onChange();
    }

    function showPicks(picks) {
      w.resolved = null;
      chipEl.hidden = true;
      chipEl.textContent = '';
      picksEl.textContent = '';
      picks.forEach(function (entry) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'pick';
        var ins = insigniaNode(entry, 18);
        ins.className = 'pick__ins';
        b.appendChild(ins);
        var name = doc.createElement('span');
        name.className = 'pick__name';
        name.textContent = entry.name;
        b.appendChild(name);
        var meta = doc.createElement('span');
        meta.className = 'pick__meta';
        meta.textContent = pickMeta(entry);
        b.appendChild(meta);
        b.addEventListener('click', function () { settle(entry); });
        picksEl.appendChild(b);
      });
      picksEl.hidden = false;
      opts.onChange();
    }

    function update() {
      clearMsg(msgEl);
      var q = input.value.trim();
      if (!q) { settle(null); return; }

      if (!state.roster.length) {
        // degraded: format-only — a valid numeric id resolves as itself
        settle(isValidWzId(q) ? { id: q, name: q, degraded: true } : null);
        return;
      }

      var res = resolveLookup(q, state.roster);
      if (res.resolved) { settle(res.resolved); return; }
      if (res.picks.length) { showPicks(res.picks); return; }
      settle(null);
      setMsg(msgEl, 'error', ['NO MATCHING PLAYER']);
    }

    input.addEventListener('input', update);
    w.update = update;
    return w;
  }

  /* ---------- JOIN THE LADDER ---------- */

  var joinName, joinId, joinNameMsg, joinIdMsg, joinSubmit;

  function validateJoin() {
    var name = joinName.value.trim();
    var id = joinId.value.trim();
    var blocked = false;

    clearMsg(joinIdMsg);
    if (id && !isValidWzId(id)) {
      setMsg(joinIdMsg, 'error', ['INVALID WARZONE ID']);
      blocked = true;
    } else if (id) {
      var check = checkJoinId(id, state.rawPlayers);
      if (check.status === 'registered') {
        setMsg(joinIdMsg, 'error', ['ALREADY REGISTERED — ', profileLink(id, check.name)]);
        blocked = true;
      } else if (check.status === 'departed') {
        setMsg(joinIdMsg, 'quiet', ['WELCOME BACK, ' + check.name]);
      }
    }

    clearMsg(joinNameMsg);
    if (name) {
      var clash = nameCollision(name, state.roster);
      if (clash) {
        setMsg(joinNameMsg, 'warn', ['A PLAYER NAMED ' + clash.name + ' ALREADY EXISTS']);
      }
    }

    joinSubmit.disabled = !(name && isValidWzId(id) && !blocked);
  }

  function wireJoin() {
    joinName = $('join-name');
    joinId = $('join-id');
    joinNameMsg = $('join-name-msg');
    joinIdMsg = $('join-id-msg');
    joinSubmit = $('join-submit');
    joinName.addEventListener('input', validateJoin);
    joinId.addEventListener('input', validateJoin);
    $('form-join').addEventListener('submit', function (e) {
      e.preventDefault();
      if (joinSubmit.disabled) return;
      openIssue(signupTitle(joinId.value.trim(), joinName.value.trim()));
    });
  }

  /* ---------- SET GAME CAP ---------- */

  var capWidget, capSelect, capSubmit, capPrefilledFor = null;

  function validateCap() {
    var r = capWidget.resolved;
    // prefill the select with the player's current cap (once per resolution)
    if (r && !r.degraded && r.cap != null && capPrefilledFor !== r.id) {
      capPrefilledFor = r.id;
      capSelect.value = String(r.cap);
    }
    if (!r) capPrefilledFor = null;
    capSubmit.disabled = !r;
  }

  function wireCap() {
    capSelect = $('cap-select');
    capSubmit = $('cap-submit');
    capWidget = lookupWidget({
      input: 'cap-player', picks: 'cap-picks', chip: 'cap-chip', msg: 'cap-msg',
      meta: capChipMeta, onChange: validateCap
    });
    $('form-cap').addEventListener('submit', function (e) {
      e.preventDefault();
      if (capSubmit.disabled || !capWidget.resolved) return;
      openIssue(capTitle(capWidget.resolved.id, capSelect.value));
    });
  }

  /* ---------- ADD TEMPLATE (admin) ---------- */

  var tmplId, tmplName, tmplIdMsg, tmplSubmit;

  function validateAddMap() {
    var id = tmplId.value.trim();
    var name = tmplName.value.trim();
    var blocked = false;

    clearMsg(tmplIdMsg);
    if (id && !isValidTemplateId(id)) {
      setMsg(tmplIdMsg, 'error', ['INVALID TEMPLATE ID']);
      blocked = true;
    } else if (id) {
      var existing = findInPool(id, state.maps);
      if (existing) {
        setMsg(tmplIdMsg, 'error', ['ALREADY IN THE POOL — ' + existing.name]);
        blocked = true;
      }
    }

    tmplSubmit.disabled = !(name && isValidTemplateId(id) && !blocked);
  }

  function wireAddMap() {
    tmplId = $('tmpl-id');
    tmplName = $('tmpl-name');
    tmplIdMsg = $('tmpl-id-msg');
    tmplSubmit = $('tmpl-submit');
    tmplId.addEventListener('input', validateAddMap);
    tmplName.addEventListener('input', validateAddMap);
    $('form-addmap').addEventListener('submit', function (e) {
      e.preventDefault();
      if (tmplSubmit.disabled) return;
      openIssue(addTemplateTitle(tmplId.value.trim(), tmplName.value.trim()));
    });
  }

  /* ---------- REMOVE TEMPLATE (admin) ---------- */

  var rmSelect, rmId, rmIdMsg, rmSubmit;

  function validateRemoveMap() {
    var id = rmId.value.trim();
    clearMsg(rmIdMsg);
    if (id && !isValidTemplateId(id)) setMsg(rmIdMsg, 'error', ['INVALID TEMPLATE ID']);
    rmSubmit.disabled = !isValidTemplateId(id);
  }

  function fillPoolSelect() {
    rmSelect.textContent = '';
    var ph = doc.createElement('option');
    ph.value = '';
    ph.textContent = 'SELECT TEMPLATE';
    rmSelect.appendChild(ph);
    state.maps.forEach(function (m) {
      var opt = doc.createElement('option');
      opt.value = String(m.id);
      opt.textContent = poolOptionLabel(m);
      rmSelect.appendChild(opt);
    });
  }

  function wireRemoveMap() {
    rmSelect = $('rm-select');
    rmId = $('rm-id');
    rmIdMsg = $('rm-id-msg');
    rmSubmit = $('rm-submit');
    rmSelect.addEventListener('change', function () {
      rmId.value = rmSelect.value; // select prefills the id
      validateRemoveMap();
    });
    rmId.addEventListener('input', function () {
      // manual edits detach from the select (degraded path stays usable)
      if (rmSelect.value !== rmId.value.trim()) rmSelect.value = '';
      validateRemoveMap();
    });
    $('form-rmmap').addEventListener('submit', function (e) {
      e.preventDefault();
      if (rmSubmit.disabled) return;
      openIssue(removeTemplateTitle(rmId.value.trim()));
    });
  }

  /* ---------- REMOVE PLAYER (admin) ---------- */

  var rmpWidget, rmpConfirm, rmpSubmit;

  function validateRemovePlayer() {
    rmpSubmit.disabled = !(rmpWidget.resolved && removeConfirmed(rmpConfirm.value));
  }

  function wireRemovePlayer() {
    rmpConfirm = $('rmplayer-confirm');
    rmpSubmit = $('rmplayer-submit');
    rmpWidget = lookupWidget({
      input: 'rmplayer-player', picks: 'rmplayer-picks', chip: 'rmplayer-chip',
      msg: 'rmplayer-msg', meta: removeChipMeta, onChange: validateRemovePlayer
    });
    rmpConfirm.addEventListener('input', validateRemovePlayer);
    $('form-rmplayer').addEventListener('submit', function (e) {
      e.preventDefault();
      if (rmpSubmit.disabled || !rmpWidget.resolved) return;
      openIssue(removeTitle(rmpWidget.resolved.id));
    });
  }

  /* ---------- masthead stats ---------- */

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function fillStats(meta) {
    setText('stat-active', (meta.activeCount || 0) + ' ACTIVE');
    setText('stat-games', Number(meta.gamesPlayed || 0).toLocaleString('en-US') + ' GAMES');
    setText('stat-updated', 'Last Update ' + String(meta.lastUpdatedText || '—').toLowerCase());
  }

  /* ---------- boot ---------- */

  function revalidateAll() {
    validateJoin();
    capWidget.update();
    validateAddMap();
    validateRemoveMap();
    rmpWidget.update();
  }

  function onData(data) {
    state.roster = (data.active || []).concat(data.reserve || []);
    state.maps = data.maps || [];
    fillStats(data.meta || {});
    fillPoolSelect();
    revalidateAll(); // anything typed before the data arrived
  }

  function boot() {
    wireJoin();
    wireCap();
    wireAddMap();
    wireRemoveMap();
    wireRemovePlayer();

    // Data loads upgrade validation from format-only to full roster checks;
    // failures degrade silently (forms stay usable on format alone).
    if (window.LadderData && typeof window.LadderData.load === 'function') {
      window.LadderData.load().then(onData).catch(function () { /* degrade silently */ });
    }
    fetch('data/players.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (raw) {
        if (raw) {
          state.rawPlayers = raw;
          validateJoin();
        }
      })
      .catch(function () { /* degrade silently */ });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
