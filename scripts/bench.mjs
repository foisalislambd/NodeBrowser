/**
 * Local NodeBrowser timings on this machine.
 *   node scripts/bench.mjs
 *
 * Prints one JSON object. Numbers are medians after one warmup, except boot
 * (three cold boots). This is not a WebContainers comparison.
 */
import { spawn } from 'node:child_process';
import { cpus, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeBrowser, resetKernelCache } from '../packages/api/dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUNDS = 5;
const LOOP_N = 1_000_000;

const CPU_JS = `let n = 0;
for (let i = 0; i < ${LOOP_N}; i++) n = (n + i) % 1000003;
console.log(n);
`;

function median(samples) {
  const xs = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  const value = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return +value.toFixed(1);
}

async function readAll(proc) {
  let out = '';
  for await (const chunk of proc.output) out += chunk;
  const code = await proc.exit;
  return { out: out.trim(), code };
}

async function timeBoot() {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    await resetKernelCache();
    const t0 = performance.now();
    const bn = await NodeBrowser.boot();
    samples.push(performance.now() - t0);
    const runtime = bn.runtime;
    bn.teardown();
    if (i === 2) return { samples, runtime };
  }
  return { samples, runtime: 'unknown' };
}

function hostLoop() {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, ['--input-type=module', '-e', CPU_JS], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => {
      out += c;
    });
    child.stderr.on('data', (c) => {
      err += c;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        ms: performance.now() - t0,
        code,
        out: out.trim(),
        err: err.trim().slice(0, 200),
      });
    });
  });
}

async function repeat(fn) {
  await fn();
  const samples = [];
  for (let i = 0; i < ROUNDS; i++) samples.push(await fn());
  return samples;
}

const boot = await timeBoot();
const bn = await NodeBrowser.boot();

await bn.fs.mkdir('/home/bench', { recursive: true });
await bn.fs.writeFile('/home/bench/mod.js', 'module.exports = { answer: 42 };\n');
await bn.fs.writeFile('/home/bench/req.js', "console.log(require('./mod.js').answer);\n");
await bn.fs.writeFile('/home/bench/cpu.js', CPU_JS);

const blob = 'x'.repeat(64 * 1024);

const spawnSamples = await repeat(async () => {
  const t0 = performance.now();
  const proc = await bn.spawn('node', ['-e', "console.log('ok')"], { cwd: '/home/bench' });
  const result = await readAll(proc);
  if (result.code !== 0 || !result.out.includes('ok')) {
    throw new Error('spawn failed: ' + JSON.stringify(result));
  }
  return performance.now() - t0;
});

const fsSamples = await repeat(async () => {
  const t0 = performance.now();
  await bn.fs.writeFile('/home/bench/blob.txt', blob);
  const back = await bn.fs.readFile('/home/bench/blob.txt', 'utf8');
  if (back.length !== blob.length) throw new Error('blob length ' + back.length);
  return performance.now() - t0;
});

const manySamples = await repeat(async () => {
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) {
    await bn.fs.writeFile(`/home/bench/f${i}.txt`, 'hello ' + i);
  }
  return performance.now() - t0;
});

const requireSamples = await repeat(async () => {
  const t0 = performance.now();
  const proc = await bn.spawn('node', ['/home/bench/req.js'], { cwd: '/home/bench' });
  const result = await readAll(proc);
  if (result.code !== 0 || result.out !== '42') {
    throw new Error('require failed: ' + JSON.stringify(result));
  }
  return performance.now() - t0;
});

const guestCpuSamples = await repeat(async () => {
  const t0 = performance.now();
  const proc = await bn.spawn('node', ['/home/bench/cpu.js'], { cwd: '/home/bench' });
  const result = await readAll(proc);
  if (result.code !== 0) throw new Error('guest cpu failed: ' + JSON.stringify(result));
  return { ms: performance.now() - t0, out: result.out };
});

const hostCpuSamples = [];
let hostOut = '';
for (let i = 0; i < ROUNDS + 1; i++) {
  const result = await hostLoop();
  if (result.code !== 0) throw new Error('host cpu failed: ' + result.err);
  hostOut = result.out;
  if (i > 0) hostCpuSamples.push(result.ms);
}

function hostLoopInProcess() {
  const t0 = performance.now();
  let n = 0;
  for (let i = 0; i < LOOP_N; i++) n = (n + i) % 1000003;
  return { ms: performance.now() - t0, out: String(n) };
}

const hostInlineSamples = [];
let hostInlineOut = '';
for (let i = 0; i < ROUNDS + 1; i++) {
  const result = hostLoopInProcess();
  hostInlineOut = result.out;
  if (i > 0) hostInlineSamples.push(result.ms);
}

const guestOut = guestCpuSamples[0].out;
if (guestOut !== hostOut || guestOut !== hostInlineOut) {
  throw new Error(`checksum mismatch guest=${guestOut} host=${hostOut} inline=${hostInlineOut}`);
}

const guestCpuMs = median(guestCpuSamples.map((s) => s.ms));
const hostCpuMs = median(hostCpuSamples);
const hostInlineMs = median(hostInlineSamples);
const wasmPath = join(root, 'packages/api/wasm/browsernode_kernel.wasm');
const cpu = cpus()[0];

const report = {
  date: new Date().toISOString().slice(0, 10),
  machine: {
    node: process.version,
    platform: `${platform()} ${release()}`,
    arch: process.arch,
    cpu: cpu?.model?.trim() || 'unknown',
    cores: cpus().length,
    ramGiB: +(totalmem() / 1024 ** 3).toFixed(1),
  },
  runtime: bn.runtime,
  wasmBytes: statSync(wasmPath).size,
  rounds: ROUNDS,
  checks: {
    boot: { ok: bn.runtime === 'wasm', medianMs: median(boot.samples) },
    spawnNode: { ok: true, medianMs: median(spawnSamples), what: "node -e console.log('ok')" },
    fsRoundtrip64KiB: { ok: true, medianMs: median(fsSamples) },
    write100Files: { ok: true, medianMs: median(manySamples) },
    requireLocal: { ok: true, medianMs: median(requireSamples), what: 'require ./mod.js → 42' },
    loop1e6: {
      ok: true,
      checksum: guestOut,
      guestSpawnMedianMs: guestCpuMs,
      hostProcessMedianMs: hostCpuMs,
      hostInProcessMedianMs: hostInlineMs,
      guestOverHostProcess: +(guestCpuMs / hostCpuMs).toFixed(1),
      guestOverHostLoop: +(guestCpuMs / hostInlineMs).toFixed(1),
    },
  },
};

console.log(JSON.stringify(report, null, 2));
bn.teardown();
