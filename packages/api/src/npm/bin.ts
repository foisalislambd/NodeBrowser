/** Link package.json "bin" entries into node_modules/.bin (Phase 23). */

/** Parse package.json bin field into name → relative path map. */
export function parseBinField(
  pkgName: string,
  bin: unknown,
): Record<string, string> {
  if (!bin) return {};
  if (typeof bin === 'string') {
    const base = pkgName.includes('/') ? pkgName.slice(pkgName.lastIndexOf('/') + 1) : pkgName;
    return { [base]: bin };
  }
  if (typeof bin === 'object') {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(bin as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
  return {};
}

/** Build a POSIX shell shim that execs node on the target script. */
export function makeBinShim(relToBin: string): string {
  // relToBin is relative from .bin/ to the script, e.g. ../ms/cli.js
  return [
    '#!/usr/bin/env node',
    `require(${JSON.stringify(relToBin)});`,
    '',
  ].join('\n');
}

/** Relative path from node_modules/.bin/<name> to node_modules/<pkg>/<file>. */
export function binRelTarget(pkgName: string, file: string): string {
  const clean = file.replace(/^\.\//, '');
  return `../${pkgName}/${clean}`;
}
