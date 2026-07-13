/* ============================================================
   M'Hunters Clan Ladder — Rules page wiring (Track C)
   Plain vanilla script (no modules). Depends on:
     window.LadderData (js/derive.js) — LadderData.load()
       → { active, reserve, meta } (counts aggregate active+reserve)
     window.Insignia (js/insignia.js) — Insignia.svg(ri,'steel',22),
       Insignia.leagueColor(key) for the league metal chips
   DOM contract (rules.html):
     #ranks-body · #leagues-body · .cmd/.cmd-copy blocks ·
     #stat-active · #stat-games · #stat-updated
   The tables render immediately with '—' counts; live counts
   fill in when the data arrives. Data failure keeps the dashes.
   Self-test: `node js/rules.js` runs the pure-helper test suite.
   ============================================================ */

(function () {
  'use strict';

  /* ------------------------------------------------------------
     Domain tables (mirror js/derive.js — non-negotiable)
     ------------------------------------------------------------ */

  var RANK_THRESHOLDS = [
    0, 10, 25, 50, 75, 100, 150, 200, 250, 300, 350, 400,
    450, 500, 600, 700, 800, 900, 1000, 1250, 1500, 2000, 2500
  ];

  var RANK_NAMES = [
    'Recruit', 'Private', 'Private First Class', 'Specialist', 'Corporal',
    'Sergeant', 'Staff Sergeant', 'Sergeant First Class', 'Master Sergeant',
    'First Sergeant', 'Sergeant Major', 'Command Sgt. Major',
    'Second Lieutenant', 'First Lieutenant', 'Captain', 'Major',
    'Lieutenant Colonel', 'Colonel', '1 Star General', '2 Star General',
    '3 Star General', '4 Star General', '5 Star General'
  ];

  var LEAGUE_KEYS = [
    'lumber', 'stone', 'iron', 'steel', 'cobalt', 'silver', 'platinum',
    'electrum', 'gold', 'crown', 'obsidian', 'bloodsteel', 'warlord'
  ];

  var LEAGUE_NAMES = [
    'Lumber', 'Stone', 'Iron', 'Steel', 'Cobalt', 'Silver', 'Platinum',
    'Electrum', 'Gold', 'Crown Gold', 'Obsidian', 'Bloodsteel', 'Warlord'
  ];

  var LEAGUE_FLOORS = [
    -Infinity, 800, 850, 900, 1000, 1050, 1100, 1150, 1200, 1250, 1300, 1400, 1500
  ];

  /* ------------------------------------------------------------
     Pure helpers (no DOM — testable in node)
     ------------------------------------------------------------ */

  function fmtInt(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  /* ELO band label for league i: 'below 800' · '850–899' · … · '1500+' */
  function rangeLabel(i, floors) {
    floors = floors || LEAGUE_FLOORS;
    if (i <= 0) return 'below ' + floors[1];
    if (i >= floors.length - 1) return floors[i] + '+';
    return floors[i] + '–' + (floors[i + 1] - 1);
  }

  /* counts[ri] = players currently holding rank ri (entries carry rankIndex) */
  function countByRank(entries) {
    var counts = [];
    for (var i = 0; i < RANK_NAMES.length; i++) counts.push(0);
    if (!entries) return counts;
    for (var j = 0; j < entries.length; j++) {
      var ri = entries[j] ? Math.floor(Number(entries[j].rankIndex)) : NaN;
      if (!isFinite(ri)) ri = 0;
      ri = Math.max(0, Math.min(RANK_NAMES.length - 1, ri));
      counts[ri]++;
    }
    return counts;
  }

  /* counts[li] = players currently in league li (entries carry a league key;
     entries missing the key fall back to their elo against the floors) */
  function countByLeague(entries) {
    var counts = [];
    for (var i = 0; i < LEAGUE_KEYS.length; i++) counts.push(0);
    if (!entries) return counts;
    for (var j = 0; j < entries.length; j++) {
      var e = entries[j] || {};
      var li = LEAGUE_KEYS.indexOf(e.league);
      if (li === -1) {
        var elo = Number(e.elo);
        if (!isFinite(elo)) elo = 1000;
        li = LEAGUE_FLOORS.length - 1;
        while (li > 0 && elo < LEAGUE_FLOORS[li]) li--;
      }
      counts[li]++;
    }
    return counts;
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

    console.log('rules.js pure-helper self-test');

    eq(rangeLabel(0), 'below 800', 'rangeLabel bottom → below 800');
    eq(rangeLabel(1), '800–849', 'rangeLabel stone → 800–849');
    eq(rangeLabel(2), '850–899', 'rangeLabel iron → 850–899');
    eq(rangeLabel(4), '1000–1049', 'rangeLabel cobalt → 1000–1049');
    eq(rangeLabel(10), '1300–1399', 'rangeLabel obsidian → 1300–1399');
    eq(rangeLabel(12), '1500+', 'rangeLabel top → 1500+');
    eq(rangeLabel(2, [-Infinity, 10, 20, 30]), '20–29', 'rangeLabel honors custom floors');

    var fakePlayers = [
      { rankIndex: 0, league: 'cobalt', elo: 1000 },
      { rankIndex: 0, league: 'stone', elo: 812 },
      { rankIndex: 4, league: 'obsidian', elo: 1369 },
      { rankIndex: 22, league: 'warlord', elo: 1520 },
      { rankIndex: 99, league: 'nope', elo: 905 },     // clamps + elo fallback
      { rankIndex: 'x' }                               // junk-safe
    ];
    var rc = countByRank(fakePlayers);
    eq(rc.length, 23, 'countByRank returns 23 buckets');
    eq(rc[0], 3, 'countByRank recruit bucket (2 recruits + junk → recruit)');
    eq(rc[4], 1, 'countByRank corporal bucket');
    eq(rc[22], 2, 'countByRank clamps overflow into top rank');
    eq(countByRank([]).join(''), '00000000000000000000000', 'countByRank empty → zeros');
    eq(countByRank(null).length, 23, 'countByRank null-safe');

    var lc = countByLeague(fakePlayers);
    eq(lc.length, 13, 'countByLeague returns 13 buckets');
    eq(lc[4], 2, 'countByLeague cobalt bucket (missing key → start elo 1000)');
    eq(lc[1], 1, 'countByLeague stone bucket');
    eq(lc[3], 1, 'countByLeague unknown key falls back to elo (steel 905)');
    eq(lc[10], 1, 'countByLeague obsidian bucket');
    eq(lc[12], 1, 'countByLeague warlord bucket');
    eq(countByLeague([]).join(''), '0000000000000', 'countByLeague empty → zeros');

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

  /* ---------- masthead (same stats as the other pages) ---------- */

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function renderMasthead(meta) {
    meta = meta || {};
    setText('stat-active', (meta.activeCount || 0) + ' ACTIVE');
    setText('stat-games', fmtInt(meta.gamesPlayed) + ' GAMES');
    setText('stat-updated', 'Last Update ' + String(meta.lastUpdatedText || '—').toLowerCase());
  }

  /* ---------- league metal chip gradient ---------- */

  function mixHex(hexA, hexB, t) {
    function ch(hex, i) { return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16); }
    function pad(v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16).toUpperCase();
      return s.length < 2 ? '0' + s : s;
    }
    var out = '#';
    for (var i = 0; i < 3; i++) out += pad(ch(hexA, i) + (ch(hexB, i) - ch(hexA, i)) * t);
    return out;
  }

  function chipGradient(key) {
    if (!window.Insignia || typeof window.Insignia.leagueColor !== 'function') return '#65696F';
    // bloodsteel: silver bleeding into red (matches the insignia ramp)
    if (key === 'bloodsteel') return 'linear-gradient(120deg, #C4CAD2, #B56A6E 55%, #96343B)';
    var base = window.Insignia.leagueColor(key);
    var hi = mixHex(base, '#FFFFFF', key === 'obsidian' ? 0.28 : 0.32);
    var lo = mixHex(base, '#000000', 0.34);
    return 'linear-gradient(120deg, ' + hi + ', ' + base + ' 55%, ' + lo + ')';
  }

  /* ---------- live tables ---------- */

  function countCell(counts, i) {
    var td = doc.createElement('td');
    td.className = 'c-count';
    if (counts) {
      td.textContent = fmtInt(counts[i]);
      if (!counts[i]) td.className += ' is-zero';
    } else {
      td.textContent = '—';
      td.className += ' is-zero';
    }
    return td;
  }

  /* 23 ranks: shield insignia · name · wins required · current holders */
  function renderRanks(counts) {
    var body = $('ranks-body');
    if (!body) return;
    body.textContent = '';
    var frag = doc.createDocumentFragment();
    for (var ri = 0; ri < RANK_NAMES.length; ri++) {
      var tr = doc.createElement('tr');

      var ins = doc.createElement('td');
      ins.className = 'c-ins';
      if (window.Insignia && typeof window.Insignia.svg === 'function') {
        ins.innerHTML = window.Insignia.svg(ri, 'steel', 22);
      }
      tr.appendChild(ins);

      var name = doc.createElement('td');
      name.className = 'c-name';
      name.textContent = RANK_NAMES[ri];
      tr.appendChild(name);

      var wins = doc.createElement('td');
      wins.className = 'c-wins';
      wins.textContent = fmtInt(RANK_THRESHOLDS[ri]);
      tr.appendChild(wins);

      tr.appendChild(countCell(counts, ri));
      frag.appendChild(tr);
    }
    body.appendChild(frag);
  }

  /* 12 leagues: metal chip · name · elo band · current players */
  function renderLeagues(counts) {
    var body = $('leagues-body');
    if (!body) return;
    body.textContent = '';
    var frag = doc.createDocumentFragment();
    for (var li = 0; li < LEAGUE_KEYS.length; li++) {
      var key = LEAGUE_KEYS[li];
      var tr = doc.createElement('tr');

      var ins = doc.createElement('td');
      ins.className = 'c-ins';
      var chip = doc.createElement('span');
      chip.className = 'lg-chip lg-chip--' + key;
      chip.style.background = chipGradient(key);
      ins.appendChild(chip);
      tr.appendChild(ins);

      var name = doc.createElement('td');
      name.className = 'c-name' + (key === 'warlord' ? ' is-warlord' : '');
      name.textContent = LEAGUE_NAMES[li];
      if (key === 'cobalt') {
        var tag = doc.createElement('span');
        tag.className = 'start-tag';
        tag.textContent = 'START';
        name.appendChild(tag);
      }
      tr.appendChild(name);

      var range = doc.createElement('td');
      range.className = 'c-range';
      range.textContent = rangeLabel(li);
      tr.appendChild(range);

      tr.appendChild(countCell(counts, li));
      frag.appendChild(tr);
    }
    body.appendChild(frag);
  }

  /* ---------- click-to-copy command blocks ---------- */

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      doc.body.appendChild(ta);
      ta.select();
      try {
        if (doc.execCommand('copy')) resolve();
        else reject(new Error('execCommand copy refused'));
      } catch (e) {
        reject(e);
      } finally {
        doc.body.removeChild(ta);
      }
    });
  }

  function wireCopyButtons() {
    var btns = doc.querySelectorAll('.cmd-copy');
    Array.prototype.forEach.call(btns, function (btn) {
      var timer = null;
      btn.addEventListener('click', function () {
        var code = btn.parentNode ? btn.parentNode.querySelector('code') : null;
        var text = code ? code.textContent : '';
        var done = function (label, copied) {
          btn.textContent = label;
          btn.classList.toggle('copied', copied);
          if (timer) clearTimeout(timer);
          timer = setTimeout(function () {
            btn.textContent = 'COPY';
            btn.classList.remove('copied');
          }, 1400);
        };
        copyText(text).then(
          function () { done('COPIED', true); },
          function () { done('FAILED', false); }
        );
      });
    });
  }

  /* ---------- main ---------- */

  function init() {
    // Tables render immediately (counts pending) — page works without data.
    renderRanks(null);
    renderLeagues(null);
    wireCopyButtons();

    if (!window.LadderData || typeof window.LadderData.load !== 'function') {
      console.warn('[rules] window.LadderData.load is missing — is js/derive.js loaded before js/rules.js?');
      return;
    }

    window.LadderData.load().then(function (data) {
      data = data || {};
      renderMasthead(data.meta);
      var entries = (data.active || []).concat(data.reserve || []);
      renderRanks(countByRank(entries));
      renderLeagues(countByLeague(entries));
    }).catch(function (err) {
      // keep the '—' counts — the rulebook still reads fine without data
      console.warn('[rules] ladder data load failed', err);
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
