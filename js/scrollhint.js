/* ============================================================
   M'Hunters Clan Ladder — sideways-scroll hint for tables
   On narrow screens a .table-wrap can scroll sideways. This fades
   the edge that has more columns behind it (right at rest, left
   once scrolled), and clears the fade when nothing is hidden.
   Self-test: `node js/scrollhint.js`.
   ============================================================ */
(function () {
  'use strict';

  /* which edges hide content: scrollLeft / scroll width / visible width */
  function edges(left, scrollW, clientW) {
    var max = scrollW - clientW;
    if (max <= 1) return { left: false, right: false };
    return { left: left > 1, right: left < max - 1 };
  }

  if (typeof document === 'undefined') {
    var failures = 0, checks = 0;
    var eq = function (a, e, label) {
      checks++;
      if (JSON.stringify(a) === JSON.stringify(e)) { console.log('  PASS  ' + label); }
      else { failures++; console.log('  FAIL  ' + label + '\n        expected ' + JSON.stringify(e) + '\n        got      ' + JSON.stringify(a)); }
    };
    console.log('scrollhint.js self-test');
    eq(edges(0, 400, 400), { left: false, right: false }, 'fits → no fade');
    eq(edges(0, 450, 350), { left: false, right: true }, 'at start → right fade');
    eq(edges(50, 450, 350), { left: true, right: true }, 'middle → both');
    eq(edges(100, 450, 350), { left: true, right: false }, 'at end → left fade');
    console.log(failures === 0 ? 'ALL ' + checks + ' CHECKS PASSED' : failures + '/' + checks + ' CHECKS FAILED');
    if (failures) process.exitCode = 1;
    return;
  }

  function update(wrap) {
    var e = edges(wrap.scrollLeft, wrap.scrollWidth, wrap.clientWidth);
    wrap.classList.toggle('fade-left', e.left);
    wrap.classList.toggle('fade-right', e.right);
  }

  function watch(wrap) {
    if (wrap.dataset.scrollHint) return;
    wrap.dataset.scrollHint = '1';
    wrap.addEventListener('scroll', function () { update(wrap); }, { passive: true });
    if (typeof ResizeObserver === 'function') {
      // tables render after data loads, so watch the wrap and its contents
      var ro = new ResizeObserver(function () { update(wrap); });
      ro.observe(wrap);
      if (wrap.firstElementChild) ro.observe(wrap.firstElementChild);
    }
    update(wrap);
  }

  function scan() {
    var wraps = document.querySelectorAll('.table-wrap');
    for (var i = 0; i < wraps.length; i++) watch(wraps[i]);
  }

  scan();
  window.addEventListener('resize', function () {
    var wraps = document.querySelectorAll('.table-wrap');
    for (var i = 0; i < wraps.length; i++) update(wraps[i]);
  });
  // pages that build tables later (e.g. templates) — pick them up too
  if (typeof MutationObserver === 'function') {
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  }
})();
