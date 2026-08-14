/**
 * Mount real create-vite / create-next-app templates from /templates/*
 * into the NodeBrowser VFS, and drive host-style Dev/Build messaging.
 *
 * Full Vite/Next CLIs run on the host via:
 *   npm run dev:vite | build:vite
 *   npm run dev:next | build:next | start:next
 */

import type { NodeBrowser } from '@foisal/nodebrowser';
import { publicHref } from './paths.js';

export const VITE_ROOT = '/apps/vite';
export const NEXT_ROOT = '/apps/next';

type Append = (text: string) => void;

function assetUrl(rel: string): string {
  return publicHref(rel);
}

async function fetchText(rel: string): Promise<string> {
  const url = assetUrl(rel);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

async function listTemplateFiles(name: string): Promise<string[]> {
  const raw = await fetchText(`templates/${name}.files.json`);
  return JSON.parse(raw) as string[];
}

/** Copy template sources (no node_modules) into VFS under mountRoot. */
export async function mountTemplate(bn: NodeBrowser, name: string, mountRoot: string): Promise<string[]> {
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

export async function loadVite(bn: NodeBrowser, append: Append): Promise<{ root: string; files: string[] }> {
  append('mounting demo/templates/vite (create-vite React) → /apps/vite …\n');
  const files = await mountTemplate(bn, 'vite', VITE_ROOT);
  append(`mounted ${files.length} files\n`);
  append('In-tab: Vite preview uses esbuild-wasm + kernel VFS (not host npm run dev:vite).\n');
  return { root: VITE_ROOT, files };
}

export async function loadExpress(bn: NodeBrowser, append: Append): Promise<{ root: string; files: string[] }> {
  append('mounting demo/templates/express → /apps/express …\n');
  const files = await mountTemplate(bn, 'express', '/apps/express');
  append(`mounted ${files.length} files — spawn: node /apps/express/server.js\n`);
  return { root: '/apps/express', files };
}

export async function loadNext(bn: NodeBrowser, append: Append): Promise<{ root: string; files: string[] }> {
  append('mounting demo/templates/next (create-next-app) → /apps/next …\n');
  const files = await mountTemplate(bn, 'next', NEXT_ROOT);
  append(`mounted ${files.length} files\n`);
  append('In-tab: Next preview is App Router subset (esbuild-wasm), not full next CLI.\n');
  return { root: NEXT_ROOT, files };
}

/** In-tab Vite: bundle + HMR reload + static preview. */
export async function viteStaticPreview(
  bn: NodeBrowser,
  append: Append,
): Promise<{ url: string; port: number }> {
  await loadVite(bn, append);
  append('viteDev /apps/vite …\n');
  const { url, port, outfile } = await bn.viteDev(VITE_ROOT, { port: 5173 });
  append(`in-tab Vite → ${url} (${outfile})\n`);
  return { url, port };
}

export async function nextStaticPreview(
  bn: NodeBrowser,
  append: Append,
): Promise<{ url: string; port: number }> {
  await loadNext(bn, append);
  append('nextDev /apps/next …\n');
  const { url, port } = await bn.nextDev(NEXT_ROOT, { port: 3000 });
  append(`in-tab Next subset → ${url}\n`);
  return { url, port };
}
