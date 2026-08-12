/** Minimal gzip/deflate via DEFLATE stored blocks — sync round-trip without native zlib. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** DEFLATE stored blocks only (BTYPE=00), byte-aligned. */
export function deflateStored(data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  if (data.length === 0) {
    return new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff]);
  }
  let offset = 0;
  while (offset < data.length) {
    const take = Math.min(65535, data.length - offset);
    const isLast = offset + take >= data.length;
    const block = new Uint8Array(5 + take);
    block[0] = isLast ? 0x01 : 0x00;
    block[1] = take & 0xff;
    block[2] = (take >>> 8) & 0xff;
    const nlen = (~take) & 0xffff;
    block[3] = nlen & 0xff;
    block[4] = (nlen >>> 8) & 0xff;
    block.set(data.subarray(offset, offset + take), 5);
    chunks.push(block);
    offset += take;
  }
  return concat(chunks);
}

export function inflateStored(deflateData: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < deflateData.length) {
    const hdr = deflateData[i++]!;
    const bfinal = hdr & 1;
    const btype = (hdr >>> 1) & 3;
    if (btype !== 0) throw new Error('zlib-pure: only stored DEFLATE blocks supported');
    if (i + 4 > deflateData.length) throw new Error('zlib-pure: truncated stored block');
    const len = deflateData[i]! | (deflateData[i + 1]! << 8);
    const nlen = deflateData[i + 2]! | (deflateData[i + 3]! << 8);
    i += 4;
    if (((len ^ 0xffff) & 0xffff) !== nlen) throw new Error('zlib-pure: invalid stored block NLEN');
    if (i + len > deflateData.length) throw new Error('zlib-pure: truncated stored data');
    for (let j = 0; j < len; j++) out.push(deflateData[i++]!);
    if (bfinal) break;
  }
  return new Uint8Array(out);
}

export function gzipPure(data: Uint8Array): Uint8Array {
  const body = deflateStored(data);
  const out = new Uint8Array(10 + body.length + 8);
  out[0] = 0x1f;
  out[1] = 0x8b;
  out[2] = 8;
  out[9] = 0xff; // unknown OS
  out.set(body, 10);
  const crc = crc32(data);
  const isize = data.length >>> 0;
  const t = 10 + body.length;
  out[t] = crc & 255;
  out[t + 1] = (crc >>> 8) & 255;
  out[t + 2] = (crc >>> 16) & 255;
  out[t + 3] = (crc >>> 24) & 255;
  out[t + 4] = isize & 255;
  out[t + 5] = (isize >>> 8) & 255;
  out[t + 6] = (isize >>> 16) & 255;
  out[t + 7] = (isize >>> 24) & 255;
  return out;
}

export function gunzipPure(data: Uint8Array): Uint8Array {
  if (data.length < 18 || data[0] !== 0x1f || data[1] !== 0x8b) {
    throw new Error('zlib-pure: not gzip');
  }
  if (data[2] !== 8) throw new Error('zlib-pure: unsupported CM');
  const flg = data[3]!;
  let i = 10;
  if (flg & 4) {
    if (i + 2 > data.length) throw new Error('zlib-pure: bad FEXTRA');
    const xlen = data[i]! | (data[i + 1]! << 8);
    i += 2 + xlen;
  }
  if (flg & 8) {
    while (i < data.length && data[i++] !== 0) {
      /* FNAME */
    }
  }
  if (flg & 16) {
    while (i < data.length && data[i++] !== 0) {
      /* FCOMMENT */
    }
  }
  if (flg & 2) i += 2; // FHCRC
  if (i + 8 > data.length) throw new Error('zlib-pure: truncated gzip');
  const bodyEnd = data.length - 8;
  return inflateStored(data.subarray(i, bodyEnd));
}

/** zlib wrapper (CMF/FLG + deflate + Adler-32) */
export function deflatePure(data: Uint8Array): Uint8Array {
  const body = deflateStored(data);
  const out = new Uint8Array(2 + body.length + 4);
  out[0] = 0x78;
  out[1] = 0x01; // no compression hint
  out.set(body, 2);
  const ad = adler32(data);
  const t = 2 + body.length;
  out[t] = (ad >>> 24) & 255;
  out[t + 1] = (ad >>> 16) & 255;
  out[t + 2] = (ad >>> 8) & 255;
  out[t + 3] = ad & 255;
  return out;
}

export function inflatePure(data: Uint8Array): Uint8Array {
  if (data.length < 6) throw new Error('zlib-pure: truncated zlib');
  return inflateStored(data.subarray(2, data.length - 4));
}

export function zlibPureSync(op: string, data: Uint8Array): Uint8Array {
  switch (op) {
    case 'gzip':
      return gzipPure(data);
    case 'gunzip':
      return gunzipPure(data);
    case 'deflate':
      return deflatePure(data);
    case 'inflate':
      return inflatePure(data);
    default:
      throw new Error(`zlib-pure: unknown op ${op}`);
  }
}
