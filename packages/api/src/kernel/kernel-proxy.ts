import type { KernelHandle, KernelModule } from './load.js';

type RpcOut = { id: number; ok: boolean; result?: unknown; error?: string };
type HookOut = { t: 'hook'; n: string; a: unknown[] };

let worker: Worker | null = null;
let rpcId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function deliverHook(n: string, a: unknown[]): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (n === 'server-ready') (g.__bn_on_server_ready as ((p: number) => void) | undefined)?.(a[0] as number);
  else if (n === 'http-listen') (g.__bn_on_http_listen as ((p: number) => void) | undefined)?.(a[0] as number);
  else if (n === 'npm')
    (g.__bn_on_npm as ((cwd: string, action: string, payload: string, pid: number) => void) | undefined)?.(
      a[0] as string,
      a[1] as string,
      a[2] as string,
      a[3] as number,
    );
  else if (n === 'npx')
    (g.__bn_on_npx as ((pkg: string, rest: string, cwd: string, pid: number) => void) | undefined)?.(
      a[0] as string,
      a[1] as string,
      a[2] as string,
      a[3] as number,
    );
  else if (n === 'tool')
    (g.__bn_on_tool as ((tool: string, cwd: string, mode: string) => void) | undefined)?.(
      a[0] as string,
      a[1] as string,
      a[2] as string,
    );
}

function attachWorker(w: Worker): void {
  w.onmessage = (ev: MessageEvent<RpcOut | HookOut>) => {
    const msg = ev.data;
    if (!msg) return;
    if ('t' in msg && msg.t === 'hook') {
      deliverHook(msg.n, msg.a || []);
      return;
    }
    if (!('id' in msg)) return;
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    if (msg.ok) slot.resolve(msg.result);
    else slot.reject(new Error(msg.error || 'kernel worker error'));
  };
  w.onerror = (ev) => {
    const err = new Error(ev.message || 'kernel worker crashed');
    for (const slot of pending.values()) slot.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
}

function rpc(op: string, args: unknown[] = []): Promise<unknown> {
  if (!worker) return Promise.reject(new Error('kernel worker missing'));
  const id = rpcId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, op, args });
  });
}

export function terminateKernelWorker(): void {
  for (const slot of pending.values()) slot.reject(new Error('kernel worker terminated'));
  pending.clear();
  worker?.terminate();
  worker = null;
}

/** Browser: run the C++/WASM kernel on a Worker so spawn/node does not freeze the tab. */
export async function createWorkerKernel(wasmUrl: string): Promise<KernelModule> {
  terminateKernelWorker();
  const w = new Worker(new URL('./kernel-worker.js', import.meta.url), { type: 'module' });
  worker = w;
  attachWorker(w);
  await rpc('boot', [wasmUrl]);

  const call = <T>(op: string, args: unknown[] = []) => rpc(op, args) as Promise<T>;

  return {
    create: () => call<KernelHandle>('create'),
    destroy: (k) => call<void>('destroy', [k]),
    registerBuiltins: (k) => call<void>('registerBuiltins', [k]),
    mkdir: (k, path, recursive) => call<boolean>('mkdir', [k, path, recursive]),
    writeText: (k, path, text) => call<boolean>('writeText', [k, path, text]),
    writeBytes: (k, path, data) => call<boolean>('writeBytes', [k, path, data]),
    readText: (k, path) => call<string | null>('readText', [k, path]),
    readBytes: (k, path) => call<Uint8Array | null>('readBytes', [k, path]),
    unlink: (k, path) => call<boolean>('unlink', [k, path]),
    rmdir: (k, path) => call<boolean>('rmdir', [k, path]),
    rename: (k, from, to) => call<boolean>('rename', [k, from, to]),
    readdir: (k, path) => call<string[]>('readdir', [k, path]),
    exists: (k, path) => call<boolean>('exists', [k, path]),
    isDir: (k, path) => call<boolean>('isDir', [k, path]),
    symlink: (k, target, linkpath) => call<boolean>('symlink', [k, target, linkpath]),
    readlink: (k, path) => call<string | null>('readlink', [k, path]),
    lstatKind: (k, path) => call<string | null>('lstatKind', [k, path]),
    spawn: (k, cmd, argv, cwd, env) => call<number>('spawn', [k, cmd, argv, cwd, env ?? {}]),
    wait: (k, pid) => call<number>('wait', [k, pid]),
    kill: (k, pid) => call<boolean>('kill', [k, pid]),
    pump: (k, nowMs) => call<number>('pump', [k, nowMs ?? 0]),
    extractTar: (k, data, destDir) => call<number>('extractTar', [k, data, destDir]),
    usageBytes: (k) => call<number>('usageBytes', [k]),
    readStdout: (k, pid) => call<string>('readStdout', [k, pid]),
    readStderr: (k, pid) => call<string>('readStderr', [k, pid]),
    writeStdin: (k, pid, data) => call<number>('writeStdin', [k, pid, data]),
    writeStdout: (k, pid, data) => call<number>('writeStdout', [k, pid, data]),
    writeStderr: (k, pid, data) => call<number>('writeStderr', [k, pid, data]),
    complete: (k, pid, code) => call<number>('complete', [k, pid, code]),
    httpDispatch: (k, port, method, path, headersJson, body) =>
      call<string | null>('httpDispatch', [k, port, method, path, headersJson, body]),
    attachStdio: (k, pid, stdout, stderr, stdin) =>
      call<boolean>('attachStdio', [k, pid, stdout, stderr, stdin]),
    runtime: 'wasm',
    worker: true,
  };
}

export function canUseKernelWorker(): boolean {
  if ((globalThis as unknown as { __BN_KERNEL_THREAD__?: boolean }).__BN_KERNEL_THREAD__) return false;
  return typeof Worker === 'function' && typeof document !== 'undefined';
}
