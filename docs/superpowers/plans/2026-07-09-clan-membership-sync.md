# Clan Membership Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-enroll every M'Hunters clan member on the ladder, automatically deactivate players who leave the clan (voiding their active games), reactivate rejoiners, and retune the unreliable-player cooldown to 2 weeks/strike capped at 12.

**Architecture:** A new roster-sync step scrapes the clan page (`war.app/Clans/?ID=141`) with headless Chromium each engine run, diffs the roster against `players.json`, and applies enrollments/departures/rejoins before referee and matchmaker run. Single-player membership verification (for GitHub-issue signups) uses a plain HTTP fetch of the player's profile page. Pure logic (diff, circuit breaker, game voiding, cooldown) lives in small testable modules covered by `node:test`.

**Tech Stack:** Node.js 18+ (CI) / vanilla JS, Playwright (chromium), `node:test` built-in test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-07-09-clan-membership-sync-design.md`

---

## CRITICAL: Work in an isolated worktree

The main working tree at `/Users/cole/Documents/CodingProjects/MH Ladder/mhunters-clan-ladder` contains **intentionally uncommitted WIP** (template-settings popup feature) touching `app.js`, `scripts/api.js`, `scripts/issue_ops.js`, `style.css`, `template.html`, plus untracked files. **Never commit, stash, or revert those changes.**

Execute this plan in a fresh worktree (superpowers:using-git-worktrees):

```bash
cd "/Users/cole/Documents/CodingProjects/MH Ladder/mhunters-clan-ladder"
git fetch origin
git worktree add ../ladder-clan-sync -b clan-membership-sync origin/main
cd ../ladder-clan-sync
npm install
```

All file paths below are relative to the **worktree** root. The worktree's `app.js`/`issue_ops.js` are the clean committed versions — the code snippets below match them exactly.

Landing (last task) pushes `clan-membership-sync:main` to origin — the bot commits to `main` every 2 hours, so always `git fetch && git rebase origin/main` immediately before pushing. **Pushing to main requires explicit user approval — ask first.**

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/config.js` (new) | Shared constants: clan ID, war.app URL builders |
| `scripts/reliability.js` (new) | Strike threshold + cooldown formula (extracted from matchmaker for testability) |
| `scripts/clan_roster.js` (new) | Network layer: scrape clan roster (Playwright), fetch one player's clan (plain fetch) |
| `scripts/roster_sync.js` (new) | Pure diff/circuit-breaker/void logic + orchestration `main()` |
| `scripts/reliability.test.js`, `scripts/roster_sync.test.js` (new) | `node:test` suites for the pure logic |
| `scripts/matchmaker.js` | Use shared cooldown; exclude departed players |
| `scripts/issue_ops.js` | Verify clan membership on Signup; Remove becomes cap-0 opt-out |
| `app.js` | Hide departed players; treat `"Left Clan"` as void |
| `actions.html`, `help.html`, `README.md` | Copy for the new lifecycle |
| `.github/workflows/schedule.yml` | Install Chromium (cached), run roster sync before referee |
| `package.json` | Add `playwright`, add `test` script |

---

### Task 1: Config module, dependencies, test scaffolding

**Files:**
- Create: `scripts/config.js`
- Modify: `package.json`

- [ ] **Step 1: Create `scripts/config.js`**

```js
// Shared constants for the M'Hunters ladder backend.
const CLAN_ID = '141'; // M'Hunters clan on war.app

const clanPageUrl = (clanId = CLAN_ID) => `https://war.app/Clans/?ID=${clanId}`;
const profilePageUrl = (playerId) => `https://war.app/Profile?p=${playerId}`;

module.exports = { CLAN_ID, clanPageUrl, profilePageUrl };
```

- [ ] **Step 2: Add playwright dependency and test script to `package.json`**

Replace the whole file with (only `scripts.test` and `dependencies.playwright` change vs. committed):

```json
{
  "name": "vibe-clan-ladder",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "test": "node --test scripts/"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "description": "",
  "dependencies": {
    "dotenv": "^17.2.3",
    "playwright": "^1.49.0"
  }
}
```

- [ ] **Step 3: Install**

Run: `npm install && npx playwright install chromium`
Expected: installs without error (Chromium download ~150MB, one-time).

- [ ] **Step 4: Commit**

```bash
git add scripts/config.js package.json package-lock.json
git commit -m "feat: add config module, playwright dep, test scaffolding"
```

---

### Task 2: Cooldown retune + departed-player exclusion in matchmaker

**Files:**
- Create: `scripts/reliability.js`
- Create: `scripts/reliability.test.js`
- Modify: `scripts/matchmaker.js:9-11` (constants), `:38-45` (formula), `:128-154` (eligibility), `:214-217` (ranked list)

- [ ] **Step 1: Write the failing test — `scripts/reliability.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { getUnreliableCooldownMs, UNRELIABLE_STRIKE_THRESHOLD } = require('./reliability');

const WEEK = 7 * 24 * 60 * 60 * 1000;

