#include "bn/node_runner.hpp"

#include <cstring>
#include <sstream>
#include <string>

#if defined(BN_HAS_QUICKJS)
#include "quickjs.h"
#endif

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

namespace bn {
namespace {

void write_out(Process& proc, std::string_view s) {
  proc.stdout_buf.write(reinterpret_cast<const uint8_t*>(s.data()), s.size());
}

void write_err(Process& proc, std::string_view s) {
  proc.stderr_buf.write(reinterpret_cast<const uint8_t*>(s.data()), s.size());
}

std::string join_path(std::string_view cwd, std::string_view rel) {
  if (!rel.empty() && rel.front() == '/') return Vfs::normalize(rel);
  if (cwd == "/") return Vfs::normalize(std::string("/") + std::string(rel));
  return Vfs::normalize(std::string(cwd) + "/" + std::string(rel));
}

int cmd_echo(Kernel&, Process& proc) {
  std::ostringstream oss;
  for (size_t i = 0; i < proc.argv.size(); ++i) {
    if (i) oss << ' ';
    oss << proc.argv[i];
  }
  oss << '\n';
  write_out(proc, oss.str());
  return 0;
}

int cmd_cat(Kernel& k, Process& proc) {
  if (proc.argv.empty()) {
    write_err(proc, "cat: missing file\n");
    return 1;
  }
  for (const auto& a : proc.argv) {
    auto path = join_path(proc.cwd, a);
    auto text = k.vfs().read_text(path);
    if (!text) {
      write_err(proc, "cat: " + a + ": No such file\n");
      return 1;
    }
    write_out(proc, *text);
  }
  return 0;
}

int cmd_ls(Kernel& k, Process& proc) {
  std::string path = proc.cwd;
  if (!proc.argv.empty()) path = join_path(proc.cwd, proc.argv[0]);
  auto entries = k.vfs().readdir(path);
  if (!entries) {
    write_err(proc, "ls: cannot access path\n");
    return 1;
  }
  for (const auto& e : *entries) {
    write_out(proc, e + "\n");
  }
  return 0;
}

int cmd_pwd(Kernel&, Process& proc) {
  write_out(proc, proc.cwd + "\n");
  return 0;
}

#if defined(BN_HAS_QUICKJS)

struct NodeCtx {
  Kernel* kernel{};
  Process* proc{};
  JSContext* ctx{};
};

static NodeCtx* get_opaque(JSContext* ctx) {
  return static_cast<NodeCtx*>(JS_GetContextOpaque(ctx));
}

static JSValue js_bn_read_file(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  auto* nc = get_opaque(ctx);
  if (!nc || argc < 1) return JS_EXCEPTION;
  const char* path = JS_ToCString(ctx, argv[0]);
  if (!path) return JS_EXCEPTION;
  auto text = nc->kernel->vfs().read_text(path);
  JS_FreeCString(ctx, path);
  if (!text) return JS_NULL;
  return JS_NewStringLen(ctx, text->data(), text->size());
}

static JSValue js_bn_write_file(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  auto* nc = get_opaque(ctx);
  if (!nc || argc < 2) return JS_EXCEPTION;
  const char* path = JS_ToCString(ctx, argv[0]);
  size_t len = 0;
  const char* data = JS_ToCStringLen(ctx, &len, argv[1]);
  if (!path || !data) {
    if (path) JS_FreeCString(ctx, path);
    if (data) JS_FreeCString(ctx, data);
    return JS_EXCEPTION;
  }
  bool ok = nc->kernel->vfs().write_text(path, std::string_view(data, len), true);
  JS_FreeCString(ctx, path);
  JS_FreeCString(ctx, data);
  return JS_NewBool(ctx, ok);
}

static JSValue js_bn_exists(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  auto* nc = get_opaque(ctx);
  if (!nc || argc < 1) return JS_EXCEPTION;
  const char* path = JS_ToCString(ctx, argv[0]);
  if (!path) return JS_EXCEPTION;
  bool ok = nc->kernel->vfs().exists(path);
  JS_FreeCString(ctx, path);
  return JS_NewBool(ctx, ok);
}

static JSValue js_bn_is_file(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  auto* nc = get_opaque(ctx);
  if (!nc || argc < 1) return JS_EXCEPTION;
  const char* path = JS_ToCString(ctx, argv[0]);
  if (!path) return JS_EXCEPTION;
  auto st = nc->kernel->vfs().stat(path, true);
  JS_FreeCString(ctx, path);
  return JS_NewBool(ctx, st && st->kind == NodeKind::File);
}

static JSValue js_bn_is_dir(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  auto* nc = get_opaque(ctx);
  if (!nc || argc < 1) return JS_EXCEPTION;
  const char* path = JS_ToCString(ctx, argv[0]);
  if (!path) return JS_EXCEPTION;
  auto st = nc->kernel->vfs().stat(path, true);
  JS_FreeCString(ctx, path);
  return JS_NewBool(ctx, st && st->kind == NodeKind::Directory);
}

static JSValue js_bn_readdir(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  auto* nc = get_opaque(ctx);
  if (!nc || argc < 1) return JS_EXCEPTION;
  const char* path = JS_ToCString(ctx, argv[0]);
  if (!path) return JS_EXCEPTION;
  auto entries = nc->kernel->vfs().readdir(path);
  JS_FreeCString(ctx, path);
  if (!entries) return JS_NULL;
  JSValue arr = JS_NewArray(ctx);
  for (uint32_t i = 0; i < entries->size(); ++i) {
    JS_SetPropertyUint32(ctx, arr, i, JS_NewString(ctx, (*entries)[i].c_str()));
  }
  return arr;
}

static JSValue js_bn_mkdir(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  auto* nc = get_opaque(ctx);
  if (!nc || argc < 1) return JS_EXCEPTION;
  const char* path = JS_ToCString(ctx, argv[0]);
  if (!path) return JS_EXCEPTION;
  bool recursive = argc > 1 ? JS_ToBool(ctx, argv[1]) : true;
  bool ok = nc->kernel->vfs().mkdir(path, recursive);
  JS_FreeCString(ctx, path);
  return JS_NewBool(ctx, ok);
}

static JSValue js_bn_unlink(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  auto* nc = get_opaque(ctx);
  if (!nc || argc < 1) return JS_EXCEPTION;
  const char* path = JS_ToCString(ctx, argv[0]);
  if (!path) return JS_EXCEPTION;
  bool ok = nc->kernel->vfs().unlink(path);
  JS_FreeCString(ctx, path);
  return JS_NewBool(ctx, ok);
}

static JSValue js_bn_print(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  auto* nc = get_opaque(ctx);
  if (!nc) return JS_EXCEPTION;
  for (int i = 0; i < argc; ++i) {
    if (i) write_out(*nc->proc, " ");
    const char* s = JS_ToCString(ctx, argv[i]);
    if (!s) return JS_EXCEPTION;
    write_out(*nc->proc, s);
    JS_FreeCString(ctx, s);
  }
  write_out(*nc->proc, "\n");
  return JS_UNDEFINED;
}

static JSValue js_bn_eprint(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  auto* nc = get_opaque(ctx);
  if (!nc) return JS_EXCEPTION;
  for (int i = 0; i < argc; ++i) {
    if (i) write_err(*nc->proc, " ");
    const char* s = JS_ToCString(ctx, argv[i]);
    if (!s) return JS_EXCEPTION;
    write_err(*nc->proc, s);
    JS_FreeCString(ctx, s);
  }
  write_err(*nc->proc, "\n");
  return JS_UNDEFINED;
}

static JSValue js_bn_cwd(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  auto* nc = get_opaque(ctx);
  if (!nc) return JS_EXCEPTION;
  return JS_NewString(ctx, nc->proc->cwd.c_str());
}

static JSValue js_bn_server_ready(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  auto* nc = get_opaque(ctx);
  if (!nc || argc < 1) return JS_EXCEPTION;
  int32_t port = 0;
  JS_ToInt32(ctx, &port, argv[0]);
  nc->kernel->notify_server_ready(nc->proc->pid, port);
  return JS_UNDEFINED;
}

static JSValue js_bn_register_http(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  auto* nc = get_opaque(ctx);
  if (!nc || argc < 1) return JS_EXCEPTION;
  int32_t port = 0;
  JS_ToInt32(ctx, &port, argv[0]);
  nc->proc->keep_alive = true;
  nc->kernel->notify_server_ready(nc->proc->pid, port);
#ifdef __EMSCRIPTEN__
  EM_ASM({
    if (typeof globalThis.__bn_on_http_listen === 'function') {
      globalThis.__bn_on_http_listen($0);
    }
  }, port);
#endif
  return JS_UNDEFINED;
}

// Embedded Node bootstrap (CommonJS-ish require + fs + http stub)
static const char kBootstrap[] = R"JS(
var __bn = globalThis.__bn;
var process = {
  cwd: function() { return __bn.cwd(); },
  argv: ['node'],
  env: {},
  exitCode: 0,
  exit: function(code) { process.exitCode = code|0; throw {__bn_exit: code|0}; },
  stdout: { write: function(s) { __bn.print(String(s)); } },
  stderr: { write: function(s) { __bn.eprint(String(s)); } },
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
  else if (typeof Promise !== 'undefined' && Promise.resolve) Promise.resolve().then(__bn_drain_ticks);
  else setTimeout(__bn_drain_ticks, 0);
};

// Usable Buffer (utf8 / base64 / hex)
var Buffer = (function() {
  function Buffer(arg, enc) {
    if (!(this instanceof Buffer)) return new Buffer(arg, enc);
    if (typeof arg === 'number') {
      this._data = [];
      for (var i = 0; i < arg; i++) this._data.push(0);
    } else if (typeof arg === 'string') {
      this._data = Buffer._encode(arg, enc || 'utf8');
    } else if (Array.isArray(arg)) {
      this._data = arg.slice();
    } else {
      this._data = [];
    }
    this.length = this._data.length;
  }
  Buffer._encode = function(s, enc) {
    enc = (enc || 'utf8').toLowerCase();
    var a = [];
    if (enc === 'hex') {
      var clean = String(s).replace(/[^0-9a-f]/gi, '');
      for (var j = 0; j < clean.length; j += 2) a.push(parseInt(clean.substr(j, 2), 16) || 0);
      return a;
    }
    if (enc === 'base64') {
      // minimal: treat as latin1 of decoded-ish string
      for (var k = 0; k < s.length; k++) a.push(s.charCodeAt(k) & 255);
      return a;
    }
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      // Surrogate pair → 4-byte UTF-8
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
          a.push(0xF0 | (cp >> 18));
          a.push(0x80 | ((cp >> 12) & 0x3F));
          a.push(0x80 | ((cp >> 6) & 0x3F));
          a.push(0x80 | (cp & 0x3F));
          i++;
          continue;
        }
      }
      if (c < 128) a.push(c);
      else if (c < 2048) { a.push(192 | (c >> 6)); a.push(128 | (c & 63)); }
      else { a.push(224 | (c >> 12)); a.push(128 | ((c >> 6) & 63)); a.push(128 | (c & 63)); }
    }
    return a;
  };
  Buffer._decode = function(arr, enc) {
    enc = (enc || 'utf8').toLowerCase();
    if (enc === 'hex') {
      var h = '';
      for (var j = 0; j < arr.length; j++) h += ((arr[j] & 255) + 256).toString(16).slice(1);
      return h;
    }
    if (enc === 'base64') {
      var bin = '';
      for (var k = 0; k < arr.length; k++) bin += String.fromCharCode(arr[k] & 255);
      return bin;
    }
    var out = '', i = 0;
    while (i < arr.length) {
      var c = arr[i++];
      if (c < 128) out += String.fromCharCode(c);
      else if (c >= 192 && c < 224 && i < arr.length) {
        out += String.fromCharCode(((c & 31) << 6) | (arr[i++] & 63));
      } else if (i + 1 < arr.length) {
        out += String.fromCharCode(((c & 15) << 12) | ((arr[i++] & 63) << 6) | (arr[i++] & 63));
      }
    }
    return out;
  };
  Buffer.alloc = function(n, fill) {
    var b = new Buffer(n);
    if (typeof fill === 'number') for (var i = 0; i < b.length; i++) b._data[i] = fill & 255;
    return b;
  };
  Buffer.from = function(arg, enc) { return new Buffer(arg, enc); };
  Buffer.isBuffer = function(x) { return x instanceof Buffer; };
  Buffer.concat = function(list, len) {
    if (!len) { len = 0; for (var i = 0; i < list.length; i++) len += list[i].length; }
    var out = [];
    for (var j = 0; j < list.length; j++) {
      var d = list[j]._data || list[j];
      for (var k = 0; k < d.length; k++) out.push(d[k]);
    }
    return Buffer.from(out.slice(0, len));
  };
  Buffer.prototype.toString = function(enc) { return Buffer._decode(this._data, enc || 'utf8'); };
  Buffer.prototype.slice = function(s, e) { return Buffer.from(this._data.slice(s || 0, e)); };
  return Buffer;
})();
globalThis.Buffer = Buffer;

