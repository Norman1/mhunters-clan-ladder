// Adds a content fingerprint (?v=<hash>) to every js/ and css/ link in the
// site's HTML pages, so browsers fetch a file again only when it changes.
//
//   node scripts/stamp_assets.js          rewrite the pages
//   node scripts/stamp_assets.js --check  exit 1 if any fingerprint is stale
//
// The pre-commit hook in .githooks runs this automatically.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const REF = /((?:src|href)=")((?:js|css)\/[^"?#]+)(?:\?v=[0-9a-f]*)?(")/g;

function fingerprint(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
}

function htmlPages() {
  return fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
}

// Returns { page: newHtml } for pages whose fingerprints need updating.
function stampAll() {
  const changed = {};
  for (const page of htmlPages()) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const next = html.replace(REF, (whole, pre, rel, post) => {
      const v = fingerprint(rel);
      return v ? pre + rel + '?v=' + v + post : whole;
    });
    if (next !== html) changed[page] = next;
  }
  return changed;
}

if (require.main === module) {
  const changed = stampAll();
  const pages = Object.keys(changed);
  if (process.argv.includes('--check')) {
    if (pages.length) {
      console.error('Stale asset fingerprints in: ' + pages.join(', ') + '. Run: node scripts/stamp_assets.js');
      process.exitCode = 1;
    }
  } else {
    for (const page of pages) fs.writeFileSync(path.join(ROOT, page), changed[page]);
    console.log(pages.length ? 'Stamped: ' + pages.join(', ') : 'Asset fingerprints up to date.');
  }
}

module.exports = { stampAll, fingerprint };
