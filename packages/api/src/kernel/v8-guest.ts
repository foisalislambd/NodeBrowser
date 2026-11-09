/**
 * Guest `node` on the host JavaScript engine (V8 in Chromium and in Node).
 * The program is the same bootstrap + guest modules QuickJS evaluates.
 * The C++/WASM kernel still owns the filesystem, and QuickJS still runs the shell.
 */
import type { KernelHandle, KernelModule } from './load.js';
import { GUEST_BOOTSTRAP, GUEST_MODULES } from './guest_bundle.js';

export type V8RunResult = {
  code: number;
  stdout: string;
  stderr: string;
  /** Keeps growing after return while guest timers or servers are still live. */
  io: { stdout: string; stderr: string; timers: number; servers: number };
};

type HttpHandler = (req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}) => { status: number; headers: Record<string, string>; body: string };

type GuestFn = (req: { method?: string; url?: string; headers?: Record<string, string> }, res: GuestRes) => void;

type GuestRes = {
  statusCode: number;
  setHeader: (k: string, v: unknown) => void;
  writeHead: (code: number, h?: Record<string, string>) => void;
  write: (c: unknown) => boolean;
  end: (c?: unknown) => void;
};

type Sandbox = {
  globalThis: Sandbox;
  __bn: BnShim;
  process?: { argv: unknown[]; env: Record<string, string>; exitCode?: number };
  __bn_runMain?: (filename: string) => number;
  __bn_fire_timer?: (id: number, interval: number) => void;
};

type BnShim = Record<string, unknown>;

type SpawnResult = { pid: number; stdout: string; stderr: string; running: boolean; code: number };

function isPromise(v: unknown): v is Promise<unknown> {
  return !!v && typeof (v as Promise<unknown>).then === 'function';
}

/** Same-thread WASM returns values directly. A Worker kernel cannot do sync require. */
export function kernelCallsAreSync(mod: KernelModule, k: KernelHandle): boolean {
  try {
    return !isPromise(mod.exists(k, '/'));
  } catch {
    return false;
  }
}

function sync<T>(v: T | Promise<T>): T {
  if (isPromise(v)) throw new Error('V8 guest needs the same-thread WASM kernel');
  return v as T;
}

export function splitShellWords(input: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quote) {
      if (c === quote) quote = '';
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === ' ' || c === '\t') {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (quote) return null;
  if (cur) out.push(cur);
  return out;
}

