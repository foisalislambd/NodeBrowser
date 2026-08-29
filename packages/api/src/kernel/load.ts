/** Host HTTP bridge registrar (JS kernel used this; WASM uses httpDispatch). */
export type HttpRegistrar = (
  port: number,
  handler: (
    req: { method: string; url: string; headers: Record<string, string>; body?: string },
    res: {
      writeHead: (code: number, h?: Record<string, string>) => void;
      end: (chunk?: string) => void;
      setHeader?: (k: string, v: string) => void;
      write?: (c: string) => void;
    },
  ) => void,
) => void;

export type KernelHandle = number;

/** Sync WASM ABI or Promise when the kernel runs on a Worker. */
export type Awaitable<T> = T | Promise<T>;

export interface KernelModule {
  create(): Awaitable<KernelHandle>;
  destroy(k: KernelHandle): Awaitable<void>;
  registerBuiltins(k: KernelHandle): Awaitable<void>;
  mkdir(k: KernelHandle, path: string, recursive: boolean): Awaitable<boolean>;
  writeText(k: KernelHandle, path: string, text: string): Awaitable<boolean>;
  writeBytes(k: KernelHandle, path: string, data: Uint8Array): Awaitable<boolean>;
  readText(k: KernelHandle, path: string): Awaitable<string | null>;
  /** Optional — binary read; host falls back to TextEncoder on readText */
  readBytes?(k: KernelHandle, path: string): Awaitable<Uint8Array | null>;
  unlink(k: KernelHandle, path: string): Awaitable<boolean>;
  rmdir?(k: KernelHandle, path: string): Awaitable<boolean>;
  /** Optional — host implements portable fallback if missing */
  rename?(k: KernelHandle, from: string, to: string): Awaitable<boolean>;
  readdir(k: KernelHandle, path: string): Awaitable<string[]>;
  exists(k: KernelHandle, path: string): Awaitable<boolean>;
  /** Optional — JS fallback; WASM may use readText heuristic via NodeBrowser.fs */
  isDir?(k: KernelHandle, path: string): Awaitable<boolean>;
  /** Optional — C++ VFS symlink ABI (WASM) / JS kernel */
  symlink?(k: KernelHandle, target: string, linkpath: string): Awaitable<boolean>;
  readlink?(k: KernelHandle, path: string): Awaitable<string | null>;
  /** Returns "file" | "directory" | "symlink" (WASM lstat JSON) or JS kind */
  lstatKind?(k: KernelHandle, path: string): Awaitable<string | null>;
  spawn(
    k: KernelHandle,
    cmd: string,
    argv: string[],
    cwd: string,
    env?: Record<string, string>,
  ): Awaitable<number>;
  wait(k: KernelHandle, pid: number): Awaitable<number>;
  kill(k: KernelHandle, pid: number): Awaitable<boolean>;
  pump?(k: KernelHandle, nowMs?: number): Awaitable<number>;
  extractTar?(k: KernelHandle, data: Uint8Array, destDir: string): Awaitable<number>;
  usageBytes?(k: KernelHandle): Awaitable<number>;
  readStdout(k: KernelHandle, pid: number): Awaitable<string>;
  readStderr(k: KernelHandle, pid: number): Awaitable<string>;
  writeStdin(k: KernelHandle, pid: number, data: string): Awaitable<number>;
  writeStdout?(k: KernelHandle, pid: number, data: string): Awaitable<number>;
  writeStderr?(k: KernelHandle, pid: number, data: string): Awaitable<number>;
  complete?(k: KernelHandle, pid: number, exitCode: number): Awaitable<number>;
  /** Optional: JS fallback exposes this for HttpBridge wiring. */
  setHttpRegistrar?: (fn: HttpRegistrar | null) => void;
  /** Optional: host FS mutation bus (JS kernel). */
  setFsChangeListener?: (fn: ((ev: { type: string; path: string }) => void) | null) => void;
  /** Optional: WASM keep-alive HTTP dispatch (JSON result string). */
  httpDispatch?: (
    k: KernelHandle,
    port: number,
    method: string,
    path: string,
    headersJson: string,
    body: string,
  ) => Awaitable<string | null>;
  /** Set by loadKernel */
  runtime?: 'js' | 'wasm';
  /** True when C++/WASM runs off the UI thread. */
  worker?: boolean;
  /** Attach SharedArrayBuffer stdio rings (Worker + COOP/COEP). */
  attachStdio?: (
    k: KernelHandle,
    pid: number,
    stdout: SharedArrayBuffer,
    stderr: SharedArrayBuffer,
    stdin: SharedArrayBuffer,
  ) => Awaitable<boolean>;
}

