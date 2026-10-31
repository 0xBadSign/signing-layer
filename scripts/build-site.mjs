// Builds site/ for GitHub Pages: web/* at the root plus data/derived/* under data/derived/.
// usage: node scripts/build-site.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'data', 'derived'), { recursive: true });
fs.cpSync(path.join(ROOT, 'web'), OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'data', 'derived'), path.join(OUT, 'data', 'derived'), { recursive: true });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log('site built at ' + OUT);
