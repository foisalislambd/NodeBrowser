import type { NodeBrowser } from './index.js';
import { binRelTarget, makeBinShim, parseBinField } from './npm-bin.js';
import { assertAllowedFetchUrl } from './egress.js';

export type InstallProgress = {
  phase: 'resolve' | 'fetch' | 'extract' | 'bin' | 'lifecycle' | 'done';
  name: string;
  version?: string;
  message?: string;
};

type OnProgress = (p: InstallProgress) => void;

type PacoteVersion = {
  version: string;
  dist: { tarball: string; integrity?: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
};

type RegistryMeta = {
  'dist-tags': { latest: string };
  versions: Record<string, PacoteVersion>;
};

const memoryCache = new Map<string, Uint8Array>();
const MAX_DEPTH = 8;
const LIFECYCLE_ALLOW = new Set(['true', 'echo', 'node']);

export async function installPackage(
  bn: NodeBrowser,
  spec: string,
  cwd = '/',
  opts?: { onProgress?: OnProgress; withDeps?: boolean; signal?: AbortSignal },
): Promise<void> {
  const withDeps = opts?.withDeps !== false;
  const seen = new Set<string>();
  const lock: Record<string, { version: string; resolved?: string }> = {};
  await installOne(bn, spec, cwd, 0, seen, withDeps, opts?.onProgress, opts?.signal, lock);
  await writeLockfile(bn, cwd, lock);
}

async function writeLockfile(
  bn: NodeBrowser,
  cwd: string,
  lock: Record<string, { version: string; resolved?: string }>,
): Promise<void> {
  const path = joinPath(cwd, 'package-lock.json');
  let existing: { lockfileVersion?: number; packages?: Record<string, unknown> } = {
    lockfileVersion: 3,
    packages: {},
  };
  try {
    existing = JSON.parse(await bn.fs.readFile(path, 'utf8'));
  } catch {
    /* new */
  }
  existing.lockfileVersion = 3;
  existing.packages = existing.packages || {};
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
  if (!LIFECYCLE_ALLOW.has(base) && base !== 'node') {
    onProgress?.({
      phase: 'lifecycle',
      name: scriptName,
      message: 'skipped (not in allowlist): ' + cmd,
    });
    return;
  }
  onProgress?.({ phase: 'lifecycle', name: scriptName, message: cmd });
  const proc = await bn.spawn('sh', ['-c', cmd], { cwd: destRoot });
  await proc.exit;
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
): Promise<void> {
  if (signal?.aborted) throw new Error('install cancelled');
  if (depth > MAX_DEPTH) return;
  const { name, version: want } = parseSpec(spec);
  const key = `${name}@${want}`;
  if (seen.has(key)) return;
  seen.add(key);

  onProgress?.({ phase: 'resolve', name, message: `resolving ${name}@${want}` });
  const meta = await fetchJson<RegistryMeta>(registryUrl(name));
  const ver =
    want === 'latest' || want.startsWith('^') || want.startsWith('~') || want === '*'
      ? pickVersion(meta, want)
      : want;
  const verMeta = meta.versions[ver];
  if (!verMeta) throw new Error(`version not found: ${name}@${ver}`);
  if (lock) lock[name] = { version: verMeta.version, resolved: verMeta.dist.tarball };

  if (verMeta.peerDependencies) {
    onProgress?.({
      phase: 'resolve',
      name,
      version: verMeta.version,
      message: 'peer deps: ' + Object.keys(verMeta.peerDependencies).join(', '),
    });
  }

  const cacheKey = verMeta.dist.integrity || `${name}@${verMeta.version}`;
  onProgress?.({ phase: 'fetch', name, version: verMeta.version });
  const buf = await fetchTarball(verMeta.dist.tarball, cacheKey);

  onProgress?.({ phase: 'extract', name, version: verMeta.version });
  const files = await untarGzip(buf);
  const destRoot = joinPath(cwd, 'node_modules', name);
  for (const [path, content] of Object.entries(files)) {
    const rel = path.replace(/^package\//, '');
    if (!rel || rel.endsWith('/')) continue;
    await bn.fs.writeFile(joinPath(destRoot, rel), content);
  }

  onProgress?.({ phase: 'bin', name, version: verMeta.version });
  await linkBins(bn, cwd, name, destRoot);
  await runLifecycle(bn, destRoot, 'preinstall', onProgress);
  await runLifecycle(bn, destRoot, 'postinstall', onProgress);

  if (withDeps && verMeta.dependencies) {
    for (const [dep, range] of Object.entries(verMeta.dependencies)) {
      await installOne(bn, `${dep}@${range}`, destRoot, depth + 1, seen, true, onProgress, signal, lock);
      const hoistPkg = joinPath(cwd, 'node_modules', dep, 'package.json');
      try {
        await bn.fs.readFile(hoistPkg, 'utf8');
      } catch {
        const hoistSeen = new Set<string>();
        await installOne(bn, `${dep}@${range}`, cwd, depth + 1, hoistSeen, false, onProgress, signal, lock);
      }
    }
  }

  if (withDeps && verMeta.optionalDependencies) {
    for (const [dep, range] of Object.entries(verMeta.optionalDependencies)) {
      try {
        await installOne(bn, `${dep}@${range}`, cwd, depth + 1, seen, false, onProgress, signal, lock);
      } catch (e) {
        onProgress?.({
          phase: 'resolve',
          name: dep,
          message: 'optional skipped: ' + (e instanceof Error ? e.message : String(e)),
        });
      }
    }
  }

  onProgress?.({ phase: 'done', name, version: verMeta.version });
}

function pickVersion(meta: RegistryMeta, range: string): string {
  if (!range || range === 'latest' || range === '*') return meta['dist-tags'].latest;
  const versions = Object.keys(meta.versions);
  if (range.startsWith('^') || range.startsWith('~')) {
    const base = range.slice(1);
    const found = versions.filter((v) => v === base || v.startsWith(base.split('.')[0] + '.')).pop();
    return found || meta['dist-tags'].latest;
  }
  return meta.versions[range] ? range : meta['dist-tags'].latest;
}

function parseSpec(spec: string): { name: string; version: string } {
  if (spec.startsWith('@')) {
    const i = spec.indexOf('@', 1);
    if (i === -1) return { name: spec, version: 'latest' };
    return { name: spec.slice(0, i), version: spec.slice(i + 1) || 'latest' };
  }
  const i = spec.indexOf('@');
  if (i === -1) return { name: spec, version: 'latest' };
  return { name: spec.slice(0, i), version: spec.slice(i + 1) || 'latest' };
}

/** registry.npmjs.org/@scope%2Fname */
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

async function fetchJson<T>(url: string): Promise<T> {
  assertAllowedFetchUrl(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`npm meta failed ${url}: ${res.status}`);
  return (await res.json()) as T;
}

async function fetchTarball(url: string, cacheKey: string): Promise<Uint8Array> {
  assertAllowedFetchUrl(url);
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey)!;

  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open('browsernode-npm-v1');
      const hit = await cache.match(url);
      if (hit) {
        const ab = new Uint8Array(await hit.arrayBuffer());
        memoryCache.set(cacheKey, ab);
        return ab;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`tarball fetch failed: ${res.status}`);
      await cache.put(url, res.clone());
      const ab = new Uint8Array(await res.arrayBuffer());
      memoryCache.set(cacheKey, ab);
      return ab;
    } catch {
      // fall through
    }
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`tarball fetch failed: ${res.status}`);
  const ab = new Uint8Array(await res.arrayBuffer());
  memoryCache.set(cacheKey, ab);
  return ab;
}

async function untarGzip(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  const ds = new DecompressionStream('gzip');
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return parseTar(new Uint8Array(ab));
}

function parseTar(buf: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const decoder = new TextDecoder();
  let offset = 0;
  const readStr = (start: number, len: number) => {
    let end = start;
    const limit = start + len;
    while (end < limit && buf[end] !== 0) end++;
    return decoder.decode(buf.subarray(start, end));
  };
  const readOctal = (start: number, len: number) => {
    const s = readStr(start, len).trim();
    return s ? parseInt(s, 8) : 0;
  };
  while (offset + 512 <= buf.length) {
    const block = buf.subarray(offset, offset + 512);
    if (block.every((b) => b === 0)) break;
    const name = readStr(offset, 100);
    const size = readOctal(offset + 124, 12);
    const type = buf[offset + 156] ?? 0;
    const prefix = readStr(offset + 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    offset += 512;
    const content = buf.subarray(offset, offset + size);
    if ((type === 0 || type === 48) && fullName) {
      out[fullName] = content.slice();
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return out;
}
