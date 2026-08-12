import type { NodeBrowser } from './index.js';

async function readUtf8(bn: NodeBrowser, path: string): Promise<string | null> {
  try {
    return await bn.fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export type ProjectKind = 'vite' | 'next' | 'static' | 'node' | 'unknown';

export type PreviewResult = {
  kind: ProjectKind;
  root: string;
  url?: string;
  port?: number;
  message: string;
};

export async function detectProjectKind(bn: NodeBrowser, root: string): Promise<ProjectKind> {
  const pkgRaw = await readUtf8(bn, `${root}/package.json`);
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } | null =
    null;
  if (pkgRaw) {
    try {
      pkg = JSON.parse(pkgRaw);
    } catch {
      pkg = null;
    }
  }
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const scripts = Object.values(pkg?.scripts || {}).join(' ');
  if (deps.next || /next/.test(scripts) || (await readUtf8(bn, `${root}/next.config.js`)) || (await readUtf8(bn, `${root}/next.config.mjs`))) {
    return 'next';
  }
  if (
    deps.vite ||
    /vite/.test(scripts) ||
    (await readUtf8(bn, `${root}/vite.config.js`)) ||
    (await readUtf8(bn, `${root}/vite.config.ts`)) ||
    (await readUtf8(bn, `${root}/src/main.jsx`)) ||
    (await readUtf8(bn, `${root}/src/main.tsx`))
  ) {
    return 'vite';
  }
  if ((await readUtf8(bn, `${root}/index.html`)) || (await readUtf8(bn, `${root}/index.htm`))) return 'static';
  if ((await readUtf8(bn, `${root}/index.js`)) || (await readUtf8(bn, `${root}/server.js`))) return 'node';
  return 'unknown';
}

/** Detect Vite / Next / static HTML / node and open in-tab preview when possible. */
export async function previewProject(bn: NodeBrowser, root: string): Promise<PreviewResult> {
  const kind = await detectProjectKind(bn, root);
  if (kind === 'vite') {
    const r = await bn.viteDev(root, { port: 5173 });
    return { kind, root, url: r.url, port: r.port, message: 'Vite subset preview' };
  }
  if (kind === 'next') {
    const r = await bn.nextDev(root, { port: 3000 });
    return { kind, root, url: r.url, port: r.port, message: 'Next subset preview' };
  }
  if (kind === 'static') {
    bn.closePort(8080);
    const url = bn.serveStatic(8080, root);
    return { kind, root, url, port: 8080, message: 'Static site preview' };
  }
  if (kind === 'node') {
    const script = (await readUtf8(bn, `${root}/server.js`)) ? `${root}/server.js` : `${root}/index.js`;
    await bn.spawn('node', [script], { cwd: root });
    return { kind, root, message: `spawned node ${script} — preview if it listens` };
  }
  return { kind, root, message: 'unpacked; no Vite/Next/index.html/index.js detected — open files and Run' };
}
