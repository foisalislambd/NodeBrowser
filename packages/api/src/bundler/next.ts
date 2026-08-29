/**
 * In-tab Next.js subset (Phase 30).
 * Not `next dev` from npm — App Router pages bundled with esbuild-wasm from kernel VFS.
 * Supports `app/` and `src/app/` (js/jsx/ts/tsx). Pages Router is a single-entry fallback.
 */

import type { NodeBrowser } from '../host/node-browser.js';
import { bundleWithEsbuild } from './esbuild.js';
import { copyPublicInto, writePreviewHtml, collectCssUnder } from './preview-assets.js';

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

const LAYOUT_FILES = ['layout.tsx', 'layout.jsx', 'layout.ts', 'layout.js'];

function wrapperSource(entryPage: string, layoutFile?: string | null): string {
  const layoutImport = layoutFile
    ? `import Layout from ${JSON.stringify(layoutFile)};\n`
    : '';
  const render = layoutFile
    ? `createRoot(el).render(<Layout><Page /></Layout>);\n`
    : `createRoot(el).render(<Page />);\n`;
  return (
    layoutImport +
    `import Page from ${JSON.stringify(entryPage)};\n` +
    `import { createRoot } from 'react-dom/client';\n` +
    `const el = document.getElementById('root') || document.body;\n` +
    render
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
    try {
      await bundleWithEsbuild(bn.fs, {
        entry: wrapper,
        outfile: join(outDir, 'bundle.js'),
        format: 'iife',
        jsx: 'automatic',
        projectRoot: cwd,
      });
    } catch (err) {
      const msg = String((err as Error)?.message || err);
      throw new Error(
        `next preview failed: ${msg}. Zip the app folder (app/page.* or src/app/page.*), omit node_modules/.next.`,
      );
    }

    const cssParts: string[] = [];
    for (const rel of ['globals.css', 'global.css', 'page.module.css']) {
      const chunk = await readUtf8(bn, join(appDir, rel));
      if (chunk) cssParts.push(chunk);
    }
    const walked = await collectCssUnder(bn, appDir);
    if (walked) cssParts.push(walked);
    const css = cssParts.join('\n');
    await copyPublicInto(bn, cwd, outDir);
    await writePreviewHtml(bn, outDir, join(outDir, 'index.html'), {
      title: 'Next preview',
      css,
    });

    const extras = pages.filter((p) => p.route);
    for (const extra of extras) {
      const helloWrap = join(cwd, `.bn-next-${extra.route.replace(/\//g, '-')}.jsx`);
      await bn.fs.writeFile(helloWrap, wrapperSource(extra.file, layout));
      const destDir = join(outDir, extra.route);
      await bn.fs.mkdir(destDir, { recursive: true });
      await copyPublicInto(bn, cwd, destDir);
      await bundleWithEsbuild(bn.fs, {
        entry: helloWrap,
        outfile: join(destDir, 'bundle.js'),
        format: 'iife',
        jsx: 'automatic',
        projectRoot: cwd,
      });
      const up = extra.route.split('/').map(() => '..').join('/');
      await writePreviewHtml(bn, outDir, join(destDir, 'index.html'), {
        title: extra.route,
        css,
        twHref: `${up}/__tw_browser.js`,
      });
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
      projectRoot: cwd,
    });
    await copyPublicInto(bn, cwd, outDir);
    await writePreviewHtml(bn, outDir, join(outDir, 'index.html'), { title: 'Next preview', css: '' });
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
