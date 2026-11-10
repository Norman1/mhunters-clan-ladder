/* ============================================================
   M'Hunters Clan Ladder — Insignia system (track B)
   window.Insignia — parametric engraved-metal rank insignia
   rendered inside a heraldic shield frame, tinted by league.

   Plain script, no modules. In the browser it attaches to
   window.Insignia. Under node (`node js/insignia.js`) it runs
   a standalone self-check instead.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- rank + league tables ---------- */

  var RANKS = [
    'Recruit', 'Private', 'Private First Class', 'Trooper', 'Corporal',
    'Gunner', 'Sharpshooter', 'Pathfinder', 'Ranger',
    'Raider', 'Commando', 'Shock Trooper',
    'Second Lieutenant', 'First Lieutenant', 'Captain', 'Major',
    'Lieutenant Colonel', 'Colonel', '1 Star General', '2 Star General',
    '3 Star General', '4 Star General', '5 Star General',
    'Warlord', 'God of War'
  ];

  var LEAGUES = {
    clay:       { name: 'Clay',       color: '#7E412D', lo: -Infinity },
    lumber:     { name: 'Lumber',     color: '#866A42', lo: 600 },
    stone:      { name: 'Stone',      color: '#4C5158', lo: 750 },
    iron:       { name: 'Iron',       color: '#76818D', lo: 900 },
    silver:     { name: 'Silver',     color: '#BEC7D1', lo: 1050 },
    gold:       { name: 'Gold',       color: '#DCBB5C', lo: 1150 },
    bloodsteel: { name: 'Bloodsteel', color: '#B56A6E', lo: 1250 },
    magma:      { name: 'Magma',      color: '#D22730', lo: 1400 },
    plasma:     { name: 'Plasma',     color: '#FF6229', lo: 1600 }
  };

  /* ---------- color helpers ---------- */

  function hexRgb(hex) {
    var h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)
    ];
  }

  function rgbHex(r, g, b) {
    function c(v) {
      v = Math.max(0, Math.min(255, Math.round(v)));
      var s = v.toString(16).toUpperCase();
      return s.length < 2 ? '0' + s : s;
    }
    return '#' + c(r) + c(g) + c(b);
  }

  function mix(hexA, hexB, t) {
    var a = hexRgb(hexA), b = hexRgb(hexB);
    return rgbHex(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    );
  }

  function lighten(hex, t) { return mix(hex, '#FFFFFF', t); }
  function darken(hex, t) { return mix(hex, '#000000', t); }

  function leagueColor(key) {
    return (LEAGUES[key] || LEAGUES.clay).color;
  }

  /* Gradient stops: lighter top -> base -> darker bottom. */
  function leagueStops(key) {
    // Plasma: white-hot core igniting into crimson fire
    if (key === 'plasma') return ['#FFF3C4', '#FF7B2E', '#C6160D'];
    if (key === 'bloodsteel') return ['#C4CAD2', '#B56A6E', '#96343B']; // silver bleeding into red
    var base = leagueColor(key);
    // Magma: glowing crust over dark red.
    if (key === 'magma') return ['#F07A6E', '#D22730', '#7E1218'];
    return [lighten(base, 0.34), base, darken(base, 0.34)];
  }

  var PLATE = ['#31343B', '#1F2126', '#141519']; // dark steel plate

  /* ---------- geometry helpers ---------- */

  /* Number formatter: 2-decimal, never NaN/exponent for our ranges. */
  function n(v) {
    return String(Math.round(v * 100) / 100);
  }

  /* Heraldic shield, pointed bottom, in a 64x64 viewBox. */
  var SHIELD = 'M11 4.5H53V31.5C53 45 44 55 32 60C20 55 11 45 11 31.5Z';

  /* Chevron pointing UP: apex at (32, cy). */
  function chevronD(cy, w, drop, t) {
    return 'M' + n(32 - w) + ' ' + n(cy + drop) +
           'L32 ' + n(cy) +
           'L' + n(32 + w) + ' ' + n(cy + drop) +
           'L' + n(32 + w) + ' ' + n(cy + drop + t) +
           'L32 ' + n(cy + t) +
           'L' + n(32 - w) + ' ' + n(cy + drop + t) + 'Z';
  }

  /* Rocker: shallow downward arc band, ends at (32±w, cy). */
  function rockD(cy, w, t, bow) {
    return 'M' + n(32 - w) + ' ' + n(cy) +
           'Q32 ' + n(cy + 2 * bow) + ' ' + n(32 + w) + ' ' + n(cy) +
           'L' + n(32 + w) + ' ' + n(cy + t) +
           'Q32 ' + n(cy + 2 * bow + t) + ' ' + n(32 - w) + ' ' + n(cy + t) + 'Z';
  }

  /* Lozenge (diamond), slightly narrow. */
  function lozD(cx, cy, r) {
    return 'M' + n(cx) + ' ' + n(cy - r) +
           'L' + n(cx + r * 0.85) + ' ' + n(cy) +
           'L' + n(cx) + ' ' + n(cy + r) +
           'L' + n(cx - r * 0.85) + ' ' + n(cy) + 'Z';
  }

  /* Five-point star, point up. */
  function starD(cx, cy, r) {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var rr = (i % 2 === 0) ? r : r * 0.44;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      pts.push(n(cx + rr * Math.cos(a)) + ' ' + n(cy + rr * Math.sin(a)));
    }
    return 'M' + pts.join('L') + 'Z';
  }

  /* Vertical bar centered on cx (absolute coords, checker-friendly). */
  function barD(cx, y, w, h) {
    var x0 = cx - w / 2, x1 = cx + w / 2;
    return 'M' + n(x0) + ' ' + n(y) +
           'L' + n(x1) + ' ' + n(y) +
           'L' + n(x1) + ' ' + n(y + h) +
           'L' + n(x0) + ' ' + n(y + h) + 'Z';
  }

  /* Simplified wreath: two small arcs flanking a star (stroke-only). */
  function wreathX(cy, r) {
    var ox = r + 3.4, bow = 3.0, half = r + 1.6;
    var L = 'M' + n(32 - ox) + ' ' + n(cy + half) +
            'Q' + n(32 - ox - bow) + ' ' + n(cy) + ' ' + n(32 - ox) + ' ' + n(cy - half);
    var R = 'M' + n(32 + ox) + ' ' + n(cy + half) +
            'Q' + n(32 + ox + bow) + ' ' + n(cy) + ' ' + n(32 + ox) + ' ' + n(cy - half);
    return '<path d="' + L + R + '" fill="none" stroke="url(#@G@)" stroke-width="1.6" stroke-linecap="round"/>';
  }

  /* Rotate points about (cx, cy) by deg; returns a closed path. */
  function polyD(pts, deg, cx, cy) {
    var a = (deg || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return 'M' + pts.map(function (p) {
      var dx = p[0] - cx, dy = p[1] - cy;
      return n(cx + dx * c - dy * s) + ' ' + n(cy + dx * s + dy * c);
    }).join('L') + 'Z';
  }

  /* Upright sword centered on x=32: tip at y, blade length len. */
  function swordPts(y, len, bw, gw) {
    var b = y + len;                         // blade base
    return [
      [32, y], [32 + bw, y + 3], [32 + bw, b], [32 + gw, b], [32 + gw, b + 2],
      [33.1, b + 2], [33.1, b + 6], [34.2, b + 7.2], [32, b + 9], [29.8, b + 7.2],
      [30.9, b + 6], [30.9, b + 2], [32 - gw, b + 2], [32 - gw, b], [32 - bw, b],
      [32 - bw, y + 3]
    ];
  }

  /* Laurel leaf: narrow lozenge at (cx, cy) along angle deg. */
  function leafD(cx, cy, len, w, deg) {
    return polyD([[cx, cy - len / 2], [cx + w / 2, cy], [cx, cy + len / 2], [cx - w / 2, cy]], deg, cx, cy);
  }

  /* Laurel wreath: two branches of leaves rising from the bottom of a circle. */
  function laurelD(cx, cy, r, count, step) {
    var d = '';
    count = count || 6; step = step || 21;
    for (var side = -1; side <= 1; side += 2) {
      for (var i = 0; i < count; i++) {
        var phi = 28 + i * step;                // degrees up from the bottom
        var a = phi * Math.PI / 180;
        var x = cx + side * r * Math.sin(a), y = cy + r * Math.cos(a);
        d += leafD(x, y, 6.2, 2.7, side * (90 - phi) + side * 22);
      }
    }
    return d;
  }

  /* Sun rays fanning from (cx, cy) between angles a0..a1 (degrees, 270 = up),
     alternating long and short. */
  function raysD(cx, cy, r0, rLong, rShort, a0, a1, count) {
    var d = '';
    for (var i = 0; i < count; i++) {
      var a = (a0 + (a1 - a0) * i / (count - 1)) * Math.PI / 180;
      var r1 = i % 2 === 0 ? rLong : rShort, hw = 0.15;
      d += 'M' + n(cx + r0 * Math.cos(a - hw)) + ' ' + n(cy + r0 * Math.sin(a - hw)) +
           'L' + n(cx + r1 * Math.cos(a)) + ' ' + n(cy + r1 * Math.sin(a)) +
           'L' + n(cx + r0 * Math.cos(a + hw)) + ' ' + n(cy + r0 * Math.sin(a + hw)) + 'Z';
    }
    return d;
  }

  /* A device drawn on top of other metal: engraved shadow, metal fill,
     and a dark outline so it separates from what sits behind it. */
  function overlay(d) {
    return '<path d="' + d + '" transform="translate(0 0.9)" fill="rgba(0,0,0,0.55)"/>' +
           '<path d="' + d + '" fill="url(#@G@)" stroke="rgba(8,9,11,0.85)" stroke-width="1.3" stroke-linejoin="round"/>';
  }

  /* Small dark inset dot (crown jewels). */
  function dotX(cx, cy, r) {
    return '<circle cx="' + n(cx) + '" cy="' + n(cy) + '" r="' + n(r) + '" fill="rgba(8,9,11,0.7)"/>';
  }

  /* Horned war helm: dome, brow, nose guard, cheek guards, two upswept horns. */
  var HELM =
    'M25.8 41C25.8 32 28.4 27 32 26.6C35.6 27 38.2 32 38.2 41L38.2 45L35.6 45L35.6 40.8' +
    'L33.1 40.8L33.1 46L30.9 46L30.9 40.8L28.4 40.8L28.4 45L25.8 45Z' +
    'M28.8 27.6C25.2 26.6 24.4 22.4 26.4 17.2C26.9 21 28.6 23.6 30.8 25.3Z' +
    'M35.2 27.6C38.8 26.6 39.6 22.4 37.6 17.2C37.1 21 35.4 23.6 33.2 25.3Z';

  /* Filled circle as an absolute-coordinate path. */
  function orbD(cx, cy, r) {
    return 'M' + n(cx - r) + ' ' + n(cy) + 'A' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(cx + r) + ' ' + n(cy) +
           'A' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(cx - r) + ' ' + n(cy) + 'Z';
  }

  /* Five-point crown with orb tips and a jeweled band. */
  var CROWN =
    'M22 43L22 37.5L19.8 27.5L26 32.5L32 23.5L38 32.5L44.2 27.5L42 37.5L42 43Z' +
    orbD(19.8, 27.5, 1.9) + orbD(32, 22.6, 2) + orbD(44.2, 27.5, 1.9);

  /* ---------- fixed officer paths (centered ~ (32, 31.5)) ---------- */

  /* Simplified 5-lobe oak leaf with stem. */
  var LEAF =
    'M32 15.5Q36 18.5 36.5 22Q41 20 45 23Q43.5 27 37.5 28Q43 30 44 35' +
    'Q39.5 37 35.5 35.5Q35 39.5 33.5 42.5L33 47.5L31 47.5L30.5 42.5' +
    'Q29 39.5 28.5 35.5Q24.5 37 20 35Q21 30 26.5 28Q20.5 27 19 23' +
    'Q23 20 27.5 22Q28 18.5 32 15.5Z';
  var MIDRIB = 'M32 19L32 43';

  /* Spread eagle simplified to a 3-point winged mark:
     two upswept wing tips + head bump, tapering to a tail. */
  var EAGLE =
    'M15 22C21 20.5 27 21.5 30 24.5Q31 22.5 32 22Q33 22.5 34 24.5' +
    'C37 21.5 43 20.5 49 22C46 27.5 40.5 31 36 32' +
    'C37.5 36 35.5 40.5 32 43C28.5 40.5 26.5 36 28 32' +
    'C23.5 31 18 27.5 15 22Z';

  /* ---------- enlisted (chevron/rocker) builder ---------- */

  var ENLISTED = {
    1:  { ch: 1, slim: true },                        // Private
    2:  { ch: 1 },                                    // PFC
    3:  { ch: 1, rock: 1 },                           // Trooper
    4:  { ch: 2 },                                    // Corporal
    5:  { ch: 3 },                                    // Gunner
    6:  { ch: 3, tight: true },                       // Sharpshooter
    7:  { ch: 3, rock: 1 },                           // Pathfinder
    8:  { ch: 3, rock: 2 },                           // Ranger
    9:  { ch: 3, rock: 2, loz: true },                // Raider
    10: { ch: 3, rock: 2, star: true },               // Commando
    11: { ch: 3, rock: 2, star: true, wreath: true }  // Shock Trooper
  };

  function enlisted(spec) {
    var w = 12.5, drop = 7,
        t = spec.slim ? 3.4 : (spec.tight ? 4.2 : 4.8),
        off = spec.tight ? t + 1.4 : t + 2.4,
        gap = 3, lozR = 4.5, starR = 4.9,
        rockT = 3.6, bow = 4.2, rockGap = 2.6;
    var nCh = spec.ch || 0, nRk = spec.rock || 0;

    function stackH() {
      var hCh = nCh ? (nCh - 1) * off + drop + t : 0;
      var hCtr = spec.loz ? lozR * 2 : (spec.star ? starR * 2 : 0);
      var hRk = nRk ? (nRk - 1) * (rockT + rockGap) + rockT + bow : 0;
      return hCh + (hCtr ? gap + hCtr : 0) + (nRk ? gap + hRk : 0);
    }

    var H = stackH();
    if (H > 43) {                       // compress tall stacks to fit the shield
      var s = 43 / H, cs = (1 + s) / 2; // gentler shrink for centerpiece + widths
      drop *= s; t *= s; off *= s; gap *= s;
      rockT *= s; bow *= s; rockGap *= s;
      lozR *= cs; starR *= cs; w *= cs;
      H = stackH();
    }

    var y = Math.max(9.5, 31.5 - H / 2), d = '', x = '';
    for (var i = 0; i < nCh; i++) d += chevronD(y + i * off, w, drop, t);
    y += nCh ? (nCh - 1) * off + drop + t : 0;

    var hCtr = spec.loz ? lozR * 2 : (spec.star ? starR * 2 : 0);
    if (hCtr) {
      y += gap;
      var cy = y + hCtr / 2;
      if (spec.loz) {
        d += lozD(32, cy, lozR);
      } else {
        d += starD(32, cy, starR);
        if (spec.wreath) x = wreathX(cy, starR);
      }
      y += hCtr;
    }

    if (nRk) {
      y += gap;
      for (var j = 0; j < nRk; j++) {
        d += rockD(y + j * (rockT + rockGap), w * (j ? 0.8 : 0.94), rockT, bow);
      }
    }
    return { d: d, x: x };
  }

  /* ---------- device dispatch (rankIndex 0..22) ---------- */

  function device(ri) {
    if (ri === 0) { // Recruit: blank engraved disc
      return {
        d: '',
        x: '<circle cx="32" cy="31.5" r="9" fill="rgba(0,0,0,0.35)" stroke="url(#@G@)" stroke-width="1.6"/>' +
           '<circle cx="32" cy="31.5" r="5.2" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>'
      };
    }
    if (ri <= 11) return enlisted(ENLISTED[ri]);
    switch (ri) {
      case 12: // Second Lieutenant: 1 vertical bar
        return { d: barD(32, 20, 7, 23), x: '' };
      case 13: // First Lieutenant: bar with border detail
        return {
          d: barD(32, 20, 7, 23),
          x: '<path d="M30.3 21.8L33.7 21.8L33.7 41.2L30.3 41.2Z" fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="1"/>'
        };
      case 14: // Captain: 2 bars
        return { d: barD(25.6, 20.5, 6.2, 22) + barD(38.4, 20.5, 6.2, 22), x: '' };
      case 15: // Major: oak leaf
        return {
          d: LEAF,
          x: '<path d="' + MIDRIB + '" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="1.1"/>'
        };
      case 16: // Lieutenant Colonel: oak leaf outlined
        return {
          d: '',
          x: '<path d="' + LEAF + '" transform="translate(0 0.9)" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="1.8"/>' +
             '<path d="' + LEAF + '" fill="none" stroke="url(#@G@)" stroke-width="1.8" stroke-linejoin="round"/>' +
             '<path d="' + MIDRIB + '" fill="none" stroke="url(#@G@)" stroke-width="1"/>'
        };
      case 17: // Colonel: spread eagle (3-point winged mark)
        return { d: EAGLE, x: '' };
      case 18: // Brigadier General: 1 star
        return { d: starD(32, 31.5, 8.4), x: '' };
      case 19: // Major General: 2 stars
        return { d: starD(24.4, 31.5, 6.3) + starD(39.6, 31.5, 6.3), x: '' };
      case 20: // Lieutenant General: 3 stars
        return { d: starD(20, 31.5, 5.2) + starD(32, 31.5, 5.2) + starD(44, 31.5, 5.2), x: '' };
      case 21: // General: 4 stars
        return {
          d: starD(17.6, 31.5, 4.5) + starD(27.2, 31.5, 4.5) +
             starD(36.8, 31.5, 4.5) + starD(46.4, 31.5, 4.5),
          x: ''
        };
      case 22: // General of the Army: 5 stars in an arc
        return {
          d: starD(17, 36.2, 4.1) + starD(24.2, 30.4, 4.1) + starD(32, 28, 4.1) +
             starD(39.8, 30.4, 4.1) + starD(47, 36.2, 4.1),
          x: ''
        };
      case 23: // Warlord: horned war helm over crossed swords, 5-star arc above
        return {
          d: starD(19.5, 16, 2.8) + starD(25.5, 12.6, 2.8) + starD(32, 11.4, 2.8) +
             starD(38.5, 12.6, 2.8) + starD(44.5, 16, 2.8) +
             polyD(swordPts(23, 21, 2, 5.4), -50, 32, 44) +
             polyD(swordPts(23, 21, 2, 5.4), 50, 32, 44),
          x: overlay(HELM) +
             '<path d="M26.2 35.6L37.8 35.6" stroke="rgba(8,9,11,0.6)" stroke-width="1"/>'
        };
      case 24: // God of War: radiant crown inside a laurel wreath
        return {
          d: raysD(32, 36, 13, 21, 17.5, 212, 328, 9) + laurelD(32, 35, 16.5, 4, 22),
          x: overlay(CROWN) +
             '<path d="M22.4 37.6L41.6 37.6" stroke="rgba(8,9,11,0.6)" stroke-width="1"/>' +
             dotX(26.5, 40.3, 1.1) + dotX(32, 40.3, 1.3) + dotX(37.5, 40.3, 1.1)
        };
    }
    return { d: '', x: '' };
  }

  /* ---------- svg assembly ---------- */

  var UID = 0;

  function grad(id, stops) {
    return '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
           '<stop offset="0" stop-color="' + stops[0] + '"/>' +
           '<stop offset="0.55" stop-color="' + stops[1] + '"/>' +
           '<stop offset="1" stop-color="' + stops[2] + '"/>' +
           '</linearGradient>';
  }

  function svg(rankIndex, leagueKey, sizePx) {
    var ri = Math.floor(Number(rankIndex));
    if (!isFinite(ri)) ri = 0;
    ri = Math.max(0, Math.min(RANKS.length - 1, ri));
    var lk = LEAGUES[leagueKey] ? leagueKey : 'clay';
    var size = Number(sizePx);
    if (!isFinite(size) || size <= 0) size = 40;

    var uid = ++UID;
    var gid = 'insG' + uid;  // league metal gradient (border + devices)
    var pid = 'insP' + uid;  // steel plate gradient

    var o = '<svg xmlns="http://www.w3.org/2000/svg" width="' + n(size) + '" height="' + n(size) +
            '" viewBox="0 0 64 64" role="img" aria-label="' + RANKS[ri] + ' insignia, ' +
            LEAGUES[lk].name + ' league">';
    o += '<defs>' + grad(gid, leagueStops(lk)) + grad(pid, PLATE) + '</defs>';

    // Shield plate + league-gradient border.
    o += '<path d="' + SHIELD + '" fill="url(#' + pid + ')" stroke="url(#' + gid + ')" stroke-width="2.5" stroke-linejoin="round"/>';
    // Inner bevel line for engraved depth.
    o += '<path d="' + SHIELD + '" transform="translate(2.56 2.58) scale(0.92)" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>';

    var parts = device(ri);
    if (parts.d) {
      // Engraved effect: dark drop copy beneath the metal fill.
      o += '<path d="' + parts.d + '" transform="translate(0 0.9)" fill="rgba(0,0,0,0.5)"/>';
      o += '<path d="' + parts.d + '" fill="url(#' + gid + ')" stroke="rgba(8,9,11,0.5)" stroke-width="0.5" stroke-linejoin="round"/>';
    }
    if (parts.x) o += parts.x.split('@G@').join(gid);

    return o + '</svg>';
  }

  var Insignia = {
    svg: svg,
    leagueColor: leagueColor,
    leagueStops: leagueStops,
    LEAGUES: LEAGUES,
    RANKS: RANKS
  };

  /* ---------- export / node self-check ---------- */

  if (typeof window !== 'undefined') {
    window.Insignia = Insignia;
  } else {
    // Node: expose globally (for external harnesses) and self-check when run directly.
    if (typeof globalThis !== 'undefined') globalThis.Insignia = Insignia;
    if (typeof process !== 'undefined' && process.argv && process.argv[1] &&
        /insignia\.js$/.test(process.argv[1])) {
      selfCheck();
    }
  }

  function selfCheck() {
    var leagues = Object.keys(LEAGUES);
    var sizes = [18, 40, 64];
    var fails = [];
    var allIds = {};
    var count = 0;

    if (RANKS.length !== 25) fails.push('RANKS length ' + RANKS.length + ' !== 25');
    if (leagues.length !== 9) fails.push('LEAGUES length ' + leagues.length + ' !== 9');
    leagues.forEach(function (k) {
      if (!/^#[0-9A-F]{6}$/i.test(leagueColor(k))) fails.push('leagueColor(' + k + ') not hex: ' + leagueColor(k));
    });

    for (var ri = 0; ri < RANKS.length; ri++) {
      for (var li = 0; li < leagues.length; li++) {
        for (var si = 0; si < sizes.length; si++) {
          var lk = leagues[li], size = sizes[si];
          var label = 'rank ' + ri + ' / ' + lk + ' / ' + size + 'px';
          var s = svg(ri, lk, size);
          count++;

          if (s.indexOf('<svg') !== 0 || s.slice(-6) !== '</svg>') fails.push(label + ': not an <svg>...</svg> string');
          if (/NaN|Infinity|undefined/.test(s)) fails.push(label + ': contains NaN/Infinity/undefined');
          if ((s.match(/</g) || []).length !== (s.match(/>/g) || []).length) fails.push(label + ': unbalanced angle brackets');
          if (s.split('"').length % 2 === 0) fails.push(label + ': unbalanced quotes');

          // every coordinate in path data must be finite and inside the viewBox (with stroke margin)
          var ds = s.match(/ d="[^"]*"/g) || [];
          for (var di = 0; di < ds.length; di++) {
            var nums = ds[di].match(/-?\d+(?:\.\d+)?/g) || [];
            for (var ni = 0; ni < nums.length; ni++) {
              var f = parseFloat(nums[ni]);
              if (!isFinite(f) || f < -1 || f > 70) fails.push(label + ': coord out of range: ' + nums[ni]);
            }
          }

          // gradient ids must be globally unique across calls
          var ids = s.match(/id="[^"]+"/g) || [];
          for (var ii = 0; ii < ids.length; ii++) {
            if (allIds[ids[ii]]) fails.push(label + ': duplicate id ' + ids[ii]);
            allIds[ids[ii]] = 1;
          }

          // device presence
          if (ri === 0 && (s.match(/<circle/g) || []).length < 2) fails.push(label + ': recruit disc missing');
          if (ri > 0 && (s.match(/<path/g) || []).length < 4) fails.push(label + ': device paths missing');
          if (lk === 'bloodsteel' && s.indexOf('#C4CAD2') === -1) fails.push(label + ': bloodsteel silver stop missing');
          if (lk === 'plasma' && s.indexOf('#FFF3C4') === -1) fails.push(label + ': plasma white-hot stop missing');
        }
      }
    }

    // fallback behavior must never throw or emit junk
    var weird = [svg(-5, 'nope', 18), svg(99, undefined, 0), svg('x', 'magma', 64)];
    for (var wi = 0; wi < weird.length; wi++) {
      if (/NaN|Infinity|undefined/.test(weird[wi])) fails.push('fallback call ' + wi + ' emitted junk');
    }

    if (fails.length) {
      console.error('INSIGNIA SELF-CHECK FAILED (' + fails.length + '):');
      fails.slice(0, 40).forEach(function (f) { console.error('  - ' + f); });
      if (typeof process !== 'undefined') process.exitCode = 1;
    } else {
      console.log('insignia self-check OK: ' + count + ' svgs (' + RANKS.length + ' ranks x ' + leagues.length + ' leagues x ' + sizes.length +
                  ' sizes), ' + Object.keys(allIds).length + ' unique gradient ids, all coords finite and in-viewBox, ' +
                  'bloodsteel + plasma ramps present, fallback calls clean.');
    }
  }
})();
