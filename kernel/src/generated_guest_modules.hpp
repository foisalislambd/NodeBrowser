// AUTO-GENERATED from kernel/embed/guest_modules.js — do not edit
#pragma once
static const char kGuestModules[] = R"GUESTJS(
/* NodeBrowser guest modules — evaluated as global script after bootstrap.
 * Redefines loadCore / createRequire / __bn_runMain and adds ESM + extras.
 * ES5-ish (var/function); no optional chaining / BigInt.
 */

/* depd / express read CallSite objects from Error.captureStackTrace. */
if (typeof Error.captureStackTrace !== 'function') {
  Error.stackTraceLimit = 10;
  Error.captureStackTrace = function(target) {
    var err = new Error();
    var lines = String(err.stack || '').split('\n').slice(1);
    var sites = [];
    for (var i = 0; i < lines.length; i++) {
      (function(line) {
        sites.push({
          getFileName: function() { return 'guest.js'; },
          getLineNumber: function() { return 1; },
          getColumnNumber: function() { return 1; },
          getFunctionName: function() { return null; },
          getTypeName: function() { return null; },
          getMethodName: function() { return null; },
          getEvalOrigin: function() { return null; },
          isToplevel: function() { return true; },
          isEval: function() { return false; },
          isNative: function() { return false; },
          isConstructor: function() { return false; },
          toString: function() { return line; }
        });
      })(lines[i]);
    }
    if (typeof Error.prepareStackTrace === 'function') {
      try { target.stack = Error.prepareStackTrace(target, sites); }
      catch (eStack) { target.stack = sites; }
    } else {
      target.stack = sites;
    }
  };
}

/* ---- fs.watch / watchFile registry (host calls __bn_emit_fs) ---- */
var __bn_fs_watchers = Object.create(null);
var __bn_fs_watchFileListeners = Object.create(null);

function __bn_basename(p) {
  var i = String(p).lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

function __bn_path_matches_watch(watchPath, eventPath) {
  var wp = String(watchPath);
  var p = String(eventPath);
  if (p === wp) return true;
  if (wp === '/') return p.charAt(0) === '/';
  if (p.indexOf(wp.charAt(wp.length - 1) === '/' ? wp : wp + '/') === 0) return true;
  if (dirname(p) === wp) return true;
  return false;
}

globalThis.__bn_emit_fs = function(type, path) {
  var p = String(path);
  var filename = __bn_basename(p);
  var wp, list, i, entry;
  for (wp in __bn_fs_watchers) {
    if (!Object.prototype.hasOwnProperty.call(__bn_fs_watchers, wp)) continue;
    if (!__bn_path_matches_watch(wp, p)) continue;
    list = __bn_fs_watchers[wp];
    for (i = 0; i < list.length; i++) {
      entry = list[i];
      if (entry.closed) continue;
      try { entry.listener(type, filename); } catch (e) {}
    }
  }
  list = __bn_fs_watchFileListeners[p];
  if (list) {
    var curr = { mtime: new Date(), path: p };
    for (i = 0; i < list.length; i++) {
      try { list[i](curr, curr); } catch (e) {}
    }
  }
};

/* ---- ESM helpers ---- */
function nearestPkgType(dir) {
  var d = dir;
  for (;;) {
    var pkg = join(d, 'package.json');
    if (isFile(pkg)) {
      try {
        var meta = JSON.parse(__bn.readFile(pkg));
        if (meta && meta.type) return String(meta.type);
      } catch (e) {}
      return 'commonjs';
    }
    if (d === '/' || d === '') return 'commonjs';
    var parent = dirname(d);
    if (parent === d) return 'commonjs';
    d = parent;
  }
}

function isEsmFile(filename) {
  if (/\.mjs$/i.test(filename)) return true;
  if (/\.cjs$/i.test(filename)) return false;
  if (/\.js$/i.test(filename)) return nearestPkgType(dirname(filename)) === 'module';
  return false;
}

function resolveExportsTarget(target, base) {
  if (typeof target === 'string') {
    var p = join(base, target);
    if (isFile(p)) return p;
    if (isFile(p + '.js')) return p + '.js';
    if (isFile(p + '.mjs')) return p + '.mjs';
    if (isFile(p + '.cjs')) return p + '.cjs';
    if (isFile(join(p, 'index.js'))) return join(p, 'index.js');
    if (isFile(join(p, 'index.mjs'))) return join(p, 'index.mjs');
    return null;
  }
  if (Array.isArray(target)) {
    for (var a = 0; a < target.length; a++) {
      var hitA = resolveExportsTarget(target[a], base);
      if (hitA) return hitA;
    }
    return null;
  }
  if (target && typeof target === 'object') {
    var order = globalThis.__bn_cond === 'import'
      ? ['import', 'module', 'default', 'node', 'require', 'browser', 'development']
      : ['require', 'node', 'default', 'browser', 'import', 'development', 'module'];
    for (var i = 0; i < order.length; i++) {
      if (target[order[i]] != null) {
        var hit = resolveExportsTarget(target[order[i]], base);
        if (hit) return hit;
      }
    }
  }
  return null;
}

function resolvePkgExports(base, requestSubpath) {
  var pkg = join(base, 'package.json');
  if (!isFile(pkg)) return null;
  try {
    var meta = JSON.parse(__bn.readFile(pkg));
    if (!meta.exports) return null;
    var exp = meta.exports;
    var key = requestSubpath == null || requestSubpath === ''
      ? '.'
      : ('./' + String(requestSubpath).replace(/^\.\//, ''));
    if (typeof exp === 'string') return requestSubpath ? null : resolveExportsTarget(exp, base);
    if (exp[key] != null) return resolveExportsTarget(exp[key], base);
    if (key === '.' && exp['./'] != null) return resolveExportsTarget(exp['./'], base);
  } catch (e) {}
  return null;
}

function __bn_rewrite_esm(code, filename) {
  var out = String(code);
  var fnExports = [];
  out = out.replace(/^\s*import\s+type\b[^;\n]*;?/gm, '');
  out = out.replace(/^\s*export\s+type\b[^;\n]*;?/gm, '');
  out = out.replace(/^\s*export\s*\*\s+as\s+([\w$]+)\s+from\s*['"]([^'"]+)['"]\s*;?/gm, function(_, name, src) {
    return 'exports[' + JSON.stringify(name) + ']=require(' + JSON.stringify(src) + ');';
  });
  out = out.replace(/^\s*export\s*\*\s+from\s*['"]([^'"]+)['"]\s*;?/gm, function(_, src) {
    return '(function(__star){if(__star&&typeof __star==="object"){for(var __k in __star){if(__k!=="default"&&Object.prototype.hasOwnProperty.call(__star,__k))exports[__k]=__star[__k];}}})(require(' + JSON.stringify(src) + '));';
  });
  out = out.replace(/^\s*export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?/gm, function(_, names, src) {
    var lines = ['var __re=require(' + JSON.stringify(src) + ');'];
    names.split(',').forEach(function(part) {
      part = part.trim();
      if (!part || part.indexOf('type ') === 0) return;
      var bits = part.split(/\s+as\s+/);
      var local = bits[0].trim();
      var exp = (bits[1] || bits[0]).trim();
      lines.push('exports[' + JSON.stringify(exp) + ']=__re[' + JSON.stringify(local) + '];');
    });
    return lines.join('\n');
  });
  out = out.replace(/^\s*import\s+([\w$]+)\s*,\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?/gm, function(_, def, named, src) {
    return 'var __m_' + def + '=require("' + src + '"); var ' + def + '=(__m_' + def + '.default!==undefined?__m_' + def + '.default:__m_' + def + '); var {' + named + '}=__m_' + def + ';';
  });
  out = out.replace(/^\s*import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?/gm, function(_, named, src) {
    return 'var {' + named + '}=require("' + src + '");';
  });
  out = out.replace(/^\s*import\s+\*\s+as\s+([\w$]+)\s+from\s*['"]([^'"]+)['"]\s*;?/gm, function(_, name, src) {
    return 'var ' + name + '=require("' + src + '");';
  });
  out = out.replace(/^\s*import\s+([\w$]+)\s+from\s*['"]([^'"]+)['"]\s*;?/gm, function(_, name, src) {
    return 'var __m_' + name + '=require("' + src + '"); var ' + name + '=(__m_' + name + '.default!==undefined?__m_' + name + '.default:__m_' + name + ');';
  });
  out = out.replace(/^\s*import\s*['"]([^'"]+)['"]\s*;?/gm, function(_, src) {
    return 'require("' + src + '");';
  });
  out = out.replace(/^\s*export\s+default\s+function(\s+[\w$]+)?/gm, 'exports.default=function$1');
  out = out.replace(/^\s*export\s+default\s+/gm, 'exports.default=');
  out = out.replace(/^\s*export\s+(async\s+)?function\s+([\w$]+)/gm, function(_, asyncKw, name) {
    fnExports.push(name);
    return (asyncKw || '') + 'function ' + name;
  });
  out = out.replace(/^\s*export\s+(const|let|var)\s+([\w$]+)(\s*=\s*[^;\n]+;?)/gm, function(_, kind, name, rest) {
    return kind + ' ' + name + rest + '; exports[' + JSON.stringify(name) + ']=' + name + ';';
  });
  out = out.replace(/^\s*export\s*\{([^}]+)\}\s*;?/gm, function(_, names) {
    return names.split(',').map(function(part) {
      part = part.trim();
      if (!part) return '';
      var bits = part.split(/\s+as\s+/);
      var local = bits[0].trim();
      var exp = (bits[1] || bits[0]).trim();
      return 'exports[' + JSON.stringify(exp) + ']=' + local + ';';
    }).join('\n');
  });
  out = out.replace(/\bimport\s*\(/g, '__bn_dynamic_import(');
  out = out.replace(/import\.meta\.url/g, 'import_meta.url');
  if (fnExports.length) {
    out += '\n' + fnExports.map(function(n) {
      return 'exports[' + JSON.stringify(n) + ']=' + n + ';';
    }).join('\n');
  }
  out = 'var import_meta={url:' + JSON.stringify('file://' + String(filename || '')) + '};\n' + out;
  return out;
}

/* ---- resolver overrides (exports + extra cores) ---- */
var __bn_CORE_MODULES = [
  'fs', 'path', 'http', 'https', 'net', 'url', 'events', 'util', 'stream', 'os',
  'module', 'buffer', 'assert', 'querystring', 'crypto', 'perf_hooks', 'async_hooks',
  'diagnostics_channel', 'zlib', 'string_decoder', 'timers', 'timers/promises', 'child_process',
  'tty', 'readline', 'worker_threads', 'vm', 'cluster', 'dns', 'dgram', 'inspector', 'v8', 'wasi',
  'constants', 'punycode', 'sys',
  'connect', 'ws', 'corepack', 'next/cache', 'next/headers', 'express'
];

function resolveFile(base) {
  if (isFile(base)) return base;
  if (isFile(base + '.js')) return base + '.js';
  if (isFile(base + '.mjs')) return base + '.mjs';
  if (isFile(base + '.json')) return base + '.json';
  if (isDir(base)) {
    var viaExp = resolvePkgExports(base, null);
    if (viaExp) return viaExp;
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
        if (meta.module) {
          var modPath = join(base, String(meta.module));
          if (isFile(modPath)) return modPath;
        }
      } catch (e) {}
    }
    if (isFile(join(base, 'index.js'))) return join(base, 'index.js');
    if (isFile(join(base, 'index.mjs'))) return join(base, 'index.mjs');
  }
  return null;
}

function __bn_posix_normalize(p) {
  p = String(p);
  if (!p) return '.';
  var abs = p.charAt(0) === '/';
  var trailing = p.length > 1 && p.charAt(p.length - 1) === '/';
  var parts = p.split('/');
  var stack = [];
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length && stack[stack.length - 1] !== '..') stack.pop();
      else if (!abs) stack.push('..');
    } else stack.push(part);
  }
  var out = stack.join('/');
  if (abs) out = '/' + out;
  else if (!out) out = '.';
  if (trailing && out !== '/' && out.charAt(out.length - 1) !== '/') out += '/';
  return out;
}
function resolveFrom(fromDir, request) {
  if (request.indexOf('node:') === 0) return request;
  if (request.charAt(0) === '.' || request.charAt(0) === '/') {
    var base = request.charAt(0) === '/' ? request : join(fromDir, request);
    var hit = resolveFile(__bn_posix_normalize(base));
    if (hit) return hit;
    throw new Error('Cannot find module ' + request);
  }
  var dir = fromDir;
  for (;;) {
    var nm = join(dir, 'node_modules', request);
    var slash = request.indexOf('/');
    var scoped = request.charAt(0) === '@';
    if (scoped) {
      var s2 = request.indexOf('/', request.indexOf('/') + 1);
      if (s2 > 0) {
        var via = resolvePkgExports(join(dir, 'node_modules', request.slice(0, s2)), request.slice(s2 + 1));
        if (via) return via;
      }
    } else if (slash > 0) {
      var via2 = resolvePkgExports(join(dir, 'node_modules', request.slice(0, slash)), request.slice(slash + 1));
      if (via2) return via2;
    } else {
      var via3 = resolvePkgExports(nm, null);
      if (via3) return via3;
    }
    var hitNm = resolveFile(nm);
    if (hitNm) return hitNm;
    if (dir === '/' || dir === '') break;
    var parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (__bn_CORE_MODULES.indexOf(request) >= 0) return 'node:' + request;
  throw new Error("Cannot find module '" + request + "'");
}

/* ---- crypto / stream / util / zlib helpers ---- */
function __bn_crypto_random_fill(u8) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(u8);
    return u8;
  }
  for (var i = 0; i < u8.length; i++) u8[i] = (Math.random() * 256) | 0;
  return u8;
}

