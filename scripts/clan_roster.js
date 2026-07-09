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

        const selector = 'a[href*="Profile?p="]';
        const roster = new Map();

        const addLinksFromCurrentPage = async () => {
            const hrefs = await page.$$eval(selector, els => els.map(a => a.getAttribute('href')));
            for (const href of hrefs) {
                const m = (href || '').match(/Profile\?p=(\d+)(?:&u=([^&]+))?/);
                if (!m) continue;
                const id = m[1];
                let name = null;
                if (m[2]) {
                    try {
                        // Strip war.app's profile-slug suffix from the u=
                        // param (e.g. "Word%20Walker_1" -> "Word Walker").
                        // Trade-off: a real name literally ending in
                        // _<digits> would be clipped too.
                        name = decodeURIComponent(m[2]).replace(/_\d+$/, '');
                    } catch { /* malformed encoding — leave name null */ }
                }
                if (!roster.has(id)) roster.set(id, { id, name });
            }
        };

        // Each page of the member list renders progressively from a JS
        // blob. Poll until the number of profile links is non-zero and
        // stable for 3 seconds (up to 60s) before harvesting it.
        const waitForCurrentPageToStabilize = async () => {
            let prevCount = -1;
            let stableFor = 0;
            for (let i = 0; i < 60 && stableFor < 3; i++) {
                await page.waitForTimeout(1000);
                const count = await page.locator(selector).count();
                stableFor = (count > 0 && count === prevCount) ? stableFor + 1 : 0;
                prevCount = count;
            }
            return prevCount;
        };

        // Rosters over 50 members are paginated behind a "Next >>" control.
        // The visible "Next >>" text is a non-interactive overlay drawn by
        // the game-engine UI; the real click target is a same-position
        // transparent <a> stacked on top of it. A normal locator.click() on
        // the text element spins forever retrying against that intercepting
        // element, so instead we grab the text's bounding box and dispatch
        // a raw mouse click at its center — the browser's own hit-testing
        // then naturally resolves to whatever is actually on top, without
        // us needing to depend on that element's auto-generated,
        // non-stable id.
        const clickNextPage = async () => {
            const nextText = page.getByText('Next >>', { exact: true });
            if ((await nextText.count()) === 0) return false;
            await nextText.first().scrollIntoViewIfNeeded();
            const box = await nextText.first().boundingBox();
            if (!box) return false;
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            // Give the page a beat to start tearing down the old list
            // before we start polling for the new one to stabilize —
            // otherwise a slow-to-start transition can look "stable" at
            // the previous page's (stale) link count.
            await page.waitForTimeout(500);
            return true;
        };

        // First page.
        const stableCount = await waitForCurrentPageToStabilize();
        if (stableCount <= 0) {
            throw new Error('No member links rendered on clan page');
        }
        await addLinksFromCurrentPage();

        // Remaining pages. A raw coordinate click can silently miss (stale
        // bounding box, overlay reposition), leaving us on the same page —
        // which harvests zero new ids and would otherwise loop forever /
        // return a PARTIAL roster with no error. So after each click we
        // verify the roster actually GREW; if not, retry the click (2
        // retries), and if it still doesn't grow, fail loudly rather than
        // return a partial roster.
        const maxPages = 50; // safety valve: 50 members/page = 2500+ clan
        let pageNum = 1;
        while ((await page.getByText('Next >>', { exact: true }).count()) > 0) {
            if (pageNum >= maxPages) {
                throw new Error(`Clan page still shows "Next >>" after ${maxPages} pages (roster at ${roster.size} members) — aborting rather than returning a partial roster`);
            }
            const sizeBefore = roster.size;
            let grew = false;
            for (let attempt = 0; attempt < 3 && !grew; attempt++) {
                await clickNextPage();
                await waitForCurrentPageToStabilize();
                await addLinksFromCurrentPage();
                grew = roster.size > sizeBefore;
            }
            if (!grew) {
                throw new Error(`Pagination stuck: "Next >>" click did not advance past page ${pageNum} after 3 attempts (roster at ${roster.size} members)`);
            }
            pageNum++;
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
    // Takes the FIRST Clans/?ID= match: relies on the profile page
    // rendering exactly one clan link (the player's own) — verified true
    // as of 2026-07. If war.app ever adds other clan links to profiles
    // (e.g. "recent opponents"), this needs an anchor to the clan field.
    const m = html.match(/Clans\/\?ID=(\d+)/);
    return m ? m[1] : null;
}

module.exports = { fetchClanRoster, fetchPlayerClanId };
