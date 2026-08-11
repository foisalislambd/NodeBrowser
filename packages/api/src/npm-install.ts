import type { BrowserNode } from './index.js';

export type InstallProgress = {
  phase: 'resolve' | 'fetch' | 'extract' | 'done';
  name: string;
  version?: string;
  message?: string;
};

type OnProgress = (p: InstallProgress) => void;

type PacoteVersion = {
  version: string;
  dist: { tarball: string; integrity?: string };
  dependencies?: Record<string, string>;
};

type RegistryMeta = {
  'dist-tags': { latest: string };
  versions: Record<string, PacoteVersion>;
};

const memoryCache = new Map<string, Uint8Array>();
const MAX_DEPTH = 8;

export async function installPackage(
  bn: BrowserNode,
  spec: string,
  cwd = '/',
  opts?: { onProgress?: OnProgress; withDeps?: boolean },
): Promise<void> {
  const withDeps = opts?.withDeps !== false;
  const seen = new Set<string>();
  await installOne(bn, spec, cwd, 0, seen, withDeps, opts?.onProgress);
}

async function installOne(
  bn: BrowserNode,
  spec: string,
  cwd: string,
  depth: number,
  seen: Set<string>,
  withDeps: boolean,
  onProgress?: OnProgress,
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  const { name, version: want } = parseSpec(spec);
  const key = `${name}@${want}`;
  if (seen.has(key)) return;
  seen.add(key);

  onProgress?.({ phase: 'resolve', name, message: `resolving ${name}@${want}` });
  const meta = await fetchJson<RegistryMeta>(registryUrl(name));
  const ver = want === 'latest' || want.startsWith('^') || want.startsWith('~') || want === '*'
    ? pickVersion(meta, want)
    : want;
  const verMeta = meta.versions[ver];
  if (!verMeta) throw new Error(`version not found: ${name}@${ver}`);

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

  if (withDeps && verMeta.dependencies) {
    for (const [dep, range] of Object.entries(verMeta.dependencies)) {
      // Install nested under this package's node_modules for isolation (npm-like)
      await installOne(bn, `${dep}@${range}`, destRoot, depth + 1, seen, true, onProgress);
      // Also hoist to project root if missing
      const hoist = joinPath(cwd, 'node_modules', dep);
      try {
        await bn.fs.readdir(hoist);
      } catch {
        await installOne(bn, `${dep}@${range}`, cwd, depth + 1, seen, false, onProgress);
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`npm meta failed ${url}: ${res.status}`);
  return (await res.json()) as T;
}

async function fetchTarball(url: string, cacheKey: string): Promise<Uint8Array> {
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

async function untarGzip(data: Uint8Array): Promise<Record<string, string>> {
  const ds = new DecompressionStream('gzip');
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return parseTar(new Uint8Array(ab));
}

function parseTar(buf: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
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
      out[fullName] = decoder.decode(content);
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return out;
}
