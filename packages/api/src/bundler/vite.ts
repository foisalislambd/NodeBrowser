/**
 * In-tab Vite subset (Phases 27–29).
 * Bundler is esbuild-wasm (host). Files and spawn PATH live in the C++ kernel VFS.
 * Not the upstream `vite` CLI — same DX: dev / build / HMR reload.
 */

import type { NodeBrowser } from './index.js';
import { bundleWithEsbuild } from './esbuild-bundle.js';

const HMR_CLIENT = `(() => {
  let g = '';
  async function tick() {
    try {
      const r = await fetch('./__hmr_gen', { cache: 'no-store' });
      const n = await r.text();
      if (g && n && g !== n) location.reload();
      g = n;
    } catch (_) {}
  }
  setInterval(tick, 600);
  tick();
})();`;

function join(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

function underRoot(path: string, root: string): boolean {
  const r = root.replace(/\/+$/, '') || '/';
  if (r === '/') return true;
  return path === r || path.startsWith(r + '/');
}

async function readUtf8(bn: NodeBrowser, path: string): Promise<string | null> {
  try {
    return await bn.fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

function parseHtmlEntry(html: string, cwd: string): string | null {
  const m = html.match(/<script[^>]+src=["']([^"']+)["']/i);
  if (!m) return null;
  const src = m[1]!;
  if (src.startsWith('/')) return join(cwd, src);
  return join(cwd, src.replace(/^\.\//, ''));
}

function pluginHint(code: string): string | null {
  if (/\.vue['"]/.test(code) || /plugin-vue/.test(code)) {
    return 'Vue SFC (@vitejs/plugin-vue) is not compiled in-tab yet — use .jsx/.tsx or prebundle.';
  }
  if (/\.svelte['"]/.test(code) || /plugin-svelte/.test(code)) {
    return 'Svelte (@sveltejs/vite-plugin-svelte) is not compiled in-tab yet — use .jsx/.tsx or prebundle.';
  }
  return null;
}

export type ViteResult = { url?: string; port?: number; outDir: string; outfile: string };

export async function viteBuild(bn: NodeBrowser, cwd: string, opts?: { outDir?: string }): Promise<ViteResult> {
  const outDir = opts?.outDir || join(cwd, 'dist');
  const htmlPath = join(cwd, 'index.html');
  const html = (await readUtf8(bn, htmlPath)) || '<!doctype html><div id="root"></div>';
  const cfg = (await readUtf8(bn, join(cwd, 'vite.config.js'))) || (await readUtf8(bn, join(cwd, 'vite.config.ts'))) || '';
  const hint = pluginHint(cfg + html);
  if (hint && /\.vue|\.svelte/.test(cfg)) {
    throw new Error('vite: ' + hint);
  }

  let entry = parseHtmlEntry(html, cwd);
  if (!entry) {
    for (const c of ['src/main.jsx', 'src/main.tsx', 'src/main.js', 'src/index.jsx', 'src/index.js']) {
      if (await readUtf8(bn, join(cwd, c))) {
        entry = join(cwd, c);
        break;
      }
    }
  }
  if (!entry) throw new Error('vite: no entry (index.html script or src/main.*)');

  const outfile = join(outDir, 'bundle.js');
  await bundleWithEsbuild(bn.fs, {
    entry,
    outfile,
    format: 'iife',
    jsx: 'automatic',
  });

  const css = (await readUtf8(bn, join(cwd, 'src/index.css'))) || (await readUtf8(bn, join(cwd, 'src/App.css'))) || '';
  if (css) await bn.fs.writeFile(join(outDir, 'index.css'), css);

  let outHtml = html.replace(/<script[^>]+src=["'][^"']+["'][^>]*><\/script>/i, '<script src="./bundle.js"></script>');
  if (!outHtml.includes('bundle.js')) {
    outHtml = outHtml.replace('</body>', '<script src="./bundle.js"></script></body>');
    if (!outHtml.includes('bundle.js')) {
      outHtml += '<script src="./bundle.js"></script>';
    }
  }
  if (css && !outHtml.includes('index.css')) {
    if (outHtml.includes('</head>')) {
      outHtml = outHtml.replace('</head>', '<link rel="stylesheet" href="./index.css"/></head>');
    } else {
      outHtml = '<link rel="stylesheet" href="./index.css"/>' + outHtml;
    }
  }
  const hmrTag = `<script>${HMR_CLIENT}</script>`;
  if (outHtml.includes('</body>')) outHtml = outHtml.replace('</body>', hmrTag + '</body>');
  else outHtml += hmrTag;
  await bn.fs.mkdir(outDir, { recursive: true });
  await bn.fs.writeFile(join(outDir, 'index.html'), outHtml);
  await bn.fs.writeFile(join(outDir, '__hmr_gen'), String(Date.now()));
  return { outDir, outfile };
}

const watchers = new WeakMap<object, (ev: { path: string }) => void>();

export async function viteDev(
  bn: NodeBrowser,
  cwd: string,
  opts?: { port?: number },
): Promise<ViteResult> {
  const port = opts?.port ?? 5173;
  const built = await viteBuild(bn, cwd);
  bn.closePort(port);
  const url = bn.serveStatic(port, built.outDir);
  const prev = watchers.get(bn);
  if (prev) bn.off('fs-change', prev);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onFs = (ev: { path: string }) => {
    if (!underRoot(ev.path, cwd)) return;
    if (underRoot(ev.path, join(cwd, 'dist'))) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      viteBuild(bn, cwd).catch(() => undefined);
    }, 200);
  };
  watchers.set(bn, onFs);
  bn.on('fs-change', onFs);
  return { ...built, url, port };
}
