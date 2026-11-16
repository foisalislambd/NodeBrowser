/**
 * Other thread for the shared-buffer filesystem protocol.
 * The page side runs serviceV8Fs; this side blocks in Atomics.wait.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { V8_OP, V8_SAB_CHUNK, decodeText, encodePath, encodeText, v8FsCall } from '../dist/kernel/v8-sab.js';

const sab = workerData.sab;
const ping = () => parentPort.postMessage({ t: 'fs' });
const call = (op, extra, flags, bytes) => v8FsCall(sab, op, extra, flags, bytes, ping);

function readBytes(path) {
  const chunks = [];
  let offset = 0;
  for (;;) {
    const res = call(V8_OP.readBytes, offset, 0, encodeText(path));
    if (!res.status) return offset === 0 ? null : concat(chunks);
    if (res.bytes.byteLength) chunks.push(res.bytes);
    if (!res.extra) break;
    offset += res.bytes.byteLength;
    if (!res.bytes.byteLength) break;
  }
  return concat(chunks);
}

function writeBytes(path, data) {
  if (!data.byteLength) return !!call(V8_OP.writeBytes, 0, 1, encodePath(path, data)).status;
  let offset = 0;
  while (offset < data.byteLength) {
    const end = Math.min(offset + V8_SAB_CHUNK, data.byteLength);
    const final = end === data.byteLength ? 1 : 0;
    const res = call(V8_OP.writeBytes, offset, final, encodePath(path, data.subarray(offset, end)));
    if (!res.status) return false;
    offset = end;
  }
  return true;
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.byteLength;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

const missing = call(V8_OP.exists, 0, 0, encodeText('/nope'));
const big = new Uint8Array(V8_SAB_CHUNK + 100);
big[0] = 11;
big[V8_SAB_CHUNK] = 22;
big[big.length - 1] = 33;
const wrote = writeBytes('/big.bin', big);
const back = readBytes('/big.bin');
const emptyWrote = writeBytes('/empty.bin', new Uint8Array());
const emptyBack = readBytes('/empty.bin');
const text = call(V8_OP.readBytes, 0, 0, encodeText('/note.txt'));
parentPort.postMessage({
  t: 'done',
  missing: missing.status === 1 && missing.extra === 0,
  wrote,
  same: !!back && back.length === big.length && back[0] === 11 && back[V8_SAB_CHUNK] === 22 && back[back.length - 1] === 33,
  empty: emptyWrote && !!emptyBack && emptyBack.length === 0,
  note: text.status === 1 && decodeText(text.bytes) === 'hi',
});
