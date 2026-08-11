import { cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'dist');
mkdirSync(out, { recursive: true });

// Prefer esbuild if available; otherwise plain copy + import maps
async function main() {
  // Zero-dep vanilla demo (imports @browsernode/api from served /packages/api/dist)
  writeFileSync(join(out, 'main.js'), readFileSync(join(root, 'src/main.vanilla.js'), 'utf8'));

  cpSync(join(root, 'index.html'), join(out, 'index.html'));
  cpSync(join(root, 'styles.css'), join(out, 'styles.css'));
  cpSync(join(root, 'sw.js'), join(out, 'sw.js'));
  console.log('demo →', out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
