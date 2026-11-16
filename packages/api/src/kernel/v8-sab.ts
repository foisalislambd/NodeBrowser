/**
 * Shared-buffer filesystem calls between the V8 guest Worker and the page.
 * The guest blocks in Atomics.wait. The page fills the reply and notifies.
 */

export const V8_SAB_HEADER = 32;
export const V8_SAB_PAYLOAD = 4 * 1024 * 1024;
export const V8_SAB_CHUNK = 1024 * 1024;

export const V8_STATE_IDLE = 0;
export const V8_STATE_REQ = 1;
export const V8_STATE_RES = 2;

export const V8_OP = {
  exists: 1,
  readBytes: 2,
  writeBytes: 3,
  readdir: 4,
  mkdir: 5,
  unlink: 6,
  rmdir: 7,
  lstatKind: 8,
  symlink: 9,
  readlink: 10,
  rename: 11,
} as const;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function createV8Sab(): SharedArrayBuffer {
  return new SharedArrayBuffer(V8_SAB_HEADER + V8_SAB_PAYLOAD);
}

export function v8SabHeader(sab: SharedArrayBuffer): Int32Array {
  return new Int32Array(sab, 0, 8);
}

export function v8SabPayload(sab: SharedArrayBuffer): Uint8Array {
  return new Uint8Array(sab, V8_SAB_HEADER, V8_SAB_PAYLOAD);
}

export type V8FsResult = {
  status: number;
  extra: number;
  bytes: Uint8Array;
};

/** Copy `bytes` into the buffer, mark the request, and wait for the page. */
export function v8FsCall(
  sab: SharedArrayBuffer,
  op: number,
  extra: number,
  flags: number,
  bytes: Uint8Array,
  ping: () => void,
): V8FsResult {
  const header = v8SabHeader(sab);
  const payload = v8SabPayload(sab);
  if (bytes.byteLength > payload.byteLength) {
    return { status: 0, extra: 0, bytes: new Uint8Array() };
  }
  payload.set(bytes);
  Atomics.store(header, 1, op);
  Atomics.store(header, 2, bytes.byteLength);
  Atomics.store(header, 3, extra);
  Atomics.store(header, 5, flags);
  Atomics.store(header, 0, V8_STATE_REQ);
  ping();
  let spins = 0;
  while (Atomics.load(header, 0) === V8_STATE_REQ) {
    Atomics.wait(header, 0, V8_STATE_REQ, 1000);
    if (++spins > 60) return { status: 0, extra: 0, bytes: new Uint8Array() };
  }
  const len = Math.max(0, Atomics.load(header, 2));
  const outExtra = Atomics.load(header, 3);
  const status = Atomics.load(header, 4);
  const out = payload.slice(0, Math.min(len, payload.byteLength));
  Atomics.store(header, 0, V8_STATE_IDLE);
  return { status, extra: outExtra, bytes: out };
}

/** Unblock a guest that is waiting after a host-side failure. */
export function v8FsFail(sab: SharedArrayBuffer): void {
  const header = v8SabHeader(sab);
  Atomics.store(header, 2, 0);
  Atomics.store(header, 3, 0);
  Atomics.store(header, 4, 0);
  Atomics.store(header, 0, V8_STATE_RES);
  Atomics.notify(header, 0, 1);
}

export function encodePath(path: string, data?: Uint8Array): Uint8Array {
  const p = enc.encode(path);
  if (!data) return p;
  const out = new Uint8Array(p.byteLength + 1 + data.byteLength);
  out.set(p, 0);
  out[p.byteLength] = 0;
  out.set(data, p.byteLength + 1);
  return out;
}

export function splitPath(buf: Uint8Array): { path: string; data: Uint8Array } {
  const cut = buf.indexOf(0);
  if (cut < 0) return { path: dec.decode(buf), data: new Uint8Array() };
  return { path: dec.decode(buf.subarray(0, cut)), data: buf.subarray(cut + 1) };
}

export function encodeText(text: string): Uint8Array {
  return enc.encode(text);
}

export function decodeText(bytes: Uint8Array): string {
  return dec.decode(bytes);
}
