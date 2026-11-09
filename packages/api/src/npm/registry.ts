/**
 * Host npm registry settings. Guest JavaScript still cannot fetch the internet.
 * Tokens stay in memory for this page and are sent only to the configured registry host.
 */

export type ScopeRegistry = {
  registry: string;
  token?: string;
};

export type NpmRegistryConfig = {
  registry: string;
  token?: string;
  extraHosts: string[];
  scopes: Record<string, ScopeRegistry>;
};

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

let config: NpmRegistryConfig = {
  registry: DEFAULT_REGISTRY,
  extraHosts: [],
  scopes: {},
};

export function npmConfig(): NpmRegistryConfig {
  return {
    registry: config.registry,
    token: config.token,
    extraHosts: [...config.extraHosts],
    scopes: { ...config.scopes },
  };
}

export function resetNpmConfig(): void {
  config = { registry: DEFAULT_REGISTRY, extraHosts: [], scopes: {} };
}

export function configureNpm(opts: {
  registry?: string;
  token?: string;
  extraHosts?: string[];
  scopes?: Record<string, ScopeRegistry>;
}): NpmRegistryConfig {
  if (opts.registry) config.registry = opts.registry.replace(/\/+$/, '');
  if (opts.token !== undefined) config.token = opts.token || undefined;
  if (opts.extraHosts) config.extraHosts = opts.extraHosts.filter(Boolean);
  if (opts.scopes) config.scopes = { ...opts.scopes };
  return npmConfig();
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Hosts the installer may contact in addition to the public npm registry. */
export function npmEgressHosts(): string[] {
  const hosts = new Set<string>(config.extraHosts);
  const main = hostnameOf(config.registry);
  if (main) hosts.add(main);
  for (const scope of Object.values(config.scopes)) {
    const host = hostnameOf(scope.registry);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

function tokenForHost(host: string): string | undefined {
  const main = hostnameOf(config.registry);
  if (config.token && main === host) return config.token;
  for (const scope of Object.values(config.scopes)) {
    if (scope.token && hostnameOf(scope.registry) === host) return scope.token;
  }
  return undefined;
}

export function registryUrlFor(name: string): string {
  let base = config.registry;
  if (name.startsWith('@')) {
    const scope = name.slice(0, name.indexOf('/'));
    const scoped = config.scopes[scope];
    if (scoped?.registry) base = scoped.registry.replace(/\/+$/, '');
  }
  base = base.replace(/\/+$/, '');
  if (name.startsWith('@')) {
    const [scope, pkg] = name.split('/');
    return `${base}/${scope}%2F${pkg}`;
  }
  return `${base}/${encodeURIComponent(name)}`;
}

export function npmFetchHeaders(url: string, accept = 'application/json'): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept };
  const host = hostnameOf(url);
  const token = host ? tokenForHost(host) : undefined;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Parse a project `.npmrc` (registry, scope registry, `_authToken`). */
export function parseNpmrc(text: string): {
  registry?: string;
  token?: string;
  scopes: Record<string, ScopeRegistry>;
} {
  const scopes: Record<string, ScopeRegistry> = {};
  const tokensByHost = new Map<string, string>();
  let registry: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'registry' && value.startsWith('https://')) {
      registry = value.replace(/\/+$/, '');
      continue;
    }
    const scopeReg = key.match(/^(@[^:]+):registry$/);
    if (scopeReg && value.startsWith('https://')) {
      const scope = scopeReg[1]!;
      scopes[scope] = { ...(scopes[scope] || { registry: value }), registry: value.replace(/\/+$/, '') };
      continue;
    }
    const auth = key.match(/^\/\/([^/]+)\/:_authToken$/);
    if (auth && value) tokensByHost.set(auth[1]!, value);
  }
  const apply = (url: string | undefined, scope?: string) => {
    if (!url) return;
    const host = hostnameOf(url);
    const token = host ? tokensByHost.get(host) : undefined;
    if (!token) return;
    if (scope) scopes[scope] = { registry: url, token };
    else if (registry && hostnameOf(registry) === host) {
      /* assigned below */
    }
  };
  let token: string | undefined;
  if (registry) {
    const host = hostnameOf(registry);
    if (host && tokensByHost.has(host)) token = tokensByHost.get(host);
  }
  for (const [scope, entry] of Object.entries(scopes)) apply(entry.registry, scope);
  return { registry, token, scopes };
}

export function applyNpmrc(text: string): NpmRegistryConfig {
  const parsed = parseNpmrc(text);
  return configureNpm({
    registry: parsed.registry,
    token: parsed.token,
    scopes: Object.keys(parsed.scopes).length ? parsed.scopes : undefined,
  });
}
