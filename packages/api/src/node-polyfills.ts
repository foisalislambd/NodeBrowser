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
    access: function(p) { return Promise.resolve().then(function(){ return fs.accessSync ? fs.accessSync(p) : (function(){ if (!fs.existsSync(p)) throw new Error('ENOENT'); })(); }); },
    realpath: function(p) { return Promise.resolve().then(function(){ return fs.realpathSync(p); }); },
    copyFile: function(src, dest) { return Promise.resolve().then(function(){ return fs.copyFileSync(src, dest); }); },
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
 * createHash: sync pure-JS for sha1 + sha256; sha384/sha512 throw (use WebCrypto async outside createHash).
 * Ciphers (createCipheriv etc.) are intentionally stubbed — document as unsupported.
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
function __bn_sha1(bytes) {
  function rotr(n, x) { return (x << (32 - n)) | (x >>> n); }
  var h0=0x67452301,h1=0xEFCDAB89,h2=0x98BADCFE,h3=0x10325476,h4=0xC3D2E1F0;
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
      w[j] = ((msg[o] << 24) | (msg[o+1] << 16) | (msg[o+2] << 8) | msg[o+3]) >>> 0;
    }
    for (var j = 16; j < 80; j++) {
      w[j] = rotr(31, w[j-3] ^ w[j-8] ^ w[j-14] ^ w[j-16]) >>> 0;
    }
    var a=h0,b=h1,c=h2,d=h3,e=h4;
    for (var j = 0; j < 80; j++) {
      var f, k;
      if (j < 20) { f = (b & c) | ((~b) & d); k = 0x5A827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      var temp = (rotr(27, a) + f + e + k + w[j]) >>> 0;
      e = d; d = c; c = rotr(2, b) >>> 0; b = a; a = temp;
    }
    h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0; h4=(h4+e)>>>0;
  }
  var out = new Uint8Array(20);
  var hs = [h0,h1,h2,h3,h4];
  for (var i = 0; i < 5; i++) {
    out[i*4] = (hs[i] >>> 24) & 255;
    out[i*4+1] = (hs[i] >>> 16) & 255;
    out[i*4+2] = (hs[i] >>> 8) & 255;
    out[i*4+3] = hs[i] & 255;
  }
  return out;
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
      alg = String(alg || '').toLowerCase().replace(/^sha-/, 'sha');
      var supported = { sha1:1, sha256:1 };
      if (!supported[alg]) {
        if (alg === 'sha384' || alg === 'sha512') {
          throw new Error('createHash: ' + alg + ' not available sync (supported: sha1, sha256)');
        }
        throw new Error('createHash: unsupported algorithm ' + alg + ' (supported: sha1, sha256)');
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
          var dig = alg === 'sha1' ? __bn_sha1(all) : __bn_sha256(all);
          if (enc === 'hex') {
            var h = '';
            for (var k = 0; k < dig.length; k++) h += (dig[k] + 256).toString(16).slice(1);
            return h;
          }
          return Buffer.from(dig);
        },
      };
    },
    createHmac: function() {
      throw new Error('crypto.createHmac: not implemented in NodeBrowser');
    },
    createCipher: function() {
      throw new Error('crypto.createCipher: unsupported in NodeBrowser (ciphers stubbed)');
    },
    createCipheriv: function() {
      throw new Error('crypto.createCipheriv: unsupported in NodeBrowser (ciphers stubbed)');
    },
    createDecipher: function() {
      throw new Error('crypto.createDecipher: unsupported in NodeBrowser (ciphers stubbed)');
    },
    createDecipheriv: function() {
      throw new Error('crypto.createDecipheriv: unsupported in NodeBrowser (ciphers stubbed)');
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

/** Readable/Writable/Duplex/Transform with .pipe() */
export const STREAM_POLYFILL = `
function __bn_load_stream() {
  var EE = loadCore('events').EventEmitter;
  function Readable(opts) {
    EE.call(this);
    this._readableState = { ended: false, flowing: null };
    this.readable = true;
    this._buf = [];
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
    if (this._readableState.flowing) {
      this.emit('data', chunk);
    } else {
      this._buf.push(chunk);
    }
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
  Readable.prototype.pipe = function(dest) {    var self = this;
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
    Writable.call(this, opts);
  }
  Duplex.prototype = Object.create(Readable.prototype);
  Object.assign(Duplex.prototype, Writable.prototype);
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
  Readable.from = function(iterable) {
    var r = new Readable();
    setTimeout(function() {
      try {
        if (typeof iterable === 'string' || Buffer.isBuffer(iterable) || iterable instanceof Uint8Array) {
          r.push(iterable);
        } else if (Array.isArray(iterable)) {
          for (var i = 0; i < iterable.length; i++) r.push(iterable[i]);
        }
        r.push(null);
      } catch (e) { r.emit('error', e); }
    }, 0);
    return r;
  };
  return { Readable: Readable, Writable: Writable, Duplex: Duplex, Transform: Transform, PassThrough: PassThrough };
}
`;

export const UTIL_POLYFILL = `
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
    types: { isPromise: function(v) { return !!v && typeof v.then === 'function'; } },
  };
}
function __bn_load_string_decoder() {
  function StringDecoder(encoding) {
    this.encoding = encoding || 'utf8';
  }
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
      return new Promise(function(resolve) {
        setTimeout(function() { resolve(value); }, ms | 0);
      });
    },
    setImmediate: function(value) {
      return new Promise(function(resolve) {
        setTimeout(function() { resolve(value); }, 0);
      });
    },
    scheduler: {
      wait: function(ms) {
        return new Promise(function(resolve) { setTimeout(resolve, ms | 0); });
      },
    },
  };
}
`;

export const ZLIB_POLYFILL = `
function __bn_concat_u8(chunks) {
  var n = 0;
  for (var i = 0; i < chunks.length; i++) n += chunks[i].length;
  var out = new Uint8Array(n), o = 0;
  for (var j = 0; j < chunks.length; j++) { out.set(chunks[j], o); o += chunks[j].length; }
  return out;
}
function __bn_to_u8(data) {
  if (Buffer.isBuffer && Buffer.isBuffer(data)) return data._data;
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return Buffer._encode(data, 'utf8');
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
  var chunks = [], offset = 0;
  while (offset < data.length) {
    var take = Math.min(65535, data.length - offset);
    var isLast = offset + take >= data.length;
    var block = new Uint8Array(5 + take);
    block[0] = isLast ? 0x01 : 0x00;
    block[1] = take & 0xff; block[2] = (take >>> 8) & 0xff;
    var nlen = (~take) & 0xffff;
    block[3] = nlen & 0xff; block[4] = (nlen >>> 8) & 0xff;
    block.set(data.subarray(offset, offset + take), 5);
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
    var len = deflateData[i] | (deflateData[i+1] << 8);
    var nlen = deflateData[i+2] | (deflateData[i+3] << 8);
    i += 4;
    if (((len ^ 0xffff) & 0xffff) !== nlen) throw new Error('zlib-pure: invalid NLEN');
    for (var j = 0; j < len; j++) out.push(deflateData[i++]);
    if (bfinal) break;
  }
  return new Uint8Array(out);
}
function __bn_zlib_pure(op, data) {
  var u8 = __bn_to_u8(data);
  if (op === 'gzip') {
    var body = __bn_deflate_stored(u8);
    var out = new Uint8Array(10 + body.length + 8);
    out[0]=0x1f; out[1]=0x8b; out[2]=8; out[9]=0xff;
    out.set(body, 10);
    var crc = __bn_crc32(u8), isize = u8.length >>> 0, t = 10 + body.length;
    out[t]=crc&255; out[t+1]=(crc>>>8)&255; out[t+2]=(crc>>>16)&255; out[t+3]=(crc>>>24)&255;
    out[t+4]=isize&255; out[t+5]=(isize>>>8)&255; out[t+6]=(isize>>>16)&255; out[t+7]=(isize>>>24)&255;
    return out;
  }
  if (op === 'gunzip') {
    if (u8.length < 18 || u8[0] !== 0x1f || u8[1] !== 0x8b) throw new Error('zlib-pure: not gzip');
    var flg = u8[3], i = 10;
    if (flg & 4) { var xlen = u8[i] | (u8[i+1] << 8); i += 2 + xlen; }
    if (flg & 8) { while (i < u8.length && u8[i++] !== 0) {} }
    if (flg & 16) { while (i < u8.length && u8[i++] !== 0) {} }
    if (flg & 2) i += 2;
    return __bn_inflate_stored(u8.subarray(i, u8.length - 8));
  }
  if (op === 'deflate') {
    var body2 = __bn_deflate_stored(u8);
    var out2 = new Uint8Array(2 + body2.length + 4);
    out2[0]=0x78; out2[1]=0x01; out2.set(body2, 2);
    var ad = __bn_adler32(u8), t2 = 2 + body2.length;
    out2[t2]=(ad>>>24)&255; out2[t2+1]=(ad>>>16)&255; out2[t2+2]=(ad>>>8)&255; out2[t2+3]=ad&255;
    return out2;
  }
  if (op === 'inflate') {
    return __bn_inflate_stored(u8.subarray(2, u8.length - 4));
  }
  throw new Error('zlib-pure: unknown op ' + op);
}
function __bn_load_zlib() {
  function syncViaHost(op, data) {
    if (typeof __bn.zlibSync === 'function') {
      var out = __bn.zlibSync(op, __bn_to_u8(data));
      return Buffer.from(out);
    }
    return Buffer.from(__bn_zlib_pure(op, data));
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
        var out = syncViaHost(op, __bn_concat_u8(chunks));
        t.push(out);
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
    createInflate: function() { return wrapStream('inflate'); },
  };
}
`;
