import type { FileSystemTree, SpawnOptions, BrowserNodeProcess, BrowserNodeEventMap } from './types.js';
import { loadKernel, type KernelModule, type KernelHandle, type LoadKernelOptions } from '../kernel/load.js';
import { flattenTree } from '../fs/tree.js';
import { installPackage } from '../npm/install.js';
import { detectForeignLockfile } from '../npm/lockfiles.js';
import { HttpBridge } from '../net/http-bridge.js';
import { bundleWithEsbuild, type BundleOptions } from '../bundler/esbuild.js';
import { viteBuild, viteDev } from '../bundler/vite.js';
import { nextBuild, nextDev } from '../bundler/next.js';
import type { HttpRegistrar } from '../kernel/load.js';
import {
  createOpfsFlusher,
  exportHomeTarGz,
  hydrateFromOpfs,
  importHomeTarGz,
  opfsAvailable,
} from '../fs/opfs.js';
import { zlibPureSync } from '../compress/zlib.js';
import { extractArchive, stripSingleRoot, joinArchivePath } from '../fs/zip.js';
import { previewProject, type PreviewResult } from '../bundler/preview.js';
import { handleAgentRpc, type AgentRpcRequest, type AgentRpcResponse } from './json-rpc.js';

type Listener<K extends keyof BrowserNodeEventMap> = (...args: BrowserNodeEventMap[K]) => void;

function asy<T>(v: T | Promise<T>): Promise<T> {
  return Promise.resolve(v);
}

export class NodeBrowser {
  #mod: KernelModule;
  #k: KernelHandle;
  #listeners = new Map<string, Set<Function>>();
  #previewBase: string;
  #booted = true;
  #http = new HttpBridge();
  #detachSw: (() => void) | null = null;
  #portsByPid = new Map<number, Set<number>>();
  /** Host-spawned children of C++ `npm`/`npx` (ABI spawn has no parent pid). */
  #spawnChildren = new Map<number, Set<number>>();
  #persist = false;
  #opfsFlusher: ReturnType<typeof createOpfsFlusher> | null = null;
  /** Which kernel is driving this instance. */
  readonly runtime: 'js' | 'wasm';

  private constructor(
    mod: KernelModule,
    k: KernelHandle,
    previewBase: string,
    persist: boolean,
  ) {
    this.#mod = mod;
    this.#k = k;
    this.#previewBase = previewBase;
    this.#persist = persist;
    this.runtime = mod.runtime === 'wasm' ? 'wasm' : 'js';
    this.#wireHttp();
    this.#wireFsChange();
    if (persist) {
      this.#opfsFlusher = createOpfsFlusher(this.fs);
    }
  }

  static async boot(
    options?: {
      wasmUrl?: string;
      previewBase?: string;
      /** Prefer C++/WASM kernel (`true` default). `false` forces JS. `'auto'` tries WASM then JS quietly. */
      useWasm?: boolean | 'auto';
      /** Persist `/home` to Origin Private File System (browser). Default false. */
      persist?: boolean;
    } & LoadKernelOptions,
  ): Promise<NodeBrowser> {
    const useWasm = options?.useWasm === undefined ? true : options.useWasm;
    const persist = !!options?.persist;
    const mod = await loadKernel(options?.wasmUrl, { useWasm });
    const k = await asy(mod.create());
    await asy(mod.registerBuiltins(k));
    const previewBase =
      options?.previewBase ??
      (typeof location !== 'undefined'
        ? new URL(
            '__bn_preview',
            typeof document !== 'undefined' && document.baseURI ? document.baseURI : location.href,
          ).href.replace(/\/$/, '')
        : 'http://localhost/__bn_preview');
    const bn = new NodeBrowser(mod, k, previewBase, persist);
    if (persist && opfsAvailable()) {
      await hydrateFromOpfs(bn.fs);
    }
    return bn;
  }

  get persistEnabled(): boolean {
    return this.#persist;
  }

