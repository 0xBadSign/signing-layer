// Raw-data store: files under data/raw plus a manifest with one entry per file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const RAW = path.join(ROOT, 'data', 'raw');
const MANIFEST = path.join(RAW, 'manifest.json');

let manifest = null;
let dirty = false;

export function loadManifest() {
  if (manifest) return manifest;
  manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { version: 1, files: {} };
  return manifest;
}

export function flushManifest() {
  if (!manifest || !dirty) return;
  const sorted = {};
  for (const k of Object.keys(manifest.files).sort()) sorted[k] = manifest.files[k];
  const out = JSON.stringify({ version: 1, files: sorted }, null, 1) + '\n';
  fs.writeFileSync(MANIFEST + '.tmp', out);
  fs.renameSync(MANIFEST + '.tmp', MANIFEST);
  dirty = false;
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const rawPath = (rel) => path.join(RAW, ...rel.split('/'));
export const hasRaw = (rel) => fs.existsSync(rawPath(rel));
export const readRawText = (rel) => fs.readFileSync(rawPath(rel), 'utf8');
export const readRawJson = (rel) => {
  const buf = fs.readFileSync(rawPath(rel));
  return JSON.parse(rel.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8'));
};

/** Save bytes under data/raw/<rel> and record url/method/body/fetched_at/sha256 in the manifest. */
export function saveRaw(rel, data, meta) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const p = rawPath(rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  const m = loadManifest();
  m.files[rel] = {
    url: meta.url,
    method: meta.method ?? 'GET',
    body: meta.body ?? null,
    fetched_at: meta.fetched_at ?? new Date().toISOString(),
    sha256: sha256(buf),
    bytes: buf.length,
    ...(meta.note ? { note: meta.note } : {}),
  };
  dirty = true;
  return m.files[rel];
}

export function saveRawGzJson(rel, obj, meta) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 9 });
  return saveRaw(rel, gz, meta);
}
