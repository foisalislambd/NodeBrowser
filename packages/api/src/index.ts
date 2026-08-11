import type { FileSystemTree, SpawnOptions, BrowserNodeProcess, BrowserNodeEventMap } from './types.js';
import { loadKernel, type KernelModule, type KernelHandle, type LoadKernelOptions } from './kernel.js';
import { flattenTree } from './fs-tree.js';
import { installPackage } from './npm-install.js';
import { HttpBridge } from './http-bridge.js';
import { bundleWithEsbuild, type BundleOptions } from './esbuild-bundle.js';
import type { HttpRegistrar } from './kernel.js';

type Listener<K extends keyof BrowserNodeEventMap> = (...args: BrowserNodeEventMap[K]) => void;

export class NodeBrowser {
  #mod: KernelModule;
  #k: KernelHandle;
  #listeners = new Map<string, Set<Function>>();
  #previewBase: string;
  #booted = true;
  #http = new HttpBridge();
  #detachSw: (() => void) | null = null;
  #portsByPid = new Map<number, Set<number>>();
  /** Which kernel is driving this instance. */
  readonly runtime: 'js' | 'wasm';

  private constructor(mod: KernelModule, k: KernelHandle, previewBase: string) {
    this.#mod = mod;
    this.#k = k;
    this.#previewBase = previewBase;
    this.runtime = mod.runtime === 'wasm' ? 'wasm' : 'js';
    this.#wireHttp();
  }

  static async boot(
    options?: {
      wasmUrl?: string;
      previewBase?: string;
      /** `auto` (default) tries WASM then JS; `true` prefers WASM; `false` forces JS */
      useWasm?: boolean | 'auto';
    } & LoadKernelOptions,
  ): Promise<NodeBrowser> {
    const useWasm = options?.useWasm === undefined ? 'auto' : options.useWasm;
    const mod = await loadKernel(options?.wasmUrl, { useWasm });
    const k = mod.create();
    mod.registerBuiltins(k);
    const previewBase =
      options?.previewBase ??
      (typeof location !== 'undefined'
        ? new URL(
            '__bn_preview',
            typeof document !== 'undefined' && document.baseURI ? document.baseURI : location.href,
          ).href.replace(/\/$/, '')
        : 'http://localhost/__bn_preview');
    return new NodeBrowser(mod, k, previewBase);
  }

  get fs() {
    const mod = this.#mod;
    const k = this.#k;
    const isDir = (path: string): boolean => {
      if (path === '/' || path === '') return true;
      if (mod.isDir) return mod.isDir(k, path);
      if (!mod.exists(k, path)) return false;
      return mod.readText(k, path) === null;
    };
    const joinFs = (dir: string, name: string) => {
      if (dir === '/') return `/${name}`;
      return `${dir.replace(/\/+$/, '')}/${name}`;
    };
    const readBytes = (path: string): Uint8Array => {
      if (mod.readBytes) {
        const b = mod.readBytes(k, path);
        if (b == null) throw new Error(`ENOENT: ${path}`);
        return b;
      }
      const t = mod.readText(k, path);
      if (t == null) throw new Error(`ENOENT: ${path}`);
      return new TextEncoder().encode(t);
    };
    const rmTree = async (path: string): Promise<void> => {
      if (!mod.exists(k, path)) return;
      if (isDir(path)) {
        for (const name of mod.readdir(k, path)) {
          await rmTree(joinFs(path, name));
        }
      }
      if (!mod.unlink(k, path) && mod.exists(k, path)) {
        throw new Error(`EPERM: cannot remove ${path}`);
      }
    };
    const copyTree = async (from: string, to: string): Promise<void> => {
      if (isDir(from)) {
        mod.mkdir(k, to, true);
        for (const name of mod.readdir(k, from)) {
          await copyTree(joinFs(from, name), joinFs(to, name));
        }
        return;
      }
      const bytes = readBytes(from);
      mod.writeBytes(k, to, bytes);
    };
    return {
      writeFile: async (path: string, data: string | Uint8Array) => {
        if (typeof data === 'string') mod.writeText(k, path, data);
        else mod.writeBytes(k, path, data);
      },
      readFile: (async (path: string, encoding?: 'utf8' | 'buffer') => {
        if (encoding === 'buffer') return readBytes(path);
        const t = mod.readText(k, path);
        if (t == null) throw new Error(`ENOENT: ${path}`);
        return t;
      }) as {
        (path: string, encoding: 'utf8'): Promise<string>;
        (path: string, encoding: 'buffer'): Promise<Uint8Array>;
        (path: string): Promise<string>;
      },
      readdir: async (path: string) => {
        if (path !== '/' && !mod.exists(k, path)) throw new Error(`ENOENT: ${path}`);
        return mod.readdir(k, path);
      },
      mkdir: async (path: string, opts?: { recursive?: boolean }) => {
        mod.mkdir(k, path, opts?.recursive ?? true);
      },
      exists: async (path: string) => path === '/' || mod.exists(k, path),
      stat: async (path: string) => {
        if (path !== '/' && !mod.exists(k, path)) throw new Error(`ENOENT: ${path}`);
        const dir = isDir(path);
        return {
          isFile: () => !dir,
          isDirectory: () => dir,
        };
      },
      rm: async (path: string, opts?: { recursive?: boolean }) => {
        if (!mod.exists(k, path) && path !== '/') throw new Error(`ENOENT: ${path}`);
        if (opts?.recursive) {
          await rmTree(path);
          return;
        }
        if (isDir(path)) throw new Error(`EISDIR: ${path} (use { recursive: true })`);
        if (!mod.unlink(k, path)) throw new Error(`ENOENT: ${path}`);
      },
      rename: async (from: string, to: string) => {
        if (!mod.exists(k, from)) throw new Error(`ENOENT: ${from}`);
        if (mod.rename) {
          if (!mod.rename(k, from, to)) throw new Error(`EPERM: rename ${from} → ${to}`);
          return;
        }
        await copyTree(from, to);
        await rmTree(from);
      },
    };
  }

