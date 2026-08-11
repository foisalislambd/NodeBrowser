/**
 * Phase 13 conformance suite — runs against the JS kernel (useWasm: false).
 * Exit 0 on success.
 */
import { BrowserNode } from '../dist/index.js';
import { resetKernelCache } from '../dist/kernel.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

async function readOut(proc) {
  let out = '';
  const r = proc.output.getReader();
  while (true) {
    const { value, done } = await r.read();
    if (done) break;
    out += value;
  }
  const code = await proc.exit;
  return { out, code };
}

async function main() {
  resetKernelCache();
  const bn = await BrowserNode.boot({ useWasm: false });
  assert(bn.runtime === 'js', 'expected js runtime');

  // --- exists / mkdir / write / read utf8 ---
  await bn.fs.mkdir('/home/project', { recursive: true });
  await bn.fs.writeFile('/home/project/a.txt', 'hello');
  assert(await bn.fs.exists('/home/project/a.txt'));
  assert((await bn.fs.readFile('/home/project/a.txt', 'utf8')) === 'hello');
  assert((await bn.fs.stat('/home/project')).isDirectory());
  assert((await bn.fs.stat('/home/project/a.txt')).isFile());

  // --- binary write / read buffer ---
  const bytes = new Uint8Array([0, 1, 2, 255, 10]);
  await bn.fs.writeFile('/home/project/bin.dat', bytes);
  const got = await bn.fs.readFile('/home/project/bin.dat', 'buffer');
  assert(got instanceof Uint8Array, 'buffer read type');
  assert(got.length === 5 && got[0] === 0 && got[3] === 255, 'binary roundtrip');

  // --- rename file ---
  await bn.fs.rename('/home/project/a.txt', '/home/project/b.txt');
  assert(!(await bn.fs.exists('/home/project/a.txt')));
  assert((await bn.fs.readFile('/home/project/b.txt', 'utf8')) === 'hello');

  // --- rename directory ---
  await bn.fs.mkdir('/home/project/src', { recursive: true });
  await bn.fs.writeFile('/home/project/src/m.js', 'module.exports = 7;');
  await bn.fs.rename('/home/project/src', '/home/project/lib');
  assert(!(await bn.fs.exists('/home/project/src')));
  assert((await bn.fs.readFile('/home/project/lib/m.js', 'utf8')).includes('7'));

  // --- recursive rm ---
  await bn.fs.mkdir('/home/project/tmp/x', { recursive: true });
  await bn.fs.writeFile('/home/project/tmp/x/y.txt', 'z');
  await bn.fs.rm('/home/project/tmp', { recursive: true });
  assert(!(await bn.fs.exists('/home/project/tmp')));

  // --- spawn env → process.env ---
  await bn.fs.writeFile(
    '/home/project/env.js',
    'console.log(process.env.BN_TEST + ":" + process.env.PATH_HINT);',
  );
  const envProc = await bn.spawn('node', ['/home/project/env.js'], {
    cwd: '/home/project',
    env: { BN_TEST: 'ok', PATH_HINT: 'vfs' },
  });
  const envOut = await readOut(envProc);
  assert(envOut.code === 0, 'env exit ' + envOut.code);
  assert(envOut.out.includes('ok:vfs'), 'env inject: ' + JSON.stringify(envOut.out));

  // --- spawn require after rename ---
  await bn.fs.writeFile(
    '/home/project/main.js',
    'const m = require("./lib/m.js"); console.log("m="+m);',
  );
  const run = await bn.spawn('node', ['/home/project/main.js'], { cwd: '/home/project' });
  const runOut = await readOut(run);
  assert(runOut.code === 0, 'main exit');
  assert(runOut.out.includes('m=7'), runOut.out);

  // --- auto boot falls back to js in Node ---
  resetKernelCache();
  const auto = await BrowserNode.boot({ useWasm: 'auto' });
  assert(auto.runtime === 'js' || auto.runtime === 'wasm', 'auto runtime set');
  if (typeof document === 'undefined') {
    assert(auto.runtime === 'js', 'node auto → js');
  }

  // --- boot isolation: two JS boots must not share VFS ---
  const a = await BrowserNode.boot({ useWasm: false });
  const b = await BrowserNode.boot({ useWasm: false });
  await a.fs.writeFile('/iso.txt', 'A');
  assert(!(await b.fs.exists('/iso.txt')), 'boots must isolate VFS');
  await b.fs.writeFile('/iso.txt', 'B');
  assert((await a.fs.readFile('/iso.txt', 'utf8')) === 'A');
  assert((await b.fs.readFile('/iso.txt', 'utf8')) === 'B');

  // --- rename into self rejected ---
  await bn.fs.mkdir('/home/project/nest', { recursive: true });
  await bn.fs.writeFile('/home/project/nest/f.txt', '1');
  let threw = false;
  try {
    await bn.fs.rename('/home/project/nest', '/home/project/nest/inside');
  } catch {
    threw = true;
  }
  assert(threw, 'self-rename must throw');
  assert(await bn.fs.exists('/home/project/nest/f.txt'), 'self-rename must not eat tree');

  console.log('Phase 13 conformance: OK (runtime=%s)', bn.runtime);
}

main().catch((e) => {
  console.error('Phase 13 conformance FAILED:', e);
  process.exit(1);
});
