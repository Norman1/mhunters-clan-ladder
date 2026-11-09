const test = require('node:test');
const assert = require('node:assert');
const { stampAll } = require('./stamp_assets');

test('every page links its js/css with a current fingerprint', () => {
  const stale = Object.keys(stampAll());
  assert.deepStrictEqual(stale, [], 'Run: node scripts/stamp_assets.js');
});
