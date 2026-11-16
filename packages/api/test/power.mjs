/**
 * V8 guest, scoped-package hoist, and the persistent tarball cache.
 */
import { NodeBrowser } from '../dist/index.js';
import { fetchTarball, hoistNpmPackageRoot, lastNpmFetchFromCache } from '../dist/npm/install.js';
import { writeNpmTarballCache } from '../dist/fs/opfs.js';

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

function ustar(files) {
  const blocks = [];
  const enc = new TextEncoder();
  for (const f of files) {
    const data = enc.encode(f.data);
    const header = new Uint8Array(512);
    header.set(enc.encode(f.path), 0);
    const sizeOct = data.length.toString(8).padStart(11, '0') + '\0';
    header.set(enc.encode(sizeOct), 124);
    header[156] = '0'.charCodeAt(0);
    header.set(enc.encode('ustar\0'), 257);
    header.set(enc.encode('00'), 263);
    for (let i = 148; i < 156; i++) header[i] = 0x20;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.set(enc.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
    blocks.push(header, data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(1024));
  let n = 0;
  for (const b of blocks) n += b.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const b of blocks) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

async function main() {
  const bn = await NodeBrowser.boot({ useWasm: true, guestEngine: 'v8' });
  assert(bn.guestEngine === 'v8', 'guest engine');
  await bn.fs.mkdir('/home/project', { recursive: true });

  await bn.fs.writeFile(
    '/home/project/als.js',
    [
      "const { AsyncLocalStorage } = require('async_hooks');",
      'const als = new AsyncLocalStorage();',
      'als.run({ v: 7 }, () => {',
      '  Promise.resolve().then(() => {',
      '    const s = als.getStore();',
      "    console.log('p:' + (s && s.v));",
      '  });',
      '  setTimeout(() => {',
      '    const s = als.getStore();',
      "    console.log('t:' + (s && s.v));",
      '  }, 0);',
      '});',
    ].join('\n'),
  );
  const als = await readOut(await bn.spawn('node', ['/home/project/als.js']));
  assert(als.code === 0, 'als exit ' + als.code + ' ' + als.out);
  assert(als.out.includes('p:7'), 'promise als ' + als.out);
  assert(als.out.includes('t:7'), 'timer als ' + als.out);

  await bn.fs.writeFile(
    '/home/project/stack.js',
    [
      'Error.prepareStackTrace = function(_e, stack) { return stack; };',
      'const o = {};',
      'Error.captureStackTrace(o);',
      "console.log(Array.isArray(o.stack) && typeof o.stack[0].getFileName === 'function' ? 'sites' : 'no');",
    ].join('\n'),
  );
  const stack = await readOut(await bn.spawn('node', ['/home/project/stack.js']));
  assert(stack.code === 0 && stack.out.includes('sites'), 'callsite ' + stack.out);

  await bn.fs.mkdir('/home/project/esm', { recursive: true });
  await bn.fs.writeFile('/home/project/esm/a.mjs', 'export const n = 3;\nexport function f(){ return 4; }\n');
  await bn.fs.writeFile(
    '/home/project/esm/b.mjs',
    "export * from './a.mjs';\nexport { f as g } from './a.mjs';\n",
  );
  await bn.fs.writeFile(
    '/home/project/esm/main.mjs',
    "import { n, g } from './b.mjs';\nconsole.log(String(n + g()));\n",
  );
  const esm = await readOut(await bn.spawn('node', ['/home/project/esm/main.mjs']));
  assert(esm.code === 0 && esm.out.includes('7'), 'esm ' + esm.out + esm.code);

  await bn.fs.mkdir('/home/project/cond/node_modules/pkg', { recursive: true });
  await bn.fs.writeFile(
    '/home/project/cond/node_modules/pkg/package.json',
    JSON.stringify({
      name: 'pkg',
      exports: { '.': { import: './esm.mjs', require: './cjs.cjs' } },
    }),
  );
  await bn.fs.writeFile('/home/project/cond/node_modules/pkg/esm.mjs', "export const side = 'esm';\n");
  await bn.fs.writeFile(
    '/home/project/cond/node_modules/pkg/cjs.cjs',
    "module.exports = { side: 'cjs' };\n",
  );
  await bn.fs.writeFile(
    '/home/project/cond/main.mjs',
    "import { side } from 'pkg';\nconsole.log(side);\n",
  );
  const cond = await readOut(await bn.spawn('node', ['/home/project/cond/main.mjs']));
  assert(cond.code === 0 && cond.out.includes('esm'), 'exports import ' + cond.out);

  await bn.fs.writeFile(
    '/home/project/await.js',
    [
      "const { AsyncLocalStorage } = require('async_hooks');",
      'const als = new AsyncLocalStorage();',
      'als.run({ v: 4 }, async () => {',
      '  await Promise.resolve();',
      '  const s = als.getStore();',
      "  console.log('a:' + (s && s.v));",
      '});',
    ].join('\n'),
  );
  const awaited = await readOut(await bn.spawn('node', ['/home/project/await.js']));
  assert(awaited.code === 0 && awaited.out.includes('a:4'), 'await als ' + awaited.out);

  const bare = '/home/project/node_modules/bare';
  await bn.fs.mkdir(bare, { recursive: true });
  await bn.extractTar(
    ustar([
      { path: 'package/package.json', data: '{"name":"bare"}' },
      { path: 'package/index.js', data: 'module.exports = 1;\n' },
      { path: 'package/bare/package.json', data: '{"name":"nested","version":"9.9.9"}' },
    ]),
    bare,
  );
  await hoistNpmPackageRoot(bn, bare);
  assert(await bn.fs.exists(bare + '/index.js'), 'versionless root stays');
  assert(await bn.fs.exists(bare + '/bare/package.json'), 'nested folder kept');

  const dest = '/home/project/node_modules/@types/ms';
  await bn.fs.mkdir(dest, { recursive: true });
  const tar = ustar([
    { path: 'package/ms/package.json', data: '{"name":"@types/ms","version":"1.0.0"}' },
    { path: 'package/ms/index.d.ts', data: 'export {};\n' },
  ]);
  await bn.extractTar(tar, dest);
  await hoistNpmPackageRoot(bn, dest);
  assert(await bn.fs.exists(dest + '/package.json'), 'hoisted package.json');
  assert(!(await bn.fs.exists(dest + '/ms/package.json')), 'no nested ms/');
  const plain = '/home/project/node_modules/left-pad';
  await bn.fs.mkdir(plain, { recursive: true });
  await bn.extractTar(
    ustar([
      { path: 'package/package.json', data: '{"name":"left-pad","version":"1.0.0"}' },
      { path: 'package/index.js', data: 'module.exports = 1;\n' },
    ]),
    plain,
  );
  await hoistNpmPackageRoot(bn, plain);
  assert(await bn.fs.exists(plain + '/index.js'), 'plain hoist');
  assert(!(await bn.fs.exists(plain + '/left-pad/index.js')), 'plain not double nested');

  const key = 'power-test-tarball';
  const bytes = new Uint8Array([9, 8, 7, 6]);
  await writeNpmTarballCache(key, bytes);
  const origFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('network');
  };
  try {
    const got = await fetchTarball('https://registry.npmjs.org/ms/-/ms-2.1.3.tgz', key);
    assert(!called, 'cache skipped network');
    assert(lastNpmFetchFromCache(), 'cache flag');
    assert(got.length === 4 && got[0] === 9, 'cache bytes');
  } finally {
    globalThis.fetch = origFetch;
  }

  await bn.teardown();

  const { Worker } = await import('node:worker_threads');
  const { createV8Sab } = await import('../dist/kernel/v8-sab.js');
  const { serviceV8Fs } = await import('../dist/kernel/v8-guest-host.js');
  const sab = createV8Sab();
  const files = new Map();
  files.set('/note.txt', new TextEncoder().encode('hi'));
  const fake = {
    create: () => 1,
    destroy() {},
    registerBuiltins() {},
    mkdir: async () => true,
    writeText: async (_k, path, text) => {
      files.set(path, new TextEncoder().encode(text));
      return true;
    },
    writeBytes: async (_k, path, data) => {
      files.set(path, data);
      return true;
    },
    readText: async (_k, path) => {
      const hit = files.get(path);
      return hit ? new TextDecoder().decode(hit) : null;
    },
    readBytes: async (_k, path) => files.get(path) ?? null,
    unlink: async () => true,
    readdir: async () => [],
    exists: async (_k, path) => files.has(path),
    spawn: async () => 0,
    wait: async () => 0,
    kill: async () => false,
    readStdout: async () => '',
    readStderr: async () => '',
    writeStdin: async () => 0,
  };
  const protocol = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sab-worker.mjs', import.meta.url), { workerData: { sab } });
    worker.on('message', (msg) => {
      if (msg.t === 'fs') {
        void serviceV8Fs(fake, 1, sab).catch(reject);
        return;
      }
      if (msg.t === 'done') resolve(msg);
    });
    worker.on('error', reject);
  });
  assert(protocol.missing && protocol.wrote && protocol.same && protocol.empty && protocol.note, 'sab protocol ' + JSON.stringify(protocol));

  console.log('power ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
