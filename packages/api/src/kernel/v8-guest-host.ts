/**
 * Page side of the V8 guest Worker. Kernel calls stay on this thread
 * (they may be promises when the WASM kernel itself is on a Worker).
 */
import type { KernelHandle, KernelModule } from './load.js';
import type { V8Io, V8RunResult } from './v8-guest.js';
import {
  V8_OP,
  V8_SAB_CHUNK,
  V8_STATE_REQ,
  V8_STATE_RES,
  decodeText,
  encodeText,
  splitPath,
  v8FsFail,
  v8SabHeader,
  v8SabPayload,
} from './v8-sab.js';

type FsReply = { status: number; extra: number; bytes: Uint8Array };

const reads = new WeakMap<SharedArrayBuffer, { path: string; bytes: Uint8Array }>();
const writes = new WeakMap<SharedArrayBuffer, { path: string; parts: Uint8Array[] }>();

function reply(sab: SharedArrayBuffer, res: FsReply): void {
  const header = v8SabHeader(sab);
  const payload = v8SabPayload(sab);
  const n = Math.min(res.bytes.byteLength, payload.byteLength);
  if (n) payload.set(res.bytes.subarray(0, n));
  Atomics.store(header, 2, n);
  Atomics.store(header, 3, res.extra);
  Atomics.store(header, 4, res.status);
  Atomics.store(header, 0, V8_STATE_RES);
  Atomics.notify(header, 0, 1);
}

async function readFileBytes(mod: KernelModule, k: KernelHandle, path: string): Promise<Uint8Array | null> {
  if (mod.readBytes) {
    const bytes = await Promise.resolve(mod.readBytes(k, path));
    if (bytes) return bytes;
  }
  const text = await Promise.resolve(mod.readText(k, path));
  if (text == null) return null;
  return encodeText(text);
}

async function dispatch(
  mod: KernelModule,
  k: KernelHandle,
  sab: SharedArrayBuffer,
  op: number,
  extra: number,
  flags: number,
  req: Uint8Array,
): Promise<FsReply> {
  const empty = new Uint8Array();
  const path =
    op === V8_OP.writeBytes || op === V8_OP.symlink || op === V8_OP.rename
      ? splitPath(req).path
      : decodeText(req);
  if (op === V8_OP.exists) {
    const ok = !!(await Promise.resolve(mod.exists(k, path)));
    return { status: 1, extra: ok ? 1 : 0, bytes: empty };
  }
  if (op === V8_OP.readBytes) {
    let slot = reads.get(sab);
    if (!slot || slot.path !== path || extra === 0) {
      const bytes = await readFileBytes(mod, k, path);
      if (!bytes) {
        reads.delete(sab);
        return { status: 0, extra: 0, bytes: empty };
      }
      slot = { path, bytes };
      reads.set(sab, slot);
    }
    const start = Math.max(0, extra);
    const slice = slot.bytes.subarray(start, Math.min(start + V8_SAB_CHUNK, slot.bytes.byteLength));
    const more = start + slice.byteLength < slot.bytes.byteLength ? 1 : 0;
    if (!more) reads.delete(sab);
    return { status: 1, extra: more, bytes: slice };
  }
  if (op === V8_OP.writeBytes) {
    const parts = splitPath(req);
    let slot = writes.get(sab);
    if (!slot || slot.path !== parts.path || extra === 0) {
      slot = { path: parts.path, parts: [] };
      writes.set(sab, slot);
    }
    if (parts.data.byteLength) slot.parts.push(parts.data);
    if (!(flags & 1)) return { status: 1, extra: 0, bytes: empty };
    let n = 0;
    for (const part of slot.parts) n += part.byteLength;
    const all = new Uint8Array(n);
    let o = 0;
    for (const part of slot.parts) {
      all.set(part, o);
      o += part.byteLength;
    }
    writes.delete(sab);
    const ok = mod.writeBytes
      ? !!(await Promise.resolve(mod.writeBytes(k, parts.path, all)))
      : !!(await Promise.resolve(mod.writeText(k, parts.path, decodeText(all))));
    return { status: ok ? 1 : 0, extra: 0, bytes: empty };
  }
  if (op === V8_OP.readdir) {
    try {
      const names = await Promise.resolve(mod.readdir(k, path));
      return { status: 1, extra: 0, bytes: encodeText(JSON.stringify(names ?? [])) };
    } catch {
      return { status: 0, extra: 0, bytes: empty };
    }
  }
  if (op === V8_OP.mkdir) {
    const ok = !!(await Promise.resolve(mod.mkdir(k, path, extra === 1)));
    return { status: ok ? 1 : 0, extra: 0, bytes: empty };
  }
  if (op === V8_OP.unlink) {
    const ok = !!(await Promise.resolve(mod.unlink(k, path)));
    return { status: ok ? 1 : 0, extra: 0, bytes: empty };
  }
  if (op === V8_OP.rmdir) {
    const ok = mod.rmdir ? !!(await Promise.resolve(mod.rmdir(k, path))) : false;
    return { status: ok ? 1 : 0, extra: 0, bytes: empty };
  }
  if (op === V8_OP.lstatKind) {
    if (!mod.lstatKind) return { status: 0, extra: 0, bytes: empty };
    const kind = await Promise.resolve(mod.lstatKind(k, path));
    if (!kind) return { status: 0, extra: 0, bytes: empty };
    return { status: 1, extra: 0, bytes: encodeText(kind) };
  }
  if (op === V8_OP.symlink) {
    const parts = splitPath(req);
    const link = decodeText(parts.data);
    const ok = mod.symlink ? !!(await Promise.resolve(mod.symlink(k, parts.path, link))) : false;
    return { status: ok ? 1 : 0, extra: 0, bytes: empty };
  }
  if (op === V8_OP.readlink) {
    if (!mod.readlink) return { status: 0, extra: 0, bytes: empty };
    const target = await Promise.resolve(mod.readlink(k, path));
    if (target == null) return { status: 0, extra: 0, bytes: empty };
    return { status: 1, extra: 0, bytes: encodeText(target) };
  }
  if (op === V8_OP.rename) {
    const parts = splitPath(req);
    const to = decodeText(parts.data);
    const ok = mod.rename ? !!(await Promise.resolve(mod.rename(k, parts.path, to))) : false;
    return { status: ok ? 1 : 0, extra: 0, bytes: empty };
  }
  return { status: 0, extra: 0, bytes: empty };
}