function __bn_sha1(bytes) {
  function rotr(n, x) { return (x << (32 - n)) | (x >>> n); }
  var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  var l = bytes.length;
  var bitLenHi = Math.floor(l / 0x20000000);
  var bitLenLo = (l << 3) >>> 0;
  var withPad = l + 1;
  while (withPad % 64 !== 56) withPad++;
  var total = withPad + 8;
  var msg = new Uint8Array(total);
  msg.set(bytes);
  msg[l] = 0x80;
  msg[total - 8] = (bitLenHi >>> 24) & 255;
  msg[total - 7] = (bitLenHi >>> 16) & 255;
  msg[total - 6] = (bitLenHi >>> 8) & 255;
  msg[total - 5] = bitLenHi & 255;
  msg[total - 4] = (bitLenLo >>> 24) & 255;
  msg[total - 3] = (bitLenLo >>> 16) & 255;
  msg[total - 2] = (bitLenLo >>> 8) & 255;
  msg[total - 1] = bitLenLo & 255;
  for (var i = 0; i < total; i += 64) {
    var w = new Array(80);
    for (var j = 0; j < 16; j++) {
      var o = i + j * 4;
      w[j] = ((msg[o] << 24) | (msg[o + 1] << 16) | (msg[o + 2] << 8) | msg[o + 3]) >>> 0;
    }
    for (j = 16; j < 80; j++) w[j] = rotr(31, w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16]) >>> 0;
    var a = h0, b = h1, c = h2, d = h3, e = h4;
    for (j = 0; j < 80; j++) {
      var f, k;
      if (j < 20) { f = (b & c) | ((~b) & d); k = 0x5A827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      var temp = (rotr(27, a) + f + e + k + w[j]) >>> 0;
      e = d; d = c; c = rotr(2, b) >>> 0; b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  var out = new Uint8Array(20);
  var hs = [h0, h1, h2, h3, h4];
  for (i = 0; i < 5; i++) {
    out[i * 4] = (hs[i] >>> 24) & 255;
    out[i * 4 + 1] = (hs[i] >>> 16) & 255;
    out[i * 4 + 2] = (hs[i] >>> 8) & 255;
    out[i * 4 + 3] = hs[i] & 255;
  }
  return out;
}

function __bn_sha256(bytes) {
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }
  var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  var l = bytes.length;
  var bitLenHi = Math.floor(l / 0x20000000);
  var bitLenLo = (l << 3) >>> 0;
  var withPad = l + 1;
  while (withPad % 64 !== 56) withPad++;
  var total = withPad + 8;
  var msg = new Uint8Array(total);
  msg.set(bytes);
  msg[l] = 0x80;
  msg[total - 8] = (bitLenHi >>> 24) & 255;
  msg[total - 7] = (bitLenHi >>> 16) & 255;
  msg[total - 6] = (bitLenHi >>> 8) & 255;
  msg[total - 5] = bitLenHi & 255;
  msg[total - 4] = (bitLenLo >>> 24) & 255;
  msg[total - 3] = (bitLenLo >>> 16) & 255;
  msg[total - 2] = (bitLenLo >>> 8) & 255;
  msg[total - 1] = bitLenLo & 255;
  for (var i = 0; i < total; i += 64) {
    var w = new Array(64);
    for (var j = 0; j < 16; j++) {
      var o = i + j * 4;
      w[j] = ((msg[o] << 24) | (msg[o + 1] << 16) | (msg[o + 2] << 8) | msg[o + 3]) >>> 0;
    }
    for (j = 16; j < 64; j++) {
      var s0 = rotr(7, w[j - 15]) ^ rotr(18, w[j - 15]) ^ (w[j - 15] >>> 3);
      var s1 = rotr(17, w[j - 2]) ^ rotr(19, w[j - 2]) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (j = 0; j < 64; j++) {
      var S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
      var S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  var out = new Uint8Array(32);
  var hs = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (i = 0; i < 8; i++) {
    out[i * 4] = (hs[i] >>> 24) & 255;
    out[i * 4 + 1] = (hs[i] >>> 16) & 255;
    out[i * 4 + 2] = (hs[i] >>> 8) & 255;
    out[i * 4 + 3] = hs[i] & 255;
  }
  return out;
}

/** Compact SHA-512 (and SHA-384 via different IVs). */
function __bn_sha512(msg, bits) {
  bits = bits || 512;
  function u64(h, l) { return { h: h >>> 0, l: l >>> 0 }; }
  function add(a, b) {
    var l = (a.l + b.l) >>> 0;
    var c = l < a.l ? 1 : 0;
    return u64((a.h + b.h + c) >>> 0, l);
  }
  function rotr(x, n) {
    if (n < 32) return u64((x.h >>> n) | (x.l << (32 - n)), (x.l >>> n) | (x.h << (32 - n)));
    n -= 32;
    return u64((x.l >>> n) | (x.h << (32 - n)), (x.h >>> n) | (x.l << (32 - n)));
  }
  function shr(x, n) {
    if (n < 32) return u64(x.h >>> n, (x.l >>> n) | (x.h << (32 - n)));
    return u64(0, x.h >>> (n - 32));
  }
  function xor(a, b) { return u64(a.h ^ b.h, a.l ^ b.l); }
  function and(a, b) { return u64(a.h & b.h, a.l & b.l); }
  function not(a) { return u64(~a.h, ~a.l); }
  var K = [
    u64(0x428a2f98,0xd728ae22),u64(0x71374491,0x23ef65cd),u64(0xb5c0fbcf,0xec4d3b2f),u64(0xe9b5dba5,0x8189dbbc),
    u64(0x3956c25b,0xf348b538),u64(0x59f111f1,0xb605d019),u64(0x923f82a4,0xaf194f9b),u64(0xab1c5ed5,0xda6d8118),
    u64(0xd807aa98,0xa3030242),u64(0x12835b01,0x45706fbe),u64(0x243185be,0x4ee4b28c),u64(0x550c7dc3,0xd5ffb4e2),
    u64(0x72be5d74,0xf27b896f),u64(0x80deb1fe,0x3b1696b1),u64(0x9bdc06a7,0x25c71235),u64(0xc19bf174,0xcf692694),
    u64(0xe49b69c1,0x9ef14ad2),u64(0xefbe4786,0x384f25e3),u64(0x0fc19dc6,0x8b8cd5b5),u64(0x240ca1cc,0x77ac9c65),
    u64(0x2de92c6f,0x592b0275),u64(0x4a7484aa,0x6ea6e483),u64(0x5cb0a9dc,0xbd41fbd4),u64(0x76f988da,0x831153b5),
    u64(0x983e5152,0xee66dfab),u64(0xa831c66d,0x2db43210),u64(0xb00327c8,0x98fb213f),u64(0xbf597fc7,0xbeef0ee4),
    u64(0xc6e00bf3,0x3da88fc2),u64(0xd5a79147,0x930aa725),u64(0x06ca6351,0xe003826f),u64(0x14292967,0x0a0e6e70),
    u64(0x27b70a85,0x46d22ffc),u64(0x2e1b2138,0x5c26c926),u64(0x4d2c6dfc,0x5ac42aed),u64(0x53380d13,0x9d95b3df),
    u64(0x650a7354,0x8baf63de),u64(0x766a0abb,0x3c77b2a8),u64(0x81c2c92e,0x47edaee6),u64(0x92722c85,0x1482353b),
    u64(0xa2bfe8a1,0x4cf10364),u64(0xa81a664b,0xbc423001),u64(0xc24b8b70,0xd0f89791),u64(0xc76c51a3,0x0654be30),
    u64(0xd192e819,0xd6ef5218),u64(0xd6990624,0x5565a910),u64(0xf40e3585,0x5771202a),u64(0x106aa070,0x32bbd1b8),
    u64(0x19a4c116,0xb8d2d0c8),u64(0x1e376c08,0x5141ab53),u64(0x2748774c,0xdf8eeb99),u64(0x34b0bcb5,0xe19b48a8),
    u64(0x391c0cb3,0xc5c95a63),u64(0x4ed8aa4a,0xe3418acb),u64(0x5b9cca4f,0x7763e373),u64(0x682e6ff3,0xd6b2b8a3),
    u64(0x748f82ee,0x5defb2fc),u64(0x78a5636f,0x43172f60),u64(0x84c87814,0xa1f0ab72),u64(0x8cc70208,0x1a6439ec),
    u64(0x90befffa,0x23631e28),u64(0xa4506ceb,0xde82bde9),u64(0xbef9a3f7,0xb2c67915),u64(0xc67178f2,0xe372532b),
    u64(0xca273ece,0xea26619c),u64(0xd186b8c7,0x21c0c207),u64(0xeada7dd6,0xcde0eb1e),u64(0xf57d4f7f,0xee6ed178),
    u64(0x06f067aa,0x72176fba),u64(0x0a637dc5,0xa2c898a6),u64(0x113f9804,0xbef90dae),u64(0x1b710b35,0x131c471b),
    u64(0x28db77f5,0x23047d84),u64(0x32caab7b,0x40c72493),u64(0x3c9ebe0a,0x15c9bebc),u64(0x431d67c4,0x9c100d4c),
    u64(0x4cc5d4be,0xcb3e42b6),u64(0x597f299c,0xfc657e2a),u64(0x5fcb6fab,0x3ad6faec),u64(0x6c44198c,0x4a475817)
  ];
  var H = bits === 384 ? [
    u64(0xcbbb9d5d,0xc1059ed8),u64(0x629a292a,0x367cd507),u64(0x9159015a,0x3070dd17),u64(0x152fecd8,0xf70e5939),
    u64(0x67332667,0xffc00b31),u64(0x8eb44a87,0x68581511),u64(0xdb0c2e0d,0x64f98fa7),u64(0x47b5481d,0xbefa4fa4)
  ] : [
    u64(0x6a09e667,0xf3bcc908),u64(0xbb67ae85,0x84caa73b),u64(0x3c6ef372,0xfe94f82b),u64(0xa54ff53a,0x5f1d36f1),
    u64(0x510e527f,0xade682d1),u64(0x9b05688c,0x2b3e6c1f),u64(0x1f83d9ab,0xfb41bd6b),u64(0x5be0cd19,0x137e2179)
  ];
  var bytes = [];
  for (var i = 0; i < msg.length; i++) bytes.push(msg[i] & 255);
  var bitLen = msg.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 128) !== 112) bytes.push(0);
  // 128-bit big-endian bit length
  for (i = 0; i < 8; i++) bytes.push(0);
  var loHi = Math.floor(bitLen / 0x100000000) >>> 0;
  var loLo = bitLen >>> 0;
  bytes.push((loHi >>> 24) & 255, (loHi >>> 16) & 255, (loHi >>> 8) & 255, loHi & 255);
  bytes.push((loLo >>> 24) & 255, (loLo >>> 16) & 255, (loLo >>> 8) & 255, loLo & 255);
  for (var off = 0; off < bytes.length; off += 128) {
    var w = [];
    for (var t = 0; t < 16; t++) {
      var o = off + t * 8;
      w[t] = u64((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3],
                 (bytes[o + 4] << 24) | (bytes[o + 5] << 16) | (bytes[o + 6] << 8) | bytes[o + 7]);
    }
    for (t = 16; t < 80; t++) {
      var s0 = xor(xor(rotr(w[t - 15], 1), rotr(w[t - 15], 8)), shr(w[t - 15], 7));
      var s1 = xor(xor(rotr(w[t - 2], 19), rotr(w[t - 2], 61)), shr(w[t - 2], 6));
      w[t] = add(add(add(w[t - 16], s0), w[t - 7]), s1);
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (t = 0; t < 80; t++) {
      var S1 = xor(xor(rotr(e, 14), rotr(e, 18)), rotr(e, 41));
      var ch = xor(and(e, f), and(not(e), g));
      var t1 = add(add(add(add(h, S1), ch), K[t]), w[t]);
      var S0 = xor(xor(rotr(a, 28), rotr(a, 34)), rotr(a, 39));
      var maj = xor(xor(and(a, b), and(a, c)), and(b, c));
      var t2 = add(S0, maj);
      h = g; g = f; f = e; e = add(d, t1); d = c; c = b; b = a; a = add(t1, t2);
    }
    H[0] = add(H[0], a); H[1] = add(H[1], b); H[2] = add(H[2], c); H[3] = add(H[3], d);
    H[4] = add(H[4], e); H[5] = add(H[5], f); H[6] = add(H[6], g); H[7] = add(H[7], h);
  }
  var outLen = bits === 384 ? 48 : 64;
  var out = new Uint8Array(outLen);
  for (i = 0; i < outLen / 8; i++) {
    out[i * 8] = (H[i].h >>> 24) & 255; out[i * 8 + 1] = (H[i].h >>> 16) & 255;
    out[i * 8 + 2] = (H[i].h >>> 8) & 255; out[i * 8 + 3] = H[i].h & 255;
    out[i * 8 + 4] = (H[i].l >>> 24) & 255; out[i * 8 + 5] = (H[i].l >>> 16) & 255;
    out[i * 8 + 6] = (H[i].l >>> 8) & 255; out[i * 8 + 7] = H[i].l & 255;
  }
  return out;
}

function __bn_as_bytes(data, enc) {
  if (typeof data === 'string') return Buffer._encode(data, enc || 'utf8');
  if (Buffer.isBuffer && Buffer.isBuffer(data)) return data._data;
  if (typeof Uint8Array !== 'undefined' && data instanceof Uint8Array) return data;
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data && typeof data.length === 'number') return data;
  return Buffer._encode(String(data == null ? '' : data), 'utf8');
}

function __bn_join_bytes(chunks) {
  var len = 0, i, j, o = 0;
  for (i = 0; i < chunks.length; i++) len += chunks[i].length;
  var all = new Uint8Array(len);
  for (i = 0; i < chunks.length; i++) {
    var ch = chunks[i];
    for (j = 0; j < ch.length; j++) all[o++] = ch[j] & 255;
  }
  return all;
}

function __bn_norm_hash(alg) {
  return String(alg || '').toLowerCase().replace(/^sha-/, 'sha');
}

function __bn_hash_ok(alg) {
  return alg === 'sha1' || alg === 'sha256' || alg === 'sha384' || alg === 'sha512';
}

function __bn_hash_bytes(alg, all) {
  if (alg === 'sha1') return __bn_sha1(all);
  if (alg === 'sha256') return __bn_sha256(all);
  if (alg === 'sha384') return __bn_sha512(all, 384);
  return __bn_sha512(all, 512);
}

function __bn_hex_bytes(dig) {
  var h = '';
  for (var k = 0; k < dig.length; k++) h += ((dig[k] & 255) + 256).toString(16).slice(1);
  return h;
}

/** HMAC(K, m) = H((K' ⊕ opad) || H((K' ⊕ ipad) || m)). Block is 64 (sha1/256) or 128 (sha384/512). */
function __bn_hmac(alg, key, msg) {
  var block = (alg === 'sha384' || alg === 'sha512') ? 128 : 64;
  var k = key;
  if (k.length > block) k = __bn_hash_bytes(alg, k);
  var i, b;
  var inner = new Uint8Array(block + msg.length);
  for (i = 0; i < block; i++) {
    b = i < k.length ? (k[i] & 255) : 0;
    inner[i] = b ^ 0x36;
  }
  for (i = 0; i < msg.length; i++) inner[block + i] = msg[i] & 255;
  var ih = __bn_hash_bytes(alg, inner);
  var outer = new Uint8Array(block + ih.length);
  for (i = 0; i < block; i++) {
    b = i < k.length ? (k[i] & 255) : 0;
    outer[i] = b ^ 0x5c;
  }
  for (i = 0; i < ih.length; i++) outer[block + i] = ih[i] & 255;
  return __bn_hash_bytes(alg, outer);
}

function __bn_pbkdf2(alg, password, salt, iterations, keylen) {
  alg = __bn_norm_hash(alg || 'sha1');
  if (!__bn_hash_ok(alg)) {
    var bad = new Error('pbkdf2: unsupported digest ' + alg);
    bad.code = 'ERR_CRYPTO_INVALID_DIGEST';
    throw bad;
  }
  iterations = iterations | 0;
  keylen = keylen | 0;
  if (iterations <= 0 || keylen < 0) {
    var range = new RangeError('pbkdf2: invalid iterations or key length');
    range.code = 'ERR_OUT_OF_RANGE';
    throw range;
  }
  var pass = __bn_as_bytes(password);
  var sal = __bn_as_bytes(salt);
  var hlen = alg === 'sha1' ? 20 : (alg === 'sha256' ? 32 : (alg === 'sha384' ? 48 : 64));
  var blocks = Math.ceil(keylen / hlen) || 0;
  var out = [];
  var block, s, seed, u, t, j, c;
  for (block = 1; block <= blocks; block++) {
    seed = new Uint8Array(sal.length + 4);
    for (s = 0; s < sal.length; s++) seed[s] = sal[s] & 255;
    seed[sal.length] = (block >>> 24) & 255;
    seed[sal.length + 1] = (block >>> 16) & 255;
    seed[sal.length + 2] = (block >>> 8) & 255;
    seed[sal.length + 3] = block & 255;
    u = __bn_hmac(alg, pass, seed);
    t = [];
    for (j = 0; j < u.length; j++) t.push(u[j] & 255);
    for (c = 1; c < iterations; c++) {
      u = __bn_hmac(alg, pass, u);
      for (j = 0; j < t.length; j++) t[j] = (t[j] ^ (u[j] & 255)) & 255;
    }
    for (j = 0; j < t.length && out.length < keylen; j++) out.push(t[j]);
  }
  return out;
}

var __bn_aes_sbox = null;
var __bn_aes_inv = null;
function __bn_aes_bytes(hex) {
  var out = [];
  for (var i = 0; i < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
  return out;
}
function __bn_aes_tables() {
  if (__bn_aes_sbox) return;
  __bn_aes_sbox = __bn_aes_bytes(
    '637c777bf26b6fc53001672bfed7ab76ca82c97dfa5947f0add4a2af9ca472c0b7fd9326363ff7cc34a5e5f171d8311504c723c31896059a071280e2eb27b27509832c1a1b6e5aa0523bd6b329e32f8453d100ed20fcb15b6acbbe394a4c58cfd0efaafb434d338545f9027f503c9fa851a3408f929d38f5bcb6da2110fff3d2cd0c13ec5f974417c4a77e3d645d197360814fdc222a908846eeb814de5e0bdbe0323a0a4906245cc2d3ac629195e479e7c8376d8dd54ea96c56f4ea657aae08ba78252e1ca6b4c6e8dd741f4bbd8b8a703eb5664803f60e613557b986c11d9ee1f8981169d98e949b1e87e9ce5528df8ca1890dbfe6426841992d0fb054bb16'
  );
  __bn_aes_inv = __bn_aes_bytes(
    '52096ad53036a538bf40a39e81f3d7fb7ce339829b2fff87348e4344c4dee9cb547b9432a6c2233dee4c950b42fac34e082ea16628d924b2765ba2496d8bd12572f8f66486689816d4a45ccc5d65b6926c704850fdedb9da5e154657a78d9d8490d8ab008cbcd30af7e45805b8b34506d02c1e8fca3f0f02c1afbd0301138a6b3a9111414f67dcea97f2cfcef0b4e67396ac7422e7ad3585e2f937e81c75df6e47f11a711d29c5896fb7620eaa18be1bfc563e4bc6d279209adbc0fe78cd5af41fdda8338807c731b11210592780ec5f60517fa919b54a0d2de57a9f93c99cefa0e03b4dae2af5b0c8ebbb3c83539961172b047eba77d626e169146355210c7d'
  );
}
function __bn_gfmul(a, b) {
  var p = 0;
  var i;
  a &= 255;
  b &= 255;
  for (i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    var hi = a & 128;
    a = (a << 1) & 255;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p & 255;
}
function __bn_aes_expand(key) {
  __bn_aes_tables();
  var nk = key.length / 4;
  var nr = nk + 6;
  var words = nk * (nr + 1);
  var w = [];
  var i;
  var rcon = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54];
  for (i = 0; i < nk; i++) {
    w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  }
  for (i = nk; i < words; i++) {
    var temp = w[i - 1];
    if (i % nk === 0) {
      temp = ((temp << 8) | (temp >>> 24)) >>> 0;
      temp = ((__bn_aes_sbox[(temp >>> 24) & 255] << 24) | (__bn_aes_sbox[(temp >>> 16) & 255] << 16) |
        (__bn_aes_sbox[(temp >>> 8) & 255] << 8) | __bn_aes_sbox[temp & 255]) >>> 0;
      temp = (temp ^ (rcon[(i / nk) | 0] << 24)) >>> 0;
    } else if (nk > 6 && i % nk === 4) {
      temp = ((__bn_aes_sbox[(temp >>> 24) & 255] << 24) | (__bn_aes_sbox[(temp >>> 16) & 255] << 16) |
        (__bn_aes_sbox[(temp >>> 8) & 255] << 8) | __bn_aes_sbox[temp & 255]) >>> 0;
    }
    w[i] = (w[i - nk] ^ temp) >>> 0;
  }
  return { nr: nr, w: w };
}
function __bn_aes_add(state, w, round) {
  var c;
  for (c = 0; c < 4; c++) {
    var word = w[round * 4 + c];
    state[c * 4] ^= (word >>> 24) & 255;
    state[c * 4 + 1] ^= (word >>> 16) & 255;
    state[c * 4 + 2] ^= (word >>> 8) & 255;
    state[c * 4 + 3] ^= word & 255;
  }
}
function __bn_aes_encrypt_block(block, exp) {
  var state = block.slice();
  var r, c, t, round;
  __bn_aes_add(state, exp.w, 0);
  for (round = 1; round < exp.nr; round++) {
    for (r = 0; r < 16; r++) state[r] = __bn_aes_sbox[state[r]];
    t = state.slice();
    for (r = 0; r < 4; r++) {
      for (c = 0; c < 4; c++) state[r + 4 * c] = t[r + 4 * ((c + r) % 4)];
    }
    for (c = 0; c < 4; c++) {
      var i = c * 4;
      var a0 = state[i], a1 = state[i + 1], a2 = state[i + 2], a3 = state[i + 3];
      state[i] = __bn_gfmul(a0, 2) ^ __bn_gfmul(a1, 3) ^ a2 ^ a3;
      state[i + 1] = a0 ^ __bn_gfmul(a1, 2) ^ __bn_gfmul(a2, 3) ^ a3;
      state[i + 2] = a0 ^ a1 ^ __bn_gfmul(a2, 2) ^ __bn_gfmul(a3, 3);
      state[i + 3] = __bn_gfmul(a0, 3) ^ a1 ^ a2 ^ __bn_gfmul(a3, 2);
    }
    __bn_aes_add(state, exp.w, round);
  }
  for (r = 0; r < 16; r++) state[r] = __bn_aes_sbox[state[r]];
  t = state.slice();
  for (r = 0; r < 4; r++) {
    for (c = 0; c < 4; c++) state[r + 4 * c] = t[r + 4 * ((c + r) % 4)];
  }
  __bn_aes_add(state, exp.w, exp.nr);
  return state;
}
function __bn_aes_decrypt_block(block, exp) {
  var state = block.slice();
  var r, c, t, round;
  __bn_aes_add(state, exp.w, exp.nr);
  for (round = exp.nr - 1; round >= 1; round--) {
    t = state.slice();
    for (r = 0; r < 4; r++) {
      for (c = 0; c < 4; c++) state[r + 4 * c] = t[r + 4 * ((c - r + 4) % 4)];
    }
    for (r = 0; r < 16; r++) state[r] = __bn_aes_inv[state[r]];
    __bn_aes_add(state, exp.w, round);
    for (c = 0; c < 4; c++) {
      var i = c * 4;
      var a0 = state[i], a1 = state[i + 1], a2 = state[i + 2], a3 = state[i + 3];
      state[i] = __bn_gfmul(a0, 14) ^ __bn_gfmul(a1, 11) ^ __bn_gfmul(a2, 13) ^ __bn_gfmul(a3, 9);
      state[i + 1] = __bn_gfmul(a0, 9) ^ __bn_gfmul(a1, 14) ^ __bn_gfmul(a2, 11) ^ __bn_gfmul(a3, 13);
      state[i + 2] = __bn_gfmul(a0, 13) ^ __bn_gfmul(a1, 9) ^ __bn_gfmul(a2, 14) ^ __bn_gfmul(a3, 11);
      state[i + 3] = __bn_gfmul(a0, 11) ^ __bn_gfmul(a1, 13) ^ __bn_gfmul(a2, 9) ^ __bn_gfmul(a3, 14);
    }
  }
  t = state.slice();
  for (r = 0; r < 4; r++) {
    for (c = 0; c < 4; c++) state[r + 4 * c] = t[r + 4 * ((c - r + 4) % 4)];
  }
  for (r = 0; r < 16; r++) state[r] = __bn_aes_inv[state[r]];
  __bn_aes_add(state, exp.w, 0);
  return state;
}
function __bn_aes_out(bytes, enc) {
  var buf = Buffer.from(bytes);
  if (enc === 'hex' || enc === 'utf8' || enc === 'latin1' || enc === 'base64') return buf.toString(enc);
  return buf;
}
function __bn_make_cipher(alg, key, iv, encrypt) {
  var name = String(alg || '').toLowerCase();
  var want = name === 'aes-128-cbc' ? 16 : name === 'aes-192-cbc' ? 24 : name === 'aes-256-cbc' ? 32 : 0;
  if (!want) {
    var unknown = new Error((encrypt ? 'createCipheriv' : 'createDecipheriv') + ': unsupported ' + alg);
    unknown.code = 'ERR_CRYPTO_UNKNOWN_CIPHER';
    throw unknown;
  }
  var keyBytes = __bn_as_bytes(key);
  var ivBytes = __bn_as_bytes(iv);
  if (keyBytes.length !== want) {
    var badKey = new Error('Invalid key length');
    badKey.code = 'ERR_CRYPTO_INVALID_KEYLEN';
    throw badKey;
  }
  if (ivBytes.length !== 16) {
    var badIv = new Error('Invalid initialization vector');
    badIv.code = 'ERR_CRYPTO_INVALID_IV';
    throw badIv;
  }
  var exp = __bn_aes_expand(keyBytes);
  var prev = [];
  var i;
  for (i = 0; i < 16; i++) prev.push(ivBytes[i] & 255);
  var pending = [];
  var autoPad = true;
  var done = false;
  function transform(chunk) {
    var out = [];
    var off;
    for (off = 0; off < chunk.length; off += 16) {
      var block = [];
      for (i = 0; i < 16; i++) block.push(chunk[off + i] & 255);
      if (encrypt) {
        for (i = 0; i < 16; i++) block[i] = (block[i] ^ prev[i]) & 255;
        block = __bn_aes_encrypt_block(block, exp);
        prev = block.slice();
        for (i = 0; i < 16; i++) out.push(block[i]);
      } else {
        var plain = __bn_aes_decrypt_block(block, exp);
        for (i = 0; i < 16; i++) out.push((plain[i] ^ prev[i]) & 255);
        prev = block.slice();
      }
    }
    return out;
  }
  function pull(data, inEnc) {
    var bytes = typeof data === 'string' ? __bn_as_bytes(data, inEnc || 'utf8') : __bn_as_bytes(data);
    for (var n = 0; n < bytes.length; n++) pending.push(bytes[n] & 255);
  }
  return {
    setAutoPadding: function(on) { autoPad = on !== false; return this; },
    update: function(data, a, b) {
      if (done) throw new Error('Cipher update after final');
      var inEnc = typeof data === 'string' ? (typeof a === 'string' ? a : 'utf8') : null;
      var outEnc = typeof data === 'string' ? (typeof b === 'string' ? b : null) : (typeof a === 'string' ? a : null);
      pull(data, inEnc);
      var ready = pending.length - (pending.length % 16);
      if (!encrypt && ready === pending.length && ready >= 16) ready -= 16;
      var chunk = pending.splice(0, ready);
      return __bn_aes_out(transform(chunk), outEnc);
    },
    final: function(outEnc) {
      if (done) throw new Error('Cipher final already called');
      done = true;
      if (encrypt) {
        if (autoPad) {
          var n = 16 - (pending.length % 16);
          for (i = 0; i < n; i++) pending.push(n);
        } else if (pending.length % 16) {
          var bad = new Error('Invalid plaintext length');
          bad.code = 'ERR_CRYPTO_INVALID_PADDING';
          throw bad;
        }
        return __bn_aes_out(transform(pending.splice(0, pending.length)), outEnc);
      }
      if (pending.length % 16) {
        var odd = new Error('Invalid ciphertext length');
        odd.code = 'ERR_CRYPTO_INVALID_PADDING';
        throw odd;
      }
      var plain = transform(pending.splice(0, pending.length));
      if (autoPad) {
        if (!plain.length) {
          var empty = new Error('Invalid padding');
          empty.code = 'ERR_OSSL_WRONG_FINAL_BLOCK_LENGTH';
          throw empty;
        }
        var pad = plain[plain.length - 1];
        if (pad < 1 || pad > 16 || pad > plain.length) {
          var badPad = new Error('Invalid padding');
          badPad.code = 'ERR_OSSL_BAD_DECRYPT';
          throw badPad;
        }
        plain.length -= pad;
      }
      return __bn_aes_out(plain, outEnc);
    }
  };
}

function __bn_load_crypto() {
  return {
    randomFillSync: function(buf, offset, size) {
      offset = offset == null ? 0 : offset | 0;
      var fillInto, i;
      if (Buffer.isBuffer && Buffer.isBuffer(buf)) {
        size = size == null ? buf.length - offset : size | 0;
        if (offset < 0 || size < 0 || offset + size > buf.length) throw new RangeError('randomFillSync: out of range');
        fillInto = new Uint8Array(size);
        __bn_crypto_random_fill(fillInto);
        // Buffer._data is a plain array — no TypedArray.set
        for (i = 0; i < size; i++) buf._data[offset + i] = fillInto[i] & 255;
        return buf;
      }
      if (buf instanceof Uint8Array) {
        size = size == null ? buf.length - offset : size | 0;
        if (offset < 0 || size < 0 || offset + size > buf.length) throw new RangeError('randomFillSync: out of range');
        fillInto = new Uint8Array(size);
        __bn_crypto_random_fill(fillInto);
        for (i = 0; i < size; i++) buf[offset + i] = fillInto[i] & 255;
        return buf;
      }
      throw new TypeError('randomFillSync: expected Buffer or Uint8Array');
    },
    randomBytes: function(n) {
      n = n | 0;
      if (n < 0) throw new RangeError('n must be >= 0');
      var u8 = new Uint8Array(n);
      __bn_crypto_random_fill(u8);
      return Buffer.from(u8);
    },
    randomInt: function(min, max, cb) {
      if (typeof max === 'function') {
        cb = max;
        max = min;
        min = 0;
      } else if (typeof max === 'undefined') {
        max = min;
        min = 0;
      }
      function bad(msg) {
        var err = new RangeError(msg);
        err.code = 'ERR_OUT_OF_RANGE';
        throw err;
      }
      if (typeof min !== 'number' || typeof max !== 'number' || min !== min || max !== max) bad('min and max must be numbers');
      if (Math.floor(min) !== min || Math.floor(max) !== max) bad('min and max must be integers');
      if (max <= min) bad('max must be greater than min');
      var range = max - min;
      if (range > 281474976710655) bad('range must be at most 2^48 - 1');
      var nbytes = 1;
      var space = 256;
      while (space < range && nbytes < 6) {
        nbytes++;
        space *= 256;
      }
      var limit = space - (space % range);
      var n;
      do {
        var u8 = new Uint8Array(nbytes);
        __bn_crypto_random_fill(u8);
        n = 0;
        for (var i = 0; i < nbytes; i++) n = n * 256 + (u8[i] & 255);
      } while (n >= limit);
      var value = min + (n % range);
      if (typeof cb === 'function') cb(null, value);
      return value;
    },
    randomUUID: function() {
      var bytes = new Uint8Array(16);
      __bn_crypto_random_fill(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var hex = '';
      var i;
      for (i = 0; i < 16; i++) hex += (bytes[i] + 256).toString(16).slice(1);
      return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    },
    pbkdf2Sync: function(password, salt, iterations, keylen, digest) {
      return Buffer.from(__bn_pbkdf2(digest || 'sha1', password, salt, iterations, keylen));
    },
    pbkdf2: function(password, salt, iterations, keylen, digest, cb) {
      if (typeof digest === 'function') {
        cb = digest;
        digest = 'sha1';
      }
      var err = null;
      var out = null;
      try {
        out = this.pbkdf2Sync(password, salt, iterations, keylen, digest);
      } catch (e) {
        err = e;
      }
      if (typeof cb === 'function') cb(err, out);
    },
    createHash: function(alg) {
      alg = String(alg || '').toLowerCase().replace(/^sha-/, 'sha');
      if (alg !== 'sha1' && alg !== 'sha256' && alg !== 'sha384' && alg !== 'sha512') {
        throw new Error('createHash: unsupported algorithm ' + alg + ' (supported: sha1, sha256, sha384, sha512)');
      }
      var chunks = [];
      return {
        update: function(data, enc) {
          if (typeof data === 'string') chunks.push(Buffer._encode(data, enc || 'utf8'));
          else if (Buffer.isBuffer && Buffer.isBuffer(data)) chunks.push(data._data);
          else if (data instanceof Uint8Array) chunks.push(data);
          else chunks.push(Buffer._encode(String(data), 'utf8'));
          return this;
        },
        digest: function(enc) {
          var len = 0, i, j, o = 0, p;
          for (i = 0; i < chunks.length; i++) len += chunks[i].length;
          var all = new Uint8Array(len);
          for (j = 0; j < chunks.length; j++) {
            var ch = chunks[j];
            for (p = 0; p < ch.length; p++) all[o++] = ch[p] & 255;
          }
          var dig;
          if (alg === 'sha1') dig = __bn_sha1(all);
          else if (alg === 'sha256') dig = __bn_sha256(all);
          else if (alg === 'sha384') dig = __bn_sha512(all, 384);
          else dig = __bn_sha512(all, 512);
          if (enc === 'hex') {
            var h = '';
            for (var k = 0; k < dig.length; k++) h += (dig[k] + 256).toString(16).slice(1);
            return h;
          }
          return Buffer.from(dig);
        }
      };
    },
    createHmac: function(alg, key) {
      alg = __bn_norm_hash(alg);
      if (!__bn_hash_ok(alg)) {
        throw new Error('createHmac: unsupported algorithm ' + alg + ' (supported: sha1, sha256, sha384, sha512)');
      }
      if (key == null) throw new TypeError('createHmac: key required');
      var keyBytes = __bn_as_bytes(key, 'utf8');
      var chunks = [];
      var done = false;
      return {
        update: function(data, enc) {
          if (done) throw new Error('Digest already called');
          chunks.push(__bn_as_bytes(data, enc || 'utf8'));
          return this;
        },
        digest: function(enc) {
          if (done) throw new Error('Digest already called');
          done = true;
          var dig = __bn_hmac(alg, keyBytes, __bn_join_bytes(chunks));
          if (enc === 'hex') return __bn_hex_bytes(dig);
          return Buffer.from(dig);
        }
      };
    },
    timingSafeEqual: function(a, b) {
      if (typeof a === 'string' || typeof b === 'string') throw new TypeError('timingSafeEqual: expected buffers');
      var aa = __bn_as_bytes(a);
      var bb = __bn_as_bytes(b);
      if (aa.length !== bb.length) {
        var err = new Error('Input buffers must have the same byte length');
        err.code = 'ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH';
        throw err;
      }
      var diff = 0;
      for (var i = 0; i < aa.length; i++) diff |= (aa[i] ^ bb[i]) & 255;
      return diff === 0;
    },
    getHashes: function() { return ['sha1', 'sha256', 'sha384', 'sha512']; },
    getCiphers: function() { return ['aes-128-cbc', 'aes-192-cbc', 'aes-256-cbc']; },
    createCipheriv: function(alg, key, iv) { return __bn_make_cipher(alg, key, iv, true); },
    createDecipheriv: function(alg, key, iv) { return __bn_make_cipher(alg, key, iv, false); }
  };
}

function __bn_load_perf_hooks() {
  var nowFn = function() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
    return Date.now();
  };
  function PerformanceObserver() {}
  PerformanceObserver.prototype.observe = function() {};
  PerformanceObserver.prototype.disconnect = function() {};
  return { performance: { now: nowFn, timeOrigin: 0 }, PerformanceObserver: PerformanceObserver, constants: {} };
}

function __bn_load_stream() {
  var EE = loadCore('events').EventEmitter;
  function Readable(opts) {
    EE.call(this);
    this._readableState = { ended: false, flowing: null };
    this.readable = true;
    this._buf = [];
    this._pendingEnd = false;
    if (opts && typeof opts.read === 'function') this._read = opts.read;
  }
  Readable.prototype = Object.create(EE.prototype);
  Readable.prototype._read = function() {};
  Readable.prototype.push = function(chunk) {
    if (chunk === null) {
      this._readableState.ended = true;
      if (this._readableState.flowing) this.emit('end');
      else this._pendingEnd = true;
      return false;
    }
    if (typeof chunk === 'string') chunk = Buffer.from(chunk);
    if (this._readableState.flowing) this.emit('data', chunk);
    else this._buf.push(chunk);
    return true;
  };
  Readable.prototype.read = function() {
    if (!this._buf.length) return null;
    return this._buf.shift();
  };
  Readable.prototype.on = function(ev, fn) {
    EE.prototype.on.call(this, ev, fn);
    if (ev === 'data') {
      this._readableState.flowing = true;
      while (this._buf.length) this.emit('data', this._buf.shift());
      if (this._pendingEnd) {
        this._pendingEnd = false;
        this.emit('end');
      }
    }
    return this;
  };
  Readable.prototype.pipe = function(dest) {
    this.on('data', function(chunk) {
      if (dest.write) dest.write(chunk);
      else if (typeof dest === 'function') dest(chunk);
    });
    this.on('end', function() {
      if (dest.end) dest.end();
      else if (dest.emit) dest.emit('finish');
    });
    if (typeof this._read === 'function') {
      try { this._read(0); } catch (e) {}
    }
    return dest;
  };
  Readable.prototype.destroy = function(err) {
    if (err) this.emit('error', err);
    this.emit('close');
    return this;
  };
  function Writable(opts) {
    EE.call(this);
    this.writable = true;
    this._chunks = [];
    if (opts && typeof opts.write === 'function') this._write = opts.write;
  }
  Writable.prototype = Object.create(EE.prototype);
  Writable.prototype._write = function(chunk, enc, cb) { if (cb) cb(); };
  Writable.prototype.write = function(chunk, enc, cb) {
    if (typeof enc === 'function') { cb = enc; enc = undefined; }
    if (typeof chunk === 'string') chunk = Buffer.from(chunk, enc || 'utf8');
    this._chunks.push(chunk);
    var self = this;
    this._write(chunk, enc || 'utf8', function(err) {
      if (err) self.emit('error', err);
      if (cb) cb(err);
    });
    return true;
  };
  Writable.prototype.end = function(chunk, enc, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; }
    else if (typeof enc === 'function') { cb = enc; enc = undefined; }
    if (chunk != null) this.write(chunk, enc);
    this.emit('finish');
    if (cb) cb();
    return this;
  };
  function Duplex(opts) {
    Readable.call(this, opts);
    this.writable = true;
    this._chunks = [];
    if (opts && typeof opts.write === 'function') this._write = opts.write;
  }
  Duplex.prototype = Object.create(Readable.prototype);
  Duplex.prototype._write = Writable.prototype._write;
  Duplex.prototype.write = Writable.prototype.write;
  Duplex.prototype.end = Writable.prototype.end;
  Duplex.prototype.constructor = Duplex;
  function Transform(opts) {
    Duplex.call(this, opts);
    if (opts && typeof opts.transform === 'function') this._transform = opts.transform;
  }
  Transform.prototype = Object.create(Duplex.prototype);
  Transform.prototype._transform = function(chunk, enc, cb) { this.push(chunk); if (cb) cb(); };
  Transform.prototype.write = function(chunk, enc, cb) {
    var self = this;
    if (typeof enc === 'function') { cb = enc; enc = undefined; }
    this._transform(chunk, enc || 'utf8', function(err, out) {
      if (err) { self.emit('error', err); if (cb) cb(err); return; }
      if (out != null) self.push(out);
      if (cb) cb();
    });
    return true;
  };
  Transform.prototype.end = function(chunk, enc, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; }
    else if (typeof enc === 'function') { cb = enc; enc = undefined; }
    if (chunk != null) this.write(chunk, enc);
    this.push(null);
    this.emit('finish');
    if (cb) cb();
    return this;
  };
  function PassThrough(opts) { Transform.call(this, opts); }
  PassThrough.prototype = Object.create(Transform.prototype);
  function finished(stream, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = undefined; }
    if (typeof cb !== 'function') cb = function() {};
    var done = false;
    function end(err) {
      if (done) return;
      done = true;
      cb(err);
    }
    if (stream && typeof stream.on === 'function') {
      stream.on('finish', function() { end(); });
      stream.on('end', function() { end(); });
      stream.on('close', function() { end(); });
      stream.on('error', function(err) { end(err || new Error('stream error')); });
    } else end();
    return stream;
  }
  function pipeline() {
    var args = Array.prototype.slice.call(arguments);
    var userCb = typeof args[args.length - 1] === 'function' ? args.pop() : function() {};
    var settled = false;
    function cb(err) {
      if (settled) return;
      settled = true;
      userCb(err);
    }
    if (!args.length) {
      cb(new Error('pipeline: no streams'));
      return null;
    }
    var i;
    for (i = 0; i < args.length - 1; i++) {
      var src = args[i];
      var dest = args[i + 1];
      if (src && typeof src.on === 'function') src.on('error', cb);
      if (src && typeof src.pipe === 'function') src.pipe(dest);
    }
    var last = args[args.length - 1];
    if (last && typeof last.on === 'function') last.on('error', cb);
    finished(last, function(err) { cb(err); });
    return last;
  }
  Readable.from = function(iterable) {
    var r = new Readable();
    setTimeout(function() {
      try {
        if (typeof iterable === 'string' || (Buffer.isBuffer && Buffer.isBuffer(iterable)) || iterable instanceof Uint8Array) {
          r.push(iterable);
        } else if (Array.isArray(iterable)) {
          for (var i = 0; i < iterable.length; i++) r.push(iterable[i]);
        }
        r.push(null);
      } catch (e) { r.emit('error', e); }
    }, 0);
    return r;
  };
  return {
    Readable: Readable,
    Writable: Writable,
    Duplex: Duplex,
    Transform: Transform,
    PassThrough: PassThrough,
    pipeline: pipeline,
    finished: finished
  };
}

