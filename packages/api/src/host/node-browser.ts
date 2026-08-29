import type { FileSystemTree, SpawnOptions, BrowserNodeProcess, BrowserNodeEventMap } from './types.js';
import { loadKernel, type KernelModule, type KernelHandle, type LoadKernelOptions } from '../kernel/load.js';
import { flattenTree } from '../fs/tree.js';
import { installMany, uninstallPackages, listInstalled, parseSpec } from '../npm/install.js';
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
import { resolveUnderRoot } from '../fs/paths.js';
import { compileTailwind, syncTailwindBrowser } from '../bundler/tailwind.js';
import { previewProject, resolveProjectRoot, type PreviewResult } from '../bundler/preview.js';
import { handleAgentRpc, type AgentRpcRequest, type AgentRpcResponse } from './json-rpc.js';
import { sabStdioAvailable, SabStdioRing } from '../io/sab-stdio.js';

type Listener<K extends keyof BrowserNodeEventMap> = (...args: BrowserNodeEventMap[K]) => void;

function asy<T>(v: T | Promise<T>): Promise<T> {
  return Promise.resolve(v);
}

export class NodeBrowser {
  #mod: KernelModule;
  #k: KernelHandle;
  #listeners = new Map<string, Set<Function>>();
  #previewBase: string;
  #http = new HttpBridge();
  #detachSw: (() => void) | null = null;
  #portsByPid = new Map<number, Set<number>>();
  /** Host-spawned children of C++ `npm`/`npx` (ABI spawn has no parent pid). */
  #spawnChildren = new Map<number, Set<number>>();
  #persist = false;
  #opfsFlusher: ReturnType<typeof createOpfsFlusher> | null = null;
  /** Which kernel is driving this instance. */
  readonly runtime: 'js' | 'wasm';
  /** True when C++/WASM runs on a Worker (browser); UI thread stays responsive. */
  readonly worker: boolean;
  /** True when stdout/stdin use SharedArrayBuffer rings (Worker + COOP/COEP). */
  readonly sabStdio: boolean;

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
    this.worker = !!mod.worker;
    this.sabStdio = !!mod.worker && sabStdioAvailable() && typeof mod.attachStdio === 'function';
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
      if (mod.lstatKind) {
        const kind = await asy(mod.lstatKind(k, path));
        if (kind === 'symlink') {
          if (!(await asy(mod.unlink(k, path))) && (await asy(mod.exists(k, path)))) {
            throw new Error(`EPERM: cannot remove ${path}`);
          }
          return;
        }
      }
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
        if (!(await asy(mod.mkdir(k, to, true)))) throw new Error(`EIO: mkdir ${to}`);
        for (const name of await asy(mod.readdir(k, from))) {
          await copyTree(joinFs(from, name), joinFs(to, name));
        }
        return;
      }
      const bytes = await readBytes(from);
      if (!(await asy(mod.writeBytes(k, to, bytes)))) throw new Error(`EIO: write ${to}`);
    };
    return {
      writeFile: async (path: string, data: string | Uint8Array) => {
        const ok =
          typeof data === 'string'
            ? await asy(mod.writeText(k, path, data))
            : await asy(mod.writeBytes(k, path, data));
        if (!ok) throw new Error(`EIO: write ${path}`);
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
        if (!(await asy(mod.mkdir(k, path, opts?.recursive ?? true)))) {
          throw new Error(`EIO: mkdir ${path}`);
        }
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
        if (mod.lstatKind) {
          const kind = await asy(mod.lstatKind(k, path));
          if (kind === 'directory') throw new Error(`EISDIR: ${path} (use { recursive: true })`);
        } else if (await isDir(path)) {
          throw new Error(`EISDIR: ${path} (use { recursive: true })`);
        }
        if (!(await asy(mod.unlink(k, path)))) {
          throw new Error((await asy(mod.exists(k, path))) ? `EPERM: ${path}` : `ENOENT: ${path}`);
        }
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
    const { files, dirs } = flattenTree(tree, mountPoint === '/' ? '' : mountPoint);
    for (const dir of dirs) {
      await this.fs.mkdir(dir, { recursive: true });
    }
    for (const [path, contents] of Object.entries(files)) {
      await this.fs.writeFile(path, contents);
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

  /** Prefer a nested folder that actually contains package.json / app / src/app. */
  resolveProjectRoot(cwd: string): Promise<string> {
    return resolveProjectRoot(this, cwd);
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
    const npm = matchHostNpm(cmd, args);
    if (npm) return this.#spawnHostNpm(npm, cwd);
    const tw = matchHostTailwind(cmd, args);
    if (tw) return this.#spawnHostTailwind(tw, cwd);

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
      const finish = (code: number) => {
        void this.#completePid(pid, code);
      };
      void (async () => {
        if (action === 'run') {
          const child = await self.runScript(payload, cwd);
          this.#attachSpawnChild(pid, child.pid);
          const code = await child.exit;
          finish(code);
          return;
        }
        if (action === 'ls') {
          const rows = await listInstalled(self, cwd);
          const lines =
            (rows.length ? rows.map((r) => `${r.name}@${r.version}`).join('\n') : '(empty)') + '\n';
          await self.#writeProcOut(pid, lines);
          finish(0);
          return;
        }
        if (action === 'uninstall') {
          const names = payload.trim() ? payload.trim().split(/\s+/) : [];
          const n = await uninstallPackages(self, names, cwd);
          await self.#writeProcOut(pid, `removed ${n} package${n === 1 ? '' : 's'}\n`);
          finish(0);
          return;
        }
        const saveDev = action === 'install-dev';
        const specs = payload.trim() ? payload.trim().split(/\s+/) : [];
        await self.install(specs, cwd, { logPid: pid, saveDev });
        finish(0);
      })().catch(async (e) => {
        const err = e instanceof Error ? e : new Error(String(e));
        self.#emit('error', err);
        await self.#writeProcErr(pid, String(err.message || err) + '\n');
        finish(1);
      });
    };
    (globalThis as unknown as {
      __bn_on_npx?: (pkg: string, rest: string, cwd: string, pid: number) => void;
    }).__bn_on_npx = (pkg, rest, cwd, pid) => {
      const args = rest ? rest.split('\x1f').filter(Boolean) : [];
      void (async () => {
        const child = await self.npx(pkg, args, cwd);
        this.#attachSpawnChild(pid, child.pid);
        const code = await child.exit;
        await this.#completePid(pid, code);
      })().catch(async (e) => {
        self.#emit('error', e instanceof Error ? e : new Error(String(e)));
        await this.#completePid(pid, 1);
      });
    };

    const pid = await asy(this.#mod.spawn(this.#k, cmd, args, cwd, opts.env));
    if (pendingPorts.size) this.#portsByPid.set(pid, pendingPorts);

    let exitResolve!: (code: number) => void;
    const exit = new Promise<number>((r) => {
      exitResolve = r;
    });

    let outRing: SabStdioRing | null = null;
    let errRing: SabStdioRing | null = null;
    let inRing: SabStdioRing | null = null;
    if (this.sabStdio && this.#mod.attachStdio) {
      const created = {
        out: SabStdioRing.create(),
        err: SabStdioRing.create(),
        inn: SabStdioRing.create(),
      };
      const attached = await asy(
        this.#mod.attachStdio(this.#k, pid, created.out.buffer, created.err.buffer, created.inn.buffer),
      );
      if (attached) {
        outRing = created.out;
        errRing = created.err;
        inRing = created.inn;
      }
    }

    const output = new ReadableStream<string>({
      start: (controller) => {
        const pollRpc = async () => {
          const out = await asy(this.#mod.readStdout(this.#k, pid));
          const err = await asy(this.#mod.readStderr(this.#k, pid));
          if (out) controller.enqueue(out);
          if (err) controller.enqueue(err);
          const code = await asy(this.#mod.wait(this.#k, pid));
          if (code === -1) {
            setTimeout(() => void pollRpc(), 16);
            return;
          }
          const out2 = await asy(this.#mod.readStdout(this.#k, pid));
          const err2 = await asy(this.#mod.readStderr(this.#k, pid));
          if (out2) controller.enqueue(out2);
          if (err2) controller.enqueue(err2);
          controller.close();
          exitResolve(code);
        };
        const pollSab = () => {
          const out = outRing!.readString();
          const err = errRing!.readString();
          if (out) controller.enqueue(out);
          if (err) controller.enqueue(err);
          if (!outRing!.closed || !errRing!.closed) {
            setTimeout(pollSab, 8);
            return;
          }
          const out2 = outRing!.readString();
          const err2 = errRing!.readString();
          if (out2) controller.enqueue(out2);
          if (err2) controller.enqueue(err2);
          controller.close();
          exitResolve(outRing!.exitCode);
        };
        queueMicrotask(() => (outRing ? pollSab() : void pollRpc()));
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
        if (inRing) {
          const bytes = new TextEncoder().encode(data);
          let off = 0;
          const tryWrite = () => {
            while (off < bytes.byteLength) {
              if (inRing!.closed || outRing?.closed) return;
              const n = inRing!.writeBytes(bytes.subarray(off));
              if (n <= 0) {
                setTimeout(tryWrite, 8);
                return;
              }
              off += n;
            }
          };
          tryWrite();
        } else void asy(this.#mod.writeStdin(this.#k, pid, data));
      },
    };
  }

  /** Install npm packages into cwd/node_modules (deps + cache). Empty list = package.json deps. */
  async install(
    packages: string[],
    cwd = '/',
    opts?: { logPid?: number; saveDev?: boolean; onLog?: (line: string) => void },
  ): Promise<void> {
    const foreign = await detectForeignLockfile(this.fs, cwd);
    if (foreign) {
      this.#emitInstall(
        {
          phase: 'resolve',
          name: 'lockfile',
          message: `${foreign} lockfile found — NodeBrowser installs with npm (corepack/yarn/pnpm not executed)`,
        },
        opts?.logPid,
        opts?.onLog,
      );
    }
    await installMany(this, packages, cwd, {
      saveDev: opts?.saveDev,
      onProgress: (p) => this.#emitInstall(p, opts?.logPid, opts?.onLog),
    });
    if (packages.some((s) => /tailwindcss/i.test(s)) || !packages.length) {
      await syncTailwindBrowser(this, cwd).catch(() => false);
    }
  }

  /**
   * Unpack an uncompressed tar into dest (used by npm tarball extract).
   * npm packages use a `package/` prefix which the installer then hoists.
   */
  async extractTar(data: Uint8Array, destDir: string): Promise<number> {
    if (!this.#mod.extractTar) throw new Error('extractTar: kernel ABI missing');
    return asy(this.#mod.extractTar(this.#k, data, destDir));
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
    const { name } = parseSpec(pkg);
    const binName = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
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

  /** Compile Tailwind using npm-installed packages + @tailwindcss/browser (no native CLI). */
  compileTailwind(cwd: string, args: string[] = []) {
    return compileTailwind(this, cwd, args);
  }

  /** In-tab Vite subset: esbuild-wasm + kernel VFS. `spawn('vite')` tries installed CLI first. */
  viteBuild(cwd: string, opts?: { outDir?: string }) {
    return viteBuild(this, cwd, opts);
  }

  viteDev(cwd: string, opts?: { port?: number }) {
    return viteDev(this, cwd, opts);
  }

  /** Run installed `typescript/lib/tsc.js` in QuickJS (`npm install typescript` into the VFS). */
  tsc(cwd: string, args: string[] = []) {
    return this.spawn('tsc', args, { cwd });
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
      let filePath: string;
      try {
        filePath = resolveUnderRoot(root, rel);
      } catch {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      try {
        const body = await this.fs.readFile(filePath, 'utf8');
        res.writeHead(200, {
          'Content-Type': contentTypeFor(filePath),
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        });
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
          const outMaybe = handler({
            method: req.method,
            url: req.url,
            headers: req.headers || {},
            body: req.body,
          });
          const out = await Promise.resolve(outMaybe);
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
    for (const p of this.#http.ports()) this.#http.close(p);
    void asy(this.#mod.destroy(this.#k));
  }

  /** Virtual listen ports currently registered on the host HttpBridge. */
  ports(): number[] {
    return this.#http.ports();
  }

  /** Kill pid and descendants (C++ process tree + host-spawned npm/npx children). */
  async killTree(pid: number): Promise<boolean> {
    return this.#killWithChildren(pid);
  }

  async #spawnHostNpm(
    req: { action: string; specs: string[]; saveDev: boolean; script?: string },
    cwd: string,
  ): Promise<BrowserNodeProcess> {
    let exitResolve!: (code: number) => void;
    const exit = new Promise<number>((r) => {
      exitResolve = r;
    });
    const self = this;
    const output = new ReadableStream<string>({
      start(controller) {
        const log = (text: string) => {
          if (text) controller.enqueue(text);
        };
        void (async () => {
          try {
            if (req.action === 'help') {
              log('npm: in-tab supports install, uninstall, ls, and run\n');
              exitResolve(1);
              return;
            }
            if (req.action === 'run') {
              if (!req.script) throw new Error('npm run: missing script name');
              log(`npm run ${req.script}\n`);
              const child = await self.runScript(req.script, cwd);
              const reader = child.output.getReader();
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) controller.enqueue(value);
              }
              exitResolve(await child.exit);
              return;
            }
            if (req.action === 'ls') {
              log('npm ls\n');
              const rows = await listInstalled(self, cwd);
              log((rows.length ? rows.map((r) => `${r.name}@${r.version}`).join('\n') : '(empty)') + '\n');
              exitResolve(0);
              return;
            }
            if (req.action === 'uninstall') {
              log(`npm uninstall ${req.specs.join(' ')}\n`);
              const n = await uninstallPackages(self, req.specs, cwd);
              log(`removed ${n} package${n === 1 ? '' : 's'}\n`);
              exitResolve(0);
              return;
            }
            log(req.specs.length ? `npm install ${req.specs.join(' ')}\n` : 'npm install\n');
            await self.install(req.specs, cwd, {
              saveDev: req.saveDev,
              onLog: (line) => log(line),
            });
            exitResolve(0);
          } catch (e) {
            log(String(e instanceof Error ? e.message : e) + '\n');
            exitResolve(1);
          } finally {
            controller.close();
          }
        })();
      },
    });
    return {
      pid: 0,
      exit,
      output,
      kill: () => undefined,
      write: () => undefined,
    };
  }

  async #spawnHostTailwind(
    args: string[],
    cwd: string,
  ): Promise<BrowserNodeProcess> {
    let exitResolve!: (code: number) => void;
    const exit = new Promise<number>((r) => {
      exitResolve = r;
    });
    const self = this;
    const output = new ReadableStream<string>({
      start(controller) {
        const log = (text: string) => {
          if (text) controller.enqueue(text);
        };
        void (async () => {
          try {
            log('≈ tailwindcss in-tab (npm packages + @tailwindcss/browser)\n\n');
            const r = await compileTailwind(self, cwd, args);
            log(`Done: ${r.input} → ${r.output}\n`);
            if (!r.engine) log('npm WARN @tailwindcss/browser missing — preview utilities may be empty\n');
            exitResolve(0);
          } catch (e) {
            log(String(e instanceof Error ? e.message : e) + '\n');
            exitResolve(1);
          } finally {
            controller.close();
          }
        })();
      },
    });
    return {
      pid: 0,
      exit,
      output,
      kill: () => undefined,
      write: () => undefined,
    };
  }

  async #completePid(pid: number, code: number): Promise<void> {
    try {
      if (this.#mod.complete) await asy(this.#mod.complete(this.#k, pid, code));
    } catch {
      /* older WASM without bn_complete */
    }
    const left = await asy(this.#mod.wait(this.#k, pid));
    if (left === -1) await this.#killWithChildren(pid);
  }

  async #writeProcOut(pid: number, text: string): Promise<void> {
    try {
      if (this.#mod.writeStdout) await asy(this.#mod.writeStdout(this.#k, pid, text));
    } catch {
      /* ignore */
    }
  }

  async #writeProcErr(pid: number, text: string): Promise<void> {
    try {
      if (this.#mod.writeStderr) await asy(this.#mod.writeStderr(this.#k, pid, text));
      else if (this.#mod.writeStdout) await asy(this.#mod.writeStdout(this.#k, pid, text));
    } catch {
      /* ignore */
    }
  }

  #emitInstall(
    p: {
      phase: 'resolve' | 'fetch' | 'extract' | 'bin' | 'lifecycle' | 'done' | 'summary';
      name: string;
      version?: string;
      message?: string;
    },
    logPid?: number,
    onLog?: (line: string) => void,
  ): void {
    const line = formatNpmLine(p);
    const streamed = !!(line && (logPid || onLog));
    if (line && logPid) void this.#writeProcOut(logPid, line);
    if (line && onLog) onLog(line);
    this.#emit('install-progress', { ...p, streamed: streamed || undefined });
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

function npmSpecName(spec: string): string {
  if (spec.startsWith('@')) {
    const rest = spec.slice(1);
    const at = rest.lastIndexOf('@');
    return at > 0 ? '@' + rest.slice(0, at) : spec;
  }
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(0, at) : spec;
}

function isTailwindBin(spec: string): boolean {
  const name = npmSpecName(spec);
  return name === 'tailwindcss' || name === 'tailwind' || name === '@tailwindcss/cli';
}

/** Drop `npx` meta flags (`-y`, `--yes`, `-p pkg`) so the CLI args reach compileTailwind. */
function afterNpx(argv: string[]): string[] {
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === '--') {
      i += 1;
      break;
    }
    if (a === '-y' || a === '--yes' || a === '--no-install' || a === '--prefer-offline') {
      i += 1;
      continue;
    }
    if ((a === '-p' || a === '--package') && argv[i + 1]) {
      i += 2;
      continue;
    }
    if (a.startsWith('-')) {
      i += 1;
      continue;
    }
    break;
  }
  return argv.slice(i);
}

function matchHostTailwind(cmd: string, args: string[]): string[] | null {
  if (cmd === 'tailwindcss' || cmd === 'tailwind' || cmd === '@tailwindcss/cli') return args;
  if (cmd === 'npx') {
    const rest = afterNpx(args);
    if (rest[0] && isTailwindBin(rest[0])) return rest.slice(1);
    return null;
  }
  if ((cmd === 'sh' || cmd === 'bash') && args[0] === '-c' && typeof args[1] === 'string') {
    const script = args[1].trim();
    if (/[|&;<>]/.test(script)) return null;
    const parts = script.split(/\s+/).filter(Boolean);
    if (parts[0] === 'npx') {
      const rest = afterNpx(parts.slice(1));
      if (rest[0] && isTailwindBin(rest[0])) return rest.slice(1);
      return null;
    }
    if (parts[0] && isTailwindBin(parts[0])) return parts.slice(1);
  }
  return null;
}

function matchHostNpm(
  cmd: string,
  args: string[],
): { action: string; specs: string[]; saveDev: boolean; script?: string } | null {
  let argv = args;
  if (cmd === 'npm') {
    /* use argv */
  } else if ((cmd === 'sh' || cmd === 'bash') && args[0] === '-c' && typeof args[1] === 'string') {
    const script = args[1].trim();
    if (/[|&;<>]/.test(script)) return null;
    const parts = script.split(/\s+/).filter(Boolean);
    if (parts[0] !== 'npm') return null;
    argv = parts.slice(1);
  } else {
    return null;
  }
  if (!argv.length) return { action: 'help', specs: [], saveDev: false };
  if (argv[0] === 'run') return { action: 'run', specs: [], saveDev: false, script: argv[1] };
  let saveDev = false;
  let action = '';
  const specs: string[] = [];
  let gotCmd = false;
  for (const a of argv) {
    if (a === '-D' || a === '--save-dev') {
      saveDev = true;
      continue;
    }
    if (a.startsWith('-')) continue;
    if (!gotCmd) {
      gotCmd = true;
      if (a === 'install' || a === 'i' || a === 'add' || a === 'ci') action = 'install';
      else if (a === 'uninstall' || a === 'un' || a === 'remove' || a === 'rm') action = 'uninstall';
      else if (a === 'ls' || a === 'list') action = 'ls';
      else return null;
      continue;
    }
    specs.push(a);
  }
  if (!action) return null;
  return { action, specs, saveDev };
}

function formatNpmLine(p: {
  phase: string;
  name: string;
  version?: string;
  message?: string;
}): string {
  if (p.phase === 'summary' && p.message) return p.message + '\n';
  if (p.phase === 'fetch' && p.message) return p.message + '\n';
  if (p.phase === 'done' && p.message && p.message.startsWith('+')) return p.message + '\n';
  if (p.phase === 'done' && p.message === 'already installed') return '';
  if (p.phase === 'lifecycle' && p.message) return `> ${p.name}\n> ${p.message}\n`;
  if (p.phase === 'resolve' && p.message && /^(skipped|optional|peer|lockfile)/.test(p.message)) {
    return `npm WARN ${p.message}\n`;
  }
  return '';
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
export { detectProjectKind, resolveProjectRoot } from '../bundler/preview.js';
export { extractArchive, isZip, isGzip } from '../fs/zip.js';
export { HttpBridge } from '../net/http-bridge.js';
export { resetKernelCache, type UseWasmOption } from '../kernel/load.js';
export { sabStdioAvailable, SabStdioRing } from '../io/sab-stdio.js';
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

  get worker() {
    return this.#bn.worker;
  }

  get sabStdio() {
    return this.#bn.sabStdio;
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
