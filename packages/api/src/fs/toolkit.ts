/** VFS search, glob, zip-store, dotenv, and line diff. Host-side only. */

export type ToolkitFs = {
  readdir(path: string): Promise<string[]>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  readFile(path: string, encoding: 'buffer'): Promise<Uint8Array>;
  stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
  exists(path: string): Promise<boolean>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
};

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', '.turbo', 'coverage', '__macosx']);

export type WalkOptions = {
  /** Also descend into node_modules, .git, dist, and similar. */
  includeIgnored?: boolean;
  maxFiles?: number;
};

export type SearchHit = {
  path: string;
  line: number;
  text: string;
};

function join(dir: string, name: string): string {
  if (dir === '/') return `/${name}`;
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

export function globToRegExp(pattern: string): RegExp {
  let out = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 3;
        continue;
      }
      out += '.*';
      i += 2;
      continue;
    }
    if (c === '*') {
      out += '[^/]*';
      i++;
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      i++;
      continue;
    }
    if ('.+^$()|[]{}\\'.includes(c)) out += '\\' + c;
    else out += c;
    i++;
  }
  return new RegExp(out + '$');
}

export async function walkFiles(fs: ToolkitFs, root: string, opts?: WalkOptions): Promise<string[]> {
  const max = opts?.maxFiles ?? 8000;
  const out: string[] = [];
  const visit = async (dir: string) => {
    if (out.length >= max) return;
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (out.length >= max) return;
      if (!opts?.includeIgnored && SKIP.has(name.toLowerCase())) continue;
      const full = join(dir, name);
      let dirent = false;
      try {
        dirent = (await fs.stat(full)).isDirectory();
      } catch {
        continue;
      }
      if (dirent) await visit(full);
      else out.push(full);
    }
  };
  await visit(root);
  return out;
}

