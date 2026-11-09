/**
 * Guest `node` on the host JavaScript engine (V8 in Chromium and in Node).
 * The C++/WASM kernel still owns the filesystem. QuickJS stays for the shell
 * until this path covers it.
 */
import type { KernelHandle, KernelModule } from './load.js';

export type V8RunResult = { code: number; stdout: string; stderr: string };

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

function normalize(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

function joinPath(dir: string, name: string): string {
  if (!name) return dir || '/';
  if (name.startsWith('/')) return normalize(name);
  const base = dir === '/' ? '' : dir.replace(/\/+$/, '');
  return normalize(`${base}/${name}`);
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i);
}

function isFile(mod: KernelModule, k: KernelHandle, path: string): boolean {
  if (!sync(mod.exists(k, path))) return false;
  if (mod.lstatKind) return sync(mod.lstatKind(k, path)) === 'file';
  return sync(mod.readText(k, path)) !== null;
}

function isDir(mod: KernelModule, k: KernelHandle, path: string): boolean {
  if (path === '/' || path === '') return true;
  if (!sync(mod.exists(k, path))) return false;
  if (mod.lstatKind) return sync(mod.lstatKind(k, path)) === 'directory';
  return sync(mod.readText(k, path)) === null;
}

function resolveFile(mod: KernelModule, k: KernelHandle, request: string, fromDir: string): string | null {
  const candidates: string[] = [];
  const raw = request.startsWith('.') || request.startsWith('/') ? joinPath(request.startsWith('/') ? '/' : fromDir, request.startsWith('/') ? request.slice(1) : request) : '';
  if (raw) {
    candidates.push(raw, raw + '.js', raw + '.json', joinPath(raw, 'index.js'));
  } else {
    let dir = fromDir;
    for (;;) {
      const base = joinPath(dir, 'node_modules/' + request);
      candidates.push(base + '.js', joinPath(base, 'index.js'));
      const pkg = joinPath(base, 'package.json');
      if (isFile(mod, k, pkg)) {
        try {
          const meta = JSON.parse(sync(mod.readText(k, pkg)) || '{}') as { main?: string };
          if (meta.main) candidates.push(joinPath(base, meta.main), joinPath(base, meta.main) + '.js');
        } catch {
          /* ignore bad package.json */
        }
      }
      if (dir === '/' || dir === '') break;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const c of candidates) {
    if (isFile(mod, k, c)) return c;
  }
  return null;
}

type HttpHandler = (req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}) => { status: number; headers: Record<string, string>; body: string };

function httpHandlers(): Map<number, HttpHandler> {
  const g = globalThis as unknown as { __bn_wasm_http_handlers?: Map<number, HttpHandler> };
  if (!g.__bn_wasm_http_handlers) g.__bn_wasm_http_handlers = new Map();
  return g.__bn_wasm_http_handlers;
}

