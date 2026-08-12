/**
 * SharedArrayBuffer stdio ring — layout matches kernel/include/bn/stdio_ring.hpp
 *
 * Header 32 bytes, then `cap` payload bytes. Producer (WASM worker) writes;
 * consumer (UI / xterm) reads with Atomics.
 */

export const SAB_STDIO_HEADER = 32;
export const SAB_STDIO_MAGIC = 0x31424153;
const DEFAULT_CAP = 64 * 1024;

export function sabStdioAvailable(): boolean {
  if (typeof SharedArrayBuffer === 'undefined') return false;
  if (typeof Atomics === 'undefined') return false;
  if (typeof window !== 'undefined' && typeof crossOriginIsolated === 'boolean' && !crossOriginIsolated) {
    return false;
  }
  return true;
}

export class SabStdioRing {
  readonly buffer: SharedArrayBuffer;
  readonly cap: number;
  readonly #i32: Int32Array;
  readonly #u8: Uint8Array;

  private constructor(buffer: SharedArrayBuffer) {
    this.buffer = buffer;
    this.#i32 = new Int32Array(buffer, 0, 8);
    this.cap = this.#i32[1]!;
    this.#u8 = new Uint8Array(buffer, SAB_STDIO_HEADER, this.cap);
  }

  static create(cap = DEFAULT_CAP): SabStdioRing {
    const buffer = new SharedArrayBuffer(SAB_STDIO_HEADER + cap);
    const i32 = new Int32Array(buffer, 0, 8);
    i32[0] = SAB_STDIO_MAGIC;
    i32[1] = cap;
    i32[2] = 0;
    i32[3] = 0;
    i32[4] = 0;
    i32[5] = -1;
    return new SabStdioRing(buffer);
  }

  static wrap(buffer: SharedArrayBuffer): SabStdioRing {
    const i32 = new Int32Array(buffer, 0, 8);
    if (i32[0] !== SAB_STDIO_MAGIC) throw new Error('sab-stdio: bad magic');
    return new SabStdioRing(buffer);
  }

  writeBytes(src: Uint8Array): number {
    if (Atomics.load(this.#i32, 4) !== 0) return 0;
    const cap = this.cap;
    const w = Atomics.load(this.#i32, 2) >>> 0;
    const r = Atomics.load(this.#i32, 3) >>> 0;
    const used = w - r;
    if (used >= cap) return 0;
    const room = cap - used;
    const n = Math.min(src.byteLength, room);
    for (let i = 0; i < n; i++) this.#u8[(w + i) % cap] = src[i]!;
    Atomics.store(this.#i32, 2, w + n);
    Atomics.notify(this.#i32, 2);
    return n;
  }

  writeString(s: string): number {
    if (!s) return 0;
    return this.writeBytes(new TextEncoder().encode(s));
  }

  readBytes(max = this.cap): Uint8Array {
    const cap = this.cap;
    const w = Atomics.load(this.#i32, 2) >>> 0;
    const r = Atomics.load(this.#i32, 3) >>> 0;
    const avail = w - r;
    const n = Math.min(max, avail);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.#u8[(r + i) % cap]!;
    Atomics.store(this.#i32, 3, r + n);
    return out;
  }

  readString(): string {
    const b = this.readBytes();
    if (!b.byteLength) return '';
    return new TextDecoder().decode(b);
  }

  close(exitCode = 0): void {
    Atomics.store(this.#i32, 5, exitCode);
    Atomics.store(this.#i32, 4, 1);
    Atomics.notify(this.#i32, 4);
  }

  get closed(): boolean {
    return Atomics.load(this.#i32, 4) !== 0;
  }

  get exitCode(): number {
    return Atomics.load(this.#i32, 5);
  }
}