export async function globFiles(fs: ToolkitFs, pattern: string, cwd = '/'): Promise<string[]> {
  const root = cwd.replace(/\/+$/, '') || '/';
  const files = await walkFiles(fs, root);
  const relPat = pattern.replace(/^\.\//, '');
  const re = globToRegExp(relPat);
  const prefix = root === '/' ? '/' : root + '/';
  return files
    .filter((p) => {
      const rel = root === '/' ? p.replace(/^\//, '') : p.startsWith(prefix) ? p.slice(prefix.length) : p;
      return re.test(rel);
    })
    .sort();
}

const TEXT_FILE = /\.(html?|css|js|mjs|cjs|jsx|ts|tsx|json|svg|txt|xml|md|markdown|ya?ml|toml|vue|svelte|lock|gitignore|npmrc|env)$/i;

function isSearchablePath(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (base === 'Dockerfile' || base === 'Makefile' || base.startsWith('.env') || base === '.npmrc') return true;
  return TEXT_FILE.test(base);
}

function looksBinary(text: string): boolean {
  return text.includes('\0');
}

export async function searchFiles(
  fs: ToolkitFs,
  query: string,
  opts?: { cwd?: string; glob?: string; max?: number; caseSensitive?: boolean },
): Promise<SearchHit[]> {
  if (!query) return [];
  const cwd = opts?.cwd ?? '/';
  const max = opts?.max ?? 200;
  let files = await walkFiles(fs, cwd.replace(/\/+$/, '') || '/');
  if (opts?.glob) {
    const re = globToRegExp(opts.glob.replace(/^\.\//, ''));
    const root = cwd.replace(/\/+$/, '') || '/';
    const prefix = root === '/' ? '/' : root + '/';
    files = files.filter((p) => {
      const rel = root === '/' ? p.replace(/^\//, '') : p.startsWith(prefix) ? p.slice(prefix.length) : p;
      return re.test(rel);
    });
  }
  const needle = opts?.caseSensitive ? query : query.toLowerCase();
  const hits: SearchHit[] = [];
  for (const path of files) {
    if (hits.length >= max) break;
    if (!isSearchablePath(path)) continue;
    let text: string;
    try {
      text = await fs.readFile(path, 'utf8');
    } catch {
      continue;
    }
    if (looksBinary(text) || text.length > 1_500_000) continue;
    const lines = text.split(/\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const hay = opts?.caseSensitive ? line : line.toLowerCase();
      if (hay.includes(needle)) {
        hits.push({ path, line: i + 1, text: line.slice(0, 400) });
        if (hits.length >= max) break;
      }
    }
  }
  return hits;
}

export async function replaceInFiles(
  fs: ToolkitFs,
  query: string,
  replacement: string,
  opts?: { cwd?: string; glob?: string; caseSensitive?: boolean },
): Promise<{ files: number; replacements: number }> {
  if (!query) return { files: 0, replacements: 0 };
  const hits = await searchFiles(fs, query, { ...opts, max: 100_000 });
  const byPath = new Map<string, number>();
  for (const hit of hits) byPath.set(hit.path, (byPath.get(hit.path) || 0) + 1);
  let files = 0;
  let replacements = 0;
  for (const path of byPath.keys()) {
    const text = await fs.readFile(path, 'utf8');
    const parts = opts?.caseSensitive ? text.split(query) : splitCase(text, query);
    if (parts.length < 2) continue;
    const next = parts.join(replacement);
    await fs.writeFile(path, next);
    files++;
    replacements += parts.length - 1;
  }
  return { files, replacements };
}

function splitCase(text: string, query: string): string[] {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: string[] = [];
  let start = 0;
  let at = lower.indexOf(q, start);
  while (at !== -1) {
    parts.push(text.slice(start, at));
    start = at + query.length;
    at = lower.indexOf(q, start);
  }
  parts.push(text.slice(start));
  return parts;
}

export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value.replace(/\\n/g, '\n');
  }
  return out;
}

export async function readDotenv(fs: ToolkitFs, cwd: string): Promise<Record<string, string>> {
  const root = cwd.replace(/\/+$/, '') || '/';
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local', '.env.development']) {
    const path = root === '/' ? `/${name}` : `${root}/${name}`;
    try {
      Object.assign(merged, parseDotenv(await fs.readFile(path, 'utf8')));
    } catch {
      /* missing */
    }
  }
  return merged;
}

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function u16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}
function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

/** PKZIP with stored (uncompressed) entries. Round-trips through `unzip`. */
export function buildStoredZip(files: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(files).sort();
  const locals: { name: Uint8Array; data: Uint8Array; crc: number; offset: number }[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const name of names) {
    const data = files[name]!;
    const nameBytes = new TextEncoder().encode(name.replace(/^\/+/, ''));
    const crc = crc32(data);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    u32(view, 0, 0x04034b50);
    u16(view, 4, 20);
    u16(view, 6, 0x800);
    u16(view, 8, 0);
    u16(view, 10, 0);
    u16(view, 12, 0);
    u32(view, 14, crc);
    u32(view, 18, data.length);
    u32(view, 22, data.length);
    u16(view, 26, nameBytes.length);
    u16(view, 28, 0);
    header.set(nameBytes, 30);
    locals.push({ name: nameBytes, data, crc, offset });
    chunks.push(header, data);
    offset += header.length + data.length;
  }
  const cdStart = offset;
  for (const entry of locals) {
    const header = new Uint8Array(46 + entry.name.length);
    const view = new DataView(header.buffer);
    u32(view, 0, 0x02014b50);
    u16(view, 4, 20);
    u16(view, 6, 20);
    u16(view, 8, 0x800);
    u16(view, 10, 0);
    u16(view, 12, 0);
    u16(view, 14, 0);
    u32(view, 16, entry.crc);
    u32(view, 20, entry.data.length);
    u32(view, 24, entry.data.length);
    u16(view, 28, entry.name.length);
    u16(view, 30, 0);
    u16(view, 32, 0);
    u16(view, 34, 0);
    u16(view, 36, 0);
    u32(view, 38, 0);
    u32(view, 42, entry.offset);
    header.set(entry.name, 46);
    chunks.push(header);
    offset += header.length;
  }
  const cdSize = offset - cdStart;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 4, 0);
  u16(ev, 6, 0);
  u16(ev, 8, locals.length);
  u16(ev, 10, locals.length);
  u32(ev, 12, cdSize);
  u32(ev, 16, cdStart);
  u16(ev, 20, 0);
  chunks.push(eocd);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export async function exportDirZip(fs: ToolkitFs, dir: string): Promise<Uint8Array> {
  const root = dir.replace(/\/+$/, '') || '/';
  const files = await walkFiles(fs, root);
  const payload: Record<string, Uint8Array> = {};
  const prefix = root === '/' ? '/' : root + '/';
  for (const path of files) {
    const rel = root === '/' ? path.replace(/^\//, '') : path.startsWith(prefix) ? path.slice(prefix.length) : path;
    if (!rel) continue;
    payload[rel] = await fs.readFile(path, 'buffer');
  }
  if (!Object.keys(payload).length) throw new Error(`exportZip: no files under ${root}`);
  return buildStoredZip(payload);
}

/** Line diff. Small files use an LCS hunk list; large files report a single replace. */
export function diffLines(before: string, after: string): string {
  if (before === after) return '';
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 160_000) {
    return [`--- a`, `+++ b`, `@@ -1,${a.length} +1,${b.length} @@`, ...a.map((l) => '-' + l), ...b.map((l) => '+' + l)].join(
      '\n',
    );
  }
  const n = a.length;
  const m = b.length;
  const dp: number[] = new Array((n + 1) * (m + 1)).fill(0);
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = a[i] === b[j] ? dp[at(i + 1, j + 1)]! + 1 : Math.max(dp[at(i + 1, j)]!, dp[at(i, j + 1)]!);
    }
  }
  const lines: string[] = ['--- a', '+++ b'];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(' ' + a[i]);
      i++;
      j++;
    } else if (dp[at(i + 1, j)]! >= dp[at(i, j + 1)]!) {
      lines.push('-' + a[i]);
      i++;
    } else {
      lines.push('+' + b[j]);
      j++;
    }
  }
  while (i < n) lines.push('-' + a[i++]);
  while (j < m) lines.push('+' + b[j++]);
  return lines.join('\n');
}

export async function treeDigest(fs: ToolkitFs, root: string): Promise<string> {
  const files = await walkFiles(fs, root.replace(/\/+$/, '') || '/');
  let h = 2166136261;
  for (const path of files) {
    let text = '';
    try {
      text = await fs.readFile(path, 'utf8');
    } catch {
      continue;
    }
    const sample = path + '\0' + text.slice(0, 100_000);
    for (let i = 0; i < sample.length; i++) {
      h ^= sample.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + files.length;
}
