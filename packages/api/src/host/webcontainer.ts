/**
 * Public WebContainer-shaped API over one NodeBrowser kernel.
 * Paths, events, and process streams follow the published `@webcontainer/api`
 * types. Guest Node is still the C++/QuickJS kernel (or the optional host engine).
 * This module does not contain StackBlitz runtime code.
 */
import { isZip } from '../fs/zip.js';
import { buildStoredZip, globToRegExp, walkFiles } from '../fs/toolkit.js';
import type { FileSystemTree } from './types.js';
import type { SpawnOptions } from './types.js';
import { NodeBrowser, type BrowserNodeProcess } from './node-browser.js';
import { auth, configureAPIKey } from './wc-auth.js';

export { auth, configureAPIKey };

export type Unsubscribe = () => void;

export type BootOptions = {
  /**
   * Cross-origin isolation the page was loaded with.
   * `none` boots in reduced mode: no SharedArrayBuffer stdio.
   */
  coep?: 'require-corp' | 'credentialless' | 'none';
  /** Folder name under `/home`. Default `project` (`/home/project`). */
  workdirName?: string;
  /** Inject a preview reporter for console and window errors. Default false. */
  forwardPreviewErrors?: boolean | 'exceptions-only';
};

export type DirEnt<T = string> = {
  name: T;
  isFile(): boolean;
  isDirectory(): boolean;
};

export type IFSWatcher = { close(): void };

export type WebContainerProcess = {
  exit: Promise<number>;
  input: WritableStream<string>;
  output: ReadableStream<string>;
  kill(): void;
  resize(dimensions: { cols: number; rows: number }): void;
  /** NodeBrowser extra. Same bytes as `input`. */
  write(data: string): void;
};

type WcSpawnOptions = {
  cwd?: string;
  env?: Record<string, string | number | boolean>;
  output?: boolean;
  terminal?: { cols: number; rows: number };
};

export type ExportOptions = {
  format?: 'json' | 'binary' | 'zip';
  includes?: string[];
  excludes?: string[];
};

export enum PreviewMessageType {
  UncaughtException = 'PREVIEW_UNCAUGHT_EXCEPTION',
  UnhandledRejection = 'PREVIEW_UNHANDLED_REJECTION',
  ConsoleError = 'PREVIEW_CONSOLE_ERROR',
}

export type PreviewMessage = {
  type: PreviewMessageType;
  message?: string;
  stack?: string;
  args?: unknown[];
  previewId: string;
  port: number;
  pathname: string;
  search: string;
  hash: string;
};

type FsEncoding = 'utf8' | 'utf-8' | 'buffer' | null;

let active: WebContainer | null = null;

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return '/' + parts.join('/') || '/';
}

function resolveAgainst(root: string, path: string): string {
  if (!path || path === '.') return normalize(root);
  if (path.startsWith('/')) return normalize(path);
  return normalize(`${root}/${path}`);
}

function joinPath(dir: string, name: string): string {
  if (dir === '/') return `/${name}`;
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

function workdirFromName(name: string | undefined): string {
  const raw = (name ?? 'project').trim() || 'project';
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) {
    throw new Error('workdirName must be a single folder name');
  }
  return `/home/${raw}`;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Map a preview `postMessage` payload into the public message shape. */
export function previewMessageFromData(data: unknown, fallbackPort = 0): PreviewMessage | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as {
    source?: string;
    type?: string;
    message?: string;
    stack?: string;
    args?: unknown[];
    port?: number;
    pathname?: string;
    search?: string;
    hash?: string;
  };
  if (row.source !== 'nodebrowser-preview') return null;
  const base = {
    previewId: 'preview',
    port: row.port ?? fallbackPort,
    pathname: row.pathname ?? '/',
    search: row.search ?? '',
    hash: row.hash ?? '',
  };
  if (row.type === 'unhandled-rejection') {
    return { ...base, type: PreviewMessageType.UnhandledRejection, message: String(row.message ?? ''), stack: row.stack };
  }
  if (row.type === 'console-error') {
    return {
      ...base,
      type: PreviewMessageType.ConsoleError,
      message: String(row.message ?? ''),
      stack: row.stack ?? '',
      args: row.args ?? [],
    };
  }
  if (row.type === 'uncaught-exception') {
    return { ...base, type: PreviewMessageType.UncaughtException, message: String(row.message ?? ''), stack: row.stack };
  }
  return null;
}

