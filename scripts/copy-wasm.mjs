import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'build-wasm', 'kernel');
const dest = join(root, 'packages', 'api', 'wasm');
mkdirSync(dest, { recursive: true });

for (const f of ['browsernode_kernel.js', 'browsernode_kernel.wasm']) {
  const src = join(srcDir, f);
  if (existsSync(src)) {
    copyFileSync(src, join(dest, f));
    console.log('copied', f);
  } else {
    console.warn('skip missing', src);
  }
}
