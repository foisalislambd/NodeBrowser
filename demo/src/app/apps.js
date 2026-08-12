/**
 * Mount real create-vite / create-next-app templates from /templates/*
 * into the NodeBrowser VFS, and drive host-style Dev/Build messaging.
 *
 * Full Vite/Next CLIs run on the host via:
 *   npm run dev:vite | build:vite
 *   npm run dev:next | build:next | start:next
 */

export const VITE_ROOT = '/apps/vite';
export const NEXT_ROOT = '/apps/next';

/** Resolve demo assets next to this module (works on GitHub Pages project sites). */
function assetUrl(rel) {
  const clean = String(rel).replace(/^\//, '');
  // apps.js lives in dist/; templates/ is dist/templates/
  return new URL(clean, import.meta.url).href;
}

async function fetchText(rel) {
  const url = assetUrl(rel);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

async function listTemplateFiles(name) {
  const raw = await fetchText(`templates/${name}.files.json`);
  return JSON.parse(raw);
}

/** Copy template sources (no node_modules) into VFS under mountRoot. */
export async function mountTemplate(bn, name, mountRoot) {
  const files = await listTemplateFiles(name);
  for (const rel of files) {
    const text = await fetchText(`templates/${name}/${rel}`);
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
  append('In-tab: Vite preview uses esbuild-wasm + kernel VFS (not host npm run dev:vite).\n');
  return { root: VITE_ROOT, files };
}

export async function loadNext(bn, append) {
  append('mounting demo/templates/next (create-next-app) → /apps/next …\n');
  const files = await mountTemplate(bn, 'next', NEXT_ROOT);
  append(`mounted ${files.length} files\n`);
  append('In-tab: Next preview is App Router subset (esbuild-wasm), not full next CLI.\n');
  return { root: NEXT_ROOT, files };
}

/** In-tab Vite: bundle + HMR reload + static preview. */
export async function viteStaticPreview(bn, append) {
  await loadVite(bn, append);
  append('viteDev /apps/vite …\n');
  const { url, port, outfile } = await bn.viteDev(VITE_ROOT, { port: 5173 });
  append(`in-tab Vite → ${url} (${outfile})\n`);
  return { url, port };
}

export async function nextStaticPreview(bn, append) {
  await loadNext(bn, append);
  append('nextDev /apps/next …\n');
  const { url, port } = await bn.nextDev(NEXT_ROOT, { port: 3000 });
  append(`in-tab Next subset → ${url}\n`);
  return { url, port };
}
