import type { NodeBrowser } from './node-browser.js';
import { assertAllowedFetchUrl } from '../net/egress.js';

const SPEC =
  /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

export type ImportRepositoryOptions = {
  /** Branch, tag, or commit-ish. Default `main`. */
  ref?: string;
  /** `heads` for branches, `tags` for tags. Default `heads`. */
  kind?: 'heads' | 'tags';
  dest?: string;
};

export function parseGithubSpec(spec: string): { owner: string; repo: string } {
  const m = spec.trim().match(SPEC);
  if (!m) throw new Error('importRepository: expected owner/repo or https://github.com/owner/repo');
  return { owner: m[1]!, repo: m[2]! };
}

export function githubZipUrl(owner: string, repo: string, ref: string, kind: 'heads' | 'tags'): string {
  if (!/^(?!.*\.\.)[A-Za-z0-9_./-]{1,200}$/.test(ref)) {
    throw new Error('importRepository: ref has unsupported characters');
  }
  const refPath = ref.split('/').map(encodeURIComponent).join('/');
  return `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/refs/${kind}/${refPath}`;
}

/** Download a public GitHub zipball and unpack it into the VFS. */
export async function importRepository(
  bn: NodeBrowser,
  spec: string,
  opts?: ImportRepositoryOptions,
): Promise<{ dest: string; files: number; owner: string; repo: string; ref: string }> {
  const { owner, repo } = parseGithubSpec(spec);
  const ref = opts?.ref?.trim() || 'main';
  const kind = opts?.kind === 'tags' ? 'tags' : 'heads';
  const url = githubZipUrl(owner, repo, ref, kind);
  assertAllowedFetchUrl(url, { extraHosts: ['codeload.github.com'] });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`importRepository: ${res.status} ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const dest = opts?.dest || '/home/project';
  const unpacked = await bn.importZip(bytes, dest);
  return { ...unpacked, owner, repo, ref };
}
