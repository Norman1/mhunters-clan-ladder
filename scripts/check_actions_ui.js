// Opt-in browser regression check: node scripts/check_actions_ui.js
// Uses installed Playwright Chromium or Windows Edge. Every request is served
// from local files/fixtures or blocked; window.open only records prepared URLs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://ladder.test';
const player = { name: 'Marcus Aurelius', elo: 1000, game_cap: 2, missed_games: 0, in_clan: false, guest: true };
const players = {
    '33160357416': player,
    '12345678901': { ...player, game_cap: 0 },
    '222': { name: 'Clan Member', elo: 1000, game_cap: 2, missed_games: 0, in_clan: true }
};
const fixtures = { 'players.json': players, 'history.json': [], 'active_games.json': [],
    'templates.json': [{ id: 1, name: 'Map' }] };
let checks = 0;
function equal(actual, expected, message) {
    assert.deepEqual(actual, expected, message);
    checks++;
}

async function pageFor(browser, width = 1280, playerData = players, failData = false) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        window.preparedIssues = [];
        window.open = (url, target, features) => window.preparedIssues.push({ url, target, features });
    });
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) return route.abort();
        const name = path.basename(url.pathname);
        if (Object.hasOwn(fixtures, name)) {
            if (failData) return route.fulfill({ status: 503, body: 'Unavailable' });
            return route.fulfill({ contentType: 'application/json',
                body: JSON.stringify(name === 'players.json' ? playerData : fixtures[name]) });
        }
        const file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(ROOT + path.sep)) return route.abort();
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
        try {
            return await route.fulfill({ body: fs.readFileSync(file),
                contentType: mime[path.extname(file)] || 'application/octet-stream' });
        } catch { return route.fulfill({ status: 404, body: '' }); }
    });
    await page.goto(ORIGIN + '/actions.html');
    return { page, errors };
}

async function lastTitle(page) {
    const opened = await page.evaluate(() => window.preparedIssues.at(-1));
    const url = new URL(opened.url);
    equal(url.origin + url.pathname, 'https://github.com/Norman1/mhunters-clan-ladder/issues/new', 'correct issue destination');
    equal(opened.target, '_blank');
    equal(opened.features, 'noopener');
    return url.searchParams.get('title');
}

async function main() {
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
        (fs.existsSync(chromium.executablePath()) ? chromium.executablePath() :
            (process.platform === 'win32' && fs.existsSync(edge) ? edge : undefined));
    const browser = await chromium.launch({ headless: true, executablePath });
    try {
        for (const width of [1280, 390]) {
            const { page, errors } = await pageFor(browser, width);
            equal(await page.locator('#form-join, #form-rmplayer').count(), 0, 'obsolete forms removed');
            equal(await page.locator('form').count(), 5, 'only supported forms remain');
            equal(await page.locator('#guest-title').innerText(), 'ADD GUEST PLAYER');
            equal(await page.locator('#revoke-title').innerText(), 'REMOVE GUEST PLAYER');
            equal(await page.locator('#guest-cap').inputValue(), '2', 'guest default cap');
            equal(await page.locator('#guest-submit').isDisabled(), true);
            await page.locator('#guest-id').fill('bad');
            await page.locator('#guest-name').fill('Friend');
            equal(await page.locator('#guest-submit').isDisabled(), true, 'bad ID blocked');
            await page.locator('#guest-id').fill('12345678903');
            await page.locator('#guest-name').fill('   ');
            equal(await page.locator('#guest-submit').isDisabled(), true, 'empty name blocked');
            await page.locator('#guest-name').fill('A & B <friend> ♦');
            for (const cap of ['0', '1', '2', '3']) {
                await page.locator('#guest-cap').selectOption(cap);
                equal(await page.locator('#guest-submit').isEnabled(), true);
                await page.locator('#guest-submit').click();
                equal(await lastTitle(page), `AdmitGuest: 12345678903 Cap: ${cap} Name: A & B <friend> ♦`, 'encoded guest title');
            }
            await page.locator('#guest-cap').evaluate(el => { el.value = ''; el.dispatchEvent(new Event('change')); });
            equal(await page.locator('#guest-submit').isDisabled(), true, 'invalid cap blocked');

            await page.locator('#revoke-player').fill('222');
            await page.locator('#revoke-msg').filter({ hasText: 'NO MATCHING GUEST' }).waitFor();
            await page.locator('#revoke-confirm').fill('REMOVE');
            equal(await page.locator('#revoke-submit').isDisabled(), true, 'ordinary member blocked');
            await page.locator('#revoke-player').fill('99999999');
            equal(await page.locator('#revoke-submit').isDisabled(), true, 'unknown ID blocked');
            await page.locator('#revoke-player').fill('Marcus');
            await page.locator('#revoke-picks .pick').first().waitFor();
            equal(await page.locator('#revoke-picks .pick').count(), 2, 'ambiguous guest name requires choice');
            equal(await page.locator('#revoke-submit').isDisabled(), true);
            await page.locator('#revoke-picks .pick').filter({ hasText: '33160357416' }).click();
            equal(await page.locator('#revoke-confirm').inputValue(), '', 'selection resets confirmation');
            await page.locator('#revoke-confirm').fill('REMOV');
            equal(await page.locator('#revoke-submit').isDisabled(), true, 'full confirmation required');
            await page.locator('#revoke-confirm').fill('REMOVE');
            equal(await page.locator('#revoke-submit').isEnabled(), true);
            await page.locator('#revoke-submit').click();
            equal(await lastTitle(page), 'RevokeGuest: 33160357416', 'removal revokes admission');
            await page.locator('#revoke-player').fill('12345678901');
            equal(await page.locator('#revoke-confirm').inputValue(), '', 'switching guests clears confirmation');
            equal(await page.locator('#revoke-submit').isDisabled(), true);

            await page.locator('#cap-player').fill('33160357416');
            await page.locator('#cap-chip').waitFor();
            await page.locator('#cap-select').selectOption('0');
            await page.locator('#cap-submit').click();
            equal(await lastTitle(page), 'Update: 33160357416 Cap: 0', 'pause only changes cap');
            equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
            equal(errors, [], 'no obsolete DOM bindings or runtime errors');
            if (process.env.ACTIONS_SCREENSHOT_DIR) {
                await page.goto(ORIGIN + '/actions.html');
                await page.evaluate(() => window.scrollTo(0, 0));
                await page.screenshot({ path: path.join(process.env.ACTIONS_SCREENSHOT_DIR, `actions-${width}.png`), fullPage: true });
            }
            await page.close();
        }

        for (const failData of [false, true]) {
            const { page, errors } = await pageFor(browser, 390, { 222: players['222'] }, failData);
            await page.locator('#revoke-player').fill('33160357416');
            await page.locator('#revoke-msg').filter({ hasText: failData ? 'UNAVAILABLE' : 'NO MATCHING GUEST' }).waitFor();
            await page.locator('#revoke-confirm').fill('REMOVE');
            equal(await page.locator('#revoke-submit').isDisabled(), true, 'no numeric fallback when guest list missing/empty');
            equal(await page.evaluate(() => window.preparedIssues.length), 0);
            equal(errors, []);
            await page.close();
        }
        console.log(`PASS: ${checks} browser checks; desktop/mobile forms, issue URLs, pause and safe guest selection`);
    } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