function settledProcess(code: number, text = ''): WebContainerProcess {
  return {
    exit: Promise.resolve(code),
    output: new ReadableStream<string>({
      start(controller) {
        if (text) controller.enqueue(text);
        controller.close();
      },
    }),
    input: new WritableStream<string>({ write() {} }),
    kill() {},
    resize() {},
    write() {},
  };
}

/**
 * One in-tab runtime. A second `boot()` throws until `teardown()`.
 * File paths are resolved like `path.resolve(workdir, path)`: relative paths
 * sit under {@link WebContainer.workdir}; absolute paths address the VFS.
 */
export class WebContainer {
  readonly #bn: NodeBrowser;
  readonly #workdir: string;
  readonly coep: 'require-corp' | 'credentialless' | 'none';
  #tornDown = false;
  #watchers = new Set<IFSWatcher>();
  #terminal = { cols: 80, rows: 24 };
  #onWindow: ((event: MessageEvent) => void) | null = null;
  #listeners = new Map<string, Set<Function>>();

  private constructor(bn: NodeBrowser, workdir: string, coep: BootOptions['coep']) {
    this.#bn = bn;
    this.#workdir = workdir;
    this.coep = coep ?? 'require-corp';
  }

  /**
   * Boot the WASM kernel. Only one WebContainer is live at a time.
   * `coep: 'none'` is the reduced mode: the kernel still boots, stdio polls,
   * and SharedArrayBuffer rings stay off.
   */
  static async boot(
    options?: BootOptions & Parameters<typeof NodeBrowser.boot>[0],
  ): Promise<WebContainer> {
    if (active && !active.#tornDown) {
      throw new Error('WebContainer is already booted. Call teardown() before boot() again.');
    }
    const { coep: coepOption, workdirName, forwardPreviewErrors, ...kernelOptions } = options ?? {};
    const workdir = workdirFromName(workdirName);
    const coep = coepOption ?? 'require-corp';
    const bn = await NodeBrowser.boot({
      ...kernelOptions,
      sharedArrayBuffer: coep === 'none' ? false : kernelOptions.sharedArrayBuffer,
    });
    try {
      await bn.fs.mkdir(workdir, { recursive: true });
    } catch (error) {
      bn.teardown();
      throw error;
    }
    if (forwardPreviewErrors) bn.setForwardPreviewErrors(forwardPreviewErrors);
    const wc = new WebContainer(bn, workdir, coep);
    wc.#listenForPreview();
    active = wc;
    return wc;
  }

  /** `/home/<workdirName>`. Default `/home/project`. */
  get workdir(): string {
    return this.#workdir;
  }

  /** Default `PATH` passed to {@link spawn} when the caller does not set one. */
  get path(): string {
    return `${this.#workdir}/node_modules/.bin`;
  }

  get runtime(): NodeBrowser['runtime'] {
    return this.#bn.runtime;
  }

  get worker(): boolean {
    return this.#bn.worker;
  }

  get sabStdio(): boolean {
    return this.#bn.sabStdio;
  }

  /** Underlying NodeBrowser (`install`, `viteDev`, `importZip`, …). */
  get instance(): NodeBrowser {
    return this.#bn;
  }