/** `node …` or a simple `sh -c "node …"` with no pipes. */
export function nodeArgsFromSpawn(cmd: string, args: string[]): string[] | null {
  const base = cmd.replace(/^.*\//, '');
  if (base === 'node') return args;
  if ((base === 'sh' || base === 'bash') && args[0] === '-c' && args.length >= 2) {
    const line = args[1] ?? '';
    if (/[|&;<>`$\\\n]/.test(line)) return null;
    const parts = splitShellWords(line.trim());
    if (!parts || parts[0] !== 'node') return null;
    return parts.slice(1);
  }
  return null;
}

function httpHandlers(): Map<number, HttpHandler> {
  const g = globalThis as unknown as { __bn_wasm_http_handlers?: Map<number, HttpHandler> };
  if (!g.__bn_wasm_http_handlers) g.__bn_wasm_http_handlers = new Map();
  return g.__bn_wasm_http_handlers;
}

function joinPath(dir: string, name: string): string {
  if (!name) return dir || '/';
  if (name.startsWith('/')) return name;
  if (dir === '/' || dir === '') return '/' + name;
  return dir.replace(/\/+$/, '') + '/' + name;
}

let guestRunner: ((sandbox: Sandbox, bn: BnShim) => (filename: string) => number) | null = null;

function guestRunMainFactory(): (sandbox: Sandbox, bn: BnShim) => (filename: string) => number {
  if (!guestRunner) {
    guestRunner = new Function(
      'globalThis',
      '__bn',
      `${GUEST_BOOTSTRAP}\n${GUEST_MODULES}\nvar console = globalThis.console;\nvar setTimeout = globalThis.setTimeout;\nvar setInterval = globalThis.setInterval;\nvar clearTimeout = globalThis.clearTimeout;\nvar clearInterval = globalThis.clearInterval;\nreturn globalThis.__bn_runMain;\n`,
    ) as (sandbox: Sandbox, bn: BnShim) => (filename: string) => number;
  }
  return guestRunner;
}

function invokeGuest(handler: GuestFn, req: { method?: string; url?: string; headers?: Record<string, string>; body?: string }) {
  let status = 200;
  const headers: Record<string, string> = {};
  let body = '';
  const res: GuestRes = {
    statusCode: 200,
    setHeader(key, value) {
      headers[String(key)] = String(value);
    },
    writeHead(code, h) {
      status = code | 0;
      this.statusCode = status;
      if (h) {
        for (const key of Object.keys(h)) headers[key] = String(h[key]);
      }
    },
    write(chunk) {
      body += chunk == null ? '' : String(chunk);
      return true;
    },
    end(chunk) {
      if (chunk != null) body += String(chunk);
    },
  };
  handler({ method: req.method || 'GET', url: req.url || '/', headers: req.headers || {} }, res);
  return { status, headers, body };
}

function asEnv(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item != null) out[key] = String(item);
  }
  return out;
}

export function runNodeOnV8(
  mod: KernelModule,
  k: KernelHandle,
  args: string[],
  cwd: string,
  env: Record<string, string> | undefined,
): V8RunResult {
  const io = { stdout: '', stderr: '', timers: 0, servers: 0 };
  const work = cwd && cwd !== '' ? cwd : '/';

  const text = (parts: unknown[]) => parts.map((p) => (p == null ? '' : String(p))).join(' ');

  const sandbox = {} as Sandbox;
  const timers = new Map<number, { handle: ReturnType<typeof setTimeout>; interval: boolean }>();
  let nextTimer = 1;

  const bn: BnShim = {
    cwd: () => work,
    print: (...parts: unknown[]) => {
      io.stdout += text(parts) + '\n';
    },
    eprint: (...parts: unknown[]) => {
      io.stderr += text(parts) + '\n';
    },
    writeOut: (s: unknown) => {
      io.stdout += String(s ?? '');
    },
    writeErr: (s: unknown) => {
      io.stderr += String(s ?? '');
    },
    readFile: (path: string) => sync(mod.readText(k, String(path))),
    readBytes: (path: string) => {
      if (!mod.readBytes) return null;
      const bytes = sync(mod.readBytes(k, String(path)));
      if (!bytes) return null;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    writeFile: (path: string, data: unknown) => sync(mod.writeText(k, String(path), data == null ? '' : String(data))),
    writeBytes: (path: string, data: unknown) => {
      let bytes: Uint8Array | null = null;
      if (data instanceof Uint8Array) bytes = data;
      else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
      else if (data && typeof data === 'object' && (data as ArrayBufferView).buffer instanceof ArrayBuffer) {
        const view = data as ArrayBufferView;
        bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      }
      if (!bytes) return false;
      return sync(mod.writeBytes(k, String(path), bytes));
    },
    exists: (path: string) => !!sync(mod.exists(k, String(path))),
    isFile: (path: string) => {
      const p = String(path);
      if (!sync(mod.exists(k, p))) return false;
      if (mod.lstatKind) return sync(mod.lstatKind(k, p)) === 'file';
      return sync(mod.readText(k, p)) !== null;
    },
    isDir: (path: string) => {
      const p = String(path);
      if (p === '/' || p === '') return true;
      if (!sync(mod.exists(k, p))) return false;
      if (mod.lstatKind) return sync(mod.lstatKind(k, p)) === 'directory';
      return sync(mod.readText(k, p)) === null;
    },
    isSymlink: (path: string) => (mod.lstatKind ? sync(mod.lstatKind(k, String(path))) === 'symlink' : false),
    lstatKind: (path: string) => (mod.lstatKind ? sync(mod.lstatKind(k, String(path))) : null),
    readdir: (path: string) => {
      const p = String(path);
      if (!sync(mod.exists(k, p))) return null;
      if (mod.lstatKind && p !== '/' && sync(mod.lstatKind(k, p)) !== 'directory') return null;
      return sync(mod.readdir(k, p));
    },
    mkdir: (path: string, recursive: boolean) => sync(mod.mkdir(k, String(path), !!recursive)),
    unlink: (path: string) => sync(mod.unlink(k, String(path))),
    rmdir: (path: string) => (mod.rmdir ? sync(mod.rmdir(k, String(path))) : false),
    symlink: (target: string, linkpath: string) =>
      mod.symlink ? sync(mod.symlink(k, String(target), String(linkpath))) : false,
    readlink: (path: string) => (mod.readlink ? sync(mod.readlink(k, String(path))) : null),
    chmod: () => true,
    utimes: () => true,
    statJson: (path: string) => {
      const p = String(path);
      const kind = mod.lstatKind ? sync(mod.lstatKind(k, p)) : null;
      if (!kind) return null;
      let size = 0;
      if (kind === 'file' && mod.readBytes) {
        const bytes = sync(mod.readBytes(k, p));
        size = bytes ? bytes.length : 0;
      }
      return {
        kind: kind === 'directory' ? 'dir' : kind,
        size,
        mtimeMs: Date.now(),
        mode: kind === 'directory' ? 0o755 : 0o644,
      };
    },
    registerHttp: (port: number, handler: GuestFn) => {
      const p = port | 0;
      io.servers += 1;
      httpHandlers().set(p, (req) => invokeGuest(handler, req));
      const notify = globalThis as unknown as { __bn_on_server_ready?: (port: number) => void };
      notify.__bn_on_server_ready?.(p);
    },
    serverReady: (port: number) => {
      const notify = globalThis as unknown as { __bn_on_server_ready?: (port: number) => void };
      notify.__bn_on_server_ready?.(port | 0);
    },
    httpDispatch: (port: number, method: string, path: string, headersJson: string, body: string) => {
      const handler = httpHandlers().get(port | 0);
      if (!handler) return '';
      let headers: Record<string, string> = {};
      try {
        headers = headersJson ? (JSON.parse(headersJson) as Record<string, string>) : {};
      } catch {
        headers = {};
      }
      const out = handler({ method: String(method || 'GET'), url: String(path || '/'), headers, body: body == null ? '' : String(body) });
      return JSON.stringify(out);
    },
    spawnNode: (script: string, childCwd: string, childEnv: unknown): SpawnResult => {
      const child = runNodeOnV8(mod, k, [String(script || '')], childCwd || work, asEnv(childEnv));
      return { pid: 0, stdout: child.stdout, stderr: child.stderr, running: false, code: child.code };
    },
    spawnCmd: (cmd: string, cmdArgs: unknown, childCwd: string): SpawnResult => {
      const list = Array.isArray(cmdArgs) ? cmdArgs.map(String) : [];
      if (cmd === 'echo') {
        return { pid: 0, stdout: list.join(' ') + '\n', stderr: '', running: false, code: 0 };
      }
      if (cmd === 'true') return { pid: 0, stdout: '', stderr: '', running: false, code: 0 };
      if (cmd === 'false') return { pid: 0, stdout: '', stderr: '', running: false, code: 1 };
      if (cmd === 'node') {
        const child = runNodeOnV8(mod, k, list, childCwd || work, env);
        return { pid: 0, stdout: child.stdout, stderr: child.stderr, running: false, code: child.code };
      }
      return { pid: 0, stdout: '', stderr: `sh: ${cmd}: not found\n`, running: false, code: 127 };
    },
    killPid: () => false,
    waitPid: () => 0,
    writeStdin: () => {},
    complete: () => {},
    evalNewContext: (code: string) => {
      const source = String(code ?? '');
      try {
        const value = new Function(`"use strict"; return (${source});`)();
        return value == null ? '' : String(value);
      } catch {
        new Function(`"use strict";\n${source}`)();
        return '';
      }
    },
    timerStart: (ms: number, interval: number) => {
      const id = nextTimer++;
      const fire = () => {
        if (!interval) timers.delete(id);
        try {
          sandbox.__bn_fire_timer?.(id, interval ? 1 : 0);
        } catch (err) {
          io.stderr += (err instanceof Error ? err.stack || err.message : String(err)) + '\n';
        }
        io.timers = timers.size;
      };
      const handle = interval ? setInterval(fire, ms | 0) : setTimeout(fire, ms | 0);
      timers.set(id, { handle, interval: !!interval });
      io.timers = timers.size;
      return id;
    },
    timerClear: (id: number) => {
      const slot = timers.get(id | 0);
      if (!slot) return;
      if (slot.interval) clearInterval(slot.handle);
      else clearTimeout(slot.handle);
      timers.delete(id | 0);
      io.timers = timers.size;
    },
  };

  sandbox.globalThis = sandbox;
  sandbox.__bn = bn;

  let script = args[0] ?? '';
  const finish = (code: number, extraErr = ''): V8RunResult => {
    if (extraErr) io.stderr += extraErr;
    return { code, stdout: io.stdout, stderr: io.stderr, io };
  };
  if (!script) return finish(1, 'node: missing script\n');
  if ((script === '-e' || script === '--eval') && args.length >= 2) {
    const tmp = joinPath(work, '.bn-eval.js');
    if (!sync(mod.writeText(k, tmp, args[1] ?? ''))) {
      return finish(1, 'EIO: .bn-eval.js\n');
    }
    script = tmp;
  }

  try {
    const runMain = guestRunMainFactory()(sandbox, bn);
    const proc = sandbox.process;
    if (proc) {
      proc.argv = ['node', ...args];
      proc.env = { ...(proc.env || {}), ...(env || {}) };
    }
    const code = typeof runMain === 'function' ? runMain(script) | 0 : 1;
    return finish(code);
  } catch (err) {
    const exit = (err as { __bn_exit?: number }).__bn_exit;
    if (typeof exit === 'number') return finish(exit);
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    return finish(1, msg + '\n');
  }
}