function __bn_fs_promises(fs) {
  return {
    readFile: function(p, enc) { return Promise.resolve().then(function(){ return fs.readFileSync(p, enc); }); },
    writeFile: function(p, data, enc) { return Promise.resolve().then(function(){ return fs.writeFileSync(p, data, enc); }); },
    mkdir: function(p, opts) { return Promise.resolve().then(function(){ return fs.mkdirSync(p, opts); }); },
    readdir: function(p) { return Promise.resolve().then(function(){ return fs.readdirSync(p); }); },
    unlink: function(p) { return Promise.resolve().then(function(){ return fs.unlinkSync(p); }); },
    stat: function(p) { return Promise.resolve().then(function(){ return fs.statSync(p); }); },
    access: function(p) { return Promise.resolve().then(function(){ return fs.accessSync(p); }); },
    realpath: function(p) { return Promise.resolve().then(function(){ return fs.realpathSync(p); }); },
    copyFile: function(src, dest) { return Promise.resolve().then(function(){ return fs.copyFileSync(src, dest); }); },
  };
}

var moduleCache = Object.create(null);

function makeModule(filename) {
  return { id: filename, filename: filename, exports: {}, loaded: false, require: createRequire(filename) };
}

function dirname(p) {
  var i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i);
}

function join() {
  var parts = [];
  for (var i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));
  var out = parts.join('/');
  out = out.replace(/\/+/g, '/');
  return out;
}