  get http(): HttpBridge {
    return this.#http;
  }

  /** Attach Service Worker ↔ HttpBridge message bridge (call once after SW registers). */
  attachServiceWorkerBridge(previewBasePath = '/__bn_preview'): () => void {
    this.#detachSw?.();
    this.#detachSw = this.#http.attachServiceWorkerBridge(previewBasePath);
    return this.#detachSw;
  }

  /** Dispatch a preview HTTP request (used by tests / manual bridge). */
  async handleHttp(req: {
    id: string;
    port: number;
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string;
  }) {
    return this.#http.dispatch({
      id: req.id,
      port: req.port,
      method: req.method || 'GET',
      path: req.path || '/',
      headers: req.headers,
      body: req.body,
    });
  }

  async mount(tree: FileSystemTree, mountPoint = '/'): Promise<void> {
    const files = flattenTree(tree, mountPoint === '/' ? '' : mountPoint);
    for (const [path, contents] of Object.entries(files)) {
      this.#mod.writeText(this.#k, path, contents);
    }
  }

  async spawn(cmd: string, args: string[] = [], opts: SpawnOptions = {}): Promise<BrowserNodeProcess> {
    const cwd = opts.cwd ?? '/';

    // Reserve pid tracking up-front — listen() fires synchronously inside spawn().
    const pendingPorts = new Set<number>();
    const notify = globalThis as unknown as {
      __bn_on_server_ready?: (port: number) => void;
      __bn_on_http_listen?: (port: number) => void;
    };
    // Hooks must be installed BEFORE spawn — listen() runs synchronously inside it.
    notify.__bn_on_server_ready = (port: number) => {
      pendingPorts.add(port | 0);
      const url = `${this.#previewBase}/${port}/`;
      this.#emit('server-ready', port, url);
    };
    notify.__bn_on_http_listen = (port: number) => {
      pendingPorts.add(port | 0);
      this.#ensureWasmHttpHandler(port);
      const url = `${this.#previewBase}/${port}/`;
      this.#emit('server-ready', port, url);
    };

    const pid = this.#mod.spawn(this.#k, cmd, args, cwd, opts.env);
    if (pendingPorts.size) this.#portsByPid.set(pid, pendingPorts);

    let exitResolve!: (code: number) => void;
    const exit = new Promise<number>((r) => {
      exitResolve = r;
    });

    const output = new ReadableStream<string>({
      start: (controller) => {
        const poll = () => {
          const out = this.#mod.readStdout(this.#k, pid);
          const err = this.#mod.readStderr(this.#k, pid);
          if (out) controller.enqueue(out);
          if (err) controller.enqueue(err);
          const code = this.#mod.wait(this.#k, pid);
          if (code === -1) {
            // Yield to the event loop so HTTP / timers can run while keep-alive
            setTimeout(poll, 16);
            return;
          }
          const out2 = this.#mod.readStdout(this.#k, pid);
          const err2 = this.#mod.readStderr(this.#k, pid);
          if (out2) controller.enqueue(out2);
          if (err2) controller.enqueue(err2);
          controller.close();
          exitResolve(code);
        };
        queueMicrotask(poll);
      },
    });

    return {
      pid,
      exit,
      output,
      kill: () => {
        for (const port of this.#portsByPid.get(pid) ?? []) this.#http.close(port);
        this.#portsByPid.delete(pid);
        this.#mod.kill(this.#k, pid);
      },
      write: (data: string) => this.#mod.writeStdin(this.#k, pid, data),
    };
  }

  /** Install npm packages into cwd/node_modules (deps + cache). */
  async install(packages: string[], cwd = '/'): Promise<void> {
    for (const pkg of packages) {
      await installPackage(this, pkg, cwd, {
        withDeps: true,
        onProgress: (p) => this.#emit('install-progress', p),
      });
    }
  }

  /**
   * Serve a VFS directory on a virtual HTTP port (Vite/Next preview & static hosting).
   * Returns the preview URL.
   */
  serveStatic(port: number, rootDir: string, opts?: { index?: string }): string {
    const root = rootDir.replace(/\/+$/, '') || '/';
    const indexName = opts?.index || 'index.html';
    this.#http.listen(port, async (req, res) => {
      const urlPath = (req.url || '/').split('?')[0] || '/';
      let rel = decodeURIComponent(urlPath);
      if (rel === '/' || rel === '') rel = '/' + indexName;
      const filePath = (root + (rel.startsWith('/') ? rel : '/' + rel)).replace(/\/+/g, '/');
      try {
        const body = await this.fs.readFile(filePath, 'utf8');
        res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
        res.end(body);
      } catch {
        // SPA fallback → index.html
        try {
          const idx = `${root}/${indexName}`.replace(/\/+/g, '/');
          const body = await this.fs.readFile(idx, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(body);
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`Not found: ${filePath}`);
        }
      }
    });
    const url = `${this.#previewBase}/${port}/`;
    this.#emit('server-ready', port, url);
    return url;
  }

  /** Stop serving a virtual port (dev server restart). */
  closePort(port: number): void {
    this.#http.close(port);
  }

  /** Bundle a VFS entry with esbuild-wasm; optionally serve `serveRoot` on `servePort`. */
  async bundle(
    opts: BundleOptions & { servePort?: number; serveRoot?: string },
  ): Promise<{ outfile: string; code: string; url?: string }> {
    const result = await bundleWithEsbuild(this.fs, opts);
    let url: string | undefined;
    if (opts.servePort != null) {
      const root = opts.serveRoot || dirnamePath(opts.outfile || '/dist/bundle.js');
      url = this.serveStatic(opts.servePort, root);
    }
    return { ...result, url };
  }

  on<K extends keyof BrowserNodeEventMap>(event: K, fn: Listener<K>): void {
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event)!.add(fn);
  }

  off<K extends keyof BrowserNodeEventMap>(event: K, fn: Listener<K>): void {
    this.#listeners.get(event)?.delete(fn);
  }

  #emit<K extends keyof BrowserNodeEventMap>(event: K, ...args: BrowserNodeEventMap[K]): void {
    for (const fn of this.#listeners.get(event) ?? []) {
      (fn as Function)(...args);
    }
  }

  #wireHttp(): void {
    const registrar: HttpRegistrar = (port, handler) => {
      this.#http.listen(port, handler as Parameters<HttpBridge['listen']>[1]);
    };
    this.#mod.setHttpRegistrar?.(registrar);
  }

  #ensureWasmHttpHandler(port: number): void {
    if (this.#http.has(port)) return;
    const dispatch = this.#mod.httpDispatch;
    if (!dispatch) return;
    this.#http.listen(port, (req, res) => {
      const raw = dispatch(
        this.#k,
        port,
        req.method,
        req.url,
        JSON.stringify(req.headers || {}),
        req.body || '',
      );
      if (!raw) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('WASM HTTP dispatch failed');
        return;
      }
      try {
        const parsed = JSON.parse(raw) as {
          status?: number;
          headers?: Record<string, string>;
          body?: string;
        };
        res.writeHead(parsed.status || 200, parsed.headers || {});
        res.end(parsed.body || '');
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(raw);
      }
    });
  }

  teardown(): void {
    this.#detachSw?.();
    this.#detachSw = null;
    this.#mod.destroy(this.#k);
    this.#booted = false;
  }
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.html') || filePath.endsWith('.htm')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function dirnamePath(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

export type { FileSystemTree, FileNode, SpawnOptions, BrowserNodeProcess, BrowserNodeEventMap } from './types.js';
export type { BundleOptions } from './esbuild-bundle.js';
export type { InstallProgress } from './npm-install.js';
export { HttpBridge } from './http-bridge.js';
export { resetKernelCache, type UseWasmOption } from './kernel.js';
/** @deprecated Use `NodeBrowser` — kept for older snippets */
export const BrowserNode = NodeBrowser;
