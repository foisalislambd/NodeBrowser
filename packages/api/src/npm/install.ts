import type { NodeBrowser } from '../host/node-browser.js';
import { binRelTarget, makeBinShim, parseBinField } from './bin.js';
import { assertAllowedFetchUrl } from '../net/egress.js';
import { parseTar } from '../fs/zip.js';

export type InstallProgress = {
  phase: 'resolve' | 'fetch' | 'extract' | 'bin' | 'lifecycle' | 'done' | 'summary';
  name: string;
  version?: string;
  message?: string;
  streamed?: boolean;
};

export type InstallResult = {
  added: number;
  skipped: number;
  elapsedMs: number;
  packages: { name: string; version: string }[];
};

type OnProgress = (p: InstallProgress) => void;

type PacoteVersion = {
  version: string;
  dist: { tarball: string; integrity?: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  bundledDependencies?: string[] | boolean;
  bundleDependencies?: string[] | boolean;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
};

type RegistryMeta = {
  'dist-tags': { latest: string };
  versions: Record<string, PacoteVersion>;
};

const memoryCache = new Map<string, Uint8Array>();
let npmCacheHits = 0;
let npmCacheMisses = 0;

export function npmCacheStats(): { hits: number; misses: number } {
  return { hits: npmCacheHits, misses: npmCacheMisses };
}

const MAX_DEPTH = 32;
const FETCH_CONCURRENCY = 8;
const LIFECYCLE_ALLOW = new Set(['true', 'echo', 'node']);
const SKIP_OPTIONAL =
  /^(fsevents$|@esbuild\/|@rollup\/rollup-|@swc\/core-|@img\/sharp|esbuild$|nice-napi$)/;

const metaCache = new Map<string, RegistryMeta>();

export async function installPackage(
  bn: NodeBrowser,
  spec: string,
  cwd = '/',
  opts?: {
    onProgress?: OnProgress;
    withDeps?: boolean;
    signal?: AbortSignal;
    saveDev?: boolean;
  },
): Promise<InstallResult> {
  const withDeps = opts?.withDeps !== false;
  const started = Date.now();
  const seen = new Set<string>();
  const lock: Record<string, { version: string; resolved?: string }> = {};
  const added: { name: string; version: string }[] = [];
  await installOne(bn, spec, cwd, 0, seen, withDeps, opts?.onProgress, opts?.signal, lock, added);
  await writeLockfile(bn, cwd, lock);
  if (spec && spec !== '.') await saveManifestDep(bn, cwd, spec, !!opts?.saveDev);
  const elapsedMs = Date.now() - started;
  opts?.onProgress?.({
    phase: 'summary',
    name: spec,
    message: formatSummary(added.length, elapsedMs),
  });
  return { added: added.length, skipped: 0, elapsedMs, packages: added };
}

export async function installMany(
  bn: NodeBrowser,
  specs: string[],
  cwd = '/',
  opts?: {
    onProgress?: OnProgress;
    signal?: AbortSignal;
    saveDev?: boolean;
  },
): Promise<InstallResult> {
  const started = Date.now();
  const seen = new Set<string>();
  const lock: Record<string, { version: string; resolved?: string }> = {};
  const added: { name: string; version: string }[] = [];
  let list = specs;
  if (!list.length) list = await manifestDeps(bn, cwd);
  if (!list.length) {
    const elapsedMs = Date.now() - started;
    opts?.onProgress?.({
      phase: 'summary',
      name: '.',
      message: 'up to date, audited 1 package in ' + fmtSec(elapsedMs),
    });
    return { added: 0, skipped: 0, elapsedMs, packages: [] };
  }
  for (const spec of list) {
    await installOne(bn, spec, cwd, 0, seen, true, opts?.onProgress, opts?.signal, lock, added);
    if (specs.length) await saveManifestDep(bn, cwd, spec, !!opts?.saveDev);
  }
  await writeLockfile(bn, cwd, lock);
  const elapsedMs = Date.now() - started;
  opts?.onProgress?.({
    phase: 'summary',
    name: '.',
    message: formatSummary(added.length, elapsedMs),
  });
  return { added: added.length, skipped: 0, elapsedMs, packages: added };
}

export async function uninstallPackages(bn: NodeBrowser, names: string[], cwd: string): Promise<number> {
  let n = 0;
  for (const raw of names) {
    const { name } = parseSpec(raw);
    const dest = joinPath(cwd, 'node_modules', name);
    try {
      await bn.fs.rm(dest, { recursive: true });
      n++;
    } catch {
      /* missing */
    }
    await dropManifestDep(bn, cwd, name);
  }
  return n;
}

export async function listInstalled(
  bn: NodeBrowser,
  cwd: string,
): Promise<{ name: string; version: string }[]> {
  const root = joinPath(cwd, 'node_modules');
  const out: { name: string; version: string }[] = [];
  let names: string[] = [];
  try {
    names = await bn.fs.readdir(root);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name || name.startsWith('.') || name === '.bin') continue;
    if (name.startsWith('@')) {
      let scoped: string[] = [];
      try {
        scoped = await bn.fs.readdir(joinPath(root, name));
      } catch {
        continue;
      }
      for (const child of scoped) {
        const ver = await readPkgVersion(bn, joinPath(root, name, child));
        if (ver) out.push({ name: `${name}/${child}`, version: ver });
      }
      continue;
    }
    const ver = await readPkgVersion(bn, joinPath(root, name));
    if (ver) out.push({ name, version: ver });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function readPkgVersion(bn: NodeBrowser, dest: string): Promise<string | null> {
  try {
    const meta = JSON.parse(await bn.fs.readFile(joinPath(dest, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return meta.version || null;
  } catch {
    return null;
  }
}

async function manifestDeps(bn: NodeBrowser, cwd: string): Promise<string[]> {
  try {
    const raw = await bn.fs.readFile(joinPath(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const out: string[] = [];
    for (const [name, range] of Object.entries(pkg.dependencies || {})) out.push(`${name}@${range}`);
    for (const [name, range] of Object.entries(pkg.devDependencies || {})) out.push(`${name}@${range}`);
    return out;
  } catch {
    return [];
  }
}

async function saveManifestDep(bn: NodeBrowser, cwd: string, spec: string, saveDev: boolean): Promise<void> {
  const { name, version } = parseSpec(spec);
  if (isUnsupportedSpec(version)) return;
  const path = joinPath(cwd, 'package.json');
  let pkg: {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = {};
  try {
    pkg = JSON.parse(await bn.fs.readFile(path, 'utf8')) as typeof pkg;
  } catch {
    pkg = { name: 'project', version: '1.0.0' };
  }
  const installed = (await readPkgVersion(bn, joinPath(cwd, 'node_modules', name))) || version;
  let range: string;
  if (version === 'latest' || version === '*') range = `^${installed}`;
  else if (spec.includes('@') && spec !== name) range = version;
  else range = `^${installed}`;
  const field = saveDev ? 'devDependencies' : 'dependencies';
  const other = saveDev ? 'dependencies' : 'devDependencies';
  pkg[field] = pkg[field] || {};
  pkg[field]![name] = range;
  if (pkg[other]) delete pkg[other]![name];
  await bn.fs.writeFile(path, JSON.stringify(pkg, null, 2) + '\n');
}

async function dropManifestDep(bn: NodeBrowser, cwd: string, name: string): Promise<void> {
  const path = joinPath(cwd, 'package.json');
  try {
    const pkg = JSON.parse(await bn.fs.readFile(path, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (pkg.dependencies) delete pkg.dependencies[name];
    if (pkg.devDependencies) delete pkg.devDependencies[name];
    await bn.fs.writeFile(path, JSON.stringify(pkg, null, 2) + '\n');
  } catch {
    /* no manifest */
  }
}

async function writeLockfile(
  bn: NodeBrowser,
  cwd: string,
  lock: Record<string, { version: string; resolved?: string }>,
): Promise<void> {
  const path = joinPath(cwd, 'package-lock.json');
  let existing: {
    name?: string;
    lockfileVersion?: number;
    requires?: boolean;
    packages?: Record<string, unknown>;
  } = {
    lockfileVersion: 3,
    requires: true,
    packages: {},
  };
  try {
    existing = JSON.parse(await bn.fs.readFile(path, 'utf8'));
  } catch {
    /* new */
  }
  existing.lockfileVersion = 3;
  existing.requires = true;
  existing.packages = existing.packages || {};
  (existing.packages as Record<string, unknown>)[''] = existing.packages[''] || {};
  for (const [name, info] of Object.entries(lock)) {
    (existing.packages as Record<string, unknown>)['node_modules/' + name] = {
      version: info.version,
      resolved: info.resolved,
    };
  }
  await bn.fs.writeFile(path, JSON.stringify(existing, null, 2) + '\n');
}

async function linkBins(bn: NodeBrowser, cwd: string, pkgName: string, destRoot: string): Promise<void> {
  let meta: { name?: string; bin?: unknown } = {};
  try {
    meta = JSON.parse(await bn.fs.readFile(joinPath(destRoot, 'package.json'), 'utf8'));
  } catch {
    return;
  }
  const bins = parseBinField(meta.name || pkgName, meta.bin);
  const binDir = joinPath(cwd, 'node_modules', '.bin');
  await bn.fs.mkdir(binDir, { recursive: true });
  for (const [name, file] of Object.entries(bins)) {
    const shim = makeBinShim(binRelTarget(pkgName, file));
    await bn.fs.writeFile(joinPath(binDir, name), shim);
  }
}

async function runLifecycle(
  bn: NodeBrowser,
  destRoot: string,
  scriptName: string,
  onProgress?: OnProgress,
): Promise<void> {
  let scripts: Record<string, string> = {};
  try {
    const meta = JSON.parse(await bn.fs.readFile(joinPath(destRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    scripts = meta.scripts || {};
  } catch {
    return;
  }
  const cmd = scripts[scriptName];
  if (!cmd) return;
  const first = cmd.trim().split(/\s+/)[0] || '';
  const base = first.split('/').pop() || first;
  if (LIFECYCLE_ALLOW.has(base)) {
    onProgress?.({ phase: 'lifecycle', name: scriptName, message: cmd });
    const proc = await bn.spawn('sh', ['-c', cmd], { cwd: destRoot });
    await proc.exit;
    return;
  }
  onProgress?.({
    phase: 'resolve',
    name: scriptName,
    message: `skipped ${scriptName}: ${cmd}`,
  });
}

async function installOne(
  bn: NodeBrowser,
  spec: string,
  cwd: string,
  depth: number,
  seen: Set<string>,
  withDeps: boolean,
  onProgress?: OnProgress,
  signal?: AbortSignal,
  lock?: Record<string, { version: string; resolved?: string }>,
  added?: { name: string; version: string }[],
): Promise<void> {
  if (signal?.aborted) throw new Error('install cancelled');
  if (depth > MAX_DEPTH) return;
  const { name, version: want } = parseSpec(spec);
  if (isUnsupportedSpec(want) || isUnsupportedSpec(name)) {
    onProgress?.({ phase: 'resolve', name, message: `skipped unsupported spec ${spec}` });
    return;
  }
  const rangeKey = `${name}@${want}`;
  if (seen.has(rangeKey)) return;
  seen.add(rangeKey);

  onProgress?.({ phase: 'resolve', name, message: name });
  const meta = await fetchMeta(name);
  const ver =
    want === 'latest' || want === '*' || looksLikeRange(want) ? pickVersion(meta, want) : want;
  const verMeta = meta.versions[ver];
  if (!verMeta) throw new Error(`version not found: ${name}@${ver}`);
  const resolvedKey = `${name}@${verMeta.version}`;
  if (seen.has(resolvedKey)) return;
  seen.add(resolvedKey);
  if (lock) lock[name] = { version: verMeta.version, resolved: verMeta.dist.tarball };

  const destRoot = joinPath(cwd, 'node_modules', name);
  const have = await readPkgVersion(bn, destRoot);
  if (have === verMeta.version) {
    onProgress?.({ phase: 'done', name, version: verMeta.version, message: 'already installed' });
  } else {
    const cacheKey = verMeta.dist.integrity || `${name}@${verMeta.version}`;
    const buf = await fetchTarball(verMeta.dist.tarball, cacheKey);
    onProgress?.({
      phase: 'fetch',
      name,
      version: verMeta.version,
      message: `http fetch GET 200 ${name}@${verMeta.version}`,
    });
    onProgress?.({ phase: 'extract', name, version: verMeta.version });
    await extractTarball(bn, buf, destRoot);
    onProgress?.({ phase: 'bin', name, version: verMeta.version });
    await linkBins(bn, cwd, name, destRoot);
    await runLifecycle(bn, destRoot, 'preinstall', onProgress);
    await runLifecycle(bn, destRoot, 'postinstall', onProgress);
    added?.push({ name, version: verMeta.version });
    onProgress?.({ phase: 'done', name, version: verMeta.version, message: `+ ${name}@${verMeta.version}` });
  }

  if (!withDeps) return;
  await installDeps(bn, cwd, depth, seen, verMeta, onProgress, signal, lock, added);
}

async function installDeps(
  bn: NodeBrowser,
  cwd: string,
  depth: number,
  seen: Set<string>,
  verMeta: PacoteVersion,
  onProgress?: OnProgress,
  signal?: AbortSignal,
  lock?: Record<string, { version: string; resolved?: string }>,
  added?: { name: string; version: string }[],
): Promise<void> {
  const deps: [string, string, boolean][] = [];
  for (const [dep, range] of Object.entries(verMeta.dependencies || {})) {
    deps.push([dep, range, false]);
  }
  for (const [dep, range] of Object.entries(verMeta.optionalDependencies || {})) {
    deps.push([dep, range, true]);
  }
  if (verMeta.peerDependencies) {
    onProgress?.({
      phase: 'resolve',
      name: Object.keys(verMeta.peerDependencies).join(','),
      message:
        'peer deps: ' +
        Object.keys(verMeta.peerDependencies).join(', ') +
        ' (not auto-installed)',
    });
  }
  await mapPool(deps, FETCH_CONCURRENCY, async ([dep, range, optional]) => {
    const skipNative = SKIP_OPTIONAL.test(dep);
    if (skipNative) {
      onProgress?.({ phase: 'resolve', name: dep, message: `optional skipped: native ${dep}` });
      return;
    }
    try {
      await installOne(bn, `${dep}@${range}`, cwd, depth + 1, seen, true, onProgress, signal, lock, added);
    } catch (e) {
      if (!optional) throw e;
      onProgress?.({
        phase: 'resolve',
        name: dep,
        message: 'optional skipped: ' + (e instanceof Error ? e.message : String(e)),
      });
    }
  });
}

async function extractTarball(bn: NodeBrowser, buf: Uint8Array, destRoot: string): Promise<void> {
  try {
    await bn.fs.rm(destRoot, { recursive: true });
  } catch {
    /* missing */
  }
  await bn.fs.mkdir(destRoot, { recursive: true });
  const tar = await gunzip(buf);
  if (typeof bn.extractTar === 'function') {
    await bn.extractTar(tar, destRoot);
    await hoistPackagePrefix(bn, destRoot);
    return;
  }
  const files = parseTar(tar);
  for (const [path, content] of Object.entries(files)) {
    const rel = path.replace(/^package\//, '');
    if (!rel || rel.endsWith('/')) continue;
    await bn.fs.writeFile(joinPath(destRoot, rel), content);
  }
}

async function hoistPackagePrefix(bn: NodeBrowser, destRoot: string): Promise<void> {
  const inner = joinPath(destRoot, 'package');
  let names: string[] = [];
  try {
    names = await bn.fs.readdir(inner);
  } catch {
    return;
  }
  for (const n of names) {
    if (!n || n === '.' || n === '..') continue;
    const from = joinPath(inner, n);
    const to = joinPath(destRoot, n);
    try {
      await bn.fs.rm(to, { recursive: true });
    } catch {
      /* missing */
    }
    await bn.fs.rename(from, to);
  }
  try {
    await bn.fs.rm(inner, { recursive: true });
  } catch {
    /* ignore */
  }
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (!items.length) return;
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function formatSummary(added: number, ms: number): string {
  const word = added === 1 ? 'package' : 'packages';
  return `added ${added} ${word} in ${fmtSec(ms)}`;
}

function fmtSec(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}

function looksLikeRange(v: string): boolean {
  return /^[\^~><=*]/.test(v) || v.includes('||') || v.includes('x') || v.includes('X') || v.includes(' ');
}

function isUnsupportedSpec(v: string): boolean {
  return /^(file:|git\+|github:|gitlab:|bitbucket:|workspace:|link:|http:\/\/)/i.test(v);
}

function parseSemver(v: string): [number, number, number] | null {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmpSemver(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function rangeSatisfied(version: string, range: string): boolean {
  const p = parseSemver(version);
  if (!p) return version === range;
  if (!range || range === '*' || range === 'x') return true;
  const parts = range.split('||').map((s) => s.trim());
  return parts.some((part) => oneRangeSatisfied(p, part));
}

function oneRangeSatisfied(p: [number, number, number], range: string): boolean {
  const r = range.replace(/\s+/g, ' ').trim();
  if (!r || r === '*' || r === 'x' || r === 'X') return true;
  const andParts = r.split(' ').filter(Boolean);
  if (andParts.length > 1 && andParts.some((x) => /^[\^~><=]/.test(x))) {
    return andParts.every((part) => oneRangeSatisfied(p, part));
  }
  if (r.startsWith('^') || r.startsWith('~')) {
    const caret = r.startsWith('^');
    const base = parseSemver(r.slice(1));
    if (!base) return false;
    if (p[0] !== base[0]) return false;
    if (!caret) return p[1] === base[1] && p[2] >= base[2];
    if (base[0] === 0) {
      if (base[1] === 0) return p[1] === 0 && p[2] === base[2];
      return p[1] === base[1] && p[2] >= base[2];
    }
    return p[1] > base[1] || (p[1] === base[1] && p[2] >= base[2]);
  }
  const ge = r.match(/^(>=|<=|>|<|=)\s*(\d+\.\d+\.\d+)/);
  if (ge) {
    const b = parseSemver(ge[2]!);
    if (!b) return false;
    const d = cmpSemver(p, b);
    if (ge[1] === '>=') return d >= 0;
    if (ge[1] === '<=') return d <= 0;
    if (ge[1] === '>') return d > 0;
    if (ge[1] === '<') return d < 0;
    return d === 0;
  }
  const exact = parseSemver(r);
  if (exact) return cmpSemver(p, exact) === 0;
  return r === `${p[0]}.${p[1]}.${p[2]}`;
}

function pickVersion(meta: RegistryMeta, range: string): string {
  if (!range || range === 'latest' || range === '*') return meta['dist-tags'].latest;
  const or = range.split('||').map((s) => s.trim());
  if (or.length > 1) {
    let best: string | null = null;
    for (const part of or) {
      const hit = pickVersion(meta, part);
      if (!best || (parseSemver(hit) && parseSemver(best) && cmpSemver(parseSemver(hit)!, parseSemver(best)!) > 0)) {
        best = hit;
      }
    }
    return best || meta['dist-tags'].latest;
  }
  const versions = Object.keys(meta.versions)
    .map((v) => ({ v, p: parseSemver(v) }))
    .filter((x): x is { v: string; p: [number, number, number] } => x.p != null)
    .sort((a, b) => cmpSemver(a.p, b.p));
  const match = versions.filter(({ p }) => oneRangeSatisfied(p, range));
  return match.length ? match[match.length - 1]!.v : meta['dist-tags'].latest;
}

export function parseSpec(spec: string): { name: string; version: string } {
  const trimmed = spec.trim();
  if (trimmed.startsWith('@')) {
    const i = trimmed.indexOf('@', 1);
    if (i === -1) return { name: trimmed, version: 'latest' };
    return { name: trimmed.slice(0, i), version: trimmed.slice(i + 1) || 'latest' };
  }
  const i = trimmed.indexOf('@');
  if (i === -1) return { name: trimmed, version: 'latest' };
  return { name: trimmed.slice(0, i), version: trimmed.slice(i + 1) || 'latest' };
}

function registryUrl(name: string): string {
  if (name.startsWith('@')) {
    const [scope, pkg] = name.split('/');
    return `https://registry.npmjs.org/${scope}%2F${pkg}`;
  }
  return `https://registry.npmjs.org/${encodeURIComponent(name)}`;
}

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

async function fetchMeta(name: string): Promise<RegistryMeta> {
  const hit = metaCache.get(name);
  if (hit) return hit;
  const url = registryUrl(name);
  assertAllowedFetchUrl(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`npm meta failed ${url}: ${res.status}`);
  const meta = (await res.json()) as RegistryMeta;
  metaCache.set(name, meta);
  return meta;
}

async function fetchTarball(url: string, cacheKey: string): Promise<Uint8Array> {
  assertAllowedFetchUrl(url);
  if (memoryCache.has(cacheKey)) {
    npmCacheHits++;
    return memoryCache.get(cacheKey)!;
  }

  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open('browsernode-npm-v1');
      const hit = await cache.match(url);
      if (hit) {
        const ab = new Uint8Array(await hit.arrayBuffer());
        npmCacheHits++;
        memoryCache.set(cacheKey, ab);
        return ab;
      }
    } catch {
      /* Cache API unavailable — network fetch below */
    }
  }

  npmCacheMisses++;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tarball fetch failed: ${res.status}`);
  const ab = new Uint8Array(await res.arrayBuffer());
  memoryCache.set(cacheKey, ab);
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open('browsernode-npm-v1');
      await cache.put(url, new Response(ab, { headers: { 'Content-Type': 'application/octet-stream' } }));
    } catch {
      /* ignore persist failure */
    }
  }
  return ab;
}
