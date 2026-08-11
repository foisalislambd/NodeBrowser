export function flattenTree(
  tree: Record<string, { file?: { contents: string | Uint8Array }; directory?: Record<string, unknown> }>,
  prefix = '',
): Record<string, string> {
  const out: Record<string, string> = {};

  const walk = (node: typeof tree, pathPrefix: string) => {
    for (const [name, child] of Object.entries(node)) {
      const p = pathPrefix ? `${pathPrefix}/${name}` : `/${name}`;
      if (child.file) {
        const c = child.file.contents;
        out[p] = typeof c === 'string' ? c : new TextDecoder().decode(c);
      } else if (child.directory) {
        walk(child.directory as typeof tree, p);
      }
    }
  };

  walk(tree, prefix);
  return out;
}
