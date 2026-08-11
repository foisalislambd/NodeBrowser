/**
 * Shared Buffer + fs.promises + Vite-enabler snippets for Node bootstrap
 * (QuickJS / JS fallback). Kept as string exports so C++ and TS can embed
 * the same source.
 */

export const BUFFER_POLYFILL = `
var Buffer = (function() {
  function Buffer(arg, enc) {
    if (!(this instanceof Buffer)) return new Buffer(arg, enc);
    if (typeof arg === 'number') {
      this._data = new Uint8Array(arg);
    } else if (typeof arg === 'string') {
      this._data = Buffer._encode(arg, enc || 'utf8');
    } else if (arg instanceof Uint8Array) {
      this._data = new Uint8Array(arg);
    } else if (Array.isArray(arg)) {
      this._data = new Uint8Array(arg);
    } else {
      this._data = new Uint8Array(0);
    }
    this.length = this._data.length;
    return new Proxy(this, {
      get: function(t, p, r) {
        if (typeof p === 'string' && /^[0-9]+$/.test(p)) {
          var i = p | 0;
          if (i >= 0 && i < t.length) return t._data[i];
        }
        var v = Reflect.get(t, p, r);
        if (typeof v === 'function') return v.bind(t);
        return v;
      },
      set: function(t, p, v) {
        if (typeof p === 'string' && /^[0-9]+$/.test(p)) {
          var i = p | 0;
          if (i >= 0 && i < t.length) { t._data[i] = v & 255; return true; }
        }
        t[p] = v;
        return true;
      },
    });
  }
  Buffer._encode = function(s, enc) {
    enc = (enc || 'utf8').toLowerCase();
    if (enc === 'utf8' || enc === 'utf-8') {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
      var a = [];
      for (var i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 255);
      return new Uint8Array(a);
    }
    if (enc === 'hex') {
      var clean = s.replace(/[^0-9a-f]/gi, '');
      var out = new Uint8Array(clean.length / 2);
      for (var j = 0; j < out.length; j++) out[j] = parseInt(clean.substr(j * 2, 2), 16);
      return out;
    }
    if (enc === 'base64') {
      var bin = typeof atob !== 'undefined' ? atob(s) : '';
      var u = new Uint8Array(bin.length);
      for (var k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
      return u;
    }
    return Buffer._encode(s, 'utf8');
  };
  Buffer._decode = function(u8, enc) {
    enc = (enc || 'utf8').toLowerCase();
    if (enc === 'utf8' || enc === 'utf-8') {
      if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(u8);
      var s = '';
      for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
      return s;
    }
    if (enc === 'hex') {
      var h = '';
      for (var j = 0; j < u8.length; j++) h += (u8[j] + 256).toString(16).slice(1);
      return h;
    }
    if (enc === 'base64') {
      var bin = '';
      for (var k = 0; k < u8.length; k++) bin += String.fromCharCode(u8[k]);
      return typeof btoa !== 'undefined' ? btoa(bin) : bin;
    }
    return Buffer._decode(u8, 'utf8');
  };
  Buffer.alloc = function(n, fill) {
    var b = new Buffer(n);
    if (fill != null) b._data.fill(typeof fill === 'number' ? fill : 0);
    return b;
  };
  Buffer.from = function(arg, enc) { return new Buffer(arg, enc); };
  Buffer.isBuffer = function(x) { return x instanceof Buffer; };
  Buffer.concat = function(list, len) {
    if (!len) { len = 0; for (var i = 0; i < list.length; i++) len += list[i].length; }
    var out = new Uint8Array(len), o = 0;
    for (var j = 0; j < list.length; j++) {
      var d = list[j]._data || list[j];
      out.set(d, o); o += d.length;
    }
    return Buffer.from(out);
  };
  Buffer.prototype.toString = function(enc) { return Buffer._decode(this._data, enc || 'utf8'); };
  Buffer.prototype.slice = function(s, e) { return Buffer.from(this._data.subarray(s || 0, e)); };
  Buffer.prototype.equals = function(other) {
    if (!Buffer.isBuffer(other) || other.length !== this.length) return false;
    for (var i = 0; i < this.length; i++) if (this._data[i] !== other._data[i]) return false;
    return true;
  };
  return Buffer;
})();
globalThis.Buffer = Buffer;
`;

