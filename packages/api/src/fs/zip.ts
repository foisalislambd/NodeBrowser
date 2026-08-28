/** ZIP + gzip-tar extract into the kernel VFS (demo upload). */

import { resolveUnderRoot, sanitizeArchiveName } from './paths.js';

const SIG_EOCD = 0x06054b50;
const SIG_CD = 0x02014b50;
const MAX_FILES = 8000;
const MAX_BYTES = 80 * 1024 * 1024;

function u16(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}

function u32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

function decodeName(b: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder().decode(b);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

function findEocd(buf: Uint8Array): number {
  const start = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= start; i--) {
    if (u32(buf, i) === SIG_EOCD) return i;
  }
  throw new Error('not a zip archive (missing EOCD)');
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('unzip: Deflate not available in this environment');
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Unzip PKZIP (stored + deflate). Skips directories and junk. */
export async function unzip(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  const eocd = findEocd(bytes);
  const cdOff = u32(bytes, eocd + 16);
  const cdEntries = u16(bytes, eocd + 10);
  if (cdEntries > MAX_FILES) throw new Error(`zip: too many files (${cdEntries})`);
  const out: Record<string, Uint8Array> = {};
  let total = 0;
  let p = cdOff;
  for (let n = 0; n < cdEntries; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== SIG_CD) throw new Error('zip: corrupt central directory');
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const uncompSize = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOff = u32(bytes, p + 42);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    const rawName = decodeName(nameBytes, !!(flags & 0x800)).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    const name = sanitizeArchiveName(rawName);
    if (!name) continue;
    if (uncompSize > MAX_BYTES || (total += uncompSize) > MAX_BYTES) {
      throw new Error('zip: uncompressed size exceeds 80 MiB limit');
    }
    const nameOff = localOff + 30;
    const locNameLen = u16(bytes, localOff + 26);
    const locExtra = u16(bytes, localOff + 28);
    const dataStart = nameOff + locNameLen + locExtra;
    const compressed = bytes.subarray(dataStart, dataStart + compSize);
    let raw: Uint8Array;
    if (method === 0) raw = compressed.slice();
    else if (method === 8) raw = await inflateRaw(compressed);
    else throw new Error(`zip: unsupported compression method ${method} (${name})`);
    out[name] = raw;
  }
  return out;
}

export function parseTar(buf: Uint8Array): Record<string, Uint8Array> {
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
    const fullName = (prefix ? `${prefix}/${name}` : name).replace(/\\/g, '/');
    offset += 512;
    const content = buf.subarray(offset, offset + size);
    const safe = sanitizeArchiveName(fullName);
    if ((type === 0 || type === 48) && safe) {
      out[safe] = content.slice();
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return out;
}

export async function extractArchive(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  if (isZip(bytes)) return unzip(bytes);
  if (isGzip(bytes)) return parseTar(await gunzip(bytes));
  throw new Error('unsupported archive (use .zip or .tar.gz)');
}

/** If every path is under a single top folder, strip it. */
export function stripSingleRoot(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const keys = Object.keys(files).filter((k) => k && k !== '.');
  if (keys.length === 0) return files;
  const top = keys[0]!.split('/')[0]!;
  if (!top || !keys.every((k) => k === top || k.startsWith(top + '/'))) return files;
  const out: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) {
    if (k === top) continue;
    const rest = k.startsWith(top + '/') ? k.slice(top.length + 1) : k;
    if (rest) out[rest] = v;
  }
  return Object.keys(out).length ? out : files;
}

export function joinArchivePath(root: string, ...relParts: string[]): string {
  const rel = relParts.filter(Boolean).join('/');
  return resolveUnderRoot(root, rel);
}

function crc32(data: Uint8Array): number {
  let c = ~0 >>> 0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let b = 0; b < 8; b++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function putU16(out: number[], v: number) {
  out.push(v & 255, (v >>> 8) & 255);
}
function putU32(out: number[], v: number) {
  out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
}

/** Build an uncompressed ZIP (tests / fixtures). */
export function makeStoredZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: number[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const [name, raw] of Object.entries(files)) {
    const data = typeof raw === 'string' ? enc.encode(raw) : raw;
    const nameB = enc.encode(name);
    const crc = crc32(data);
    const localOff = offset;
    const loc: number[] = [];
    putU32(loc, 0x04034b50);
    putU16(loc, 20);
    putU16(loc, 0);
    putU16(loc, 0);
    putU16(loc, 0);
    putU16(loc, 0);
    putU32(loc, crc);
    putU32(loc, data.length);
    putU32(loc, data.length);
    putU16(loc, nameB.length);
    putU16(loc, 0);
    loc.push(...nameB);
    loc.push(...data);
    locals.push(...loc);
    offset += loc.length;
    putU32(central, 0x02014b50);
    putU16(central, 20);
    putU16(central, 20);
    putU16(central, 0);
    putU16(central, 0);
    putU16(central, 0);
    putU16(central, 0);
    putU32(central, crc);
    putU32(central, data.length);
    putU32(central, data.length);
    putU16(central, nameB.length);
    putU16(central, 0);
    putU16(central, 0);
    putU16(central, 0);
    putU16(central, 0);
    putU32(central, 0);
    putU32(central, localOff);
    central.push(...nameB);
  }
  const eocd: number[] = [];
  const n = Object.keys(files).length;
  putU32(eocd, 0x06054b50);
  putU16(eocd, 0);
  putU16(eocd, 0);
  putU16(eocd, n);
  putU16(eocd, n);
  putU32(eocd, central.length);
  putU32(eocd, locals.length);
  putU16(eocd, 0);
  return Uint8Array.from([...locals, ...central, ...eocd]);
}