  get fs(): WebContainerFs {
    const wc = this;
    return {
      readFile: ((path: string, encoding?: FsEncoding | { encoding?: FsEncoding }) =>
        wc.#readFile(path, encoding)) as WebContainerFs['readFile'],
      writeFile: (path, data) => wc.#write(path, data),
      mkdir: (path, options) => wc.#mkdir(path, options),
      readdir: ((path: string, options?: unknown) => wc.#readDir(path, options)) as WebContainerFs['readdir'],
      rm: (path, options) => wc.#rm(path, options),
      rename: (from, to) => wc.#rename(from, to),
      watch: (filename, options, listener) => wc.#watch(filename, options, listener),
    } as WebContainerFs;
  }

  async mount(
    snapshotOrTree: FileSystemTree | Uint8Array | ArrayBuffer,
    options?: { mountPoint?: string } | string,
  ): Promise<void> {
    this.#live();
    const point = this.#mountPoint(options);
    try {
      if (snapshotOrTree instanceof Uint8Array || snapshotOrTree instanceof ArrayBuffer) {
        const bytes = snapshotOrTree instanceof Uint8Array ? snapshotOrTree : new Uint8Array(snapshotOrTree);
        if (!isZip(bytes)) {
          throw new Error('mount: expected a zip from export({ format: "zip" | "binary" })');
        }
        await this.#bn.importZip(bytes, point);
        return;
      }
      await this.#bn.mount(snapshotOrTree, point);
    } catch (error) {
      this.#fail(error);
    }
  }

  async spawn(command: string, options?: WcSpawnOptions): Promise<WebContainerProcess>;
  async spawn(command: string, args: string[], options?: WcSpawnOptions): Promise<WebContainerProcess>;
  async spawn(
    command: string,
    args?: string[] | WcSpawnOptions,
    options?: WcSpawnOptions,
  ): Promise<WebContainerProcess> {
    this.#live();
    let argv: string[] = [];
    let opts: WcSpawnOptions = {};
    if (Array.isArray(args)) {
      argv = args;
      opts = options ?? {};
    } else if (args) opts = args;

    const base = command.replace(/^.*\//, '');
    if (base === 'xdg-open') {
      this.#emit('xdg-open', argv[0] ?? '');
      return settledProcess(0);
    }
    if (base === 'code') {
      this.#emit('code', ...parseCodeArgs(argv));
      return settledProcess(0);
    }

    const cwd = opts.cwd ? this.#resolve(opts.cwd) : this.#workdir;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(opts.env ?? {})) env[key] = String(value);
    if (opts.terminal) {
      this.#terminal = { cols: opts.terminal.cols, rows: opts.terminal.rows };
      if (env.COLUMNS == null) env.COLUMNS = String(opts.terminal.cols);
      if (env.LINES == null) env.LINES = String(opts.terminal.rows);
    }
    if (env.PATH == null) env.PATH = this.path;
    const spawnOpts: SpawnOptions = { cwd, env };

    let proc: BrowserNodeProcess;
    try {
      proc = await this.#bn.spawn(command, argv, spawnOpts);
    } catch (error) {
      this.#fail(error);
    }

    const output =
      opts.output === false
        ? discardOutput(proc)
        : proc.output;
    const input = new WritableStream<string>({
      write(chunk) {
        proc.write(typeof chunk === 'string' ? chunk : String(chunk));
      },
    });
    return {
      exit: proc.exit,
      output,
      input,
      kill: () => proc.kill(),
      resize: (dimensions) => {
        this.#terminal = { cols: dimensions.cols, rows: dimensions.rows };
      },
      write: (data) => proc.write(data),
    };
  }

  on(event: 'server-ready', listener: (port: number, url: string) => void): Unsubscribe;
  on(event: 'port', listener: (port: number, type: 'open' | 'close', url: string) => void): Unsubscribe;
  on(event: 'error', listener: (error: { message: string }) => void): Unsubscribe;
  on(event: 'preview-message', listener: (message: PreviewMessage) => void): Unsubscribe;
  on(event: 'xdg-open', listener: (text: string) => void): Unsubscribe;
  on(event: 'code', listener: (type: 'open' | 'diff', event: { files: { filepath: string; line?: number; column?: number }[] }) => void): Unsubscribe;
  on(event: string, listener: (...args: never[]) => void): Unsubscribe {
    this.#live();
    if (event === 'error') {
      const wrapped = (error: Error) => {
        listener({ message: error instanceof Error ? error.message : String(error) } as never);
      };
      this.#bn.on('error', wrapped);
      return () => this.#bn.off('error', wrapped);
    }
    if (event === 'server-ready' || event === 'port') {
      const wrapped = (...args: never[]) => listener(...args);
      if (event === 'server-ready') this.#bn.on('server-ready', wrapped as (port: number, url: string) => void);
      else this.#bn.on('port', wrapped as (port: number, type: 'open' | 'close', url: string) => void);
      return () => {
        if (event === 'server-ready') this.#bn.off('server-ready', wrapped as (port: number, url: string) => void);
        else this.#bn.off('port', wrapped as (port: number, type: 'open' | 'close', url: string) => void);
      };
    }
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event)!.add(listener);
    return () => this.#listeners.get(event)?.delete(listener);
  }

  /** Serialize `path` as a file tree (`json`) or a zip (`zip` and `binary`). */
  async export(path: string, options?: ExportOptions & { format?: 'json' }): Promise<FileSystemTree>;
  async export(path: string, options: ExportOptions & { format: 'binary' | 'zip' }): Promise<Uint8Array>;
  async export(path: string, options?: ExportOptions): Promise<FileSystemTree | Uint8Array> {
    this.#live();
    const abs = this.#resolve(path);
    const format = options?.format ?? 'json';
    try {
      if (format === 'json') return await this.#exportTree(abs, options);
      return await this.#exportZip(abs, options);
    } catch (error) {
      this.#fail(error);
    }
  }

  /**
   * Script URL injected into HTML served by the host preview.
   * Existing previews keep the previous script until they reload.
   */
  async setPreviewScript(
    scriptSrc: string,
    options?: { type?: 'module' | 'importmap'; defer?: boolean; async?: boolean },
  ): Promise<void> {
    this.#live();
    this.#bn.setPreviewScript(scriptSrc, options);
  }

  /** Release the kernel, watchers, ports, and poll timers. A later `boot()` is allowed. */
  teardown(): void {
    if (this.#tornDown) return;
    this.#tornDown = true;
    if (active === this) active = null;
    for (const watcher of [...this.#watchers]) watcher.close();
    this.#watchers.clear();
    this.#listeners.clear();
    this.#stopPreview();
    this.#bn.teardown();
  }

  #resolve(path: string): string {
    return resolveAgainst(this.#workdir, path);
  }

  #mountPoint(options?: { mountPoint?: string } | string): string {
    if (typeof options === 'string') return this.#resolve(options);
    if (options?.mountPoint) return this.#resolve(options.mountPoint);
    return this.#workdir;
  }

  #live(): void {
    if (this.#tornDown) throw new Error('WebContainer has been torn down');
  }

  #fail(error: unknown): never {
    const err = asError(error);
    this.#bn.emitError(err);
    throw err;
  }

  #emit(event: string, ...args: unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      try {
        (listener as Function)(...args);
      } catch (error) {
        this.#bn.emitError(asError(error));
      }
    }
  }