export const FS_PROMISES_HELPER = `
function __bn_fs_promises(fs) {
  return {
    readFile: function(p, enc) { return Promise.resolve().then(function(){ return fs.readFileSync(p, enc); }); },
    writeFile: function(p, data, enc) { return Promise.resolve().then(function(){ return fs.writeFileSync(p, data, enc); }); },
    mkdir: function(p, opts) { return Promise.resolve().then(function(){ return fs.mkdirSync(p, opts); }); },
    readdir: function(p) { return Promise.resolve().then(function(){ return fs.readdirSync(p); }); },
    unlink: function(p) { return Promise.resolve().then(function(){ return fs.unlinkSync(p); }); },
    stat: function(p) { return Promise.resolve().then(function(){ return fs.statSync(p); }); },
    access: function(p) { return Promise.resolve().then(function(){ if (!fs.existsSync(p)) throw new Error('ENOENT'); }); },
    rm: function(p) { return Promise.resolve().then(function(){ return fs.unlinkSync(p); }); },
  };
}
`;

/** process.nextTick with drain queue (flushed at end of main + via queueMicrotask). */
export const PROCESS_NEXTTICK = `
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
`;

/**
 * crypto subset: randomFillSync / randomBytes via WebCrypto getRandomValues.
 * createHash('sha256') uses a small sync pure-JS implementation.
 */
export const CRYPTO_POLYFILL = `
function __bn_crypto_random_fill(u8) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(u8);
    return u8;
  }
  for (var i = 0; i < u8.length; i++) u8[i] = (Math.random() * 256) | 0;
  return u8;
}
function __bn_sha256(bytes) {
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
  var out = new Uint8Array(32);
  var hs = [h0,h1,h2,h3,h4,h5,h6,h7];
  for (var i = 0; i < 8; i++) {
    out[i*4] = (hs[i] >>> 24) & 255;
    out[i*4+1] = (hs[i] >>> 16) & 255;
    out[i*4+2] = (hs[i] >>> 8) & 255;
    out[i*4+3] = hs[i] & 255;
  }
  return out;
}
function __bn_load_crypto() {
  return {
    randomFillSync: function(buf, offset, size) {
      offset = offset == null ? 0 : offset | 0;
      var fillInto;
      if (Buffer.isBuffer && Buffer.isBuffer(buf)) {
        size = size == null ? buf.length - offset : size | 0;
        if (offset < 0 || size < 0 || offset + size > buf.length) {
          throw new RangeError('randomFillSync: out of range');
        }
        fillInto = new Uint8Array(size);
        __bn_crypto_random_fill(fillInto);
        buf._data.set(fillInto, offset);
        return buf;
      }
      if (buf instanceof Uint8Array) {
        size = size == null ? buf.length - offset : size | 0;
        if (offset < 0 || size < 0 || offset + size > buf.length) {
          throw new RangeError('randomFillSync: out of range');
        }
        fillInto = new Uint8Array(size);
        __bn_crypto_random_fill(fillInto);
        buf.set(fillInto, offset);
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
      alg = String(alg || '').toLowerCase();
      if (alg !== 'sha256' && alg !== 'sha-256') {
        throw new Error('createHash: only sha256 is supported in BrowserNode');
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
          var len = 0;
          for (var i = 0; i < chunks.length; i++) len += chunks[i].length;
          var all = new Uint8Array(len), o = 0;
          for (var j = 0; j < chunks.length; j++) { all.set(chunks[j], o); o += chunks[j].length; }
          var dig = __bn_sha256(all);
          if (enc === 'hex') {
            var h = '';
            for (var k = 0; k < dig.length; k++) h += (dig[k] + 256).toString(16).slice(1);
            return h;
          }
          return Buffer.from(dig);
        },
      };
    },
  };
}
`;

export const PERF_HOOKS_POLYFILL = `
function __bn_load_perf_hooks() {
  var nowFn = function() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
    return Date.now();
  };
  function PerformanceObserver() {}
  PerformanceObserver.prototype.observe = function() {};
  PerformanceObserver.prototype.disconnect = function() {};
  return {
    performance: { now: nowFn, timeOrigin: 0 },
    PerformanceObserver: PerformanceObserver,
    constants: {},
  };
}
`;