function isFile(p) { return !!__bn.isFile(String(p)); }
function isDir(p) { return !!__bn.isDir(String(p)); }

// Resolve a path the way Node does for file/dir/package.json (never return a directory).
function resolveFile(base) {
  if (isFile(base)) return base;
  if (isFile(base + '.js')) return base + '.js';
  if (isFile(base + '.json')) return base + '.json';
  if (isDir(base)) {
    var pkg = join(base, 'package.json');
    if (isFile(pkg)) {
      try {
        var meta = JSON.parse(__bn.readFile(pkg));
        if (meta.main) {
          var mainPath = join(base, String(meta.main));
          if (isFile(mainPath)) return mainPath;
          if (isFile(mainPath + '.js')) return mainPath + '.js';
          if (isFile(join(mainPath, 'index.js'))) return join(mainPath, 'index.js');
        }
      } catch (e) {}
    }
    if (isFile(join(base, 'index.js'))) return join(base, 'index.js');
  }
  return null;
}

function resolveFrom(fromDir, request) {
  if (request[0] === '.' || request[0] === '/') {
    var base = request[0] === '/' ? request : join(fromDir, request);
    var hit = resolveFile(base);
    if (hit) return hit;
    throw new Error('Cannot find module ' + request);
  }
  // node_modules walk
  var dir = fromDir;
  for (;;) {
    var nm = join(dir, 'node_modules', request);
    var hitNm = resolveFile(nm);
    if (hitNm) return hitNm;
    if (dir === '/' || dir === '') break;
    var parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // core modules
  if (request === 'fs' || request === 'path' || request === 'http' || request === 'url' ||
      request === 'events' || request === 'util' || request === 'stream' || request === 'os' ||
      request === 'module' || request === 'buffer' || request === 'assert' || request === 'querystring' ||
      request === 'crypto' || request === 'perf_hooks' || request === 'async_hooks' ||
      request === 'diagnostics_channel') {
    return 'node:' + request;
  }
  throw new Error('Cannot find module \'' + request + '\'');
}

function loadCore(name) {
  if (name === 'fs') {
    var fs = {
      constants: {
        F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1,
        O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_TRUNC: 512, O_APPEND: 1024,
        S_IFMT: 61440, S_IFREG: 32768, S_IFDIR: 16384,
      },
      readFileSync: function(p, enc) {
        var t = __bn.readFile(String(p));
        if (t === null) throw new Error('ENOENT: ' + p);
        if (enc === 'buffer') return Buffer.from(t);
        return t;
      },
      writeFileSync: function(p, data) {
        if (Buffer.isBuffer(data)) data = data.toString();
        if (!__bn.writeFile(String(p), String(data))) throw new Error('EIO');
      },
      existsSync: function(p) { return !!__bn.exists(String(p)); },
      accessSync: function(p) {
        if (!__bn.exists(String(p))) {
          var e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e;
        }
      },
      mkdirSync: function(p, opts) { __bn.mkdir(String(p), !!(opts && opts.recursive)); },
      readdirSync: function(p) {
        var a = __bn.readdir(String(p));
        if (a === null) throw new Error('ENOENT: ' + p);
        return a;
      },
      unlinkSync: function(p) { if (!__bn.unlink(String(p))) throw new Error('ENOENT'); },
      realpathSync: function(p) {
        var path = String(p);
        if (path[0] !== '/') path = join(process.cwd(), path);
        var parts = [], segs = path.split('/');
        for (var i = 0; i < segs.length; i++) {
          var s = segs[i];
          if (!s || s === '.') continue;
          if (s === '..') parts.pop();
          else parts.push(s);
        }
        path = '/' + parts.join('/');
        if (!__bn.exists(path)) {
          var e = new Error('ENOENT: ' + path); e.code = 'ENOENT'; throw e;
        }
        return path;
      },
      copyFileSync: function(src, dest) {
        var t = __bn.readFile(String(src));
        if (t === null) {
          var e = new Error('ENOENT: ' + src); e.code = 'ENOENT'; throw e;
        }
        if (!__bn.writeFile(String(dest), t)) throw new Error('EIO');
      },
      statSync: function(p) {
        var path = String(p);
        if (!__bn.exists(path)) throw new Error('ENOENT: ' + path);
        var file = isFile(path);
        var dir = isDir(path);
        return {
          isFile: function() { return file; },
          isDirectory: function() { return dir; },
          isSymbolicLink: function() { return false; },
        };
      },
    };
    fs.promises = __bn_fs_promises(fs);
    return fs;
  }
  if (name === 'path') {
    var pathApi = {
      join: join,
      dirname: dirname,
      basename: function(p) { var i = String(p).lastIndexOf('/'); return i < 0 ? p : p.slice(i+1); },
      resolve: function() {
        var args = Array.prototype.slice.call(arguments);
        var r = args[0] && args[0][0] === '/' ? '' : process.cwd();
        for (var i = 0; i < args.length; i++) r = join(r || '/', args[i]);
        return r.replace(/\/+/g, '/') || '/';
      },
      extname: function(p) { var i = String(p).lastIndexOf('.'); return i < 0 ? '' : p.slice(i); },
      sep: '/',
    };
    pathApi.posix = pathApi;
    return pathApi;
  }
  if (name === 'events') {
    function EventEmitter() { this._e = Object.create(null); }
    EventEmitter.prototype.on = function(ev, fn) {
      (this._e[ev] || (this._e[ev] = [])).push(fn); return this;
    };
    EventEmitter.prototype.emit = function(ev) {
      var args = Array.prototype.slice.call(arguments, 1);
      var list = this._e[ev] || [];
      for (var i = 0; i < list.length; i++) list[i].apply(this, args);
      return list.length > 0;
    };
    EventEmitter.prototype.once = function(ev, fn) {
      var self = this;
      function w() { self.removeListener(ev, w); fn.apply(self, arguments); }
      return this.on(ev, w);
    };
    EventEmitter.prototype.removeListener = function(ev, fn) {
      var list = this._e[ev] || [];
      this._e[ev] = list.filter(function(f) { return f !== fn; });
      return this;
    };
    return { EventEmitter: EventEmitter };
  }
  if (name === 'http') {
    var EE = loadCore('events').EventEmitter;
    function Server(handler) { EE.call(this); this._port = 0; this._handler = handler; }
    Server.prototype = Object.create(EE.prototype);
    Server.prototype.listen = function(port, cb) {
      this._port = port|0;
      var self = this;
      var h = this._handler || function(req, res) { self.emit('request', req, res); };
      if (typeof __bn.registerHttp === 'function') __bn.registerHttp(this._port, h);
      else __bn.serverReady(this._port);
      if (typeof cb === 'function') setTimeout(function(){ cb(); }, 0);
      return self;
    };
    return {
      createServer: function(handler) {
        return new Server(handler);
      },
    };
  }
  if (name === 'url') {
    return {
      parse: function(u) {
        // minimal
        var m = String(u).match(/^(https?:)\/\/([^\/]+)(\/.*)?$/);
        return { href: u, protocol: m&&m[1], host: m&&m[2], pathname: (m&&m[3])||'/' };
      },
      URL: function(u) { return loadCore('url').parse(u); },
    };
  }
  if (name === 'util') {
    return {
      inherits: function(ctor, superCtor) {
        ctor.prototype = Object.create(superCtor.prototype);
        ctor.prototype.constructor = ctor;
      },
      format: function(f) { return String(f); },
      inspect: function(o) { return String(o); },
      promisify: function(fn) { return fn; },
    };
  }
  if (name === 'stream') {
    var EE = loadCore('events').EventEmitter;
    function Readable() { EE.call(this); }
    Readable.prototype = Object.create(EE.prototype);
    return { Readable: Readable, Writable: Readable, Duplex: Readable, Transform: Readable, PassThrough: Readable };
  }
  if (name === 'os') {
    return { platform: function(){return 'browsernode';}, homedir: function(){return '/home';}, EOL: '\n', arch: function(){return 'wasm32';} };
  }
  if (name === 'buffer') return { Buffer: Buffer };
  if (name === 'assert') {
    function assert(v, msg) { if (!v) throw new Error(msg || 'assertion failed'); }
    assert.strictEqual = function(a,b){ if (a !== b) throw new Error(String(a)+' !== '+String(b)); };
    return assert;
  }
  if (name === 'querystring') {
    return {
      parse: function(s) {
        var o = {}; String(s).split('&').forEach(function(kv){ var p=kv.split('='); o[decodeURIComponent(p[0]||'')]=decodeURIComponent(p[1]||''); }); return o;
      },
      stringify: function(o) {
        return Object.keys(o||{}).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(o[k]); }).join('&');
      },
    };
  }
  if (name === 'crypto') {
    function fillRandom(arr, start, end) {
      for (var i = start; i < end; i++) arr[i] = (Math.random() * 256) | 0;
    }
    function sha256(bytes) {
      var K = [
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
      ];
      function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }
      var h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
      var l = bytes.length;
      var bitLenHi = Math.floor(l / 0x20000000);
      var bitLenLo = (l << 3) >>> 0;
      var withPad = l + 1;
      while (withPad % 64 !== 56) withPad++;
      var total = withPad + 8;
      var msg = [];
      for (var i = 0; i < l; i++) msg[i] = bytes[i] & 255;
      msg[l] = 0x80;
      for (var i = l + 1; i < total; i++) msg[i] = 0;
      msg[total - 8] = (bitLenHi >>> 24) & 255;
      msg[total - 7] = (bitLenHi >>> 16) & 255;
      msg[total - 6] = (bitLenHi >>> 8) & 255;
      msg[total - 5] = bitLenHi & 255;
      msg[total - 4] = (bitLenLo >>> 24) & 255;
      msg[total - 3] = (bitLenLo >>> 16) & 255;
      msg[total - 2] = (bitLenLo >>> 8) & 255;
      msg[total - 1] = bitLenLo & 255;
      for (var i = 0; i < total; i += 64) {
        var w = [];
        for (var j = 0; j < 16; j++) {
          var o = i + j * 4;
          w[j] = ((msg[o] << 24) | (msg[o+1] << 16) | (msg[o+2] << 8) | msg[o+3]) >>> 0;
        }
        for (var j = 16; j < 64; j++) {
          var s0 = rotr(7, w[j-15]) ^ rotr(18, w[j-15]) ^ (w[j-15] >>> 3);
          var s1 = rotr(17, w[j-2]) ^ rotr(19, w[j-2]) ^ (w[j-2] >>> 10);
          w[j] = (w[j-16] + s0 + w[j-7] + s1) >>> 0;
        }
        var a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
        for (var j = 0; j < 64; j++) {
          var S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
          var ch = (e & f) ^ (~e & g);
          var t1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
          var S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
          var maj = (a & b) ^ (a & c) ^ (b & c);
          var t2 = (S0 + maj) >>> 0;
          h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
        }
        h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0;
        h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+h)>>>0;
      }
      var out = [];
      var hs = [h0,h1,h2,h3,h4,h5,h6,h7];
      for (var i = 0; i < 8; i++) {
        out.push((hs[i] >>> 24) & 255);
        out.push((hs[i] >>> 16) & 255);
        out.push((hs[i] >>> 8) & 255);
        out.push(hs[i] & 255);
      }
      return out;
    }
    return {
      randomFillSync: function(buf, offset, size) {
        offset = offset | 0;
        if (!Buffer.isBuffer(buf)) throw new TypeError('expected Buffer');
        size = size == null ? buf.length - offset : size | 0;
        fillRandom(buf._data, offset, offset + size);
        return buf;
      },
      randomBytes: function(n) {
        n = n | 0;
        if (n < 0) throw new RangeError('n must be >= 0');
        var b = Buffer.alloc(n);
        fillRandom(b._data, 0, n);
        return b;
      },
      createHash: function(alg) {
        alg = String(alg || '').toLowerCase();
        if (alg !== 'sha256' && alg !== 'sha-256') throw new Error('createHash: only sha256 supported');
        var parts = [];
        return {
          update: function(data, enc) {
            if (typeof data === 'string') parts.push(Buffer._encode(data, enc || 'utf8'));
            else if (Buffer.isBuffer(data)) parts.push(data._data);
            else parts.push(Buffer._encode(String(data), 'utf8'));
            return this;
          },
          digest: function(enc) {
            var len = 0;
            for (var i = 0; i < parts.length; i++) len += parts[i].length;
            var all = [];
            for (var j = 0; j < parts.length; j++) {
              for (var k = 0; k < parts[j].length; k++) all.push(parts[j][k]);
            }
            var dig = sha256(all);
            var buf = Buffer.from(dig);
            return enc === 'hex' ? buf.toString('hex') : buf;
          },
        };
      },
    };
  }
  if (name === 'perf_hooks') {
    function PerformanceObserver() {}
    PerformanceObserver.prototype.observe = function() {};
    PerformanceObserver.prototype.disconnect = function() {};
    return {
      performance: {
        now: function() {
          if (typeof performance !== 'undefined' && performance.now) return performance.now();
          return Date.now();
        },
        timeOrigin: 0,
      },
      PerformanceObserver: PerformanceObserver,
      constants: {},
    };
  }
  if (name === 'module') return {
    wrap: function(s){ return s; },
    builtinModules: ['fs','path','http','crypto','perf_hooks','async_hooks','diagnostics_channel','module'],
    createRequire: function(filename) {
      var file = String(filename || process.cwd() + '/.');
      if (file.indexOf('file:///') === 0) file = file.slice(7);
      else if (file.indexOf('file://') === 0) {
        file = file.slice(7);
        if (file.charAt(0) !== '/') file = '/' + file.replace(/^[^/]+/, '');
      }
      else if (file.indexOf('file:') === 0) file = file.slice(5);
      return createRequire(file);
    },
  };
  if (name === 'async_hooks') {
    function AsyncLocalStorage() { this._store = undefined; }
    AsyncLocalStorage.prototype.run = function(store, fn) {
      var prev = this._store; this._store = store;
      try { return fn.apply(null, Array.prototype.slice.call(arguments, 2)); }
      finally { this._store = prev; }
    };
    AsyncLocalStorage.prototype.getStore = function() { return this._store; };
    AsyncLocalStorage.prototype.enterWith = function(store) { this._store = store; };
    AsyncLocalStorage.prototype.disable = function() { this._store = undefined; };
    return {
      AsyncLocalStorage: AsyncLocalStorage,
      createHook: function() { return { enable: function(){}, disable: function(){} }; },
      executionAsyncId: function() { return 1; },
      triggerAsyncId: function() { return 0; },
    };
  }
  if (name === 'diagnostics_channel') {
    var channels = Object.create(null);
    function Channel(name) { this.name = name; this._subs = []; this.hasSubscribers = false; }
    Channel.prototype.subscribe = function(fn) {
      this._subs.push(fn); this.hasSubscribers = this._subs.length > 0;
    };
    Channel.prototype.unsubscribe = function(fn) {
      this._subs = this._subs.filter(function(f) { return f !== fn; });
      this.hasSubscribers = this._subs.length > 0;
    };
    Channel.prototype.publish = function(msg) {
      for (var i = 0; i < this._subs.length; i++) try { this._subs[i](msg); } catch (e) {}
    };
    return {
      channel: function(name) {
        name = String(name);
        return channels[name] || (channels[name] = new Channel(name));
      },
      hasSubscribers: function(name) {
        var ch = channels[String(name)];
        return !!(ch && ch.hasSubscribers);
      },
      tracingChannel: function() {
        return {
          start: function(){}, asyncStart: function(){}, asyncEnd: function(){},
          error: function(){}, end: function(){}, subscribe: function(){}, unsubscribe: function(){},
        };
      },
    };
  }
  throw new Error('Unknown core module ' + name);
}

