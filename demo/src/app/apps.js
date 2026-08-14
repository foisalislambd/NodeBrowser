/**
 * Mount real create-vite / create-next-app templates from /templates/*
 * into /home/project (replaces the current workspace).
 */

import { publicHref } from './paths.js';

export const PROJECT_ROOT = '/home/project';

function assetUrl(rel) {
  return publicHref(rel);
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

async function replaceWithTemplate(bn, name, append, note) {
  append(`replacing /home/project with ${name} template …\n`);
  await bn.clearWorkspace();
  const files = await mountTemplate(bn, name, PROJECT_ROOT);
  append(`mounted ${files.length} files\n`);
  append(note);
  return { root: PROJECT_ROOT, files };
}

export async function loadVite(bn, append) {
  return replaceWithTemplate(
    bn,
    'vite',
    append,
    'In-tab Vite preview uses esbuild-wasm + kernel VFS (not host npm run dev:vite).\n',
  );
}

export async function loadExpress(bn, append) {
  return replaceWithTemplate(
    bn,
    'express',
    append,
    'spawn: node /home/project/server.js\n',
  );
}

export async function loadNext(bn, append) {
  return replaceWithTemplate(
    bn,
    'next',
    append,
    'In-tab Next preview is App Router subset (esbuild-wasm), not full next CLI.\n',
  );
}

export async function viteStaticPreview(bn, append) {
  await loadVite(bn, append);
  append('viteDev /home/project …\n');
  const { url, port, outfile } = await bn.viteDev(PROJECT_ROOT, { port: 5173 });
  append(`in-tab Vite → ${url} (${outfile})\n`);
  return { url, port };
}

export async function nextStaticPreview(bn, append) {
  await loadNext(bn, append);
  append('nextDev /home/project …\n');
  const { url, port } = await bn.nextDev(PROJECT_ROOT, { port: 3000 });
  append(`in-tab Next subset → ${url}\n`);
  return { url, port };
}
