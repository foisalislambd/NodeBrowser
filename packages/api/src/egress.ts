/** Host-only network policy. Guest JS cannot fetch the public internet. */

const DEFAULT_NPM_HOSTS = new Set([
  'registry.npmjs.org',
  'registry.npmjs.com',
]);

export type EgressOptions = {
  extraHosts?: string[];
};

export function assertAllowedFetchUrl(url: string, opts?: EgressOptions): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`egress: invalid URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`egress: https only (${parsed.protocol})`);
  }
  const allow = new Set(DEFAULT_NPM_HOSTS);
  for (const h of opts?.extraHosts ?? []) allow.add(h);
  if (!allow.has(parsed.hostname)) {
    throw new Error(`egress blocked: ${parsed.hostname}`);
  }
  return parsed;
}