  get fs() {
    const mod = this.#mod;
    const k = this.#k;
    const self = this;
    const isDir = async (path: string): Promise<boolean> => {
      if (path === '/' || path === '') return true;
      if (mod.isDir) return asy(mod.isDir(k, path));
      if (!(await asy(mod.exists(k, path)))) return false;
      return (await asy(mod.readText(k, path))) === null;
    };
    const joinFs = (dir: string, name: string) => {
      if (dir === '/') return `/${name}`;
      return `${dir.replace(/\/+$/, '')}/${name}`;
    };
    const readBytes = async (path: string): Promise<Uint8Array> => {
      if (mod.readBytes) {
        const b = await asy(mod.readBytes(k, path));
        if (b == null) throw new Error(`ENOENT: ${path}`);
        return b;
      }
      const t = await asy(mod.readText(k, path));
      if (t == null) throw new Error(`ENOENT: ${path}`);
      return new TextEncoder().encode(t);
    };
    const rmTree = async (path: string): Promise<void> => {
      if (!(await asy(mod.exists(k, path)))) return;
      if (await isDir(path)) {
        for (const name of await asy(mod.readdir(k, path))) {
          await rmTree(joinFs(path, name));
        }
        if (mod.rmdir) {
          if (!(await asy(mod.rmdir(k, path))) && (await asy(mod.exists(k, path)))) {
            throw new Error(`EPERM: cannot remove ${path}`);
          }
          return;
        }
      }
      if (!(await asy(mod.unlink(k, path))) && (await asy(mod.exists(k, path)))) {
        throw new Error(`EPERM: cannot remove ${path}`);
      }
    };
    const copyTree = async (from: string, to: string): Promise<void> => {
      if (await isDir(from)) {
        await asy(mod.mkdir(k, to, true));
        for (const name of await asy(mod.readdir(k, from))) {
          await copyTree(joinFs(from, name), joinFs(to, name));
        }
        return;
      }
      const bytes = await readBytes(from);
      await asy(mod.writeBytes(k, to, bytes));
    };
    return {
      writeFile: async (path: string, data: string | Uint8Array) => {
        if (typeof data === 'string') await asy(mod.writeText(k, path, data));
        else await asy(mod.writeBytes(k, path, data));
        // JS kernel emits via setFsChangeListener; WASM needs host emit.
        if (!mod.setFsChangeListener) {
          self.#emit('fs-change', { type: 'change', path });
          self.#opfsFlusher?.mark(path, 'write');
        }
      },
      readFile: (async (path: string, encoding?: 'utf8' | 'buffer') => {
        if (encoding === 'buffer') return readBytes(path);
        const t = await asy(mod.readText(k, path));
        if (t == null) throw new Error(`ENOENT: ${path}`);
        return t;
      }) as {
        (path: string, encoding: 'utf8'): Promise<string>;
        (path: string, encoding: 'buffer'): Promise<Uint8Array>;
        (path: string): Promise<string>;
      },
      readdir: async (path: string) => {
        if (path !== '/' && !(await asy(mod.exists(k, path)))) throw new Error(`ENOENT: ${path}`);
        return asy(mod.readdir(k, path));
      },
      mkdir: async (path: string, opts?: { recursive?: boolean }) => {
        await asy(mod.mkdir(k, path, opts?.recursive ?? true));
        if (!mod.setFsChangeListener) {
          self.#emit('fs-change', { type: 'rename', path });
          self.#opfsFlusher?.mark(path, 'write');
        }
      },
      exists: async (path: string) => path === '/' || asy(mod.exists(k, path)),
      stat: async (path: string) => {
        if (path !== '/' && !(await asy(mod.exists(k, path)))) throw new Error(`ENOENT: ${path}`);
        const dir = await isDir(path);
        return {
          isFile: () => !dir,
          isDirectory: () => dir,
        };
      },
      rm: async (path: string, opts?: { recursive?: boolean }) => {
        if (!(await asy(mod.exists(k, path))) && path !== '/') throw new Error(`ENOENT: ${path}`);
        if (opts?.recursive) {
          await rmTree(path);
          if (!mod.setFsChangeListener) {
            self.#emit('fs-change', { type: 'rename', path });
            self.#opfsFlusher?.mark(path, 'delete');
          }
          return;
        }
        if (await isDir(path)) throw new Error(`EISDIR: ${path} (use { recursive: true })`);
        if (!(await asy(mod.unlink(k, path)))) throw new Error(`ENOENT: ${path}`);
        if (!mod.setFsChangeListener) {
          self.#emit('fs-change', { type: 'rename', path });
          self.#opfsFlusher?.mark(path, 'delete');
        }
      },
      rename: async (from: string, to: string) => {
        if (!(await asy(mod.exists(k, from)))) throw new Error(`ENOENT: ${from}`);
        if (mod.rename) {
          if (!(await asy(mod.rename(k, from, to)))) throw new Error(`EPERM: rename ${from} → ${to}`);
        } else {
          await copyTree(from, to);
          await rmTree(from);
        }
        if (!mod.setFsChangeListener) {
          self.#emit('fs-change', { type: 'rename', path: from });
          self.#emit('fs-change', { type: 'rename', path: to });
          self.#opfsFlusher?.mark(from, 'delete');
          self.#opfsFlusher?.mark(to, 'write');
        }
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
      if (typeof contents === 'string') await asy(this.#mod.writeText(this.#k, path, contents));
      else await asy(this.#mod.writeBytes(this.#k, path, contents));
      if (!this.#mod.setFsChangeListener) {
        this.#emit('fs-change', { type: 'change', path });
        this.#opfsFlusher?.mark(path, 'write');
      }
    }
  }

  /** Export `/home` as gzipped tar bytes. */
  async exportSnapshot(): Promise<Uint8Array> {
    await this.#opfsFlusher?.flush();
    return exportHomeTarGz(this.fs, (data) => zlibPureSync('gzip', data));
  }

  /** Import a gzipped tar into the VFS (and OPFS if persist). */
  async importSnapshot(bytes: Uint8Array): Promise<number> {
    const n = await importHomeTarGz(
      this.fs,
      bytes,
      (data) => zlibPureSync('gunzip', data),
    );
    if (this.#persist) await this.#opfsFlusher?.flush();
    return n;
  }

  /**
   * Unpack a .zip or .tar.gz into dest (default `/home/project`).
   * Strips a single top-level folder. Returns dest + file count.
   */
  async importZip(bytes: Uint8Array, dest = '/home/project'): Promise<{ dest: string; files: number }> {
    const extracted = stripSingleRoot(await extractArchive(bytes));
    const names = Object.keys(extracted);
    if (!names.length) throw new Error('archive is empty');
    await this.fs.mkdir(dest, { recursive: true });
    for (const rel of names) {
      const path = joinArchivePath(dest, rel);
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (dir && dir !== '/') await this.fs.mkdir(dir, { recursive: true });
      await this.fs.writeFile(path, extracted[rel]!);
    }
    if (this.#persist) await this.#opfsFlusher?.flush();
    return { dest, files: names.length };
  }

  /** Detect Vite/Next/static/node at cwd and start in-tab preview when possible. */
  previewProject(cwd: string): Promise<PreviewResult> {
    return previewProject(this, cwd);
  }

  /** Clear `/home` workspace (VFS + OPFS when persist). */
  async clearWorkspace(): Promise<void> {
    if (await this.fs.exists('/home')) {
      await this.fs.rm('/home', { recursive: true });
    }
    await this.fs.mkdir('/home/project', { recursive: true });
    if (this.#persist) {
      await this.#opfsFlusher?.clearHome();
      await this.#opfsFlusher?.flush();
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
      this.#ensureWasmHttpHandler(port | 0);
      const url = `${this.#previewBase}/${port}/`;
      this.#emit('server-ready', port, url);
    };
    notify.__bn_on_http_listen = (port: number) => {
      pendingPorts.add(port | 0);
      this.#ensureWasmHttpHandler(port | 0);
      const url = `${this.#previewBase}/${port}/`;
      this.#emit('server-ready', port, url);
    };
    const self = this;
    (globalThis as unknown as { __bn_on_tool?: (tool: string, cwd: string, mode: string) => void }).__bn_on_tool = (
      tool,
      toolCwd,
      mode,
    ) => {
      const run = async () => {
        if (tool === 'vite') {
          if (mode === 'build') await self.viteBuild(toolCwd);
          else await self.viteDev(toolCwd);
        } else if (tool === 'next') {
          if (mode === 'build') await self.nextBuild(toolCwd);
          else await self.nextDev(toolCwd);
        }
      };
      void run().catch((e) => self.#emit('error', e instanceof Error ? e : new Error(String(e))));
    };
    (globalThis as unknown as {
      __bn_on_npm?: (cwd: string, action: string, payload: string, pid: number) => void;
      __bn_on_npx?: (pkg: string, rest: string, cwd: string, pid: number) => void;
    }).__bn_on_npm = (cwd, action, payload, pid) => {
      const finish = () => {
        void this.#killWithChildren(pid);
      };
      void (async () => {
        if (action === 'run') {
          const child = await self.runScript(payload, cwd);
          this.#attachSpawnChild(pid, child.pid);
          await child.exit;
          return;
        }
        const specs = payload.trim() ? payload.trim().split(/\s+/) : [];
        await self.install(specs, cwd);
      })()
        .catch((e) => self.#emit('error', e instanceof Error ? e : new Error(String(e))))
        .finally(finish);
    };
    (globalThis as unknown as {
      __bn_on_npx?: (pkg: string, rest: string, cwd: string, pid: number) => void;
    }).__bn_on_npx = (pkg, rest, cwd, pid) => {
      const finish = () => {
        void this.#killWithChildren(pid);
      };
      const args = rest ? rest.split('\x1f').filter(Boolean) : [];
      void (async () => {
        const child = await self.npx(pkg, args, cwd);
        this.#attachSpawnChild(pid, child.pid);
        await child.exit;
      })()
        .catch((e) => self.#emit('error', e instanceof Error ? e : new Error(String(e))))
        .finally(finish);
    };

    const pid = await asy(this.#mod.spawn(this.#k, cmd, args, cwd, opts.env));
    if (pendingPorts.size) this.#portsByPid.set(pid, pendingPorts);

    let exitResolve!: (code: number) => void;
    const exit = new Promise<number>((r) => {
      exitResolve = r;
    });

    const output = new ReadableStream<string>({
      start: (controller) => {
        const poll = async () => {
          const out = await asy(this.#mod.readStdout(this.#k, pid));
          const err = await asy(this.#mod.readStderr(this.#k, pid));
          if (out) controller.enqueue(out);
          if (err) controller.enqueue(err);
          const code = await asy(this.#mod.wait(this.#k, pid));
          if (code === -1) {
            setTimeout(() => void poll(), 16);
            return;
          }
          const out2 = await asy(this.#mod.readStdout(this.#k, pid));
          const err2 = await asy(this.#mod.readStderr(this.#k, pid));
          if (out2) controller.enqueue(out2);
          if (err2) controller.enqueue(err2);
          controller.close();
          exitResolve(code);
        };
        queueMicrotask(() => void poll());
      },
    });

    return {
      pid,
      exit,
      output,
      kill: () => {
        void this.#killWithChildren(pid);
      },
      write: (data: string) => {
        void asy(this.#mod.writeStdin(this.#k, pid, data));
      },
    };
  }

  /** Install npm packages into cwd/node_modules (deps + cache). Empty list = package.json deps. */
  async install(packages: string[], cwd = '/'): Promise<void> {
    const foreign = await detectForeignLockfile(this.fs, cwd);
    if (foreign) {
      this.#emit('install-progress', {
        phase: 'resolve',
        name: 'lockfile',
        message: `${foreign} lockfile found — NodeBrowser installs with npm (corepack/yarn/pnpm not executed)`,
      });
    }
    let list = packages;
    if (!list.length) {
      list = await this.#manifestDeps(cwd);
    }
    for (const pkg of list) {
      await installPackage(this, pkg, cwd, {
        withDeps: true,
        onProgress: (p) => this.#emit('install-progress', p),
      });
    }
  }

  async #manifestDeps(cwd: string): Promise<string[]> {
    try {
      const raw = await this.fs.readFile(joinFsPath(cwd, 'package.json'), 'utf8');
      const pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
    } catch {
      return [];
    }
  }

  /** Run `package.json` scripts via kernel `sh -c` (not a JS guest shell). */
  async runScript(name: string, cwd = '/'): Promise<BrowserNodeProcess> {
    const raw = await this.fs.readFile(joinFsPath(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const cmd = pkg.scripts?.[name];
    if (!cmd) throw new Error(`npm run: missing script "${name}"`);
    return this.spawn('sh', ['-c', cmd], { cwd });
  }

  /**
   * Run a local `.bin` command, or install `pkg` then run its bin.
   * Execution is kernel `spawn` (C++/WASM or thin JS fallback).
   */
  async npx(pkg: string, args: string[] = [], cwd = '/'): Promise<BrowserNodeProcess> {
    const binName = pkg.includes('/') ? pkg.slice(pkg.lastIndexOf('/') + 1) : pkg.split('@')[0]!;
    const binPath = joinFsPath(cwd, 'node_modules', '.bin', binName);
    try {
      await this.fs.readFile(binPath, 'utf8');
      return this.spawn(binName, args, { cwd });
    } catch {
      /* install then retry */
    }
    await this.install([pkg], cwd);
    return this.spawn(binName, args, { cwd });
  }

  /** In-tab Vite subset: esbuild-wasm + kernel VFS (Phases 27–29). */
  viteBuild(cwd: string, opts?: { outDir?: string }) {
    return viteBuild(this, cwd, opts);
  }

  viteDev(cwd: string, opts?: { port?: number }) {
    return viteDev(this, cwd, opts);
  }

  /** In-tab Next App Router subset (Phase 30). */
  nextBuild(cwd: string) {
    return nextBuild(this, cwd);
  }

  nextDev(cwd: string, opts?: { port?: number }) {
    return nextDev(this, cwd, opts);
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

  httpLog() {
    return this.#http.accessLog();
  }

  rpc(req: AgentRpcRequest): Promise<AgentRpcResponse> {
    return handleAgentRpc(this, req);
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
    this.#http.setAccessListener((e) => this.#emit('http-log', e));
    const registrar: HttpRegistrar = (port, handler) => {
      this.#http.listen(port, handler as Parameters<HttpBridge['listen']>[1]);
    };
    this.#mod.setHttpRegistrar?.(registrar);
    if (typeof globalThis !== 'undefined') {
      const g = globalThis as unknown as {
        __bn_wasm_http_handlers?: Map<
          number,
          (req: {
            method: string;
            url: string;
            headers: Record<string, string>;
            body?: string;
          }) => { status: number; headers: Record<string, string>; body: string }
        >;
        __bn_wasm_http_dispatch?: (
          port: number,
          method: string,
          path: string,
          headers: string,
          body: string,
        ) => string | null;
      };
      if (!g.__bn_wasm_http_handlers) g.__bn_wasm_http_handlers = new Map();
      g.__bn_wasm_http_dispatch = (port, method, path, headersJson, body) => {
        const handler = g.__bn_wasm_http_handlers?.get(port);
        if (!handler) return null;
        let headers: Record<string, string> = {};
        try {
          headers = JSON.parse(headersJson || '{}') as Record<string, string>;
        } catch {
          headers = {};
        }
        try {
          const out = handler({ method, url: path, headers, body });
          return JSON.stringify({
            status: out.status || 200,
            headers: out.headers || {},
            body: out.body || '',
          });
        } catch (e) {
          return JSON.stringify({
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
            body: String(e),
          });
        }
      };
    }
  }

  #wireFsChange(): void {
    this.#mod.setFsChangeListener?.((ev) => {
      this.#emit('fs-change', ev);
      void (async () => {
        const exists = await asy(this.#mod.exists(this.#k, ev.path));
        const kind = ev.type === 'rename' && !exists ? 'delete' : 'write';
        this.#opfsFlusher?.mark(ev.path, kind);
      })();
    });
  }

  #ensureWasmHttpHandler(port: number): void {
    if (this.#http.has(port)) return;
    const dispatch = this.#mod.httpDispatch;
    // Prefer guest-registered host bridge table (filled by WASM EM_ASM / QuickJS retain)
    const g = globalThis as unknown as {
      __bn_wasm_http_handlers?: Map<
        number,
        (req: {
          method: string;
          url: string;
          headers: Record<string, string>;
          body?: string;
        }) => { status: number; headers: Record<string, string>; body: string }
      >;
    };
    if (!g.__bn_wasm_http_handlers) g.__bn_wasm_http_handlers = new Map();

    this.#http.listen(port, async (req, res) => {
      const handler = g.__bn_wasm_http_handlers?.get(port);
      if (handler) {
        try {
          const out = handler({
            method: req.method,
            url: req.url,
            headers: req.headers || {},
            body: req.body,
          });
          res.writeHead(out.status || 200, out.headers || {});
          res.end(out.body || '');
          return;
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(String(e));
          return;
        }
      }
      if (!dispatch) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('WASM HTTP dispatch unavailable');
        return;
      }
      const raw = await asy(
        dispatch(
          this.#k,
          port,
          req.method,
          req.url,
          JSON.stringify(req.headers || {}),
          req.body || '',
        ),
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
    void asy(this.#mod.destroy(this.#k));
    this.#booted = false;
  }

  /** Virtual listen ports currently registered on the host HttpBridge. */
  ports(): number[] {
    return this.#http.ports();
  }

  /** Kill pid and descendants (C++ process tree + host-spawned npm/npx children). */
  killTree(pid: number): boolean {
    void this.#killWithChildren(pid);
    return true;
  }

  #attachSpawnChild(parent: number, child: number): void {
    let set = this.#spawnChildren.get(parent);
    if (!set) {
      set = new Set();
      this.#spawnChildren.set(parent, set);
    }
    set.add(child);
  }

  async #killWithChildren(pid: number): Promise<boolean> {
    for (const c of [...(this.#spawnChildren.get(pid) ?? [])]) {
      await this.#killWithChildren(c);
    }
    this.#spawnChildren.delete(pid);
    for (const port of this.#portsByPid.get(pid) ?? []) this.#http.close(port);
    this.#portsByPid.delete(pid);
    try {
      return await asy(this.#mod.kill(this.#k, pid));
    } catch {
      return false;
    }
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

function joinFsPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

export { handleAgentRpc } from './json-rpc.js';
export type { AgentRpcRequest, AgentRpcResponse } from './json-rpc.js';
export type { FileSystemTree, FileNode, SpawnOptions, BrowserNodeProcess, BrowserNodeEventMap } from './types.js';
export type { BundleOptions } from '../bundler/esbuild.js';
export type { PreviewResult, ProjectKind } from '../bundler/preview.js';
export { detectProjectKind } from '../bundler/preview.js';
export { extractArchive, isZip, isGzip } from '../fs/zip.js';
export { HttpBridge } from '../net/http-bridge.js';
export { resetKernelCache, type UseWasmOption } from '../kernel/load.js';
export { assertAllowedFetchUrl } from '../net/egress.js';
/** @deprecated Use `NodeBrowser` — kept for older snippets */
export const BrowserNode = NodeBrowser;

/**
 * WebContainer-shaped names over the same C++/WASM kernel.
 * Not StackBlitz WebContainers — method names only (PLAN Phase 41).
 */
export class WebContainer {
  readonly #bn: NodeBrowser;

  private constructor(bn: NodeBrowser) {
    this.#bn = bn;
  }

  static async boot(
    options?: Parameters<typeof NodeBrowser.boot>[0],
  ): Promise<WebContainer> {
    const bn = await NodeBrowser.boot(options);
    return new WebContainer(bn);
  }

  get fs() {
    return this.#bn.fs;
  }

  get runtime() {
    return this.#bn.runtime;
  }

  mount(tree: FileSystemTree, mountPoint?: string) {
    return this.#bn.mount(tree, mountPoint);
  }

  spawn(cmd: string, args?: string[], opts?: SpawnOptions) {
    return this.#bn.spawn(cmd, args ?? [], opts);
  }

  on(...args: Parameters<NodeBrowser['on']>) {
    this.#bn.on(...args);
  }

  teardown() {
    this.#bn.teardown();
  }

  /** Underlying NodeBrowser (install, viteDev, importZip, …). */
  get instance() {
    return this.#bn;
  }
}
