/* ============================================================
   M'Hunters Clan Ladder — Actions page wiring
   Plain vanilla script (no modules). Depends on:
     window.LadderData (js/derive.js) — LadderData.load()
     window.Insignia  (js/insignia.js) — Insignia.svg()
   DOM contract (provided by actions.html):
     #form-guest  #guest-id #guest-name #guest-cap #guest-submit
     #form-revoke #revoke-player #revoke-picks #revoke-chip #revoke-msg
                  #revoke-confirm #revoke-submit
     #form-cap    #cap-player #cap-picks #cap-chip #cap-msg #cap-select #cap-submit
     #form-addmap #tmpl-id #tmpl-id-msg #tmpl-name #tmpl-submit
     #form-rmmap  #rm-select #rm-id #rm-id-msg #rm-submit
   Removal requires a loaded guest list. Other forms can use format-only
   validation when data is unavailable. Each action prepares a GitHub issue.
   Self-test: `node js/actions.js` runs the pure-helper test suite.
   ============================================================ */

(function () {
  'use strict';

  /* ------------------------------------------------------------
     Pure helpers (no DOM — testable in node)
     ------------------------------------------------------------ */

  var ISSUE_BASE = 'https://github.com/Norman1/mhunters-clan-ladder/issues/new?title=';

  /* title builders — byte-exact bot command formats */
  function admitGuestTitle(id, name, cap) { return 'AdmitGuest: ' + id + ' Cap: ' + cap + ' Name: ' + name; }
  function capTitle(id, cap) { return 'Update: ' + id + ' Cap: ' + cap; }
  function revokeGuestTitle(id) { return 'RevokeGuest: ' + id; }
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
    var id = String(s == null ? '' : s).trim();
    return /^[0-9]{2,11}$/.test(id) && /[1-9]/.test(id);
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

  function isValidCap(cap) {
    return ['0', '1', '2', '3'].indexOf(String(cap)) !== -1;
  }

  function validGuestFields(id, name, cap) {
    return isValidWzId(id) && typeof name === 'string' &&
      name.trim().length > 0 && !/[\r\n]/.test(name) && isValidCap(cap);
  }

  // Only explicitly admitted guests can be selected for guest removal.
  // Use derived entries for display when available, raw data as a fallback.
  function guestRoster(raw, roster) {
    return Object.keys(raw || {}).filter(function (id) {
      return raw[id].guest === true;
    }).map(function (id) {
      return (roster || []).find(function (p) { return String(p.id) === id; }) ||
        { id: id, name: raw[id].name, cap: raw[id].game_cap, elo: raw[id].elo, status: 'GUEST' };
    });
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

  function guestChipMeta(entry) {
    return 'ID ' + entry.id + ' · GUEST · CAP ' + (entry.cap != null ? entry.cap : '—');
  }

  /* pick meta line: position/status + rating */
  function pickMeta(entry) {
    var pos = entry.status === 'ACTIVE' && entry.rank != null
      ? '#' + entry.rank
      : (entry.status || '—');
    return pos + ' · ' + (entry.elo != null ? entry.elo : '—');
  }

  /* Guest removal requires an explicit REMOVE confirmation. */
  function guestRemovalConfirmed(text) {
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
    eq(admitGuestTitle('430635', 'Farah♦', '2'), 'AdmitGuest: 430635 Cap: 2 Name: Farah♦', 'admit guest title');
    eq(capTitle('49', '2'), 'Update: 49 Cap: 2', 'cap title');
    eq(capTitle('49', 0), 'Update: 49 Cap: 0', 'cap title PAUSE (0)');
    eq(revokeGuestTitle('28867016'), 'RevokeGuest: 28867016', 'revoke guest title');
    eq(addTemplateTitle('1390041', 'Strat 1v1'), 'AddTemplate: 1390041 Name: Strat 1v1',
      'add-template title');
    eq(removeTemplateTitle('1390041'), 'RemoveTemplate: 1390041', 'remove-template title');

    // issue URLs — byte-exact incl. unicode percent-encoding (♦ = %E2%99%A6)
    eq(issueUrl(admitGuestTitle('430635', 'Farah♦', '2')),
      'https://github.com/Norman1/mhunters-clan-ladder/issues/new?title=AdmitGuest%3A%20430635%20Cap%3A%202%20Name%3A%20Farah%E2%99%A6',
      'guest url encodes unicode name byte-exact');
    eq(issueUrl(capTitle('28867016', '1')),
      'https://github.com/Norman1/mhunters-clan-ladder/issues/new?title=Update%3A%2028867016%20Cap%3A%201',
      'cap url encodes colon + spaces');
    eq(issueUrl(revokeGuestTitle('49')),
      'https://github.com/Norman1/mhunters-clan-ladder/issues/new?title=RevokeGuest%3A%2049',
      'revoke guest url');
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

    // Guest admission fields and the removal candidate list.
    eq(validGuestFields('33160357416', 'Marcus Aurelius', '2'), true, 'valid guest fields');
    eq(validGuestFields('33160357416', '  ', '2'), false, 'empty guest name rejected');
    eq(validGuestFields('33160357416', 'Name\nOther', '2'), false, 'multiline name rejected');
    eq(validGuestFields('bad', 'Friend', '2'), false, 'invalid guest id rejected');
    eq(validGuestFields('00', 'Friend', '2'), false, 'zero guest id rejected');
    eq(validGuestFields('123', 'Friend', '0'), true, 'admit guest paused');
    eq(validGuestFields('123', 'Friend', '3'), true, 'admit guest cap three');
    eq(validGuestFields('123', 'Friend', '4'), false, 'guest cap four rejected');
    eq(validGuestFields('123', 'Friend', ''), false, 'empty guest cap rejected');
    var raw = {
      '12': { name: 'Member' },
      '34': { name: 'Guest', guest: true, game_cap: 0, in_clan: false },
      '56': { name: 'Clan Guest', guest: true, in_clan: true },
      '78': { name: 'Revoked', guest: false, in_clan: false }
    };
    eq(guestRoster(raw, []).map(function (p) { return p.id; }), ['34', '56'],
      'guest lookup excludes ordinary members and revoked guests');
    eq(guestRoster(raw, [ {id: '34', name: 'Derived'} ])[0].name, 'Derived',
      'guest lookup uses derived display details');
    eq(guestRoster(null, []), [], 'unavailable data produces no removal candidates');

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
    eq(guestChipMeta({ id: '34', cap: 2 }), 'ID 34 · GUEST · CAP 2', 'guest chip meta');
    eq(pickMeta({ status: 'INACTIVE', rank: null, elo: 898 }), 'INACTIVE · 898', 'pick meta');

    // remove gate
    eq(guestRemovalConfirmed('REMOVE'), true, 'remove gate: REMOVE passes');
    eq(guestRemovalConfirmed(' remove '), true, 'remove gate: case/space-insensitive');
    eq(guestRemovalConfirmed('REMOV'), false, 'remove gate: partial fails');
    eq(guestRemovalConfirmed('LEAVE'), false, 'remove gate: old LEAVE word fails');
    eq(guestRemovalConfirmed(''), false, 'remove gate: empty fails');

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
    roster: [],     // derived entries, active + reserve
    rawPlayers: null, // raw players.json map (departed entries included)
    guests: [],
    guestListStatus: 'loading',
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

  /* Shared name-or-id lookup widget for cap changes and guest removal.
     Cap changes accept a numeric id if roster loading fails. Guest removal
     always requires a match in the successfully loaded guest list. */
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
        meta.textContent = opts.requireKnown ? guestChipMeta(entry) : pickMeta(entry);
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

      var roster = opts.roster ? opts.roster() : state.roster;
      if (opts.requireKnown && state.guestListStatus !== 'loaded') {
        settle(null);
        setMsg(msgEl, 'quiet', [state.guestListStatus === 'loading'
          ? 'LOADING GUESTS…' : 'GUEST LIST UNAVAILABLE — RELOAD TO RETRY']);
        return;
      }
      if (!roster.length && !opts.requireKnown) {
        // degraded: format-only — a valid numeric id resolves as itself
        settle(isValidWzId(q) ? { id: q, name: q, degraded: true } : null);
        return;
      }

      var res = resolveLookup(q, roster);
      if (res.resolved) { settle(res.resolved); return; }
      if (res.picks.length) { showPicks(res.picks); return; }
      settle(null);
      setMsg(msgEl, 'error', [opts.requireKnown ? 'NO MATCHING GUEST' : 'NO MATCHING PLAYER']);
    }

    input.addEventListener('input', update);
    w.update = update;
    return w;
  }

  /* ---------- ADD GUEST PLAYER ---------- */

  var guestId, guestName, guestCap, guestIdMsg, guestNameMsg, guestSubmit;

  function validateGuest() {
    var id = guestId.value.trim();
    var name = guestName.value.trim();
    clearMsg(guestIdMsg);
    clearMsg(guestNameMsg);
    if (id && !isValidWzId(id)) {
      setMsg(guestIdMsg, 'error', ['INVALID WAR.APP PLAYER ID']);
    } else if (id && state.rawPlayers && state.rawPlayers[id]) {
      var existing = state.rawPlayers[id];
      setMsg(guestIdMsg, 'quiet', [existing.guest === true
        ? 'ALREADY A GUEST — THIS UPDATES NAME AND CAP'
        : 'EXISTING PLAYER — RATING AND HISTORY ARE KEPT']);
    }
    var clash = nameCollision(name, state.roster);
    if (clash && String(clash.id) !== id) {
      setMsg(guestNameMsg, 'warn', ['ANOTHER PLAYER IS NAMED ' + clash.name]);
    }
    guestSubmit.disabled = !validGuestFields(id, name, guestCap.value);
  }

  function wireGuest() {
    guestId = $('guest-id');
    guestName = $('guest-name');
    guestCap = $('guest-cap');
    guestIdMsg = $('guest-id-msg');
    guestNameMsg = $('guest-name-msg');
    guestSubmit = $('guest-submit');
    guestId.addEventListener('input', validateGuest);
    guestName.addEventListener('input', validateGuest);
    guestCap.addEventListener('change', validateGuest);
    $('form-guest').addEventListener('submit', function (e) {
      e.preventDefault();
      validateGuest();
      if (guestSubmit.disabled) return;
      openIssue(admitGuestTitle(guestId.value.trim(), guestName.value.trim(), guestCap.value));
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
    capSubmit.disabled = !r || !isValidCap(capSelect.value);
  }

  function wireCap() {
    capSelect = $('cap-select');
    capSubmit = $('cap-submit');
    capWidget = lookupWidget({
      input: 'cap-player', picks: 'cap-picks', chip: 'cap-chip', msg: 'cap-msg',
      meta: capChipMeta, onChange: validateCap
    });
    capSelect.addEventListener('change', validateCap);
    $('form-cap').addEventListener('submit', function (e) {
      e.preventDefault();
      validateCap();
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

  /* ---------- REMOVE GUEST PLAYER ---------- */

  var revokeWidget, revokeConfirm, revokeSubmit, revokeSelectedId = null;

  function validateRevoke() {
    var selected = revokeWidget.resolved;
    var id = selected ? selected.id : null;
    if (id !== revokeSelectedId) {
      revokeConfirm.value = '';
      revokeSelectedId = id;
    }
    revokeSubmit.disabled = !(selected && guestRemovalConfirmed(revokeConfirm.value));
  }

  function wireRevoke() {
    revokeConfirm = $('revoke-confirm');
    revokeSubmit = $('revoke-submit');
    revokeWidget = lookupWidget({
      input: 'revoke-player', picks: 'revoke-picks', chip: 'revoke-chip', msg: 'revoke-msg',
      meta: guestChipMeta, onChange: validateRevoke,
      roster: function () { return state.guests; }, requireKnown: true
    });
    revokeConfirm.addEventListener('input', validateRevoke);
    $('form-revoke').addEventListener('submit', function (e) {
      e.preventDefault();
      validateRevoke();
      if (revokeSubmit.disabled || !revokeWidget.resolved) return;
      openIssue(revokeGuestTitle(revokeWidget.resolved.id));
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
    validateGuest();
    capWidget.update();
    validateAddMap();
    validateRemoveMap();
    revokeWidget.update();
  }

  function onData(data) {
    state.roster = (data.active || []).concat(data.reserve || []);
    state.maps = data.maps || [];
    state.guests = guestRoster(state.rawPlayers, state.roster);
    fillStats(data.meta || {});
    fillPoolSelect();
    revalidateAll(); // anything typed before the data arrived
  }

  function boot() {
    wireGuest();
    wireCap();
    wireAddMap();
    wireRemoveMap();
    wireRevoke();

    // Cap/template forms tolerate missing data; removal only accepts known guests.
    if (window.LadderData && typeof window.LadderData.load === 'function') {
      window.LadderData.load().then(onData).catch(function () { /* use raw guest data */ });
    }
    fetch('data/players.json')
      .then(function (r) {
        if (!r.ok) throw new Error('Player list unavailable');
        return r.json();
      })
      .then(function (raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid player list');
        state.rawPlayers = raw;
        state.guestListStatus = 'loaded';
        state.guests = guestRoster(raw, state.roster);
        validateGuest();
        revokeWidget.update();
      })
      .catch(function () {
        state.guestListStatus = 'failed';
        revokeWidget.update();
      });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