export async function serviceV8Fs(mod: KernelModule, k: KernelHandle, sab: SharedArrayBuffer): Promise<void> {
  const header = v8SabHeader(sab);
  if (Atomics.load(header, 0) !== V8_STATE_REQ) return;
  const op = Atomics.load(header, 1);
  const len = Math.max(0, Atomics.load(header, 2));
  const extra = Atomics.load(header, 3);
  const flags = Atomics.load(header, 5);
  const req = v8SabPayload(sab).slice(0, len);
  try {
    reply(sab, await dispatch(mod, k, sab, op, extra, flags, req));
  } catch {
    v8FsFail(sab);
  }
}

type HttpOut = { status: number; headers: Record<string, string>; body: string };

function installListenProxy(
  worker: Worker,
  port: number,
  pending: Map<number, (out: HttpOut) => void>,
  nextId: () => number,
): void {
  const g = globalThis as unknown as {
    __bn_wasm_http_handlers?: Map<number, (req: unknown) => Promise<HttpOut>>;
    __bn_on_server_ready?: (port: number) => void;
  };
  if (!g.__bn_wasm_http_handlers) g.__bn_wasm_http_handlers = new Map();
  g.__bn_wasm_http_handlers.set(port, (req) => {
    const id = nextId();
    return new Promise<HttpOut>((resolve) => {
      pending.set(id, resolve);
      worker.postMessage({ t: 'http', id, port, req });
    });
  });
  g.__bn_on_server_ready?.(port);
}

/** Run `node` / a known shell on a dedicated V8 thread. */
export function runGuestOnV8Worker(
  mod: KernelModule,
  k: KernelHandle,
  program: { command: string; args: string[]; cwd: string; env?: Record<string, string> },
): Promise<V8RunResult | null> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./v8-guest-worker.js', import.meta.url), { type: 'module' });
    } catch {
      resolve(null);
      return;
    }
    const io: V8Io = { stdout: '', stderr: '', timers: 0, servers: 0, pending: 0 };
    const result: V8RunResult = {
      code: 1,
      stdout: '',
      stderr: '',
      io,
      stop: () => worker.terminate(),
    };
    let opened = false;
    let sab: SharedArrayBuffer | null = null;
    const httpPending = new Map<number, (out: HttpOut) => void>();
    let httpSeq = 1;
    const finish = (value: V8RunResult | null) => {
      if (opened) return;
      opened = true;
      resolve(value);
    };
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as {
        t?: string;
        sab?: SharedArrayBuffer;
        port?: number;
        id?: number;
        out?: HttpOut;
        code?: number;
        stdout?: string;
        stderr?: string;
        timers?: number;
        servers?: number;
        pending?: number;
        final?: boolean;
      };
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'ready' && msg.sab) {
        sab = msg.sab;
        worker.postMessage({
          t: 'run',
          command: program.command,
          args: program.args,
          cwd: program.cwd,
          env: program.env ?? {},
        });
        return;
      }
      if (msg.t === 'fs' && sab) {
        void serviceV8Fs(mod, k, sab).catch(() => v8FsFail(sab!));
        return;
      }
      if (msg.t === 'listen') {
        installListenProxy(worker, msg.port ?? 0, httpPending, () => httpSeq++);
        return;
      }
      if (msg.t === 'http-result' && msg.id != null && msg.out) {
        httpPending.get(msg.id)?.(msg.out);
        httpPending.delete(msg.id);
        return;
      }
      if (msg.t === 'skip') {
        worker.terminate();
        finish(null);
        return;
      }
      if (msg.t === 'io') {
        io.stdout = String(msg.stdout ?? '');
        io.stderr = String(msg.stderr ?? '');
        io.timers = msg.timers ?? 0;
        io.servers = msg.servers ?? 0;
        io.pending = msg.pending ?? 0;
        result.code = msg.code ?? 1;
        result.stdout = io.stdout;
        result.stderr = io.stderr;
        if (!opened) finish(result);
        if (msg.final && !io.servers) worker.terminate();
      }
    };
    worker.onerror = (ev) => {
      if (!opened) {
        opened = true;
        reject(new Error(ev.message || 'v8 guest worker failed'));
      }
    };
    worker.postMessage({ t: 'boot' });
  });
}
