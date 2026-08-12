/**
 * Headless agent example — same C++/WASM kernel, no demo UI (Phase 36 / 42).
 * Run from repo root after `npm run build:wasm && npm run build:api`:
 *   node examples/headless.mjs
 */
import { NodeBrowser } from '../packages/api/dist/index.js';

const bn = await NodeBrowser.boot();
await bn.fs.mkdir('/home/agent', { recursive: true });
await bn.fs.writeFile('/home/agent/hi.js', "console.log('agent-ok')");
const rpc = await bn.rpc({ method: 'fs.readFile', params: { path: '/home/agent/hi.js' } });
console.log('rpc', rpc);
const proc = await bn.spawn('node', ['/home/agent/hi.js'], { cwd: '/home/agent' });
for await (const chunk of proc.output) process.stdout.write(chunk);
bn.teardown();