function createRequire(fromFile) {
  var fromDir = dirname(fromFile);
  return function require(request) {
    request = String(request);
    var resolved = resolveFrom(fromDir, request);
    if (resolved.indexOf('node:') === 0) {
      return loadCore(resolved.slice(5));
    }
    if (moduleCache[resolved]) return moduleCache[resolved].exports;
    var mod = makeModule(resolved);
    moduleCache[resolved] = mod;
    var code = __bn.readFile(resolved);
    if (code === null) throw new Error('ENOENT loading ' + resolved);
    var wrapped = '(function(exports, require, module, __filename, __dirname){\n' + code + '\n})';
    var fn = (0, eval)(wrapped);
    fn(mod.exports, mod.require, mod, resolved, dirname(resolved));
    mod.loaded = true;
    return mod.exports;
  };
}

globalThis.require = createRequire(process.cwd() + '/.');
globalThis.console = {
  log: function() { __bn.print.apply(null, arguments); },
  error: function() { __bn.eprint.apply(null, arguments); },
  warn: function() { __bn.eprint.apply(null, arguments); },
  info: function() { __bn.print.apply(null, arguments); },
};

// QuickJS has no browser timers by default — provide sync stubs.
if (typeof globalThis.setTimeout !== 'function') {
  globalThis.setTimeout = function(fn) { if (typeof fn === 'function') fn(); return 0; };
  globalThis.clearTimeout = function() {};
  globalThis.setInterval = function(fn) { if (typeof fn === 'function') fn(); return 0; };
  globalThis.clearInterval = function() {};
}

