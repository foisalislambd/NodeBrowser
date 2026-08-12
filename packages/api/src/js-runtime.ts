import type { KernelModule } from './kernel.js';
import {
  BUFFER_POLYFILL,
  FS_PROMISES_HELPER,
  CRYPTO_POLYFILL,
  PERF_HOOKS_POLYFILL,
  STREAM_POLYFILL,
  UTIL_POLYFILL,
  ZLIB_POLYFILL,
} from './node-polyfills.js';
import { zlibPureSync } from './zlib-pure.js';

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

export type FsChangeListener = (ev: { type: string; path: string }) => void;

const MAX_PROCS = 32;

function hostZlibSync(op: string, data: Uint8Array): Uint8Array {
  return zlibPureSync(op, data);
}

/** Pure-JS Node runtime with keep-alive HTTP (demo / fallback). */
export function createJsFallbackKernel(opts?: {
  onHttpListen?: HttpRegistrar;
  onFsChange?: FsChangeListener;
}): KernelModule & {
  setHttpRegistrar: (fn: HttpRegistrar | null) => void;
  setFsChangeListener: (fn: FsChangeListener | null) => void;
} {
  type Node =
    | { kind: 'file'; bytes: Uint8Array }
    | { kind: 'dir'; children: Map<string, Node> }
    | { kind: 'symlink'; target: string };

  const root: Node = { kind: 'dir', children: new Map() };
  let nextPid = 1;
  const procs = new Map<
    number,
    { out: string; err: string; code: number; running: boolean }
  >();
  let httpRegistrar: HttpRegistrar | null = opts?.onHttpListen ?? null;
  let fsChangeListener: FsChangeListener | null = opts?.onFsChange ?? null;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const watchers = new Map<string, Set<(eventType: string, filename: string) => void>>();
  const watchFileTimers = new Map<string, ReturnType<typeof setInterval>>();

  const emitFs = (type: string, path: string) => {
    fsChangeListener?.({ type, path });
    const n = norm(path);
    for (const [wp, cbs] of watchers) {
      if (n === wp || n.startsWith(wp.endsWith('/') ? wp : wp + '/') || dirnameOf(n) === wp) {
        for (const cb of cbs) {
          try {
            cb(type, basenameOf(n));
          } catch {
            /* ignore */
          }
        }
      }
    }
  };

  const norm = (path: string) => {
    const parts: string[] = [];
    for (const p of path.split('/')) {
      if (!p || p === '.') continue;
      if (p === '..') parts.pop();
      else parts.push(p);
    }
    return '/' + parts.join('/');
  };
  const split = (path: string) => norm(path).split('/').filter(Boolean);
  const dirnameOf = (p: string) => {
    const i = p.lastIndexOf('/');
    if (i <= 0) return '/';
    return p.slice(0, i);
  };
  const basenameOf = (p: string) => {
    const i = p.lastIndexOf('/');
    return i < 0 ? p : p.slice(i + 1);
  };

  /** Resolve without following the final symlink (lstat path). */
  const resolveRaw = (path: string, createDir = false) => {
    const parts = split(path);
    if (parts.length === 0) return { parent: null as Map<string, Node> | null, name: '', node: root as Node | null };
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (dir.kind !== 'dir') return { parent: null, name: '', node: null };
      let child = dir.children.get(parts[i]!);
      if (!child) {
        if (!createDir) return { parent: null, name: '', node: null };
        child = { kind: 'dir', children: new Map() };
        dir.children.set(parts[i]!, child);
      }
      if (child.kind === 'symlink') {
        const followed = followSymlink(joinParts(parts.slice(0, i + 1)), child, 0);
        if (!followed || followed.kind !== 'dir') return { parent: null, name: '', node: null };
        dir = followed;
        continue;
      }
      if (child.kind !== 'dir') return { parent: null, name: '', node: null };
      dir = child;
    }
    const name = parts[parts.length - 1]!;
    return { parent: dir.children, name, node: dir.children.get(name) ?? null };
  };

  const joinParts = (parts: string[]) => '/' + parts.join('/');

  const followSymlink = (linkPath: string, link: Extract<Node, { kind: 'symlink' }>, depth: number): Node | null => {
    if (depth > 40) return null;
    const target = link.target.startsWith('/')
      ? norm(link.target)
      : norm(dirnameOf(linkPath) + '/' + link.target);
    const r = resolveRaw(target);
    if (!r.node) return null;
    if (r.node.kind === 'symlink') return followSymlink(target, r.node, depth + 1);
    return r.node;
  };

  /** Resolve following symlinks (for read/stat). */
  const resolve = (path: string, createDir = false) => {
    const r = resolveRaw(path, createDir);
    if (!r.node || r.node.kind !== 'symlink') return r;
    const followed = followSymlink(norm(path), r.node, 0);
    return { parent: r.parent, name: r.name, node: followed };
  };

  const writeText = (_k: number, path: string, text: string) => {
    const r = resolveRaw(path, true);
    if (!r.parent) return false;
    r.parent.set(r.name, { kind: 'file', bytes: enc.encode(text) });
    emitFs('change', norm(path));
    return true;
  };
  const writeBytes = (_k: number, path: string, data: Uint8Array) => {
    const r = resolveRaw(path, true);
    if (!r.parent) return false;
    r.parent.set(r.name, { kind: 'file', bytes: data.slice() });
    emitFs('change', norm(path));
    return true;
  };
  const readBytes = (_k: number, path: string): Uint8Array | null => {
    const r = resolve(path);
    if (!r.node || r.node.kind !== 'file') return null;
    return r.node.bytes.slice();
  };
  const readText = (_k: number, path: string) => {
    const b = readBytes(_k, path);
    if (b == null) return null;
    return dec.decode(b);
  };

  const countRunning = () => {
    let n = 0;
    for (const p of procs.values()) if (p.running) n++;
    return n;
  };

  const runNode = (scriptPath: string, cwd: string, _pid: number, env?: Record<string, string>) => {
    let out = '';
    let err = '';
    let keepAlive = false;

    const exists = (p: string) => {
      if (p === '/') return true;
      const r = resolveRaw(p);
      return r.node != null;
    };
    const isFile = (p: string) => {
      const r = resolve(p);
      return !!r.node && r.node.kind === 'file';
    };
    const isDir = (p: string) => {
      if (p === '/' || p === '') return true;
      const r = resolve(p);
      return !!r.node && r.node.kind === 'dir';
    };
    const isSymlink = (p: string) => {
      const r = resolveRaw(p);
      return !!r.node && r.node.kind === 'symlink';
    };
    const readdir = (p: string) => {
      const r = resolve(p);
      const node = p === '/' ? root : r.node;
      if (!node || node.kind !== 'dir') return null;
      return [...node.children.keys()];
    };
    const mkdir = (p: string) => {
      const parts = split(p);
      let dir = root;
      for (const part of parts) {
        if (dir.kind !== 'dir') return false;
        let child = dir.children.get(part);
        if (!child) {
          child = { kind: 'dir', children: new Map() };
          dir.children.set(part, child);
        }
        if (child.kind === 'symlink') {
          const followed = followSymlink(norm('/' + parts.slice(0, parts.indexOf(part) + 1).join('/')), child, 0);
          if (!followed || followed.kind !== 'dir') return false;
          dir = followed;
          continue;
        }
        if (child.kind !== 'dir') return false;
        dir = child;
      }
      emitFs('rename', norm(p));
      return true;
    };

    const sandbox = {
      __bn: {
        readFile: (p: string) => readText(0, p),
        readBytes: (p: string) => readBytes(0, p),
        writeFile: (p: string, data: string | Uint8Array) => {
          if (typeof data === 'string') return writeText(0, p, data);
          return writeBytes(0, p, data);
        },
        writeBytes: (p: string, data: Uint8Array) => writeBytes(0, p, data),
        exists,
        isFile,
        isDir,
        isSymlink,
        readdir,
        mkdir,
        getEnv: () => env || {},
        unlink: (p: string) => {
          const r = resolveRaw(p);
          if (r.parent && r.node) {
            r.parent.delete(r.name);
            emitFs('rename', norm(p));
            return true;
          }
          return false;
        },
        symlink: (target: string, path: string) => {
          const r = resolveRaw(path, true);
          if (!r.parent) return false;
          r.parent.set(r.name, { kind: 'symlink', target: String(target) });
          emitFs('rename', norm(path));
          return true;
        },
        readlink: (path: string) => {
          const r = resolveRaw(path);
          if (!r.node || r.node.kind !== 'symlink') return null;
          return r.node.target;
        },
        lstatKind: (path: string) => {
          if (path === '/' || path === '') return 'dir';
          const r = resolveRaw(path);
          if (!r.node) return null;
          return r.node.kind;
        },
        watch: (path: string, cb: (eventType: string, filename: string) => void) => {
          const n = norm(path);
          if (!watchers.has(n)) watchers.set(n, new Set());
          watchers.get(n)!.add(cb);
          return {
            close: () => {
              watchers.get(n)?.delete(cb);
            },
          };
        },
        watchFile: (path: string, cb: () => void) => {
          const n = norm(path);
          const id = setInterval(() => {
            try {
              cb();
            } catch {
              /* ignore */
            }
          }, 500);
          watchFileTimers.set(n + '#' + String(id), id);
          return;
        },
        unwatchFile: (path: string) => {
          const n = norm(path);
          for (const [k, id] of watchFileTimers) {
            if (k.startsWith(n + '#')) {
              clearInterval(id);
              watchFileTimers.delete(k);
            }
          }
        },
        zlibSync: (op: string, data: Uint8Array) => hostZlibSync(op, data),
        digestSync: (alg: string, data: Uint8Array) => {
          throw new Error('digestSync unavailable for ' + alg + ' (use sha1/sha256)');
        },
        spawnNode: (script: string, childCwd: string, childEnv?: Record<string, string>) => {
          if (countRunning() >= MAX_PROCS) {
            throw new Error('EMFILE: max concurrent processes (' + MAX_PROCS + ')');
          }
          const pid = nextPid++;
          const path = script.startsWith('/') ? script : norm(childCwd + '/' + script);
          const result = runNode(path, childCwd || cwd, pid, childEnv || env);
          procs.set(pid, {
            out: result.out,
            err: result.err,
            code: result.code,
            running: result.running,
          });
          return {
            pid,
            stdout: result.out,
            stderr: result.err,
            code: result.code,
            running: result.running,
          };
        },
        spawnCmd: (cmd: string, argv: string[], childCwd: string) => {
          if (countRunning() >= MAX_PROCS && cmd === 'node') {
            throw new Error('EMFILE: max concurrent processes (' + MAX_PROCS + ')');
          }
          const pid = nextPid++;
          // reuse kernel spawn logic via local helpers
          if (cmd === 'echo') {
            const o = argv.join(' ') + '\n';
            procs.set(pid, { out: o, err: '', code: 0, running: false });
            return { pid, stdout: o, stderr: '', code: 0, running: false };
          }
          if (cmd === 'cat') {
            const t = readText(0, argv[0] ?? '');
            const o = t ?? '';
            const e = t == null ? 'cat: missing\n' : '';
            const c = t == null ? 1 : 0;
            procs.set(pid, { out: o, err: e, code: c, running: false });
            return { pid, stdout: o, stderr: e, code: c, running: false };
          }
          if (cmd === 'ls') {
            const p = argv[0] ?? childCwd;
            const r = resolve(p);
            const node = p === '/' ? root : r.node;
            if (!node || node.kind !== 'dir') {
              procs.set(pid, { out: '', err: 'ls: error\n', code: 1, running: false });
              return { pid, stdout: '', stderr: 'ls: error\n', code: 1, running: false };
            }
            const o = [...node.children.keys()].map((x) => x + '\n').join('');
            procs.set(pid, { out: o, err: '', code: 0, running: false });
            return { pid, stdout: o, stderr: '', code: 0, running: false };
          }
          if (cmd === 'node') {
            const script = argv[0] ?? '';
            const path = script.startsWith('/') ? script : norm(childCwd + '/' + script);
            const result = runNode(path, childCwd, pid, env);
            procs.set(pid, {
              out: result.out,
              err: result.err,
              code: result.code,
              running: result.running,
            });
            return {
              pid,
              stdout: result.out,
              stderr: result.err,
              code: result.code,
              running: result.running,
            };
          }
          procs.set(pid, { out: '', err: `command not found: ${cmd}\n`, code: 127, running: false });
          return { pid, stdout: '', stderr: `command not found: ${cmd}\n`, code: 127, running: false };
        },
        killPid: (pid: number) => {
          const p = procs.get(pid);
          if (!p) return false;
          p.running = false;
          p.code = 137;
          // Best-effort: drop keep-alive HTTP for nested children by clearing registrar ports is host-owned;
          // mark process dead so MAX_PROCS can reclaim.
          return true;
        },
        print: (...a: unknown[]) => {
          out += a.map(String).join(' ') + '\n';
        },
        eprint: (...a: unknown[]) => {
          err += a.map(String).join(' ') + '\n';
        },
        cwd: () => cwd,
        serverReady: (port: number) => {
          (globalThis as unknown as { __bn_on_server_ready?: (p: number) => void }).__bn_on_server_ready?.(port);
        },
        registerHttp: (port: number, handler: Parameters<HttpRegistrar>[1]) => {
          keepAlive = true;
          httpRegistrar?.(port, handler);
          sandbox.__bn.serverReady(port);
        },
        fetchAllow: (url: string) => {
          try {
            const u = new URL(url, 'http://localhost');
            if (u.hostname === 'registry.npmjs.org') return true;
            if (typeof location !== 'undefined' && u.origin === location.origin) return true;
            if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
            return false;
          } catch {
            return false;
          }
        },
      },
    };

    const code = `
      var __bn = globalThis.__bn;
      ${BUFFER_POLYFILL}
      ${FS_PROMISES_HELPER}
      ${CRYPTO_POLYFILL}
      ${PERF_HOOKS_POLYFILL}
      ${STREAM_POLYFILL}
      ${UTIL_POLYFILL}
      ${ZLIB_POLYFILL}
      ${jsBootstrap}
      __bn_runMain(${JSON.stringify(scriptPath)});
    `;

    try {
      const fn = new Function('globalThis', code);
      const g: Record<string, unknown> = { __bn: sandbox.__bn };
      g.eval = eval;
      g.setTimeout = setTimeout.bind(globalThis);
      g.clearTimeout = clearTimeout.bind(globalThis);
      g.setInterval = setInterval.bind(globalThis);
      g.clearInterval = clearInterval.bind(globalThis);
      g.TextEncoder = TextEncoder;
      g.TextDecoder = TextDecoder;
      g.atob = atob.bind(globalThis);
      g.btoa = btoa.bind(globalThis);
      g.crypto = globalThis.crypto;
      g.performance = globalThis.performance;
      g.queueMicrotask = queueMicrotask.bind(globalThis);
      g.Promise = Promise;
      g.Uint8Array = Uint8Array;
      g.Date = Date;
      g.Math = Math;
      g.JSON = JSON;
      g.URL = URL;
      g.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String((input as Request).url);
        if (!sandbox.__bn.fetchAllow(url)) {
          return Promise.reject(new Error('fetch blocked by NodeBrowser allowlist: ' + url));
        }
        return fetch(input, init);
      };
      const codeResult = fn(g);
      const exitCode = typeof codeResult === 'number' ? codeResult : 0;
      return { out, err, code: keepAlive ? -1 : exitCode, running: keepAlive };
    } catch (e) {
      err += String(e) + '\n';
      return { out, err, code: 1, running: false };
    }
  };

  const mod: KernelModule & {
    setHttpRegistrar: (fn: HttpRegistrar | null) => void;
    setFsChangeListener: (fn: FsChangeListener | null) => void;
  } = {
    create: () => 1,
    destroy: () => undefined,
    registerBuiltins: () => undefined,
    setHttpRegistrar: (fn) => {
      httpRegistrar = fn;
    },
    setFsChangeListener: (fn) => {
      fsChangeListener = fn;
    },
    mkdir: (_k, path) => {
      const parts = split(path);
      let dir = root;
      for (const part of parts) {
        if (dir.kind !== 'dir') return false;
        let child = dir.children.get(part);
        if (!child) {
          child = { kind: 'dir', children: new Map() };
          dir.children.set(part, child);
        }
        if (child.kind !== 'dir') return false;
        dir = child;
      }
      emitFs('rename', norm(path));
      return true;
    },
    writeText: (k, path, text) => writeText(k, path, text),
    writeBytes: (k, path, data) => writeBytes(k, path, data),
    readText,
    readBytes,
    unlink: (_k, path) => {
      const r = resolveRaw(path);
      if (!r.parent || !r.node) return false;
      r.parent.delete(r.name);
      emitFs('rename', norm(path));
      return true;
    },
    rename: (_k, from, to) => {
      const srcPath = norm(from);
      const dstPath = norm(to);
      if (srcPath === dstPath) return true;
      const a = resolveRaw(srcPath);
      if (!a.parent || !a.node) return false;
      if (a.node.kind === 'dir' && (dstPath === srcPath || dstPath.startsWith(srcPath + '/'))) {
        return false;
      }
      const parts = split(dstPath);
      if (parts.length === 0) return false;
      let dir = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (dir.kind !== 'dir') return false;
        let child = dir.children.get(parts[i]!);
        if (!child) {
          child = { kind: 'dir', children: new Map() };
          dir.children.set(parts[i]!, child);
        }
        if (child.kind !== 'dir') return false;
        dir = child;
      }
      const destName = parts[parts.length - 1]!;
      const node = a.node;
      a.parent.delete(a.name);
      dir.children.set(destName, node);
      emitFs('rename', srcPath);
      emitFs('rename', dstPath);
      return true;
    },
    readdir: (_k, path) => {
      const r = resolve(path);
      const node = path === '/' || path === '' ? root : r.node;
      if (!node || node.kind !== 'dir') return [];
      return [...node.children.keys()];
    },
    exists: (_k, path) => path === '/' || resolveRaw(path).node != null,
    isDir: (_k, path) => {
      if (path === '/' || path === '') return true;
      const r = resolve(path);
      return !!r.node && r.node.kind === 'dir';
    },
    spawn: (_k, cmd, argv, cwd, env) => {
      if (cmd === 'node' && countRunning() >= MAX_PROCS) {
        const pid = nextPid++;
        procs.set(pid, {
          out: '',
          err: `EMFILE: max concurrent processes (${MAX_PROCS})\n`,
          code: 1,
          running: false,
        });
        return pid;
      }
      const pid = nextPid++;
      if (cmd === 'echo') {
        procs.set(pid, { out: argv.join(' ') + '\n', err: '', code: 0, running: false });
        return pid;
      }
      if (cmd === 'cat') {
        const t = readText(0, argv[0] ?? '');
        procs.set(
          pid,
          t == null
            ? { out: '', err: 'cat: missing\n', code: 1, running: false }
            : { out: t, err: '', code: 0, running: false },
        );
        return pid;
      }
      if (cmd === 'ls') {
        const p = argv[0] ?? cwd;
        const r = resolve(p);
        const node = p === '/' ? root : r.node;
        if (!node || node.kind !== 'dir') {
          procs.set(pid, { out: '', err: 'ls: error\n', code: 1, running: false });
        } else {
          procs.set(pid, {
            out: [...node.children.keys()].map((x) => x + '\n').join(''),
            err: '',
            code: 0,
            running: false,
          });
        }
        return pid;
      }
      if (cmd === 'node') {
        const script = argv[0] ?? '';
        const path = script.startsWith('/') ? script : norm(cwd + '/' + script);
        const result = runNode(path, cwd, pid, env);
        procs.set(pid, {
          out: result.out,
          err: result.err,
          code: result.code,
          running: result.running,
        });
        return pid;
      }
      procs.set(pid, { out: '', err: `command not found: ${cmd}\n`, code: 127, running: false });
      return pid;
    },
    wait: (_k, pid) => {
      const p = procs.get(pid);
      if (!p) return 127;
      if (p.running) return -1;
      return p.code;
    },
    kill: (_k, pid) => {
      const p = procs.get(pid);
      if (!p) return false;
      p.running = false;
      p.code = 137;
      return true;
    },
    readStdout: (_k, pid) => {
      const p = procs.get(pid);
      if (!p) return '';
      const s = p.out;
      p.out = '';
      return s;
    },
    readStderr: (_k, pid) => {
      const p = procs.get(pid);
      if (!p) return '';
      const s = p.err;
      p.err = '';
      return s;
    },
    writeStdin: () => 0,
  };

  return mod;
}

