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
  spawn(k: KernelHandle, cmd: string, argv: string[], cwd: string): number;
  wait(k: KernelHandle, pid: number): number;
  kill(k: KernelHandle, pid: number): boolean;
  readStdout(k: KernelHandle, pid: number): string;
  readStderr(k: KernelHandle, pid: number): string;
  writeStdin(k: KernelHandle, pid: number, data: string): number;
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
      mod.HEAPU8.set(data, buf);
      try {
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
      mod.HEAPU8.set(bytes, buf);
      try {
        return mod._bn_write_stdin(k, pid, buf, bytes.byteLength);
      } finally {
        mod._free(buf);
      }
    },
  };
}

/** Pure-JS fallback kernel used when WASM is not built yet (dev/demo). */
export function createJsFallbackKernel(): KernelModule {
  type Node =
    | { kind: 'file'; data: string }
    | { kind: 'dir'; children: Map<string, Node> };

  const root: Node = { kind: 'dir', children: new Map() };
  let nextPid = 1;
  const procs = new Map<number, { out: string; err: string; code: number }>();

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

  const resolve = (path: string, createDir = false): { parent: Map<string, Node> | null; name: string; node: Node | null } => {
    const parts = split(path);
    if (parts.length === 0) return { parent: null, name: '', node: root };
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (dir.kind !== 'dir') return { parent: null, name: '', node: null };
      let child = dir.children.get(parts[i]!);
      if (!child) {
        if (!createDir) return { parent: null, name: '', node: null };
        child = { kind: 'dir', children: new Map() };
        dir.children.set(parts[i]!, child);
      }
      if (child.kind !== 'dir') return { parent: null, name: '', node: null };
      dir = child;
    }
    const name = parts[parts.length - 1]!;
    return { parent: dir.children, name, node: dir.children.get(name) ?? null };
  };

  const writeText = (_k: number, path: string, text: string) => {
    const r = resolve(path, true);
    if (!r.parent) return false;
    r.parent.set(r.name, { kind: 'file', data: text });
    return true;
  };

  const readText = (_k: number, path: string) => {
    const r = resolve(path);
    if (!r.node || r.node.kind !== 'file') return null;
    return r.node.data;
  };

  // Minimal JS "node" using Function + same bootstrap subset for demo without WASM
  const runNode = (scriptPath: string, cwd: string): { out: string; err: string; code: number } => {
    let out = '';
    let err = '';
    const exists = (p: string) => resolve(p).node != null || p === '/' || p === '';
    const isFile = (p: string) => {
      const r = resolve(p);
      return !!r.node && r.node.kind === 'file';
    };
    const isDir = (p: string) => {
      if (p === '/' || p === '') return true;
      const r = resolve(p);
      return !!r.node && r.node.kind === 'dir';
    };
    const readFile = (p: string) => readText(0, p);
    const writeFile = (p: string, data: string) => writeText(0, p, data);
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
        if (child.kind !== 'dir') return false;
        dir = child;
      }
      return true;
    };

    const sandbox = {
      __bn: {
        readFile,
        writeFile,
        exists,
        isFile,
        isDir,
        readdir,
        mkdir,
        unlink: (p: string) => {
          const r = resolve(p);
          if (r.parent && r.node) {
            r.parent.delete(r.name);
            return true;
          }
          return false;
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
      },
    };

    // Load bootstrap from inline — same as C++ for parity (short version)
    const bootstrapUrl = ''; // embedded below
    void bootstrapUrl;
    const code = `
      var __bn = globalThis.__bn;
      ${jsBootstrapSource}
      __bn_runMain(${JSON.stringify(scriptPath)});
    `;

    try {
      const fn = new Function('globalThis', code);
      const g: Record<string, unknown> = { __bn: sandbox.__bn };
      // Provide eval and timers
      g.eval = eval;
      g.setTimeout = setTimeout.bind(globalThis);
      g.clearTimeout = clearTimeout.bind(globalThis);
      g.setInterval = setInterval.bind(globalThis);
      g.clearInterval = clearInterval.bind(globalThis);
      const codeResult = fn(g);
      return { out, err, code: typeof codeResult === 'number' ? codeResult : 0 };
    } catch (e) {
      err += String(e) + '\n';
      return { out, err, code: 1 };
    }
  };

  return {
    create: () => 1,
    destroy: () => undefined,
    registerBuiltins: () => undefined,
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
      return true;
    },
    writeText: (k, path, text) => writeText(k, path, text),
    writeBytes: (k, path, data) => writeText(k, path, new TextDecoder().decode(data)),
    readText,
    unlink: (_k, path) => {
      const r = resolve(path);
      if (!r.parent || !r.node) return false;
      r.parent.delete(r.name);
      return true;
    },
    readdir: (_k, path) => {
      const r = resolve(path);
      const node = path === '/' || path === '' ? root : r.node;
      if (!node || node.kind !== 'dir') return [];
      return [...node.children.keys()];
    },
    exists: (_k, path) => resolve(path).node != null || path === '/',
    spawn: (_k, cmd, argv, cwd) => {
      const pid = nextPid++;
      if (cmd === 'echo') {
        procs.set(pid, { out: argv.join(' ') + '\n', err: '', code: 0 });
        return pid;
      }
      if (cmd === 'cat') {
        const t = readText(0, argv[0] ?? '');
        procs.set(pid, t == null ? { out: '', err: 'cat: missing\n', code: 1 } : { out: t, err: '', code: 0 });
        return pid;
      }
      if (cmd === 'ls') {
        const p = argv[0] ?? cwd;
        const r = resolve(p);
        const node = p === '/' ? root : r.node;
        if (!node || node.kind !== 'dir') {
          procs.set(pid, { out: '', err: 'ls: error\n', code: 1 });
        } else {
          procs.set(pid, { out: [...node.children.keys()].map((x) => x + '\n').join(''), err: '', code: 0 });
        }
        return pid;
      }
      if (cmd === 'node') {
        const script = argv[0] ?? '';
        const path = script.startsWith('/') ? script : norm(cwd + '/' + script);
        procs.set(pid, runNode(path, cwd));
        return pid;
      }
      procs.set(pid, { out: '', err: `command not found: ${cmd}\n`, code: 127 });
      return pid;
    },
    wait: (_k, pid) => procs.get(pid)?.code ?? 127,
    kill: () => true,
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
}

