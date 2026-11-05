const fs = require('fs');
const path = require('path');
const { fetchPlayerClanInfo } = require('./clan_roster');

const PLAYERS_FILE = path.join(__dirname, '../data/players.json');
const ICON_DIR = path.join(__dirname, '../data/clan-icons');

// The icon filename war.app publishes (e.g. "439519665.png") changes whenever
// a clan re-uploads its icon, so it doubles as a version marker: unchanged
// icons are never re-downloaded.
function iconVersion(iconUrl) {
    const m = (iconUrl || '').match(/\/Icon\/([^/?]+)$/);
    return m ? m[1] : null;
}

async function downloadClanIcon(clanId, iconUrl) {
    const res = await fetch(iconUrl, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Icon fetch failed for clan ${clanId}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error(`Icon fetch for clan ${clanId} returned an empty body`);
    fs.mkdirSync(ICON_DIR, { recursive: true });
    fs.writeFileSync(path.join(ICON_DIR, `${clanId}.png`), buf);
}

/**
 * Refreshes the stored clan of every admitted guest from their war.app
 * profile and mirrors each clan's icon into data/clan-icons/<clanId>.png
 * (served by the site so pages never hotlink war.app's CDN). A failed
 * profile lookup leaves that guest's stored clan untouched; a failed icon
 * download keeps the stale version marker so the next run retries it.
 * @returns {Promise<boolean>} whether `players` was mutated
 */
async function syncGuestClans(players, fetchInfo = fetchPlayerClanInfo, download = downloadClanIcon) {
    let changed = false;
    for (const [id, p] of Object.entries(players)) {
        if (p.guest !== true) continue;

        let info;
        try {
            info = await fetchInfo(id);
        } catch (err) {
            console.error(`Guest clan lookup failed for ${p.name || id}: ${err.message}`);
            continue;
        }

        if (!info) {
            if ('clan' in p) {
                delete p.clan;
                changed = true;
                console.log(`Guest ${p.name || id} is now clanless.`);
            }
            continue;
        }

        const version = iconVersion(info.iconUrl);
        const prev = p.clan && String(p.clan.id) === info.clanId ? p.clan : null;
        let storedVersion = prev ? (prev.icon_v ?? null) : null;

        const iconPath = path.join(ICON_DIR, `${info.clanId}.png`);
        if (info.iconUrl && (storedVersion !== version || !fs.existsSync(iconPath))) {
            try {
                await download(info.clanId, info.iconUrl);
                storedVersion = version;
            } catch (err) {
                console.error(err.message);
            }
        }

        const next = {
            id: info.clanId,
            name: info.clanName || `Clan ${info.clanId}`,
            icon_v: storedVersion
        };
        if (!prev || prev.name !== next.name || prev.icon_v !== next.icon_v) {
            p.clan = next;
            changed = true;
            console.log(`Guest ${p.name || id}: clan ${next.name} (${next.id}).`);
        }
    }
    return changed;
}

async function main() {
    console.log('--- Starting Guest Clan Sync ---');
    const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
    const changed = await syncGuestClans(players);
    if (changed) {
        fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2));
        console.log('Guest clan info updated.');
    } else {
        console.log('No guest clan changes.');
    }
}

if (require.main === module) {
    main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { syncGuestClans, iconVersion };
