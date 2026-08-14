import { getAbsoluteBase, getBase, resolveUrl } from 'vite-basepath/runtime';

function deployBase(): string {
  const detected = getBase();
  if (detected && detected !== './') return detected.endsWith('/') ? detected : `${detected}/`;
  const path = window.location.pathname || '/';
  if (path.endsWith('/')) return path;
  if (/\.[a-zA-Z0-9]+$/.test(path)) return path.replace(/[^/]+$/, '') || '/';
  return `${path}/`;
}

/** Origin-absolute URL under the detected deploy base (`/` in Vite dev, `/NodeBrowser/` on Pages). */
export function publicHref(rel: string): string {
  const clean = String(rel || '').replace(/^\//, '');
  return new URL(deployBase() + clean, window.location.origin).href;
}

export function publicPath(rel: string): string {
  const clean = String(rel || '').replace(/^\//, '');
  return deployBase() + clean;
}

export { getAbsoluteBase, getBase, resolveUrl, deployBase as publicBase };