export function runNodeOnV8(
  mod: KernelModule,
  k: KernelHandle,
  args: string[],
  cwd: string,
  env: Record<string, string> | undefined,
): V8RunResult {
  let stdout = '';
  let stderr = '';
  const writeOut = (s: string) => {
    stdout += s;
  };
  const writeErr = (s: string) => {
    stderr += s;
  };

  let code = '';
  let filename = joinPath(cwd, 'eval.js');
  if (args[0] === '-e' || args[0] === '--eval') {
    code = args[1] ?? '';
    filename = joinPath(cwd, '[eval].js');
  } else {
    const rel = args[0];
    if (!rel) return { code: 1, stdout, stderr: stderr + 'node: missing script\n' };
    filename = rel.startsWith('/') ? rel : joinPath(cwd, rel);
    const text = sync(mod.readText(k, filename));
    if (text == null) return { code: 1, stdout, stderr: stderr + `ENOENT: ${filename}\n` };
    code = text;
  }

  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const builtins = new Set(['fs', 'path', 'http', 'events', 'module', 'url']);

  function makeRequire(fromFile: string): (id: string) => unknown {
    const fromDir = dirname(fromFile);
    return function require(id: string): unknown {
      const name = id.startsWith('node:') ? id.slice(5) : id;
      if (builtins.has(name)) return loadBuiltin(name, fromFile);
      const resolved = resolveFile(mod, k, name, fromDir);
      if (!resolved) {
        const err = new Error(`Cannot find module '${id}'`) as Error & { code?: string };
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }
      if (cache.has(resolved)) return cache.get(resolved)!.exports;
      const src = sync(mod.readText(k, resolved));
      if (src == null) throw new Error(`ENOENT: ${resolved}`);
      if (resolved.endsWith('.json')) {
        const exp = { exports: JSON.parse(src) as Record<string, unknown> };
        cache.set(resolved, exp);
        return exp.exports;
      }
      const exp = { exports: {} as Record<string, unknown> };
      cache.set(resolved, exp);
      const fn = new Function(
        'exports',
        'require',
        'module',
        '__filename',
        '__dirname',
        'process',
        'Buffer',
        'console',
        src,
      );
      fn(exp.exports, makeRequire(resolved), exp, resolved, dirname(resolved), processObj, bufferObj, consoleObj);
      return exp.exports;
    };
  }

  const bufferObj = createBuffer();
  const processObj = {
    cwd: () => cwd,
    argv: ['node', filename, ...args.slice(filename.endsWith('[eval].js') ? 2 : 1)],
    env: { ...(env || {}) },
    exitCode: 0,
    platform: 'linux',
    arch: 'wasm',
    pid: 1,
    version: 'v20.18.0',
    versions: { node: '20.18.0', v8: '12.4.0' },
    stdout: { write: (s: string) => writeOut(String(s)), isTTY: false },
    stderr: { write: (s: string) => writeErr(String(s)), isTTY: false },
    nextTick(fn: (...a: unknown[]) => void, ...rest: unknown[]) {
      queueMicrotask(() => fn(...rest));
    },
    exit(n?: number) {
      const err = new Error('process.exit') as Error & { __bn_exit?: number };
      err.__bn_exit = n == null ? 0 : n | 0;
      throw err;
    },
  };

  const consoleObj = {
    log: (...a: unknown[]) => writeOut(a.map(String).join(' ') + '\n'),
    error: (...a: unknown[]) => writeErr(a.map(String).join(' ') + '\n'),
    warn: (...a: unknown[]) => writeErr(a.map(String).join(' ') + '\n'),
    info: (...a: unknown[]) => writeOut(a.map(String).join(' ') + '\n'),
  };

  function loadBuiltin(name: string, fromFile: string): unknown {
    if (name === 'path') {
      return {
        join: (...parts: string[]) => parts.reduce((acc, p) => joinPath(acc, p), ''),
        dirname,
        basename: (p: string) => p.slice(p.lastIndexOf('/') + 1),
        resolve: (...parts: string[]) => {
          let acc = fromFile.startsWith('/') ? dirname(fromFile) : cwd;
          for (const p of parts) acc = p.startsWith('/') ? p : joinPath(acc, p);
          return acc;
        },
      };
    }
    if (name === 'events') {
      function EE(this: { _e?: Record<string, Function[]> }) {
        this._e = {};
      }
      EE.prototype.on = function (ev: string, fn: Function) {
        (this._e[ev] || (this._e[ev] = [])).push(fn);
        return this;
      };
      EE.prototype.emit = function (ev: string, ...rest: unknown[]) {
        for (const fn of this._e[ev] || []) fn(...rest);
        return true;
      };
      return { EventEmitter: EE };
    }
    if (name === 'fs') {
      return {
        readFileSync: (p: string, enc?: string) => {
          const abs = p.startsWith('/') ? p : joinPath(cwd, p);
          const text = sync(mod.readText(k, abs));
          if (text == null) {
            const err = new Error(`ENOENT: ${abs}`) as Error & { code?: string };
            err.code = 'ENOENT';
            throw err;
          }
          if (enc) return text;
          return bufferObj.from(text);
        },
        writeFileSync: (p: string, data: string | { toString: () => string }) => {
          const abs = p.startsWith('/') ? p : joinPath(cwd, p);
          const text = typeof data === 'string' ? data : data.toString();
          if (!sync(mod.writeText(k, abs, text))) throw new Error(`EIO: ${abs}`);
        },
        existsSync: (p: string) => sync(mod.exists(k, p.startsWith('/') ? p : joinPath(cwd, p))),
        mkdirSync: (p: string, opts?: { recursive?: boolean }) => {
          sync(mod.mkdir(k, p.startsWith('/') ? p : joinPath(cwd, p), !!(opts && opts.recursive)));
        },
        readdirSync: (p: string) => sync(mod.readdir(k, p.startsWith('/') ? p : joinPath(cwd, p))),
        statSync: (p: string) => {
          const abs = p.startsWith('/') ? p : joinPath(cwd, p);
          const file = isFile(mod, k, abs);
          const dir = isDir(mod, k, abs);
          if (!file && !dir) {
            const err = new Error(`ENOENT: ${abs}`) as Error & { code?: string };
            err.code = 'ENOENT';
            throw err;
          }
          return { isFile: () => file, isDirectory: () => dir };
        },
      };
    }
    if (name === 'module') {
      return { createRequire: (file: string) => makeRequire(String(file)) };
    }
    if (name === 'url') {
      return {
        fileURLToPath: (u: string) => String(u).replace(/^file:\/\//, ''),
        pathToFileURL: (p: string) => ({ href: 'file://' + p, toString: () => 'file://' + p }),
      };
    }
    if (name === 'http') {
      return {
        createServer(listener: (req: unknown, res: unknown) => void) {
          return {
            listen(port: number, cb?: () => void) {
              const p = port | 0;
              httpHandlers().set(p, (req) => {
                let status = 200;
                let headers: Record<string, string> = { 'Content-Type': 'text/plain' };
                let body = '';
                const res = {
                  writeHead(code: number, h?: Record<string, string>) {
                    status = code;
                    if (h) headers = { ...headers, ...h };
                  },
                  setHeader(key: string, value: string) {
                    headers[key] = value;
                  },
                  end(chunk?: string) {
                    if (chunk != null) body = String(chunk);
                  },
                };
                listener({ method: req.method, url: req.url, headers: req.headers || {} }, res);
                return { status, headers, body };
              });
              const notify = globalThis as unknown as { __bn_on_server_ready?: (port: number) => void };
              notify.__bn_on_server_ready?.(p);
              if (cb) cb();
              return this;
            },
          };
        },
      };
    }
    throw new Error(`No builtin ${name}`);
  }

  try {
    const require = makeRequire(filename);
    const module = { exports: {} as Record<string, unknown> };
    const fn = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      'process',
      'Buffer',
      'console',
      code,
    );
    fn(module.exports, require, module, filename, dirname(filename), processObj, bufferObj, consoleObj);
    return { code: 0, stdout, stderr };
  } catch (e) {
    const exit = (e as { __bn_exit?: number }).__bn_exit;
    if (typeof exit === 'number') return { code: exit, stdout, stderr };
    const msg = e instanceof Error ? e.stack || e.message : String(e);
    return { code: 1, stdout, stderr: stderr + msg + '\n' };
  }
}

function createBuffer(): {
  from: (data: string, enc?: string) => { toString: (enc?: string) => string };
  isBuffer: (v: unknown) => boolean;
} {
  const Native = (globalThis as { Buffer?: { from: (s: string, e?: string) => { toString: (e?: string) => string }; isBuffer: (v: unknown) => boolean } }).Buffer;
  if (Native) return Native;
  function Box(this: { _s: string }, s: string) {
    this._s = s;
  }
  Box.prototype.toString = function (this: { _s: string }) {
    return this._s;
  };
  return {
    from(data: string) {
      return new (Box as unknown as new (s: string) => { toString: () => string })(String(data));
    },
    isBuffer(v: unknown) {
      return !!v && typeof v === 'object' && typeof (v as { toString?: unknown }).toString === 'function' && '_s' in (v as object);
    },
  };
}