const jsBootstrap = `
var process = {
  cwd: function() { return __bn.cwd(); },
  argv: ['node'],
  env: Object.assign({}, typeof __bn.getEnv === 'function' ? __bn.getEnv() : {}),
  exitCode: 0,
  exit: function(code) { process.exitCode = code|0; throw {__bn_exit: code|0}; },
  versions: { node: '20.0.0-browsernode' },
};
globalThis.process = process;
var __bn_ticks = [];
function __bn_drain_ticks() {
  var guard = 0;
  while (__bn_ticks.length && guard++ < 10000) {
    var q = __bn_ticks.slice();
    __bn_ticks.length = 0;
    for (var i = 0; i < q.length; i++) q[i]();
  }
}
process.nextTick = function(fn) {
  var args = Array.prototype.slice.call(arguments, 1);
  __bn_ticks.push(function() { fn.apply(null, args); });
  if (typeof queueMicrotask === 'function') queueMicrotask(__bn_drain_ticks);
};
var moduleCache = Object.create(null);
function dirname(p){ var i=p.lastIndexOf('/'); if(i<=0) return '/'; return p.slice(0,i); }
function join(){ var parts=[]; for(var i=0;i<arguments.length;i++) parts.push(String(arguments[i])); return parts.join('/').replace(/\\/+/g,'/'); }
function makeModule(filename){ return { id:filename, filename:filename, exports:{}, loaded:false, require:createRequire(filename) }; }
function isFile(p){ return !!__bn.isFile(String(p)); }
function isDir(p){ return !!__bn.isDir(String(p)); }
function nearestPkgType(dir){
  var d=dir;
  for(;;){
    var pkg=join(d,'package.json');
    if(isFile(pkg)){
      try{ var meta=JSON.parse(__bn.readFile(pkg)); if(meta && meta.type) return String(meta.type); }catch(e){}
      return 'commonjs';
    }
    if(d==='/'||d==='') return 'commonjs';
    var parent=dirname(d); if(parent===d) return 'commonjs'; d=parent;
  }
}
function isEsmFile(filename){
  if(/\\.mjs$/i.test(filename)) return true;
  if(/\\.cjs$/i.test(filename)) return false;
  if(/\\.js$/i.test(filename)) return nearestPkgType(dirname(filename))==='module';
  return false;
}
function resolveExportsTarget(target, base){
  if(typeof target==='string'){
    var p=join(base, target);
    if(isFile(p)) return p;
    if(isFile(p+'.js')) return p+'.js';
    if(isFile(join(p,'index.js'))) return join(p,'index.js');
    return null;
  }
  if(target && typeof target==='object'){
    var order=['require','import','default','node','browser'];
    for(var i=0;i<order.length;i++){
      if(target[order[i]]!=null){
        var hit=resolveExportsTarget(target[order[i]], base);
        if(hit) return hit;
      }
    }
  }
  return null;
}
function resolvePkgExports(base, requestSubpath){
  var pkg=join(base,'package.json');
  if(!isFile(pkg)) return null;
  try{
    var meta=JSON.parse(__bn.readFile(pkg));
    if(!meta.exports) return null;
    var exp=meta.exports;
    var key=requestSubpath==null||requestSubpath===''?'.':('./'+String(requestSubpath).replace(/^\\.\\//,''));
    if(typeof exp==='string') return requestSubpath?null:resolveExportsTarget(exp, base);
    if(exp[key]!=null) return resolveExportsTarget(exp[key], base);
    if(key==='.' && exp['./']!=null) return resolveExportsTarget(exp['./'], base);
  }catch(e){}
  return null;
}
function resolveFile(base){
  if(isFile(base)) return base;
  if(isFile(base+'.js')) return base+'.js';
  if(isFile(base+'.mjs')) return base+'.mjs';
  if(isFile(base+'.json')) return base+'.json';
  if(isDir(base)){
    var viaExp=resolvePkgExports(base, null);
    if(viaExp) return viaExp;
    var pkg=join(base,'package.json');
    if(isFile(pkg)){
      try{
        var meta=JSON.parse(__bn.readFile(pkg));
        if(meta.main){
          var mainPath=join(base,String(meta.main));
          if(isFile(mainPath)) return mainPath;
          if(isFile(mainPath+'.js')) return mainPath+'.js';
          if(isFile(join(mainPath,'index.js'))) return join(mainPath,'index.js');
        }
        if(meta.module){
          var modPath=join(base,String(meta.module));
          if(isFile(modPath)) return modPath;
        }
      }catch(e){}
    }
    if(isFile(join(base,'index.js'))) return join(base,'index.js');
    if(isFile(join(base,'index.mjs'))) return join(base,'index.mjs');
  }
  return null;
}
function resolveFrom(fromDir, request){
  if(request.indexOf('node:')===0) return request;
  if(request[0]==='.'||request[0]==='/'){
    var hit=resolveFile(request[0]==='/'?request:join(fromDir,request));
    if(hit) return hit;
    throw new Error('Cannot find module '+request);
  }
  var dir=fromDir;
  for(;;){
    var nm=join(dir,'node_modules',request);
    var slash=request.indexOf('/');
    var scoped=request[0]==='@';
    if(scoped){
      var s2=request.indexOf('/', request.indexOf('/')+1);
      if(s2>0){
        var pkgName=request.slice(0,s2);
        var sub=request.slice(s2+1);
        var pkgBase=join(dir,'node_modules',pkgName);
        var via=resolvePkgExports(pkgBase, sub);
        if(via) return via;
      }
    } else if(slash>0){
      var pkgName2=request.slice(0,slash);
      var sub2=request.slice(slash+1);
      var pkgBase2=join(dir,'node_modules',pkgName2);
      var via2=resolvePkgExports(pkgBase2, sub2);
      if(via2) return via2;
    } else {
      var via3=resolvePkgExports(nm, null);
      if(via3) return via3;
    }
    var hitNm=resolveFile(nm);
    if(hitNm) return hitNm;
    if(dir==='/'||dir==='') break;
    var parent=dirname(dir); if(parent===dir) break; dir=parent;
  }
  var cores=['fs','path','http','https','net','url','events','util','stream','os','module','buffer','assert','querystring','crypto','perf_hooks','async_hooks','diagnostics_channel','zlib','string_decoder','timers','timers/promises','child_process'];
  if(cores.indexOf(request)>=0) return 'node:'+request;
  throw new Error("Cannot find module '"+request+"'");
}
function __bn_rewrite_esm(code, filename){
  var out=String(code);
  var fnExports=[];
  out=out.replace(/^\\s*import\\s+([\\w$]+)\\s*,\\s*\\{([^}]+)\\}\\s*from\\s*['"]([^'"]+)['"]\\s*;?/gm, function(_, def, named, src){
    return 'var __m_'+def+'=require("'+src+'"); const '+def+'=(__m_'+def+'.default!==undefined?__m_'+def+'.default:__m_'+def+'); const {'+named+'}=__m_'+def+';';
  });
  out=out.replace(/^\\s*import\\s*\\{([^}]+)\\}\\s*from\\s*['"]([^'"]+)['"]\\s*;?/gm, function(_, named, src){
    return 'const {'+named+'}=require("'+src+'");';
  });
  out=out.replace(/^\\s*import\\s+\\*\\s+as\\s+([\\w$]+)\\s+from\\s*['"]([^'"]+)['"]\\s*;?/gm, function(_, name, src){
    return 'const '+name+'=require("'+src+'");';
  });
  out=out.replace(/^\\s*import\\s+([\\w$]+)\\s+from\\s*['"]([^'"]+)['"]\\s*;?/gm, function(_, name, src){
    return 'var __m_'+name+'=require("'+src+'"); const '+name+'=(__m_'+name+'.default!==undefined?__m_'+name+'.default:__m_'+name+');';
  });
  out=out.replace(/^\\s*import\\s*['"]([^'"]+)['"]\\s*;?/gm, function(_, src){
    return 'require("'+src+'");';
  });
  out=out.replace(/^\\s*export\\s+default\\s+function(\\s+[\\w$]+)?/gm, 'exports.default=function$1');
  out=out.replace(/^\\s*export\\s+default\\s+/gm, 'exports.default=');
  out=out.replace(/^\\s*export\\s+(async\\s+)?function\\s+([\\w$]+)/gm, function(_, asyncKw, name){
    fnExports.push(name);
    return (asyncKw||'')+'function '+name;
  });
  out=out.replace(/^\\s*export\\s+(const|let|var)\\s+([\\w$]+)(\\s*=\\s*[^;\\n]+;?)/gm, function(_, kind, name, rest){
    return kind+' '+name+rest+'; exports['+JSON.stringify(name)+']='+name+';';
  });
  out=out.replace(/^\\s*export\\s*\\{([^}]+)\\}\\s*;?/gm, function(_, names){
    return names.split(',').map(function(part){
      part=part.trim(); if(!part) return '';
      var bits=part.split(/\\s+as\\s+/);
      var local=bits[0].trim();
      var exp=(bits[1]||bits[0]).trim();
      return 'exports['+JSON.stringify(exp)+']='+local+';';
    }).join('\\n');
  });
  out=out.replace(/\\bimport\\s*\\(/g, '__bn_dynamic_import(');
  out=out.replace(/import\\.meta\\.url/g, 'import_meta.url');
  if(fnExports.length){
    out+='\\n'+fnExports.map(function(n){ return 'exports['+JSON.stringify(n)+']='+n+';'; }).join('\\n');
  }
  out='var import_meta={url:'+JSON.stringify('file://'+String(filename||''))+'};\\n'+out;
  return out;
}
function loadCore(name){
  if(name==='buffer') return { Buffer: Buffer };
  if(name==='fs'){
    var fs = {
      constants:{
        F_OK:0, R_OK:4, W_OK:2, X_OK:1,
        O_RDONLY:0, O_WRONLY:1, O_RDWR:2, O_CREAT:64, O_TRUNC:512, O_APPEND:1024,
        S_IFMT:61440, S_IFREG:32768, S_IFDIR:16384, S_IFLNK:40960,
      },
      readFileSync:function(p,enc){
        if(enc==='buffer'||(enc&&enc.encoding==='buffer')) {
          var b=__bn.readBytes?__bn.readBytes(String(p)):null;
          if(b===null){ var t0=__bn.readFile(String(p)); if(t0===null) throw new Error('ENOENT: '+p); return Buffer.from(t0); }
          return Buffer.from(b);
        }
        var t=__bn.readFile(String(p)); if(t===null) throw new Error('ENOENT: '+p);
        if(enc&&typeof enc==='object'&&enc.encoding) return t; return t;
      },
      writeFileSync:function(p,d){
        if(Buffer.isBuffer&&Buffer.isBuffer(d)){
          if(__bn.writeBytes) { if(!__bn.writeBytes(String(p), d._data||d)) throw new Error('EIO'); return; }
          d=d.toString();
        }
        if(d instanceof Uint8Array){
          if(__bn.writeBytes) { if(!__bn.writeBytes(String(p), d)) throw new Error('EIO'); return; }
          d=Buffer.from(d).toString();
        }
        if(!__bn.writeFile(String(p),String(d))) throw new Error('EIO');
      },
      existsSync:function(p){ return !!__bn.exists(String(p)); },
      accessSync:function(p){ if(!__bn.exists(String(p))) { var e=new Error('ENOENT: '+p); e.code='ENOENT'; throw e; } },
      mkdirSync:function(p,opts){ __bn.mkdir(String(p), !!(opts&&opts.recursive)); },
      readdirSync:function(p){ var a=__bn.readdir(String(p)); if(a===null) throw new Error('ENOENT'); return a; },
      unlinkSync:function(p){ if(!__bn.unlink(String(p))) throw new Error('ENOENT'); },
      symlinkSync:function(target, path){ if(!__bn.symlink||!__bn.symlink(String(target), String(path))) throw new Error('EIO symlink'); },
      readlinkSync:function(path){ var t=__bn.readlink?__bn.readlink(String(path)):null; if(t==null) throw new Error('EINVAL: not a symlink'); return t; },
      lstatSync:function(p){
        var path=String(p);
        var kind=__bn.lstatKind?__bn.lstatKind(path):null;
        if(!kind && !__bn.exists(path)) throw new Error('ENOENT: '+path);
        if(!kind) kind=__bn.isDir(path)?'dir':(__bn.isFile(path)?'file':'file');
        return {
          isFile:function(){return kind==='file';},
          isDirectory:function(){return kind==='dir';},
          isSymbolicLink:function(){return kind==='symlink';},
        };
      },
      watch:function(path, opts, listener){
        if(typeof opts==='function'){ listener=opts; opts=undefined; }
        if(!__bn.watch) throw new Error('fs.watch unavailable');
        return __bn.watch(String(path), function(eventType, filename){
          if(listener) listener(eventType, filename);
        });
      },
      watchFile:function(path, opts, listener){
        if(typeof opts==='function'){ listener=opts; opts=undefined; }
        if(!__bn.watchFile) throw new Error('fs.watchFile unavailable');
        __bn.watchFile(String(path), function(){ if(listener) listener({ mtime: new Date() }, { mtime: new Date() }); });
      },
      unwatchFile:function(path){ if(__bn.unwatchFile) __bn.unwatchFile(String(path)); },
      realpathSync:function(p){
        var path=String(p);
        if(path[0]!=='/') path=join(process.cwd(), path);
        var parts=[], segs=path.split('/');
        for(var i=0;i<segs.length;i++){
          var s=segs[i];
          if(!s||s==='.') continue;
          if(s==='..') parts.pop();
          else parts.push(s);
        }
        path='/'+parts.join('/');
        if(!__bn.exists(path)) { var e=new Error('ENOENT: '+path); e.code='ENOENT'; throw e; }
        return path;
      },
      copyFileSync:function(src, dest){
        var b=__bn.readBytes?__bn.readBytes(String(src)):null;
        if(b!=null){
          if(__bn.writeBytes) { if(!__bn.writeBytes(String(dest), b)) throw new Error('EIO'); return; }
        }
        var t=__bn.readFile(String(src));
        if(t===null) { var e=new Error('ENOENT: '+src); e.code='ENOENT'; throw e; }
        if(!__bn.writeFile(String(dest), t)) throw new Error('EIO');
      },
      statSync:function(p){
        var path=String(p);
        if(!__bn.exists(path)) throw new Error('ENOENT: '+path);
        var file=isFile(path), dir=isDir(path);
        return { isFile:function(){return file;}, isDirectory:function(){return dir;}, isSymbolicLink:function(){return false;} };
      }
    };
    fs.promises = __bn_fs_promises(fs);
    return fs;
  }
  if(name==='path'){ var pathApi={ join:join, dirname:dirname, basename:function(p){var i=String(p).lastIndexOf('/');return i<0?p:p.slice(i+1);}, resolve:function(){var args=[].slice.call(arguments); var r=args[0]&&args[0][0]==='/'?'':process.cwd(); for(var i=0;i<args.length;i++) r=join(r||'/',args[i]); return r.replace(/\\/+/g,'/')||'/'; }, extname:function(p){var i=String(p).lastIndexOf('.');return i<0?'':p.slice(i);}, sep:'/' }; pathApi.posix=pathApi; return pathApi; }
  if(name==='events'){ function EE(){this._e=Object.create(null);} EE.prototype.on=function(ev,fn){(this._e[ev]||(this._e[ev]=[])).push(fn);return this;}; EE.prototype.once=function(ev,fn){ var self=this; function w(){ self.off?self.off(ev,w):null; fn.apply(this,arguments);} this.on(ev,w); return this; }; EE.prototype.off=function(ev,fn){ var list=this._e[ev]||[]; this._e[ev]=list.filter(function(f){return f!==fn;}); return this; }; EE.prototype.emit=function(ev){var args=[].slice.call(arguments,1); var list=this._e[ev]||[]; for(var i=0;i<list.length;i++) list[i].apply(this,args); return list.length>0;}; EE.prototype.removeListener=EE.prototype.off; return { EventEmitter: EE }; }
  if(name==='http' || name==='https'){
    return __bn_register_http(name);
  }
  if(name==='net'){
    var EE=loadCore('events').EventEmitter;
    function Server(connListener){ EE.call(this); this._port=0; if(connListener) this.on('connection', connListener); }
    Server.prototype=Object.create(EE.prototype);
    Server.prototype.listen=function(port, cb){
      var self=this;
      this._port=port|0;
      __bn.registerHttp(this._port, function(req, res){
        var sock = new Socket();
        sock.remoteAddress='127.0.0.1';
        self.emit('connection', sock);
        res.writeHead(200, {'Content-Type':'text/plain'});
        res.end('net.Server virtual connection accepted');
      });
      if(typeof cb==='function') setTimeout(cb,0);
      return self;
    };
    function Socket(){ EE.call(this); this.connecting=false; this.destroyed=false; this.remoteAddress=''; }
    Socket.prototype=Object.create(EE.prototype);
    Socket.prototype.write=function(c,cb){ if(cb) cb(); return true; };
    Socket.prototype.end=function(){ this.emit('end'); this.emit('close'); return this; };
    Socket.prototype.destroy=function(){ this.destroyed=true; this.emit('close'); return this; };
    Socket.prototype.connect=function(port, host, cb){
      this.remoteAddress=host||'127.0.0.1';
      this.emit('connect');
      if(typeof host==='function') host();
      else if(typeof cb==='function') cb();
      return this;
    };
    return {
      createServer: function(listener){ return new Server(listener); },
      Socket: Socket,
      connect: function(port, host, cb){ var s=new Socket(); return s.connect(port, host, cb); },
      createConnection: function(port, host, cb){ var s=new Socket(); return s.connect(port, host, cb); },
    };
  }
  if(name==='url') return { parse:function(u){ try{ var x=new URL(u,'http://localhost'); return { href:x.href, pathname:x.pathname, hostname:x.hostname, protocol:x.protocol }; }catch(e){ return { href:u, pathname:'/' }; } }, URL: typeof URL!=='undefined'?URL:undefined };
  if(name==='util') return __bn_load_util();
  if(name==='stream') return __bn_load_stream();
  if(name==='string_decoder') return __bn_load_string_decoder();
  if(name==='timers') return { setTimeout:setTimeout, clearTimeout:clearTimeout, setInterval:setInterval, clearInterval:clearInterval, setImmediate:function(fn){ return setTimeout(fn,0); }, clearImmediate:clearTimeout };
  if(name==='timers/promises') return __bn_load_timers_promises();
  if(name==='zlib') return __bn_load_zlib();
  if(name==='child_process'){
    var EE=loadCore('events').EventEmitter;
    function makeStream(initial){
      var s=new (loadCore('stream').Readable)();
      if(initial){ s.push(initial); s.push(null); }
      else { s.push(null); }
      return s;
    }
    function ChildProcess(){ EE.call(this); this.pid=0; this.exitCode=null; this.killed=false; this.stdout=makeStream(''); this.stderr=makeStream(''); }
    ChildProcess.prototype=Object.create(EE.prototype);
    ChildProcess.prototype.kill=function(){
      this.killed=true;
      if(this.pid && __bn.killPid) __bn.killPid(this.pid);
      this.exitCode=137;
      this.emit('exit', 137, 'SIGKILL');
      this.emit('close', 137);
      return true;
    };
    function spawn(cmd, args, opts){
      args=args||[]; opts=opts||{};
      var child=new ChildProcess();
      var cwd=opts.cwd||process.cwd();
      var env=opts.env||process.env;
      try{
        var result;
        if(cmd==='node' || cmd.endsWith('/node')){
          result=__bn.spawnNode(args[0]||'', cwd, env);
        } else {
          result=__bn.spawnCmd(String(cmd), args.map(String), cwd);
        }
        child.pid=result.pid;
        child.exitCode=result.running?-1:result.code;
        child.stdout=makeStream(result.stdout||'');
        child.stderr=makeStream(result.stderr||'');
        setTimeout(function(){
          if(!result.running){
            child.emit('exit', result.code, null);
            child.emit('close', result.code);
          }
        },0);
      }catch(e){
        child.stderr=makeStream(String(e)+'\\n');
        setTimeout(function(){ child.exitCode=1; child.emit('exit',1,null); child.emit('close',1); },0);
      }
      return child;
    }
    function execFile(file, args, opts, cb){
      if(typeof opts==='function'){ cb=opts; opts={}; }
      if(typeof args==='function'){ cb=args; args=[]; opts={}; }
      var child=spawn(file, args||[], opts||{});
      var stdout='', stderr='';
      child.stdout.on('data', function(c){ stdout+=String(c); });
      child.stderr.on('data', function(c){ stderr+=String(c); });
      child.on('close', function(code){ if(cb) cb(code?new Error('exit '+code):null, stdout, stderr); });
      return child;
    }
    return { spawn:spawn, execFile:execFile, fork:function(modulePath, args, opts){ return spawn('node', [modulePath].concat(args||[]), opts); } };
  }
  if(name==='os') return { platform:function(){return 'browsernode';}, homedir:function(){return '/home';}, EOL:'\\n', arch:function(){return 'wasm32';} };
  if(name==='assert'){ function assert(v,m){ if(!v) throw new Error(m||'assert'); } assert.strictEqual=function(a,b){ if(a!==b) throw new Error('neq'); }; return assert; }
  if(name==='querystring') return { parse:function(){return {};}, stringify:function(){return '';} };
  if(name==='crypto') return __bn_load_crypto();
  if(name==='perf_hooks') return __bn_load_perf_hooks();
  if(name==='async_hooks'){
    function AsyncLocalStorage(){ this._store=undefined; }
    AsyncLocalStorage.prototype.run=function(store, fn){
      var prev=this._store; this._store=store;
      try { return fn.apply(null, Array.prototype.slice.call(arguments, 2)); }
      finally { this._store=prev; }
    };
    AsyncLocalStorage.prototype.getStore=function(){ return this._store; }
    AsyncLocalStorage.prototype.enterWith=function(store){ this._store=store; };
    AsyncLocalStorage.prototype.disable=function(){ this._store=undefined; };
    return {
      AsyncLocalStorage: AsyncLocalStorage,
      createHook: function(){ return { enable:function(){}, disable:function(){} }; },
      executionAsyncId: function(){ return 1; },
      triggerAsyncId: function(){ return 0; },
    };
  }
  if(name==='diagnostics_channel'){
    var channels=Object.create(null);
    function Channel(name){ this.name=name; this._subs=[]; this.hasSubscribers=false; }
    Channel.prototype.subscribe=function(fn){ this._subs.push(fn); this.hasSubscribers=this._subs.length>0; };
    Channel.prototype.unsubscribe=function(fn){ this._subs=this._subs.filter(function(f){return f!==fn;}); this.hasSubscribers=this._subs.length>0; };
    Channel.prototype.publish=function(msg){ for(var i=0;i<this._subs.length;i++) try{ this._subs[i](msg);}catch(e){} };
    return {
      channel: function(name){ name=String(name); return channels[name]||(channels[name]=new Channel(name)); },
      hasSubscribers: function(name){ var ch=channels[String(name)]; return !!(ch&&ch.hasSubscribers); },
      tracingChannel: function(){ return { start:function(){}, asyncStart:function(){}, asyncEnd:function(){}, error:function(){}, end:function(){}, subscribe:function(){}, unsubscribe:function(){} }; },
    };
  }
  if(name==='module'){
    return {
      builtinModules:['fs','path','http','https','net','buffer','crypto','perf_hooks','async_hooks','diagnostics_channel','module','stream','util','zlib','string_decoder','timers','child_process'],
      createRequire: function(filename){
        var file=String(filename||process.cwd()+'/.');
        if(file.indexOf('file:///')===0) file=file.slice(7);
        else if(file.indexOf('file://')===0) {
          file=file.slice(7);
          if(file.charAt(0)!=='/') file='/'+file.replace(/^[^/]+/,'');
        }
        else if(file.indexOf('file:')===0) file=file.slice(5);
        return createRequire(file);
      },
      wrap: function(s){ return s; },
    };
  }
  throw new Error('Unknown core '+name);
}
function __bn_register_http(which){
  var EE=loadCore('events').EventEmitter;
  function Server(handler){ EE.call(this); this._handler=handler; this._upgradeListeners=[]; }
  Server.prototype=Object.create(EE.prototype);
  Server.prototype.on=function(ev,fn){
    if(ev==='upgrade') this._upgradeListeners.push(fn);
    return EE.prototype.on.call(this, ev, fn);
  };
  Server.prototype.listen=function(port,cb){
    var self=this;
    var h=this._handler || function(req,res){ self.emit('request',req,res); };
    __bn.registerHttp(port|0, function(req, res){
      var bodyParts=[];
      var status=200;
      var headers={};
      var ended=false;
      var nodeRes={
        statusCode:200,
        headersSent:false,
        setHeader:function(k,v){ headers[k]=v; },
        writeHead:function(code,h){ status=code|0; this.statusCode=status; this.headersSent=true; if(h) for(var k in h) headers[k]=h[k]; },
        write:function(chunk){ bodyParts.push(String(chunk==null?'':chunk)); return true; },
        end:function(chunk){
          if(ended) return;
          if(chunk!=null) bodyParts.push(String(chunk));
          ended=true;
          res.writeHead(status, headers);
          res.end(bodyParts.join(''));
        },
      };
      var nodeReq={
        method:req.method||'GET',
        url:req.url||'/',
        headers:req.headers||{},
        httpVersion:'1.1',
        upgrade:false,
        on:function(){ return nodeReq; },
      };
      try { h(nodeReq, nodeRes); }
      catch(e){ nodeRes.writeHead(500,{'Content-Type':'text/plain'}); nodeRes.end(String(e)); }
      if(self._upgradeListeners && self._upgradeListeners.length && String(req.headers&&req.headers.upgrade||'').toLowerCase()==='websocket'){
        for(var i=0;i<self._upgradeListeners.length;i++){
          try{ self._upgradeListeners[i](nodeReq, { write:function(){}, end:function(){} }, Buffer.from([])); }catch(e){}
        }
      }
    });
    if(typeof cb==='function') setTimeout(cb,0);
    return self;
  };
  return {
    createServer:function(handler){ return new Server(handler); },
    request: function(){ throw new Error(which+'.request: use virtual servers / fetch allowlist'); },
    get: function(){ throw new Error(which+'.get: use virtual servers / fetch allowlist'); },
  };
}
function createRequire(fromFile){
  var fromDir=dirname(fromFile);
  return function require(request){
    var resolved=resolveFrom(fromDir, String(request));
    if(resolved.indexOf('node:')===0) return loadCore(resolved.slice(5));
    if(moduleCache[resolved]) return moduleCache[resolved].exports;
    var mod=makeModule(resolved); moduleCache[resolved]=mod;
    var code=__bn.readFile(resolved); if(code===null) throw new Error('ENOENT '+resolved);
    if(/\\.json$/i.test(resolved)){ mod.exports=JSON.parse(code); mod.loaded=true; return mod.exports; }
    if(isEsmFile(resolved)) code=__bn_rewrite_esm(code, resolved);
    var fn=new Function('exports','require','module','__filename','__dirname','console','process','globalThis', 'var Buffer=globalThis.Buffer;\\n'+code+'\\n; if(typeof module.exports==="undefined") module.exports=exports;');
    fn(mod.exports, mod.require, mod, resolved, dirname(resolved), globalThis.console, process, globalThis);
    mod.loaded=true; return mod.exports;
  };
}
function __bn_dynamic_import(spec){
  return Promise.resolve().then(function(){
    return createRequire(process.cwd()+'/.')(String(spec));
  });
}
globalThis.require=createRequire(process.cwd()+'/.');
globalThis.__bn_dynamic_import=__bn_dynamic_import;
globalThis.console={ log:function(){ __bn.print.apply(null,arguments); }, error:function(){ __bn.eprint.apply(null,arguments); }, warn:function(){ __bn.eprint.apply(null,arguments); }, info:function(){ __bn.print.apply(null,arguments); } };
function __bn_runMain(filename){
  process.argv=['node', filename];
  try {
    var path = filename[0]==='/' ? filename : join(process.cwd(), filename);
    var resolved=resolveFile(path);
    if(!resolved) throw new Error('Cannot find '+filename);
    var code=__bn.readFile(resolved);
    if(code===null) throw new Error('Cannot find '+filename);
    var mod=makeModule(resolved); moduleCache[resolved]=mod;
    if(isEsmFile(resolved)) code=__bn_rewrite_esm(code, resolved);
    var fn=new Function('exports','require','module','__filename','__dirname','console','process','globalThis', 'var Buffer=globalThis.Buffer;\\n'+code);
    fn(mod.exports, createRequire(resolved), mod, resolved, dirname(resolved), globalThis.console, process, globalThis);
    __bn_drain_ticks();
    return process.exitCode|0;
  } catch(e){
    if(e && typeof e==='object' && '__bn_exit' in e) return e.__bn_exit;
    console.error(e && e.stack ? e.stack : String(e));
    return 1;
  }
}
globalThis.__bn_runMain=__bn_runMain;
`;
