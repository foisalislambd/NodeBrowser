/**
 * Shared Buffer + fs.promises snippets for Node bootstrap (QuickJS / JS fallback).
 * Kept as string exports so C++ and TS can embed the same source.
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
