import type { NodeBrowser } from '../host/node-browser.js';

export const TW_BROWSER_VFS = '/usr/share/nodebrowser/tailwind-browser.js';

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

export function stripTailwindImport(css: string): string {
  return css
    .replace(/@import\s+["']tailwindcss(?:\/[^"']*)?["']\s*;?/g, '')
    .replace(/@import\s+["']tailwindcss["']\s*;?/g, '');
}

export function looksLikeTailwind(css: string): boolean {
  return /@import\s+["']tailwindcss|@tailwind\s|@theme\b/.test(css);
}

export async function copyPublicInto(bn: NodeBrowser, cwd: string, outDir: string): Promise<void> {
  for (const name of ['public', 'static']) {
    await copyTree(bn, join(cwd, name), outDir);
  }
}

async function copyTree(bn: NodeBrowser, from: string, to: string): Promise<void> {
  let names: string[] = [];
  try {
    names = await bn.fs.readdir(from);
  } catch {
    return;
  }
  await bn.fs.mkdir(to, { recursive: true });
  for (const n of names) {
    if (n === '.' || n === '..' || n === 'node_modules' || n === '.git') continue;
    const src = join(from, n);
    const dest = join(to, n);
    let isDir = false;
    try {
      isDir = (await bn.fs.stat(src)).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      await copyTree(bn, src, dest);
      continue;
    }
    try {
      const buf = await bn.fs.readFile(src, 'buffer');
      await bn.fs.writeFile(dest, buf);
    } catch {
      const text = await readUtf8(bn, src);
      if (text != null) await bn.fs.writeFile(dest, text);
    }
  }
}

export async function writePreviewHtml(
  bn: NodeBrowser,
  outDir: string,
  destFile: string,
  opts: { title: string; css: string; twHref?: string },
): Promise<void> {
  const twSrc = await readUtf8(bn, TW_BROWSER_VFS);
  if (twSrc) {
    await bn.fs.writeFile(join(outDir, '__tw_browser.js'), twSrc);
  }
  const twHref = opts.twHref || './__tw_browser.js';
  const css = opts.css || '';
  const twStyle = css
    ? `<style type="text/tailwindcss">${css.replace(/<\/style/gi, '<\\/style')}</style>\n`
    : '';
  const twBlock = twSrc ? `${twStyle}<script src="${twHref}"></script>\n` : '';
  const linkCss = `<link rel="stylesheet" href="./index.css"/>`;
  const html = `<!doctype html>
<html lang="en" class="h-full antialiased">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${opts.title}</title>
${linkCss}
${twBlock}
</head>
<body class="min-h-full flex flex-col">
<div id="root" class="min-h-full flex flex-1 flex-col"></div>
<script src="./bundle.js"></script>
</body>
</html>`;
  const destDir = destFile.slice(0, destFile.lastIndexOf('/')) || outDir;
  await bn.fs.writeFile(destFile, html);
  await bn.fs.writeFile(join(destDir, 'index.css'), stripTailwindImport(css));
}
