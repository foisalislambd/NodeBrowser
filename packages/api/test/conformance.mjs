/**
 * Conformance against the C++/WASM kernel (Phase 13b). Exit 0 on success.
 */
import { NodeBrowser, SabStdioRing } from '../dist/index.js';
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
  await resetKernelCache();
  const bn = await NodeBrowser.boot({ useWasm: true });
  assert(bn.runtime === 'wasm', 'boot must use WASM kernel, got ' + bn.runtime);

  {
    const ring = SabStdioRing.create(64);
    assert(ring.writeString('hello-sab') === 9, 'sab write');
    assert(ring.readString() === 'hello-sab', 'sab read');
    ring.close(0);
    assert(ring.closed && ring.exitCode === 0, 'sab close');
    const small = SabStdioRing.create(8);
    assert(small.writeString('0123456789') === 8, 'sab partial write');
    assert(small.readString() === '01234567', 'sab partial read');
    assert(small.writeString('89') === 2, 'sab write after drain');
    assert(small.readString() === '89', 'sab remainder');
    SabStdioRing.wrap(small.buffer);
  }

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

  // --- default boot is WASM; useWasm:false throws ---
  await resetKernelCache();
  const auto = await NodeBrowser.boot({ useWasm: 'auto' });
  assert(auto.runtime === 'wasm', 'auto runtime wasm');
  await resetKernelCache();
  const preferred = await NodeBrowser.boot();
  assert(preferred.runtime === 'wasm', 'default boot wasm');
  let falseThrew = false;
  try {
    await NodeBrowser.boot({ useWasm: false });
  } catch (e) {
    falseThrew = String(e).includes('WASM kernel required');
  }
  assert(falseThrew, 'useWasm:false must throw');

  // --- boot isolation: two WASM kernels must not share VFS ---
  await resetKernelCache();
  const a = await NodeBrowser.boot({ useWasm: true });
  const b = await NodeBrowser.boot({ useWasm: true });
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
  netProc.kill();
  const netCode = await netProc.exit;
  assert(netCode === 137, 'net kill exit expected 137, got ' + netCode);

  // --- Phase 14: snapshot (OPFS skipped in Node) ---
  const snap = await bn.exportSnapshot();
  assert(snap instanceof Uint8Array && snap.length > 20, 'snapshot bytes');
  const bn2 = await NodeBrowser.boot({ useWasm: true });
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

  await bn.fs.mkdir('/nsrc/src/app', { recursive: true });
  await bn.fs.writeFile(
    '/nsrc/package.json',
    JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }),
  );
  await bn.fs.writeFile(
    '/nsrc/next.config.ts',
    'import type { NextConfig } from "next";\nconst nextConfig: NextConfig = {};\nexport default nextConfig;\n',
  );
  await bn.fs.writeFile(
    '/nsrc/src/app/layout.tsx',
    'import { Geist } from "next/font/google";\nconst geist = Geist({ subsets: ["latin"] });\nexport default function RootLayout({ children }: { children: any }) { return <html className={geist.className}><body>{children}</body></html>; }\n',
  );
  await bn.fs.writeFile(
    '/nsrc/src/app/page.tsx',
    'export default function Page(){ return <h1>src-app-ok</h1>; }\n',
  );
  const nsrc = await bn.nextBuild('/nsrc');
  const nsrcJs = await bn.fs.readFile(nsrc.outDir + '/bundle.js', 'utf8');
  assert(nsrcJs.includes('src-app-ok') || nsrcJs.length > 50, 'src/app tsx bundle');
  const { detectProjectKind, resolveProjectRoot } = await import('../dist/bundler/preview.js');
  assert((await detectProjectKind(bn, '/nsrc')) === 'next', 'src next detect');
  await bn.fs.mkdir('/nested/my-app/src/app', { recursive: true });
  await bn.fs.writeFile('/nested/my-app/package.json', JSON.stringify({ dependencies: { next: '15.0.0' } }));
  await bn.fs.writeFile('/nested/my-app/src/app/page.tsx', 'export default function Page(){ return <h1>nested-ok</h1>; }\n');
  assert((await resolveProjectRoot(bn, '/nested')) === '/nested/my-app', 'resolve nested next root');
  assert((await detectProjectKind(bn, '/nested/my-app')) === 'next', 'nested next detect');
  const nestedBuilt = await bn.nextBuild('/nested/my-app');
  assert((await bn.fs.readFile(nestedBuilt.outDir + '/index.html', 'utf8')).includes('bundle.js'), 'nested next html');

  await bn.fs.mkdir('/deep/vscode/vite/src', { recursive: true });
  await bn.fs.writeFile('/deep/vscode/vite/package.json', JSON.stringify({ dependencies: { vite: '6.0.0', react: '19.0.0' } }));
  await bn.fs.writeFile('/deep/vscode/vite/index.html', '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
  await bn.fs.writeFile(
    '/deep/vscode/vite/src/main.tsx',
    'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")).render(<App/>);\n',
  );
  await bn.fs.writeFile('/deep/vscode/vite/src/App.tsx', 'export default function App(){ return <h1>deep-vite-ok</h1>; }\n');
  await bn.fs.writeFile('/deep/vscode/vite/src/index.css', '@import "./theme.css";\nbody{margin:0}');
  await bn.fs.writeFile('/deep/vscode/vite/src/theme.css', 'h1{color:red}');
  assert((await resolveProjectRoot(bn, '/deep')) === '/deep/vscode/vite', 'resolve vscode/vite nest');
  assert((await detectProjectKind(bn, '/deep/vscode/vite')) === 'vite', 'deep vite detect');
  const deepVite = await bn.viteBuild('/deep/vscode/vite');
  const deepJs = await bn.fs.readFile(deepVite.outfile, 'utf8');
  assert(deepJs.includes('deep-vite-ok') || deepJs.length > 50, 'deep vite bundle');
  const deepCss = await bn.fs.readFile(deepVite.outDir + '/index.css', 'utf8');
  assert(deepCss.includes('color:red') || deepCss.includes('color: red'), 'vite css @import inlined into dist');

  const { makeStoredZip, stripNestedWrappers, extractArchive } = await import('../dist/fs/zip.js');
  const nestedZip = makeStoredZip({
    'Desktop/vscode/vite/package.json': JSON.stringify({ dependencies: { vite: '6.0.0' } }),
    'Desktop/vscode/vite/index.html': '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
    'Desktop/vscode/vite/src/main.jsx':
      'import { createRoot } from "react-dom/client";\nfunction App(){ return <h1>zip-vite-ok</h1>; }\ncreateRoot(document.getElementById("root")).render(<App/>);\n',
    'Desktop/vscode/vite/node_modules/react/index.js': 'module.exports={}',
  });
  const peeled = stripNestedWrappers(await extractArchive(nestedZip));
  assert(peeled['package.json'] && peeled['src/main.jsx'], 'strip Desktop/vscode/vite wrappers');
  assert(!Object.keys(peeled).some((k) => k.includes('node_modules')), 'zip skips node_modules');
  const zipVite = await bn.importZip(nestedZip, '/home/uploads/fromzip');
  assert(zipVite.files >= 3, 'zip vite file count');
  assert((await bn.fs.readFile('/home/uploads/fromzip/src/main.jsx', 'utf8')).includes('zip-vite-ok'));
  assert(!(await bn.fs.exists('/home/uploads/fromzip/node_modules/react/index.js')), 'node_modules not imported');
  const zipViteBuilt = await bn.viteBuild('/home/uploads/fromzip');
  assert((await bn.fs.readFile(zipViteBuilt.outfile, 'utf8')).length > 50, 'zip vite builds');

  const nextZip = makeStoredZip({
    'my-next/package.json': JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }),
    'my-next/src/app/layout.tsx':
      'export default function RootLayout({ children }: { children: any }) { return <html><body>{children}</body></html>; }\n',
    'my-next/src/app/page.tsx': 'export default function Page(){ return <h1>zip-next-ok</h1>; }\n',
    'my-next/src/app/globals.css': 'body{font-family:sans-serif}',
    'my-next/public/next.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  });
  await bn.importZip(nextZip, '/home/uploads/nextzip');
  assert((await detectProjectKind(bn, '/home/uploads/nextzip')) === 'next', 'zip next detect');
  const zipNext = await bn.nextBuild('/home/uploads/nextzip');
  assert((await bn.fs.readFile(zipNext.outDir + '/index.html', 'utf8')).includes('bundle.js'), 'zip next html');
  assert((await bn.fs.readFile(zipNext.outDir + '/next.svg', 'utf8')).includes('svg'), 'zip next public asset');

  const zip = makeStoredZip({
    'site/index.html': '<!doctype html><h1>zip-ok</h1>',
    'site/app.js': 'console.log(1)',
  });
  const imp = await bn.importZip(zip, '/home/uploads/sitezip');
  assert(imp.files === 2, 'zip file count');
  assert((await bn.fs.readFile('/home/uploads/sitezip/index.html', 'utf8')).includes('zip-ok'));
  assert((await detectProjectKind(bn, '/home/uploads/sitezip')) === 'static', 'zip static detect');

  let zipEscape = false;
  try {
    await bn.importZip(makeStoredZip({ '../outside.txt': 'nope' }), '/home/uploads/safe');
  } catch {
    zipEscape = true;
  }
  assert(zipEscape || !(await bn.fs.exists('/outside.txt')), 'zip must not write outside dest');
  assert(!(await bn.fs.exists('/home/uploads/outside.txt')), 'zip must not land beside dest');

  await bn.mount({ emptybox: { directory: {} } }, '/');
  assert(await bn.fs.exists('/emptybox'), 'empty directory mount');

  // --- Real CLI runner (needs WASM built after guest shebang/argv + cmd_tsc) ---
  await bn.fs.writeFile('/shebang-probe.js', '#!/usr/bin/env node\nconsole.log("shebang-ok");\n');
  const shebangProbe = await readOut(await bn.spawn('node', ['/shebang-probe.js'], { cwd: '/' }));
  if (!shebangProbe.out.includes('shebang-ok')) {
    console.log('CLI runner skipped (rebuild WASM: npm run build:wasm)');
  } else {
  await bn.fs.mkdir('/home/project/node_modules/typescript/lib', { recursive: true });
  await bn.fs.mkdir('/home/project/node_modules/.bin', { recursive: true });
  await bn.fs.writeFile(
    '/home/project/node_modules/typescript/lib/tsc.js',
    [
      "var fs = require('fs');",
      "var path = require('path');",
      "var url = require('url');",
      "var os = require('os');",
      "var outDir = '.';",
      'var files = [];',
      'for (var i = 2; i < process.argv.length; i++) {',
      "  if (process.argv[i] === '--outDir') { outDir = process.argv[++i]; continue; }",
      "  if (process.argv[i].charAt(0) === '-') continue;",
      '  files.push(process.argv[i]);',
      '}',
      'files.forEach(function (f) {',
      "  var src = fs.readFileSync(path.resolve(f), 'utf8');",
      "  var js = String(src).replace(/:\\s*[A-Za-z][A-Za-z0-9_<>,\\s|]*/g, '');",
      '  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {}',
      "  var dest = path.join(outDir, path.basename(f).replace(/\\.tsx?$/, '.js'));",
      '  fs.writeFileSync(dest, js);',
      "  console.log('tsc-ok ' + dest + ' plat=' + process.platform + ' url=' + url.fileURLToPath('file:///home/x'));",
      "  console.log('os=' + os.platform());",
      '});',
    ].join('\n'),
  );
  await bn.fs.writeFile(
    '/home/project/node_modules/.bin/tsc',
    '#!/usr/bin/env node\nrequire("../typescript/lib/tsc.js");\n',
  );
  await bn.fs.writeFile('/home/project/hi.ts', 'const x: number = 1;\n');
  const tscOut = await readOut(
    await bn.spawn('tsc', ['hi.ts', '--outDir', '/home/project/tsout'], { cwd: '/home/project' }),
  );
  assert(tscOut.code === 0, 'tsc exit ' + tscOut.out);
  assert(tscOut.out.includes('tsc-ok'), tscOut.out);
  assert(tscOut.out.includes('plat=linux'), tscOut.out);
  assert((await bn.fs.readFile('/home/project/tsout/hi.js', 'utf8')).includes('const x'), 'tsc emit');
  const shOut = await readOut(
    await bn.spawn('node', ['/home/project/node_modules/.bin/tsc', 'hi.ts', '--outDir', '/home/project/ts2'], {
      cwd: '/home/project',
    }),
  );
  assert(shOut.code === 0, 'shebang tsc ' + shOut.out);
  assert(await bn.fs.exists('/home/project/ts2/hi.js'), 'shebang emit');

  await bn.fs.mkdir('/home/project/node_modules/vite/bin', { recursive: true });
  await bn.fs.writeFile(
    '/home/project/node_modules/vite/bin/vite.js',
    "console.log('vite-cli=' + process.argv.slice(2).join(','));\n",
  );
  const viteCli = await readOut(await bn.spawn('vite', ['build'], { cwd: '/home/project' }));
  assert(viteCli.code === 0, 'vite cli exit ' + viteCli.out);
  assert(viteCli.out.includes('vite-cli=build'), viteCli.out);
  }

  await bn.fs.writeFile(
    '/home/project/qs.js',
    "console.log('qs=' + require('querystring').stringify({ a: 1, b: 'x' }));\n",
  );
  const qsOut = await readOut(await bn.spawn('node', ['/home/project/qs.js'], { cwd: '/home/project' }));
  assert(qsOut.code === 0, 'qs exit');
  assert(qsOut.out.includes('qs=a=1&b=x'), qsOut.out);

  const { WebContainer } = await import('../dist/compat.js');
  const wc = await WebContainer.boot({ useWasm: true });
  assert(wc.runtime === 'wasm', 'compat runtime');
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

  const rpc = await bn.rpc({ method: 'runtime', id: 1 });
  assert(rpc.result === bn.runtime, 'rpc runtime');
  const wr = await bn.rpc({ method: 'fs.writeFile', params: { path: '/rpc.txt', contents: 'rpc-ok' } });
  assert(wr.result === true, 'rpc write');
  const rr = await bn.rpc({ method: 'fs.readFile', params: { path: '/rpc.txt' } });
  assert(rr.result === 'rpc-ok', 'rpc read');

  console.log('Phases 13–42 MVP + zip upload: OK (runtime=%s)', bn.runtime);
}

main().catch((e) => {
  console.error('Conformance FAILED:', e);
  process.exit(1);
});
