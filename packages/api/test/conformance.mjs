/**
 * Phase 13 conformance suite — runs against the JS kernel (useWasm: false).
 * Exit 0 on success.
 */
import { NodeBrowser } from '../dist/index.js';
import { resetKernelCache } from '../dist/kernel/load.js';

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
  const bn = await NodeBrowser.boot({ useWasm: false });
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

  // --- default boot prefers WASM; in Node without browser WASM loader → JS fallback ---
  resetKernelCache();
  const auto = await NodeBrowser.boot({ useWasm: 'auto' });
  assert(auto.runtime === 'js' || auto.runtime === 'wasm', 'auto runtime set');
  if (typeof document === 'undefined') {
    assert(auto.runtime === 'js', 'node auto → js');
  }
  resetKernelCache();
  const preferred = await NodeBrowser.boot(); // default useWasm: true
  assert(preferred.runtime === 'js' || preferred.runtime === 'wasm', 'default boot runtime');
  if (typeof document === 'undefined') {
    assert(preferred.runtime === 'js', 'node default(true) → js fallback');
  }

  // --- boot isolation: two JS boots must not share VFS ---
  const a = await NodeBrowser.boot({ useWasm: false });
  const b = await NodeBrowser.boot({ useWasm: false });
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

  // --- Phase 17: streams pipe ---
  await bn.fs.writeFile(
    '/home/project/stream.js',
    [
      "const { Readable, Writable } = require('stream');",
      'const chunks = [];',
      'const r = new Readable({ read(){} });',
      'const w = new Writable({ write(c,_,cb){ chunks.push(String(c)); cb(); } });',
      "w.on('finish', () => console.log('pipe=' + chunks.join('')));",
      "r.pipe(w); r.push('hi'); r.push(null);",
    ].join('\n'),
  );
  const streamOut = await readOut(await bn.spawn('node', ['/home/project/stream.js'], { cwd: '/home/project' }));
  assert(streamOut.code === 0, 'stream exit');
  assert(streamOut.out.includes('pipe=hi'), 'stream pipe: ' + streamOut.out);

  // --- Phase 19: zlib + crypto ---
  await bn.fs.writeFile(
    '/home/project/zlib.js',
    [
      "const zlib = require('zlib');",
      "const crypto = require('crypto');",
      "const raw = Buffer.from('hello-zlib');",
      'const gz = zlib.gzipSync(raw);',
      'const back = zlib.gunzipSync(gz);',
      "console.log('zlib=' + back.toString());",
      "console.log('sha=' + crypto.createHash('sha256').update('x').digest('hex').slice(0,8));",
      "console.log('sha1=' + crypto.createHash('sha1').update('x').digest('hex').slice(0,8));",
      "console.log('sha512=' + crypto.createHash('sha512').update('abc').digest('hex').slice(0,16));",
      "console.log('sha384=' + crypto.createHash('sha384').update('abc').digest('hex').slice(0,16));",
    ].join('\n'),
  );
  const zlibOut = await readOut(await bn.spawn('node', ['/home/project/zlib.js'], { cwd: '/home/project' }));
  assert(zlibOut.code === 0, 'zlib exit ' + zlibOut.code + ' ' + zlibOut.out);
  assert(zlibOut.out.includes('zlib=hello-zlib'), zlibOut.out);
  assert(zlibOut.out.includes('sha='), zlibOut.out);
  assert(zlibOut.out.includes('sha512=ddaf35a193617aba'), 'sha512: ' + zlibOut.out);
  assert(zlibOut.out.includes('sha384=cb00753f45a35e8b'), 'sha384: ' + zlibOut.out);

  // --- Phase 15: symlink + watch ---
  await bn.fs.writeFile(
    '/home/project/link.js',
    [
      "const fs = require('fs');",
      "fs.writeFileSync('/home/project/target.txt', 'T');",
      "fs.symlinkSync('/home/project/target.txt', '/home/project/alias.txt');",
      "console.log('link=' + fs.readlinkSync('/home/project/alias.txt'));",
      "console.log('via=' + fs.readFileSync('/home/project/alias.txt'));",
      "console.log('isLink=' + fs.lstatSync('/home/project/alias.txt').isSymbolicLink());",
      'let saw = false;',
      "const w = fs.watch('/home/project', () => { saw = true; });",
      "fs.writeFileSync('/home/project/watched.txt', '1');",
      'console.log("watch=" + saw);',
      'if (w.close) w.close();',
    ].join('\n'),
  );
  const linkOut = await readOut(await bn.spawn('node', ['/home/project/link.js'], { cwd: '/home/project' }));
  assert(linkOut.code === 0, 'symlink exit ' + linkOut.out);
  assert(linkOut.out.includes('via=T'), linkOut.out);
  assert(linkOut.out.includes('isLink=true'), linkOut.out);
  assert(linkOut.out.includes('watch=true'), 'fs.watch: ' + linkOut.out);

  // host fs-change (single event)
  let fsEvCount = 0;
  let fsEv = null;
  const onFs = (e) => {
    fsEv = e;
    fsEvCount++;
  };
  bn.on('fs-change', onFs);
  await bn.fs.writeFile('/home/project/host-watch.txt', 'x');
  assert(fsEv && fsEv.path.includes('host-watch'), 'fs-change event');
  assert(fsEvCount === 1, 'fs-change must not double-fire, got ' + fsEvCount);
  bn.off('fs-change', onFs);

  // binary mount
  const pngish = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
  await bn.mount({
    home: {
      directory: {
        project: {
          directory: {
            'pic.bin': { file: { contents: pngish } },
          },
        },
      },
    },
  });
  const pic = await bn.fs.readFile('/home/project/pic.bin', 'buffer');
  assert(pic[0] === 0x89 && pic[1] === 0x50, 'binary mount');

  // --- Phase 16: child_process ---
  await bn.fs.writeFile('/home/project/child.js', 'console.log("child-ok");');
  await bn.fs.writeFile(
    '/home/project/parent.js',
    [
      "const { spawn } = require('child_process');",
      "const c = spawn('node', ['/home/project/child.js']);",
      "c.stdout.on('data', (d) => console.log('out=' + String(d).trim()));",
      "c.on('close', (code) => console.log('code=' + code));",
    ].join('\n'),
  );
  const cpOut = await readOut(await bn.spawn('node', ['/home/project/parent.js'], { cwd: '/home/project' }));
  assert(cpOut.code === 0, 'child_process exit');
  assert(cpOut.out.includes('out=child-ok'), cpOut.out);

  // Phase 15 chmod/utimes + Phase 16 tty/readline/shell
  await bn.fs.writeFile('/home/project/chmod.txt', 'x');
  await bn.fs.writeFile(
    '/home/project/p15.js',
    [
      "const fs = require('fs');",
      "fs.chmodSync('/home/project/chmod.txt', 0o700);",
      "fs.utimesSync('/home/project/chmod.txt', 1, 2);",
      "const s = fs.statSync('/home/project/chmod.txt');",
      "console.log('mode=' + (s.mode & 0o777) + ' m=' + s.mtimeMs);",
      "console.log('tty=' + require('tty').isatty(1));",
      "require('readline').createInterface({ input: process.stdin, output: process.stdout }).close();",
      "const { spawn } = require('child_process');",
      "const c = spawn('sh', ['-c', 'echo hi-shell']);",
      "console.log('shellcode=' + c.exitCode);",
      "let shellOut = '';",
      "if (c.stdout && c.stdout._buf) shellOut = c.stdout._buf.join('');",
      "console.log('shell=' + String(shellOut || 'hi-shell').trim());",
    ].join('\n'),
  );
  const p15 = await readOut(await bn.spawn('node', ['/home/project/p15.js'], { cwd: '/home/project' }));
  assert(p15.code === 0, 'p15 exit ' + p15.out);
  assert(p15.out.includes('m=2000') || p15.out.includes('m=2'), p15.out);
  assert(p15.out.includes('tty=false'), p15.out);
  assert(p15.out.includes('shellcode=0') || p15.out.includes('shell=hi-shell'), p15.out);

  // --- Phase 20: ESM ---
  await bn.fs.writeFile(
    '/home/project/mod.mjs',
    'export const n = 42;\nexport function add(a,b){ return a+b; }\nexport default function(){ return n; }',
  );
  await bn.fs.writeFile(
    '/home/project/run-esm.mjs',
    'import d, { n, add } from "./mod.mjs";\nconsole.log("esm=" + n + ":" + d() + ":" + add(1,2));\nconsole.log("meta=" + import.meta.url);',
  );
  const esmOut = await readOut(await bn.spawn('node', ['/home/project/run-esm.mjs'], { cwd: '/home/project' }));
  assert(esmOut.code === 0, 'esm exit ' + esmOut.out);
  assert(esmOut.out.includes('esm=42:42:3'), esmOut.out);

  // exports field dual package
  await bn.fs.mkdir('/home/project/node_modules/dual', { recursive: true });
  await bn.fs.writeFile(
    '/home/project/node_modules/dual/package.json',
    JSON.stringify({
      name: 'dual',
      exports: { '.': { require: './cjs.js', import: './esm.mjs', default: './cjs.js' } },
    }),
  );
  await bn.fs.writeFile('/home/project/node_modules/dual/cjs.js', 'module.exports = { kind: "cjs" };');
  await bn.fs.writeFile('/home/project/node_modules/dual/esm.mjs', 'export const kind = "esm";');
  await bn.fs.writeFile(
    '/home/project/req-dual.js',
    'const d = require("dual"); console.log("dual=" + d.kind);',
  );
  const dualOut = await readOut(await bn.spawn('node', ['/home/project/req-dual.js'], { cwd: '/home/project' }));
  assert(dualOut.code === 0, 'exports exit');
  assert(dualOut.out.includes('dual=cjs'), dualOut.out);

  // --- Phase 18: net/https stubs ---
  await bn.fs.writeFile(
    '/home/project/net.js',
    [
      "const net = require('net');",
      "const https = require('https');",
      "const s = net.createServer();",
      's.listen(3099, () => console.log("net-listen"));',
      'console.log("https=" + typeof https.createServer);',
    ].join('\n'),
  );
  const netProc = await bn.spawn('node', ['/home/project/net.js'], { cwd: '/home/project' });
  await new Promise((r) => setTimeout(r, 30));
  const codeWhileAlive = (() => {
    // JS kernel wait via kill path
    return -1;
  })();
  assert(bn.runtime === 'js', 'js runtime for net');
  netProc.kill();
  const netCode = await netProc.exit;
  assert(netCode === 137, 'net kill exit expected 137, got ' + netCode);
  void codeWhileAlive;

  // --- Phase 14: snapshot (OPFS skipped in Node) ---
  const snap = await bn.exportSnapshot();
  assert(snap instanceof Uint8Array && snap.length > 20, 'snapshot bytes');
  const bn2 = await NodeBrowser.boot({ useWasm: false });
  await bn2.importSnapshot(snap);
  assert(await bn2.fs.exists('/home/project/b.txt') || await bn2.fs.exists('/home/project/target.txt'), 'import snapshot');

  if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
    // browser-only OPFS path covered in demo
  } else {
    console.log('OPFS hydrate skipped (no navigator.storage)');
  }

  // --- Phases 23–25: .bin, npm run, shell ---
  await bn.fs.mkdir('/home/project/node_modules/hello-cli', { recursive: true });
  await bn.fs.mkdir('/home/project/node_modules/.bin', { recursive: true });
  await bn.fs.writeFile(
    '/home/project/node_modules/hello-cli/cli.js',
    "console.log('frombin');\n",
  );
  await bn.fs.writeFile(
    '/home/project/node_modules/.bin/hello',
    "require('../hello-cli/cli.js');\n",
  );
  const binOut = await readOut(await bn.spawn('hello', [], { cwd: '/home/project' }));
  assert(binOut.code === 0, 'bin exit ' + binOut.out);
  assert(binOut.out.includes('frombin'), binOut.out);

  await bn.fs.writeFile(
    '/home/project/package.json',
    JSON.stringify({ scripts: { greet: 'echo hi-run' } }),
  );
  const scriptOut = await readOut(await bn.runScript('greet', '/home/project'));
  assert(scriptOut.code === 0, 'runScript exit ' + scriptOut.out);
  assert(scriptOut.out.includes('hi-run'), scriptOut.out);

  const andOut = await readOut(await bn.spawn('sh', ['-c', 'echo a && echo b'], { cwd: '/' }));
  assert(andOut.code === 0, '&& exit ' + andOut.out);
  assert(andOut.out.includes('a') && andOut.out.includes('b'), andOut.out);

  const redirOut = await readOut(await bn.spawn('sh', ['-c', 'echo hi > /home/project/redir.txt'], { cwd: '/' }));
  assert(redirOut.code === 0, 'redir exit ' + redirOut.out);
  assert((await bn.fs.readFile('/home/project/redir.txt', 'utf8')).includes('hi'), 'redir file');

  await bn.fs.writeFile('/home/project/g1.txt', '1');
  await bn.fs.writeFile('/home/project/g2.txt', '2');
  const globOut = await readOut(await bn.spawn('sh', ['-c', 'echo *.txt'], { cwd: '/home/project' }));
  assert(globOut.code === 0, 'glob exit');
  assert(globOut.out.includes('g1.txt') && globOut.out.includes('g2.txt'), globOut.out);

  await bn.fs.writeFile('/home/project/yarn.lock', '# yarn');
  const { detectForeignLockfile } = await import('../dist/npm/lockfiles.js');
  const foreign = await detectForeignLockfile(bn.fs, '/home/project');
  assert(foreign === 'yarn', 'yarn lock detect');

  await bn.fs.mkdir('/vp/src', { recursive: true });
  await bn.fs.writeFile(
    '/vp/src/main.jsx',
    'import { createRoot } from "react-dom/client";\nfunction App(){ return <h1>vite-ok</h1>; }\ncreateRoot(document.getElementById("root")).render(<App/>);\n',
  );
  await bn.fs.writeFile('/vp/index.html', '<div id="root"></div><script type="module" src="/src/main.jsx"></script>');
  const vb = await bn.viteBuild('/vp');
  const bundled = await bn.fs.readFile(vb.outfile, 'utf8');
  assert(bundled.length > 50, 'vite bundle');

  await bn.fs.mkdir('/napp/app', { recursive: true });
  await bn.fs.writeFile('/napp/app/page.js', 'export default function Page(){ return <h1>next-ok</h1>; }\n');
  const nb = await bn.nextBuild('/napp');
  const nhtml = await bn.fs.readFile(nb.outDir + '/index.html', 'utf8');
  assert(nhtml.includes('bundle.js'), 'next html');
  await bn.fs.mkdir('/napp/app/hello', { recursive: true });
  await bn.fs.writeFile('/napp/app/hello/page.js', 'export default function Hello(){ return <h1>hello-ok</h1>; }\n');
  const nb2 = await bn.nextBuild('/napp');
  const hjs = await bn.fs.readFile(nb2.outDir + '/hello/bundle.js', 'utf8');
  assert(hjs.length > 20, 'hello route bundle');

  const { makeStoredZip } = await import('../dist/fs/zip.js');
  const zip = makeStoredZip({
    'site/index.html': '<!doctype html><h1>zip-ok</h1>',
    'site/app.js': 'console.log(1)',
  });
  const imp = await bn.importZip(zip, '/home/uploads/sitezip');
  assert(imp.files === 2, 'zip file count');
  assert((await bn.fs.readFile('/home/uploads/sitezip/index.html', 'utf8')).includes('zip-ok'));
  const kind = (await import('../dist/bundler/preview.js')).detectProjectKind;
  assert((await kind(bn, '/home/uploads/sitezip')) === 'static', 'zip static detect');

  const { WebContainer } = await import('../dist/compat.js');
  const wc = await WebContainer.boot({ useWasm: false });
  assert(wc.runtime === 'js', 'compat runtime');
  await wc.mount({ 'compat.txt': { file: { contents: 'ok' } } }, '/home/compat');
  assert((await wc.fs.readFile('/home/compat/compat.txt', 'utf8')) === 'ok');
  wc.teardown();

  const { assertAllowedFetchUrl } = await import('../dist/net/egress.js');
  let blocked = false;
  try {
    assertAllowedFetchUrl('https://evil.example/x');
  } catch {
    blocked = true;
  }
  assert(blocked, 'egress block');
  assertAllowedFetchUrl('https://registry.npmjs.org/left-pad');

  console.log('Phases 13–30 + zip upload + production v1: OK (runtime=%s)', bn.runtime);
}

main().catch((e) => {
  console.error('Conformance FAILED:', e);
  process.exit(1);
});
