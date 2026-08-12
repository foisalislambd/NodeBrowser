import { createJsFallbackKernel as createJsRuntime, type HttpRegistrar } from './js-runtime.js';

export type { HttpRegistrar };

export type KernelHandle = number;

export interface KernelModule {
  create(): KernelHandle;
  destroy(k: KernelHandle): void;
  registerBuiltins(k: KernelHandle): void;
  mkdir(k: KernelHandle, path: string, recursive: boolean): boolean;
  writeText(k: KernelHandle, path: string, text: string): boolean;
  writeBytes(k: KernelHandle, path: string, data: Uint8Array): boolean;
  readText(k: KernelHandle, path: string): string | null;
  /** Optional — binary read; host falls back to TextEncoder on readText */
  readBytes?(k: KernelHandle, path: string): Uint8Array | null;
  unlink(k: KernelHandle, path: string): boolean;
  /** Optional — host implements portable fallback if missing */
  rename?(k: KernelHandle, from: string, to: string): boolean;
  readdir(k: KernelHandle, path: string): string[];
  exists(k: KernelHandle, path: string): boolean;
  /** Optional — JS fallback; WASM may use readText heuristic via NodeBrowser.fs */
  isDir?(k: KernelHandle, path: string): boolean;
  /** Optional — C++ VFS symlink ABI (WASM) / JS kernel */
  symlink?(k: KernelHandle, target: string, linkpath: string): boolean;
  readlink?(k: KernelHandle, path: string): string | null;
  /** Returns "file" | "directory" | "symlink" (WASM lstat JSON) or JS kind */
  lstatKind?(k: KernelHandle, path: string): string | null;
  spawn(
    k: KernelHandle,
    cmd: string,
    argv: string[],
    cwd: string,
    env?: Record<string, string>,
  ): number;
  wait(k: KernelHandle, pid: number): number;
  kill(k: KernelHandle, pid: number): boolean;
  readStdout(k: KernelHandle, pid: number): string;
  readStderr(k: KernelHandle, pid: number): string;
  writeStdin(k: KernelHandle, pid: number, data: string): number;
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
  ) => string | null;
  /** Set by loadKernel */
  runtime?: 'js' | 'wasm';
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
  _bn_vfs_readdir_json: (k: number, path: number) => number;
  _bn_vfs_exists: (k: number, path: number) => number;
  _bn_vfs_symlink?: (k: number, target: number, linkpath: number) => number;
  _bn_vfs_readlink?: (k: number, path: number) => number;
  _bn_vfs_lstat_json?: (k: number, path: number, outJson: number) => number;
  _bn_vfs_stat_json?: (k: number, path: number, outJson: number) => number;
  _bn_spawn: (k: number, cmd: number, argvJson: number, cwd: number, envJson: number) => number;
  _bn_wait: (k: number, pid: number) => number;
  _bn_kill: (k: number, pid: number) => number;
  _bn_read_stdout: (k: number, pid: number, buf: number, len: number) => number;
  _bn_read_stderr: (k: number, pid: number, buf: number, len: number) => number;
  _bn_write_stdin: (k: number, pid: number, buf: number, len: number) => number;
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
    if (!mod._bn_vfs_lstat_json) return null;
    const p = allocStr(path);
    const outPtr = mod._malloc(4);
    try {
      if (!mod._bn_vfs_lstat_json(k, p, outPtr)) return null;
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
    destroy: (k) => mod._bn_kernel_destroy(k),
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
      const kind = readLstatKind(k, path);
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
    readStdout: (k, pid) => readPipe(mod._bn_read_stdout, k, pid),
    readStderr: (k, pid) => readPipe(mod._bn_read_stderr, k, pid),
    writeStdin: (k, pid, data) => {
      const bytes = new TextEncoder().encode(data);
      const buf = mod._malloc(bytes.byteLength);
      try {
        mod.HEAPU8.set(bytes, buf);
        return mod._bn_write_stdin(k, pid, buf, bytes.byteLength);
      } finally {
        mod._free(buf);
      }
    },
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

/** Pure-JS Node runtime (keep-alive HTTP, Buffer, fs.promises). */
export function createJsFallbackKernel(): KernelModule {
  const mod = createJsRuntime();
  mod.runtime = 'js';
  return mod;
}

let cachedWasmFactory: KernelModule | null = null;

export type UseWasmOption = boolean | 'auto';

export type LoadKernelOptions = {
  /**
   * - `true` (default) — C++/WASM only; throws if WASM missing unless `BN_ALLOW_JS_KERNEL=1`
   * - `false` — JS fallback only; requires `BN_ALLOW_JS_KERNEL=1` or throws
   * - `'auto'` — try WASM, else frozen JS fallback
   */
  useWasm?: UseWasmOption;
};

/** Clear kernel caches (tests). */
export function resetKernelCache(): void {
  cachedWasmFactory = null;
}

async function tryLoadWasm(wasmUrl?: string): Promise<KernelModule | null> {
  const url = wasmUrl ?? new URL('../../../wasm/browsernode_kernel.js', import.meta.url).href;
  try {
    const factory = await import(/* @vite-ignore */ url).catch(() => null);
    if (factory && typeof (factory as { default?: unknown }).default === 'function') {
      const mod = (await (factory as { default: (o?: object) => Promise<EmscriptenModule> }).default({
        locateFile: (path: string) => new URL(`../../../wasm/${path}`, import.meta.url).href,
      })) as EmscriptenModule;
      const wrapped = wrap(mod);
      wrapped.runtime = 'wasm';
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
          locateFile: (path: string) => url.replace(/browsernode_kernel\.js.*/, path),
        });
        const wrapped = wrap(mod);
        wrapped.runtime = 'wasm';
        return wrapped;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function loadKernel(wasmUrl?: string, opts?: LoadKernelOptions): Promise<KernelModule> {
  const mode: UseWasmOption = opts?.useWasm === undefined ? true : opts.useWasm;
  const env =
    typeof globalThis !== 'undefined'
      ? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      : undefined;
  const allowJs =
    mode === 'auto' ||
    env?.BN_ALLOW_JS_KERNEL === '1' ||
    (typeof globalThis !== 'undefined' &&
      (globalThis as { BN_ALLOW_JS_KERNEL?: boolean }).BN_ALLOW_JS_KERNEL === true);

  if (mode === false) {
    if (!allowJs) {
      throw new Error(
        'WASM kernel required (Phase 13b). Pass useWasm: "auto" or set BN_ALLOW_JS_KERNEL=1 for the frozen JS fallback.',
      );
    }
    return createJsFallbackKernel();
  }

  if (cachedWasmFactory) return cachedWasmFactory;

  const wasm = await tryLoadWasm(wasmUrl);
  if (wasm) {
    cachedWasmFactory = wasm;
    return wasm;
  }

  if (mode === true && !allowJs) {
    throw new Error(
      'WASM kernel required but browsernode_kernel.wasm failed to load. Build with npm run build:wasm, or useWasm: "auto".',
    );
  }

  if (mode === true) {
    console.warn('[browsernode] WASM kernel requested but unavailable — using JS runtime (BN_ALLOW_JS_KERNEL)');
  }

  return createJsFallbackKernel();
}