function __bn_load_util() {
  function promisify(fn) {
    return function() {
      var args = Array.prototype.slice.call(arguments);
      var self = this;
      return new Promise(function(resolve, reject) {
        args.push(function(err, result) {
          if (err) reject(err);
          else resolve(result);
        });
        try { fn.apply(self, args); } catch (e) { reject(e); }
      });
    };
  }
  function callbackify(fn) {
    return function() {
      var args = Array.prototype.slice.call(arguments);
      var cb = typeof args[args.length - 1] === 'function' ? args.pop() : function() {};
      var self = this;
      Promise.resolve().then(function() { return fn.apply(self, args); }).then(
        function(r) { cb(null, r); },
        function(e) { cb(e); }
      );
    };
  }
  function inspect(v, depth) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'function') return '[Function' + (v.name ? ': ' + v.name : '') + ']';
    if (Buffer.isBuffer && Buffer.isBuffer(v)) {
      var hex = v.toString('hex');
      var parts = [];
      for (var i = 0; i < hex.length; i += 2) parts.push(hex.substr(i, 2));
      return '<Buffer' + (parts.length ? ' ' + parts.join(' ') : '') + '>';
    }
    if (depth > 4) return Array.isArray(v) ? '[Array]' : '[Object]';
    if (Array.isArray(v)) {
      var items = [];
      for (var ai = 0; ai < v.length; ai++) items.push(inspect(v[ai], depth + 1));
      return '[' + items.join(', ') + ']';
    }
    if (typeof v === 'object') {
      var keys = Object.keys(v);
      if (!keys.length) return '{}';
      var fields = [];
      for (var ki = 0; ki < keys.length; ki++) fields.push(keys[ki] + ': ' + inspect(v[keys[ki]], depth + 1));
      return '{ ' + fields.join(', ') + ' }';
    }
    return String(v);
  }
  function formatValue(v) {
    if (typeof v === 'string') return v;
    if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return String(v);
    return inspect(v, 0);
  }
  return {
    inherits: function(c, s) { c.prototype = Object.create(s.prototype); c.prototype.constructor = c; },
    format: function() {
      var args = Array.prototype.slice.call(arguments);
      if (!args.length) return '';
      if (typeof args[0] !== 'string') {
        var plain = [];
        for (var pi = 0; pi < args.length; pi++) plain.push(formatValue(args[pi]));
        return plain.join(' ');
      }
      var f = args.shift();
      var out = f.replace(/%[sdij%]/g, function(x) {
        if (x === '%%') return '%';
        if (!args.length) return x;
        var v = args.shift();
        if (x === '%s') return formatValue(v);
        if (x === '%d') return String(Number(v));
        if (x === '%i') return String(parseInt(v, 10));
        if (x === '%j') {
          try { return JSON.stringify(v); } catch (e) { return '[Circular]'; }
        }
        return x;
      });
      if (args.length) {
        var extra = [];
        for (var ei = 0; ei < args.length; ei++) extra.push(formatValue(args[ei]));
        out += ' ' + extra.join(' ');
      }
      return out;
    },
    inspect: function(v) { return inspect(v, 0); },
    promisify: promisify,
    callbackify: callbackify,
    deprecate: function(fn) { return fn; },
    isDeepStrictEqual: function(a, b) {
      try {
        loadCore('assert').deepStrictEqual(a, b);
        return true;
      } catch (e) {
        return false;
      }
    },
    types: {
      isPromise: function(v) { return !!v && typeof v.then === 'function'; },
      isDate: function(v) { return v instanceof Date; },
      isRegExp: function(v) { return v instanceof RegExp; },
      isMap: function(v) { return typeof Map !== 'undefined' && v instanceof Map; },
      isSet: function(v) { return typeof Set !== 'undefined' && v instanceof Set; },
      isArrayBuffer: function(v) { return typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer; },
      isTypedArray: function(v) { return typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(v) && !(v instanceof DataView); },
      isUint8Array: function(v) { return v instanceof Uint8Array; },
      isBuffer: function(v) { return !!(Buffer.isBuffer && Buffer.isBuffer(v)); }
    }
  };
}

function __bn_load_string_decoder() {
  function decoderBytes(buf) {
    if (typeof buf === 'string') return Buffer._encode(buf, 'utf8');
    if (Buffer.isBuffer && Buffer.isBuffer(buf)) return buf._data.slice();
    if (typeof Uint8Array !== 'undefined' && buf instanceof Uint8Array) {
      var copy = [];
      for (var i = 0; i < buf.length; i++) copy.push(buf[i] & 255);
      return copy;
    }
    return Buffer._encode(String(buf == null ? '' : buf), 'utf8');
  }
  function completeEnd(bytes) {
    var n = bytes.length;
    if (!n) return n;
    var last = bytes[n - 1] & 255;
    if ((last & 128) === 0) return n;
    var i = n - 1;
    var seen = 1;
    while (i > 0 && (bytes[i] & 192) === 128 && seen < 4) {
      i--;
      seen++;
    }
    var lead = bytes[i] & 255;
    var expect = 1;
    if ((lead & 224) === 192) expect = 2;
    else if ((lead & 240) === 224) expect = 3;
    else if ((lead & 248) === 240) expect = 4;
    if (n - i < expect) return i;
    return n;
  }
  function StringDecoder(encoding) {
    this.encoding = String(encoding || 'utf8').toLowerCase();
    this._held = [];
  }
  StringDecoder.prototype.write = function(buf) {
    var bytes = decoderBytes(buf);
    if (this.encoding !== 'utf8' && this.encoding !== 'utf-8') {
      return Buffer.from(bytes).toString(this.encoding);
    }
    var all = this._held.concat(bytes);
    var cut = completeEnd(all);
    this._held = all.slice(cut);
    if (!cut) return '';
    return Buffer.from(all.slice(0, cut)).toString('utf8');
  };
  StringDecoder.prototype.end = function(buf) {
    var extra = buf != null && buf !== '' ? this.write(buf) : '';
    var rest = this._held;
    this._held = [];
    if (!rest.length) return extra;
    return extra + String.fromCharCode(0xFFFD);
  };
  return { StringDecoder: StringDecoder };
}

function __bn_load_timers_promises() {
  return {
    setTimeout: function(ms, value) {
      return new Promise(function(resolve) { setTimeout(function() { resolve(value); }, ms | 0); });
    },
    setImmediate: function(value) {
      return new Promise(function(resolve) { setTimeout(function() { resolve(value); }, 0); });
    },
    scheduler: {
      wait: function(ms) {
        return new Promise(function(resolve) { setTimeout(resolve, ms | 0); });
      }
    }
  };
}

