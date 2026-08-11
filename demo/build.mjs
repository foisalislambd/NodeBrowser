import {
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, 'dist');
mkdirSync(out, { recursive: true });

const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '.turbo', 'coverage']);

function walkFiles(dir, base = dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, base, files);
    else files.push(relative(base, p).split('\\').join('/'));
  }
  return files;
}

function copyFiltered(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (SKIP.has(name)) continue;
    const from = join(src, name);
    const to = join(dest, name);
    const st = statSync(from);
    if (st.isDirectory()) copyFiltered(from, to);
    else {
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
    }
  }
}

function buildTemplates() {
  const templatesRoot = join(root, 'templates');
  const outTemplates = join(out, 'templates');
  mkdirSync(outTemplates, { recursive: true });
  for (const name of readdirSync(templatesRoot)) {
    const src = join(templatesRoot, name);
    if (!statSync(src).isDirectory()) continue;
    copyFiltered(src, join(outTemplates, name));
    const files = walkFiles(src);
    writeFileSync(join(outTemplates, `${name}.files.json`), JSON.stringify(files, null, 2));
    console.log(`template ${name}: ${files.length} files → dist/templates/${name}`);
  }
}

async function main() {
  writeFileSync(join(out, 'main.js'), readFileSync(join(root, 'src/main.vanilla.js'), 'utf8'));
  writeFileSync(join(out, 'apps.js'), readFileSync(join(root, 'src/apps.js'), 'utf8'));
  cpSync(join(root, 'index.html'), join(out, 'index.html'));
  cpSync(join(root, 'styles.css'), join(out, 'styles.css'));
  cpSync(join(root, 'sw.js'), join(out, 'sw.js'));
  buildTemplates();
  console.log('demo →', out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
