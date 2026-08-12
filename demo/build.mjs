import {
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const demoRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(demoRoot, '..');
const out = join(demoRoot, 'dist');

/** Normalize to `/` or `/RepoName/` */
function normalizeBase(raw) {
  if (!raw || raw === '/') return '/';
  let b = String(raw).trim();
  if (!b.startsWith('/')) b = `/${b}`;
  if (!b.endsWith('/')) b += '/';
  return b;
}

const BASE_PATH = normalizeBase(process.env.BASE_PATH || '/');

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

function copyDir(src, dest) {
  if (!existsSync(src)) throw new Error(`Missing required path: ${src}`);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

function buildTemplates() {
  const templatesRoot = join(demoRoot, 'templates');
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

function buildIndexHtml() {
  let html = readFileSync(join(demoRoot, 'index.html'), 'utf8');
  const baseTag = BASE_PATH === '/' ? '' : `    <base href="${BASE_PATH}" />\n`;
  if (baseTag) {
    html = html.replace('<head>\n', `<head>\n${baseTag}`);
    if (!html.includes('<base ')) {
      html = html.replace('<head>', `<head>\n${baseTag.trimEnd()}`);
    }
  }
  // Relative import map so <base href> / Pages project sites resolve correctly
  html = html.replace(
    /"esbuild-wasm":\s*"[^"]+"/,
    '"esbuild-wasm": "./node_modules/esbuild-wasm/esm/browser.js"',
  );
  html = html.replace(
    /"@xterm\/xterm":\s*"[^"]+"/,
    '"@xterm/xterm": "./node_modules/@xterm/xterm/lib/xterm.js"',
  );
  html = html.replace(
    /"@xterm\/addon-fit":\s*"[^"]+"/,
    '"@xterm/addon-fit": "./node_modules/@xterm/addon-fit/lib/addon-fit.js"',
  );
  writeFileSync(join(out, 'index.html'), html);
}

async function main() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  writeFileSync(join(out, 'main.js'), readFileSync(join(demoRoot, 'src/app/main.js'), 'utf8'));
  writeFileSync(join(out, 'apps.js'), readFileSync(join(demoRoot, 'src/app/apps.js'), 'utf8'));
  writeFileSync(join(out, 'term.js'), readFileSync(join(demoRoot, 'src/app/term.js'), 'utf8'));
  writeFileSync(join(out, 'icons.js'), readFileSync(join(demoRoot, 'src/app/icons.js'), 'utf8'));
  writeFileSync(join(out, 'sw.js'), readFileSync(join(demoRoot, 'sw.js'), 'utf8'));
  cpSync(join(demoRoot, 'styles.css'), join(out, 'styles.css'));
  writeFileSync(join(out, '.nojekyll'), '');
  writeFileSync(
    join(out, 'base.json'),
    JSON.stringify({ basePath: BASE_PATH, builtAt: new Date().toISOString() }, null, 2),
  );
  buildIndexHtml();
  buildTemplates();

  // Self-contained API + WASM (no monorepo server required)
  const apiPkg = join(repoRoot, 'packages/api');
  copyDir(join(apiPkg, 'dist'), join(out, 'packages/api/dist'));
  copyDir(join(apiPkg, 'wasm'), join(out, 'packages/api/wasm'));

  // esbuild-wasm for in-browser bundle
  const esbuildSrc = [
    join(repoRoot, 'node_modules/esbuild-wasm'),
    join(demoRoot, 'node_modules/esbuild-wasm'),
  ].find((p) => existsSync(p));
  if (!esbuildSrc) throw new Error('esbuild-wasm not found — run npm install at repo root');
  copyDir(esbuildSrc, join(out, 'node_modules/esbuild-wasm'));

  const xtermSrc = [
    join(repoRoot, 'node_modules/@xterm/xterm'),
    join(demoRoot, 'node_modules/@xterm/xterm'),
  ].find((p) => existsSync(p));
  if (xtermSrc) copyDir(xtermSrc, join(out, 'node_modules/@xterm/xterm'));
  const fitSrc = [
    join(repoRoot, 'node_modules/@xterm/addon-fit'),
    join(demoRoot, 'node_modules/@xterm/addon-fit'),
  ].find((p) => existsSync(p));
  if (fitSrc) copyDir(fitSrc, join(out, 'node_modules/@xterm/addon-fit'));

  console.log(`demo → ${out} (BASE_PATH=${BASE_PATH})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
