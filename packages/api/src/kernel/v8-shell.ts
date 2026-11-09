/**
 * `sh -c` on the host V8 for the commands the C++ shell already implements.
 * Unknown commands return null so the caller can keep using QuickJS.
 */
import type { KernelHandle, KernelModule } from './load.js';
import { runNodeOnV8, type V8Io, type V8RunResult } from './v8-guest.js';

const BUILTINS = new Set([
  'echo',
  'cat',
  'ls',
  'pwd',
  'true',
  'false',
  'mkdir',
  'rm',
  'cp',
  'mv',
  'which',
  'env',
  'printf',
  'uname',
  'hostname',
  'test',
  '[',
  'cd',
  'export',
  'node',
  'grep',
  'head',
  'tail',
  'wc',
  'touch',
  'sort',
  'uniq',
  'tee',
  'basename',
  'dirname',
  'sleep',
  'vite',
  'next',
  'tsc',
]);

function isPromise(v: unknown): v is Promise<unknown> {
  return !!v && typeof (v as Promise<unknown>).then === 'function';
}

function sync<T>(v: T | Promise<T>): T {
  if (isPromise(v)) throw new Error('V8 shell needs the same-thread WASM kernel');
  return v as T;
}

function normalize(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

function joinPath(cwd: string, rel: string): string {
  if (!rel) return cwd || '/';
  if (rel.startsWith('/')) return normalize(rel);
  const base = !cwd || cwd === '/' ? '' : cwd.replace(/\/+$/, '');
  return normalize(`${base}/${rel}`);
}

function kindOf(mod: KernelModule, k: KernelHandle, path: string): string | null {
  if (path === '/' || path === '') return 'directory';
  if (!sync(mod.exists(k, path))) return null;
  if (mod.lstatKind) return sync(mod.lstatKind(k, path));
  return sync(mod.readText(k, path)) == null ? 'directory' : 'file';
}

function readText(mod: KernelModule, k: KernelHandle, path: string): string | null {
  return sync(mod.readText(k, path));
}

function writeText(mod: KernelModule, k: KernelHandle, path: string, text: string): boolean {
  return sync(mod.writeText(k, path, text));
}

/** `sh -c <script>` / `bash -c <script>`. */
export function shellScriptFromSpawn(cmd: string, args: string[]): string | null {
  const base = cmd.replace(/^.*\//, '');
  if (base !== 'sh' && base !== 'bash') return null;
  const i = args.indexOf('-c');
  if (i < 0 || i + 1 >= args.length) return null;
  return args[i + 1] ?? '';
}

function tokenize(line: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quote = '';
  for (const c of line) {
    if (!quote && (c === '"' || c === "'")) {
      quote = c;
      continue;
    }
    if (quote && c === quote) {
      quote = '';
      continue;
    }
    if (!quote && (c === ' ' || c === '\t')) {
      if (cur) parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur) parts.push(cur);
  return parts;
}

type Chunk = { text: string; op: string };

function splitList(script: string): Chunk[] {
  const chunks: Chunk[] = [];
  let buf = '';
  let op = 'start';
  let quote = '';
  for (let i = 0; i < script.length; i++) {
    const c = script[i]!;
    if (!quote && (c === '"' || c === "'")) {
      quote = c;
      buf += c;
      continue;
    }
    if (quote && c === quote) {
      quote = '';
      buf += c;
      continue;
    }
    if (!quote && c === ';') {
      chunks.push({ text: buf, op });
      buf = '';
      op = ';';
      continue;
    }
    const two = script.slice(i, i + 2);
    if (!quote && (two === '&&' || two === '||')) {
      chunks.push({ text: buf, op });
      buf = '';
      op = two;
      i++;
      continue;
    }
    buf += c;
  }
  chunks.push({ text: buf, op });
  return chunks;
}

function splitPipes(seg: string): string[] {
  const stages: string[] = [];
  let buf = '';
  let quote = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]!;
    if (!quote && (c === '"' || c === "'")) {
      quote = c;
      buf += c;
      continue;
    }
    if (quote && c === quote) {
      quote = '';
      buf += c;
      continue;
    }
    if (!quote && c === '|' && scriptNext(seg, i) !== '|') {
      stages.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  stages.push(buf);
  return stages;
}

function scriptNext(s: string, i: number): string {
  return i + 1 < s.length ? s[i + 1]! : '';
}

function globMatch(pat: string, name: string): boolean {
  const rec = (pi: number, ni: number): boolean => {
    while (pi < pat.length && ni < name.length) {
      if (pat[pi] === '*') {
        pi++;
        if (pi === pat.length) return true;
        for (let n = ni; n <= name.length; n++) if (rec(pi, n)) return true;
        return false;
      }
      if (pat[pi] === '?' || pat[pi] === name[ni]) {
        pi++;
        ni++;
        continue;
      }
      return false;
    }
    while (pi < pat.length && pat[pi] === '*') pi++;
    return pi === pat.length && ni === name.length;
  };
  return rec(0, 0);
}

function expandToken(mod: KernelModule, k: KernelHandle, cwd: string, token: string): string[] {
  if (!token.includes('*') && !token.includes('?')) return [token];
  const slash = token.lastIndexOf('/');
  const dirRel = slash < 0 ? '.' : token.slice(0, slash);
  const pat = slash < 0 ? token : token.slice(slash + 1);
  const dir = dirRel === '.' ? cwd : joinPath(cwd, dirRel);
  if (kindOf(mod, k, dir) !== 'directory') return [token];
  const names = sync(mod.readdir(k, dir));
  const out: string[] = [];
  for (const name of names) {
    if (!globMatch(pat, name)) continue;
    out.push(slash < 0 ? name : `${dirRel}/${name}`);
  }
  return out.length ? out : [token];
}

function expandArgs(mod: KernelModule, k: KernelHandle, cwd: string, args: string[]): string[] {
  const out: string[] = [];
  for (const arg of args) out.push(...expandToken(mod, k, cwd, arg));
  return out;
}

function commandName(line: string): string | null {
  let body = line.trim();
  const gt = body.indexOf('>');
  if (gt >= 0) body = body.slice(0, gt);
  const parts = tokenize(body);
  let i = 0;
  while (i < parts.length && parts[i]!.includes('=') && !parts[i]!.includes('/')) i++;
  return parts[i] ?? null;
}

function isKnown(mod: KernelModule, k: KernelHandle, cwd: string, cmd: string): boolean {
  const base = cmd.replace(/^.*\//, '');
  if (base === 'node') return true;
  if (BUILTINS.has(cmd)) return true;
  const bin = joinPath(cwd, `node_modules/.bin/${cmd}`);
  return kindOf(mod, k, bin) === 'file';
}

function scriptIsKnown(mod: KernelModule, k: KernelHandle, cwd: string, script: string): boolean {
  for (const chunk of splitList(script)) {
    for (const stage of splitPipes(chunk.text)) {
      const name = commandName(stage);
      if (!name) continue;
      if (!isKnown(mod, k, cwd, name)) return false;
    }
  }
  return true;
}

type Step = { code: number; out: string; err: string; cwd: string };

function rmTree(mod: KernelModule, k: KernelHandle, path: string): boolean {
  const kind = kindOf(mod, k, path);
  if (!kind) return false;
  if (kind === 'symlink') return sync(mod.unlink(k, path));
  if (kind === 'directory') {
    for (const name of sync(mod.readdir(k, path))) {
      if (name === '.' || name === '..') continue;
      if (!rmTree(mod, k, joinPath(path, name))) return false;
    }
    return mod.rmdir ? sync(mod.rmdir(k, path)) : false;
  }
  return sync(mod.unlink(k, path));
}

function flagSet(argv: string[]): { flags: Set<string>; rest: string[]; number: number | null } {
  const flags = new Set<string>();
  const rest: string[] = [];
  let number: number | null = null;
  for (const arg of argv) {
    if (/^-\d+$/.test(arg)) number = Number(arg.slice(1));
    else if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (const ch of arg.slice(1)) flags.add(ch);
    } else rest.push(arg);
  }
  return { flags, rest, number };
}

function asRegExp(pattern: string, insensitive: boolean): RegExp {
  const flag = insensitive ? 'i' : '';
  try {
    return new RegExp(pattern, flag);
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flag);
  }
}

function textOf(mod: KernelModule, k: KernelHandle, cwd: string, files: string[], stdin: string | null): { text: string; label: string }[] {
  if (!files.length) return [{ text: stdin ?? '', label: '' }];
  return files.map((file) => ({
    text: readText(mod, k, joinPath(cwd, file)) ?? '',
    label: file,
  }));
}

function linesOf(text: string): string[] {
  if (!text) return [];
  const parts = text.split('\n');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function findCli(mod: KernelModule, k: KernelHandle, cwd: string, rels: string[]): string | null {
  for (const rel of rels) {
    const path = joinPath(cwd, rel);
    if (kindOf(mod, k, path) === 'file') return path;
  }
  return null;
}

function captureNode(
  mod: KernelModule,
  k: KernelHandle,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  io: V8Io,
): { code: number; out: string; err: string } {
  const beforeOut = io.stdout.length;
  const beforeErr = io.stderr.length;
  const child = runNodeOnV8(mod, k, args, cwd, env, io);
  const out = io.stdout.slice(beforeOut);
  const err = io.stderr.slice(beforeErr);
  io.stdout = io.stdout.slice(0, beforeOut);
  io.stderr = io.stderr.slice(0, beforeErr);
  return { code: child.code, out, err };
}

function runProjectTool(
  mod: KernelModule,
  k: KernelHandle,
  cmd: string,
  argv: string[],
  cwd: string,
  env: Record<string, string>,
  io: V8Io,
): { code: number; out: string; err: string } {
  let mode = 'dev';
  for (const arg of argv) {
    if (arg === 'build') mode = 'build';
    else if (arg === 'preview' || arg === 'start') mode = 'preview';
    else if (arg === 'dev') mode = 'dev';
  }
  const cli =
    cmd === 'vite'
      ? findCli(mod, k, cwd, ['node_modules/vite/bin/vite.js', 'node_modules/vite/bin/vite.mjs', 'node_modules/.bin/vite'])
      : cmd === 'next'
        ? findCli(mod, k, cwd, ['node_modules/next/dist/bin/next', 'node_modules/.bin/next'])
        : findCli(mod, k, cwd, ['node_modules/typescript/lib/tsc.js', 'node_modules/typescript/bin/tsc', 'node_modules/.bin/tsc']);
  if (cli) {
    const child = captureNode(mod, k, [cli, ...argv], cwd, env, io);
    if (child.code === 0 || io.servers > 0 || io.timers > 0) return child;
  } else if (cmd === 'tsc') {
    return { code: 1, out: '', err: 'tsc: typescript not installed in VFS (npm install typescript)\n' };
  }
  const hook = (globalThis as { __bn_on_tool?: (tool: string, cwd: string, mode: string) => void }).__bn_on_tool;
  if (cmd !== 'tsc' && typeof hook === 'function') {
    hook(cmd, cwd, mode);
    io.servers += 1;
    return { code: 0, out: `${cmd} ${mode} (host esbuild-wasm subset)\n`, err: '' };
  }
  if (cmd === 'tsc') return { code: 1, out: '', err: 'tsc: typescript not installed in VFS (npm install typescript)\n' };
  return { code: 0, out: `${cmd}: in-tab ${mode} uses host esbuild-wasm\n`, err: '' };
}

function runSimple(
  mod: KernelModule,
  k: KernelHandle,
  line: string,
  cwd: string,
  env: Record<string, string>,
  io: V8Io,
  stdin: string | null = null,
): Step {
  let body = line.trim();
  if (!body) return { code: 0, out: '', err: '', cwd };
  let redir = '';
  let append = false;
  const gt = body.indexOf('>');
  if (gt >= 0) {
    redir = body.slice(gt + 1).trim();
    body = body.slice(0, gt).trim();
    if (redir.startsWith('>')) {
      append = true;
      redir = redir.slice(1).trim();
    }
  }
  let parts = tokenize(body);
  while (parts.length && parts[0]!.includes('=') && !parts[0]!.includes('/')) {
    const eq = parts[0]!.indexOf('=');
    env[parts[0]!.slice(0, eq)] = parts[0]!.slice(eq + 1);
    parts = parts.slice(1);
  }
  if (!parts.length) return { code: 0, out: '', err: '', cwd };
  const cmd = parts[0]!;
  let argv = expandArgs(mod, k, cwd, parts.slice(1));
  let out = '';
  let err = '';
  let code = 0;

  const fail = (msg: string) => {
    err += msg;
    code = 1;
  };

  if (cmd === 'test' || cmd === '[') {
    if (cmd === '[' && argv[argv.length - 1] === ']') argv = argv.slice(0, -1);
    let ok = false;
    if (argv[0] === '-f' && argv[1]) ok = kindOf(mod, k, joinPath(cwd, argv[1])) === 'file';
    else if (argv[0] === '-d' && argv[1]) ok = kindOf(mod, k, joinPath(cwd, argv[1])) === 'directory';
    else if (argv[0] === '-e' && argv[1]) ok = kindOf(mod, k, joinPath(cwd, argv[1])) != null;
    else if (argv.length === 1) ok = argv[0] !== '';
    return { code: ok ? 0 : 1, out: '', err: '', cwd };
  }
  if (cmd === 'cd') {
    const dest = argv[0] ? joinPath(cwd, argv[0]) : '/home';
    if (kindOf(mod, k, dest) !== 'directory') return { code: 1, out: '', err: 'cd: no such directory\n', cwd };
    return { code: 0, out: '', err: '', cwd: dest };
  }
  if (cmd === 'export') {
    for (const item of argv) {
      const eq = item.indexOf('=');
      if (eq > 0) env[item.slice(0, eq)] = item.slice(eq + 1);
    }
    return { code: 0, out: '', err: '', cwd };
  }
  if (cmd === 'echo') {
    let start = 0;
    let newline = true;
    if (argv[0] === '-n') {
      newline = false;
      start = 1;
    }
    out = argv.slice(start).join(' ') + (newline ? '\n' : '');
  } else if (cmd === 'pwd') {
    out = cwd + '\n';
  } else if (cmd === 'true') {
    code = 0;
  } else if (cmd === 'false') {
    code = 1;
  } else if (cmd === 'uname') {
    out = 'Linux browsernode 1.0 wasm\n';
  } else if (cmd === 'hostname') {
    out = 'browsernode\n';
  } else if (cmd === 'printf') {
    out = argv.join('');
    if (!argv.length) code = 1;
  } else if (cmd === 'env') {
    out = Object.entries(env)
      .map(([key, value]) => `${key}=${value}\n`)
      .join('');
  } else if (cmd === 'which') {
    const name = argv[0] || '';
    if (BUILTINS.has(name) || name === 'node' || name === 'sh' || name === 'npm' || name === 'npx') {
      out = `/usr/bin/${name}\n`;
    } else {
      const bin = joinPath(cwd, `node_modules/.bin/${name}`);
      if (kindOf(mod, k, bin) === 'file') out = bin + '\n';
      else {
        err = `which: ${name} not found\n`;
        code = 1;
      }
    }
  } else if (cmd === 'ls') {
    if (argv.length > 1) out = argv.map((a) => a + '\n').join('');
    else {
      const path = argv[0] ? joinPath(cwd, argv[0]) : cwd;
      const kind = kindOf(mod, k, path);
      if (kind === 'file') out = (argv[0] || path) + '\n';
      else if (kind === 'directory') out = sync(mod.readdir(k, path)).map((name) => name + '\n').join('');
      else fail('ls: cannot access path\n');
    }
  } else if (cmd === 'cat') {
    if (!argv.length) {
      if (stdin == null) fail('cat: missing file\n');
      else out = stdin;
    }
    for (const arg of argv) {
      const text = readText(mod, k, joinPath(cwd, arg));
      if (text == null) {
        fail(`cat: ${arg}: No such file\n`);
        break;
      }
      out += text;
    }
  } else if (cmd === 'mkdir') {
    const recursive = argv.includes('-p');
    const paths = argv.filter((a) => a !== '-p');
    if (!paths.length) fail('mkdir: missing operand\n');
    for (const p of paths) {
      if (!sync(mod.mkdir(k, joinPath(cwd, p), recursive))) fail(`mkdir: cannot create ${p}\n`);
    }
  } else if (cmd === 'rm') {
    let recursive = false;
    const paths: string[] = [];
    for (const a of argv) {
      if (a === '-r' || a === '-rf' || a === '-fr') recursive = true;
      else if (a !== '-f') paths.push(a);
    }
    const expanded = expandArgs(mod, k, cwd, paths);
    if (!expanded.length) fail('rm: missing operand\n');
    for (const p of expanded) {
      const path = joinPath(cwd, p);
      const kind = kindOf(mod, k, path);
      if (!kind) {
        fail(`rm: cannot remove ${p}\n`);
        continue;
      }
      if (kind === 'directory') {
        if (!recursive) fail(`rm: ${p} is a directory\n`);
        else if (!rmTree(mod, k, path)) fail(`rm: cannot rmdir ${p}\n`);
      } else if (!sync(mod.unlink(k, path))) fail(`rm: cannot remove ${p}\n`);
    }
  } else if (cmd === 'cp') {
    if (argv.length < 2) fail('cp: missing operand\n');
    else {
      const from = joinPath(cwd, argv[0]!);
      const to = joinPath(cwd, argv[1]!);
      const bytes = mod.readBytes ? sync(mod.readBytes(k, from)) : null;
      const text = bytes ? null : readText(mod, k, from);
      if (!bytes && text == null) fail(`cp: cannot stat ${argv[0]}\n`);
      else if (bytes) {
        if (!sync(mod.writeBytes(k, to, bytes))) fail(`cp: cannot stat ${argv[0]}\n`);
      } else if (!writeText(mod, k, to, text || '')) fail(`cp: cannot stat ${argv[0]}\n`);
    }
  } else if (cmd === 'mv') {
    if (argv.length < 2 || !mod.rename) fail('mv: missing operand\n');
    else if (!sync(mod.rename(k, joinPath(cwd, argv[0]!), joinPath(cwd, argv[1]!)))) fail('mv: cannot rename\n');
  } else if (cmd === 'touch') {
    if (!argv.length) fail('touch: missing file\n');
    for (const file of argv) {
      const path = joinPath(cwd, file);
      if (kindOf(mod, k, path) == null && !writeText(mod, k, path, '')) fail(`touch: cannot touch ${file}\n`);
    }
  } else if (cmd === 'basename' || cmd === 'dirname') {
    const target = argv[0] || '';
    if (!target) fail(`${cmd}: missing operand\n`);
    else if (cmd === 'dirname') {
      const slash = target.lastIndexOf('/');
      out = (slash <= 0 ? '.' : target.slice(0, slash)) + '\n';
    } else {
      const base = target.slice(target.lastIndexOf('/') + 1);
      const suffix = argv[1];
      out = (suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base) + '\n';
    }
  } else if (cmd === 'sleep') {
    code = 0;
  } else if (cmd === 'grep') {
    const parsed = flagSet(argv);
    const pattern = parsed.rest[0];
    if (!pattern) fail('grep: missing pattern\n');
    else {
      const match = asRegExp(pattern, parsed.flags.has('i'));
      const files = parsed.rest.slice(1);
      let count = 0;
      for (const item of textOf(mod, k, cwd, files, stdin)) {
        if (files.length && readText(mod, k, joinPath(cwd, item.label)) == null) {
          fail(`grep: ${item.label}: No such file\n`);
          break;
        }
        linesOf(item.text).forEach((lineText, index) => {
          const hit = match.test(lineText);
          if (parsed.flags.has('v') ? hit : !hit) return;
          count++;
          if (parsed.flags.has('c')) return;
          const prefix = files.length > 1 ? `${item.label}:` : '';
          const num = parsed.flags.has('n') ? `${index + 1}:` : '';
          out += `${prefix}${num}${lineText}\n`;
        });
      }
      if (parsed.flags.has('c')) out += `${count}\n`;
      if (!count && code === 0) code = 1;
    }
  } else if (cmd === 'head' || cmd === 'tail') {
    const parsed = flagSet(argv);
    const count = parsed.number ?? (parsed.rest[0] && parsed.flags.has('n') ? Number(parsed.rest.shift()) : 10);
    const files = parsed.rest;
    const rows = linesOf(files.length ? textOf(mod, k, cwd, files, null)[0]?.text || '' : (stdin ?? ''));
    const slice = cmd === 'head' ? rows.slice(0, count) : rows.slice(Math.max(0, rows.length - count));
    out = slice.length ? slice.join('\n') + '\n' : '';
  } else if (cmd === 'wc') {
    const parsed = flagSet(argv);
    const body = parsed.rest.length ? textOf(mod, k, cwd, parsed.rest, null)[0]?.text || '' : (stdin ?? '');
    const lines = linesOf(body).length;
    const words = body.trim() ? body.trim().split(/\s+/).length : 0;
    const bytes = body.length;
    if (parsed.flags.has('l')) out = `${lines}\n`;
    else if (parsed.flags.has('w')) out = `${words}\n`;
    else if (parsed.flags.has('c')) out = `${bytes}\n`;
    else out = `${lines} ${words} ${bytes}\n`;
  } else if (cmd === 'sort') {
    const parsed = flagSet(argv);
    const body = parsed.rest.length ? textOf(mod, k, cwd, parsed.rest, null)[0]?.text || '' : (stdin ?? '');
    const rows = linesOf(body).sort((a, b) => a.localeCompare(b));
    if (parsed.flags.has('r')) rows.reverse();
    out = rows.length ? rows.join('\n') + '\n' : '';
  } else if (cmd === 'uniq') {
    const rows = linesOf(stdin != null ? stdin : argv[0] ? readText(mod, k, joinPath(cwd, argv[0])) || '' : '');
    const kept: string[] = [];
    for (const row of rows) if (kept[kept.length - 1] !== row) kept.push(row);
    out = kept.length ? kept.join('\n') + '\n' : '';
  } else if (cmd === 'tee') {
    out = stdin ?? '';
    if (!argv.length) fail('tee: missing file\n');
    else if (!writeText(mod, k, joinPath(cwd, argv[0]), stdin ?? '')) fail(`tee: cannot write ${argv[0]}\n`);
  } else if (cmd === 'vite' || cmd === 'next' || cmd === 'tsc') {
    const ran = runProjectTool(mod, k, cmd, argv, cwd, env, io);
    out = ran.out;
    err = ran.err;
    code = ran.code;
  } else if (cmd.replace(/^.*\//, '') === 'node' || kindOf(mod, k, joinPath(cwd, `node_modules/.bin/${cmd}`)) === 'file') {
    const script = cmd.replace(/^.*\//, '') === 'node' ? argv : [joinPath(cwd, `node_modules/.bin/${cmd}`), ...argv];
    const child = captureNode(mod, k, script, cwd, env, io);
    out = child.out;
    err = child.err;
    code = child.code;
  } else {
    err = `sh: ${cmd}: not found\n`;
    code = 127;
  }

  if (redir && code === 0) {
    const path = joinPath(cwd, redir);
    const prev = append ? readText(mod, k, path) || '' : '';
    writeText(mod, k, path, prev + out);
    out = '';
  }
  return { code, out, err, cwd };
}

function runPipeline(
  mod: KernelModule,
  k: KernelHandle,
  seg: string,
  cwd: string,
  env: Record<string, string>,
  io: V8Io,
): Step {
  const stages = splitPipes(seg);
  if (stages.length === 1) return runSimple(mod, k, stages[0] || '', cwd, env, io);
  let last: Step = { code: 0, out: '', err: '', cwd };
  for (let i = 0; i < stages.length; i++) {
    const line = (stages[i] || '').trim();
    last = runSimple(mod, k, line, cwd, env, io, i === 0 ? null : last.out);
  }
  return last;
}

/** Run a shell script on V8. Returns null when a command still belongs to QuickJS. */
export function runShellOnV8(
  mod: KernelModule,
  k: KernelHandle,
  script: string,
  cwd: string,
  env: Record<string, string> | undefined,
): V8RunResult | null {
  let source = script.trim();
  if (source.endsWith('&')) source = source.slice(0, -1).trim();
  const work = cwd && cwd !== '' ? cwd : '/';
  if (!scriptIsKnown(mod, k, work, source)) return null;
  const io: V8Io = { stdout: '', stderr: '', timers: 0, servers: 0 };
  const scope = { ...(env || {}) };
  const chunks = splitList(source);
  const result: V8RunResult = { code: 0, stdout: '', stderr: '', io };
  if (!source) return result;
  let dir = work;
  const proceed = (index: number, code: number) => {
    let at = index;
    let rc = code;
    while (at < chunks.length) {
      const chunk = chunks[at]!;
      if (at > 0) {
        if (chunk.op === '&&' && rc !== 0) {
          at++;
          continue;
        }
        if (chunk.op === '||' && rc === 0) {
          at++;
          continue;
        }
      }
      const delay = sleepSeconds(chunk.text);
      if (delay > 0 && !chunk.text.includes('|')) {
        io.timers += 1;
        const next = at + 1;
        setTimeout(() => {
          io.timers = Math.max(0, io.timers - 1);
          proceed(next, 0);
        }, Math.min(delay * 1000, 60_000));
        result.code = rc;
        return;
      }
      const step = runPipeline(mod, k, chunk.text, dir, scope, io);
      io.stdout += step.out;
      io.stderr += step.err;
      dir = step.cwd;
      rc = step.code;
      at++;
    }
    result.code = rc;
    result.stdout = io.stdout;
    result.stderr = io.stderr;
  };
  proceed(0, 0);
  result.stdout = io.stdout;
  result.stderr = io.stderr;
  return result;
}

function sleepSeconds(line: string): number {
  const parts = tokenize(line.trim());
  if (parts[0] !== 'sleep') return 0;
  const seconds = Number(parts[1] || '0');
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}
