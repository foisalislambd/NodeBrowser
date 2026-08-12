/**
 * Phase 37 — local timings (not a WebContainers bake-off).
 *   node scripts/bench.mjs
 */
import { performance } from 'node:perf_hooks';
import { NodeBrowser } from '../packages/api/dist/index.js';

process.env.BN_ALLOW_JS_KERNEL = '1';

const t0 = performance.now();
const bn = await NodeBrowser.boot({ useWasm: 'auto' });
const tBoot = performance.now() - t0;
await bn.fs.writeFile('/bench.js', "console.log('ok')");
const t1 = performance.now();
const proc = await bn.spawn('node', ['/bench.js']);
await proc.exit;
const tSpawn = performance.now() - t1;
console.log(JSON.stringify({ runtime: bn.runtime, bootMs: +tBoot.toFixed(1), spawnNodeMs: +tSpawn.toFixed(1) }, null, 2));
bn.teardown();
