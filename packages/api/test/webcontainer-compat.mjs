/**
 * Public WebContainer tutorial surface against the WASM kernel.
 * The snippets follow published @webcontainer/api shapes (boot, mount, spawn,
 * fs, events, export, teardown). They do not import StackBlitz code.
 */
import { NodeBrowser, WebContainer, configureAPIKey, auth, previewMessageFromData, PreviewMessageType } from '../dist/index.js';
import { isZip } from '../dist/fs/zip.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

async function readText(proc) {
  let out = '';
  const reader = proc.output.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += value ?? '';
  }
  return { out, code: await proc.exit };
}

async function main() {
  const files = {
    'index.js': {
      file: {
        contents: "console.log('Welcome to a WebContainers app!');\n",
      },
    },
    'package.json': {
      file: {
        contents: JSON.stringify({
          name: 'example-app',
          scripts: { start: 'node index.js' },
        }),
      },
    },
    src: { directory: {} },
  };

  const webcontainerInstance = await WebContainer.boot({ useWasm: true });
  assert(webcontainerInstance.workdir === '/home/project', webcontainerInstance.workdir);
  assert(webcontainerInstance.path.endsWith('/node_modules/.bin'), webcontainerInstance.path);
  let already = false;
  try {
    await WebContainer.boot({ useWasm: true });
  } catch (error) {
    already = String(error).includes('already booted');
  }
  assert(already, 'second boot should fail');

  await webcontainerInstance.mount(files);
  assert((await webcontainerInstance.fs.readFile('index.js', 'utf-8')).includes('Welcome'), 'utf-8 read');
  const raw = await webcontainerInstance.fs.readFile('index.js');
  assert(raw instanceof Uint8Array && raw[0] === 99, 'default readFile is bytes');

  await webcontainerInstance.fs.writeFile('src/note.txt', 'alpha');
  const created = await webcontainerInstance.fs.mkdir('src/nested/deep', { recursive: true });
  assert(created && created.endsWith('/src/nested'), 'mkdir first path ' + created);
  const listed = await webcontainerInstance.fs.readdir('src', { withFileTypes: true });
  const note = listed.find((entry) => entry.name === 'note.txt');
  assert(note && note.isFile() && !note.isDirectory(), 'dirent');

  let watched = [];
  const watcher = webcontainerInstance.fs.watch('src', { recursive: true }, (event, name) => {
    watched.push([event, name]);
  });
  await webcontainerInstance.fs.writeFile('src/note.txt', 'beta');
  await new Promise((resolve) => setTimeout(resolve, 40));
  watcher.close();
  const before = watched.length;
  await webcontainerInstance.fs.writeFile('src/note.txt', 'gamma');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert(before >= 1, 'watch ' + JSON.stringify(watched));
  assert(watched.length === before, 'watch close');

  await webcontainerInstance.fs.rename('src/note.txt', 'src/renamed.txt');
  assert((await webcontainerInstance.fs.readFile('src/renamed.txt', 'utf8')) === 'gamma');
  await webcontainerInstance.fs.rm('missing.txt', { force: true });
  let missing = false;
  try {
    await webcontainerInstance.fs.rm('missing.txt');
  } catch (error) {
    missing = String(error).includes('ENOENT');
  }
  assert(missing, 'rm without force');

  let errors = 0;
  const stopErrors = webcontainerInstance.on('error', (error) => {
    errors += 1;
    assert(typeof error.message === 'string' && error.message.includes('ENOENT'), error.message);
  });
  await webcontainerInstance.fs.readFile('no-such.txt').catch(() => {});
  assert(errors === 1, 'error event ' + errors);
  stopErrors();
  await webcontainerInstance.fs.readFile('no-such.txt').catch(() => {});
  assert(errors === 1, 'unsubscribe');

  const tree = await webcontainerInstance.export('src', { format: 'json' });
  assert(tree['renamed.txt'].file.contents === 'gamma', JSON.stringify(tree));
  const excluded = await webcontainerInstance.export('src', { format: 'json', excludes: ['renamed.txt'] });
  assert(!excluded['renamed.txt'], 'exclude');
  const broughtBack = await webcontainerInstance.export('src', {
    format: 'json',
    excludes: ['*.txt'],
    includes: ['renamed.txt'],
  });
  assert(broughtBack['renamed.txt'].file.contents === 'gamma', 'include overrides exclude');

  const zip = await webcontainerInstance.export('.', { format: 'zip' });
  const binary = await webcontainerInstance.export('.', { format: 'binary' });
  assert(zip instanceof Uint8Array && isZip(zip), 'zip export');
  assert(isZip(binary), 'binary export is a zip this runtime can mount');
  await webcontainerInstance.mount(zip, { mountPoint: 'restored' });
  assert((await webcontainerInstance.fs.readFile('restored/index.js', 'utf8')).includes('Welcome'), 'mount zip');

  try {
    await webcontainerInstance.mount({
      'link.txt': { file: { symlink: 'index.js' } },
    });
    const via = await webcontainerInstance.fs.readFile('link.txt', 'utf8');
    assert(via.includes('Welcome'), 'symlink mount ' + via);
  } catch (error) {
    assert(String(error).includes('ENOTSUP'), 'symlink ' + error);
  }

  const installLogs = [];
  const installProcess = await webcontainerInstance.spawn('npm', ['install']);
  installProcess.output.pipeTo(
    new WritableStream({
      write(data) {
        installLogs.push(data);
      },
    }),
  );
  const installCode = await installProcess.exit;
  assert(installCode === 0, 'npm install ' + installLogs.join(''));

  const startProcess = await webcontainerInstance.spawn('npm', ['run', 'start']);
  const started = await readText(startProcess);
  assert(started.code === 0, 'npm run ' + started.out);
  assert(started.out.includes('Welcome to a WebContainers app!'), started.out);

  const direct = await webcontainerInstance.spawn('node', ['index.js']);
  const directOut = await readText(direct);
  assert(directOut.code === 0 && directOut.out.includes('Welcome'), directOut.out);

  const writer = direct.input.getWriter();
  await writer.write('ignored');
  await writer.close();

  await webcontainerInstance.fs.writeFile('loud.js', 'console.log("secret-line")\n');
  const quiet = await webcontainerInstance.spawn('node', ['loud.js'], { output: false, terminal: { cols: 100, rows: 40 } });
  quiet.resize({ cols: 120, rows: 50 });
  let quietChunks = '';
  const quietReader = quiet.output.getReader();
  while (true) {
    const { value, done } = await quietReader.read();
    if (done) break;
    quietChunks += value ?? '';
  }
  assert((await quiet.exit) === 0, 'quiet exit');
  assert(quietChunks === '', 'output:false still produced ' + quietChunks);

  let opened = '';
  webcontainerInstance.on('xdg-open', (text) => {
    opened = text;
  });
  const openProc = await webcontainerInstance.spawn('xdg-open', ['https://example.com/docs']);
  assert((await openProc.exit) === 0 && opened === 'https://example.com/docs', opened);

  let codeEvent = null;
  webcontainerInstance.on('code', (type, event) => {
    codeEvent = { type, event };
  });
  const codeProc = await webcontainerInstance.spawn('code', ['--diff', 'a.js:3:1', 'b.js']);
  assert((await codeProc.exit) === 0 && codeEvent.type === 'diff', JSON.stringify(codeEvent));
  assert(codeEvent.event.files[0].line === 3 && codeEvent.event.files[0].column === 1, JSON.stringify(codeEvent));

  const ports = [];
  const stopReady = webcontainerInstance.on('server-ready', (port, url) => ports.push(['ready', port, url]));
  const stopPort = webcontainerInstance.on('port', (port, type, url) => ports.push(['port', port, type, url]));
  webcontainerInstance.instance.serveStatic(3111, webcontainerInstance.workdir);
  assert(ports.some((row) => row[0] === 'ready' && row[1] === 3111), JSON.stringify(ports));
  assert(ports.some((row) => row[2] === 'open'), JSON.stringify(ports));
  stopReady();
  webcontainerInstance.instance.closePort(3111);
  assert(ports.some((row) => row[2] === 'close'), JSON.stringify(ports));
  const readyCount = ports.filter((row) => row[0] === 'ready').length;
  webcontainerInstance.instance.serveStatic(3112, webcontainerInstance.workdir);
  assert(ports.filter((row) => row[0] === 'ready').length === readyCount, 'server-ready unsubscribe');
  stopPort();

  const message = previewMessageFromData({
    source: 'nodebrowser-preview',
    type: 'uncaught-exception',
    message: 'boom',
    stack: 'at x',
    pathname: '/app',
  });
  assert(message && message.type === PreviewMessageType.UncaughtException && message.message === 'boom', JSON.stringify(message));
  assert(previewMessageFromData({ type: 'uncaught-exception' }) == null, 'ignore foreign messages');

  await webcontainerInstance.fs.writeFile('hang.js', 'setInterval(function () { console.log("tick"); }, 20);\n');
  const hang = await webcontainerInstance.spawn('node', ['hang.js']);
  const hangReader = hang.output.getReader();
  let hangText = '';
  const startedAt = Date.now();
  while (!hangText.includes('tick')) {
    if (Date.now() - startedAt > 4000) throw new Error('timer did not tick: ' + hangText);
    const { value, done } = await hangReader.read();
    if (done) throw new Error('hang exited early: ' + hangText);
    hangText += value ?? '';
  }
  const hangExit = hang.exit;
  webcontainerInstance.teardown();
  const hangCode = await Promise.race([
    hangExit,
    new Promise((_, reject) => setTimeout(() => reject(new Error('teardown left the process hanging')), 2000)),
  ]);
  assert(hangCode === 137, 'teardown exit ' + hangCode);
  let usedAfter = false;
  try {
    await webcontainerInstance.fs.readFile('index.js', 'utf8');
  } catch (error) {
    usedAfter = String(error).includes('torn down');
  }
  assert(usedAfter, 'fs after teardown');

  const renamed = await WebContainer.boot({ useWasm: true, workdirName: 'demo', coep: 'none', forwardPreviewErrors: true });
  assert(renamed.workdir === '/home/demo', renamed.workdir);
  assert(renamed.coep === 'none' && renamed.sabStdio === false, 'reduced isolation');
  await renamed.fs.writeFile('index.html', '<!doctype html><html><head></head><body>hi</body></html>');
  await renamed.setPreviewScript('https://example.com/preview.js', { type: 'module', defer: true });
  renamed.instance.serveStatic(4020, renamed.workdir);
  const preview = await renamed.instance.handleHttp({ id: 'p', port: 4020, path: '/index.html' });
  assert(preview.body.includes('https://example.com/preview.js'), preview.body);
  assert(preview.body.includes('type="module"') && preview.body.includes('defer'), preview.body);
  assert(preview.body.includes('nodebrowser-preview') && preview.body.includes('uncaught-exception'), preview.body);
  renamed.teardown();

  configureAPIKey('local-only');
  const session = auth.init({ clientId: 'demo', scope: 'read' });
  assert(session.status === 'authorized', JSON.stringify(session));
  await auth.loggedIn();
  let loggedOut = false;
  const stopAuth = auth.on('logged-out', () => {
    loggedOut = true;
  });
  await auth.logout();
  assert(loggedOut, 'logout listener');
  stopAuth();

  const bn = await NodeBrowser.boot({ useWasm: true });
  assert(bn.guestEngine === 'quickjs', bn.guestEngine);
  assert(bn.capabilities().guestEngine === 'quickjs', 'capabilities engine');
  assert(bn.capabilities().features.includes('guest-engine'), 'engine feature');
  const proc = await bn.spawn('node', ['-e', 'setInterval(function(){}, 1000)'], { cwd: '/' });
  bn.teardown();
  const code = await Promise.race([
    proc.exit,
    new Promise((_, reject) => setTimeout(() => reject(new Error('kernel teardown left exit pending')), 2000)),
  ]);
  assert(code === 137, 'kernel exit ' + code);
  let torn = false;
  try {
    await bn.spawn('node', ['-e', 'console.log(1)']);
  } catch (error) {
    torn = String(error).includes('torn down');
  }
  assert(torn, 'spawn after teardown');

  const again = await NodeBrowser.boot({ useWasm: true });
  const hello = await readText(
    await again.spawn('node', ['-e', 'console.log("after-teardown")'], { cwd: '/' }),
  );
  assert(hello.code === 0 && hello.out.includes('after-teardown'), hello.out);
  again.teardown();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
