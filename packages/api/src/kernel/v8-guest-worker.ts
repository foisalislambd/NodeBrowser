/**
 * V8 guest thread. Filesystem calls block on a SharedArrayBuffer so `require`
 * stays synchronous while the kernel Worker stays async.
 */
import type { KernelHandle, KernelModule } from './load.js';
import { dispatchGuestHttp, nodeArgsFromSpawn, runNodeOnV8, type V8Io } from './v8-guest.js';
import { runShellOnV8, shellScriptFromSpawn } from './v8-shell.js';
import {
  V8_OP,
  V8_SAB_CHUNK,
  createV8Sab,
  decodeText,
  encodePath,
  encodeText,
  v8FsCall,
  type V8FsResult,
} from './v8-sab.js';

type RunMsg = {
  t: 'run';
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

type HttpMsg = {
  t: 'http';
  id: number;
  port: number;
  req: { method?: string; url?: string; headers?: Record<string, string>; body?: string };
};

const post = (msg: object) => {
  (globalThis as unknown as { postMessage: (m: object) => void }).postMessage(msg);
};

function concat(parts: Uint8Array[]): Uint8Array {
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

function sabKernel(sab: SharedArrayBuffer): KernelModule {
  const ping = () => post({ t: 'fs' });
  const call = (op: number, extra: number, flags: number, bytes: Uint8Array): V8FsResult =>
    v8FsCall(sab, op, extra, flags, bytes, ping);

  const readBytes = (_k: KernelHandle, path: string): Uint8Array | null => {
    const chunks: Uint8Array[] = [];
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
  };

  const writeBytes = (_k: KernelHandle, path: string, data: Uint8Array): boolean => {
    const chunk = V8_SAB_CHUNK;
    if (!data.byteLength) return !!call(V8_OP.writeBytes, 0, 1, encodePath(path, data)).status;
    let offset = 0;
    while (offset < data.byteLength) {
      const end = Math.min(offset + chunk, data.byteLength);
      const final = end === data.byteLength ? 1 : 0;
      const res = call(V8_OP.writeBytes, offset, final, encodePath(path, data.subarray(offset, end)));
      if (!res.status) return false;
      offset = end;
    }
    return true;
  };

  return {
    create: () => 1,
    destroy: () => {},
    registerBuiltins: () => {},
    mkdir: (_k, path, recursive) => !!call(V8_OP.mkdir, recursive ? 1 : 0, 0, encodeText(path)).status,
    writeText: (k, path, text) => writeBytes(k, path, encodeText(text)),
    writeBytes,
    readText: (k, path) => {
      const bytes = readBytes(k, path);
      return bytes == null ? null : decodeText(bytes);
    },
    readBytes,
    unlink: (_k, path) => !!call(V8_OP.unlink, 0, 0, encodeText(path)).status,
    rmdir: (_k, path) => !!call(V8_OP.rmdir, 0, 0, encodeText(path)).status,
    rename: (_k, from, to) => !!call(V8_OP.rename, 0, 0, encodePath(from, encodeText(to))).status,
    readdir: (_k, path) => {
      const res = call(V8_OP.readdir, 0, 0, encodeText(path));
      if (!res.status) return null as unknown as string[];
      try {
        const names = JSON.parse(decodeText(res.bytes)) as string[];
        return Array.isArray(names) ? names : [];
      } catch {
        return null as unknown as string[];
      }
    },
    exists: (_k, path) => {
      const res = call(V8_OP.exists, 0, 0, encodeText(path));
      return res.status === 1 && res.extra === 1;
    },
    lstatKind: (_k, path) => {
      const res = call(V8_OP.lstatKind, 0, 0, encodeText(path));
      if (!res.status || !res.bytes.byteLength) return null;
      return decodeText(res.bytes);
    },
    symlink: (_k, target, linkpath) => !!call(V8_OP.symlink, 0, 0, encodePath(target, encodeText(linkpath))).status,
    readlink: (_k, path) => {
      const res = call(V8_OP.readlink, 0, 0, encodeText(path));
      if (!res.status) return null;
      return decodeText(res.bytes);
    },
    spawn: () => 0,
    wait: () => 0,
    kill: () => false,
    readStdout: () => '',
    readStderr: () => '',
    writeStdin: () => 0,
    runtime: 'wasm',
  };
}

const sab = createV8Sab();

function publish(io: V8Io, code: number, final: boolean): void {
  post({
    t: 'io',
    code,
    stdout: io.stdout,
    stderr: io.stderr,
    timers: io.timers,
    servers: io.servers,
    pending: io.pending ?? 0,
    final: final && !(io.servers > 0),
  });
}

(globalThis as unknown as { onmessage: (ev: MessageEvent) => void }).onmessage = (ev: MessageEvent) => {
  const msg = ev.data as RunMsg | HttpMsg | { t: string };
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'http') {
    const http = msg as HttpMsg;
    let out = { status: 502, headers: {} as Record<string, string>, body: 'no listener' };
    try {
      out = dispatchGuestHttp(http.port, http.req);
    } catch (error) {
      out = { status: 500, headers: { 'Content-Type': 'text/plain' }, body: String(error) };
    }
    post({ t: 'http-result', id: http.id, out });
    return;
  }
  if (msg.t === 'boot') {
    post({ t: 'ready', sab });
    return;
  }
  if (msg.t !== 'run') return;
  const run = msg as RunMsg;
  const mod = sabKernel(sab);
  const nodeArgs = nodeArgsFromSpawn(run.command, run.args);
  let io: V8Io;
  let resultCode = 0;
  if (nodeArgs) {
    io = { stdout: '', stderr: '', timers: 0, servers: 0, pending: 0 };
    resultCode = runNodeOnV8(mod, 1, nodeArgs, run.cwd, run.env, io, {
      onServer(port) {
        post({ t: 'listen', port });
      },
    }).code;
  } else {
    const script = shellScriptFromSpawn(run.command, run.args);
    if (script == null) {
      post({ t: 'skip' });
      return;
    }
    const ran = runShellOnV8(mod, 1, script, run.cwd, run.env);
    if (!ran) {
      post({ t: 'skip' });
      return;
    }
    io = ran.io;
    resultCode = ran.code;
  }
  const live = () => (io.timers || 0) > 0 || (io.servers || 0) > 0 || (io.pending || 0) > 0;
  publish(io, resultCode, !live());
  if (!live()) return;
  const timer = setInterval(() => {
    const still = live();
    publish(io, resultCode, !still);
    if (!still) clearInterval(timer);
  }, 16);
};
