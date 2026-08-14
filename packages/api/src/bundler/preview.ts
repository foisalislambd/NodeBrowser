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
const VITE_CONFIG = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'];

async function hasAny(bn: NodeBrowser, root: string, names: string[]): Promise<boolean> {
  for (const n of names) {
    if (await readUtf8(bn, `${root}/${n}`)) return true;
  }
  return false;
}

async function looksLikeProject(bn: NodeBrowser, root: string): Promise<boolean> {
  if (await readUtf8(bn, `${root}/package.json`)) return true;
  if (await findAppDir(bn, root)) return true;
  if (await hasAny(bn, root, NEXT_CONFIG)) return true;
  if (await hasAny(bn, root, VITE_CONFIG)) return true;
  if (await readUtf8(bn, `${root}/index.html`)) return true;
  if (await readUtf8(bn, `${root}/src/main.jsx`) || (await readUtf8(bn, `${root}/src/main.tsx`))) return true;
  return false;
}

/** If ZIP left a single nested project folder (or dest is a parent), return that folder. */
export async function resolveProjectRoot(bn: NodeBrowser, root: string): Promise<string> {
  if (await looksLikeProject(bn, root)) return root;
  let names: string[] = [];
  try {
    names = await bn.fs.readdir(root);
  } catch {
    return root;
  }
  const skip = new Set(['__macosx', '.ds_store', 'node_modules', '.git', '.next', 'dist']);
  const hits: string[] = [];
  for (const n of names) {
    if (skip.has(n.toLowerCase())) continue;
    const p = `${root}/${n}`.replace(/\/+/g, '/');
    let isDir = false;
    try {
      isDir = (await bn.fs.stat(p)).isDirectory();
    } catch {
      continue;
    }
    if (isDir && (await looksLikeProject(bn, p))) hits.push(p);
  }
  return hits.length === 1 ? hits[0]! : root;
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
    (await readUtf8(bn, `${root}/src/main.jsx`)) ||
    (await readUtf8(bn, `${root}/src/main.tsx`))
  ) {
    return 'vite';
  }
  if ((await readUtf8(bn, `${root}/index.html`)) || (await readUtf8(bn, `${root}/index.htm`))) return 'static';
  if ((await readUtf8(bn, `${root}/index.js`)) || (await readUtf8(bn, `${root}/server.js`))) return 'node';
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
