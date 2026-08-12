/**
 * Dedicated thread for browsernode_kernel.wasm.
 * Long `node` / QuickJS work stays off the UI thread (PLAN Phase 16).
 */
(globalThis as unknown as { __BN_KERNEL_THREAD__?: boolean }).__BN_KERNEL_THREAD__ = true;

import { loadWasmOnThisThread, type KernelModule } from './load.js';

type RpcIn = { id: number; op: string; args: unknown[] };
type RpcOut = { id: number; ok: boolean; result?: unknown; error?: string };
type HookOut = { t: 'hook'; n: string; a: unknown[] };

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

let mod: KernelModule | null = null;

async function dispatch(op: string, args: unknown[]): Promise<unknown> {
  if (op === 'boot') {
    const url = String(args[0] || '');
    mod = await loadWasmOnThisThread(url || undefined);
    if (!mod) throw new Error('worker: WASM kernel failed to load');
    installHooks();
    return true;
  }
  if (!mod) throw new Error('worker: kernel not booted');
  const fn = (mod as unknown as Record<string, unknown>)[op];
  if (typeof fn !== 'function') {
    if (op.endsWith('?') || fn === undefined) return undefined;
    throw new Error(`worker: unknown op ${op}`);
  }
  return (fn as (...a: unknown[]) => unknown).apply(mod, args);
}

let chain: Promise<void> = Promise.resolve();

(globalThis as unknown as { onmessage: ((ev: MessageEvent<RpcIn>) => void) | null }).onmessage = (
  ev: MessageEvent<RpcIn>,
) => {
  const data = ev.data;
  if (!data || typeof data.id !== 'number') return;
  chain = chain.then(async () => {
    try {
      const result = await dispatch(data.op, data.args || []);
      post({ id: data.id, ok: true, result });
    } catch (e) {
      post({ id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
};
