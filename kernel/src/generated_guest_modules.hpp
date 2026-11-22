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

function resolveFrom(fromDir, request) {
  if (request.indexOf('node:') === 0) return request;
  if (request.charAt(0) === '.' || request.charAt(0) === '/') {
    var hit = resolveFile(request.charAt(0) === '/' ? request : join(fromDir, request));
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
    createCipheriv: function() { throw new Error('crypto.createCipheriv: unsupported'); },
    createDecipheriv: function() { throw new Error('crypto.createDecipheriv: unsupported'); }
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
  return {
    inherits: function(c, s) { c.prototype = Object.create(s.prototype); c.prototype.constructor = c; },
    format: function() {
      var args = Array.prototype.slice.call(arguments);
      var f = String(args.shift());
      return f.replace(/%[sdj%]/g, function(x) {
        if (x === '%%') return '%';
        if (!args.length) return x;
        if (x === '%s') return String(args.shift());
        if (x === '%d') return Number(args.shift());
        if (x === '%j') try { return JSON.stringify(args.shift()); } catch (e) { return '[Circular]'; }
        return x;
      });
    },
    inspect: function(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } },
    promisify: promisify,
    callbackify: callbackify,
    deprecate: function(fn) { return fn; },
    isDeepStrictEqual: function(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return a === b; } },
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
  function StringDecoder(encoding) { this.encoding = encoding || 'utf8'; }
  StringDecoder.prototype.write = function(buf) {
    if (typeof buf === 'string') return buf;
    if (Buffer.isBuffer && Buffer.isBuffer(buf)) return buf.toString(this.encoding);
    if (buf instanceof Uint8Array) return Buffer.from(buf).toString(this.encoding);
    return String(buf);
  };
  StringDecoder.prototype.end = function(buf) { return buf ? this.write(buf) : ''; };
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
        headersSent: false,
        setHeader: function(k, v) { headers[k] = v; },
        writeHead: function(code, hds) {
          status = code | 0;
          this.statusCode = status;
          this.headersSent = true;
          if (hds) for (var k in hds) if (Object.prototype.hasOwnProperty.call(hds, k)) headers[k] = hds[k];
        },
        write: function(chunk) {
          bodyParts.push(String(chunk == null ? '' : chunk));
          return true;
        },
        end: function(chunk) {
          if (ended) return;
          if (chunk != null) bodyParts.push(String(chunk));
          ended = true;
          res.writeHead(status, headers);
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
    this.statusMessage = '';
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
    }
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
    function __bn_write_all(path, arr) {
      var u8 = new Uint8Array(arr.length);
      for (var i = 0; i < arr.length; i++) u8[i] = arr[i] & 255;
      if (__bn.writeBytes) {
        if (!__bn.writeBytes(String(path), u8.buffer)) __bn_fs_code('EIO', 'EIO');
        return;
      }
      if (!__bn.writeFile(String(path), Buffer.from(u8).toString())) __bn_fs_code('EIO', 'EIO');
    }
    var fs = {
      constants: {
        F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1,
        O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_TRUNC: 512, O_APPEND: 1024,
        S_IFMT: 61440, S_IFREG: 32768, S_IFDIR: 16384, S_IFLNK: 40960
      },
      readFileSync: function(p, enc) {
        if (enc === 'buffer' || (enc && enc.encoding === 'buffer')) {
          var b = __bn.readBytes ? __bn.readBytes(String(p)) : null;
          if (b === null) {
            var t0 = __bn.readFile(String(p));
            if (t0 === null) throw new Error('ENOENT: ' + p);
            return Buffer.from(t0);
          }
          return Buffer.from(b);
        }
        var t = __bn.readFile(String(p));
        if (t === null) throw new Error('ENOENT: ' + p);
        return t;
      },
      writeFileSync: function(p, d) {
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
        if (!__bn.writeFile(String(p), String(d))) throw new Error('EIO');
      },
      existsSync: function(p) { return !!__bn.exists(String(p)); },
      accessSync: function(p) {
        if (!__bn.exists(String(p))) {
          var e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e;
        }
      },
      mkdirSync: function(p, opts) {
        if (!__bn.mkdir(String(p), !!(opts && opts.recursive))) throw new Error('EEXIST mkdir: ' + p);
      },
      readdirSync: function(p) {
        var a = __bn.readdir(String(p));
        if (a === null) throw new Error('ENOENT');
        return a;
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
            var n = names[i++];
            return { name: n };
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
        var path = String(p);
        if (path.charAt(0) !== '/') path = join(process.cwd(), path);
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
            close: function() { return Promise.resolve().then(function() { fs.closeSync(fd); }); }
          };
        });
      };
    }
    return fs;
  }
  if (name === 'path') {
    var pathApi = {
      join: join,
      dirname: dirname,
      basename: function(p) { return __bn_basename(p); },
      resolve: function() {
        var args = Array.prototype.slice.call(arguments);
        var r = args[0] && args[0].charAt(0) === '/' ? '' : process.cwd();
        for (var i = 0; i < args.length; i++) r = join(r || '/', args[i]);
        return r.replace(/\/+/g, '/') || '/';
      },
      extname: function(p) {
        var i = String(p).lastIndexOf('.');
        return i < 0 ? '' : p.slice(i);
      },
      sep: '/',
      delimiter: ':',
      isAbsolute: function(p) { return String(p).charAt(0) === '/'; },
      normalize: function(p) { return join('/', String(p)); },
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
    pathApi.posix = pathApi;
    pathApi.win32 = pathApi;
    return pathApi;
  }
  if (name === 'events') {
    function EE() { this._e = Object.create(null); }
    EE.prototype.on = function(ev, fn) {
      (this._e[ev] || (this._e[ev] = [])).push(fn);
      return this;
    };
    EE.prototype.once = function(ev, fn) {
      var self = this;
      function w() {
        self.off(ev, w);
        fn.apply(this, arguments);
      }
      this.on(ev, w);
      return this;
    };
    EE.prototype.off = function(ev, fn) {
      var list = this._e[ev] || [];
      this._e[ev] = list.filter(function(f) { return f !== fn; });
      return this;
    };
    EE.prototype.removeListener = EE.prototype.off;
    EE.prototype.removeAllListeners = function(ev) {
      if (ev == null) this._e = Object.create(null);
      else delete this._e[ev];
      return this;
    };
    EE.prototype.listenerCount = function(ev) { return (this._e[ev] || []).length; };
    EE.prototype.listeners = function(ev) { return (this._e[ev] || []).slice(); };
    EE.prototype.setMaxListeners = function() { return this; };
    EE.prototype.emit = function(ev) {
      var args = Array.prototype.slice.call(arguments, 1);
      var list = (this._e[ev] || []).slice();
      for (var i = 0; i < list.length; i++) list[i].apply(this, args);
      return list.length > 0;
    };
    return { EventEmitter: EE };
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
      if (s.slice(0, 7) === 'file://') {
        s = s.slice(7);
        if (s.slice(0, 2) === '//') {
          var slash = s.indexOf('/', 2);
          s = slash >= 0 ? s.slice(slash) : '/';
        }
        if (s.charAt(0) !== '/') s = '/' + s;
        try { s = decodeURIComponent(s); } catch (e) {}
      }
      return s;
    }
    function pathToFileURL(p) {
      var path = String(p);
      if (path.charAt(0) !== '/') path = '/' + path;
      var href = 'file://' + path.split('/').map(function(seg) { return encodeURIComponent(seg); }).join('/');
      href = href.replace('file://', 'file:///');
      return { href: href, pathname: path, protocol: 'file:', toString: function() { return href; } };
    }
    return {
      parse: function(u) {
        try {
          var x = new URL(u, 'http://localhost');
          return { href: x.href, pathname: x.pathname, hostname: x.hostname, protocol: x.protocol };
        } catch (e) {
          return { href: u, pathname: '/' };
        }
      },
      URL: typeof URL !== 'undefined' ? URL : undefined,
      URLSearchParams: typeof URLSearchParams !== 'undefined' ? URLSearchParams : undefined,
      fileURLToPath: fileURLToPath,
      pathToFileURL: pathToFileURL,
      format: function(o) { return (o && o.href) || String(o); }
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
      constants: { signals: {}, errno: {} }
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
    function deep(a, b) {
      if (a === b) return true;
      if (a && b && typeof a === 'object' && typeof b === 'object') {
        try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
      }
      return false;
    }
    function assert(v, m) { if (!v) fail(v, true, m || 'assert', '=='); }
    assert.ok = assert;
    assert.equal = function(a, b, m) { if (a != b) fail(a, b, m, '=='); };
    assert.notEqual = function(a, b, m) { if (a == b) fail(a, b, m, '!='); };
    assert.strictEqual = function(a, b, m) { if (a !== b) fail(a, b, m, '==='); };
    assert.notStrictEqual = function(a, b, m) { if (a === b) fail(a, b, m, '!=='); };
    assert.deepEqual = function(a, b, m) { if (!deep(a, b)) fail(a, b, m, 'deepEqual'); };
    assert.notDeepEqual = function(a, b, m) { if (deep(a, b)) fail(a, b, m, 'notDeepEqual'); };
    assert.deepStrictEqual = assert.deepEqual;
    assert.notDeepStrictEqual = assert.notDeepEqual;
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
    return { os: {}, fs: loadCore('fs').constants, crypto: {} };
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
    var ab = __bn.readStdin();
    if (!ab || !ab.byteLength) return null;
    return Buffer.from(ab);
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
    if (this._flowing) return this;
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

)GUESTJS";