/* ---- zlib pure stored-block DEFLATE (from node-polyfills / zlib-pure) ---- */
function __bn_concat_u8(chunks) {
  var n = 0, i, j, o = 0;
  for (i = 0; i < chunks.length; i++) n += chunks[i].length;
  var out = new Uint8Array(n);
  for (i = 0; i < chunks.length; i++) {
    var c = chunks[i];
    for (j = 0; j < c.length; j++) out[o++] = c[j] & 255;
  }
  return out;
}
function __bn_to_u8(data) {
  var i, arr;
  if (Buffer.isBuffer && Buffer.isBuffer(data)) {
    arr = data._data || [];
    var u = new Uint8Array(arr.length);
    for (i = 0; i < arr.length; i++) u[i] = arr[i] & 255;
    return u;
  }
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (typeof Uint8Array !== 'undefined' && data instanceof Uint8Array) return data;
  if (data && typeof data.byteLength === 'number' && typeof data.byteOffset === 'number' && data.buffer) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === 'string') {
    arr = Buffer._encode(data, 'utf8');
    var u2 = new Uint8Array(arr.length);
    for (i = 0; i < arr.length; i++) u2[i] = arr[i] & 255;
    return u2;
  }
  if (data && typeof data.length === 'number') {
    var u3 = new Uint8Array(data.length);
    for (i = 0; i < data.length; i++) u3[i] = data[i] & 255;
    return u3;
  }
  return new Uint8Array(0);
}
function __bn_crc32_table() {
  if (__bn_crc32_table._t) return __bn_crc32_table._t;
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  __bn_crc32_table._t = t;
  return t;
}
function __bn_crc32(buf) {
  var table = __bn_crc32_table();
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function __bn_adler32(buf) {
  var a = 1, b = 0;
  for (var i = 0; i < buf.length; i++) { a = (a + buf[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
function __bn_deflate_stored(data) {
  if (data.length === 0) return new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff]);
  var chunks = [], offset = 0, j;
  while (offset < data.length) {
    var take = Math.min(65535, data.length - offset);
    var isLast = offset + take >= data.length;
    var block = new Uint8Array(5 + take);
    block[0] = isLast ? 0x01 : 0x00;
    block[1] = take & 0xff; block[2] = (take >>> 8) & 0xff;
    var nlen = (~take) & 0xffff;
    block[3] = nlen & 0xff; block[4] = (nlen >>> 8) & 0xff;
    for (j = 0; j < take; j++) block[5 + j] = data[offset + j] & 255;
    chunks.push(block);
    offset += take;
  }
  return __bn_concat_u8(chunks);
}
function __bn_inflate_stored(deflateData) {
  var out = [], i = 0;
  while (i < deflateData.length) {
    var hdr = deflateData[i++];
    var bfinal = hdr & 1;
    var btype = (hdr >>> 1) & 3;
    if (btype !== 0) throw new Error('zlib-pure: only stored DEFLATE blocks supported');
    var len = deflateData[i] | (deflateData[i + 1] << 8);
    var nlen = deflateData[i + 2] | (deflateData[i + 3] << 8);
    i += 4;
    if (((len ^ 0xffff) & 0xffff) !== nlen) throw new Error('zlib-pure: invalid NLEN');
    for (var j = 0; j < len; j++) out.push(deflateData[i++]);
    if (bfinal) break;
  }
  return new Uint8Array(out);
}
function __bn_copy_into(dst, dstOff, src) {
  for (var i = 0; i < src.length; i++) dst[dstOff + i] = src[i] & 255;
}
function __bn_slice_u8(src, start, end) {
  start = start | 0;
  end = end == null ? src.length : end | 0;
  if (start < 0) start = 0;
  if (end > src.length) end = src.length;
  var n = end - start;
  if (n < 0) n = 0;
  var out = new Uint8Array(n);
  for (var i = 0; i < n; i++) out[i] = src[start + i] & 255;
  return out;
}
function __bn_zlib_pure(op, data) {
  var u8 = __bn_to_u8(data);
  if (op === 'gzip') {
    var body = __bn_deflate_stored(u8);
    var out = new Uint8Array(10 + body.length + 8);
    out[0] = 0x1f; out[1] = 0x8b; out[2] = 8; out[9] = 0xff;
    __bn_copy_into(out, 10, body);
    var crc = __bn_crc32(u8), isize = u8.length >>> 0, t = 10 + body.length;
    out[t] = crc & 255; out[t + 1] = (crc >>> 8) & 255; out[t + 2] = (crc >>> 16) & 255; out[t + 3] = (crc >>> 24) & 255;
    out[t + 4] = isize & 255; out[t + 5] = (isize >>> 8) & 255; out[t + 6] = (isize >>> 16) & 255; out[t + 7] = (isize >>> 24) & 255;
    return out;
  }
  if (op === 'gunzip') {
    if (u8.length < 18 || u8[0] !== 0x1f || u8[1] !== 0x8b) throw new Error('zlib-pure: not gzip');
    var flg = u8[3], i = 10;
    if (flg & 4) { var xlen = u8[i] | (u8[i + 1] << 8); i += 2 + xlen; }
    if (flg & 8) { while (i < u8.length && u8[i++] !== 0) {} }
    if (flg & 16) { while (i < u8.length && u8[i++] !== 0) {} }
    if (flg & 2) i += 2;
    return __bn_inflate_stored(__bn_slice_u8(u8, i, u8.length - 8));
  }
  if (op === 'deflate') {
    var body2 = __bn_deflate_stored(u8);
    var out2 = new Uint8Array(2 + body2.length + 4);
    out2[0] = 0x78; out2[1] = 0x01;
    __bn_copy_into(out2, 2, body2);
    var ad = __bn_adler32(u8), t2 = 2 + body2.length;
    out2[t2] = (ad >>> 24) & 255; out2[t2 + 1] = (ad >>> 16) & 255; out2[t2 + 2] = (ad >>> 8) & 255; out2[t2 + 3] = ad & 255;
    return out2;
  }
  if (op === 'inflate') return __bn_inflate_stored(__bn_slice_u8(u8, 2, u8.length - 4));
  throw new Error('zlib-pure: unknown op ' + op);
}
function __bn_load_zlib() {
  function u8ToBuffer(u8) {
    var a = [], i;
    if (!u8) return Buffer.from([]);
    for (i = 0; i < u8.length; i++) a.push(u8[i] & 255);
    return Buffer.from(a);
  }
  function syncViaHost(op, data) {
    if (typeof __bn.zlibSync === 'function') return u8ToBuffer(__bn.zlibSync(op, __bn_to_u8(data)));
    return u8ToBuffer(__bn_zlib_pure(op, data));
  }
  function wrapStream(op) {
    var Transform = loadCore('stream').Transform;
    var t = new Transform();
    var chunks = [];
    t._transform = function(chunk, enc, cb) {
      chunks.push(__bn_to_u8(chunk));
      if (cb) cb();
    };
    t.end = function(chunk, enc, cb) {
      if (typeof chunk === 'function') { cb = chunk; chunk = undefined; }
      if (chunk != null) chunks.push(__bn_to_u8(chunk));
      try {
        t.push(syncViaHost(op, __bn_concat_u8(chunks)));
        t.push(null);
      } catch (e) { t.emit('error', e); }
      if (cb) cb();
      return t;
    };
    return t;
  }
  return {
    gzipSync: function(data) { return syncViaHost('gzip', data); },
    gunzipSync: function(data) { return syncViaHost('gunzip', data); },
    deflateSync: function(data) { return syncViaHost('deflate', data); },
    inflateSync: function(data) { return syncViaHost('inflate', data); },
    createGzip: function() { return wrapStream('gzip'); },
    createGunzip: function() { return wrapStream('gunzip'); },
    createDeflate: function() { return wrapStream('deflate'); },
    createInflate: function() { return wrapStream('inflate'); }
  };
}

var __bn_http_status = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable'
};
function __bn_register_http(which) {
  var EE = loadCore('events').EventEmitter;
  function Server(handler) {
    EE.call(this);
    this._handler = handler;
    this._upgradeListeners = [];
  }
  Server.prototype = Object.create(EE.prototype);
  Server.prototype.on = function(ev, fn) {
    if (ev === 'upgrade') this._upgradeListeners.push(fn);
    return EE.prototype.on.call(this, ev, fn);
  };
  Server.prototype.listen = function(port, cb) {
    var self = this;
    var h = this._handler || function(req, res) { self.emit('request', req, res); };
    __bn.registerHttp(port | 0, function(req, res) {
      var bodyParts = [];
      var status = 200;
      var headers = {};
      var ended = false;
      var nodeRes = {
        statusCode: 200,
        statusMessage: '',
        headersSent: false,
        setHeader: function(k, v) { headers[String(k).toLowerCase()] = v; return this; },
        getHeader: function(k) { return headers[String(k).toLowerCase()]; },
        removeHeader: function(k) { delete headers[String(k).toLowerCase()]; },
        hasHeader: function(k) { return Object.prototype.hasOwnProperty.call(headers, String(k).toLowerCase()); },
        getHeaders: function() {
          var copy = {};
          for (var key in headers) if (Object.prototype.hasOwnProperty.call(headers, key)) copy[key] = headers[key];
          return copy;
        },
        writeHead: function(code, reason, hds) {
          status = code | 0;
          this.statusCode = status;
          this.headersSent = true;
          if (typeof reason === 'string') {
            this.statusMessage = reason;
          } else {
            hds = reason;
            if (!this.statusMessage) this.statusMessage = __bn_http_status[status] || '';
          }
          if (hds) for (var k in hds) if (Object.prototype.hasOwnProperty.call(hds, k)) headers[String(k).toLowerCase()] = hds[k];
          return this;
        },
        write: function(chunk) {
          bodyParts.push(String(chunk == null ? '' : chunk));
          return true;
        },
        end: function(chunk) {
          if (ended) return;
          if (chunk != null) bodyParts.push(String(chunk));
          ended = true;
          if (!this.headersSent) {
            status = this.statusCode || 200;
            if (!this.statusMessage) this.statusMessage = __bn_http_status[status] || '';
          }
          res.writeHead(status, headers);
          if (this.statusMessage && res) res.statusMessage = this.statusMessage;
          res.end(bodyParts.join(''));
        }
      };
      var rawBody = req.body == null ? '' : String(req.body);
      var nodeReq = {
        method: req.method || 'GET',
        url: req.url || '/',
        headers: req.headers || {},
        httpVersion: '1.1',
        upgrade: false,
        on: function(ev, fn) {
          if (typeof fn === 'function') {
            if (ev === 'data' && rawBody) fn(rawBody);
            if (ev === 'end') fn();
          }
          return nodeReq;
        }
      };
      try { h(nodeReq, nodeRes); }
      catch (e) { nodeRes.writeHead(500, { 'Content-Type': 'text/plain' }); nodeRes.end(String(e)); }
      var up = String((req.headers && req.headers.upgrade) || '').toLowerCase();
      if (self._upgradeListeners.length && up === 'websocket') {
        for (var i = 0; i < self._upgradeListeners.length; i++) {
          try {
            self._upgradeListeners[i](nodeReq, { write: function() {}, end: function() {} }, Buffer.from([]));
          } catch (e2) {}
        }
      }
    });
    if (typeof cb === 'function') setTimeout(cb, 0);
    return self;
  };
  function IncomingMessage(parsed) {
    var Readable = loadCore('stream').Readable;
    Readable.call(this);
    this.statusCode = parsed && parsed.status != null ? (parsed.status | 0) : 0;
    this.statusMessage = parsed && parsed.statusMessage ? String(parsed.statusMessage) : (__bn_http_status[this.statusCode] || '');
    this.httpVersion = '1.1';
    this.headers = {};
    var h = (parsed && parsed.headers) || {};
    for (var k in h) {
      if (Object.prototype.hasOwnProperty.call(h, k)) this.headers[String(k).toLowerCase()] = String(h[k]);
    }
    this._body = parsed && parsed.body != null ? String(parsed.body) : '';
  }
  var ReadableP = loadCore('stream').Readable;
  IncomingMessage.prototype = Object.create(ReadableP.prototype);
  function deliver(res) {
    if (res._body) res.push(res._body);
    res.push(null);
  }
  function ClientRequest(opts, cb) {
    EE.call(this);
    this._opts = opts || {};
    this._cb = cb;
    this._headers = {};
    var h = this._opts.headers || {};
    for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k)) this._headers[k] = h[k];
    this._body = [];
  }
  ClientRequest.prototype = Object.create(EE.prototype);
  ClientRequest.prototype.setHeader = function(k, v) { this._headers[k] = v; return this; };
  ClientRequest.prototype.write = function(chunk) {
    this._body.push(chunk == null ? '' : String(chunk));
    return true;
  };
  ClientRequest.prototype.end = function(chunk) {
    if (chunk != null) this.write(chunk);
    var opts = this._opts;
    var host = String(opts.hostname || opts.host || '127.0.0.1');
    var colon = host.indexOf(':');
    if (colon >= 0 && host.charAt(0) !== '[') host = host.slice(0, colon);
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      this.emit('error', new Error(which + '.request: only virtual localhost is available'));
      return this;
    }
    var port = opts.port | 0;
    var path = opts.path || '/';
    var method = String(opts.method || 'GET').toUpperCase();
    var raw = '';
    try {
      raw = __bn.httpDispatch ? __bn.httpDispatch(port, method, path, JSON.stringify(this._headers), this._body.join('')) : '';
    } catch (err) {
      this.emit('error', err);
      return this;
    }
    if (!raw) {
      var refused = new Error('connect ECONNREFUSED 127.0.0.1:' + port);
      refused.code = 'ECONNREFUSED';
      this.emit('error', refused);
      return this;
    }
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (err2) { this.emit('error', err2); return this; }
    var res = new IncomingMessage(parsed);
    if (typeof this._cb === 'function') this._cb(res);
    this.emit('response', res);
    deliver(res);
    return this;
  };
  function parseTarget(url, options, cb) {
    if (url && typeof url === 'object') {
      cb = typeof options === 'function' ? options : cb;
      options = url;
      url = null;
    } else if (typeof options === 'function') {
      cb = options;
      options = {};
    }
    options = Object.assign({}, options || {});
    if (typeof url === 'string') {
      var rest = url;
      var proto = rest.indexOf('://');
      if (proto >= 0) rest = rest.slice(proto + 3);
      var slash = rest.indexOf('/');
      var authority = slash >= 0 ? rest.slice(0, slash) : rest;
      var path = slash >= 0 ? rest.slice(slash) : '/';
      var hostname = authority;
      var port = '';
      var c = authority.lastIndexOf(':');
      if (c > 0 && authority.charAt(0) !== '[') {
        hostname = authority.slice(0, c);
        port = authority.slice(c + 1);
      }
      if (!options.hostname && !options.host) options.hostname = hostname;
      if (!options.port && port) options.port = port;
      if (!options.path) options.path = path || '/';
    }
    if (!options.method) options.method = 'GET';
    return { options: options, cb: cb };
  }
  return {
    createServer: function(handler) { return new Server(handler); },
    request: function(url, options, cb) {
      var spec = parseTarget(url, options, cb);
      return new ClientRequest(spec.options, spec.cb);
    },
    get: function(url, options, cb) {
      var spec = parseTarget(url, options, cb);
      spec.options.method = 'GET';
      var req = new ClientRequest(spec.options, spec.cb);
      req.end();
      return req;
    },
    STATUS_CODES: __bn_http_status
  };
}

/* Express-shaped router used when the npm package is not installed. */
function __bn_load_express() {
  var http = loadCore('http');
  function matchRoute(route, url) {
    var path = String(url || '/').split('?')[0];
    var rp = String(route).split('/');
    var up = path.split('/');
    if (rp.length !== up.length) return null;
    var params = {};
    for (var i = 0; i < rp.length; i++) {
      if (rp[i].charAt(0) === ':') params[rp[i].slice(1)] = up[i];
      else if (rp[i] !== up[i]) return null;
    }
    return params;
  }
  function decorate(res) {
    if (res.send) return res;
    var origEnd = res.end;
    res.end = function(body) {
      res.headersSent = true;
      return origEnd.call(this, body);
    };
    res.status = function(code) { this.statusCode = code | 0; return this; };
    res.send = function(body) {
      var obj = body && typeof body === 'object';
      var text = obj ? JSON.stringify(body) : String(body == null ? '' : body);
      this.writeHead(this.statusCode || 200, { 'Content-Type': obj ? 'application/json' : 'text/html; charset=utf-8' });
      this.end(text);
    };
    res.json = function(body) {
      this.writeHead(this.statusCode || 200, { 'Content-Type': 'application/json' });
      this.end(JSON.stringify(body));
    };
    return res;
  }
  function App() { this._stack = []; }
  App.prototype.use = function(fn) {
    this._stack.push({ method: '', route: '', fn: fn });
    return this;
  };
  ['get', 'post', 'put', 'patch', 'delete'].forEach(function(method) {
    App.prototype[method] = function(route, fn) {
      this._stack.push({ method: method, route: String(route), fn: fn });
      return this;
    };
  });
  App.prototype.handle = function(req, res) {
    var stack = this._stack;
    var i = 0;
    decorate(res);
    req.path = String(req.url || '/').split('?')[0];
    function next(err) {
      if (res.headersSent) return;
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(String(err && err.message ? err.message : err));
        return;
      }
      var layer = stack[i++];
      if (!layer) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      var method = String(req.method || 'GET').toLowerCase();
      if (layer.method && layer.method !== method) return next();
      if (layer.route) {
        var params = matchRoute(layer.route, req.path);
        if (!params) return next();
        req.params = params;
      }
      try {
        if (layer.fn && layer.fn.length >= 3) layer.fn(req, res, next);
        else layer.fn(req, res);
      } catch (e) {
        next(e);
      }
      if (!res.headersSent && (!layer.fn || layer.fn.length < 3)) next();
    }
    next();
  };
  App.prototype.listen = function(port, cb) {
    var self = this;
    return http.createServer(function(req, res) { self.handle(req, res); }).listen(port, cb);
  };
  function express() { return new App(); }
  express.json = function() { return function(req, res, next) { if (next) next(); }; };
  express.urlencoded = express.json;
  express.static = function() { return function(req, res, next) { if (next) next(); }; };
  express.Router = function() { return new App(); };
  return express;
}

