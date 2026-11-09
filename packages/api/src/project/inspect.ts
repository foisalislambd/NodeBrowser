import type { ToolkitFs } from '../fs/toolkit.js';
import { globFiles } from '../fs/toolkit.js';

export type ProjectInfo = {
  cwd: string;
  name: string | null;
  version: string | null;
  private: boolean;
  type: string | null;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  workspaces: string[];
  lockfile: 'npm' | 'yarn' | 'pnpm' | null;
  bins: string[];
};

type Manifest = {
  name?: string;
  version?: string;
  private?: boolean;
  type?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  bin?: string | Record<string, string>;
};

async function readJson(fs: ToolkitFs, path: string): Promise<Manifest | null> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

function workspacePatterns(pkg: Manifest | null): string[] {
  if (!pkg?.workspaces) return [];
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
  return pkg.workspaces.packages || [];
}

export async function inspectProject(fs: ToolkitFs, cwd: string): Promise<ProjectInfo> {
  const root = cwd.replace(/\/+$/, '') || '/';
  const pkg = await readJson(fs, root === '/' ? '/package.json' : `${root}/package.json`);
  let lockfile: ProjectInfo['lockfile'] = null;
  const exists = async (name: string) => {
    try {
      return await fs.exists(root === '/' ? `/${name}` : `${root}/${name}`);
    } catch {
      return false;
    }
  };
  if (await exists('pnpm-lock.yaml')) lockfile = 'pnpm';
  else if (await exists('yarn.lock')) lockfile = 'yarn';
  else if (await exists('package-lock.json')) lockfile = 'npm';
  const bins: string[] = [];
  if (typeof pkg?.bin === 'string') bins.push(pkg.bin);
  else if (pkg?.bin) bins.push(...Object.keys(pkg.bin));
  return {
    cwd: root,
    name: pkg?.name ?? null,
    version: pkg?.version ?? null,
    private: !!pkg?.private,
    type: pkg?.type ?? null,
    scripts: pkg?.scripts || {},
    dependencies: pkg?.dependencies || {},
    devDependencies: pkg?.devDependencies || {},
    workspaces: workspacePatterns(pkg),
    lockfile,
    bins,
  };
}

/** Expand `workspaces` globs to directories that contain a package.json. */
export async function workspaceDirs(fs: ToolkitFs, cwd: string): Promise<string[]> {
  const info = await inspectProject(fs, cwd);
  const root = info.cwd;
  const out: string[] = [];
  for (const pattern of info.workspaces) {
    const matches = await globFiles(fs, pattern.replace(/\/?$/, '/package.json'), root);
    for (const file of matches) {
      const dir = file.slice(0, file.lastIndexOf('/')) || '/';
      if (dir !== root) out.push(dir);
    }
    if (!pattern.includes('*')) {
      const dir = (root === '/' ? '' : root) + '/' + pattern.replace(/\/+$/, '');
      try {
        if (await fs.exists(`${dir}/package.json`)) out.push(dir.replace(/\/+/g, '/'));
      } catch {
        /* */
      }
    }
  }
  return [...new Set(out)];
}
