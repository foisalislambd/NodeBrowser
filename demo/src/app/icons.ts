/** VS Code-style file / language helpers. */

export function langFromPath(path: string): string {
  const n = String(path).toLowerCase();
  if (/\.tsx$/i.test(n)) return 'TypeScript React';
  if (/\.ts$/i.test(n)) return 'TypeScript';
  if (/\.jsx$/i.test(n)) return 'JavaScript React';
  if (/\.mjs$|\.cjs$|\.js$/i.test(n)) return 'JavaScript';
  if (/\.json$/i.test(n)) return 'JSON';
  if (/\.css$/i.test(n)) return 'CSS';
  if (/\.html?$/i.test(n)) return 'HTML';
  if (/\.md$/i.test(n)) return 'Markdown';
  if (/\.sh$/i.test(n)) return 'Shell';
  return 'Plain Text';
}

export function tabBadge(path: string): { text: string; cls: string } {
  const n = String(path).toLowerCase();
  if (/\.tsx?$/i.test(n)) return { text: 'TS', cls: 'ts' };
  if (/\.jsx?$|\.mjs$|\.cjs$/i.test(n)) return { text: 'JS', cls: 'js' };
  if (/\.json$/i.test(n)) return { text: '{}', cls: 'json' };
  if (/\.css$/i.test(n)) return { text: '#', cls: 'css' };
  if (/\.html?$/i.test(n)) return { text: '<>', cls: 'html' };
  if (/\.md$/i.test(n)) return { text: 'MD', cls: 'md' };
  return { text: '·', cls: 'plain' };
}

const FILE_COLOR: Record<string, string> = {
  js: '#f1e05a',
  mjs: '#f1e05a',
  cjs: '#f1e05a',
  jsx: '#f1e05a',
  ts: '#3178c6',
  tsx: '#3178c6',
  json: '#cbcb41',
  css: '#c586c0',
  html: '#e34c26',
  htm: '#e34c26',
  md: '#519aba',
  svg: '#ffb13b',
  wasm: '#654ff0',
};

export function fileIconEl(name: string, isDir: boolean, expanded?: boolean): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = 'tree-icon' + (isDir ? ' dir' : ' file');
  if (isDir) {
    wrap.classList.toggle('open', !!expanded);
    return wrap;
  }
  const ext = String(name).includes('.') ? String(name).split('.').pop()?.toLowerCase() || '' : '';
  wrap.style.color = FILE_COLOR[ext] || '#8b8b8b';
  wrap.dataset.ext = ext || 'none';
  return wrap;
}
