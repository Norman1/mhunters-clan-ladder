/* Capture card art for pool templates that are missing assets/maps/<id>.jpg.
   Logs into war.app (WZ_EMAIL / WZ_PASSWORD env vars), opens one rendered
   game per artless template (finished games from history, or active games
   already past the lobby), hides the game UI, clip-shoots the board canvas,
   and trims the black margins. Templates with no renderable game yet are
   skipped and picked up on a later run.
   Usage: node scripts/capture_map_art.js  (run from the repo root) */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'assets', 'maps');

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
}

/* canonical id resolution (mirrors the site's derive.js) */
function buildResolver(templates) {
  const legacy = {};
  for (const t of templates) {
    (t.legacy_ids || []).forEach(lid => { legacy[String(lid)] = String(t.id); });
  }
  return raw => legacy[String(raw)] || String(raw);
}

(async () => {
  const email = process.env.WZ_EMAIL;
  const pass = process.env.WZ_PASSWORD;
  if (!email || !pass) { console.error('WZ_EMAIL / WZ_PASSWORD not set'); process.exit(1); }

  const templates = loadJSON('data/templates.json');
  const history = loadJSON('data/history.json');
  const active = loadJSON('data/active_games.json');
  const resolve = buildResolver(templates);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const missing = templates.filter(t => !fs.existsSync(path.join(OUT_DIR, t.id + '.jpg')));
  if (!missing.length) { console.log('all pool templates have art — nothing to do'); return; }

  // one renderable game per artless template: finished first, else active
  // games that are past the lobby (game_state present = joined/playing)
  const gameFor = {};
  for (const g of history) {
    if (g.p1_id && g.winner_id) {
      const tid = resolve(g.template_id);
      if (!gameFor[tid]) gameFor[tid] = g.game_id;
    }
  }
  for (const g of active) {
    const tid = resolve(g.template_id);
    if (!gameFor[tid] && g.game_state != null) gameFor[tid] = g.game_id;
  }

  const targets = missing
    .map(t => ({ id: String(t.id), name: t.name, gameId: gameFor[String(t.id)] }))
    .filter(t => {
      if (!t.gameId) console.log('no renderable game yet for', t.id, t.name, '— will retry on a later run');
      return !!t.gameId;
    });
  if (!targets.length) { console.log('no capturable templates this run'); return; }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1600,1100'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1100 });
  // a real-browser UA: the default headless UA advertises HeadlessChrome,
  // which login pages are far more likely to block from a datacenter IP
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');

  // ---- debug: verify the secrets CI received match the local values ----
  // (fingerprints come in as dispatch inputs; only match booleans are logged)
  if (process.env.PW_FP || process.env.EMAIL_FP) {
    const crypto = require('crypto');
    const fp = v => crypto.createHash('sha256').update(v || '').digest('hex');
    if (process.env.PW_FP) console.log('debug pw match:', fp(pass) === process.env.PW_FP, '(len ' + (pass || '').length + ')');
    if (process.env.EMAIL_FP) console.log('debug email match:', fp(email) === process.env.EMAIL_FP);
  }

  // ---- login ----
  await page.goto('https://www.warzone.com/LogIn', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500));
  const passSel = 'input[type="password"]';
  await page.waitForSelector(passSel, { timeout: 15000 });
  await page.type('input[type="email"], input[name*="mail" i], input[placeholder*="mail" i]', email, { delay: 25 });
  await page.type(passSel, pass, { delay: 25 });
  const clicked = await page.evaluate(() => {
    const pw = document.querySelector('input[type="password"]');
    const scope = pw.closest('form') || pw.closest('div[class]')?.parentElement || document;
    const btns = [...scope.querySelectorAll('button, input[type="submit"]')];
    const b = btns.find(el => /sign\s*in/i.test(el.textContent || el.value || '') && el.offsetParent !== null)
      || btns.find(el => el.offsetParent !== null);
    if (b) { b.click(); return true; }
    return false;
  });
  if (!clicked) { await page.focus(passSel); await page.keyboard.press('Enter'); }
  await new Promise(r => setTimeout(r, 6000));
  const signedIn = await page.evaluate(() => /signed in as|sign out/i.test(document.body.innerText));
  if (!signedIn) {
    // say WHY: bot-challenge text, "wrong password", maintenance page, etc.
    const diag = await page.evaluate(() =>
      document.body.innerText.slice(0, 400).replace(/\n+/g, ' | '));
    console.error('login failed. page says:', diag || '(empty page)');
    await browser.close();
    process.exit(2);
  }
  console.log('logged in ok');

  let captured = 0;
  for (const t of targets) {
    try {
      await page.goto('https://www.warzone.com/MultiPlayer?GameID=' + t.gameId,
        { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 11000));
      const box = await page.evaluate(() => {
        const cands = [...document.querySelectorAll('canvas')]
          .filter(c => c.clientWidth > 500 && c.clientHeight > 300)
          .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
        if (!cands.length) return null;
        const board = cands[0];
        let node = board;
        while (node && node !== document.body) {
          const parent = node.parentElement;
          if (!parent) break;
          for (const sib of parent.children) {
            if (sib === node) continue;
            if (node === board && sib.tagName === 'CANVAS') continue;
            sib.style.visibility = 'hidden';
          }
          node = parent;
        }
        const r = board.getBoundingClientRect();
        return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height };
      });
      if (!box) { console.log('no board canvas for', t.id, t.name, '— skipped'); continue; }
      const out = path.join(OUT_DIR, t.id + '.jpg');
      await page.screenshot({ path: out, type: 'jpeg', quality: 82, clip: box });
      const buf = await sharp(out).trim({ threshold: 25 }).jpeg({ quality: 82 }).toBuffer();
      fs.writeFileSync(out, buf);
      captured++;
      console.log('captured', t.id, t.name);
    } catch (err) {
      console.log('ERROR on', t.id, t.name, '—', String(err.message).slice(0, 90));
    }
  }

  await browser.close();
  console.log('done —', captured, 'new map art file(s)');
})();