test('cooldown is 2 weeks per strike above threshold, capped at 12', () => {
    assert.equal(getUnreliableCooldownMs(2), 2 * WEEK);
    assert.equal(getUnreliableCooldownMs(3), 4 * WEEK);
    assert.equal(getUnreliableCooldownMs(4), 6 * WEEK);
    assert.equal(getUnreliableCooldownMs(5), 8 * WEEK);
    assert.equal(getUnreliableCooldownMs(6), 10 * WEEK);
    assert.equal(getUnreliableCooldownMs(7), 12 * WEEK);
    assert.equal(getUnreliableCooldownMs(50), 12 * WEEK); // cap
});

test('threshold is exported and unchanged', () => {
    assert.equal(UNRELIABLE_STRIKE_THRESHOLD, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/reliability.test.js`
Expected: FAIL — `Cannot find module './reliability'`

- [ ] **Step 3: Create `scripts/reliability.js`**

```js
// Reliability (strike/cooldown) rules shared by matchmaker and docs.
const UNRELIABLE_STRIKE_THRESHOLD = 2;
const UNRELIABLE_MAX_COOLDOWN_WEEKS = 12;
const UNRELIABLE_WEEKS_PER_STRIKE = 2;
const UNRELIABLE_COOLDOWN_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getUnreliableCooldownMs(missedGames) {
    const weeks = Math.min(
        UNRELIABLE_MAX_COOLDOWN_WEEKS,
        UNRELIABLE_WEEKS_PER_STRIKE * Math.max(1, missedGames - (UNRELIABLE_STRIKE_THRESHOLD - 1))
    );

    return weeks * UNRELIABLE_COOLDOWN_WEEK_MS;
}

module.exports = { UNRELIABLE_STRIKE_THRESHOLD, getUnreliableCooldownMs };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/reliability.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire matchmaker to the shared module and exclude departed players**

In `scripts/matchmaker.js`:

(a) Replace lines 9–11 (the three `UNRELIABLE_*` constants) with:

```js
const { UNRELIABLE_STRIKE_THRESHOLD, getUnreliableCooldownMs } = require('./reliability');
```

(b) Delete the local `getUnreliableCooldownMs` function (lines 38–45 in the committed file — the block starting `function getUnreliableCooldownMs(missedGames) {`).

(c) In the eligibility loop, add a departed check as the first line of the callback. Change:

```js
    Object.entries(players).forEach(([id, p]) => {
        const missedGames = Number(p.missed_games) || 0;
```

to:

```js
    Object.entries(players).forEach(([id, p]) => {
        if (p.in_clan === false) return; // departed clan members never get games
        const missedGames = Number(p.missed_games) || 0;
```

(d) In the ranked-IDs computation, change:

```js
    const rankedIds = Object.entries(players)
        .filter(([, p]) => (Number(p.game_cap) || 0) > 0 && (Number(p.missed_games) || 0) < UNRELIABLE_STRIKE_THRESHOLD)
```

to:

```js
    const rankedIds = Object.entries(players)
        .filter(([, p]) => p.in_clan !== false && (Number(p.game_cap) || 0) > 0 && (Number(p.missed_games) || 0) < UNRELIABLE_STRIKE_THRESHOLD)
```

- [ ] **Step 6: Sanity-check matchmaker still parses**

Run: `node --check scripts/matchmaker.js`
Expected: no output (syntax OK)

- [ ] **Step 7: Commit**

```bash
git add scripts/reliability.js scripts/reliability.test.js scripts/matchmaker.js
git commit -m "feat: retune unreliable cooldown to 2wk/strike cap 12; exclude departed players from matchmaking"
```

---

### Task 3: Roster diff + circuit breaker (pure logic)

**Files:**
- Create: `scripts/roster_sync.js` (pure functions only in this task)
- Create: `scripts/roster_sync.test.js`

- [ ] **Step 1: Write the failing tests — `scripts/roster_sync.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { computeRosterDiff, shouldAbortSync } = require('./roster_sync');

const roster = [
    { id: '111', name: 'Alice' },
    { id: '222', name: 'Bobby' },   // renamed (was Bob)
    { id: '444', name: 'Newguy' },  // not registered yet
];

const players = {
    '111': { name: 'Alice', elo: 1100, game_cap: 2, missed_games: 0 },
    '222': { name: 'Bob', elo: 900, game_cap: 2, missed_games: 0 },
    '333': { name: 'Gone', elo: 1000, game_cap: 2, missed_games: 0 },              // left the clan
    '555': { name: 'Back', elo: 1050, game_cap: 1, missed_games: 3, in_clan: false }, // departed earlier, still gone
};

test('computeRosterDiff buckets new members, leavers, rejoiners, renames', () => {
    const diff = computeRosterDiff(roster, players);
    assert.deepEqual(diff.newMembers, [{ id: '444', name: 'Newguy' }]);
    assert.deepEqual(diff.leavers, ['333']);
    assert.deepEqual(diff.rejoiners, []);
    assert.deepEqual(diff.renames, [{ id: '222', name: 'Bobby' }]);
});

test('rejoiner detected when departed player is back in roster', () => {
    const diff = computeRosterDiff([...roster, { id: '555', name: 'Back' }], players);
    assert.deepEqual(diff.rejoiners, ['555']);
    assert.deepEqual(diff.leavers, ['333']);
});

test('already-departed player absent from roster is NOT a leaver again', () => {
    const diff = computeRosterDiff(roster, players);
    assert.ok(!diff.leavers.includes('555'));
});

test('null roster name does not produce a rename', () => {
    const diff = computeRosterDiff([{ id: '111', name: null }], { '111': { name: 'Alice' } });
    assert.deepEqual(diff.renames, []);
});

test('circuit breaker trips on empty roster', () => {
    assert.ok(shouldAbortSync([], players));
    assert.ok(shouldAbortSync(null, players));
});

test('circuit breaker trips when >20% of in-clan players would depart', () => {
    // 4 registered, 3 counted as in-clan ('555' already departed); 1 leaver of 3 = 33% > 20%
    assert.ok(shouldAbortSync(roster, players));
    // With the leaver also in the roster, nobody departs: no abort
    assert.equal(shouldAbortSync([...roster, { id: '333', name: 'Gone' }], players), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/roster_sync.test.js`
Expected: FAIL — `Cannot find module './roster_sync'`

- [ ] **Step 3: Create `scripts/roster_sync.js` with the pure functions**

```js
const fs = require('fs');
const path = require('path');

const PLAYERS_FILE = path.join(__dirname, '../data/players.json');
const ACTIVE_GAMES_FILE = path.join(__dirname, '../data/active_games.json');
const HISTORY_FILE = path.join(__dirname, '../data/history.json');

// Abort the sync if more than this fraction of registered in-clan players
// would be marked departed at once (guards against scrape breakage).
const MAX_DEPART_FRACTION = 0.2;

function loadJSON(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Diffs the scraped clan roster against the player registry.
 * @param {Array<{id: string, name: string|null}>} roster
 * @param {Object} players - players.json contents keyed by ID
 * @returns {{newMembers: Array, leavers: string[], rejoiners: string[], renames: Array}}
 */
function computeRosterDiff(roster, players) {
    const rosterById = new Map(roster.map(m => [String(m.id), m]));
    const newMembers = [];
    const leavers = [];
    const rejoiners = [];
    const renames = [];

    for (const member of roster) {
        if (!players[String(member.id)]) newMembers.push(member);
    }

    for (const [id, p] of Object.entries(players)) {
        const member = rosterById.get(String(id));
        const departed = p.in_clan === false;

        if (member && departed) rejoiners.push(id);
        if (!member && !departed) leavers.push(id);
        if (member && member.name && member.name !== p.name) {
            renames.push({ id, name: member.name });
        }
    }

    return { newMembers, leavers, rejoiners, renames };
}

/**
 * Returns a reason string if the sync must be aborted, else null.
 */
function shouldAbortSync(roster, players) {
    if (!roster || roster.length === 0) return 'roster scrape returned no members';

    const inClanCount = Object.values(players).filter(p => p.in_clan !== false).length;
    const { leavers } = computeRosterDiff(roster, players);

    if (inClanCount > 0 && leavers.length / inClanCount > MAX_DEPART_FRACTION) {
        return `would mark ${leavers.length} of ${inClanCount} registered players departed`;
    }

    return null;
}

module.exports = { computeRosterDiff, shouldAbortSync };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/roster_sync.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/roster_sync.js scripts/roster_sync.test.js
git commit -m "feat: roster diff and circuit-breaker logic"
```

---

### Task 4: Void departed players' active games

**Files:**
- Modify: `scripts/roster_sync.js` (add `voidLeaverGames`)
- Modify: `scripts/roster_sync.test.js` (add tests)

- [ ] **Step 1: Add failing tests to `scripts/roster_sync.test.js`**

Append:

```js
const { voidLeaverGames } = require('./roster_sync');

test('voidLeaverGames deletes lobby games, untracks in-progress, archives all as Left Clan', async () => {
    const activeGames = [
        { game_id: 1, created_at: 'c1', p1_id: '333', p2_id: '111', template_id: 9, game_state: 'WaitingForPlayers' },
        { game_id: 2, created_at: 'c2', p1_id: '111', p2_id: '333', template_id: 9, game_state: 'Playing' },
        { game_id: 3, created_at: 'c3', p1_id: '333', p2_id: '222', template_id: 9 }, // no state yet = lobby
        { game_id: 4, created_at: 'c4', p1_id: '111', p2_id: '222', template_id: 9, game_state: 'Playing' }, // no leaver
    ];
    const history = [];
    const deleted = [];
    const fakeDelete = async (id) => deleted.push(id);

    const remaining = await voidLeaverGames(['333'], activeGames, history, fakeDelete, 'NOW');

    assert.deepEqual(remaining.map(g => g.game_id), [4]);
    assert.deepEqual(deleted, [1, 3]); // only lobby games get API deletion
    assert.equal(history.length, 3);
    assert.ok(history.every(h => h.note === 'Left Clan' && h.finished_at === 'NOW'));
    assert.deepEqual(history.map(h => h.game_id), [1, 2, 3]);
});

test('voidLeaverGames survives a failing delete API call', async () => {
    const activeGames = [
        { game_id: 7, created_at: 'c', p1_id: '333', p2_id: '111', template_id: 9, game_state: 'WaitingForPlayers' },
    ];
    const history = [];
    const failingDelete = async () => { throw new Error('already deleted'); };

    const remaining = await voidLeaverGames(['333'], activeGames, history, failingDelete, 'NOW');

    assert.deepEqual(remaining, []);
    assert.equal(history.length, 1); // still archived as void
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test scripts/roster_sync.test.js`
Expected: 6 pass, 2 FAIL — `voidLeaverGames is not a function`

- [ ] **Step 3: Implement `voidLeaverGames` in `scripts/roster_sync.js`**

Add above `module.exports`:

```js
/**
 * Voids all active games involving departed players.
 * Lobby games are deleted via the API; in-progress games cannot be
 * force-ended, so they are just untracked. All are archived as void.
 * Does NOT strike or set last_opponent — the opponent did nothing wrong.
 * @returns remaining active games (leaver games removed). Mutates `history`.
 */
async function voidLeaverGames(leaverIds, activeGames, history, deleteGameFn, nowIso) {
    const leaverSet = new Set(leaverIds.map(String));
    const remaining = [];

    for (const game of activeGames) {
        const hasLeaver = leaverSet.has(String(game.p1_id)) || leaverSet.has(String(game.p2_id));
        if (!hasLeaver) {
            remaining.push(game);
            continue;
        }

        const inLobby = !game.game_state || game.game_state === 'WaitingForPlayers';
        if (inLobby) {
            try {
                await deleteGameFn(game.game_id);
            } catch (e) {
                console.error(`Failed to delete game ${game.game_id} (may already be gone): ${e.message}`);
            }
        }

        history.push({
            game_id: game.game_id,
            created_at: game.created_at,
            p1_id: game.p1_id,
            p2_id: game.p2_id,
            template_id: game.template_id,
            finished_at: nowIso,
            note: 'Left Clan'
        });
    }

    return remaining;
}
```

And update the exports line to:

```js
module.exports = { computeRosterDiff, shouldAbortSync, voidLeaverGames };
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test scripts/roster_sync.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/roster_sync.js scripts/roster_sync.test.js
git commit -m "feat: void departed players' active games as Left Clan"
```

---

### Task 5: Clan roster scraper + profile membership check

**Files:**
- Create: `scripts/clan_roster.js`

**Background for the engineer:** The clan page's member list is rendered client-side from an obfuscated blob (`window.UJS_Init(...)`) — the static HTML contains **no** member data, so we need a real browser. Rendering appears to be progressive/chunked: an early DOM query returned only 50 member links while at least 79 registered players are verifiably in the clan, so the scraper **must poll until the link count stabilizes**, and the caller (Task 6) validates the count. Player IDs and names come from the member links: `href="...Profile?p=<digits>&u=<UrlEncodedName>_<n>"`.

Profile pages, by contrast, are plain server-rendered HTML behind a 302 redirect; membership shows up as a literal `Clans/?ID=<clanId>` substring.

- [ ] **Step 1: Create `scripts/clan_roster.js`**

```js
const { CLAN_ID, clanPageUrl, profilePageUrl } = require('./config');

/**
 * Scrapes the full clan member roster from the war.app clan page.
 * Requires playwright + chromium (heavy) — required lazily so that
 * light-weight consumers (issue_ops) never load it.
 * @returns {Promise<Array<{id: string, name: string|null}>>}
 */
async function fetchClanRoster(clanId = CLAN_ID) {
    const { chromium } = require('playwright');
    const browser = await chromium.launch();

    try {
        const page = await browser.newPage();
        await page.goto(clanPageUrl(clanId), { waitUntil: 'domcontentloaded', timeout: 60000 });

        // The member list renders progressively from a JS blob. Poll until
        // the number of profile links is non-zero and stable for 3 seconds
        // (up to 60s total).
        const selector = 'a[href*="Profile?p="]';
        let prevCount = -1;
        let stableFor = 0;
        for (let i = 0; i < 60 && stableFor < 3; i++) {
            await page.waitForTimeout(1000);
            const count = await page.locator(selector).count();
            stableFor = (count > 0 && count === prevCount) ? stableFor + 1 : 0;
            prevCount = count;
        }
        if (prevCount <= 0) {
            throw new Error('No member links rendered on clan page');
        }

        const hrefs = await page.$$eval(selector, els => els.map(a => a.getAttribute('href')));

        const roster = new Map();
        for (const href of hrefs) {
            const m = (href || '').match(/Profile\?p=(\d+)(?:&u=([^&]+))?/);
            if (!m) continue;
            const id = m[1];
            let name = null;
            if (m[2]) {
                try {
                    name = decodeURIComponent(m[2]).replace(/_\d+$/, '');
                } catch { /* malformed encoding — leave name null */ }
            }
            if (!roster.has(id)) roster.set(id, { id, name });
        }

        return [...roster.values()];
    } finally {
        await browser.close();
    }
}

/**
 * Returns the clan ID shown on a player's profile page, or null if clanless.
 * Plain fetch — no browser needed. Throws on network/HTTP failure.
 */
async function fetchPlayerClanId(playerId) {
    const res = await fetch(profilePageUrl(playerId), { redirect: 'follow' });
    if (!res.ok) throw new Error(`Profile fetch failed for ${playerId}: HTTP ${res.status}`);
    const html = await res.text();
    const m = html.match(/Clans\/\?ID=(\d+)/);
    return m ? m[1] : null;
}

module.exports = { fetchClanRoster, fetchPlayerClanId };
```

- [ ] **Step 2: Verify `fetchPlayerClanId` against known-good live data**

Run:
```bash
node -e "const {fetchPlayerClanId} = require('./scripts/clan_roster');
(async () => {
  console.log('Ree (member):', await fetchPlayerClanId('1382545505'));      // expect: 141
  console.log('extelon (left):', await fetchPlayerClanId('53134900057'));   // expect: 671 (or another non-141 value)
})();"
```
Expected output: `Ree (member): 141` and a non-`141` clan for extelon.

- [ ] **Step 3: Verify `fetchClanRoster` against the live clan page**

Run:
```bash
node -e "const {fetchClanRoster} = require('./scripts/clan_roster');
(async () => {
  const r = await fetchClanRoster();
  console.log('members:', r.length);
  console.log('sample:', JSON.stringify(r.slice(0, 5)));
  console.log('has Ree:', r.some(m => m.id === '1382545505'));
  console.log('has extelon:', r.some(m => m.id === '53134900057'));
})();"
```
Expected: `members:` **at least 79** (79 of the 80 registered players were verified in-clan on 2026-07-09), `has Ree: true`, `has extelon: false`, names decoded (e.g. `"Word Walker"`, not `"Word%20Walker_1"`).

**If the count comes back lower than 79** the progressive-rendering wait is insufficient — increase the stability window (e.g. `stableFor < 5`) or add `await page.mouse.wheel(0, 20000)` scrolling between polls until the full list renders. Do not proceed until this returns ≥ 79.

- [ ] **Step 4: Commit**

```bash
git add scripts/clan_roster.js
git commit -m "feat: clan roster scraper and profile membership check"
```

---

### Task 6: Roster sync orchestration

**Files:**
- Modify: `scripts/roster_sync.js` (add `main()` + `require.main` guard)

- [ ] **Step 1: Add orchestration to `scripts/roster_sync.js`**

Add at the top, after the existing requires:

```js
const { CLAN_ID } = require('./config');
const { fetchClanRoster } = require('./clan_roster');
const { deleteGame } = require('./api');
```

Add above `module.exports`:

```js
async function main() {
    console.log('--- Starting Roster Sync ---');
    const dryRun = process.argv.includes('--dry-run');

    const players = loadJSON(PLAYERS_FILE);
    const activeGames = loadJSON(ACTIVE_GAMES_FILE);
    const history = loadJSON(HISTORY_FILE);

    if (!players || !activeGames || !history) {
        console.error('CRITICAL: Missing data files.');
        process.exit(1);
    }

    let roster;
    try {
        roster = await fetchClanRoster(CLAN_ID);
    } catch (err) {
        // A flaky scrape must never block referee/matchmaker: skip the sync.
        console.error(`Roster scrape failed, skipping sync: ${err.message}`);
        return;
    }
    console.log(`Scraped ${roster.length} clan members.`);

    const abortReason = shouldAbortSync(roster, players);
    if (abortReason) {
        console.error(`CIRCUIT BREAKER: aborting sync — ${abortReason}.`);
        return;
    }

    const diff = computeRosterDiff(roster, players);
    console.log(`New members: ${diff.newMembers.length}, leavers: ${diff.leavers.length}, rejoiners: ${diff.rejoiners.length}, renames: ${diff.renames.length}`);
    diff.newMembers.forEach(m => console.log(`  + enroll ${m.name || m.id} (${m.id})`));
    diff.leavers.forEach(id => console.log(`  - depart ${players[id].name} (${id})`));
    diff.rejoiners.forEach(id => console.log(`  ~ rejoin ${players[id].name} (${id})`));
    diff.renames.forEach(r => console.log(`  ~ rename ${players[r.id].name} -> ${r.name} (${r.id})`));

    if (dryRun) {
        console.log('DRY RUN: no changes written.');
        return;
    }

    const nowIso = new Date().toISOString();

    for (const m of diff.newMembers) {
        players[m.id] = {
            name: m.name || `Player_${m.id}`,
            elo: 1000,
            game_cap: 2,
            missed_games: 0,
            in_clan: true
        };
    }
    for (const id of diff.leavers) {
        players[id].in_clan = false;
        players[id].departed_at = nowIso;
    }
    for (const id of diff.rejoiners) {
        players[id].in_clan = true;
        delete players[id].departed_at;
    }
    for (const r of diff.renames) {
        players[r.id].name = r.name;
    }

    const remainingGames = await voidLeaverGames(diff.leavers, activeGames, history, deleteGame, nowIso);

    saveJSON(PLAYERS_FILE, players);
    saveJSON(ACTIVE_GAMES_FILE, remainingGames);
    saveJSON(HISTORY_FILE, history);
    console.log('Roster sync complete.');
}

if (require.main === module) main();
```

Note: existing player records are only ever touched for `in_clan`/`departed_at`/`name` — caps, ELO, and strikes are never reset by the sync.

- [ ] **Step 2: Run the full test suite (ensures requiring the module doesn't execute main)**

Run: `npm test`
Expected: PASS (10 tests), no roster-sync log output.

- [ ] **Step 3: Live dry run**

Run: `node scripts/roster_sync.js --dry-run` (needs `.env` with `WZ_EMAIL`/`WZ_API_TOKEN` present only for module load; no API writes happen)
Expected:
- `Scraped N clan members.` with N ≥ 79
- No circuit-breaker trip
- Exactly one leaver: `- depart extelon (53134900057)`
- Zero or more `+ enroll` lines (clan members not yet registered)
- `DRY RUN: no changes written.` and `git status` shows no data file modified

- [ ] **Step 4: Commit**

```bash
git add scripts/roster_sync.js
git commit -m "feat: roster sync orchestration with dry-run mode"
```

---

### Task 7: Issue ops — verified signup, opt-out Remove

**Files:**
- Modify: `scripts/issue_ops.js:1-8` (requires), `:87-103` (Signup handler), `:133-148` (Remove handler)

- [ ] **Step 1: Add requires at the top of `scripts/issue_ops.js`**

After `const path = require('path');` add:

```js
const { CLAN_ID } = require('./config');
const { fetchPlayerClanId } = require('./clan_roster');
```

(`clan_roster` requires playwright lazily, so the issues workflow never loads a browser.)

- [ ] **Step 2: Verify clan membership in the Signup handler**

In the Signup branch, replace the `else` block that registers the player:

```js
        } else {
            const playerName = requestedName || `Player_${playerId}`;
            players[playerId] = {
                name: playerName,
                elo: 1000,
                game_cap: 2,
                missed_games: 0
            };
            console.log(`Registered new player: ${playerId} as ${playerName}`);
            matched = true;
        }
```

with:

```js
        } else {
            let clanId;
            try {
                clanId = await fetchPlayerClanId(playerId);
            } catch (err) {
                console.error(`Could not verify clan membership for ${playerId}: ${err.message}`);
                await postIssueComment(
                    `❌ Could not verify your clan membership right now (profile lookup failed). ` +
                    `Please retry in a few minutes by editing the issue title.`
                );
                return;
            }

            if (clanId !== CLAN_ID) {
                console.log(`Signup rejected for ${playerId}: not in clan (found ${clanId || 'none'}).`);
                await postIssueComment(
                    `❌ Signup rejected: this ladder is only open to members of the **M'Hunters** clan, ` +
                    `and player \`${playerId}\` is not currently a member.`
                );
                return;
            }

            const playerName = requestedName || `Player_${playerId}`;
            players[playerId] = {
                name: playerName,
                elo: 1000,
                game_cap: 2,
                missed_games: 0,
                in_clan: true
            };
            console.log(`Registered new player: ${playerId} as ${playerName}`);
            matched = true;
        }
```

- [ ] **Step 3: Repurpose Remove as opt-out**

Replace the Remove branch body:

```js
        if (players[playerId]) {
            delete players[playerId];
            console.log(`Removed player: ${playerId}`);
            matched = true;
        } else {
```

with:

```js
        if (players[playerId]) {
            players[playerId].game_cap = 0;
            console.log(`Opted out player: ${playerId} (game_cap set to 0)`);
            await postIssueComment(
                `✅ **${players[playerId].name}** has been opted out of the ladder (game cap set to 0). ` +
                `No new games will be created. Existing games should still be finished.\n\n` +
                `To come back, open an issue titled: \`Update: ${playerId} Cap: 1\` (up to 3).`
            );
            matched = true;
        } else {
```

- [ ] **Step 4: Syntax check + tests**

Run: `node --check scripts/issue_ops.js && npm test`
Expected: no syntax errors, 10 tests pass. (`issue_ops` runs `runIssueOps()` on require, but only when executed — it exits early with "No ISSUE_TITLE" outside Actions; do NOT require it in a test.)

- [ ] **Step 5: Commit**

```bash
git add scripts/issue_ops.js
git commit -m "feat: verify clan membership on signup; Remove becomes cap-0 opt-out"
```

---

### Task 8: Frontend — hide departed players, void Left Clan games

**Files:**
- Modify: `app.js:76-79` (isVoidGame), `:204` `:235` (rank-change filters), `:486-487` (leaderboard lists)

Line numbers refer to the clean committed `app.js` in the worktree.

- [ ] **Step 1: Add "Left Clan" to the void list**

Change:

```js
function isVoidGame(entry) {
    const note = entry.note || '';
    return note === 'Timed Out (Lobby)' || note === 'Declined' || note === 'Terminated';
}
```

to:

```js
function isVoidGame(entry) {
    const note = entry.note || '';
    return note === 'Timed Out (Lobby)' || note === 'Declined' || note === 'Terminated' || note === 'Left Clan';
}
```

- [ ] **Step 2: Exclude departed players from rank-change calculations**

In `calculateRankChanges`, change both occurrences (currentActive and previousActive) of:

```js
        .filter(p => p.game_cap > 0 && p.missed_games < 2)
```

to:

```js
        .filter(p => p.in_clan !== false && p.game_cap > 0 && p.missed_games < 2)
```

- [ ] **Step 3: Exclude departed players from the leaderboard (both ranked and unranked sections)**

In the leaderboard render function, change:

```js
    const active = allPlayers.filter(p => p.game_cap > 0 && p.missed_games < 2).sort((a, b) => b.elo - a.elo);
    const unranked = allPlayers.filter(p => p.game_cap == 0 || p.missed_games >= 2).sort((a, b) => b.elo - a.elo);
```

to:

```js
    const members = allPlayers.filter(p => p.in_clan !== false);
    const active = members.filter(p => p.game_cap > 0 && p.missed_games < 2).sort((a, b) => b.elo - a.elo);
    const unranked = members.filter(p => p.game_cap == 0 || p.missed_games >= 2).sort((a, b) => b.elo - a.elo);
```

- [ ] **Step 4: Verify in the browser**

1. Hand-edit the worktree's `data/players.json`: pick any player, add `"in_clan": false`. Hand-edit `data/history.json`: change one recent entry's `note` to `"Left Clan"` (add the field if absent, remove its `winner_id`/`loser_id`/`elo_change`).
2. Run: `npx http-server . -p 8081 -c-1`
3. Check `http://localhost:8081/`: the flagged player appears in neither the ranked nor unranked leaderboard section but their name still renders in past games; the `"Left Clan"` history entry shows as voided (no win/loss coloring) and does not affect streaks/last-10.
4. **Revert the data files**: `git checkout data/players.json data/history.json`

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: hide departed players from leaderboard; treat Left Clan games as void"
```

---

### Task 9: Copy updates — actions page, help page, README

**Files:**
- Modify: `actions.html:39-48` (Join card), `help.html:40-43` (signup section), `:63-68` (expectations), `README.md` (join section)

- [ ] **Step 1: Replace the Join Ladder card in `actions.html`**

Change:

```html
                <div class="card">
                    <h3>Join Ladder</h3>
                    <label for="join-name">Warzone username</label>
                    <input type="text" id="join-name" placeholder="Enter your username">
                    <label for="join-id">Player ID</label>
                    <input type="number" id="join-id" placeholder="Your Player ID" min="1" step="1">
                    <button onclick="joinLadder()">Join / Activate</button>
                    <small>Opens a GitHub issue to register.</small>
                </div>
```

to:

```html
                <div class="card">
                    <h3>Join Ladder</h3>
                    <p>Enrollment is automatic: every M'Hunters clan member is added to the
                        ladder by the bot (checked every 2 hours). Just joined the clan and
                        can't wait? Register instantly below.</p>
                    <label for="join-name">War.app username</label>
                    <input type="text" id="join-name" placeholder="Enter your username">
                    <label for="join-id">Player ID</label>
                    <input type="number" id="join-id" placeholder="Your Player ID" min="1" step="1">
                    <button onclick="joinLadder()">Register Now</button>
                    <small>Opens a GitHub issue. Membership is verified — clan members only.</small>
                </div>
```

- [ ] **Step 2: Update `help.html`**

Replace the "Sign up" section (lines 40–43):

```html
                <h3>Joining the ladder</h3>
                <p>You don't have to do anything — every M'Hunters clan member is enrolled
                    automatically (the bot syncs the clan roster every 2 hours). New members
                    start with 1000 ELO and a cap of 2 simultaneous games.</p>
                <p>Want in immediately after joining the clan? Open a GitHub issue titled:</p>
                <pre><code>Signup: &lt;Your_ID&gt; Name: &lt;Your_Username&gt;</code></pre>
                <p>Clan membership is verified — non-members are rejected.</p>

                <h3>Leaving the clan</h3>
                <p>If you leave M'Hunters you are automatically retired from the ladder: no
                    new games, active ladder games are voided, and you disappear from the
                    leaderboard. Your history stays. If you rejoin the clan you are
                    reactivated automatically with your old rating.</p>
```

Replace the "Remove yourself" section (lines 50–52):

```html
                <h3>Opting out</h3>
                <p>Don't want ladder games? Set your cap to 0 (or use Remove) — you stay
                    registered but receive no games. Ignoring or declining games works too:
                    after 2 strikes the bot backs off, retrying with a single game every
                    2–12 weeks (2 weeks per strike, capped at 12).</p>
                <pre><code>Remove: &lt;Your_Warzone_ID&gt;</code></pre>
                <p>Example: <code>Remove: 1234567</code> (equivalent to <code>Update: 1234567 Cap: 0</code>)</p>
```

In the "What to expect" list, change:

```html
                    <li>Missing two games in a row will mark you inactive until you join another match.</li>
```

to:

```html
                    <li>Missing two games in a row marks you unreliable: the bot retries you with one game every 2–12 weeks (2 weeks per strike, up to 12) until you join again.</li>
```

- [ ] **Step 3: Update `README.md`**

(a) In "How it Works" (line 20), replace the numbered list:

```markdown
The ladder is fully automated. A bot ("Norman") runs every 2 hours to:
1.  **Sync Roster**: Enroll new M'Hunters clan members, retire players who left the clan (voiding their active games), and reactivate rejoiners.
2.  **Referee**: Check for finished games, update ELO ratings, and track missed games.
3.  **Matchmake**: Find two available players and create a game on War.app.
```

(b) Replace the "### 1. Join the Ladder" subsection (lines 28–35, everything from the heading through "duplicate signups are rejected).") with:

```markdown
### 1. Join the Ladder

**Automatic:** every M'Hunters clan member is enrolled automatically. The bot
syncs the clan roster every 2 hours; new members start at 1000 ELO with a
2-game cap. Leaving the clan retires you automatically (active ladder games
are voided); rejoining the clan reactivates you with your old rating.

**Instant (optional):** just joined the clan and can't wait for the next sync?
[Open a New Issue](https://github.com/Norman1/mhunters-clan-ladder/issues/new) with the title:
```
Signup: <Your_Warzone_ID> Name: <Your_Warzone_Username>
```
*Example: `Signup: 1234567 Name: General_Risk`* — clan membership is verified;
non-members are rejected.
```

(c) Replace the "To remove yourself..." block (lines 45–49):

```markdown
To opt out of receiving games, open a new issue with the title:
```
Remove: <Your_Warzone_ID>
```
*Example: `Remove: 1234567`* — this sets your game cap to 0; your record and
rating are kept, and you can come back anytime with `Update: <ID> Cap: 1-3`.
```

(d) In "### 4. Inactivity Rules", replace the Cooldown bullet (line 78):

```markdown
*   **Cooldown**: Inactive players use an escalating backoff of **2 weeks per strike**, capped at **12 weeks** (~3 months).
```

- [ ] **Step 4: Commit**

```bash
git add actions.html help.html README.md
git commit -m "docs: describe auto-enrollment lifecycle and new cooldown"
```

---

### Task 10: Engine workflow — install Chromium, run roster sync first

**Files:**
- Modify: `.github/workflows/schedule.yml`

- [ ] **Step 1: Add Playwright setup and the roster-sync step**

After the `Install Dependencies` step and **before** `Run Referee`, insert:

```yaml
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

      - name: Install Playwright Chromium
        run: npx playwright install --with-deps chromium

      - name: Run Roster Sync
        env:
          WZ_EMAIL: ${{ secrets.WZ_EMAIL }}
          WZ_API_TOKEN: ${{ secrets.WZ_API_TOKEN }}
        run: node scripts/roster_sync.js
```

(The sync needs WZ credentials because it deletes leavers' lobby games via the API. Roster sync intentionally runs before referee: departures are applied before results processing and matchmaking.)

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/schedule.yml')); print('yaml ok')"`
Expected: `yaml ok`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/schedule.yml
git commit -m "ci: run roster sync with cached Chromium before referee"
```

---

### Task 11: Final verification and landing

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — 10 tests, 0 failures.

- [ ] **Step 2: Full live dry-run**

Run: `node scripts/roster_sync.js --dry-run`
Expected: ≥79 members scraped, exactly one leaver (extelon 53134900057), no breaker trip, no file changes.

- [ ] **Step 3: Syntax-check every touched script**

Run: `for f in scripts/*.js app.js; do node --check "$f" || echo "FAIL: $f"; done`
Expected: no FAIL lines.

- [ ] **Step 4: Land on main — ASK THE USER FIRST**

Pushing to `main` deploys immediately (GitHub Pages + next engine cron run). Get explicit user approval, then:

```bash
git fetch origin
git rebase origin/main   # Norman commits data/ every 2h — rebase right before pushing
npm test                 # re-verify after rebase
git push origin clan-membership-sync:main
```

- [ ] **Step 5: Monitor the first engine run**

Trigger "Ladder Engine" manually via workflow_dispatch (or wait ≤2h), then check the run logs:
- `Run Roster Sync` step: scraped count ≥79, `- depart extelon (53134900057)`, possible batch of `+ enroll` lines, `Roster sync complete.`
- Norman's data commit shows: extelon `in_clan: false` + `departed_at`, his active game moved to `history.json` with `note: "Left Clan"`, new members added with 1000 ELO.
- Site: extelon gone from the leaderboard, his voided game shows in history without ELO change.

- [ ] **Step 6: Clean up the worktree**

```bash
cd "/Users/cole/Documents/CodingProjects/MH Ladder/mhunters-clan-ladder"
git worktree remove ../ladder-clan-sync
git branch -D clan-membership-sync 2>/dev/null || true
```

(The main working tree keeps its WIP untouched throughout. Note for the user: the WIP's uncommitted changes to `app.js`/`issue_ops.js` will need a routine 3-way merge against these changes when that feature is resumed.)
