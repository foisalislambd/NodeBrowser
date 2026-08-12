/** Origin Private File System persistence for `/home` (browser only). */

const ROOT = 'nodebrowser-vfs';
const HOME_PREFIX = '/home';

function enc(): TextEncoder {
  return new TextEncoder();
}
function dec(): TextDecoder {
  return new TextDecoder();
}

async function getRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(ROOT, { create: true });
  } catch {
    return null;
  }
}

async function ensureDir(
  root: FileSystemDirectoryHandle,
  parts: string[],
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const part of parts) {
    if (!part) continue;
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

async function writeOpfsFile(
  root: FileSystemDirectoryHandle,
  absPath: string,
  data: Uint8Array,
): Promise<void> {
  const parts = absPath.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length === 0) return;
  const name = parts.pop()!;
  const dir = await ensureDir(root, parts);
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  await w.close();
}

async function removeOpfsPath(root: FileSystemDirectoryHandle, absPath: string): Promise<void> {
  const parts = absPath.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length === 0) return;
  const name = parts.pop()!;
  try {
    const dir = parts.length ? await ensureDir(root, parts) : root;
    await dir.removeEntry(name, { recursive: true });
  } catch {
    /* missing ok */
  }
}

async function walkOpfs(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: Record<string, Uint8Array>,
): Promise<void> {
  // FileSystemDirectoryHandle async iterator
  for await (const [name, handle] of dir as unknown as AsyncIterable<
    [string, FileSystemHandle]
  >) {
    const path = prefix ? `${prefix}/${name}` : `/${name}`;
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile();
      out[path] = new Uint8Array(await file.arrayBuffer());
    } else if (handle.kind === 'directory') {
      await walkOpfs(handle as FileSystemDirectoryHandle, path, out);
    }
  }
}

export type OpfsFs = {
  writeFile: (path: string, data: string | Uint8Array) => Promise<void>;
  readFile: {
    (path: string, encoding: 'buffer'): Promise<Uint8Array>;
    (path: string, encoding?: 'utf8'): Promise<string>;
  };
  mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  readdir: (path: string) => Promise<string[]>;
  exists: (path: string) => Promise<boolean>;
  rm: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
};

/** Hydrate VFS `/home` from OPFS. */
export async function hydrateFromOpfs(fs: OpfsFs): Promise<number> {
  const root = await getRoot();
  if (!root) return 0;
  const files: Record<string, Uint8Array> = {};
  await walkOpfs(root, '', files);
  let n = 0;
  for (const [path, bytes] of Object.entries(files)) {
    const abs = path.startsWith('/') ? path : `/${path}`;
    // Stored under nodebrowser-vfs mirroring absolute paths without leading slash
    const vfsPath = abs.startsWith(HOME_PREFIX) ? abs : `${HOME_PREFIX}${abs}`;
    const dir = vfsPath.slice(0, vfsPath.lastIndexOf('/')) || '/';
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(vfsPath, bytes);
    n++;
  }
  return n;
}

/** Flush a single path into OPFS (only under `/home`). */
export async function flushPathToOpfs(
  path: string,
  data: Uint8Array | null,
): Promise<void> {
  if (!path.startsWith(HOME_PREFIX)) return;
  const root = await getRoot();
  if (!root) return;
  if (data == null) {
    await removeOpfsPath(root, path);
    return;
  }
  await writeOpfsFile(root, path, data);
}

/** Debounced flush of dirty paths. */
export function createOpfsFlusher(fs: OpfsFs, debounceMs = 400) {
  const dirty = new Map<string, 'write' | 'delete'>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const run = () => {
    chain = chain.then(async () => {
      const batch = [...dirty.entries()];
      dirty.clear();
      const root = await getRoot();
      if (!root) return;
      for (const [path, kind] of batch) {
        if (!path.startsWith(HOME_PREFIX)) continue;
        if (kind === 'delete') {
          await removeOpfsPath(root, path);
          continue;
        }
        try {
          const bytes = await fs.readFile(path, 'buffer');
          await writeOpfsFile(root, path, bytes);
        } catch {
          await removeOpfsPath(root, path);
        }
      }
    });
    return chain;
  };

  return {
    mark(path: string, kind: 'write' | 'delete' = 'write') {
      if (!path.startsWith(HOME_PREFIX)) return;
      dirty.set(path, kind);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, debounceMs);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await run();
    },
    async clearHome() {
      const root = await getRoot();
      if (!root) return;
      try {
        const parent = await navigator.storage.getDirectory();
        await parent.removeEntry(ROOT, { recursive: true });
      } catch {
        /* ignore */
      }
    },
  };
}

/** Build a simple ustar + gzip snapshot of `/home` (stored-block gzip via host zlib if needed). */
export async function exportHomeTarGz(
  fs: OpfsFs,
  gzip: (data: Uint8Array) => Uint8Array,
): Promise<Uint8Array> {
  const files: { path: string; data: Uint8Array }[] = [];
  const walk = async (dir: string) => {
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const p = dir === '/' ? `/${name}` : `${dir}/${name}`;
      try {
        const bytes = await fs.readFile(p, 'buffer');
        files.push({ path: p.replace(/^\//, ''), data: bytes });
      } catch {
        await walk(p);
      }
    }
  };
  await walk(HOME_PREFIX);
  const tar = buildUstar(files);
  return gzip(tar);
}

export async function importHomeTarGz(
  fs: OpfsFs,
  bytes: Uint8Array,
  gunzip: (data: Uint8Array) => Uint8Array,
): Promise<number> {
  const tar = gunzip(bytes);
  const files = parseUstar(tar);
  let n = 0;
  for (const [rel, data] of Object.entries(files)) {
    const path = rel.startsWith('/') ? rel : `/${rel}`;
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path, data);
    n++;
  }
  return n;
}

function buildUstar(files: { path: string; data: Uint8Array }[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  const encoder = enc();
  for (const f of files) {
    const name = f.path.slice(0, 100);
    const header = new Uint8Array(512);
    header.set(encoder.encode(name), 0);
    const sizeOct = f.data.length.toString(8).padStart(11, '0') + '\0';
    header.set(encoder.encode(sizeOct), 124);
    header[156] = '0'.charCodeAt(0);
    const magic = encoder.encode('ustar\0');
    header.set(magic, 257);
    header.set(encoder.encode('00'), 263);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i]!;
    // checksum field blanked as spaces during calc — use standard approach
    for (let i = 148; i < 156; i++) header[i] = 0x20;
    sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i]!;
    const chk = sum.toString(8).padStart(6, '0') + '\0 ';
    header.set(encoder.encode(chk), 148);
    blocks.push(header);
    blocks.push(f.data);
    const pad = (512 - (f.data.length % 512)) % 512;
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

function parseUstar(buf: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const decoder = dec();
  let offset = 0;
  const readStr = (start: number, len: number) => {
    let end = start;
    const limit = start + len;
    while (end < limit && buf[end] !== 0) end++;
    return decoder.decode(buf.subarray(start, end));
  };
  while (offset + 512 <= buf.length) {
    const block = buf.subarray(offset, offset + 512);
    if (block.every((b) => b === 0)) break;
    const name = readStr(offset, 100);
    const sizeStr = readStr(offset + 124, 12).trim();
    const size = sizeStr ? parseInt(sizeStr, 8) : 0;
    const type = buf[offset + 156] ?? 0;
    offset += 512;
    const content = buf.subarray(offset, offset + size);
    if ((type === 0 || type === 48) && name) {
      out[name] = content.slice();
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return out;
}

export function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}
