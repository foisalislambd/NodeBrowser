/**
 * In-tab Next.js subset (Phase 30).
 * Not `next dev` from npm — App Router pages bundled with esbuild-wasm from kernel VFS.
 * Supports `app/` and `src/app/` (js/jsx/ts/tsx). Pages Router is a single-entry fallback.
 */

import type { NodeBrowser } from '../host/node-browser.js';
import { bundleWithEsbuild } from './esbuild.js';

function join(...parts: string[]): string {
  return parts
    .filter((p) => p != null && p !== '')
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^(?!\/)/, '/');
}

async function readUtf8(bn: NodeBrowser, path: string): Promise<string | null> {
  try {
    return await bn.fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

const PAGE_FILES = ['page.tsx', 'page.jsx', 'page.ts', 'page.js'];
const INDEX_FILES = ['index.tsx', 'index.jsx', 'index.ts', 'index.js'];

async function firstExisting(bn: NodeBrowser, dir: string, names: string[]): Promise<string | null> {
  for (const n of names) {
    const p = join(dir, n);
    if (await readUtf8(bn, p)) return p;
  }
  return null;
}

/** App Router directory: `src/app` (preferred when present) or `app`. */
export async function findAppDir(bn: NodeBrowser, cwd: string): Promise<string | null> {
  for (const d of [join(cwd, 'src/app'), join(cwd, 'app')]) {
    if (await firstExisting(bn, d, PAGE_FILES)) return d;
  }
  return null;
}

async function findPagesIndex(bn: NodeBrowser, cwd: string): Promise<string | null> {
  for (const d of [join(cwd, 'src/pages'), join(cwd, 'pages')]) {
    const hit = await firstExisting(bn, d, INDEX_FILES);
    if (hit) return hit;
  }
  return null;
}

export type NextResult = { url?: string; port?: number; outDir: string; appDir?: string };

function pageToHtml(title: string, extraRoutes: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<link rel="stylesheet" href="./index.css"/>
</head>
<body>
<div id="root"></div>
<nav style="font:14px system-ui,sans-serif;padding:8px 16px;border-bottom:1px solid #ddd;background:#fafafa">
  <a href="./">Home</a>${extraRoutes}
</nav>
<script src="./bundle.js"></script>
</body></html>`;
}

const LAYOUT_FILES = ['layout.tsx', 'layout.jsx', 'layout.ts', 'layout.js'];

function wrapperSource(entryPage: string, layoutFile?: string | null): string {
  if (layoutFile) {
    return (
      `import Page from ${JSON.stringify(entryPage)};\n` +
      `import Layout from ${JSON.stringify(layoutFile)};\n` +
      `import { createRoot } from 'react-dom/client';\n` +
      `const el = document.getElementById('root') || document.body;\n` +
      `createRoot(el).render(<Layout><Page /></Layout>);\n`
    );
  }
  return (
    `import Page from ${JSON.stringify(entryPage)};\n` +
    `import { createRoot } from 'react-dom/client';\n` +
    `const el = document.getElementById('root') || document.body;\n` +
    `createRoot(el).render(<Page />);\n`
  );
}

async function collectAppPages(
  bn: NodeBrowser,
  appDir: string,
  prefix = '',
): Promise<{ route: string; file: string }[]> {
  const dir = prefix ? join(appDir, prefix) : appDir;
  const out: { route: string; file: string }[] = [];
  const page = await firstExisting(bn, dir, PAGE_FILES);
  if (page) out.push({ route: prefix, file: page });

  let names: string[] = [];
  try {
    names = await bn.fs.readdir(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (n.startsWith('.') || n === 'api' || n === 'node_modules' || n.includes('[') || n.includes('(')) continue;
    const p = join(dir, n);
    let isDir = false;
    try {
      isDir = (await bn.fs.stat(p)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const rel = prefix ? `${prefix}/${n}` : n;
    out.push(...(await collectAppPages(bn, appDir, rel)));
  }
  return out;
}

export async function nextBuild(bn: NodeBrowser, cwd: string): Promise<NextResult> {
  const outDir = join(cwd, '.next-preview');
  await bn.fs.mkdir(outDir, { recursive: true });

  const appDir = await findAppDir(bn, cwd);
  if (appDir) {
    const pages = await collectAppPages(bn, appDir);
    const home = pages.find((p) => p.route === '');
    if (!home) throw new Error('next: missing page.tsx / page.js under app/ or src/app/');

    const layout = await firstExisting(bn, appDir, LAYOUT_FILES);
    const wrapper = join(cwd, '.bn-next-entry.jsx');
    await bn.fs.writeFile(wrapper, wrapperSource(home.file, layout));
    await bundleWithEsbuild(bn.fs, {
      entry: wrapper,
      outfile: join(outDir, 'bundle.js'),
      format: 'iife',
      jsx: 'automatic',
    });

    const css =
      (await readUtf8(bn, join(appDir, 'globals.css'))) ||
      (await readUtf8(bn, join(appDir, 'page.module.css'))) ||
      (await readUtf8(bn, join(appDir, 'global.css'))) ||
      '';
    await bn.fs.writeFile(join(outDir, 'index.css'), css);

    const extras = pages.filter((p) => p.route);
    const extraNav = extras.map((p) => ` · <a href="./${p.route}/">/${p.route}</a>`).join('');
    await bn.fs.writeFile(join(outDir, 'index.html'), pageToHtml('Next subset — NodeBrowser', extraNav));

    for (const extra of extras) {
      const helloWrap = join(cwd, `.bn-next-${extra.route.replace(/\//g, '-')}.jsx`);
      const extraLayout =
        (await firstExisting(bn, join(appDir, extra.route), LAYOUT_FILES)) || layout;
      await bn.fs.writeFile(helloWrap, wrapperSource(extra.file, extraLayout));
      const destDir = join(outDir, extra.route);
      await bn.fs.mkdir(destDir, { recursive: true });
      await bundleWithEsbuild(bn.fs, {
        entry: helloWrap,
        outfile: join(destDir, 'bundle.js'),
        format: 'iife',
        jsx: 'automatic',
      });
      const up = extra.route.split('/').map(() => '..').join('/');
      await bn.fs.writeFile(
        join(destDir, 'index.html'),
        pageToHtml(`${extra.route} — Next subset`, ` · <a href="${up}/">Home</a>`),
      );
      await bn.fs.writeFile(join(destDir, 'index.css'), css);
    }

    const apiRoot = join(appDir, 'api');
    const apiRoutes = await listApiRoutes(bn, apiRoot);
    for (const rel of apiRoutes) {
      const destDir = rel ? join(outDir, 'api', rel) : join(outDir, 'api');
      await bn.fs.mkdir(destDir, { recursive: true });
      const routeFile = rel ? `api/${rel}/route` : 'api/route';
      await bn.fs.writeFile(
        join(destDir, 'index.json'),
        JSON.stringify({ ok: true, subset: 'GET', route: routeFile }) + '\n',
      );
    }

    return { outDir, appDir };
  }

  const pagesIndex = await findPagesIndex(bn, cwd);
  if (pagesIndex) {
    const wrapper = join(cwd, '.bn-next-entry.jsx');
    await bn.fs.writeFile(wrapper, wrapperSource(pagesIndex));
    await bundleWithEsbuild(bn.fs, {
      entry: wrapper,
      outfile: join(outDir, 'bundle.js'),
      format: 'iife',
      jsx: 'automatic',
    });
    await bn.fs.writeFile(join(outDir, 'index.css'), '');
    await bn.fs.writeFile(join(outDir, 'index.html'), pageToHtml('Next pages — NodeBrowser', ''));
    return { outDir };
  }

  throw new Error(
    'next: no App Router page (app/page.* or src/app/page.*) and no Pages Router index (pages/index.* or src/pages/index.*)',
  );
}

async function listApiRoutes(bn: NodeBrowser, dir: string, prefix = ''): Promise<string[]> {
  let names: string[] = [];
  try {
    names = await bn.fs.readdir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names) {
    const p = join(dir, n);
    let isDir = false;
    try {
      isDir = (await bn.fs.stat(p)).isDirectory();
    } catch {
      continue;
    }
    const rel = prefix ? `${prefix}/${n}` : n;
    if (isDir) out.push(...(await listApiRoutes(bn, p, rel)));
    else if (/^route\.(js|ts|jsx|tsx)$/.test(n)) {
      out.push(prefix);
    }
  }
  return out;
}

export async function nextDev(bn: NodeBrowser, cwd: string, opts?: { port?: number }): Promise<NextResult> {
  const port = opts?.port ?? 3000;
  const built = await nextBuild(bn, cwd);
  bn.closePort(port);
  const url = bn.serveStatic(port, built.outDir);
  return { ...built, url, port };
}