type EmscriptenModule = {
  ccall: (...args: unknown[]) => unknown;
  cwrap: (...args: unknown[]) => (...args: unknown[]) => unknown;
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (str: string, outPtr: number, maxBytes: number) => void;
  lengthBytesUTF8: (str: string) => number;
  HEAPU8: Uint8Array;
  _malloc: (n: number) => number;
  _free: (p: number) => void;
  _bn_kernel_create: () => number;
  _bn_kernel_destroy: (k: number) => void;
  _bn_register_builtins: (k: number) => void;
  _bn_vfs_mkdir: (k: number, path: number, recursive: number) => number;
  _bn_vfs_write_text: (k: number, path: number, text: number) => number;
  _bn_vfs_write_bytes: (k: number, path: number, data: number, len: number) => number;
  _bn_vfs_read_text: (k: number, path: number) => number;
  _bn_vfs_read_bytes?: (k: number, path: number, outLen: number) => number;
  _bn_vfs_unlink: (k: number, path: number) => number;
  _bn_vfs_rmdir?: (k: number, path: number) => number;
  _bn_vfs_rename?: (k: number, from: number, to: number) => number;
  _bn_vfs_readdir_json: (k: number, path: number) => number;
  _bn_vfs_exists: (k: number, path: number) => number;
  _bn_vfs_symlink?: (k: number, target: number, linkpath: number) => number;
  _bn_vfs_readlink?: (k: number, path: number) => number;
  _bn_vfs_lstat_json?: (k: number, path: number, outJson: number) => number;
  _bn_vfs_stat_json?: (k: number, path: number, outJson: number) => number;
  _bn_spawn: (k: number, cmd: number, argvJson: number, cwd: number, envJson: number) => number;
  _bn_wait: (k: number, pid: number) => number;
  _bn_kill: (k: number, pid: number) => number;
  _bn_pump?: (k: number, now_ms: number) => number;
  _bn_vfs_extract_tar?: (k: number, data: number, len: number, dest: number) => number;
  _bn_vfs_usage?: (k: number) => number;
  _bn_read_stdout: (k: number, pid: number, buf: number, len: number) => number;
  _bn_read_stderr: (k: number, pid: number, buf: number, len: number) => number;
  _bn_write_stdin: (k: number, pid: number, buf: number, len: number) => number;
  _bn_write_stdout?: (k: number, pid: number, buf: number, len: number) => number;
  _bn_write_stderr?: (k: number, pid: number, buf: number, len: number) => number;
  _bn_complete?: (k: number, pid: number, code: number) => number;
  _bn_http_dispatch?: (
    k: number,
    port: number,
    method: number,
    path: number,
    headers: number,
    body: number,
  ) => number;
  _bn_free: (p: number) => void;
  getValue?: (ptr: number, type: string) => number;
  setValue?: (ptr: number, value: number, type: string) => void;
};

declare global {
  interface Window {
    createBrowserNodeKernel?: (opts?: Record<string, unknown>) => Promise<EmscriptenModule>;
  }
}