/* ---- loadCore override ---- */
function loadCore(name) {
  if (name === 'buffer') return { Buffer: Buffer };
  if (name === 'fs') {
    var __bn_fds = Object.create(null);
    var __bn_next_fd = 3;
    function __bn_fs_code(code, msg) {
      var e = new Error(msg || code); e.code = code; throw e;
    }
    function __bn_flag_mode(flags) {
      if (typeof flags === 'number') {
        var acc = flags & 3;
        return {
          read: acc !== 1,
          write: acc !== 0,
          append: (flags & 1024) !== 0,
          trunc: (flags & 512) !== 0,
          creat: (flags & 64) !== 0 || (flags & 512) !== 0
        };
      }
      var s = String(flags == null ? 'r' : flags);
      var plus = s.indexOf('+') >= 0;
      return {
        read: s.indexOf('r') >= 0 || plus,
        write: s.indexOf('w') >= 0 || s.indexOf('a') >= 0 || plus,
        append: s.indexOf('a') >= 0,
        trunc: s.indexOf('w') >= 0,
        creat: s.indexOf('w') >= 0 || s.indexOf('a') >= 0
      };
    }
    function __bn_read_all(path) {
      var b = __bn.readBytes ? __bn.readBytes(String(path)) : null;
      var arr = [];
      var i;
      if (b == null) {
        var t = __bn.readFile(String(path));
        if (t == null) return null;
        var enc = Buffer._encode(t, 'utf8');
        for (i = 0; i < enc.length; i++) arr.push(enc[i] & 255);
        return arr;
      }
      if (typeof ArrayBuffer !== 'undefined' && b instanceof ArrayBuffer) b = new Uint8Array(b);
      for (i = 0; i < b.length; i++) arr.push(b[i] & 255);
      return arr;
    }
    function __bn_fit_len(arr, len) {
      len = len == null ? 0 : len | 0;
      if (len < 0) __bn_fs_code('EINVAL', 'EINVAL');
      var out = arr.slice(0, len);
      while (out.length < len) out.push(0);
      return out;
    }
    function __bn_bytes_of(data, enc) {
      var encoding = 'utf8';
      if (typeof enc === 'string') encoding = enc;
      else if (enc && typeof enc.encoding === 'string') encoding = enc.encoding;
      if (typeof data === 'string') return Buffer._encode(data, encoding);
      if (Buffer.isBuffer && Buffer.isBuffer(data)) return (data._data || []).slice();
      var src = null;
      if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) src = new Uint8Array(data);
      else if (typeof Uint8Array !== 'undefined' && data instanceof Uint8Array) src = data;
      if (src) {
        var copy = [];
        for (var i = 0; i < src.length; i++) copy.push(src[i] & 255);
        return copy;
      }
      return Buffer._encode(String(data), encoding);
    }
    function __bn_write_all(path, arr) {
      var u8 = new Uint8Array(arr.length);
      for (var i = 0; i < arr.length; i++) u8[i] = arr[i] & 255;
      if (__bn.writeBytes) {
        if (!__bn.writeBytes(String(path), u8.buffer)) __bn_fs_code('EIO', 'EIO');
        return;
      }
      if (!__bn.writeFile(String(path), Buffer.from(u8).toString())) __bn_fs_code('EIO', 'EIO');
    }
    function Dirent(name, kind) {
      this.name = name;
      this._kind = kind || 'file';
    }
    Dirent.prototype.isFile = function() { return this._kind === 'file'; };
    Dirent.prototype.isDirectory = function() { return this._kind === 'dir'; };
    Dirent.prototype.isSymbolicLink = function() { return this._kind === 'symlink'; };
    Dirent.prototype.isBlockDevice = function() { return false; };
    Dirent.prototype.isCharacterDevice = function() { return false; };
    Dirent.prototype.isFIFO = function() { return false; };
    Dirent.prototype.isSocket = function() { return false; };
    function __bn_child_dirent(dir, name) {
      var full = String(dir) === '/' ? '/' + name : String(dir).replace(/\/$/, '') + '/' + name;
      var kind = __bn.lstatKind ? __bn.lstatKind(full) : (__bn.isDir(full) ? 'dir' : 'file');
      return new Dirent(name, kind || 'file');
    }
    var fs = {
      constants: {
        F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1,
        O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_TRUNC: 512, O_APPEND: 1024,
        S_IFMT: 61440, S_IFREG: 32768, S_IFDIR: 16384, S_IFLNK: 40960
      },
      readFileSync: function(p, enc) {
        var encoding = null;
        if (typeof enc === 'string') encoding = enc;
        else if (enc && Object.prototype.hasOwnProperty.call(enc, 'encoding')) {
          encoding = enc.encoding == null || enc.encoding === '' ? 'buffer' : enc.encoding;
        }
        if (typeof p === 'number') {
          var slot = __bn_fds[p];
          if (!slot || !slot.read) __bn_fs_code('EBADF');
          var all = __bn_read_all(slot.path) || [];
          var slice = all.slice(slot.pos);
          slot.pos = all.length;
          if (encoding && encoding !== 'buffer') return Buffer._decode(slice, encoding);
          return Buffer.from(slice);
        }
        if (encoding == null) {
          var t = __bn.readFile(String(p));
          if (t === null) throw new Error('ENOENT: ' + p);
          return t;
        }
        var bytes = __bn_read_all(String(p));
        if (bytes == null) throw new Error('ENOENT: ' + p);
        if (encoding === 'buffer') return Buffer.from(bytes);
        return Buffer._decode(bytes, encoding);
      },
      writeFileSync: function(p, d, opts) {
        if (typeof p === 'number') {
          var slot = __bn_fds[p];
          if (!slot || !slot.write) __bn_fs_code('EBADF');
          var bytes = __bn_bytes_of(d, opts);
          var file = __bn_read_all(slot.path) || [];
          var at = slot.append ? file.length : slot.pos;
          if (at < 0) at = 0;
          while (file.length < at) file.push(0);
          for (var wi = 0; wi < bytes.length; wi++) file[at + wi] = bytes[wi] & 255;
          __bn_write_all(slot.path, file);
          slot.pos = at + bytes.length;
          return;
        }
        if (Buffer.isBuffer && Buffer.isBuffer(d)) {
          if (__bn.writeBytes) {
            // QuickJS C binding accepts ArrayBuffer, not TypedArray / plain arrays
            var u8b = new Uint8Array(d._data || []);
            if (!__bn.writeBytes(String(p), u8b.buffer)) throw new Error('EIO');
            return;
          }
          d = d.toString();
        }
        if (typeof ArrayBuffer !== 'undefined' && d instanceof ArrayBuffer) {
          if (__bn.writeBytes) {
            if (!__bn.writeBytes(String(p), d)) throw new Error('EIO');
            return;
          }
          d = Buffer.from(d).toString();
        }
        if (d instanceof Uint8Array) {
          if (__bn.writeBytes) {
            var exact = d.byteOffset === 0 && d.byteLength === d.buffer.byteLength
              ? d.buffer
              : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
            if (!__bn.writeBytes(String(p), exact)) throw new Error('EIO');
            return;
          }
          d = Buffer.from(d).toString();
        }
        var encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
        if (typeof d === 'string' && encoding && encoding !== 'utf8' && encoding !== 'utf-8') {
          __bn_write_all(String(p), __bn_bytes_of(d, opts));
          return;
        }
        if (!__bn.writeFile(String(p), String(d))) throw new Error('EIO');
      },
      existsSync: function(p) { return !!__bn.exists(String(p)); },
      accessSync: function(p, mode) {
        if (!__bn.exists(String(p))) {
          var e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e;
        }
        mode = mode == null ? 0 : (mode | 0);
        if ((mode & 7) === 0) return;
        var bits = fs.statSync(p).mode & 511;
        if ((mode & 4) && (bits & 292) === 0) {
          var er = new Error('EACCES: ' + p); er.code = 'EACCES'; throw er;
        }
        if ((mode & 2) && (bits & 146) === 0) {
          var ew = new Error('EACCES: ' + p); ew.code = 'EACCES'; throw ew;
        }
        if ((mode & 1) && (bits & 73) === 0) {
          var ex = new Error('EACCES: ' + p); ex.code = 'EACCES'; throw ex;
        }
      },
      mkdirSync: function(p, opts) {
        if (!__bn.mkdir(String(p), !!(opts && opts.recursive))) throw new Error('EEXIST mkdir: ' + p);
      },
      readdirSync: function(p, opts) {
        var a = __bn.readdir(String(p));
        if (a === null) throw new Error('ENOENT');
        if (!(opts && opts.withFileTypes)) return a;
        var out = [];
        for (var i = 0; i < a.length; i++) out.push(__bn_child_dirent(p, a[i]));
        return out;
      },
      unlinkSync: function(p) { if (!__bn.unlink(String(p))) throw new Error('ENOENT'); },
      rmdirSync: function(p) {
        if (__bn.rmdir) {
          if (!__bn.rmdir(String(p))) throw new Error('ENOENT rmdir: ' + p);
          return;
        }
        if (!__bn.unlink(String(p))) throw new Error('ENOENT rmdir: ' + p);
      },
      mkdtempSync: function(prefix) {
        prefix = String(prefix || '/tmp/tmp-');
        var name = prefix + Math.floor(Math.random() * 1e9).toString(36);
        __bn.mkdir(name, true);
        return name;
      },
      opendirSync: function(p) {
        var names = __bn.readdir(String(p));
        if (names === null) throw new Error('ENOENT opendir: ' + p);
        var i = 0;
        return {
          readSync: function() {
            if (i >= names.length) return null;
            return __bn_child_dirent(p, names[i++]);
          },
          closeSync: function() {},
          close: function() { return Promise.resolve(); }
        };
      },
      createReadStream: function(p) {
        var R = loadCore('stream').Readable;
        var s = new R({ read: function() {} });
        try {
          var t = __bn.readFile(String(p));
          if (t === null) throw new Error('ENOENT: ' + p);
          s.push(t); s.push(null);
        } catch (e) {
          setTimeout(function() { s.emit('error', e); }, 0);
        }
        return s;
      },
      createWriteStream: function(p) {
        var W = loadCore('stream').Writable;
        var chunks = [];
        return new W({
          write: function(c, enc, cb) {
            chunks.push(Buffer.isBuffer && Buffer.isBuffer(c) ? c.toString() : String(c));
            if (cb) cb();
          },
          final: function(cb) {
            __bn.writeFile(String(p), chunks.join(''));
            if (cb) cb();
          }
        });
      },
      symlinkSync: function(target, path) {
        if (!__bn.symlink || !__bn.symlink(String(target), String(path))) throw new Error('EIO symlink');
      },
      readlinkSync: function(path) {
        var t = __bn.readlink ? __bn.readlink(String(path)) : null;
        if (t == null) throw new Error('EINVAL: not a symlink');
        return t;
      },
      lstatSync: function(p) {
        var path = String(p);
        var kind = __bn.lstatKind ? __bn.lstatKind(path) : null;
        if (!kind && __bn.isSymlink && __bn.isSymlink(path)) kind = 'symlink';
        if (!kind && !__bn.exists(path)) throw new Error('ENOENT: ' + path);
        if (!kind) kind = __bn.isDir(path) ? 'dir' : (__bn.isFile(path) ? 'file' : 'file');
        if (kind === 'directory') kind = 'dir';
        var meta = __bn.statJson ? __bn.statJson(path, false) : null;
        return {
          isFile: function() { return kind === 'file'; },
          isDirectory: function() { return kind === 'dir'; },
          isSymbolicLink: function() { return kind === 'symlink'; },
          mode: meta && meta.mode != null ? meta.mode : (kind === 'dir' ? 0o755 : 0o644),
          size: meta && meta.size != null ? meta.size : 0,
          mtimeMs: meta && meta.mtimeMs != null ? meta.mtimeMs : Date.now(),
          mtime: new Date(meta && meta.mtimeMs != null ? meta.mtimeMs : Date.now())
        };
      },
      chmodSync: function(p, mode) {
        mode = typeof mode === 'string' ? parseInt(mode, 8) : (mode | 0);
        if (!__bn.chmod || !__bn.chmod(String(p), mode)) throw new Error('ENOENT chmod: ' + p);
      },
      utimesSync: function(p, atime, mtime) {
        function toMs(t) {
          if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
          if (t && typeof t.getTime === 'function') return t.getTime();
          return Date.now();
        }
        if (!__bn.utimes || !__bn.utimes(String(p), toMs(atime), toMs(mtime))) throw new Error('ENOENT utimes: ' + p);
      },
      watch: function(path, opts, listener) {
        if (typeof opts === 'function') { listener = opts; opts = undefined; }
        var wp = String(path);
        if (!listener) listener = function() {};
        var entry = { listener: listener, closed: false };
        if (!__bn_fs_watchers[wp]) __bn_fs_watchers[wp] = [];
        __bn_fs_watchers[wp].push(entry);
        return {
          close: function() {
            entry.closed = true;
            var list = __bn_fs_watchers[wp] || [];
            __bn_fs_watchers[wp] = list.filter(function(e) { return e !== entry; });
          }
        };
      },
      watchFile: function(path, opts, listener) {
        if (typeof opts === 'function') { listener = opts; opts = undefined; }
        var p = String(path);
        if (!listener) return;
        if (!__bn_fs_watchFileListeners[p]) __bn_fs_watchFileListeners[p] = [];
        __bn_fs_watchFileListeners[p].push(listener);
      },
      unwatchFile: function(path, listener) {
        var p = String(path);
        var list = __bn_fs_watchFileListeners[p];
        if (!list) return;
        if (!listener) { delete __bn_fs_watchFileListeners[p]; return; }
        __bn_fs_watchFileListeners[p] = list.filter(function(fn) { return fn !== listener; });
      },
      realpathSync: function(p) {
        function walk(path, depth) {
          if (depth > 40) {
            var loop = new Error('ELOOP: ' + path);
            loop.code = 'ELOOP';
            throw loop;
          }
          path = String(path);
          if (path.charAt(0) !== '/') path = join(process.cwd() || '/', path);
          var segs = path.split('/');
          var resolved = '/';
          for (var i = 0; i < segs.length; i++) {
            var s = segs[i];
            if (!s || s === '.') continue;
            if (s === '..') {
              if (resolved !== '/') resolved = resolved.slice(0, resolved.lastIndexOf('/')) || '/';
              continue;
            }
            var next = resolved === '/' ? '/' + s : resolved + '/' + s;
            var kind = __bn.lstatKind ? __bn.lstatKind(next) : null;
            if (kind === 'symlink') {
              var target = __bn.readlink ? __bn.readlink(next) : null;
              if (target == null) {
                var broken = new Error('ENOENT: ' + next);
                broken.code = 'ENOENT';
                throw broken;
              }
              var rest = [];
              for (var k = i + 1; k < segs.length; k++) if (segs[k]) rest.push(segs[k]);
              var combined = String(target);
              if (combined.charAt(0) !== '/') combined = (resolved === '/' ? '/' : resolved + '/') + combined;
              if (rest.length) combined = combined.replace(/\/$/, '') + '/' + rest.join('/');
              return walk(combined, depth + 1);
            }
            resolved = next;
          }
          if (resolved !== '/' && !__bn.exists(resolved)) {
            var missing = new Error('ENOENT: ' + path);
            missing.code = 'ENOENT';
            throw missing;
          }
          return resolved;
        }
        return walk(p, 0);
      },
      copyFileSync: function(src, dest) {
        var b = __bn.readBytes ? __bn.readBytes(String(src)) : null;
        if (b != null) {
          if (__bn.writeBytes) {
            var payload = b;
            if (typeof Uint8Array !== 'undefined' && !(b instanceof ArrayBuffer)) {
              var u8 = b instanceof Uint8Array ? b : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
              payload = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
            }
            if (!__bn.writeBytes(String(dest), payload)) throw new Error('EIO');
            return;
          }
        }
        var t = __bn.readFile(String(src));
        if (t === null) {
          var e = new Error('ENOENT: ' + src); e.code = 'ENOENT'; throw e;
        }
        if (!__bn.writeFile(String(dest), t)) throw new Error('EIO');
      },
      cpSync: function(src, dest, opts) {
        src = String(src);
        dest = String(dest);
        var kind = __bn.lstatKind ? __bn.lstatKind(src) : null;
        if (!kind) {
          if (!__bn.exists(src)) {
            var missing = new Error('ENOENT: ' + src); missing.code = 'ENOENT'; throw missing;
          }
          kind = __bn.isDir(src) ? 'dir' : 'file';
        }
        if (kind === 'directory') kind = 'dir';
        if (kind === 'dir') {
          if (!(opts && opts.recursive)) {
            var eis = new Error('EISDIR: ' + src); eis.code = 'EISDIR'; throw eis;
          }
          if (!__bn.mkdir(dest, true)) throw new Error('EIO mkdir: ' + dest);
          var names = __bn.readdir(src) || [];
          for (var i = 0; i < names.length; i++) {
            var child = names[i];
            fs.cpSync(src.replace(/\/$/, '') + '/' + child, dest.replace(/\/$/, '') + '/' + child, opts);
          }
          return;
        }
        if (kind === 'symlink') {
          var target = __bn.readlink ? __bn.readlink(src) : null;
          if (target == null) throw new Error('EINVAL: ' + src);
          fs.symlinkSync(target, dest);
          return;
        }
        fs.copyFileSync(src, dest);
      },
      rmSync: function(p, opts) {
        p = String(p);
        var force = !!(opts && opts.force);
        if (!__bn.exists(p)) {
          if (force) return;
          var missing = new Error('ENOENT: ' + p); missing.code = 'ENOENT'; throw missing;
        }
        var kind = __bn.lstatKind ? __bn.lstatKind(p) : (__bn.isDir(p) ? 'dir' : 'file');
        if (kind === 'directory') kind = 'dir';
        if (kind === 'symlink') {
          if (!__bn.unlink(p) && __bn.exists(p)) throw new Error('EPERM: ' + p);
          return;
        }
        if (kind === 'dir') {
          if (!(opts && opts.recursive)) {
            var eis = new Error('EISDIR: ' + p); eis.code = 'EISDIR'; throw eis;
          }
          var names = __bn.readdir(p) || [];
          for (var i = 0; i < names.length; i++) {
            fs.rmSync(p.replace(/\/$/, '') + '/' + names[i], { recursive: true, force: true });
          }
          if (__bn.rmdir && !__bn.rmdir(p) && __bn.exists(p)) throw new Error('ENOTEMPTY: ' + p);
          return;
        }
        if (!__bn.unlink(p) && __bn.exists(p)) throw new Error('EPERM: ' + p);
      },
      openSync: function(p, flags) {
        var path = String(p);
        var mode = __bn_flag_mode(flags);
        var exists = !!__bn.exists(path);
        if (!exists && !mode.creat) __bn_fs_code('ENOENT', 'ENOENT: ' + path);
        if (mode.trunc || (!exists && mode.creat)) __bn_write_all(path, []);
        var data = __bn_read_all(path) || [];
        var fd = __bn_next_fd++;
        __bn_fds[fd] = { path: path, pos: mode.append ? data.length : 0, read: mode.read, write: mode.write, append: mode.append };
        return fd;
      },
      readSync: function(fd, buf, offset, length, position) {
        var slot = __bn_fds[fd];
        if (!slot || !slot.read) __bn_fs_code('EBADF');
        var data = __bn_read_all(slot.path) || [];
        var pos = typeof position === 'number' ? position : slot.pos;
        if (pos < 0) pos = 0;
        offset = offset == null ? 0 : offset | 0;
        var dest = (Buffer.isBuffer && Buffer.isBuffer(buf)) ? buf._data : buf;
        if (!dest || typeof dest.length !== 'number') __bn_fs_code('EINVAL', 'EINVAL');
        length = length == null ? dest.length - offset : length | 0;
        var n = 0;
        while (n < length && pos + n < data.length && offset + n < dest.length) {
          dest[offset + n] = data[pos + n] & 255;
          n++;
        }
        if (typeof position !== 'number') slot.pos = pos + n;
        return n;
      },
      writeSync: function(fd, data, offset, length, position) {
        var slot = __bn_fds[fd];
        if (!slot || !slot.write) __bn_fs_code('EBADF');
        var bytes, pos;
        if (typeof data === 'string') {
          var enc = 'utf8';
          pos = null;
          if (typeof offset === 'number') pos = offset;
          if (typeof length === 'string') enc = length;
          else if (typeof offset === 'string') enc = offset;
          bytes = Buffer._encode(data, enc);
        } else {
          var src = (Buffer.isBuffer && Buffer.isBuffer(data)) ? data._data : data;
          offset = offset == null ? 0 : offset | 0;
          length = length == null ? src.length - offset : length | 0;
          bytes = [];
          for (var i = 0; i < length; i++) bytes.push(src[offset + i] & 255);
          pos = typeof position === 'number' ? position : null;
        }
        var file = __bn_read_all(slot.path) || [];
        var at = slot.append ? file.length : (pos == null ? slot.pos : pos);
        if (at < 0) at = 0;
        while (file.length < at) file.push(0);
        for (var j = 0; j < bytes.length; j++) file[at + j] = bytes[j] & 255;
        __bn_write_all(slot.path, file);
        if (!slot.append && pos == null) slot.pos = at + bytes.length;
        else if (slot.append) slot.pos = file.length;
        return bytes.length;
      },
      closeSync: function(fd) {
        if (!__bn_fds[fd]) __bn_fs_code('EBADF');
        delete __bn_fds[fd];
      },
      fstatSync: function(fd) {
        var slot = __bn_fds[fd];
        if (!slot) __bn_fs_code('EBADF');
        return fs.statSync(slot.path);
      },
      truncateSync: function(p, len) {
        var path = String(p);
        if (!__bn.exists(path)) __bn_fs_code('ENOENT', 'ENOENT: ' + path);
        if (__bn.isDir && __bn.isDir(path)) __bn_fs_code('EISDIR', 'EISDIR: ' + path);
        var data = __bn_read_all(path) || [];
        __bn_write_all(path, __bn_fit_len(data, len));
      },
      ftruncateSync: function(fd, len) {
        var slot = __bn_fds[fd];
        if (!slot || !slot.write) __bn_fs_code('EBADF');
        var data = __bn_read_all(slot.path) || [];
        var next = __bn_fit_len(data, len);
        __bn_write_all(slot.path, next);
        if (slot.pos > next.length) slot.pos = next.length;
      },
      appendFileSync: function(p, data, enc) {
        if (typeof p === 'number') {
          var slot = __bn_fds[p];
          if (!slot || !slot.write) __bn_fs_code('EBADF');
          var extraFd = __bn_bytes_of(data, enc);
          var file = __bn_read_all(slot.path) || [];
          for (var ai = 0; ai < extraFd.length; ai++) file.push(extraFd[ai] & 255);
          __bn_write_all(slot.path, file);
          slot.pos = file.length;
          return;
        }
        var path = String(p);
        if (__bn.isDir && __bn.isDir(path)) __bn_fs_code('EISDIR', 'EISDIR: ' + path);
        var cur = __bn_read_all(path) || [];
        var extra;
        if (typeof data === 'string') extra = Buffer._encode(data, (enc && enc.encoding) || enc || 'utf8');
        else if (Buffer.isBuffer && Buffer.isBuffer(data)) extra = data._data;
        else extra = Buffer._encode(String(data), 'utf8');
        for (var i = 0; i < extra.length; i++) cur.push(extra[i] & 255);
        __bn_write_all(path, cur);
      },
      renameSync: function(from, to) {
        var src = String(from);
        var dst = String(to);
        if (!__bn.rename) __bn_fs_code('ENOSYS', 'ENOSYS');
        if (!__bn.exists(src)) __bn_fs_code('ENOENT', 'ENOENT: ' + src);
        if (src !== dst && __bn.isDir && __bn.isDir(dst)) __bn_fs_code('EISDIR', 'EISDIR: ' + dst);
        if (!__bn.rename(src, dst)) __bn_fs_code('EPERM', 'EPERM');
        var id;
        for (id in __bn_fds) {
          var slot = __bn_fds[id];
          if (!slot) continue;
          if (slot.path === src) slot.path = dst;
          else if (slot.path.indexOf(src + '/') === 0) slot.path = dst + slot.path.slice(src.length);
        }
      },
      statSync: function(p) {
        var path = String(p);
        if (!__bn.exists(path)) throw new Error('ENOENT: ' + path);
        var meta = __bn.statJson ? __bn.statJson(path, true) : null;
        var file = isFile(path), dir = isDir(path);
        return {
          isFile: function() { return file; },
          isDirectory: function() { return dir; },
          isSymbolicLink: function() { return false; },
          mode: meta && meta.mode != null ? meta.mode : (dir ? 0o755 : 0o644),
          size: meta && meta.size != null ? meta.size : 0,
          mtimeMs: meta && meta.mtimeMs != null ? meta.mtimeMs : Date.now(),
          mtime: new Date(meta && meta.mtimeMs != null ? meta.mtimeMs : Date.now())
        };
      },
      chmod: function(p, mode) { return Promise.resolve().then(function() { return fs.chmodSync(p, mode); }); },
      utimes: function(p, a, m) { return Promise.resolve().then(function() { return fs.utimesSync(p, a, m); }); }
    };
    fs.promises = (typeof __bn_fs_promises === 'function') ? __bn_fs_promises(fs) : {
      readFile: function(p, enc) { return Promise.resolve().then(function() { return fs.readFileSync(p, enc); }); },
      writeFile: function(p, data, enc) { return Promise.resolve().then(function() { return fs.writeFileSync(p, data, enc); }); },
      mkdir: function(p, opts) { return Promise.resolve().then(function() { return fs.mkdirSync(p, opts); }); },
      readdir: function(p) { return Promise.resolve().then(function() { return fs.readdirSync(p); }); },
      unlink: function(p) { return Promise.resolve().then(function() { return fs.unlinkSync(p); }); },
      stat: function(p) { return Promise.resolve().then(function() { return fs.statSync(p); }); },
      lstat: function(p) { return Promise.resolve().then(function() { return fs.lstatSync(p); }); },
      access: function(p) { return Promise.resolve().then(function() { return fs.accessSync(p); }); },
      realpath: function(p) { return Promise.resolve().then(function() { return fs.realpathSync(p); }); },
      copyFile: function(src, dest) { return Promise.resolve().then(function() { return fs.copyFileSync(src, dest); }); },
      cp: function(src, dest, opts) { return Promise.resolve().then(function() { return fs.cpSync(src, dest, opts); }); },
      rm: function(p, opts) { return Promise.resolve().then(function() { return fs.rmSync(p, opts); }); },
      symlink: function(t, p) { return Promise.resolve().then(function() { return fs.symlinkSync(t, p); }); },
      readlink: function(p) { return Promise.resolve().then(function() { return fs.readlinkSync(p); }); },
      chmod: function(p, mode) { return Promise.resolve().then(function() { return fs.chmodSync(p, mode); }); },
      utimes: function(p, a, m) { return Promise.resolve().then(function() { return fs.utimesSync(p, a, m); }); }
    };
    if (fs.promises && !fs.promises.rename) {
      fs.promises.rename = function(from, to) {
        return Promise.resolve().then(function() { return fs.renameSync(from, to); });
      };
    }
    if (fs.promises) {
      fs.promises.access = function(p, mode) {
        return Promise.resolve().then(function() { return fs.accessSync(p, mode); });
      };
    }
    if (fs.promises && !fs.promises.truncate) {
      fs.promises.truncate = function(p, len) {
        return Promise.resolve().then(function() { return fs.truncateSync(p, len); });
      };
      fs.promises.appendFile = function(p, data, enc) {
        return Promise.resolve().then(function() { return fs.appendFileSync(p, data, enc); });
      };
    }
    if (fs.promises && !fs.promises.open) {
      fs.promises.open = function(p, flags) {
        return Promise.resolve().then(function() {
          var fd = fs.openSync(p, flags);
          return {
            fd: fd,
            read: function(buf, off, len, pos) {
              return Promise.resolve().then(function() {
                var n = fs.readSync(fd, buf, off, len, pos);
                return { bytesRead: n, buffer: buf };
              });
            },
            write: function(buf, off, len, pos) {
              return Promise.resolve().then(function() { return fs.writeSync(fd, buf, off, len, pos); });
            },
            stat: function() { return Promise.resolve().then(function() { return fs.fstatSync(fd); }); },
            truncate: function(len) { return Promise.resolve().then(function() { fs.ftruncateSync(fd, len); }); },
            close: function() { return Promise.resolve().then(function() { fs.closeSync(fd); }); }
          };
        });
      };
    }
    if (fs.realpathSync) fs.realpathSync.native = fs.realpathSync;
    fs.Dirent = Dirent;
    if (fs.promises) {
      fs.promises.readdir = function(p, opts) {
        return Promise.resolve().then(function() { return fs.readdirSync(p, opts); });
      };
    }
    function __bn_fs_callback(syncName) {
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var cb = args[args.length - 1];
        if (typeof cb !== 'function') {
          var bad = new TypeError('The "cb" argument must be of type function');
          bad.code = 'ERR_INVALID_ARG_TYPE';
          throw bad;
        }
        args.pop();
        var result;
        var err = null;
        try { result = fs[syncName].apply(fs, args); }
        catch (e) { err = e; }
        process.nextTick(function() { cb(err, result); });
      };
    }
    fs.readFile = __bn_fs_callback('readFileSync');
    fs.writeFile = __bn_fs_callback('writeFileSync');
    fs.appendFile = __bn_fs_callback('appendFileSync');
    fs.readdir = __bn_fs_callback('readdirSync');
    fs.stat = __bn_fs_callback('statSync');
    fs.lstat = __bn_fs_callback('lstatSync');
    fs.access = __bn_fs_callback('accessSync');
    fs.mkdir = __bn_fs_callback('mkdirSync');
    fs.unlink = __bn_fs_callback('unlinkSync');
    fs.rmdir = __bn_fs_callback('rmdirSync');
    fs.rename = __bn_fs_callback('renameSync');
    fs.realpath = __bn_fs_callback('realpathSync');
    fs.copyFile = __bn_fs_callback('copyFileSync');
    fs.chmod = __bn_fs_callback('chmodSync');
    fs.truncate = __bn_fs_callback('truncateSync');
    fs.rm = __bn_fs_callback('rmSync');
    return fs;
  }
  if (name === 'path') {
    var pathApi = {
      join: function() {
        var segs = [];
        for (var i = 0; i < arguments.length; i++) {
          if (arguments[i] != null && String(arguments[i]) !== '') segs.push(String(arguments[i]));
        }
        if (!segs.length) return '.';
        return __bn_posix_normalize(segs.join('/'));
      },
      dirname: dirname,
      basename: function(p, ext) {
        p = String(p).replace(/\/+$/, '');
        var base = __bn_basename(p);
        ext = ext == null ? '' : String(ext);
        if (ext && ext.length < base.length && base.slice(-ext.length) === ext) base = base.slice(0, -ext.length);
        return base;
      },
      resolve: function() {
        var resolved = '';
        var abs = false;
        for (var i = arguments.length - 1; i >= -1 && !abs; i--) {
          var seg = i >= 0 ? arguments[i] : process.cwd();
          if (seg == null || seg === '') continue;
          seg = String(seg);
          resolved = resolved ? seg + '/' + resolved : seg;
          if (seg.charAt(0) === '/') abs = true;
        }
        return __bn_posix_normalize(resolved || '.');
      },
      extname: function(p) {
        var base = pathApi.basename(p);
        var dot = base.lastIndexOf('.');
        return dot <= 0 ? '' : base.slice(dot);
      },
      sep: '/',
      delimiter: ':',
      isAbsolute: function(p) { return String(p).charAt(0) === '/'; },
      normalize: function(p) { return __bn_posix_normalize(p); },
      parse: function(p) {
        p = String(p);
        var slash = p.lastIndexOf('/');
        var base = slash < 0 ? p : p.slice(slash + 1);
        var dir = slash < 0 ? '' : (slash === 0 ? '/' : p.slice(0, slash));
        var dot = base.lastIndexOf('.');
        var ext = dot <= 0 ? '' : base.slice(dot);
        return { root: p.charAt(0) === '/' ? '/' : '', dir: dir, base: base, ext: ext, name: ext ? base.slice(0, -ext.length) : base };
      },
      format: function(o) {
        o = o || {};
        var dir = o.dir || o.root || '';
        var base = o.base || ((o.name || '') + (o.ext || ''));
        if (!dir) return base;
        return dir === '/' ? '/' + base : dir.replace(/\/$/, '') + '/' + base;
      },
      relative: function(from, to) {
        var f = pathApi.resolve(from).split('/').filter(Boolean);
        var t = pathApi.resolve(to).split('/').filter(Boolean);
        var i = 0;
        while (i < f.length && i < t.length && f[i] === t[i]) i++;
        var ups = [];
        for (var j = i; j < f.length; j++) ups.push('..');
        var rel = ups.concat(t.slice(i)).join('/');
        return rel || '.';
      }
    };
    function __bn_win32() {
      function isAbs(p) {
        p = String(p);
        if (!p) return false;
        if (p.charAt(0) === '\\' || p.charAt(0) === '/') return true;
        return /^[A-Za-z]:[\\/]/.test(p);
      }
      function normalize(p) {
        p = String(p);
        if (!p) return '.';
        var unc = p.charAt(0) === '\\' && p.charAt(1) === '\\' || p.charAt(0) === '/' && p.charAt(1) === '/';
        var drive = '';
        var rest = p;
        var dm = /^([A-Za-z]:)/.exec(p);
        if (dm) {
          drive = dm[1];
          rest = p.slice(2);
        } else if (unc) {
          rest = p.slice(2);
        }
        var abs = isAbs(p);
        var parts = rest.split(/[\\/]+/);
        var stack = [];
        var i;
        for (i = 0; i < parts.length; i++) {
          var part = parts[i];
          if (!part || part === '.') continue;
          if (part === '..') {
            if (stack.length && stack[stack.length - 1] !== '..') stack.pop();
            else if (!abs && !drive) stack.push('..');
            continue;
          }
          stack.push(part);
        }
        var body = stack.join('\\');
        if (drive) return body ? drive + '\\' + body : drive + '\\';
        if (unc) return '\\\\' + body;
        if (abs) return body ? '\\' + body : '\\';
        return body || '.';
      }
      function basename(p, ext) {
        p = String(p).replace(/[\\/]+$/, '');
        var slash = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
        var base = slash < 0 ? p : p.slice(slash + 1);
        ext = ext == null ? '' : String(ext);
        if (ext && ext.length < base.length && base.slice(-ext.length) === ext) base = base.slice(0, -ext.length);
        return base;
      }
      var win = {
        sep: '\\',
        delimiter: ';',
        isAbsolute: isAbs,
        normalize: normalize,
        join: function() {
          var parts = [];
          for (var i = 0; i < arguments.length; i++) {
            if (arguments[i] != null && arguments[i] !== '') parts.push(String(arguments[i]));
          }
          if (!parts.length) return '.';
          return normalize(parts.join('\\'));
        },
        dirname: function(p) {
          var parsed = win.parse(p);
          return parsed.dir || '.';
        },
        basename: basename,
        extname: function(p) {
          var base = basename(p);
          var dot = base.lastIndexOf('.');
          return dot <= 0 ? '' : base.slice(dot);
        },
        parse: function(p) {
          p = String(p);
          var root = '';
          if ((p.charAt(0) === '\\' && p.charAt(1) === '\\') || (p.charAt(0) === '/' && p.charAt(1) === '/')) {
            var bits = p.slice(2).split(/[\\/]/);
            root = '\\\\' + (bits[0] || '') + (bits.length > 1 ? '\\' + bits[1] : '');
          } else if (/^[A-Za-z]:/.test(p)) {
            root = p.slice(0, 2);
            if (p.charAt(2) === '\\' || p.charAt(2) === '/') root += '\\';
          } else if (p.charAt(0) === '\\' || p.charAt(0) === '/') {
            root = '\\';
          }
          var trimmed = p.replace(/[\\/]+$/, '');
          if (root && trimmed.length < root.length) trimmed = p;
          var slash = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
          var base = slash < 0 ? trimmed : trimmed.slice(slash + 1);
          var dir = slash < 0 ? '' : trimmed.slice(0, slash);
          if (root && dir.length < root.length) dir = root;
          if (root && base && trimmed.slice(0, root.length) === root && slash < root.length) base = trimmed.slice(root.length);
          var dot = base.lastIndexOf('.');
          var ext = dot <= 0 ? '' : base.slice(dot);
          return {
            root: root,
            dir: dir,
            base: base,
            ext: ext,
            name: ext ? base.slice(0, -ext.length) : base
          };
        },
        format: function(o) {
          o = o || {};
          var dir = o.dir || o.root || '';
          var base = o.base || ((o.name || '') + (o.ext || ''));
          if (!dir) return base;
          if (dir.charAt(dir.length - 1) === '\\') return dir + base;
          return dir + '\\' + base;
        },
        resolve: function() {
          var resolved = '';
          var abs = false;
          for (var i = arguments.length - 1; i >= -1 && !abs; i--) {
            var seg;
            if (i >= 0) {
              if (arguments[i] == null || arguments[i] === '') continue;
              seg = String(arguments[i]);
            } else {
              var cwd = String(process.cwd() || '/').replace(/\//g, '\\');
              if (cwd.charAt(0) !== '\\') cwd = '\\' + cwd;
              seg = 'C:' + cwd;
            }
            resolved = resolved ? seg + '\\' + resolved : seg;
            abs = isAbs(seg);
          }
          return normalize(resolved);
        },
        relative: function(from, to) {
          var f = win.resolve(from);
          var t = win.resolve(to);
          var fd = /^([A-Za-z]:)/.exec(f);
          var td = /^([A-Za-z]:)/.exec(t);
          if (fd && td && fd[1].toLowerCase() !== td[1].toLowerCase()) return t;
          var fs = f.slice(fd ? 2 : 0).split('\\').filter(function(s) { return s; });
          var ts = t.slice(td ? 2 : 0).split('\\').filter(function(s) { return s; });
          var n = 0;
          while (n < fs.length && n < ts.length && fs[n].toLowerCase() === ts[n].toLowerCase()) n++;
          var ups = [];
          for (var j = n; j < fs.length; j++) ups.push('..');
          var rel = ups.concat(ts.slice(n)).join('\\');
          return rel || '.';
        }
      };
      win.win32 = win;
      win.posix = pathApi;
      return win;
    }
    pathApi.posix = pathApi;
    pathApi.win32 = __bn_win32();
    return pathApi;
  }
  if (name === 'events') {
    function EE() { this._e = Object.create(null); }
    function wrapOnce(self, ev, fn) {
      function w() {
        self.off(ev, w);
        return fn.apply(this, arguments);
      }
      w.listener = fn;
      return w;
    }
    EE.prototype.on = function(ev, fn) {
      (this._e[ev] || (this._e[ev] = [])).push(fn);
      return this;
    };
    EE.prototype.addListener = EE.prototype.on;
    EE.prototype.prependListener = function(ev, fn) {
      var list = this._e[ev] || (this._e[ev] = []);
      list.unshift(fn);
      return this;
    };
    EE.prototype.once = function(ev, fn) {
      return this.on(ev, wrapOnce(this, ev, fn));
    };
    EE.prototype.prependOnceListener = function(ev, fn) {
      return this.prependListener(ev, wrapOnce(this, ev, fn));
    };
    EE.prototype.off = function(ev, fn) {
      var list = this._e[ev] || [];
      this._e[ev] = list.filter(function(f) { return f !== fn && f.listener !== fn; });
      return this;
    };
    EE.prototype.removeListener = EE.prototype.off;
    EE.prototype.removeAllListeners = function(ev) {
      if (ev == null) this._e = Object.create(null);
      else delete this._e[ev];
      return this;
    };
    EE.prototype.listenerCount = function(ev) { return (this._e[ev] || []).length; };
    EE.prototype.listeners = function(ev) {
      return (this._e[ev] || []).map(function(f) { return f.listener || f; });
    };
    EE.prototype.eventNames = function() {
      var names = [];
      var keys = Object.keys(this._e);
      for (var i = 0; i < keys.length; i++) {
        if ((this._e[keys[i]] || []).length) names.push(keys[i]);
      }
      return names;
    };
    EE.prototype.setMaxListeners = function() { return this; };
    EE.prototype.emit = function(ev) {
      var args = Array.prototype.slice.call(arguments, 1);
      var list = (this._e[ev] || []).slice();
      for (var i = 0; i < list.length; i++) list[i].apply(this, args);
      return list.length > 0;
    };
    EE.listenerCount = function(emitter, ev) { return emitter.listenerCount(ev); };
    function once(emitter, name) {
      return new Promise(function(resolve, reject) {
        function onResult() {
          cleanup();
          resolve(Array.prototype.slice.call(arguments));
        }
        function onError(err) {
          cleanup();
          reject(err);
        }
        function cleanup() {
          emitter.removeListener(name, onResult);
          if (name !== 'error') emitter.removeListener('error', onError);
        }
        emitter.on(name, onResult);
        if (name !== 'error') emitter.on('error', onError);
      });
    }
    return { EventEmitter: EE, once: once };
  }
  if (name === 'http' || name === 'https') return __bn_register_http(name);
  if (name === 'net') {
    var EE = loadCore('events').EventEmitter;
    function Server(connListener) {
      EE.call(this);
      this._port = 0;
      if (connListener) this.on('connection', connListener);
    }
    Server.prototype = Object.create(EE.prototype);
    Server.prototype.listen = function(port, cb) {
      var self = this;
      this._port = port | 0;
      __bn.registerHttp(this._port, function(req, res) {
        var sock = new Socket();
        sock.remoteAddress = '127.0.0.1';
        self.emit('connection', sock);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('net.Server virtual connection accepted');
      });
      if (typeof cb === 'function') setTimeout(cb, 0);
      return self;
    };
    function Socket() {
      EE.call(this);
      this.connecting = false;
      this.destroyed = false;
      this.remoteAddress = '';
    }
    Socket.prototype = Object.create(EE.prototype);
    Socket.prototype.write = function(c, cb) { if (cb) cb(); return true; };
    Socket.prototype.end = function() { this.emit('end'); this.emit('close'); return this; };
    Socket.prototype.destroy = function() { this.destroyed = true; this.emit('close'); return this; };
    Socket.prototype.connect = function(port, host, cb) {
      this.remoteAddress = (typeof host === 'string' ? host : null) || '127.0.0.1';
      this.emit('connect');
      if (typeof host === 'function') host();
      else if (typeof cb === 'function') cb();
      return this;
    };
    return {
      createServer: function(listener) { return new Server(listener); },
      Socket: Socket,
      connect: function(port, host, cb) { return new Socket().connect(port, host, cb); },
      createConnection: function(port, host, cb) { return new Socket().connect(port, host, cb); }
    };
  }
  if (name === 'url') {
    function fileURLToPath(u) {
      var s = typeof u === 'string' ? u : (u && u.href ? u.href : String(u));
      if (s.slice(0, 5).toLowerCase() !== 'file:') {
        var scheme = new TypeError('Invalid URL scheme');
        scheme.code = 'ERR_INVALID_URL_SCHEME';
        throw scheme;
      }
      if (s.slice(5, 7) !== '//') {
        var badPath = new TypeError('Invalid file URL path');
        badPath.code = 'ERR_INVALID_FILE_URL_PATH';
        throw badPath;
      }
      var rest = s.slice(7);
      var slash = rest.indexOf('/');
      var host = slash < 0 ? rest : rest.slice(0, slash);
      var path = slash < 0 ? '' : rest.slice(slash);
      if (host && host.toLowerCase() !== 'localhost') {
        var hostErr = new TypeError('File URL host must be "localhost" or empty');
        hostErr.code = 'ERR_INVALID_FILE_URL_HOST';
        throw hostErr;
      }
      if (!path || /%2f/i.test(path)) {
        var pathErr = new TypeError('Invalid file URL path');
        pathErr.code = 'ERR_INVALID_FILE_URL_PATH';
        throw pathErr;
      }
      try { path = decodeURIComponent(path); }
      catch (e) {
        var dec = new TypeError('Invalid file URL path');
        dec.code = 'ERR_INVALID_FILE_URL_PATH';
        throw dec;
      }
      return path;
    }
    function pathToFileURL(p) {
      var path = String(p);
      if (path.charAt(0) !== '/') {
        var cwd = process.cwd();
        path = (cwd === '/' ? '' : cwd.replace(/\/$/, '')) + '/' + path;
      }
      var href = 'file://' + path.split('/').map(function(seg) { return encodeURIComponent(seg); }).join('/');
      return { href: href, pathname: path, protocol: 'file:', toString: function() { return href; } };
    }
    function parse(input, parseQuery, slashesDenoteHost) {
      var href = input == null ? '' : String(input);
      var rest = href;
      var hash = null;
      var hi = rest.indexOf('#');
      if (hi >= 0) {
        hash = rest.slice(hi);
        rest = rest.slice(0, hi);
      }
      var protocol = null;
      var pm = /^([a-zA-Z][a-zA-Z0-9+.-]*:)/.exec(rest);
      if (pm) {
        protocol = pm[1].toLowerCase();
        rest = rest.slice(pm[1].length);
      }
      var slashes = null;
      var auth = null;
      var host = null;
      var hostname = null;
      var port = null;
      var hadSlashes = rest.slice(0, 2) === '//';
      if (hadSlashes && (protocol || slashesDenoteHost)) {
        slashes = true;
        rest = rest.slice(2);
        var cut = rest.search(/[\/\?]/);
        var hostpart = cut < 0 ? rest : rest.slice(0, cut);
        rest = cut < 0 ? '' : rest.slice(cut);
        var at = hostpart.lastIndexOf('@');
        if (at >= 0) {
          auth = hostpart.slice(0, at) || null;
          hostpart = hostpart.slice(at + 1);
        }
        host = hostpart || null;
        hostname = hostpart || null;
        if (hostpart.charAt(0) === '[') {
          var br = hostpart.indexOf(']');
          if (br >= 0) {
            hostname = hostpart.slice(1, br) || null;
            if (hostpart.charAt(br + 1) === ':') port = hostpart.slice(br + 2) || null;
          }
        } else {
          var colon = hostpart.lastIndexOf(':');
          if (colon >= 0) {
            hostname = hostpart.slice(0, colon) || null;
            port = hostpart.slice(colon + 1) || null;
          }
        }
      } else if (protocol && rest && rest.indexOf('/') < 0 && rest.indexOf('?') < 0) {
        var at2 = rest.lastIndexOf('@');
        if (at2 >= 0) {
          auth = rest.slice(0, at2) || null;
          hostname = rest.slice(at2 + 1) || null;
          host = hostname;
          rest = '';
        }
      }
      var search = null;
      var qi = rest.indexOf('?');
      var pathname = rest;
      if (qi >= 0) {
        pathname = rest.slice(0, qi);
        search = rest.slice(qi) || null;
      }
      if (slashes && pathname === '') pathname = '/';
      if (pathname === '') pathname = null;
      var query = null;
      if (search) {
        query = search.slice(1);
        if (parseQuery) query = loadCore('querystring').parse(query);
      }
      var path = null;
      if (pathname != null || search) path = (pathname || '') + (search || '');
      if (path === '') path = null;
      var parsed = {
        protocol: protocol,
        slashes: slashes,
        auth: auth,
        host: host,
        port: port,
        hostname: hostname,
        hash: hash,
        search: search,
        query: query,
        pathname: pathname,
        path: path,
        href: href
      };
      parsed.href = format(parsed);
      return parsed;
    }
    function format(o) {
      if (typeof o === 'string') return parse(o).href;
      o = o || {};
      var out = '';
      if (o.protocol) {
        out += o.protocol;
        if (out.charAt(out.length - 1) !== ':') out += ':';
      }
      if (o.slashes) out += '//';
      if (o.auth) out += o.auth + '@';
      if (o.host) out += o.host;
      else if (o.hostname) {
        out += o.hostname.indexOf(':') >= 0 ? '[' + o.hostname + ']' : o.hostname;
        if (o.port != null && o.port !== '') out += ':' + o.port;
      }
      if (o.pathname) out += o.pathname;
      if (o.search) out += o.search.charAt(0) === '?' ? o.search : '?' + o.search;
      else if (o.query != null && o.query !== '') {
        var q = typeof o.query === 'object' ? loadCore('querystring').stringify(o.query) : String(o.query);
        if (q) out += '?' + q;
      }
      if (o.hash) out += o.hash.charAt(0) === '#' ? o.hash : '#' + o.hash;
      return out;
    }
    return {
      parse: parse,
      URL: typeof URL !== 'undefined' ? URL : undefined,
      URLSearchParams: typeof URLSearchParams !== 'undefined' ? URLSearchParams : undefined,
      fileURLToPath: fileURLToPath,
      pathToFileURL: pathToFileURL,
      format: format
    };
  }
  if (name === 'util') return __bn_load_util();
  if (name === 'stream') return __bn_load_stream();
  if (name === 'stream/promises') {
    var streamMod = loadCore('stream');
    return {
      pipeline: function() {
        var args = Array.prototype.slice.call(arguments);
        return new Promise(function(resolve, reject) {
          args.push(function(err) { if (err) reject(err); else resolve(); });
          streamMod.pipeline.apply(null, args);
        });
      },
      finished: function(stream, opts) {
        return new Promise(function(resolve, reject) {
          streamMod.finished(stream, opts, function(err) { if (err) reject(err); else resolve(); });
        });
      }
    };
  }
  if (name === 'string_decoder') return __bn_load_string_decoder();
  if (name === 'timers') {
    return {
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval,
      setImmediate: function(fn) { return setTimeout(fn, 0); },
      clearImmediate: clearTimeout
    };
  }
  if (name === 'timers/promises') return __bn_load_timers_promises();
  if (name === 'zlib') return __bn_load_zlib();
  if (name === 'child_process') {
    var EE2 = loadCore('events').EventEmitter;
    var __bn_bg_jobs = [];
    function makeStream(initial) {
      var s = new (loadCore('stream').Readable)();
      if (initial) { s.push(initial); s.push(null); }
      else s.push(null);
      return s;
    }
    function makeWritable(pid) {
      return {
        write: function(chunk, enc, cb) {
          var data = chunk;
          if (Buffer.isBuffer && Buffer.isBuffer(chunk)) {
            data = new Uint8Array(chunk._data || []).buffer;
          } else if (typeof chunk === 'string') {
            data = chunk;
          }
          if (pid && __bn.writeStdin) __bn.writeStdin(pid, data);
          if (typeof enc === 'function') enc();
          else if (typeof cb === 'function') cb();
          return true;
        },
        end: function(chunk, enc, cb) {
          if (chunk != null) this.write(chunk, enc);
          if (typeof enc === 'function') enc();
          else if (typeof cb === 'function') cb();
        }
      };
    }
    function ChildProcess() {
      EE2.call(this);
      this.pid = 0;
      this.exitCode = null;
      this.killed = false;
      this.stdout = makeStream('');
      this.stderr = makeStream('');
      this.stdin = makeWritable(0);
    }
    ChildProcess.prototype = Object.create(EE2.prototype);
    ChildProcess.prototype.kill = function() {
      this.killed = true;
      if (this.pid && __bn.killPid) __bn.killPid(this.pid);
      this.exitCode = 137;
      this.emit('exit', 137, 'SIGKILL');
      this.emit('close', 137);
      return true;
    };
    function isNodeCmd(cmd) {
      var s = String(cmd);
      if (s === 'node') return true;
      var i = s.lastIndexOf('/');
      return i >= 0 && s.slice(i + 1) === 'node';
    }
    function isShellCmd(cmd) {
      var s = String(cmd);
      if (s === 'sh' || s === 'bash') return true;
      var i = s.lastIndexOf('/');
      var base = i >= 0 ? s.slice(i + 1) : s;
      return base === 'sh' || base === 'bash';
    }
    function tokenize(s) {
      var parts = s.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
      return parts.map(function(p) {
        if ((p.charAt(0) === '"' && p.charAt(p.length - 1) === '"') ||
            (p.charAt(0) === "'" && p.charAt(p.length - 1) === "'")) return p.slice(1, -1);
        return p;
      });
    }
    function runOneCommand(line, cwd, env) {
      line = String(line || '').trim();
      if (!line) return { pid: 0, stdout: '', stderr: '', running: false, code: 0 };
      var redir = null, append = false;
      var m = line.match(/^(.*?)(>>|>)\s*(\S+)\s*$/);
      if (m) {
        line = m[1].trim();
        append = m[2] === '>>';
        redir = m[3];
      }
      var parts = tokenize(line);
      var cmd0 = parts[0] || 'true';
      var args0 = parts.slice(1);
      if (cmd0.indexOf('=') > 0 && cmd0.indexOf('/') < 0) {
        var eq = cmd0.indexOf('=');
        env = Object.assign({}, env);
        env[cmd0.slice(0, eq)] = cmd0.slice(eq + 1);
        cmd0 = args0[0] || 'true';
        args0 = args0.slice(1);
      }
      var result;
      if (cmd0 === 'true') result = { pid: 0, stdout: '', stderr: '', running: false, code: 0 };
      else if (cmd0 === 'false') result = { pid: 0, stdout: '', stderr: '', running: false, code: 1 };
      else if (cmd0 === 'cd') {
        var dest = args0[0] ? (args0[0].charAt(0) === '/' ? args0[0] : join(cwd, args0[0])) : '/home';
        if (__bn.isDir && !__bn.isDir(dest)) result = { pid: 0, stdout: '', stderr: 'cd: no such directory\n', running: false, code: 1 };
        else result = { pid: 0, stdout: '', stderr: '', running: false, code: 0, cwd: dest };
      } else if (cmd0 === 'export') {
        result = { pid: 0, stdout: '', stderr: '', running: false, code: 0 };
      }       else if (isNodeCmd(cmd0)) result = spawnNode(args0[0] || '', args0, cwd, env);
      else {
        var bin = join(cwd, 'node_modules/.bin/' + cmd0);
        if (__bn.exists && __bn.exists(bin)) result = __bn.spawnNode(bin, cwd, env);
        else result = __bn.spawnCmd(String(cmd0), args0.map(String), cwd);
      }
      if (redir && result) {
        var body = result.stdout || '';
        var path = redir.charAt(0) === '/' ? redir : join(cwd, redir);
        if (append && __bn.readFile) {
          var prev = __bn.readFile(path);
          if (prev) body = prev + body;
        }
        if (__bn.writeFile) __bn.writeFile(path, body);
        result.stdout = '';
      }
      return result;
    }
    function runPipeline(seg, cwd, env) {
      var stages = String(seg).split('|');
      if (stages.length === 1) return runOneCommand(stages[0], cwd, env);
      var last = { pid: 0, stdout: '', stderr: '', running: false, code: 0 };
      for (var i = 0; i < stages.length; i++) {
        var line = stages[i].trim();
        if (i === 0) last = runOneCommand(line, cwd, env);
        else {
          var tmp = '/tmp/.bn_pipe_' + i;
          if (__bn.writeFile) __bn.writeFile(tmp, last.stdout || '');
          if (/^cat\b/.test(line) && tokenize(line).length === 1) last = runOneCommand('cat ' + tmp, cwd, env);
          else last = runOneCommand(line, cwd, env);
        }
      }
      return last;
    }
    function runShellScript(script, cwd, env) {
      script = String(script || '').trim();
      if (!script) return { pid: 0, stdout: '', stderr: '', running: false, code: 0 };
      if (script === 'wait' || /^wait(\s|$)/.test(script)) {
        var rest = script.slice(4).trim();
        if (rest && __bn.waitPid) {
          var wpid = parseInt(rest, 10);
          var code = __bn.waitPid(wpid);
          return { pid: wpid, stdout: '', stderr: '', running: false, code: code < 0 ? 0 : code };
        }
        var lastw = 0;
        for (var j = 0; j < __bn_bg_jobs.length; j++) {
          if (__bn.waitPid) lastw = __bn.waitPid(__bn_bg_jobs[j]);
        }
        __bn_bg_jobs.length = 0;
        return { pid: 0, stdout: '', stderr: '', running: false, code: lastw < 0 ? 0 : lastw };
      }
      var bg = false;
      if (/&\s*$/.test(script)) {
        bg = true;
        script = script.replace(/&\s*$/, '').trim();
      }
      var chunks = [];
      var buf = '', i, op;
      for (i = 0; i < script.length; i++) {
        if (script.slice(i, i + 2) === '&&' || script.slice(i, i + 2) === '||') {
          chunks.push({ text: buf, op: op || 'start' });
          op = script.slice(i, i + 2);
          buf = '';
          i++;
        } else buf += script[i];
      }
      chunks.push({ text: buf, op: op || 'start' });
      var result = { pid: 0, stdout: '', stderr: '', running: false, code: 0 };
      var outAll = '', errAll = '';
      var curCwd = cwd;
      for (i = 0; i < chunks.length; i++) {
        var ch = chunks[i];
        if (i > 0) {
          if (ch.op === '&&' && result.code !== 0) continue;
          if (ch.op === '||' && result.code === 0) continue;
        }
        result = runPipeline(ch.text, curCwd, env);
        if (result && result.cwd) curCwd = result.cwd;
        outAll += (result && result.stdout) || '';
        errAll += (result && result.stderr) || '';
      }
      result.stdout = outAll;
      result.stderr = errAll;
      if (bg && result && result.pid) __bn_bg_jobs.push(result.pid);
      return result;
    }
    function mergedEnv(env) {
      var base = {};
      var k;
      if (process.env) {
        for (k in process.env) {
          if (Object.prototype.hasOwnProperty.call(process.env, k)) base[k] = String(process.env[k]);
        }
      }
      if (env) {
        for (k in env) {
          if (Object.prototype.hasOwnProperty.call(env, k) && env[k] != null) base[k] = String(env[k]);
        }
      }
      return base;
    }
    function spawnNode(script, args, cwd, env) {
      var extra = [];
      for (var i = 1; i < (args || []).length; i++) extra.push(String(args[i]));
      var envJson = '{}';
      try { envJson = JSON.stringify(mergedEnv(env)); } catch (e) {}
      return __bn.spawnNode(String(script || ''), cwd, envJson, extra);
    }
    function spawn(cmd, args, opts) {
      args = args || [];
      opts = opts || {};
      var child = new ChildProcess();
      var cwd = opts.cwd || process.cwd();
      var env = opts.env || process.env;
      try {
        var result;
        if (isShellCmd(cmd) && args[0] === '-c') {
          result = runShellScript(args[1] || '', cwd, env);
        } else if (isNodeCmd(cmd)) result = spawnNode(args[0] || '', args, cwd, env);
        else {
          var bin = join(cwd, 'node_modules/.bin/' + String(cmd));
          if (__bn.exists && __bn.exists(bin)) result = spawnNode(bin, [bin].concat(args), cwd, env);
          else result = __bn.spawnCmd(String(cmd), args.map(String), cwd);
        }
        child.pid = result.pid;
        child.exitCode = result.running ? -1 : result.code;
        child.stdout = makeStream(result.stdout || '');
        child.stderr = makeStream(result.stderr || '');
        child.stdin = makeWritable(result.pid);
        setTimeout(function() {
          if (!result.running) {
            child.emit('exit', result.code, null);
            child.emit('close', result.code);
          }
        }, 0);
      } catch (e) {
        child.stderr = makeStream(String(e) + '\n');
        setTimeout(function() {
          child.exitCode = 1;
          child.emit('exit', 1, null);
          child.emit('close', 1);
        }, 0);
      }
      return child;
    }
    function execFile(file, args, opts, cb) {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      if (typeof args === 'function') { cb = args; args = []; opts = {}; }
      var child = spawn(file, args || [], opts || {});
      var stdout = '', stderr = '';
      child.stdout.on('data', function(c) { stdout += String(c); });
      child.stderr.on('data', function(c) { stderr += String(c); });
      child.on('close', function(code) {
        if (cb) cb(code ? new Error('exit ' + code) : null, stdout, stderr);
      });
      return child;
    }
    return {
      spawn: spawn,
      execFile: execFile,
      exec: function(command, opts, cb) {
        if (typeof opts === 'function') { cb = opts; opts = {}; }
        return execFile('sh', ['-c', String(command)], opts || {}, cb);
      },
      fork: function(modulePath, args, opts) {
        return spawn('node', [modulePath].concat(args || []), opts);
      }
    };
  }
  if (name === 'tty') {
    function ReadStream() { this.isTTY = false; }
    function WriteStream() { this.isTTY = false; this.columns = 80; this.rows = 24; }
    return {
      isatty: function() { return false; },
      ReadStream: ReadStream,
      WriteStream: WriteStream
    };
  }
  if (name === 'readline') {
    var RLEE = loadCore('events').EventEmitter;
    function ReadlineInterface(opts) {
      RLEE.call(this);
      opts = opts || {};
      this.input = opts.input || null;
      this.output = opts.output || null;
      this._buf = '';
      this._closed = false;
      this._question = null;
      var self = this;
      this._onData = function(chunk) {
        if (self._closed) return;
        var text = typeof chunk === 'string' ? chunk : (chunk && chunk.toString ? chunk.toString() : String(chunk));
        self._push(text);
      };
      if (this.input && typeof this.input.on === 'function') this.input.on('data', this._onData);
    }
    ReadlineInterface.prototype = Object.create(RLEE.prototype);
    ReadlineInterface.prototype._deliver = function(line) {
      if (this._question) {
        var ask = this._question;
        this._question = null;
        ask(line);
      }
      this.emit('line', line);
    };
    ReadlineInterface.prototype._push = function(text) {
      var parts = (this._buf + text).split(/\r?\n/);
      this._buf = parts.pop();
      for (var i = 0; i < parts.length; i++) this._deliver(parts[i]);
    };
    ReadlineInterface.prototype.question = function(q, cb) {
      if (this.output && typeof this.output.write === 'function') this.output.write(String(q));
      this._question = typeof cb === 'function' ? cb : function() {};
      return this;
    };
    ReadlineInterface.prototype.close = function() {
      if (this._closed) return this;
      this._closed = true;
      if (this.input && typeof this.input.off === 'function') this.input.off('data', this._onData);
      if (this._buf.length) {
        var rest = this._buf;
        this._buf = '';
        this._deliver(rest);
      }
      if (this.input && typeof this.input.pause === 'function') this.input.pause();
      this.emit('close');
      return this;
    };
    ReadlineInterface.prototype.pause = function() {
      if (this.input && typeof this.input.pause === 'function') this.input.pause();
      return this;
    };
    ReadlineInterface.prototype.resume = function() {
      if (this.input && typeof this.input.resume === 'function') this.input.resume();
      return this;
    };
    ReadlineInterface.prototype.write = function(s) {
      if (this.output && typeof this.output.write === 'function') this.output.write(s);
      return this;
    };
    return {
      createInterface: function(opts) { return new ReadlineInterface(opts); },
      cursorTo: function() {},
      clearLine: function() {},
      clearScreenDown: function() {},
      emitKeypressEvents: function() {}
    };
  }
  if (name === 'os') {
    return {
      platform: function() { return 'linux'; },
      type: function() { return 'Linux'; },
      release: function() { return '0.0.0'; },
      homedir: function() { return '/home'; },
      tmpdir: function() { return '/tmp'; },
      hostname: function() { return 'browsernode'; },
      EOL: '\n',
      arch: function() { return 'x64'; },
      endianness: function() { return 'LE'; },
      cpus: function() { return [{ model: 'wasm', speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }]; },
      totalmem: function() { return 256 * 1024 * 1024; },
      freemem: function() { return 128 * 1024 * 1024; },
      loadavg: function() { return [0, 0, 0]; },
      uptime: function() { return 1; },
      networkInterfaces: function() { return {}; },
      userInfo: function() { return { username: 'user', homedir: '/home', uid: 1000, gid: 1000, shell: '/bin/sh' }; },
      constants: {
        signals: {
          SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5, SIGABRT: 6, SIGIOT: 6,
          SIGBUS: 7, SIGFPE: 8, SIGKILL: 9, SIGUSR1: 10, SIGSEGV: 11, SIGUSR2: 12,
          SIGPIPE: 13, SIGALRM: 14, SIGTERM: 15, SIGSTKFLT: 16, SIGCHLD: 17, SIGCONT: 18,
          SIGSTOP: 19, SIGTSTP: 20, SIGTTIN: 21, SIGTTOU: 22, SIGURG: 23, SIGXCPU: 24,
          SIGXFSZ: 25, SIGVTALRM: 26, SIGPROF: 27, SIGWINCH: 28, SIGIO: 29, SIGPOLL: 29,
          SIGPWR: 30, SIGSYS: 31
        },
        errno: {
          EPERM: -1, ENOENT: -2, ESRCH: -3, EINTR: -4, EIO: -5, ENXIO: -6, E2BIG: -7,
          ENOEXEC: -8, EBADF: -9, ECHILD: -10, EAGAIN: -11, EWOULDBLOCK: -11, ENOMEM: -12,
          EACCES: -13, EFAULT: -14, EBUSY: -16, EEXIST: -17, EXDEV: -18, ENODEV: -19,
          ENOTDIR: -20, EISDIR: -21, EINVAL: -22, ENFILE: -23, EMFILE: -24, ENOTTY: -25,
          EFBIG: -27, ENOSPC: -28, ESPIPE: -29, EROFS: -30, EMLINK: -31, EPIPE: -32,
          ENAMETOOLONG: -36, ENOSYS: -38, ENOTEMPTY: -39, ELOOP: -40, EOVERFLOW: -75,
          ENOTSOCK: -88, EMSGSIZE: -90, EOPNOTSUPP: -95, ENOTSUP: -95, EAFNOSUPPORT: -97,
          EADDRINUSE: -98, EADDRNOTAVAIL: -99, ENETUNREACH: -101, ECONNABORTED: -103,
          ECONNRESET: -104, EISCONN: -106, ENOTCONN: -107, ETIMEDOUT: -110, ECONNREFUSED: -111,
          EHOSTUNREACH: -113, EALREADY: -114, EINPROGRESS: -115
        },
        priority: {
          PRIORITY_LOW: 19, PRIORITY_BELOW_NORMAL: 10, PRIORITY_NORMAL: 0,
          PRIORITY_ABOVE_NORMAL: -7, PRIORITY_HIGH: -14, PRIORITY_HIGHEST: -20
        }
      }
    };
  }
  if (name === 'assert') {
    function AssertionError(opts) {
      opts = opts || {};
      var msg = opts.message || 'assert failed';
      var e = new Error(msg);
      e.name = 'AssertionError';
      e.code = 'ERR_ASSERTION';
      e.actual = opts.actual;
      e.expected = opts.expected;
      e.operator = opts.operator;
      return e;
    }
    function fail(a, b, m, op) {
      throw AssertionError({ actual: a, expected: b, message: m, operator: op || 'fail' });
    }
    function deep(a, b, strict) {
      if (Object.is(a, b)) return true;
      if (typeof a !== 'object' && typeof b !== 'object') {
        if (a !== a && b !== b) return true;
        return !strict && a == b;
      }
      if (a == null || b == null) return false;
      if ((Buffer.isBuffer && Buffer.isBuffer(a)) || (Buffer.isBuffer && Buffer.isBuffer(b))) {
        if (!(Buffer.isBuffer(a) && Buffer.isBuffer(b)) || a.length !== b.length) return false;
        for (var n = 0; n < a.length; n++) if ((a._data[n] & 255) !== (b._data[n] & 255)) return false;
        return true;
      }
      if (a instanceof Date || b instanceof Date) {
        return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
      }
      if (a instanceof RegExp || b instanceof RegExp) {
        return a instanceof RegExp && b instanceof RegExp && String(a) === String(b);
      }
      if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) {
          if ((i in a) !== (i in b)) return false;
          if (!deep(a[i], b[i], strict)) return false;
        }
        return true;
      }
      if (Object.prototype.toString.call(a) !== Object.prototype.toString.call(b)) return false;
      var keys = Object.keys(a);
      if (keys.length !== Object.keys(b).length) return false;
      for (var k = 0; k < keys.length; k++) {
        if (!Object.prototype.hasOwnProperty.call(b, keys[k])) return false;
        if (!deep(a[keys[k]], b[keys[k]], strict)) return false;
      }
      return true;
    }
    function assert(v, m) { if (!v) fail(v, true, m || 'assert', '=='); }
    assert.ok = assert;
    assert.equal = function(a, b, m) { if (a != b) fail(a, b, m, '=='); };
    assert.notEqual = function(a, b, m) { if (a == b) fail(a, b, m, '!='); };
    assert.strictEqual = function(a, b, m) { if (a !== b) fail(a, b, m, '==='); };
    assert.notStrictEqual = function(a, b, m) { if (a === b) fail(a, b, m, '!=='); };
    assert.deepEqual = function(a, b, m) { if (!deep(a, b, false)) fail(a, b, m, 'deepEqual'); };
    assert.notDeepEqual = function(a, b, m) { if (deep(a, b, false)) fail(a, b, m, 'notDeepEqual'); };
    assert.deepStrictEqual = function(a, b, m) { if (!deep(a, b, true)) fail(a, b, m, 'deepStrictEqual'); };
    assert.notDeepStrictEqual = function(a, b, m) { if (deep(a, b, true)) fail(a, b, m, 'notDeepStrictEqual'); };
    assert.fail = function(m) { fail(undefined, undefined, m || 'fail', 'fail'); };
    assert.ifError = function(err) { if (err) throw err; };
    assert.throws = function(fn, err, m) {
      var threw = false, got;
      try { fn(); } catch (e) { threw = true; got = e; }
      if (!threw) fail(undefined, err, m || 'Missing expected exception', 'throws');
      if (typeof err === 'function' && !(got instanceof err)) fail(got, err, m, 'throws');
    };
    assert.doesNotThrow = function(fn, m) {
      try { fn(); } catch (e) { fail(e, undefined, m || 'Got unwanted exception', 'doesNotThrow'); }
    };
    assert.match = function(s, re, m) { if (!re.test(String(s))) fail(s, re, m, 'match'); };
    assert.doesNotMatch = function(s, re, m) { if (re.test(String(s))) fail(s, re, m, 'doesNotMatch'); };
    assert.AssertionError = AssertionError;
    var strictAssert = function(v, m) { assert(v, m); };
    strictAssert.ok = strictAssert;
    strictAssert.equal = assert.strictEqual;
    strictAssert.strictEqual = assert.strictEqual;
    strictAssert.notEqual = assert.notStrictEqual;
    strictAssert.notStrictEqual = assert.notStrictEqual;
    strictAssert.deepEqual = assert.deepStrictEqual;
    strictAssert.deepStrictEqual = assert.deepStrictEqual;
    strictAssert.notDeepEqual = assert.notDeepStrictEqual;
    strictAssert.notDeepStrictEqual = assert.notDeepStrictEqual;
    strictAssert.throws = assert.throws;
    strictAssert.doesNotThrow = assert.doesNotThrow;
    strictAssert.fail = assert.fail;
    strictAssert.ifError = assert.ifError;
    strictAssert.match = assert.match;
    strictAssert.doesNotMatch = assert.doesNotMatch;
    strictAssert.AssertionError = AssertionError;
    assert.strict = strictAssert;
    return assert;
  }
  if (name === 'querystring') {
    function parse(s, sep, eq) {
      sep = sep || '&'; eq = eq || '=';
      var o = {};
      String(s || '').split(sep).forEach(function(kv) {
        if (!kv) return;
        var i = kv.indexOf(eq);
        var k = decodeURIComponent((i < 0 ? kv : kv.slice(0, i)).replace(/\+/g, ' '));
        var v = decodeURIComponent((i < 0 ? '' : kv.slice(i + 1)).replace(/\+/g, ' '));
        if (Object.prototype.hasOwnProperty.call(o, k)) {
          if (Array.isArray(o[k])) o[k].push(v);
          else o[k] = [o[k], v];
        } else o[k] = v;
      });
      return o;
    }
    function stringify(obj, sep, eq) {
      sep = sep || '&'; eq = eq || '=';
      var keys = Object.keys(obj || {});
      var parts = [];
      keys.forEach(function(k) {
        var v = obj[k];
        if (Array.isArray(v)) {
          v.forEach(function(item) { parts.push(encodeURIComponent(k) + eq + encodeURIComponent(item)); });
        } else {
          parts.push(encodeURIComponent(k) + eq + encodeURIComponent(v == null ? '' : v));
        }
      });
      return parts.join(sep);
    }
    return { parse: parse, stringify: stringify, escape: encodeURIComponent, unescape: decodeURIComponent };
  }
  if (name === 'constants') {
    return { os: loadCore('os').constants, fs: loadCore('fs').constants, crypto: {} };
  }
  if (name === 'punycode') {
    return { toASCII: function(s) { return String(s); }, toUnicode: function(s) { return String(s); }, encode: function(s) { return String(s); }, decode: function(s) { return String(s); } };
  }
  if (name === 'sys') return loadCore('util');
  if (name === 'crypto') return __bn_load_crypto();
  if (name === 'perf_hooks') return __bn_load_perf_hooks();
  if (name === 'async_hooks') return __bn_async_hooks_module();
  if (name === 'diagnostics_channel') {
    var channels = Object.create(null);
    function Channel(name) {
      this.name = name;
      this._subs = [];
      this.hasSubscribers = false;
    }
    Channel.prototype.subscribe = function(fn) {
      this._subs.push(fn);
      this.hasSubscribers = this._subs.length > 0;
    };
    Channel.prototype.unsubscribe = function(fn) {
      this._subs = this._subs.filter(function(f) { return f !== fn; });
      this.hasSubscribers = this._subs.length > 0;
    };
    Channel.prototype.publish = function(msg) {
      for (var i = 0; i < this._subs.length; i++) {
        try { this._subs[i](msg); } catch (e) {}
      }
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
          start: function() {}, asyncStart: function() {}, asyncEnd: function() {},
          error: function() {}, end: function() {}, subscribe: function() {}, unsubscribe: function() {}
        };
      }
    };
  }
  if (name === 'module') {
    return {
      builtinModules: __bn_CORE_MODULES.slice(),
      createRequire: function(filename) {
        var file = String(filename || process.cwd() + '/.');
        if (file.indexOf('file:///') === 0) file = file.slice(7);
        else if (file.indexOf('file://') === 0) {
          file = file.slice(7);
          if (file.charAt(0) !== '/') file = '/' + file.replace(/^[^/]+/, '');
        } else if (file.indexOf('file:') === 0) file = file.slice(5);
        return createRequire(file);
      },
      wrap: function(s) { return s; }
    };
  }
  if (name === 'worker_threads') {
    var EEW = loadCore('events').EventEmitter;
    function BnWorker(filename, options) {
      EEW.call(this);
      var self = this;
      BnWorker._id = (BnWorker._id || 0) + 1;
      this.threadId = BnWorker._id;
      this.stdin = null;
      this.stdout = null;
      this.stderr = null;
      this.postMessage = function() {};
      this.terminate = function() { self.emit('exit', 0); };
      try {
        var file = String(filename);
        var code = __bn.readFile(file);
        if (code == null) throw new Error('ENOENT: ' + file);
        var wd = options && options.workerData;
        var parentPort = {
          postMessage: function(msg) {
            setTimeout(function() { self.emit('message', msg); }, 0);
          },
          on: function() { return parentPort; }
        };
        var fn = new Function('workerData', 'parentPort', 'require', 'exports', 'module', String(code));
        fn(wd, parentPort, createRequire(file), {}, { exports: {} });
        setTimeout(function() { self.emit('online'); }, 0);
      } catch (e) {
        setTimeout(function() { self.emit('error', e); }, 0);
      }
    }
    try { Object.setPrototypeOf(BnWorker.prototype, EEW.prototype); } catch (e2) {}
    return {
      isMainThread: true,
      parentPort: null,
      workerData: undefined,
      threadId: 0,
      Worker: BnWorker
    };
  }
  if (name === 'vm') {
    return {
      runInThisContext: function(code) { return (0, eval)(String(code)); },
      runInNewContext: function(code, sandbox) {
        if (typeof __bn.evalNewContext === 'function') {
          return __bn.evalNewContext(String(code));
        }
        sandbox = sandbox || {};
        var keys = Object.keys(sandbox);
        var vals = keys.map(function(k) { return sandbox[k]; });
        var fn = Function.apply(null, keys.concat([String(code)]));
        return fn.apply(sandbox, vals);
      },
      createContext: function(o) { return o || {}; },
      Script: function(code) {
        this.code = String(code);
        this.runInThisContext = function() { return (0, eval)(this.code); };
        this.runInNewContext = function(sandbox) {
          return loadCore('vm').runInNewContext(this.code, sandbox);
        };
      }
    };
  }
  if (name === 'cluster') {
    return {
      isMaster: true, isPrimary: true, isWorker: false,
      fork: function() { throw new Error('cluster.fork: unsupported in NodeBrowser'); },
      workers: {}
    };
  }
  if (name === 'dns') {
    return {
      lookup: function(host, opts, cb) {
        if (typeof opts === 'function') cb = opts;
        if (cb) setTimeout(function() { cb(null, '127.0.0.1', 4); }, 0);
      },
      resolve: function(host, cb) { if (cb) cb(null, ['127.0.0.1']); },
      promises: { lookup: function() { return Promise.resolve({ address: '127.0.0.1', family: 4 }); } }
    };
  }
  if (name === 'dgram') {
    return {
      createSocket: function() {
        return { bind: function(p, cb) { if (cb) cb(); }, send: function() {}, close: function() {}, on: function() { return this; } };
      }
    };
  }
  if (name === 'inspector' || name === 'v8') {
    return { open: function() {}, close: function() {}, url: function() { return undefined; }, serialize: function(x) { return x; } };
  }
  if (name === 'wasi') {
    return { WASI: function() { throw new Error('wasi: not implemented'); } };
  }
  if (name === 'connect') {
    return function createConnect() {
      var stack = [];
      function app(req, res) {
        var i = 0;
        function next(err) {
          if (err) { res.statusCode = 500; if (res.end) res.end(String(err)); return; }
          var fn = stack[i++];
          if (!fn) return;
          fn(req, res, next);
        }
        next();
      }
      app.use = function(fn) { stack.push(fn); return app; };
      app.listen = function(port, cb) {
        return loadCore('http').createServer(app).listen(port, cb);
      };
      return app;
    };
  }
  if (name === 'ws') {
    function Socket() {
      this.send = function() {};
      this.close = function() {};
      this.on = function() { return this; };
    }
    return {
      WebSocket: function() { return new Socket(); },
      Server: function() {
        this.on = function() { return this; };
        this.handleUpgrade = function(req, socket, head, cb) { if (cb) cb(new Socket()); };
      }
    };
  }
  if (name === 'corepack') {
    return {
      enable: function() {},
      prepare: function() { throw new Error('corepack: NodeBrowser uses npm; yarn/pnpm lockfiles are not executed'); }
    };
  }
  if (name === 'next/cache') {
    return {
      revalidatePath: function() {},
      revalidateTag: function() {},
      unstable_cache: function(fn) { return fn; },
      unstable_noStore: function() {}
    };
  }
  if (name === 'express') return __bn_load_express();
  if (name === 'next/headers') {
    return {
      cookies: function() { return { get: function() { return undefined; }, getAll: function() { return []; } }; },
      headers: function() { return { get: function() { return null; } }; }
    };
  }
  throw new Error('Unknown core ' + name);
}

