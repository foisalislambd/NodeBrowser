/** Phase 26 — detect yarn/pnpm lockfiles. Execution stays npm + kernel spawn. */

export type ForeignLock = 'yarn' | 'pnpm';

export async function detectForeignLockfile(
  fs: { readFile: (path: string, enc: 'utf8') => Promise<string> },
  cwd: string,
): Promise<ForeignLock | null> {
  const join = (...p: string[]) => p.join('/').replace(/\/+/g, '/');
  try {
    await fs.readFile(join(cwd, 'pnpm-lock.yaml'), 'utf8');
    return 'pnpm';
  } catch {
    /* continue */
  }
  try {
    await fs.readFile(join(cwd, 'yarn.lock'), 'utf8');
    return 'yarn';
  } catch {
    /* continue */
  }
  return null;
}
