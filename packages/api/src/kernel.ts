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
  unlink(k: KernelHandle, path: string): boolean;
  readdir(k: KernelHandle, path: string): string[];
  exists(k: KernelHandle, path: string): boolean;
  /** Optional — JS fallback; WASM may use readText heuristic via BrowserNode.fs */
  isDir?(k: KernelHandle, path: string): boolean;
  spawn(k: KernelHandle, cmd: string, argv: string[], cwd: string): number;
  wait(k: KernelHandle, pid: number): number;
  kill(k: KernelHandle, pid: number): boolean;
  readStdout(k: KernelHandle, pid: number): string;
  readStderr(k: KernelHandle, pid: number): string;
  writeStdin(k: KernelHandle, pid: number, data: string): number;
  /** Optional: JS fallback exposes this for HttpBridge wiring. */
  setHttpRegistrar?: (fn: HttpRegistrar | null) => void;
  /** Optional: WASM keep-alive HTTP dispatch (JSON result string). */
  httpDispatch?: (
    k: KernelHandle,
    port: number,
    method: string,
    path: string,
    headersJson: string,
    body: string,
  ) => string | null;
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
  _bn_vfs_unlink: (k: number, path: number) => number;
  _bn_vfs_readdir_json: (k: number, path: number) => number;
  _bn_vfs_exists: (k: number, path: number) => number;
  _bn_spawn: (k: number, cmd: number, argvJson: number, cwd: number) => number;
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
    spawn: (k, cmd, argv, cwd) => {
      const c = allocStr(cmd);
      const a = allocStr(JSON.stringify(argv));
      const d = allocStr(cwd);
      try {
        return mod._bn_spawn(k, c, a, d);
      } finally {
        mod._free(c);
        mod._free(a);
        mod._free(d);
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
  return createJsRuntime();
}

let cached: KernelModule | null = null;

export type LoadKernelOptions = {
  /** Force the C++/WASM kernel when available (default false — JS runtime has full HTTP keep-alive). */
  useWasm?: boolean;
};

export async function loadKernel(wasmUrl?: string, opts?: LoadKernelOptions): Promise<KernelModule> {
  if (cached) return cached;

  const useWasm = opts?.useWasm === true;
  if (useWasm) {
    const url = wasmUrl ?? new URL('../../wasm/browsernode_kernel.js', import.meta.url).href;
    try {
      const factory = await import(/* @vite-ignore */ url).catch(() => null);
      if (factory && typeof (factory as { default?: unknown }).default === 'function') {
        const mod = (await (factory as { default: (o?: object) => Promise<EmscriptenModule> }).default({
          locateFile: (path: string) => new URL(`../../wasm/${path}`, import.meta.url).href,
        })) as EmscriptenModule;
        cached = wrap(mod);
        return cached;
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
            locateFile: (path: string) => url.replace(/browsernode_kernel\\.js.*/, path),
          });
          cached = wrap(mod);
          return cached;
        }
      }
    } catch {
      // fall through
    }
    console.warn('[browsernode] WASM kernel requested but unavailable — using JS runtime');
  }

  cached = createJsRuntime();
  return cached;
}
