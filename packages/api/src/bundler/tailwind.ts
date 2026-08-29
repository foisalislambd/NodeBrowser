import type { NodeBrowser } from '../host/node-browser.js';
import { normalizePosixPath } from '../fs/paths.js';
import { looksLikeTailwind, stripTailwindImport, TW_BROWSER_VFS } from './preview-assets.js';

const DEFAULT_CSS = '@import "tailwindcss";\n\n@theme {\n  --font-sans: ui-sans-serif, system-ui, sans-serif;\n}\n';

function vfsJoin(cwd: string, rel: string): string {
  if (rel.startsWith('/')) return normalizePosixPath(rel);
  const base = cwd.replace(/\/+$/, '') || '/';
  return normalizePosixPath(`${base}/${rel}`);
}

async function exists(bn: NodeBrowser, path: string): Promise<boolean> {
  try {
    return await bn.fs.exists(path);
  } catch {
    return false;
  }
}

async function readUtf8(bn: NodeBrowser, path: string): Promise<string | null> {
  try {
    return await bn.fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

const BROWSER_CANDIDATES = [
  'node_modules/@tailwindcss/browser/dist/index.global.js',
];

/** Prefer the npm-installed browser compiler over the demo vendor copy. */
export async function syncTailwindBrowser(bn: NodeBrowser, cwd: string): Promise<boolean> {
  for (const rel of BROWSER_CANDIDATES) {
    const src = vfsJoin(cwd, rel);
    const buf = await readUtf8(bn, src);
    if (!buf) continue;
    await bn.fs.mkdir('/usr/share/nodebrowser', { recursive: true });
    await bn.fs.writeFile(TW_BROWSER_VFS, buf);
    return true;
  }
  return !!(await readUtf8(bn, TW_BROWSER_VFS));
}

function parseCli(args: string[]): { input?: string; output?: string } {
  let input: string | undefined;
  let output: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if ((a === '-i' || a === '--input') && args[i + 1]) input = args[++i];
    else if ((a === '-o' || a === '--output') && args[i + 1]) output = args[++i];
  }
  return { input, output };
}

async function findDefaultInput(bn: NodeBrowser, cwd: string): Promise<string | null> {
  for (const rel of ['src/input.css', 'src/index.css', 'input.css', 'app.css', 'styles.css', 'src/style.css']) {
    const p = vfsJoin(cwd, rel);
    if (await exists(bn, p)) return p;
  }
  return null;
}

/**
 * In-tab Tailwind: same npm install + CLI shape as a PC.
 * Native lightningcss/@tailwindcss/oxide are skipped; @tailwindcss/browser
 * (already used by preview) compiles utilities in the Simple Browser.
 */
export async function compileTailwind(
  bn: NodeBrowser,
  cwd: string,
  args: string[] = [],
): Promise<{ input: string; output: string; engine: boolean }> {
  const cli = parseCli(args);
  let input = cli.input ? vfsJoin(cwd, cli.input) : await findDefaultInput(bn, cwd);
  if (!input || !(await exists(bn, input))) {
    input = input || vfsJoin(cwd, 'src/input.css');
    const dir = input.slice(0, input.lastIndexOf('/')) || cwd;
    await bn.fs.mkdir(dir, { recursive: true });
    await bn.fs.writeFile(input, DEFAULT_CSS);
  }
  const output = cli.output ? vfsJoin(cwd, cli.output) : vfsJoin(cwd, 'dist/output.css');

  const hadTw = await exists(bn, vfsJoin(cwd, 'node_modules/tailwindcss/package.json'));
  const hadBrowser = await exists(bn, vfsJoin(cwd, 'node_modules/@tailwindcss/browser/package.json'));
  const toInstall: string[] = [];
  if (!hadTw) toInstall.push('tailwindcss');
  if (!hadBrowser) toInstall.push('@tailwindcss/browser');
  if (toInstall.length) await bn.install(toInstall, cwd);

  const engine = await syncTailwindBrowser(bn, cwd);
  const raw = (await readUtf8(bn, input)) || DEFAULT_CSS;
  const slash = output.lastIndexOf('/');
  const outDir = slash > 0 ? output.slice(0, slash) : cwd;
  await bn.fs.mkdir(outDir, { recursive: true });
  const header =
    '/* NodeBrowser: Tailwind compiled in-tab (same npm packages as a PC).\n' +
    '   Native lightningcss is skipped; @tailwindcss/browser applies utilities in preview. */\n';
  await bn.fs.writeFile(output, header + (looksLikeTailwind(raw) ? stripTailwindImport(raw) : raw));
  return { input, output, engine };
}