// Shared bootstrap for JS fallback (mirrors C++ kBootstrap)
const jsBootstrapSource = `
var process = {
  cwd: function() { return __bn.cwd(); },
  argv: ['node'],
  env: {},
  exitCode: 0,
  exit: function(code) { process.exitCode = code|0; throw {__bn_exit: code|0}; },
};
globalThis.process = process;
var Buffer = { from: function(v){ return String(v); }, isBuffer: function(){ return false; } };
globalThis.Buffer = Buffer;
var moduleCache = Object.create(null);
function dirname(p){ var i=p.lastIndexOf('/'); if(i<=0) return '/'; return p.slice(0,i); }
function join(){ var parts=[]; for(var i=0;i<arguments.length;i++) parts.push(String(arguments[i])); return parts.join('/').replace(/\\/+/g,'/'); }
function makeModule(filename){ return { id:filename, filename:filename, exports:{}, loaded:false, require:createRequire(filename) }; }
function isFile(p){ return !!__bn.isFile(String(p)); }
function isDir(p){ return !!__bn.isDir(String(p)); }
function resolveFile(base){
  if(isFile(base)) return base;
  if(isFile(base+'.js')) return base+'.js';
  if(isFile(base+'.json')) return base+'.json';
  if(isDir(base)){
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
      }catch(e){}
    }
    if(isFile(join(base,'index.js'))) return join(base,'index.js');
  }
  return null;
}
function resolveFrom(fromDir, request){
  if(request[0]==='.'||request[0]==='/'){
    var hit=resolveFile(request[0]==='/'?request:join(fromDir,request));
    if(hit) return hit;
    throw new Error('Cannot find module '+request);
  }
  var dir=fromDir;
  for(;;){
    var hitNm=resolveFile(join(dir,'node_modules',request));
    if(hitNm) return hitNm;
    if(dir==='/'||dir==='') break;
    var parent=dirname(dir); if(parent===dir) break; dir=parent;
  }
  if(['fs','path','http','url','events','util','stream','os','module','buffer','assert','querystring'].indexOf(request)>=0) return 'node:'+request;
  throw new Error("Cannot find module '"+request+"'");
}
function loadCore(name){
  if(name==='fs') return {
    readFileSync:function(p){ var t=__bn.readFile(String(p)); if(t===null) throw new Error('ENOENT: '+p); return t; },
    writeFileSync:function(p,d){ if(!__bn.writeFile(String(p),String(d))) throw new Error('EIO'); },
    existsSync:function(p){ return !!__bn.exists(String(p)); },
    mkdirSync:function(p,opts){ __bn.mkdir(String(p), !!(opts&&opts.recursive)); },
    readdirSync:function(p){ var a=__bn.readdir(String(p)); if(a===null) throw new Error('ENOENT'); return a; },
    unlinkSync:function(p){ if(!__bn.unlink(String(p))) throw new Error('ENOENT'); },
    statSync:function(p){
      var path=String(p);
      if(!__bn.exists(path)) throw new Error('ENOENT: '+path);
      var file=isFile(path), dir=isDir(path);
      return { isFile:function(){return file;}, isDirectory:function(){return dir;} };
    }
  };
  if(name==='path'){ var pathApi={ join:join, dirname:dirname, basename:function(p){var i=String(p).lastIndexOf('/');return i<0?p:p.slice(i+1);}, resolve:function(){var args=[].slice.call(arguments); var r=args[0]&&args[0][0]==='/'?'':process.cwd(); for(var i=0;i<args.length;i++) r=join(r||'/',args[i]); return r.replace(/\\/+/g,'/')||'/'; }, extname:function(p){var i=String(p).lastIndexOf('.');return i<0?'':p.slice(i);}, sep:'/' }; pathApi.posix=pathApi; return pathApi; }
  if(name==='events'){ function EE(){this._e=Object.create(null);} EE.prototype.on=function(ev,fn){(this._e[ev]||(this._e[ev]=[])).push(fn);return this;}; EE.prototype.emit=function(ev){var args=[].slice.call(arguments,1); var list=this._e[ev]||[]; for(var i=0;i<list.length;i++) list[i].apply(this,args); return list.length>0;}; return { EventEmitter: EE }; }
  if(name==='http'){ var EE=loadCore('events').EventEmitter; function Server(){ EE.call(this); } Server.prototype=Object.create(EE.prototype); Server.prototype.listen=function(port,cb){ __bn.serverReady(port|0); if(typeof cb==='function') setTimeout(cb,0); return this; }; return { createServer:function(handler){ var s=new Server(); if(handler) s.on('request',handler); return s; } }; }
  if(name==='url') return { parse:function(u){ return { href:u, pathname:'/' }; } };
  if(name==='util') return { inherits:function(c,s){ c.prototype=Object.create(s.prototype); }, format:String, inspect:String, promisify:function(f){return f;} };
  if(name==='stream'){ var EE=loadCore('events').EventEmitter; function R(){ EE.call(this);} R.prototype=Object.create(EE.prototype); return { Readable:R, Writable:R, Duplex:R, Transform:R, PassThrough:R }; }
  if(name==='os') return { platform:function(){return 'browsernode';}, homedir:function(){return '/home';}, EOL:'\\n', arch:function(){return 'wasm32';} };
  if(name==='buffer') return { Buffer: Buffer };
  if(name==='assert'){ function assert(v,m){ if(!v) throw new Error(m||'assert'); } assert.strictEqual=function(a,b){ if(a!==b) throw new Error('neq'); }; return assert; }
  if(name==='querystring') return { parse:function(){return {};}, stringify:function(){return '';} };
  if(name==='module') return { builtinModules:['fs','path','http'] };
  throw new Error('Unknown core '+name);
}
function createRequire(fromFile){
  var fromDir=dirname(fromFile);
  return function require(request){
    var resolved=resolveFrom(fromDir, String(request));
    if(resolved.indexOf('node:')===0) return loadCore(resolved.slice(5));
    if(moduleCache[resolved]) return moduleCache[resolved].exports;
    var mod=makeModule(resolved); moduleCache[resolved]=mod;
    var code=__bn.readFile(resolved); if(code===null) throw new Error('ENOENT '+resolved);
    var fn=new Function('exports','require','module','__filename','__dirname','console','process','Buffer','globalThis', code);
    fn(mod.exports, mod.require, mod, resolved, dirname(resolved), globalThis.console, process, Buffer, globalThis);
    mod.loaded=true; return mod.exports;
  };
}
globalThis.require=createRequire(process.cwd()+'/.');
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
    var fn=new Function('exports','require','module','__filename','__dirname','console','process','Buffer','globalThis', code);
    fn(mod.exports, createRequire(resolved), mod, resolved, dirname(resolved), globalThis.console, process, Buffer, globalThis);
    return process.exitCode|0;
  } catch(e){
    if(e && typeof e==='object' && '__bn_exit' in e) return e.__bn_exit;
    console.error(e && e.stack ? e.stack : String(e));
    return 1;
  }
}
globalThis.__bn_runMain=__bn_runMain;
`;

let cached: KernelModule | null = null;

export async function loadKernel(wasmUrl?: string): Promise<KernelModule> {
  if (cached) return cached;

  const url = wasmUrl ?? new URL('../../wasm/browsernode_kernel.js', import.meta.url).href;

  try {
    // Dynamic import of emscripten modularize build
    const factory = await import(/* @vite-ignore */ url).catch(() => null);
    if (factory && typeof (factory as { default?: unknown }).default === 'function') {
      const mod = (await (factory as { default: (o?: object) => Promise<EmscriptenModule> }).default({
        locateFile: (path: string) => new URL(`../../wasm/${path}`, import.meta.url).href,
      })) as EmscriptenModule;
      cached = wrap(mod);
      return cached;
    }

    // Script-tag style global
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

  console.warn('[browsernode] WASM kernel not found — using JS fallback runtime');
  cached = createJsFallbackKernel();
  return cached;
}
