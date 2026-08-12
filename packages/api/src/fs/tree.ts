export function flattenTree(
  tree: Record<string, { file?: { contents: string | Uint8Array }; directory?: Record<string, unknown> }>,
  prefix = '',
): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = {};

  const walk = (node: typeof tree, pathPrefix: string) => {
    for (const [name, child] of Object.entries(node)) {
      const p = pathPrefix ? `${pathPrefix}/${name}` : `/${name}`;
      if (child.file) {
        const c = child.file.contents;
        out[p] = typeof c === 'string' ? c : c.slice();
      } else if (child.directory) {
        walk(child.directory as typeof tree, p);
      }
    }
  };

  walk(tree, prefix);
  return out;
}
