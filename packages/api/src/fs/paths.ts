/** POSIX-style path helpers for the in-memory VFS (always `/`-separated). */

export function normalizePosixPath(path: string): string {
  const abs = path.startsWith('/');
  const parts: string[] = [];
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  if (abs) return parts.length ? `/${parts.join('/')}` : '/';
  return parts.join('/') || '.';
}

export function isPathInsideRoot(root: string, path: string): boolean {
  const r = normalizePosixPath(root.startsWith('/') ? root : `/${root}`).replace(/\/+$/, '') || '/';
  const p = normalizePosixPath(path.startsWith('/') ? path : `/${path}`);
  if (r === '/') return p.startsWith('/');
  return p === r || p.startsWith(`${r}/`);
}

/**
 * Resolve `rel` as a path *under* `root`.
 * A leading `/` on `rel` means “from this folder” (HTTP/zip), not VFS `/`.
 */
export function resolveUnderRoot(root: string, rel: string): string {
  const r = normalizePosixPath(root.startsWith('/') ? root : `/${root}`).replace(/\/+$/, '') || '/';
  const stripped = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  const candidate = normalizePosixPath(`${r === '/' ? '' : r}/${stripped}`);
  if (!isPathInsideRoot(r, candidate)) {
    throw new Error(`EACCES: path escapes ${r}: ${rel}`);
  }
  return candidate;
}

/** Strip zip/tar junk and reject names that normalize above the archive root. */
export function sanitizeArchiveName(name: string): string | null {
  let n = name.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!n || n.endsWith('/')) return null;
  if (n.startsWith('__MACOSX/') || n.includes('/__MACOSX/') || /(^|\/)\.DS_Store$/.test(n)) return null;
  n = n.replace(/^\/+/, '');
  if (!n || n.includes('\0')) return null;
  try {
    const abs = resolveUnderRoot('/__bn_archive', n);
    const rel = abs.slice('/__bn_archive'.length).replace(/^\//, '');
    return rel || null;
  } catch {
    return null;
  }
}