function wrap(mod: EmscriptenModule): KernelModule {
  const allocStr = (s: string): number => {
    const n = mod.lengthBytesUTF8(s) + 1;
    const p = mod._malloc(n);
    mod.stringToUTF8(s, p, n);
    return p;
  };

  const readCString = (ptr: number): string | null => {
    if (!ptr) return null;
    const s = mod.UTF8ToString(ptr);
    mod._bn_free(ptr);
    return s;
  };

  const writePipe = (
    fn: (k: number, pid: number, buf: number, len: number) => number,
    k: number,
    pid: number,
    data: string,
  ) => {
    const bytes = new TextEncoder().encode(data);
    let off = 0;
    while (off < bytes.byteLength) {
      const slice = bytes.subarray(off);
      const buf = mod._malloc(slice.byteLength);
      try {
        mod.HEAPU8.set(slice, buf);
        const n = fn(k, pid, buf, slice.byteLength);
        if (n <= 0) break;
        off += n;
      } finally {
        mod._free(buf);
      }
    }
    return off;
  };

  const readPipe = (fn: (k: number, pid: number, buf: number, len: number) => number, k: number, pid: number) => {
    const buf = mod._malloc(65536);
    try {
      const n = fn(k, pid, buf, 65536);
      if (n <= 0) return '';
      return new TextDecoder().decode(mod.HEAPU8.subarray(buf, buf + n));
    } finally {
      mod._free(buf);
    }
  };

  const readLstatKind = (k: number, path: string): string | null => {
    return readStatKind(k, path, false);
  };

  const readStatKind = (k: number, path: string, follow: boolean): string | null => {
    const fn = follow ? mod._bn_vfs_stat_json : mod._bn_vfs_lstat_json;
    if (!fn) return null;
    const p = allocStr(path);
    const outPtr = mod._malloc(4);
    try {
      if (!fn(k, p, outPtr)) return null;
      const jsonPtr =
        mod.getValue?.(outPtr, 'i32') ??
        new DataView(mod.HEAPU8.buffer).getUint32(outPtr, true);
      const json = readCString(jsonPtr);
      if (!json) return null;
      try {
        return (JSON.parse(json) as { kind?: string }).kind ?? null;
      } catch {
        return null;
      }
    } finally {
      mod._free(p);
      mod._free(outPtr);
    }
  };

  return {
    create: () => mod._bn_kernel_create(),
    destroy: (k) => {
      mod._bn_kernel_destroy(k);
    },
    registerBuiltins: (k) => mod._bn_register_builtins(k),
    mkdir: (k, path, recursive) => {
      const p = allocStr(path);
      try {
        return !!mod._bn_vfs_mkdir(k, p, recursive ? 1 : 0);
      } finally {
        mod._free(p);
      }
    },
    writeText: (k, path, text) => {
      const p = allocStr(path);
      const t = allocStr(text);
      try {
        return !!mod._bn_vfs_write_text(k, p, t);
      } finally {
        mod._free(p);
        mod._free(t);
      }
    },
    writeBytes: (k, path, data) => {
      const p = allocStr(path);
      const buf = mod._malloc(data.byteLength);
      try {
        mod.HEAPU8.set(data, buf);
        return !!mod._bn_vfs_write_bytes(k, p, buf, data.byteLength);
      } finally {
        mod._free(p);
        mod._free(buf);
      }
    },
    readText: (k, path) => {
      const p = allocStr(path);
      try {
        return readCString(mod._bn_vfs_read_text(k, p));
      } finally {
        mod._free(p);
      }
    },
    readBytes: mod._bn_vfs_read_bytes
      ? (k, path) => {
          const p = allocStr(path);
          const lenPtr = mod._malloc(4);
          try {
            const ptr = mod._bn_vfs_read_bytes!(k, p, lenPtr);
            if (!ptr) return null;
            const len =
              mod.getValue?.(lenPtr, 'i32') ??
              new DataView(mod.HEAPU8.buffer).getUint32(lenPtr, true);
            const out = mod.HEAPU8.slice(ptr, ptr + len);
            mod._bn_free(ptr);
            return out;
          } finally {
            mod._free(p);
            mod._free(lenPtr);
          }
        }
      : undefined,
    unlink: (k, path) => {
      const p = allocStr(path);
      try {
        return !!mod._bn_vfs_unlink(k, p);
      } finally {
        mod._free(p);
      }
    },
    rmdir: mod._bn_vfs_rmdir
      ? (k, path) => {
          const p = allocStr(path);
          try {
            return !!mod._bn_vfs_rmdir!(k, p);
          } finally {
            mod._free(p);
          }
        }
      : undefined,
    rename: mod._bn_vfs_rename
      ? (k, from, to) => {
          const a = allocStr(from);
          const b = allocStr(to);
          try {
            return !!mod._bn_vfs_rename!(k, a, b);
          } finally {
            mod._free(a);
            mod._free(b);
          }
        }
      : undefined,
    readdir: (k, path) => {
      const p = allocStr(path);
      try {
        const json = readCString(mod._bn_vfs_readdir_json(k, p));
        if (!json) return [];
        return JSON.parse(json) as string[];
      } finally {
        mod._free(p);
      }
    },
    exists: (k, path) => {
      const p = allocStr(path);
      try {
        return !!mod._bn_vfs_exists(k, p);
      } finally {
        mod._free(p);
      }
    },
    isDir: (k, path) => {
      if (path === '/' || path === '') return true;
      const kind = readStatKind(k, path, true);
      if (kind != null) return kind === 'directory';
      const p = allocStr(path);
      try {
        if (!mod._bn_vfs_exists(k, p)) return false;
      } finally {
        mod._free(p);
      }
      // directories have no text content in the C++ VFS
      const p2 = allocStr(path);
      try {
        const t = readCString(mod._bn_vfs_read_text(k, p2));
        return t == null;
      } finally {
        mod._free(p2);
      }
    },
    symlink: mod._bn_vfs_symlink
      ? (k, target, linkpath) => {
          const t = allocStr(target);
          const p = allocStr(linkpath);
          try {
            return !!mod._bn_vfs_symlink!(k, t, p);
          } finally {
            mod._free(t);
            mod._free(p);
          }
        }
      : undefined,
    readlink: mod._bn_vfs_readlink
      ? (k, path) => {
          const p = allocStr(path);
          try {
            return readCString(mod._bn_vfs_readlink!(k, p));
          } finally {
            mod._free(p);
          }
        }
      : undefined,
    lstatKind: mod._bn_vfs_lstat_json
      ? (k, path) => readLstatKind(k, path)
      : undefined,
    spawn: (k, cmd, argv, cwd, env) => {
      const c = allocStr(cmd);
      const a = allocStr(JSON.stringify(argv));
      const d = allocStr(cwd);
      const e = allocStr(JSON.stringify(env ?? {}));
      try {
        return mod._bn_spawn(k, c, a, d, e);
      } finally {
        mod._free(c);
        mod._free(a);
        mod._free(d);
        mod._free(e);
      }
    },
    wait: (k, pid) => mod._bn_wait(k, pid),
    kill: (k, pid) => !!mod._bn_kill(k, pid),
    pump: mod._bn_pump ? (k, nowMs) => mod._bn_pump!(k, nowMs ?? 0) : undefined,
    extractTar: mod._bn_vfs_extract_tar
      ? (k, data, destDir) => {
          const dest = allocStr(destDir);
          const buf = mod._malloc(data.byteLength || 1);
          try {
            if (data.byteLength) mod.HEAPU8.set(data, buf);
            return mod._bn_vfs_extract_tar!(k, buf, data.byteLength, dest);
          } finally {
            mod._free(buf);
            mod._free(dest);
          }
        }
      : undefined,
    usageBytes: mod._bn_vfs_usage ? (k) => mod._bn_vfs_usage!(k) : undefined,
    readStdout: (k, pid) => readPipe(mod._bn_read_stdout, k, pid),
    readStderr: (k, pid) => readPipe(mod._bn_read_stderr, k, pid),
    writeStdin: (k, pid, data) => writePipe(mod._bn_write_stdin, k, pid, data),
    writeStdout: mod._bn_write_stdout
      ? (k, pid, data) => writePipe(mod._bn_write_stdout!, k, pid, data)
      : undefined,
    writeStderr: mod._bn_write_stderr
      ? (k, pid, data) => writePipe(mod._bn_write_stderr!, k, pid, data)
      : undefined,
    complete: mod._bn_complete ? (k, pid, code) => mod._bn_complete!(k, pid, code) : undefined,
    httpDispatch: mod._bn_http_dispatch
      ? (k, port, method, path, headersJson, body) => {
          const m = allocStr(method);
          const p = allocStr(path);
          const h = allocStr(headersJson);
          const b = allocStr(body);
          try {
            return readCString(mod._bn_http_dispatch!(k, port, m, p, h, b));
          } finally {
            mod._free(m);
            mod._free(p);
            mod._free(h);
            mod._free(b);
          }
        }
      : undefined,
  };
}