/* ---- async context (Promise / timers / nextTick) ---- */
var __bn_als_list = [];
var __bn_guest_depth = 0;
var __bn_async_seq = 1;
var __bn_hook_list = [];

function __bn_als_snapshot() {
  var snap = [];
  for (var i = 0; i < __bn_als_list.length; i++) {
    var als = __bn_als_list[i];
    if (als && als._depth > 0) snap.push({ als: als, store: als._store, depth: als._depth });
  }
  return snap;
}

function __bn_als_restore(snap, fn) {
  var prev = [];
  var i;
  for (i = 0; i < snap.length; i++) {
    prev.push({ als: snap[i].als, store: snap[i].als._store, depth: snap[i].als._depth || 0 });
    snap[i].als._store = snap[i].store;
    snap[i].als._depth = snap[i].depth;
  }
  try { return fn(); }
  finally {
    for (i = 0; i < prev.length; i++) {
      prev[i].als._store = prev[i].store;
      prev[i].als._depth = prev[i].depth;
    }
  }
}

function __bn_track_async(delta) {
  if (__bn && typeof __bn.asyncPending === 'function') __bn.asyncPending(delta);
}

function __bn_async_hooks_module() {
  if (__bn && __bn.nativeAsyncHooks && typeof __bn.nativeAsyncHooks.AsyncLocalStorage === 'function') {
    return __bn.nativeAsyncHooks;
  }
  function AsyncLocalStorage() {
    this._store = undefined;
    this._depth = 0;
    __bn_als_list.push(this);
  }
  AsyncLocalStorage.prototype.run = function(store, fn) {
    var prevStore = this._store;
    var prevDepth = this._depth || 0;
    this._store = store;
    this._depth = prevDepth + 1;
    try { return fn.apply(null, Array.prototype.slice.call(arguments, 2)); }
    finally {
      this._store = prevStore;
      this._depth = prevDepth;
    }
  };
  AsyncLocalStorage.prototype.getStore = function() {
    if (!this._depth) return undefined;
    return this._store;
  };
  AsyncLocalStorage.prototype.enterWith = function(store) {
    this._store = store;
    this._depth = (this._depth || 0) + 1;
  };
  AsyncLocalStorage.prototype.disable = function() {
    this._store = undefined;
    this._depth = 0;
  };
  return {
    AsyncLocalStorage: AsyncLocalStorage,
    createHook: function(hooks) {
      var on = false;
      return {
        enable: function() {
          if (!on) { __bn_hook_list.push(hooks || {}); on = true; }
          return this;
        },
        disable: function() {
          __bn_hook_list = __bn_hook_list.filter(function(h) { return h !== hooks; });
          on = false;
          return this;
        }
      };
    },
    executionAsyncId: function() { return __bn_async_seq; },
    triggerAsyncId: function() { return __bn_async_seq > 1 ? __bn_async_seq - 1 : 0; }
  };
}

