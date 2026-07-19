/* ============================================================
   M'Hunters Clan Ladder — engine heartbeat (masthead stat)
   Replaces the data-derived fallback text with the REAL
   time of Norman's last check, read from the public GitHub
   Actions API (no auth, CORS-open, zero repo commits).
   - async after page render; never blocks anything
   - sessionStorage-cached 5 minutes to stay far under API limits
   - any failure leaves the existing data-derived fallback text
   Self-test: `node js/heartbeat.js` runs the pure-helper suite.
   ============================================================ */
(function () {
  'use strict';

  var API = 'https://api.github.com/repos/Norman1/mhunters-clan-ladder/' +
            'actions/workflows/schedule.yml/runs?status=completed&per_page=1';
  var CACHE_KEY = 'mh-heartbeat';
  var CACHE_MS = 5 * 60 * 1000;

  /* ms timestamp → 'Last Update 28m ago' / '3h ago' / '2d ago' */
  function checkedText(thenMs, nowMs) {
    var diff = nowMs - thenMs;
    if (!isFinite(diff) || diff < 0) diff = 0;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Last Update just now';
    if (mins < 60) return 'Last Update ' + mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return 'Last Update ' + hours + 'h ago';
    return 'Last Update ' + Math.floor(hours / 24) + 'd ago';
  }

  /* API payload → ms timestamp of the newest run's start (null if absent) */
  function runStartMs(payload) {
    try {
      var run = payload && payload.workflow_runs && payload.workflow_runs[0];
      var t = run ? Date.parse(run.run_started_at) : NaN;
      return isNaN(t) ? null : t;
    } catch (err) {
      return null;
    }
  }

  /* ------------------------------------------------------------
     Node self-test (browser never reaches this block)
     ------------------------------------------------------------ */
  if (typeof window === 'undefined') {
    var checks = 0, failures = 0;
    var eq = function (actual, expected, label) {
      checks++;
      if (JSON.stringify(actual) === JSON.stringify(expected)) {
        console.log('  PASS  ' + label);
      } else {
        failures++;
        console.log('  FAIL  ' + label + ' — expected ' + JSON.stringify(expected) +
          ', got ' + JSON.stringify(actual));
      }
    };
    console.log('heartbeat.js pure-helper self-test');
    var now = Date.parse('2026-07-19T12:00:00Z');
    eq(checkedText(now - 30 * 1000, now), 'Last Update just now', 'under a minute');
    eq(checkedText(now - 28 * 60000, now), 'Last Update 28m ago', 'minutes');
    eq(checkedText(now - 3 * 3600000, now), 'Last Update 3h ago', 'hours');
    eq(checkedText(now - 50 * 3600000, now), 'Last Update 2d ago', 'days');
    eq(checkedText(now + 60000, now), 'Last Update just now', 'future clock skew clamps');
    eq(runStartMs({ workflow_runs: [{ run_started_at: '2026-07-19T10:00:00Z' }] }),
      Date.parse('2026-07-19T10:00:00Z'), 'runStartMs parses');
    eq(runStartMs({ workflow_runs: [] }), null, 'runStartMs empty → null');
    eq(runStartMs(null), null, 'runStartMs null-safe');
    eq(runStartMs({ workflow_runs: [{ run_started_at: 'junk' }] }), null, 'runStartMs junk → null');
    console.log(failures === 0
      ? 'ALL ' + checks + ' CHECKS PASSED'
      : failures + '/' + checks + ' CHECKS FAILED');
    if (typeof process !== 'undefined') process.exitCode = failures ? 1 : 0;
    return;
  }

  /* ------------------------------------------------------------
     Browser wiring
     ------------------------------------------------------------ */

  var observing = false;
  var ourText = null;

  function apply(ms) {
    var el = document.getElementById('stat-updated');
    if (!el) return;
    ourText = checkedText(ms, Date.now());
    el.textContent = ourText;
    el.title = 'Norman last checked for results at ' + new Date(ms).toLocaleString();
    /* each page's own masthead render may land AFTER us and overwrite the
       text with the data-derived fallback — watch and win the race */
    if (!observing && typeof MutationObserver === 'function') {
      observing = true;
      new MutationObserver(function () {
        if (ourText != null && el.textContent !== ourText) {
          el.textContent = ourText;
        }
      }).observe(el, { childList: true, characterData: true, subtree: true });
    }
  }

  function cached() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (Date.now() - c.at > CACHE_MS) return null;
      return c.ms;
    } catch (err) {
      return null;
    }
  }

  function fetchHeartbeat() {
    var hit = cached();
    if (hit != null) { apply(hit); return; }
    fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (payload) {
        var ms = runStartMs(payload);
        if (ms == null) return; // leave the data-derived fallback in place
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), ms: ms }));
        } catch (err) { /* private mode etc. — fine */ }
        apply(ms);
      })
      .catch(function () { /* offline / rate-limited — fallback text stays */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchHeartbeat);
  } else {
    fetchHeartbeat();
  }
})();