const WASM_REQUIRED =
  'WASM kernel required. There is no JavaScript guest Node. Build with npm run build:wasm.';

/** @deprecated Removed in Phase 13b — always throws. */
export function createJsFallbackKernel(): never {
  throw new Error(WASM_REQUIRED);
}

let cachedWasmFactory: KernelModule | null = null;

export type UseWasmOption = boolean | 'auto';

export type LoadKernelOptions = {
  /**
   * Guest is C++/WASM only.
   * - `true` / `'auto'` / omitted — load WASM or throw
   * - `false` — throws (`js-runtime.ts` deleted)
   */
  useWasm?: UseWasmOption;
};

/** Clear kernel caches (tests). Await this before the next `boot()` so the Worker is gone. */
export async function resetKernelCache(): Promise<void> {
  cachedWasmFactory = null;
  try {
    const m = await import('./kernel-proxy.js');
    m.terminateKernelWorker();
  } catch {
    /* ignore */
  }
}

export function defaultWasmJsUrl(): string {
  return new URL('../../wasm/browsernode_kernel.js', import.meta.url).href;
}

/** Load C++/WASM on this thread (Worker body, Node, or Worker-unavailable browsers). */
export async function loadWasmOnThisThread(wasmUrl?: string): Promise<KernelModule | null> {
  const url = wasmUrl ?? defaultWasmJsUrl();
  const locate = (path: string) => new URL(path, url).href;
  try {
    const factory = await import(/* @vite-ignore */ url).catch(() => null);
    if (factory && typeof (factory as { default?: unknown }).default === 'function') {
      const mod = (await (factory as { default: (o?: object) => Promise<EmscriptenModule> }).default({
        locateFile: locate,
      })) as EmscriptenModule;
      const wrapped = wrap(mod);
      wrapped.runtime = 'wasm';
      wrapped.worker = false;
      return wrapped;
    }

    if (typeof document !== 'undefined') {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('wasm js load failed'));
        document.head.appendChild(s);
      }).catch(() => undefined);

      if (typeof window !== 'undefined' && window.createBrowserNodeKernel) {
        const mod = await window.createBrowserNodeKernel({
          locateFile: locate,
        });
        const wrapped = wrap(mod);
        wrapped.runtime = 'wasm';
        wrapped.worker = false;
        return wrapped;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function tryLoadWasm(wasmUrl?: string): Promise<KernelModule | null> {
  const url = wasmUrl ?? defaultWasmJsUrl();
  const inKernelWorker = !!(globalThis as unknown as { __BN_KERNEL_THREAD__?: boolean }).__BN_KERNEL_THREAD__;
  if (!inKernelWorker && typeof Worker === 'function' && typeof document !== 'undefined') {
    try {
      const { createWorkerKernel } = await import('./kernel-proxy.js');
      return await createWorkerKernel(url);
    } catch {
      /* same-thread WASM — tab may freeze on long node */
    }
  }
  return loadWasmOnThisThread(url);
}

export async function loadKernel(wasmUrl?: string, opts?: LoadKernelOptions): Promise<KernelModule> {
  const mode: UseWasmOption = opts?.useWasm === undefined ? true : opts.useWasm;
  if (mode === false) {
    throw new Error(WASM_REQUIRED);
  }

  if (cachedWasmFactory) return cachedWasmFactory;

  const wasm = await tryLoadWasm(wasmUrl);
  if (wasm) {
    cachedWasmFactory = wasm;
    return wasm;
  }

  throw new Error(WASM_REQUIRED);
}
