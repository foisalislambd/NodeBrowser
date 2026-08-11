import type { KernelModule } from './kernel.js';
import { BUFFER_POLYFILL, FS_PROMISES_HELPER } from './node-polyfills.js';

export type HttpRegistrar = (
  port: number,
  handler: (
    req: { method: string; url: string; headers: Record<string, string> },
    res: {
      writeHead: (code: number, h?: Record<string, string>) => void;
      end: (chunk?: string) => void;
      setHeader?: (k: string, v: string) => void;
      write?: (c: string) => void;
    },
  ) => void,
) => void;

/** Pure-JS Node runtime with keep-alive HTTP (demo / fallback). */
export function createJsFallbackKernel(opts?: { onHttpListen?: HttpRegistrar }): KernelModule & {
  setHttpRegistrar: (fn: HttpRegistrar | null) => void;
} {
  type Node =
    | { kind: 'file'; data: string }
    | { kind: 'dir'; children: Map<string, Node> };

  const root: Node = { kind: 'dir', children: new Map() };
  let nextPid = 1;
  const procs = new Map<
    number,
    { out: string; err: string; code: number; running: boolean }
  >();
  let httpRegistrar: HttpRegistrar | null = opts?.onHttpListen ?? null;

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

  const resolve = (path: string, createDir = false) => {
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

  const runNode = (scriptPath: string, cwd: string, pid: number) => {
    let out = '';
    let err = '';
    let keepAlive = false;

    const exists = (p: string) => p === '/' || resolve(p).node != null;
    const isFile = (p: string) => {
      const r = resolve(p);
      return !!r.node && r.node.kind === 'file';
    };
    const isDir = (p: string) => {
      if (p === '/' || p === '') return true;
      const r = resolve(p);
      return !!r.node && r.node.kind === 'dir';
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
        if (child.kind !== 'dir') return false;
        dir = child;
      }
      return true;
    };

    const sandbox = {
      __bn: {
        readFile: (p: string) => readText(0, p),
        writeFile: (p: string, data: string) => writeText(0, p, data),
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
        registerHttp: (port: number, handler: Parameters<HttpRegistrar>[1]) => {
          keepAlive = true;
          httpRegistrar?.(port, handler);
          sandbox.__bn.serverReady(port);
        },
      },
    };

    const code = `
      var __bn = globalThis.__bn;
      ${BUFFER_POLYFILL}
      ${FS_PROMISES_HELPER}
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
      const codeResult = fn(g);
      const exitCode = typeof codeResult === 'number' ? codeResult : 0;
      return { out, err, code: keepAlive ? -1 : exitCode, running: keepAlive };
    } catch (e) {
      err += String(e) + '\n';
      return { out, err, code: 1, running: false };
    }
  };

  const mod: KernelModule & { setHttpRegistrar: (fn: HttpRegistrar | null) => void } = {
    create: () => 1,
    destroy: () => undefined,
    registerBuiltins: () => undefined,
    setHttpRegistrar: (fn) => {
      httpRegistrar = fn;
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
    exists: (_k, path) => path === '/' || resolve(path).node != null,
    spawn: (_k, cmd, argv, cwd) => {
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
        const result = runNode(path, cwd, pid);
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
  env: {},
  exitCode: 0,
  exit: function(code) { process.exitCode = code|0; throw {__bn_exit: code|0}; },
};
globalThis.process = process;
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
  if(name==='buffer') return { Buffer: Buffer };
  if(name==='fs'){
    var fs = {
      readFileSync:function(p,enc){ var t=__bn.readFile(String(p)); if(t===null) throw new Error('ENOENT: '+p); if(enc==='buffer') return Buffer.from(t); return t; },
      writeFileSync:function(p,d){ if(Buffer.isBuffer&&Buffer.isBuffer(d)) d=d.toString(); if(!__bn.writeFile(String(p),String(d))) throw new Error('EIO'); },
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
    fs.promises = __bn_fs_promises(fs);
    return fs;
  }
  if(name==='path'){ var pathApi={ join:join, dirname:dirname, basename:function(p){var i=String(p).lastIndexOf('/');return i<0?p:p.slice(i+1);}, resolve:function(){var args=[].slice.call(arguments); var r=args[0]&&args[0][0]==='/'?'':process.cwd(); for(var i=0;i<args.length;i++) r=join(r||'/',args[i]); return r.replace(/\\/+/g,'/')||'/'; }, extname:function(p){var i=String(p).lastIndexOf('.');return i<0?'':p.slice(i);}, sep:'/' }; pathApi.posix=pathApi; return pathApi; }
  if(name==='events'){ function EE(){this._e=Object.create(null);} EE.prototype.on=function(ev,fn){(this._e[ev]||(this._e[ev]=[])).push(fn);return this;}; EE.prototype.emit=function(ev){var args=[].slice.call(arguments,1); var list=this._e[ev]||[]; for(var i=0;i<list.length;i++) list[i].apply(this,args); return list.length>0;}; return { EventEmitter: EE }; }
  if(name==='http'){
    var EE=loadCore('events').EventEmitter;
    function Server(handler){ EE.call(this); this._handler=handler; }
    Server.prototype=Object.create(EE.prototype);
    Server.prototype.listen=function(port,cb){
      var self=this;
      var h=this._handler || function(req,res){ self.emit('request',req,res); };
      __bn.registerHttp(port|0, h);
      if(typeof cb==='function') setTimeout(cb,0);
      return self;
    };
    return { createServer:function(handler){ return new Server(handler); } };
  }
  if(name==='url') return { parse:function(u){ return { href:u, pathname:'/' }; } };
  if(name==='util') return { inherits:function(c,s){ c.prototype=Object.create(s.prototype); }, format:String, inspect:String, promisify:function(f){return f;} };
  if(name==='stream'){ var EE=loadCore('events').EventEmitter; function R(){ EE.call(this);} R.prototype=Object.create(EE.prototype); return { Readable:R, Writable:R, Duplex:R, Transform:R, PassThrough:R }; }
  if(name==='os') return { platform:function(){return 'browsernode';}, homedir:function(){return '/home';}, EOL:'\\n', arch:function(){return 'wasm32';} };
  if(name==='assert'){ function assert(v,m){ if(!v) throw new Error(m||'assert'); } assert.strictEqual=function(a,b){ if(a!==b) throw new Error('neq'); }; return assert; }
  if(name==='querystring') return { parse:function(){return {};}, stringify:function(){return '';} };
  if(name==='module') return { builtinModules:['fs','path','http','buffer'] };
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
    var fn=new Function('exports','require','module','__filename','__dirname','console','process','globalThis', 'var Buffer=globalThis.Buffer;\\n'+code);
    fn(mod.exports, mod.require, mod, resolved, dirname(resolved), globalThis.console, process, globalThis);
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
    var fn=new Function('exports','require','module','__filename','__dirname','console','process','globalThis', 'var Buffer=globalThis.Buffer;\\n'+code);
    fn(mod.exports, createRequire(resolved), mod, resolved, dirname(resolved), globalThis.console, process, globalThis);
    return process.exitCode|0;
  } catch(e){
    if(e && typeof e==='object' && '__bn_exit' in e) return e.__bn_exit;
    console.error(e && e.stack ? e.stack : String(e));
    return 1;
  }
}
globalThis.__bn_runMain=__bn_runMain;
`;
