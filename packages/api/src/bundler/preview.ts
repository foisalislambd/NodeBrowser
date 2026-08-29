import type { NodeBrowser } from '../host/node-browser.js';
import { findAppDir } from './next.js';

async function readUtf8(bn: NodeBrowser, path: string): Promise<string | null> {
  try {
    return await bn.fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export type ProjectKind = 'vite' | 'next' | 'static' | 'node' | 'unknown';

export type PreviewResult = {
  kind: ProjectKind;
  root: string;
  url?: string;
  port?: number;
  message: string;
};

const NEXT_CONFIG = ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts', 'next.config.mts'];
const VITE_CONFIG = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.mts'];

async function fileExists(bn: NodeBrowser, path: string): Promise<boolean> {
  try {
    return !(await bn.fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function hasAny(bn: NodeBrowser, root: string, names: string[]): Promise<boolean> {
  for (const n of names) {
    if (await fileExists(bn, `${root}/${n}`)) return true;
  }
  return false;
}

const VITE_ENTRIES = [
  'src/main.tsx',
  'src/main.jsx',
  'src/main.ts',
  'src/main.js',
  'src/index.tsx',
  'src/index.jsx',
  'src/index.ts',
  'src/index.js',
  'src/App.tsx',
  'src/App.jsx',
];

async function looksLikeProject(bn: NodeBrowser, root: string): Promise<boolean> {
  if (await fileExists(bn, `${root}/package.json`)) return true;
  if (await findAppDir(bn, root)) return true;
  if (await hasAny(bn, root, NEXT_CONFIG)) return true;
  if (await hasAny(bn, root, VITE_CONFIG)) return true;
  if (await fileExists(bn, `${root}/index.html`) || (await fileExists(bn, `${root}/index.htm`))) return true;
  if (await hasAny(bn, root, VITE_ENTRIES)) return true;
  return false;
}

const SKIP_ROOT_DIRS = new Set(['__macosx', '.ds_store', 'node_modules', '.git', '.next', 'dist', '.turbo']);

async function listChildDirs(bn: NodeBrowser, root: string): Promise<string[]> {
  let names: string[] = [];
  try {
    names = await bn.fs.readdir(root);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names) {
    if (SKIP_ROOT_DIRS.has(n.toLowerCase())) continue;
    const p = `${root}/${n}`.replace(/\/+/g, '/');
    try {
      if ((await bn.fs.stat(p)).isDirectory()) out.push(p);
    } catch {
      /* */
    }
  }
  return out;
}

function scoreProjectRoot(path: string, kindHint: string): number {
  let s = 0;
  if (kindHint === 'next') s += 3;
  if (kindHint === 'vite') s += 2;
  s -= path.split('/').length;
  return s;
}

/** If ZIP left nested wrappers (`vscode/vite`), walk until a real project folder. */
export async function resolveProjectRoot(bn: NodeBrowser, root: string, depth = 0): Promise<string> {
  if (await looksLikeProject(bn, root)) return root;
  if (depth >= 6) return root;
  const found: string[] = [];
  for (const p of await listChildDirs(bn, root)) {
    const inner = await resolveProjectRoot(bn, p, depth + 1);
    if (await looksLikeProject(bn, inner)) found.push(inner);
  }
  const uniq = [...new Set(found)];
  if (uniq.length === 1) return uniq[0]!;
  if (uniq.length > 1) {
    let best = uniq[0]!;
    let bestScore = -Infinity;
    for (const p of uniq) {
      const kind = await detectProjectKind(bn, p);
      const score = scoreProjectRoot(p, kind);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }
  return root;
}

export async function detectProjectKind(bn: NodeBrowser, root: string): Promise<ProjectKind> {
  const pkgRaw = await readUtf8(bn, `${root}/package.json`);
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } | null =
    null;
  if (pkgRaw) {
    try {
      pkg = JSON.parse(pkgRaw);
    } catch {
      pkg = null;
    }
  }
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const scripts = Object.values(pkg?.scripts || {}).join(' ');
  if (
    deps.next ||
    /\bnext\b/.test(scripts) ||
    (await hasAny(bn, root, NEXT_CONFIG)) ||
    (await findAppDir(bn, root))
  ) {
    return 'next';
  }
  if (
    deps.vite ||
    /\bvite\b/.test(scripts) ||
    (await hasAny(bn, root, VITE_CONFIG)) ||
    (await hasAny(bn, root, VITE_ENTRIES)) ||
    ((await readUtf8(bn, `${root}/index.html`)) && (await hasAny(bn, root, VITE_ENTRIES)))
  ) {
    return 'vite';
  }
  if ((await fileExists(bn, `${root}/index.html`)) || (await fileExists(bn, `${root}/index.htm`))) return 'static';
  if ((await fileExists(bn, `${root}/index.js`)) || (await fileExists(bn, `${root}/server.js`))) return 'node';
  return 'unknown';
}

/** Detect Vite / Next / static HTML / node and open in-tab preview when possible. */
export async function previewProject(bn: NodeBrowser, root: string): Promise<PreviewResult> {
  const resolved = await resolveProjectRoot(bn, root);
  const kind = await detectProjectKind(bn, resolved);
  if (kind === 'vite') {
    const r = await bn.viteDev(resolved, { port: 5173 });
    return { kind, root: resolved, url: r.url, port: r.port, message: 'Vite subset preview' };
  }
  if (kind === 'next') {
    const r = await bn.nextDev(resolved, { port: 3000 });
    return {
      kind,
      root: resolved,
      url: r.url,
      port: r.port,
      message: 'Next subset preview (app/ or src/app, js/ts/tsx)',
    };
  }
  if (kind === 'static') {
    bn.closePort(8080);
    const url = bn.serveStatic(8080, resolved);
    return { kind, root: resolved, url, port: 8080, message: 'Static site preview' };
  }
  if (kind === 'node') {
    const script = (await readUtf8(bn, `${resolved}/server.js`)) ? `${resolved}/server.js` : `${resolved}/index.js`;
    await bn.spawn('node', [script], { cwd: resolved });
    return { kind, root: resolved, message: `spawned node ${script} — preview if it listens` };
  }
  return { kind, root: resolved, message: 'unpacked; no Vite/Next/index.html/index.js detected — open files and Run' };
}
