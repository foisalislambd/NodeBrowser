import type { BrowserNode } from './index.js';

/** Fetch package metadata + tarball from npm registry and unpack into VFS. */
export async function installPackage(bn: BrowserNode, spec: string, cwd = '/'): Promise<void> {
  const { name, version } = parseSpec(spec);
  const metaUrl = `https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`;
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) throw new Error(`npm meta failed for ${name}: ${metaRes.status}`);
  const meta = (await metaRes.json()) as {
    'dist-tags': { latest: string };
    versions: Record<string, { dist: { tarball: string }; version: string }>;
  };

  const ver = version === 'latest' ? meta['dist-tags'].latest : version;
  const verMeta = meta.versions[ver];
  if (!verMeta) throw new Error(`version not found: ${name}@${ver}`);

  const tarRes = await fetch(verMeta.dist.tarball);
  if (!tarRes.ok) throw new Error(`tarball fetch failed: ${tarRes.status}`);
  const buf = new Uint8Array(await tarRes.arrayBuffer());
  const files = await untarGzip(buf);

  const destRoot = `${cwd === '/' ? '' : cwd}/node_modules/${name}`.replace(/\/+/g, '/');
  // npm packs use package/ prefix
  for (const [path, content] of Object.entries(files)) {
    const rel = path.replace(/^package\//, '');
    if (!rel || rel.endsWith('/')) continue;
    const full = `${destRoot}/${rel}`.replace(/\/+/g, '/');
    await bn.fs.writeFile(full, content);
  }
}

function parseSpec(spec: string): { name: string; version: string } {
  if (spec.startsWith('@')) {
    const i = spec.indexOf('@', 1);
    if (i === -1) return { name: spec, version: 'latest' };
    return { name: spec.slice(0, i), version: spec.slice(i + 1) };
  }
  const i = spec.indexOf('@');
  if (i === -1) return { name: spec, version: 'latest' };
  return { name: spec.slice(0, i), version: spec.slice(i + 1) };
}

/** Minimal gunzip + ustar extract (enough for npm tarballs). */
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
    // empty block = EOF
    if (block.every((b) => b === 0)) break;

    const name = readStr(offset, 100);
    const size = readOctal(offset + 124, 12);
    const type = buf[offset + 156] ?? 0;
    const prefix = readStr(offset + 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;

    offset += 512;
    const content = buf.subarray(offset, offset + size);
    // type '0' or '\0' = file
    if ((type === 0 || type === 48) && fullName) {
      out[fullName] = decoder.decode(content);
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return out;
}