function __bn_module_fn(code) {
  var wrapped = '(function(exports, require, module, __filename, __dirname, console, process, globalThis, setTimeout, setInterval, clearTimeout, clearInterval){\n'
    + 'var Buffer=globalThis.Buffer;\n' + code + '\n})';
  return (0, eval)(wrapped);
}

function __bn_call_module(fn, exportsObj, requireFn, mod, resolved) {
  __bn_guest_depth++;
  __bn_async_seq++;
  try {
    return fn(
      exportsObj,
      requireFn,
      mod,
      resolved,
      dirname(resolved),
      globalThis.console,
      process,
      globalThis,
      globalThis.setTimeout,
      globalThis.setInterval,
      globalThis.clearTimeout,
      globalThis.clearInterval
    );
  } finally {
    __bn_guest_depth--;
  }
}

/* ---- createRequire / runMain / dynamic import ---- */
function createRequire(fromFile) {
  var fromDir = dirname(fromFile);
  var fromEsm = false;
  try { fromEsm = !!isEsmFile(fromFile); } catch (eEsm) { fromEsm = false; }
  return function require(request) {
    var prevCond = globalThis.__bn_cond;
    globalThis.__bn_cond = globalThis.__bn_force_cond || (fromEsm ? 'import' : 'require');
    try {
      return __bn_require_resolved(fromDir, request);
    } finally {
      globalThis.__bn_cond = prevCond;
    }
  };
}

