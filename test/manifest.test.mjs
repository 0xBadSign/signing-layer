import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const RAW = path.resolve(import.meta.dirname, '..', 'data', 'raw');
const manifest = JSON.parse(fs.readFileSync(path.join(RAW, 'manifest.json'), 'utf8'));

test('every manifest entry has a file with matching sha256 and complete metadata', () => {
  const keys = Object.keys(manifest.files);
  assert.ok(keys.length > 0);
  for (const rel of keys) {
    const e = manifest.files[rel];
    for (const f of ['url', 'method', 'fetched_at', 'sha256']) assert.ok(e[f], `${rel}: missing ${f}`);
    const buf = fs.readFileSync(path.join(RAW, ...rel.split('/')));
    assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), e.sha256, `${rel}: sha256 mismatch`);
  }
});

test('every raw data file is listed in the manifest', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  const rels = walk(RAW).map((p) => path.relative(RAW, p).split(path.sep).join('/'));
  const allowedUnlisted = new Set(['manifest.json', 'fetch-stats.json']);
  const unlisted = rels.filter((r) => !manifest.files[r] && !allowedUnlisted.has(r));
  assert.deepEqual(unlisted, []);
});
