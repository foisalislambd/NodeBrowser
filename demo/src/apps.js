/**
 * Mount real create-vite / create-next-app templates from /templates/*
 * into the BrowserNode VFS, and drive host-style Dev/Build messaging.
 *
 * Full Vite/Next CLIs run on the host via:
 *   npm run dev:vite | build:vite
 *   npm run dev:next | build:next | start:next
 */

export const VITE_ROOT = '/apps/vite';
export const NEXT_ROOT = '/apps/next';

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

async function listTemplateFiles(name) {
  const raw = await fetchText(`/templates/${name}.files.json`);
  return JSON.parse(raw);
}

/** Copy template sources (no node_modules) into VFS under mountRoot. */
export async function mountTemplate(bn, name, mountRoot) {
  const files = await listTemplateFiles(name);
  for (const rel of files) {
    const text = await fetchText(`/templates/${name}/${rel}`);
    const dest = `${mountRoot}/${rel}`.replace(/\/+/g, '/');
    const dir = dest.slice(0, dest.lastIndexOf('/'));
    if (dir && dir !== '/') await bn.fs.mkdir(dir, { recursive: true });
    await bn.fs.writeFile(dest, text);
  }
  return files;
}

export async function loadVite(bn, append) {
  append('mounting demo/templates/vite (create-vite React) → /apps/vite …\n');
  const files = await mountTemplate(bn, 'vite', VITE_ROOT);
  append(`mounted ${files.length} files\n`);
  append('Host: npm run dev:vite  |  npm run build:vite\n');
  return { root: VITE_ROOT, files };
}

export async function loadNext(bn, append) {
  append('mounting demo/templates/next (create-next-app) → /apps/next …\n');
  const files = await mountTemplate(bn, 'next', NEXT_ROOT);
  append(`mounted ${files.length} files\n`);
  append('Host: npm run dev:next  |  npm run build:next  |  npm run start:next\n');
  return { root: NEXT_ROOT, files };
}

/** Best-effort in-browser static preview of Vite index.html (no React runtime). */
export async function viteStaticPreview(bn, append) {
  await loadVite(bn, append);
  bn.closePort(5173);
  // Serve the template public assets + a stub note page built from index.html
  const html = await bn.fs.readFile(VITE_ROOT + '/index.html', 'utf8');
  await bn.fs.mkdir(VITE_ROOT + '/.preview', { recursive: true });
  const notice =
    '<main style="font:16px/1.5 Georgia,serif;padding:2rem;max-width:36rem">' +
    '<p style="letter-spacing:.12em;text-transform:uppercase;font-size:.75rem;color:#5ec8c0">Vite template</p>' +
    '<h1>Real create-vite app</h1>' +
    '<p>Sources are mounted at <code>/apps/vite</code>. Full React + HMR needs the host Vite server:</p>' +
    '<pre style="background:#111;color:#eee;padding:1rem">npm run dev:vite</pre>' +
    '</main>';
  let previewHtml = html;
  if (html.includes('id="root"')) {
    previewHtml = html.replace(/<div id="root"><\/div>/, '<div id="root">' + notice + '</div>');
  } else if (html.includes('id="app"')) {
    previewHtml = html.replace(/<div id="app"><\/div>/, '<div id="app">' + notice + '</div>');
  } else {
    previewHtml =
      '<!doctype html><html><head><meta charset="utf-8"/><title>Vite — BrowserNode</title></head><body>' +
      notice +
      '</body></html>';
  }
  await bn.fs.writeFile(VITE_ROOT + '/.preview/index.html', previewHtml);
  try {
    const css = await bn.fs.readFile(VITE_ROOT + '/src/index.css', 'utf8');
    await bn.fs.writeFile(VITE_ROOT + '/.preview/index.css', css);
  } catch {
    /* optional */
  }
  const url = bn.serveStatic(5173, VITE_ROOT + '/.preview');
  append('BN static preview → ' + url + ' (use npm run dev:vite for full app)\n');
  return { url, port: 5173 };
}

export async function nextStaticPreview(bn, append) {
  await loadNext(bn, append);
  bn.closePort(3000);
  await bn.fs.mkdir(NEXT_ROOT + '/.preview', { recursive: true });
  await bn.fs.writeFile(
    NEXT_ROOT + '/.preview/index.html',
    `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Next.js template — BrowserNode</title></head>
<body style="margin:0;font:16px/1.5 Georgia,serif;background:#f6f1ea;color:#1c1917">
<main style="max-width:36rem;margin:0 auto;padding:3rem 1.25rem">
<p style="text-transform:uppercase;letter-spacing:.14em;font-size:.72rem;color:#b45309">Next.js template</p>
<h1>Real create-next-app</h1>
<p>Sources are mounted at <code>/apps/next</code>. Full App Router + SSR needs the host Next server:</p>
<pre style="background:#1c1917;color:#f6f1ea;padding:1rem">npm run dev:next</pre>
</main></body></html>`,
  );
  const url = bn.serveStatic(3000, NEXT_ROOT + '/.preview');
  append('BN static preview → ' + url + ' (use npm run dev:next for full app)\n');
  return { url, port: 3000 };
}