  async #readFile(path: string, encoding?: FsEncoding | { encoding?: FsEncoding }): Promise<string | Uint8Array> {
    this.#live();
    const enc = typeof encoding === 'object' && encoding ? encoding.encoding : encoding;
    try {
      const abs = this.#resolve(path);
      if (enc == null || enc === 'buffer') return await this.#bn.fs.readFile(abs, 'buffer');
      if (enc === 'utf8' || enc === 'utf-8') return await this.#bn.fs.readFile(abs, 'utf8');
      throw new Error(`encoding not supported: ${String(enc)}`);
    } catch (error) {
      this.#fail(error);
    }
  }

  async #write(path: string, data: string | Uint8Array): Promise<void> {
    this.#live();
    try {
      await this.#bn.fs.writeFile(this.#resolve(path), data);
    } catch (error) {
      this.#fail(error);
    }
  }

  async #mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined> {
    this.#live();
    const abs = this.#resolve(path);
    try {
      if (!options?.recursive) {
        await this.#bn.fs.mkdir(abs, { recursive: false });
        return undefined;
      }
      const parts = abs.split('/').filter(Boolean);
      let built = '';
      let first: string | undefined;
      for (const part of parts) {
        built += `/${part}`;
        if (first === undefined && !(await this.#bn.fs.exists(built))) first = built;
      }
      await this.#bn.fs.mkdir(abs, { recursive: true });
      return first;
    } catch (error) {
      this.#fail(error);
    }
  }

  async #readDir(path: string, options?: unknown): Promise<string[] | Uint8Array[] | DirEnt[] | DirEnt<Uint8Array>[]> {
    this.#live();
    const abs = this.#resolve(path);
    const record =
      typeof options === 'string'
        ? { encoding: options, withFileTypes: false }
        : (options as { encoding?: string | null; withFileTypes?: boolean } | null | undefined) ?? {};
    try {
      const names = await this.#bn.fs.readdir(abs);
      const encoding = record.encoding;
      if (record.withFileTypes) {
        const entries = [];
        for (const name of names) {
          const stat = await this.#bn.fs.stat(joinPath(abs, name));
          const label = encoding === 'buffer' ? new TextEncoder().encode(name) : name;
          entries.push({
            name: label,
            isFile: () => stat.isFile(),
            isDirectory: () => stat.isDirectory(),
          });
        }
        return entries as DirEnt[];
      }
      if (encoding === 'buffer') return names.map((name) => new TextEncoder().encode(name));
      return names;
    } catch (error) {
      this.#fail(error);
    }
  }

  async #rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void> {
    this.#live();
    try {
      await this.#bn.fs.rm(this.#resolve(path), { recursive: !!options?.recursive });
    } catch (error) {
      const message = asError(error).message;
      if (options?.force && message.includes('ENOENT')) return;
      this.#fail(error);
    }
  }

  async #rename(from: string, to: string): Promise<void> {
    this.#live();
    try {
      await this.#bn.fs.rename(this.#resolve(from), this.#resolve(to));
    } catch (error) {
      this.#fail(error);
    }
  }

  #watch(
    filename: string,
    options?: { recursive?: boolean } | string | null | ((event: 'rename' | 'change', name: string) => void),
    listener?: (event: 'rename' | 'change', name: string) => void,
  ): IFSWatcher {
    this.#live();
    let recursive = false;
    let cb = listener;
    if (typeof options === 'function') cb = options;
    else if (options && typeof options === 'object') recursive = !!options.recursive;
    const notify = cb ?? (() => undefined);
    const abs = this.#resolve(filename);
    const stop = this.#bn.watch(abs, (event) => {
      if (!recursive) {
        const parent = event.path.slice(0, event.path.lastIndexOf('/')) || '/';
        if (event.path !== abs && parent !== abs) return;
      }
      const name = event.path === abs ? basename(abs) : basename(event.path);
      notify(event.type === 'change' ? 'change' : 'rename', name);
    });
    const watcher: IFSWatcher = {
      close: () => {
        stop();
        this.#watchers.delete(watcher);
      },
    };
    this.#watchers.add(watcher);
    return watcher;
  }

  async #exportTree(abs: string, options?: ExportOptions): Promise<FileSystemTree> {
    const excludes = (options?.excludes ?? []).map((pattern) => globToRegExp(pattern.replace(/^\.\//, '')));
    const includes = (options?.includes ?? []).map((pattern) => globToRegExp(pattern.replace(/^\.\//, '')));
    const stat = await this.#bn.fs.stat(abs);
    if (!stat.isDirectory()) {
      const node = await fileNode(this.#bn, abs);
      return { [basename(abs)]: node };
    }
    return directoryTree(this.#bn, abs, '', excludes, includes);
  }

  async #exportZip(abs: string, options?: ExportOptions): Promise<Uint8Array> {
    const stat = await this.#bn.fs.stat(abs);
    const excludes = (options?.excludes ?? []).map((pattern) => globToRegExp(pattern.replace(/^\.\//, '')));
    const includes = (options?.includes ?? []).map((pattern) => globToRegExp(pattern.replace(/^\.\//, '')));
    const payload: Record<string, Uint8Array> = {};
    if (!stat.isDirectory()) {
      payload[basename(abs)] = await this.#bn.fs.readFile(abs, 'buffer');
      return buildStoredZip(payload);
    }
    const root = abs.replace(/\/+$/, '') || '/';
    const files = await walkFiles(this.#bn.fs, root, { includeIgnored: true });
    const prefix = root === '/' ? '/' : `${root}/`;
    for (const file of files) {
      const rel = root === '/' ? file.replace(/^\//, '') : file.startsWith(prefix) ? file.slice(prefix.length) : file;
      if (!rel || skipped(rel, excludes, includes)) continue;
      payload[rel] = await this.#bn.fs.readFile(file, 'buffer');
    }
    return buildStoredZip(payload);
  }

  #listenForPreview(): void {
    const target = globalThis as { addEventListener?: (type: string, fn: (event: MessageEvent) => void) => void };
    if (typeof target.addEventListener !== 'function') return;
    this.#onWindow = (event: MessageEvent) => {
      const message = previewMessageFromData(event.data);
      if (message) this.#emit('preview-message', message);
    };
    target.addEventListener('message', this.#onWindow);
  }

  #stopPreview(): void {
    const target = globalThis as { removeEventListener?: (type: string, fn: (event: MessageEvent) => void) => void };
    if (this.#onWindow && typeof target.removeEventListener === 'function') {
      target.removeEventListener('message', this.#onWindow);
    }
    this.#onWindow = null;
  }
}

export type WebContainerFs = {
  readFile(path: string, encoding?: null): Promise<Uint8Array>;
  readFile(path: string, encoding: 'utf8' | 'utf-8'): Promise<string>;
  readFile(path: string, encoding?: FsEncoding | { encoding?: FsEncoding }): Promise<string | Uint8Array>;
  writeFile(path: string, data: string | Uint8Array, options?: string | { encoding?: string | null } | null): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  readdir(path: string, options?: { encoding?: string | null; withFileTypes?: false } | string | null): Promise<string[]>;
  readdir(path: string, options: { encoding: 'buffer'; withFileTypes?: false }): Promise<Uint8Array[]>;
  readdir(path: string, options: { encoding?: string | null; withFileTypes: true }): Promise<DirEnt[]>;
  rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  watch(
    filename: string,
    options?: { recursive?: boolean } | string | null,
    listener?: (event: 'rename' | 'change', filename: string) => void,
  ): IFSWatcher;
  watch(filename: string, listener?: (event: 'rename' | 'change', filename: string) => void): IFSWatcher;
};

function discardOutput(proc: BrowserNodeProcess): ReadableStream<string> {
  const reader = proc.output.getReader();
  void (async () => {
    try {
      while (!(await reader.read()).done) {
        /* caller asked for output: false */
      }
    } catch {
      /* teardown closed the kernel stream */
    }
  })();
  return new ReadableStream<string>({
    start(controller) {
      void proc.exit.then(
        () => controller.close(),
        () => controller.close(),
      );
    },
  });
}

function skipped(rel: string, excludes: RegExp[], includes: RegExp[]): boolean {
  if (!excludes.some((pattern) => pattern.test(rel))) return false;
  return !includes.some((pattern) => pattern.test(rel));
}

async function fileNode(bn: NodeBrowser, abs: string): Promise<FileSystemTree[string]> {
  try {
    const target = await bn.fs.readlink(abs);
    return { file: { symlink: target } };
  } catch {
    const bytes = await bn.fs.readFile(abs, 'buffer');
    if (bytes.includes(0)) return { file: { contents: bytes } };
    return { file: { contents: new TextDecoder().decode(bytes) } };
  }
}

async function directoryTree(
  bn: NodeBrowser,
  abs: string,
  relBase: string,
  excludes: RegExp[],
  includes: RegExp[],
): Promise<FileSystemTree> {
  const tree: FileSystemTree = {};
  const names = await bn.fs.readdir(abs);
  for (const name of names) {
    const childAbs = joinPath(abs, name);
    const rel = relBase ? `${relBase}/${name}` : name;
    const stat = await bn.fs.stat(childAbs);
    if (stat.isDirectory()) {
      const child = await directoryTree(bn, childAbs, rel, excludes, includes);
      if (skipped(rel, excludes, includes) && Object.keys(child).length === 0) continue;
      tree[name] = { directory: child };
      continue;
    }
    if (skipped(rel, excludes, includes)) continue;
    tree[name] = await fileNode(bn, childAbs);
  }
  return tree;
}

function parseCodeArgs(args: string[]): ['open' | 'diff', { files: { filepath: string; line?: number; column?: number }[] }] {
  const diff = args.includes('--diff');
  const files: { filepath: string; line?: number; column?: number }[] = [];
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    const located = /^(.*):(\d+):(\d+)$/.exec(arg) ?? /^(.*):(\d+)$/.exec(arg);
    if (located && located[1]) {
      files.push({
        filepath: located[1],
        line: Number(located[2]),
        column: located[3] ? Number(located[3]) : undefined,
      });
    } else files.push({ filepath: arg });
  }
  return [diff ? 'diff' : 'open', { files }];
}
