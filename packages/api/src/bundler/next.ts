/**
 * In-tab Next.js subset (Phase 30).
 * Not `next dev` from npm — App Router pages bundled with esbuild-wasm from kernel VFS.
 * Pinned intent: Next 15 App Router static + simple client pages.
 */

import type { NodeBrowser } from '../host/node-browser.js';
import { bundleWithEsbuild } from './esbuild.js';

function join(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

async function readUtf8(bn: NodeBrowser, path: string): Promise<string | null> {
  try {
    return await bn.fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export type NextResult = { url?: string; port?: number; outDir: string };

function pageToHtml(title: string, extraRoutes: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<link rel="stylesheet" href="./index.css"/>
</head>
<body>
<div id="root"></div>
<nav style="font:14px sans-serif;padding:8px 16px;border-bottom:1px solid #ddd">
  <a href="./">Home</a>${extraRoutes}
</nav>
<script src="./bundle.js"></script>
</body></html>`;
}

export async function nextBuild(bn: NodeBrowser, cwd: string): Promise<NextResult> {
  const outDir = join(cwd, '.next-preview');

  const page = join(cwd, 'app/page.js');
  const pageJsx = join(cwd, 'app/page.jsx');
  const entryPage = (await readUtf8(bn, page)) ? page : (await readUtf8(bn, pageJsx)) ? pageJsx : null;
  if (!entryPage) throw new Error('next: missing app/page.js (App Router subset)');

  const hello = join(cwd, 'app/hello/page.js');
  const helloJsx = join(cwd, 'app/hello/page.jsx');
  const helloPage = (await readUtf8(bn, hello)) ? hello : (await readUtf8(bn, helloJsx)) ? helloJsx : null;

  const wrapper = join(cwd, '.bn-next-entry.jsx');
  await bn.fs.writeFile(
    wrapper,
    `import Page from ${JSON.stringify(entryPage)};\n` +
      `import { createRoot } from 'react-dom/client';\n` +
      `const el = document.getElementById('root') || document.body;\n` +
      `createRoot(el).render(<Page />);\n`,
  );

  await bundleWithEsbuild(bn.fs, {
    entry: wrapper,
    outfile: join(outDir, 'bundle.js'),
    format: 'iife',
    jsx: 'automatic',
  });

  const css =
    (await readUtf8(bn, join(cwd, 'app/page.module.css'))) ||
    (await readUtf8(bn, join(cwd, 'app/globals.css'))) ||
    '';
  await bn.fs.mkdir(outDir, { recursive: true });
  await bn.fs.writeFile(join(outDir, 'index.css'), css);
  const extra = helloPage ? ' · <a href="./hello/">/hello</a>' : '';
  await bn.fs.writeFile(join(outDir, 'index.html'), pageToHtml('Next subset — NodeBrowser', extra));

  if (helloPage) {
    const helloWrap = join(cwd, '.bn-next-hello.jsx');
    await bn.fs.writeFile(
      helloWrap,
      `import Page from ${JSON.stringify(helloPage)};\n` +
        `import { createRoot } from 'react-dom/client';\n` +
        `const el = document.getElementById('root') || document.body;\n` +
        `createRoot(el).render(<Page />);\n`,
    );
    await bundleWithEsbuild(bn.fs, {
      entry: helloWrap,
      outfile: join(outDir, 'hello/bundle.js'),
      format: 'iife',
      jsx: 'automatic',
    });
    await bn.fs.mkdir(join(outDir, 'hello'), { recursive: true });
    await bn.fs.writeFile(
      join(outDir, 'hello/index.html'),
      pageToHtml('Hello — Next subset', ' · <a href="../">Home</a>'),
    );
    await bn.fs.writeFile(join(outDir, 'hello/index.css'), css);
  }

  const apiRoutes = await listApiRoutes(bn, join(cwd, 'app/api'));
  for (const rel of apiRoutes) {
    const destDir = join(outDir, 'api', rel);
    await bn.fs.mkdir(destDir, { recursive: true });
    await bn.fs.writeFile(
      join(destDir, 'index.json'),
      JSON.stringify({ ok: true, subset: 'GET', route: 'app/api/' + rel + '/route.js' }) + '\n',
    );
  }

  return { outDir };
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
    else if (n === 'route.js' || n === 'route.ts' || n === 'route.jsx') {
      out.push(prefix);
    }
  }
  return out.filter(Boolean);
}

export async function nextDev(bn: NodeBrowser, cwd: string, opts?: { port?: number }): Promise<NextResult> {
  const port = opts?.port ?? 3000;
  const built = await nextBuild(bn, cwd);
  bn.closePort(port);
  const url = bn.serveStatic(port, built.outDir);
  return { ...built, url, port };
}