function __bn_require_resolved(fromDir, request) {
  var reqs = String(request);
  if (reqs === 'next/cache' || reqs === 'next/headers') {
    try {
      var installed = resolveFrom(fromDir, reqs);
      if (installed && __bn.readFile(installed) !== null) {
        request = reqs;
      } else {
        return loadCore(reqs);
      }
    } catch (e) {
      return loadCore(reqs);
    }
  }
  var resolved = resolveFrom(fromDir, String(request));
  if (resolved.indexOf('node:') === 0) return loadCore(resolved.slice(5));
  if (/\.node$/i.test(resolved) || reqs === 'fsevents') {
    throw new Error('BN_GRAPH: native addon not available in QuickJS: ' + reqs);
  }
  if (reqs === 'esbuild' || /\/node_modules\/esbuild(\/|$)/.test(resolved)) {
    throw new Error('BN_GRAPH: native esbuild is not available in QuickJS');
  }
  if (moduleCache[resolved]) return moduleCache[resolved].exports;
  var mod = makeModule(resolved);
  moduleCache[resolved] = mod;
  var code = __bn.readFile(resolved);
  if (code === null) throw new Error('ENOENT ' + resolved);
  if (/\.json$/i.test(resolved)) {
    mod.exports = JSON.parse(code);
    mod.loaded = true;
    return mod.exports;
  }
  code = __bn_strip_shebang(code);
  if (isEsmFile(resolved)) code = __bn_rewrite_esm(code, resolved);
  code += '\n; if(typeof module.exports==="undefined") module.exports=exports;\n';
  var fn = __bn_module_fn(code);
  __bn_call_module(fn, mod.exports, mod.require, mod, resolved);
  mod.loaded = true;
  return mod.exports;
}

function __bn_strip_shebang(code) {
  var s = String(code);
  if (s.charAt(0) === '#' && s.charAt(1) === '!') {
    var nl = s.indexOf('\n');
    return nl >= 0 ? s.slice(nl + 1) : '';
  }
  return s;
}

function __bn_dynamic_import(spec) {
  return Promise.resolve().then(function() {
    var prev = globalThis.__bn_force_cond;
    globalThis.__bn_force_cond = 'import';
    try { return createRequire(process.cwd() + '/.')(String(spec)); }
    finally { globalThis.__bn_force_cond = prev; }
  });
}

function __bn_runMain(filename) {
  if (!process.argv || process.argv.length < 2) {
    process.argv = ['node', filename];
  }
  try {
    var path = filename.charAt(0) === '/' ? filename : join(process.cwd(), filename);
    var resolved = resolveFile(path);
    if (!resolved) throw new Error('Cannot find ' + filename);
    var code = __bn.readFile(resolved);
    if (code === null) throw new Error('Cannot find ' + filename);
    code = __bn_strip_shebang(code);
    var mod = makeModule(resolved);
    moduleCache[resolved] = mod;
    if (isEsmFile(resolved)) code = __bn_rewrite_esm(code, resolved);
    var fn = __bn_module_fn(code);
    __bn_call_module(fn, mod.exports, createRequire(resolved), mod, resolved);
    if (typeof __bn_drain_ticks === 'function') __bn_drain_ticks();
    return process.exitCode | 0;
  } catch (e) {
    if (e && typeof e === 'object' && '__bn_exit' in e) return e.__bn_exit;
    console.error(e && e.stack ? e.stack : String(e));
    return 1;
  }
}

globalThis.require = createRequire(process.cwd() + '/.');
globalThis.__bn_dynamic_import = __bn_dynamic_import;
globalThis.__bn_runMain = __bn_runMain;
globalThis.__bn_rewrite_esm = __bn_rewrite_esm;
globalThis.isEsmFile = isEsmFile;
globalThis.fetch = function(input, init) {
  init = init || {};
  var url = typeof input === 'string' ? input : (input && input.url) || String(input);
  var m = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::(\d+))?(\/[^?]*)?(\?.*)?$/i.exec(String(url));
  if (m && typeof __bn.httpDispatch === 'function') {
    var port = m[1] ? (m[1] | 0) : 80;
    var path = (m[2] || '/') + (m[3] || '');
    var method = String(init.method || 'GET');
    var headers = JSON.stringify(init.headers || {});
    var body = init.body == null ? '' : String(init.body);
    var raw = __bn.httpDispatch(port, method, path, headers, body);
    var parsed = { status: 502, headers: {}, body: 'no listener' };
    if (raw) {
      try { parsed = JSON.parse(raw); } catch (e) {}
    }
    var bodyStr = parsed.body || '';
    var status = parsed.status | 0;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status: status,
      statusText: String(status),
      headers: { get: function(k) { var h = parsed.headers || {}; return h[k] || h[String(k).toLowerCase()] || null; } },
      text: function() { return Promise.resolve(bodyStr); },
      json: function() { return Promise.resolve(JSON.parse(bodyStr || 'null')); },
      arrayBuffer: function() { return Promise.resolve(new ArrayBuffer(0)); }
    });
  }
  return Promise.reject(new Error('fetch: guest has no raw internet; use virtual http.Server or host npm allowlist'));
};

function __bn_install_async_bridge() {
  if (globalThis.__bn_async_bridge) return;
  globalThis.__bn_async_bridge = true;
  function guestBind(fn, snap, track) {
    if (!track || typeof fn !== 'function') return fn;
    return function(v) {
      __bn_guest_depth++;
      try { return __bn_als_restore(snap, function() { return fn(v); }); }
      finally {
        __bn_guest_depth--;
        __bn_track_async(-1);
      }
    };
  }
  var origThen = Promise && Promise.prototype && Promise.prototype.then;
  if (typeof origThen === 'function' && !origThen.__bn) {
    var wrappedThen = function(onF, onR) {
      var snap = __bn_als_snapshot();
      var track = (__bn_guest_depth > 0 || snap.length > 0) && (typeof onF === 'function' || typeof onR === 'function');
      if (track) __bn_track_async(1);
      return origThen.call(this, guestBind(onF, snap, track), guestBind(onR, snap, track));
    };
    wrappedThen.__bn = true;
    Promise.prototype.then = wrappedThen;
  }
  function wrapTimer(orig) {
    if (typeof orig !== 'function' || orig.__bn) return orig;
    var wrapped = function(fn, ms) {
      if (typeof fn !== 'function') return orig(fn, ms);
      var snap = __bn_als_snapshot();
      var args = Array.prototype.slice.call(arguments, 2);
      return orig(function() {
        __bn_guest_depth++;
        try { return __bn_als_restore(snap, function() { return fn.apply(null, args); }); }
        finally { __bn_guest_depth--; }
      }, ms);
    };
    wrapped.__bn = true;
    return wrapped;
  }
  if (typeof globalThis.setTimeout === 'function') globalThis.setTimeout = wrapTimer(globalThis.setTimeout);
  if (typeof globalThis.setInterval === 'function') globalThis.setInterval = wrapTimer(globalThis.setInterval);
  if (typeof process !== 'undefined' && typeof process.nextTick === 'function' && !process.nextTick.__bn) {
    var origTick = process.nextTick;
    var wrappedTick = function(fn) {
      var snap = __bn_als_snapshot();
      var track = __bn_guest_depth > 0 || snap.length > 0;
      var args = Array.prototype.slice.call(arguments, 1);
      if (track) __bn_track_async(1);
      return origTick(function() {
        __bn_guest_depth++;
        try { return __bn_als_restore(snap, function() { return fn.apply(null, args); }); }
        finally {
          __bn_guest_depth--;
          if (track) __bn_track_async(-1);
        }
      });
    };
    wrappedTick.__bn = true;
    process.nextTick = wrappedTick;
  }
}
__bn_install_async_bridge();

function __bn_install_stdin() {
  if (typeof process === 'undefined' || !__bn || typeof __bn.readStdin !== 'function') return;
  if (process.stdin && process.stdin.__bn_live) return;
  var EE = loadCore('events').EventEmitter;
  function Stdin() {
    EE.call(this);
    this.isTTY = false;
    this.readable = true;
    this._flowing = false;
    this._poll = 0;
  }
  Stdin.prototype = Object.create(EE.prototype);
  Stdin.prototype.read = function() {
    if (this._ended) return null;
    var ab = __bn.readStdin();
    if (ab && ab.byteLength) return Buffer.from(ab);
    if (__bn.stdinClosed && __bn.stdinClosed()) this._finish();
    return null;
  };
  Stdin.prototype._finish = function() {
    if (this._ended) return;
    this._ended = true;
    this.readable = false;
    this.pause();
    this.emit('end');
    this.emit('close');
  };
  Stdin.prototype.pause = function() {
    this._flowing = false;
    if (this._poll) {
      clearInterval(this._poll);
      this._poll = 0;
    }
    return this;
  };
  Stdin.prototype.resume = function() {
    if (this._flowing || this._ended) return this;
    this._flowing = true;
    var self = this;
    this._poll = setInterval(function() {
      var chunk = self.read();
      if (chunk && chunk.length) self.emit('data', chunk);
    }, 0);
    return this;
  };
  Stdin.prototype.on = function(ev, fn) {
    EE.prototype.on.call(this, ev, fn);
    if (ev === 'data') this.resume();
    return this;
  };
  Stdin.prototype.setRawMode = function() { return this; };
  Stdin.prototype.__bn_live = true;
  process.stdin = new Stdin();
}
__bn_install_stdin();

function __bn_hr_now() {
  if (__bn.hrtime) {
    var pair = __bn.hrtime();
    return [pair[0], pair[1] | 0];
  }
  var ms = Date.now();
  return [Math.floor(ms / 1000), (ms % 1000) * 1000000];
}
function __bn_hr_sub(now, prev) {
  var sec = now[0] - prev[0];
  var nano = now[1] - prev[1];
  if (nano < 0) {
    sec -= 1;
    nano += 1000000000;
  }
  return [sec, nano];
}
function __bn_install_hrtime() {
  if (!process || process.hrtime) return;
  var start = __bn_hr_now();
  function hrtime(prev) {
    var abs = __bn_hr_sub(__bn_hr_now(), start);
    if (prev == null) return abs;
    return __bn_hr_sub(abs, [prev[0] | 0, prev[1] | 0]);
  }
  hrtime.bigint = function(prev) {
    if (typeof BigInt !== 'function') {
      var err = new Error('BigInt is not available');
      err.code = 'ERR_NO_BIGINT';
      throw err;
    }
    var unit = BigInt('1000000000');
    var now = hrtime();
    var value = BigInt(now[0]) * unit + BigInt(now[1] < 0 ? 0 : now[1]);
    if (typeof prev === 'bigint') return value - prev;
    if (prev == null) return value;
    var delta = hrtime(prev);
    return BigInt(delta[0]) * unit + BigInt(delta[1] < 0 ? 0 : delta[1]);
  };
  process.hrtime = hrtime;
  process.uptime = function() {
    var t = hrtime();
    return t[0] + t[1] / 1000000000;
  };
}
__bn_install_hrtime();

function __bn_abs_path(p) {
  p = String(p == null ? '' : p);
  if (p.charAt(0) === '/') {
    var rootParts = p.split('/');
    var rootStack = [];
    for (var r = 0; r < rootParts.length; r++) {
      if (!rootParts[r] || rootParts[r] === '.') continue;
      if (rootParts[r] === '..') rootStack.pop();
      else rootStack.push(rootParts[r]);
    }
    return '/' + rootStack.join('/');
  }
  var cwd = (process.cwd && process.cwd()) || '/';
  if (cwd.charAt(cwd.length - 1) !== '/') cwd += '/';
  var parts = (cwd + p).split('/');
  var stack = [];
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i] || parts[i] === '.') continue;
    if (parts[i] === '..') stack.pop();
    else stack.push(parts[i]);
  }
  return '/' + stack.join('/');
}
function __bn_wrap_cwd() {
  function wrap(name, argcPath) {
    var fn = __bn[name];
    if (typeof fn !== 'function' || fn.__bn_abs) return;
    var next = function() {
      var args = Array.prototype.slice.call(arguments);
      for (var i = 0; i < argcPath.length; i++) {
        var idx = argcPath[i];
        if (args.length > idx && args[idx] != null) args[idx] = __bn_abs_path(args[idx]);
      }
      return fn.apply(__bn, args);
    };
    next.__bn_abs = true;
    __bn[name] = next;
  }
  wrap('readFile', [0]);
  wrap('readBytes', [0]);
  wrap('writeFile', [0]);
  wrap('writeBytes', [0]);
  wrap('exists', [0]);
  wrap('isFile', [0]);
  wrap('isDir', [0]);
  wrap('isSymlink', [0]);
  wrap('lstatKind', [0]);
  wrap('readdir', [0]);
  wrap('mkdir', [0]);
  wrap('unlink', [0]);
  wrap('rmdir', [0]);
  wrap('readlink', [0]);
  wrap('chmod', [0]);
  wrap('utimes', [0]);
  wrap('statJson', [0]);
  wrap('rename', [0, 1]);
  var link = __bn.symlink;
  if (typeof link === 'function' && !link.__bn_abs) {
    var nextLink = function(target, path) { return link.call(__bn, String(target), __bn_abs_path(path)); };
    nextLink.__bn_abs = true;
    __bn.symlink = nextLink;
  }
}
function __bn_install_chdir() {
  if (!process || process.chdir) return;
  __bn_wrap_cwd();
  process.chdir = function(dir) {
    if (!__bn.chdir) {
      var missing = new Error('chdir is not available');
      missing.code = 'ENOSYS';
      throw missing;
    }
    var rc = __bn.chdir(__bn_abs_path(dir)) | 0;
    if (rc === 2) {
      var eno = new Error('ENOENT: ' + dir);
      eno.code = 'ENOENT';
      throw eno;
    }
    if (rc === 1) {
      var nd = new Error('ENOTDIR: ' + dir);
      nd.code = 'ENOTDIR';
      throw nd;
    }
    if (rc !== 0) {
      var perm = new Error('EPERM: ' + dir);
      perm.code = 'EPERM';
      throw perm;
    }
  };
}
__bn_install_chdir();

)GUESTJS";
