/**
 * Dedicated thread for browsernode_kernel.wasm.
 * Long `node` / QuickJS work stays off the UI thread (PLAN Phase 16).
 */
(globalThis as unknown as { __BN_KERNEL_THREAD__?: boolean }).__BN_KERNEL_THREAD__ = true;

import { loadWasmOnThisThread, type KernelModule } from './load.js';
import { SabStdioRing } from '../io/sab-stdio.js';

type RpcIn = { id: number; op: string; args: unknown[] };
type RpcOut = { id: number; ok: boolean; result?: unknown; error?: string };
type HookOut = { t: 'hook'; n: string; a: unknown[] };

type StdioSlot = {
  k: number;
  out: SabStdioRing;
  err: SabStdioRing;
  inn: SabStdioRing;
  outPend: Uint8Array;
  errPend: Uint8Array;
  inPend: Uint8Array;
  exitCode: number | null;
};

const post = (msg: RpcOut | HookOut) => {
  (globalThis as unknown as { postMessage: (m: RpcOut | HookOut) => void }).postMessage(msg);
};

function installHooks(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.__bn_on_server_ready = (port: number) => post({ t: 'hook', n: 'server-ready', a: [port] });
  g.__bn_on_http_listen = (port: number) => post({ t: 'hook', n: 'http-listen', a: [port] });
  g.__bn_on_npm = (cwd: string, action: string, payload: string, pid: number) =>
    post({ t: 'hook', n: 'npm', a: [cwd, action, payload, pid] });
  g.__bn_on_npx = (pkg: string, rest: string, cwd: string, pid: number) =>
    post({ t: 'hook', n: 'npx', a: [pkg, rest, cwd, pid] });
  g.__bn_on_tool = (tool: string, cwd: string, mode: string) =>
    post({ t: 'hook', n: 'tool', a: [tool, cwd, mode] });
}

const empty = new Uint8Array(0);
const enc = new TextEncoder();
const dec = new TextDecoder();

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.byteLength) return b;
  if (!b.byteLength) return a;
  const o = new Uint8Array(a.byteLength + b.byteLength);
  o.set(a);
  o.set(b, a.byteLength);
  return o;
}

/** Write as much as the ring will take; return unwritten tail. */
function flushRing(ring: SabStdioRing, pending: Uint8Array, extra: string): Uint8Array {
  const src = concat(pending, extra ? enc.encode(extra) : empty);
  let off = 0;
  while (off < src.byteLength) {
    const n = ring.writeBytes(src.subarray(off));
    if (n <= 0) break;
    off += n;
  }
  if (off >= src.byteLength) return empty;
  return off === 0 ? src : src.slice(off);
}

let mod: KernelModule | null = null;
const stdio = new Map<number, StdioSlot>();
let pumpTimer: ReturnType<typeof setInterval> | null = null;
let pumpQueued = false;
let chain: Promise<void> = Promise.resolve();

function enqueue(fn: () => Promise<void>): void {
  chain = chain.then(fn, fn);
}

function closeSlot(slot: StdioSlot, code: number): void {
  try {
    slot.out.close(code);
  } catch {
    /* ignore */
  }
  try {
    slot.err.close(code);
  } catch {
    /* ignore */
  }
}

function dropKernelStdio(k: number, code = -1): void {
  for (const [pid, slot] of [...stdio]) {
    if (slot.k !== k) continue;
    closeSlot(slot, code);
    stdio.delete(pid);
  }
}

async function pumpOnce(): Promise<void> {
  if (!mod || !stdio.size) {
    if (pumpTimer) {
      clearInterval(pumpTimer);
      pumpTimer = null;
    }
    return;
  }
  try {
    for (const [pid, slot] of [...stdio]) {
      const k = slot.k;
      const out = await Promise.resolve(mod.readStdout(k, pid));
      slot.outPend = flushRing(slot.out, slot.outPend, out);
      const err = await Promise.resolve(mod.readStderr(k, pid));
      slot.errPend = flushRing(slot.err, slot.errPend, err);

      const chunk = slot.inn.readString();
      const inbound = concat(slot.inPend, chunk ? enc.encode(chunk) : empty);
      if (inbound.byteLength) {
        const n = await Promise.resolve(mod.writeStdin(k, pid, dec.decode(inbound)));
        const wrote = Math.max(0, Number(n) || 0);
        slot.inPend = wrote >= inbound.byteLength ? empty : inbound.slice(wrote);
      }

      if (slot.exitCode === null) {
        const code = await Promise.resolve(mod.wait(k, pid));
        if (code !== -1) {
          const out2 = await Promise.resolve(mod.readStdout(k, pid));
          slot.outPend = flushRing(slot.out, slot.outPend, out2);
          const err2 = await Promise.resolve(mod.readStderr(k, pid));
          slot.errPend = flushRing(slot.err, slot.errPend, err2);
          slot.exitCode = code;
        }
      }

      if (slot.exitCode !== null && !slot.outPend.byteLength && !slot.errPend.byteLength) {
        closeSlot(slot, slot.exitCode);
        stdio.delete(pid);
      }
    }
    if (!stdio.size && pumpTimer) {
      clearInterval(pumpTimer);
      pumpTimer = null;
    }
  } catch {
    for (const [pid, slot] of [...stdio]) {
      closeSlot(slot, slot.exitCode ?? 1);
      stdio.delete(pid);
    }
    if (pumpTimer) {
      clearInterval(pumpTimer);
      pumpTimer = null;
    }
  }
}

function startStdioPump(): void {
  if (pumpTimer) return;
  pumpTimer = setInterval(() => {
    if (pumpQueued || !stdio.size) return;
    pumpQueued = true;
    enqueue(async () => {
      try {
        await pumpOnce();
      } finally {
        pumpQueued = false;
      }
    });
  }, 8);
}

async function dispatch(op: string, args: unknown[]): Promise<unknown> {
  if (op === 'boot') {
    const url = String(args[0] || '');
    mod = await loadWasmOnThisThread(url || undefined);
    if (!mod) throw new Error('worker: WASM kernel failed to load');
    installHooks();
    return true;
  }
  if (op === 'attachStdio') {
    if (!mod) throw new Error('worker: kernel not booted');
    const k = args[0] as number;
    const pid = args[1] as number;
    stdio.set(pid, {
      k,
      out: SabStdioRing.wrap(args[2] as SharedArrayBuffer),
      err: SabStdioRing.wrap(args[3] as SharedArrayBuffer),
      inn: SabStdioRing.wrap(args[4] as SharedArrayBuffer),
      outPend: empty,
      errPend: empty,
      inPend: empty,
      exitCode: null,
    });
    startStdioPump();
    return true;
  }
  if (!mod) throw new Error('worker: kernel not booted');
  if (op === 'destroy') {
    dropKernelStdio(args[0] as number);
  }
  const fn = (mod as unknown as Record<string, unknown>)[op];
  if (typeof fn !== 'function') {
    if (op.endsWith('?') || fn === undefined) return undefined;
    throw new Error(`worker: unknown op ${op}`);
  }
  return (fn as (...a: unknown[]) => unknown).apply(mod, args);
}

(globalThis as unknown as { onmessage: ((ev: MessageEvent<RpcIn>) => void) | null }).onmessage = (
  ev: MessageEvent<RpcIn>,
) => {
  const data = ev.data;
  if (!data || typeof data.id !== 'number') return;
  enqueue(async () => {
    try {
      const result = await dispatch(data.op, data.args || []);
      post({ id: data.id, ok: true, result });
    } catch (e) {
      post({ id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
};