function __bn_runMain(filename) {
  process.argv = ['node', filename];
  var path = filename[0] === '/' ? filename : join(process.cwd(), filename);
  var resolved = resolveFile(path);
  if (!resolved) {
    console.error('Cannot find module ' + filename);
    return 1;
  }
  try {
    var mod = makeModule(resolved);
    moduleCache[resolved] = mod;
    var code = __bn.readFile(resolved);
    if (code === null) throw new Error('Cannot find ' + filename);
    var wrapped = '(function(exports, require, module, __filename, __dirname){\n' + code + '\n})';
    var fn = (0, eval)(wrapped);
    fn(mod.exports, createRequire(resolved), mod, resolved, dirname(resolved));
    __bn_drain_ticks();
    return process.exitCode|0;
  } catch (e) {
    if (e && typeof e === 'object' && '__bn_exit' in e) return e.__bn_exit;
    console.error(e && e.stack ? e.stack : String(e));
    return 1;
  }
}
globalThis.__bn_runMain = __bn_runMain;
)JS";

int run_node_quickjs(Kernel& kernel, Process& proc) {
  if (proc.argv.empty()) {
    write_err(proc, "Usage: node <script.js>\n");
    return 1;
  }

  JSRuntime* rt = JS_NewRuntime();
  if (!rt) {
    write_err(proc, "node: failed to create JS runtime\n");
    return 1;
  }
  JS_SetMemoryLimit(rt, 64 * 1024 * 1024);
  JSContext* ctx = JS_NewContext(rt);
  if (!ctx) {
    JS_FreeRuntime(rt);
    write_err(proc, "node: failed to create JS context\n");
    return 1;
  }

  NodeCtx nc{&kernel, &proc, ctx};
  JS_SetContextOpaque(ctx, &nc);

  JSValue global = JS_GetGlobalObject(ctx);
  JSValue bn = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, bn, "readFile", JS_NewCFunction(ctx, js_bn_read_file, "readFile", 1));
  JS_SetPropertyStr(ctx, bn, "writeFile", JS_NewCFunction(ctx, js_bn_write_file, "writeFile", 2));
  JS_SetPropertyStr(ctx, bn, "exists", JS_NewCFunction(ctx, js_bn_exists, "exists", 1));
  JS_SetPropertyStr(ctx, bn, "isFile", JS_NewCFunction(ctx, js_bn_is_file, "isFile", 1));
  JS_SetPropertyStr(ctx, bn, "isDir", JS_NewCFunction(ctx, js_bn_is_dir, "isDir", 1));
  JS_SetPropertyStr(ctx, bn, "readdir", JS_NewCFunction(ctx, js_bn_readdir, "readdir", 1));
  JS_SetPropertyStr(ctx, bn, "mkdir", JS_NewCFunction(ctx, js_bn_mkdir, "mkdir", 2));
  JS_SetPropertyStr(ctx, bn, "unlink", JS_NewCFunction(ctx, js_bn_unlink, "unlink", 1));
  JS_SetPropertyStr(ctx, bn, "print", JS_NewCFunction(ctx, js_bn_print, "print", 0));
  JS_SetPropertyStr(ctx, bn, "eprint", JS_NewCFunction(ctx, js_bn_eprint, "eprint", 0));
  JS_SetPropertyStr(ctx, bn, "cwd", JS_NewCFunction(ctx, js_bn_cwd, "cwd", 0));
  JS_SetPropertyStr(ctx, bn, "serverReady", JS_NewCFunction(ctx, js_bn_server_ready, "serverReady", 1));
  JS_SetPropertyStr(ctx, bn, "registerHttp", JS_NewCFunction(ctx, js_bn_register_http, "registerHttp", 2));
  JS_SetPropertyStr(ctx, global, "__bn", bn);

  JSValue boot = JS_Eval(ctx, kBootstrap, std::strlen(kBootstrap), "<bootstrap>", JS_EVAL_TYPE_GLOBAL);
  if (JS_IsException(boot)) {
    JSValue ex = JS_GetException(ctx);
    const char* msg = JS_ToCString(ctx, ex);
    write_err(proc, std::string("bootstrap error: ") + (msg ? msg : "?") + "\n");
    if (msg) JS_FreeCString(ctx, msg);
    JS_FreeValue(ctx, ex);
    JS_FreeValue(ctx, global);
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    return 1;
  }
  JS_FreeValue(ctx, boot);

  std::string script = proc.argv[0];
  // Also put remaining argv onto process via eval
  {
    std::ostringstream oss;
    oss << "process.argv = ['node'";
    for (const auto& a : proc.argv) {
      oss << ", " << '"';
      for (char c : a) {
        if (c == '\\' || c == '"') oss << '\\';
        oss << c;
      }
      oss << '"';
    }
    oss << "];\n";
    oss << "__bn_runMain(";
    oss << '"';
    for (char c : script) {
      if (c == '\\' || c == '"') oss << '\\';
      oss << c;
    }
    oss << '"';
    oss << ");\n";
    auto src = oss.str();
    JSValue result = JS_Eval(ctx, src.c_str(), src.size(), "<main>", JS_EVAL_TYPE_GLOBAL);
    int code = 0;
    if (JS_IsException(result)) {
      JSValue ex = JS_GetException(ctx);
      const char* msg = JS_ToCString(ctx, ex);
      write_err(proc, std::string(msg ? msg : "exception") + "\n");
      if (msg) JS_FreeCString(ctx, msg);
      JS_FreeValue(ctx, ex);
      code = 1;
    } else if (JS_IsNumber(result)) {
      int32_t v = 0;
      JS_ToInt32(ctx, &v, result);
      code = v;
    }
    JS_FreeValue(ctx, result);
    JS_FreeValue(ctx, global);
    if (proc.keep_alive) {
      // Leave runtime alive for future HTTP dispatch (host may kill later).
      // Context retention for full request proxy lands with bn_http_dispatch.
      // For now mark keep-alive and tear down JS — host JS runtime covers preview.
      JS_FreeContext(ctx);
      JS_FreeRuntime(rt);
      return -1;
    }
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    return code;
  }
}

#endif  // BN_HAS_QUICKJS

int cmd_node(Kernel& kernel, Process& proc) {
#if defined(BN_HAS_QUICKJS)
  return run_node_quickjs(kernel, proc);
#else
  write_err(proc, "node: QuickJS not linked (build with BN_WITH_QUICKJS)\n");
  if (!proc.argv.empty()) {
    auto path = join_path(proc.cwd, proc.argv[0]);
    auto text = kernel.vfs().read_text(path);
    if (text) {
      write_out(proc, "[browsernode stub] would run:\n");
      write_out(proc, *text);
      write_out(proc, "\n");
      return 0;
    }
  }
  return 1;
#endif
}

}  // namespace

void register_core_commands(Kernel& kernel) {
  kernel.register_command("echo", cmd_echo);
  kernel.register_command("cat", cmd_cat);
  kernel.register_command("ls", cmd_ls);
  kernel.register_command("pwd", cmd_pwd);
}

void register_node_command(Kernel& kernel) {
  register_core_commands(kernel);
  kernel.register_command("node", cmd_node);
}

}  // namespace bn
