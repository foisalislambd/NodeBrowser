/**
 * Phase 37 bake-off helper — Node WASM timings + last Playwright / WC placeholder.
 *   node scripts/bakeoff.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { NodeBrowser } from '../packages/api/dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const t0 = performance.now();
const bn = await NodeBrowser.boot();
const bootMs = performance.now() - t0;
await bn.fs.writeFile('/bench.js', "console.log('ok')");
const t1 = performance.now();
const proc = await bn.spawn('node', ['/bench.js']);
let out = '';
for await (const chunk of proc.output) out += chunk;
await proc.exit;
const spawnNodeMs = performance.now() - t1;

const nodeSide = {
  product: 'nodebrowser-node',
  runtime: bn.runtime,
  worker: bn.worker,
  sabStdio: bn.sabStdio,
  bootMs: +bootMs.toFixed(1),
  spawnNodeMs: +spawnNodeMs.toFixed(1),
  output: out.trim().slice(0, 80),
};

const lastPw = join(root, 'e2e/last-run.json');
const wcPath = join(root, 'e2e/wc-placeholder.json');
const playwright = existsSync(lastPw) ? JSON.parse(readFileSync(lastPw, 'utf8')) : null;
const wc = JSON.parse(readFileSync(wcPath, 'utf8'));

console.log(
  JSON.stringify(
    {
      nodebrowserNode: nodeSide,
      nodebrowserPlaywright: playwright,
      webcontainers: wc.webcontainers,
      note: wc.note,
    },
    null,
    2,
  ),
);
bn.teardown();
