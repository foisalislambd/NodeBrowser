/** Detect yarn/pnpm lockfiles and read resolved versions. Install stays npm. */

export type ForeignLock = 'yarn' | 'pnpm';

type PinFs = {
  readFile(path: string, enc: 'utf8'): Promise<string>;
};

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

function joinLock(cwd: string, name: string): string {
  return (cwd.replace(/\/+$/, '') || '') + '/' + name;
}

function pinDepth(key: string): number {
  return key.split('node_modules/').length - 1;
}

function consider(map: Map<string, { version: string; depth: number }>, name: string, version: string, depth: number) {
  if (!name || !/^\d+\.\d+\.\d+/.test(version)) return;
  const cur = map.get(name);
  if (!cur || depth < cur.depth) map.set(name, { version, depth });
}

function parseNpmLock(text: string, map: Map<string, { version: string; depth: number }>) {
  let json: {
    packages?: Record<string, { version?: string }>;
    dependencies?: Record<string, { version?: string; dependencies?: Record<string, { version?: string }> }>;
  };
  try {
    json = JSON.parse(text);
  } catch {
    return;
  }
  for (const [key, info] of Object.entries(json.packages || {})) {
    if (!key || key === '') continue;
    const version = info?.version;
    if (!version) continue;
    const parts = key.split('node_modules/').filter(Boolean);
    const name = parts[parts.length - 1]?.replace(/\/$/, '');
    if (!name) continue;
    consider(map, name, version, pinDepth(key));
  }
  const walkDeps = (deps: Record<string, { version?: string; dependencies?: Record<string, { version?: string }> }> | undefined, depth: number) => {
    for (const [name, info] of Object.entries(deps || {})) {
      if (info.version) consider(map, name, info.version, depth);
      walkDeps(info.dependencies, depth + 1);
    }
  };
  walkDeps(json.dependencies, 1);
}

function selectorName(selector: string): string | null {
  const s = selector.trim().replace(/^"|"$/g, '');
  if (!s || s.startsWith('__')) return null;
  if (s.startsWith('@')) {
    const slash = s.indexOf('/');
    if (slash < 1) return null;
    const at = s.indexOf('@', slash + 1);
    return at === -1 ? s : s.slice(0, at);
  }
  const at = s.indexOf('@');
  return at === -1 ? null : s.slice(0, at);
}

function parseYarnLock(text: string, map: Map<string, { version: string; depth: number }>) {
  let names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const ver = line.match(/^\s+version\s+"([^"]+)"/);
    if (ver) {
      for (const name of names) consider(map, name, ver[1]!, map.has(name) ? 9 : 1);
      names = [];
      continue;
    }
    if (!line.startsWith(' ') && line.trim().endsWith(':')) {
      names = [];
      const body = line.trim().replace(/:$/, '');
      for (const part of body.split(',')) {
        const name = selectorName(part);
        if (name) names.push(name);
      }
    }
  }
}

function parsePnpmLock(text: string, map: Map<string, { version: string; depth: number }>) {
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^[A-Za-z]/.test(line)) inPackages = false;
    if (!inPackages) continue;
    const m = line.match(/^\s+\/?((?:@[^/\s'"]+\/)?[^@\s'"]+)@(\d+\.\d+\.\d+)/);
    if (m) consider(map, m[1]!, m[2]!, map.has(m[1]!) ? 9 : 1);
  }
}

/** Exact versions from package-lock (preferred), else yarn.lock, else pnpm-lock. */
export async function readResolvedPins(fs: PinFs, cwd: string): Promise<Map<string, string>> {
  const map = new Map<string, { version: string; depth: number }>();
  const read = async (name: string) => {
    try {
      return await fs.readFile(joinLock(cwd, name).replace(/\/+/g, '/'), 'utf8');
    } catch {
      return null;
    }
  };
  const npm = await read('package-lock.json');
  if (npm) parseNpmLock(npm, map);
  else {
    const yarn = await read('yarn.lock');
    if (yarn) parseYarnLock(yarn, map);
    else {
      const pnpm = await read('pnpm-lock.yaml');
      if (pnpm) parsePnpmLock(pnpm, map);
    }
  }
  const out = new Map<string, string>();
  for (const [name, info] of map) out.set(name, info.version);
  return out;
}
