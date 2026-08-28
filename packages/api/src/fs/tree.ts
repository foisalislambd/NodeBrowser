export function flattenTree(
  tree: Record<string, { file?: { contents: string | Uint8Array }; directory?: Record<string, unknown> }>,
  prefix = '',
): { files: Record<string, string | Uint8Array>; dirs: string[] } {
  const files: Record<string, string | Uint8Array> = {};
  const dirs: string[] = [];

  const walk = (node: typeof tree, pathPrefix: string) => {
    for (const [name, child] of Object.entries(node)) {
      const p = pathPrefix ? `${pathPrefix}/${name}` : `/${name}`;
      if (child.file) {
        const c = child.file.contents;
        files[p] = typeof c === 'string' ? c : c.slice();
      } else if (child.directory) {
        const entries = Object.keys(child.directory);
        if (entries.length === 0) dirs.push(p);
        else walk(child.directory as typeof tree, p);
      }
    }
  };

  walk(tree, prefix);
  return { files, dirs };
}
