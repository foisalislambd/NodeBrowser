import type { FileSystemTree, SpawnOptions, BrowserNodeProcess, BrowserNodeEventMap } from './types.js';
import { loadKernel, type KernelModule, type KernelHandle } from './kernel.js';
import { flattenTree } from './fs-tree.js';
import { installPackage } from './npm-install.js';

type Listener<K extends keyof BrowserNodeEventMap> = (...args: BrowserNodeEventMap[K]) => void;

export class BrowserNode {
  #mod: KernelModule;
  #k: KernelHandle;
  #listeners = new Map<string, Set<Function>>();
  #previewBase: string;
  #booted = true;

  private constructor(mod: KernelModule, k: KernelHandle, previewBase: string) {
    this.#mod = mod;
    this.#k = k;
    this.#previewBase = previewBase;
    // Wire server-ready from kernel callbacks later; for now poll after spawn of http apps
  }

  static async boot(options?: { wasmUrl?: string; previewBase?: string }): Promise<BrowserNode> {
    const mod = await loadKernel(options?.wasmUrl);
    const k = mod.create();
    mod.registerBuiltins(k);
    const previewBase =
      options?.previewBase ??
      (typeof location !== 'undefined' ? `${location.origin}/__bn_preview` : 'http://localhost/__bn_preview');
    return new BrowserNode(mod, k, previewBase);
  }

  get fs() {
    const mod = this.#mod;
    const k = this.#k;
    return {
      writeFile: async (path: string, data: string | Uint8Array) => {
        if (typeof data === 'string') mod.writeText(k, path, data);
        else mod.writeBytes(k, path, data);
      },
      readFile: async (path: string, encoding?: 'utf8') => {
        const t = mod.readText(k, path);
        if (t == null) throw new Error(`ENOENT: ${path}`);
        if (encoding === 'utf8' || encoding === undefined) return t;
        return t;
      },
      readdir: async (path: string) => mod.readdir(k, path),
      mkdir: async (path: string, opts?: { recursive?: boolean }) => {
        mod.mkdir(k, path, opts?.recursive ?? true);
      },
      rm: async (path: string) => {
        mod.unlink(k, path);
      },
    };
  }

  async mount(tree: FileSystemTree, mountPoint = '/'): Promise<void> {
    const files = flattenTree(tree, mountPoint === '/' ? '' : mountPoint);
    for (const [path, contents] of Object.entries(files)) {
      this.#mod.writeText(this.#k, path, contents);
    }
  }

  async spawn(cmd: string, args: string[] = [], opts: SpawnOptions = {}): Promise<BrowserNodeProcess> {
    const cwd = opts.cwd ?? '/';
    const pid = this.#mod.spawn(this.#k, cmd, args, cwd);

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
            // Still running (future async). For sync MVP, shouldn't happen often.
            queueMicrotask(poll);
            return;
          }
          // Final drain
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

    // Detect listen() by scanning for registered servers — exposed via JS __bn.serverReady
    // Host maps port notifications through a global hook set by kernel glue.
    const notify = (globalThis as unknown as { __bn_on_server_ready?: (port: number) => void });
    notify.__bn_on_server_ready = (port: number) => {
      const url = `${this.#previewBase}/${port}/`;
      this.#emit('server-ready', port, url);
    };

    return {
      pid,
      exit,
      output,
      kill: () => this.#mod.kill(this.#k, pid),
      write: (data: string) => this.#mod.writeStdin(this.#k, pid, data),
    };
  }

  /** Install an npm package into /node_modules (registry fetch in browser). */
  async install(packages: string[], cwd = '/'): Promise<void> {
    for (const pkg of packages) {
      await installPackage(this, pkg, cwd);
    }
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

  teardown(): void {
    this.#mod.destroy(this.#k);
    this.#booted = false;
  }
}

export type { FileSystemTree, FileNode, SpawnOptions, BrowserNodeProcess } from './types.js';
