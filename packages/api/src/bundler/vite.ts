/**
 * In-tab Vite subset (Phases 27–29).
 * Bundler is esbuild-wasm (host). Files and spawn PATH live in the C++ kernel VFS.
 * Not the upstream `vite` CLI — same DX: dev / build / HMR reload.
 */

import type { NodeBrowser } from '../host/node-browser.js';
import { bundleWithEsbuild } from './esbuild.js';
import { copyPublicInto, looksLikeTailwind, stripTailwindImport, stripLocalCssImports, TW_BROWSER_VFS, collectCssUnder } from './preview-assets.js';

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
  const re = /<script[^>]*src=["']([^"']+)["'][^>]*>/gi;
  const srcs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const src = m[1]!;
    if (/^https?:/i.test(src) || src.startsWith('//')) continue;
    srcs.push(src);
  }
  const pick =
    srcs.find((s) => /src\/main\./i.test(s)) ||
    srcs.find((s) => /\/src\//i.test(s) || s.startsWith('src/') || s.startsWith('./src/')) ||
    srcs[0];
  if (!pick) return null;
  const rel = pick.replace(/^\.\//, '');
  return join(cwd, rel);
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
    for (const c of [
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
    ]) {
      if (await readUtf8(bn, join(cwd, c))) {
        entry = join(cwd, c);
        break;
      }
    }
  }
  if (!entry) throw new Error('vite: no entry (index.html script or src/main.* / src/index.*)');

  const outfile = join(outDir, 'bundle.js');
  try {
    await bundleWithEsbuild(bn.fs, {
      entry,
      outfile,
      format: 'iife',
      jsx: 'automatic',
      projectRoot: cwd,
    });
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    throw new Error(
      `vite preview failed: ${msg}. Zip the project source (index.html + src/), omit node_modules/.git. Vue/Svelte SFCs are not compiled in-tab.`,
    );
  }

  const cssParts: string[] = [];
  for (const rel of ['src/index.css', 'src/App.css', 'src/app.css', 'index.css']) {
    const chunk = await readUtf8(bn, join(cwd, rel));
    if (chunk) cssParts.push(chunk);
  }
  const walked = await collectCssUnder(bn, join(cwd, 'src'));
  if (walked) cssParts.push(walked);
  const css = cssParts.join('\n');
  await copyPublicInto(bn, cwd, outDir);

  let outHtml = html.replace(/<script[^>]+src=["'][^"']+["'][^>]*><\/script>/i, '<script src="./bundle.js"></script>');
  if (!outHtml.includes('bundle.js')) {
    outHtml = outHtml.replace('</body>', '<script src="./bundle.js"></script></body>');
    if (!outHtml.includes('bundle.js')) {
      outHtml += '<script src="./bundle.js"></script>';
    }
  }
  outHtml = outHtml.replace(/\b(href|src)=["']\/(?!\/)([^"']*)["']/gi, (_, attr, rest) => `${attr}="./${rest}"`);
  outHtml = outHtml.replace(/\bhref=["'](?:\.\/)?src\/[^"']+\.css["']/gi, 'href="./index.css"');
  const twSrc = await readUtf8(bn, TW_BROWSER_VFS);
  const useTw = !!(twSrc && looksLikeTailwind(css));
  if (useTw) {
    await bn.fs.writeFile(join(outDir, '__tw_browser.js'), twSrc!);
    if (!outHtml.includes('__tw_browser.js')) {
      const twTag = `<style type="text/tailwindcss">${css.replace(/<\/style/gi, '<\\/style')}</style><script src="./__tw_browser.js"></script>`;
      if (outHtml.includes('</head>')) outHtml = outHtml.replace('</head>', twTag + '</head>');
      else outHtml = twTag + outHtml;
    }
  }
  if (css) {
    await bn.fs.writeFile(join(outDir, 'index.css'), stripLocalCssImports(stripTailwindImport(css)));
    if (!/href=["'][^"']*index\.css["']/i.test(outHtml)) {
      if (outHtml.includes('</head>')) {
        outHtml = outHtml.replace('</head>', '<link rel="stylesheet" href="./index.css"/></head>');
      } else {
        outHtml = '<link rel="stylesheet" href="./index.css"/>' + outHtml;
      }
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
