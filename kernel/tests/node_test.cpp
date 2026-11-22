#include "bn/node_runner.hpp"
#include "bn/process.hpp"

#include <chrono>
#include <iostream>
#include <optional>
#include <string>
#include <thread>

using namespace bn;

static int fails = 0;

#define CHECK(cond) do { \
  if (!(cond)) { \
    std::cerr << "FAIL: " << #cond << " at " << __FILE__ << ":" << __LINE__ << "\n"; \
    ++fails; \
  } \
} while (0)

int main() {
  Kernel k;
  register_node_command(k);

  k.vfs().write_text("/hello.js", "console.log('hello from node');");
  k.vfs().write_text("/math.js",
                     "const fs = require('fs');\n"
                     "fs.writeFileSync('/out.txt', String(2+2));\n"
                     "console.log(fs.readFileSync('/out.txt'));\n");

  {
    auto pid = k.spawn("echo", {"hi", "there"});
    auto code = k.wait(pid);
    CHECK(code.has_value());
    CHECK(*code == 0);
    auto proc = k.get(pid);
    CHECK(proc->stdout_buf.read_all_string() == "hi there\n");
  }

  {
    auto pid = k.spawn("cat", {"/hello.js"});
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto proc = k.get(pid);
    CHECK(proc->stdout_buf.read_all_string() == "console.log('hello from node');");
  }

  {
    auto pid = k.spawn("node", {"/hello.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value());
#if defined(BN_HAS_QUICKJS)
    CHECK(*code == 0);
    auto proc = k.get(pid);
    auto out = proc->stdout_buf.read_all_string();
    CHECK(out.find("hello from node") != std::string::npos);
#else
    // stub mode still exits 0 if file readable
    CHECK(*code == 0);
#endif
  }

  {
    auto pid = k.spawn("mkdir", {"-p", "/d/e"});
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    CHECK(k.vfs().exists("/d/e"));
  }
  {
    auto pid = k.spawn("sh", {"-c", "echo a && echo b"});
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto proc = k.get(pid);
    auto out = proc->stdout_buf.read_all_string();
    CHECK(out.find("a") != std::string::npos);
    CHECK(out.find("b") != std::string::npos);
  }
  {
    auto pid = k.spawn("sh", {"-c", "echo hi > /redir.txt"});
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto t = k.vfs().read_text("/redir.txt");
    CHECK(t.has_value() && t->find("hi") != std::string::npos);
  }
  {
    CHECK(k.vfs().mkdir("/g", true));
    CHECK(k.vfs().write_text("/g/a.txt", "1"));
    CHECK(k.vfs().write_text("/g/b.txt", "2"));
    auto pid = k.spawn("sh", {"-c", "echo *.txt"}, {}, "/g");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("a.txt") != std::string::npos);
    CHECK(out.find("b.txt") != std::string::npos);
    auto ls = k.spawn("sh", {"-c", "ls *.txt"}, {}, "/g");
    CHECK(k.wait(ls).value_or(1) == 0);
    auto lsout = k.get(ls)->stdout_buf.read_all_string();
    CHECK(lsout.find("a.txt") != std::string::npos);
    CHECK(lsout.find("b.txt") != std::string::npos);
  }
  {
    auto pid = k.spawn("test", {"-f", "/redir.txt"});
    CHECK(k.wait(pid).value_or(1) == 0);
    pid = k.spawn("test", {"-d", "/g"});
    CHECK(k.wait(pid).value_or(1) == 0);
    pid = k.spawn("test", {"-f", "/nope"});
    CHECK(k.wait(pid).value_or(0) == 1);
  }

#if defined(BN_HAS_QUICKJS)
  {
    auto pid = k.spawn("node", {"/math.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto outf = k.vfs().read_text("/out.txt");
    CHECK(outf.has_value() && *outf == "4");
  }

  // Directory package + node_modules resolution (regression)
  {
    k.vfs().write_text("/pkg/package.json", "{\"name\":\"p\",\"main\":\"index.js\"}");
    k.vfs().write_text("/pkg/index.js", "module.exports = { ok: true };");
    k.vfs().write_text("/use_pkg.js", "console.log(require('/pkg').ok);");
    auto pid = k.spawn("node", {"/use_pkg.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto proc = k.get(pid);
    CHECK(proc->stdout_buf.read_all_string().find("true") != std::string::npos);
  }
  {
    k.vfs().write_text("/home/project/node_modules/x/index.js", "module.exports = 7;");
    k.vfs().write_text("/home/project/app.js", "console.log(require('x'));");
    auto pid = k.spawn("node", {"/home/project/app.js"}, {}, "/home/project");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto proc = k.get(pid);
    CHECK(proc->stdout_buf.read_all_string().find("7") != std::string::npos);
  }
  {
    k.vfs().write_text("/exit.js", "process.exit(42);");
    auto pid = k.spawn("node", {"/exit.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 42);
  }
  // Guest modules in C++/QuickJS: zlib + symlink + streams + ESM
  {
    k.vfs().write_text(
        "/zlib.js",
        "const z=require('zlib');\n"
        "const b=Buffer.from('hello-cpp');\n"
        "const g=z.gzipSync(b);\n"
        "console.log(z.gunzipSync(g).toString());\n");
    auto pid = k.spawn("node", {"/zlib.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto proc = k.get(pid);
    CHECK(proc->stdout_buf.read_all_string().find("hello-cpp") != std::string::npos);
  }
  {
    CHECK(k.vfs().write_text("/target.txt", "T"));
    CHECK(k.vfs().symlink("/target.txt", "/alias.txt"));
    auto rl = k.vfs().readlink("/alias.txt");
    CHECK(rl.has_value() && *rl == "/target.txt");
    k.vfs().write_text(
        "/link.js",
        "const fs=require('fs');\n"
        "console.log(fs.readlinkSync('/alias.txt'));\n"
        "console.log(fs.readFileSync('/alias.txt'));\n"
        "console.log(fs.lstatSync('/alias.txt').isSymbolicLink());\n");
    auto pid = k.spawn("node", {"/link.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("/target.txt") != std::string::npos);
    CHECK(out.find("true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/stream.js",
        "const {Readable,Writable}=require('stream');\n"
        "const chunks=[];\n"
        "const r=new Readable({read:function(){}});\n"
        "const w=new Writable({write:function(c,_,cb){chunks.push(String(c));cb();}});\n"
        "w.on('finish',function(){console.log('pipe='+chunks.join(''));});\n"
        "r.pipe(w); r.push('hi'); r.push(null);\n");
    auto pid = k.spawn("node", {"/stream.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    CHECK(k.get(pid)->stdout_buf.read_all_string().find("pipe=hi") != std::string::npos);
  }
  {
    k.vfs().write_text("/mod.mjs", "export const n=42;\nexport default function(){return n;}\n");
    k.vfs().write_text(
        "/run.mjs",
        "import d,{n} from './mod.mjs';\n"
        "console.log('esm='+n+':'+d());\n");
    auto pid = k.spawn("node", {"/run.mjs"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    CHECK(k.get(pid)->stdout_buf.read_all_string().find("esm=42:42") != std::string::npos);
  }
  // Buffer/ArrayBuffer + crypto + binary write (QuickJS parity regressions)
  {
    k.vfs().write_file("/bin.dat", std::vector<uint8_t>{0, 1, 255}, true);
    k.vfs().write_text(
        "/buf.js",
        "const fs=require('fs');\n"
        "const crypto=require('crypto');\n"
        "const b=fs.readFileSync('/bin.dat','buffer');\n"
        "if(b.length!==3||b._data[0]!==0||b._data[2]!==255) throw new Error('read buffer');\n"
        "const rb=crypto.randomBytes(8);\n"
        "if(rb.length!==8) throw new Error('randomBytes');\n"
        "const buf=Buffer.alloc(4); crypto.randomFillSync(buf);\n"
        "const hex=crypto.createHash('sha256').update('abc').digest('hex');\n"
        "if(hex!=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') throw new Error('sha');\n"
        "const hk=crypto.createHmac('sha256','Jefe').update('what do ya want for nothing?').digest('hex');\n"
        "if(hk!=='5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843') throw new Error('hmac '+hk);\n"
        "if(!crypto.timingSafeEqual(Buffer.from('ab'), Buffer.from('ab'))) throw new Error('tse');\n"
        "const dig=crypto.createHash('sha256').update('abc').digest();\n"
        "if(dig.length!==32) throw new Error('digest buf');\n"
        "fs.writeFileSync('/out.bin', Buffer.from([9,8,7]));\n"
        "const o=fs.readFileSync('/out.bin','buffer');\n"
        "if(o.length!==3||o._data[0]!==9) throw new Error('write buffer');\n"
        "console.log('bufok');\n");
    auto pid = k.spawn("node", {"/buf.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    CHECK(k.get(pid)->stdout_buf.read_all_string().find("bufok") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/cp.js",
        "const fs=require('fs');\n"
        "const stream=require('stream');\n"
        "fs.mkdirSync('/cp/a/b',{recursive:true});\n"
        "fs.writeFileSync('/cp/a/b/f.txt','tree');\n"
        "fs.cpSync('/cp/a','/cp/out',{recursive:true});\n"
        "if(fs.readFileSync('/cp/out/b/f.txt')!=='tree') throw new Error('cp');\n"
        "var dirThrew=false;\n"
        "try{fs.cpSync('/cp/a','/cp/nope');}catch(e){dirThrew=e.code==='EISDIR';}\n"
        "if(!dirThrew) throw new Error('cp dir');\n"
        "fs.rmSync('/cp/out',{recursive:true});\n"
        "if(fs.existsSync('/cp/out')) throw new Error('rm');\n"
        "fs.rmSync('/cp/missing',{force:true});\n"
        "const chunks=[];\n"
        "const r=new stream.Readable({read(){}});\n"
        "const w=new stream.Writable({write(c,_,cb){chunks.push(String(c));cb();}});\n"
        "stream.pipeline(r,w,(err)=>{\n"
        "  if(err) throw err;\n"
        "  if(chunks.join('')!=='hi') throw new Error('pipeline '+chunks.join(''));\n"
        "  console.log('cpok');\n"
        "});\n"
        "r.push('hi'); r.push(null);\n");
    auto pid = k.spawn("node", {"/cp.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto cpOut = k.get(pid)->stdout_buf.read_all_string();
    CHECK(cpOut.find("cpok") != std::string::npos);
  }
  // Intermediate symlink must resolve for read/lstat of nested path
  {
    CHECK(k.vfs().mkdir("/realdir", true));
    CHECK(k.vfs().write_text("/realdir/nested.txt", "NEST"));
    CHECK(k.vfs().symlink("/realdir", "/via"));
    auto nested = k.vfs().read_text("/via/nested.txt");
    CHECK(nested.has_value() && *nested == "NEST");
    auto st = k.vfs().stat("/via/nested.txt", false);
    CHECK(st.has_value() && st->kind == NodeKind::File);
  }
  // Phase 15: chmod / utimes
  {
    CHECK(k.vfs().write_text("/mode.txt", "m"));
    CHECK(k.vfs().chmod("/mode.txt", 0755));
    auto st = k.vfs().stat("/mode.txt");
    CHECK(st.has_value() && (st->mode & 0777) == 0755);
    CHECK(k.vfs().utimes("/mode.txt", 1000, 2000));
    st = k.vfs().stat("/mode.txt");
    CHECK(st.has_value() && st->mtime_ms == 2000);
    k.vfs().write_text(
        "/mode.js",
        "const fs=require('fs');\n"
        "fs.chmodSync('/mode.txt', 0o700);\n"
        "fs.utimesSync('/mode.txt', 3, 4);\n"
        "const s=fs.statSync('/mode.txt');\n"
        "console.log('mode='+ (s.mode&0o777) +' mtime='+s.mtimeMs);\n"
        "console.log('sha512='+require('crypto').createHash('sha512').update('abc').digest('hex').slice(0,16));\n"
        "console.log('tty='+require('tty').isatty(1));\n"
        "require('readline').createInterface({input:process.stdin,output:process.stdout}).close();\n"
        "console.log('rlok');\n");
    auto pid = k.spawn("node", {"/mode.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("mtime=4") != std::string::npos);
    CHECK(out.find("sha512=") != std::string::npos);
    CHECK(out.find("tty=false") != std::string::npos);
    CHECK(out.find("rlok") != std::string::npos);
  }
  {
    CHECK(k.vfs().mkdir("/home/project/node_modules/hello-cli", true));
    CHECK(k.vfs().write_text("/home/project/node_modules/hello-cli/cli.js",
                             "console.log('frombin');\n"));
    CHECK(k.vfs().mkdir("/home/project/node_modules/.bin", true));
    CHECK(k.vfs().write_text("/home/project/node_modules/.bin/hello",
                             "require('../hello-cli/cli.js');\n"));
    auto pid = k.spawn("hello", {}, {}, "/home/project");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("frombin") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/ncache.js",
        "const c=require('next/cache');\n"
        "c.revalidatePath('/');\n"
        "console.log('ncache='+typeof c.unstable_cache);\n");
    auto pid = k.spawn("node", {"/ncache.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    CHECK(k.get(pid)->stdout_buf.read_all_string().find("ncache=function") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/timer.js",
        "setTimeout(function(){ console.log('later'); }, 0);\n");
    auto pid = k.spawn("node", {"/timer.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    CHECK(k.get(pid)->stdout_buf.read_all_string().find("later") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/adv.js",
        "console.log('uname-skip');\n"
        "console.log('vm='+require('vm').runInNewContext('1+2'));\n"
        "console.log('wt='+typeof require('worker_threads').Worker);\n"
        "fetch('https://example.com').then(function(){}, function(e){ console.log('fetch=deny'); });\n");
    auto pid = k.spawn("node", {"/adv.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("vm=3") != std::string::npos);
    CHECK(out.find("wt=function") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/assert.js",
        "var a=require('assert');\n"
        "a.strictEqual(1,1);\n"
        "a.deepEqual({x:1},{x:1});\n"
        "a.equal(1,'1');\n"
        "console.log('qs='+require('querystring').stringify({a:1,b:2}));\n"
        "console.log('sys='+typeof require('sys').format);\n");
    auto pid = k.spawn("node", {"/assert.js"}, {}, "/");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("qs=a=1&b=2") != std::string::npos);
    CHECK(out.find("sys=function") != std::string::npos);
  }
#endif

  {
    auto pid = k.spawn("uname", {});
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    CHECK(k.get(pid)->stdout_buf.read_all_string().find("browsernode") != std::string::npos);
  }
  {
    auto pid = k.spawn("printf", {"hi"});
    CHECK(k.wait(pid).value_or(1) == 0);
    CHECK(k.get(pid)->stdout_buf.read_all_string() == "hi");
  }

  {
    auto parent = k.spawn("true", {});
    auto child = k.spawn("echo", {"tree"}, {}, "/", parent);
    CHECK(k.get(child)->parent_pid == parent);
    CHECK(k.kill_tree(parent) >= 1);
    auto cp = k.get(child);
    CHECK(cp);
    CHECK(cp->state != ProcessState::Running);
  }
  {
    auto alive = k.spawn("true", {});
    CHECK(k.kill_tree(0) == 0);
    CHECK(k.get(alive) != nullptr);
    auto bare = k.spawn("npm", {});
    auto bc = k.wait(bare);
    CHECK(bc.has_value() && *bc == 1);
  }

#if defined(BN_HAS_QUICKJS)
  {
    k.vfs().mkdir("/home/cli/node_modules/typescript/lib", true);
    k.vfs().mkdir("/home/cli/node_modules/.bin", true);
    k.vfs().write_text(
        "/home/cli/node_modules/typescript/lib/tsc.js",
        "var fs=require('fs');var path=require('path');\n"
        "var outDir='.'; var files=[];\n"
        "for(var i=2;i<process.argv.length;i++){\n"
        "  if(process.argv[i]==='--outDir'){ outDir=process.argv[++i]; continue; }\n"
        "  if(process.argv[i].charAt(0)==='-') continue;\n"
        "  files.push(process.argv[i]);\n"
        "}\n"
        "files.forEach(function(f){\n"
        "  var src=fs.readFileSync(path.resolve(f),'utf8');\n"
        "  var js=String(src).replace(/:\\s*[A-Za-z][A-Za-z0-9_<>,\\s|]*/g,'');\n"
        "  try{fs.mkdirSync(outDir,{recursive:true});}catch(e){}\n"
        "  var dest=path.join(outDir, path.basename(f).replace(/\\.tsx?$/,'.js'));\n"
        "  fs.writeFileSync(dest, js);\n"
        "  console.log('tsc-ok '+dest);\n"
        "});\n");
    k.vfs().write_text("/home/cli/node_modules/.bin/tsc",
                       "#!/usr/bin/env node\nrequire('../typescript/lib/tsc.js');\n");
    k.vfs().write_text("/home/cli/hi.ts", "const x: number = 1;\n");
    auto pid = k.spawn("tsc", {"hi.ts", "--outDir", "/home/cli/tsout"}, {}, "/home/cli");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("tsc-ok") != std::string::npos);
    auto js = k.vfs().read_text("/home/cli/tsout/hi.js");
    CHECK(js.has_value());
  }
  {
    k.vfs().mkdir("/home/vcli/node_modules/vite/bin", true);
    k.vfs().write_text("/home/vcli/node_modules/vite/bin/vite.js",
                       "console.log('vite-cli=' + process.argv.slice(2).join(','));\n");
    auto pid = k.spawn("vite", {"build"}, {}, "/home/vcli");
    auto code = k.wait(pid);
    CHECK(code.has_value() && *code == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("vite-cli=build") != std::string::npos);
  }
  {
    CHECK(k.vfs().mkdir("/empty-rm", true));
    k.vfs().write_text(
        "/rmdir.js",
        "const fs=require('fs');\n"
        "fs.rmdirSync('/empty-rm');\n"
        "console.log('rmdir=' + (!fs.existsSync('/empty-rm')));\n");
    auto pid = k.spawn("node", {"/rmdir.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    CHECK(k.get(pid)->stdout_buf.read_all_string().find("rmdir=true") != std::string::npos);
  }
  {
    k.vfs().write_text("/so.js", "process.stdout.write('A'); process.stdout.write('B');\n");
    auto pid = k.spawn("node", {"/so.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("AB") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/stdin.js",
        "process.stdin.on('data', function(buf) {\n"
        "  console.log('in=' + buf.toString());\n"
        "  process.exit(0);\n"
        "});\n");
    auto pid = k.spawn("node", {"/stdin.js"}, {}, "/");
    CHECK(!k.wait(pid).has_value());
    const char* msg = "ping";
    CHECK(k.write_stdin(pid, reinterpret_cast<const uint8_t*>(msg), 4) == 4);
    std::optional<int> code;
    for (int i = 0; i < 20 && !code; ++i) {
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
      code = k.wait(pid);
    }
    CHECK(code.has_value() && *code == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("in=ping") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/stdin-end.js",
        "var parts=[];\n"
        "process.stdin.on('data', function(buf) { parts.push(buf.toString()); });\n"
        "process.stdin.on('end', function() { console.log('end=' + parts.join('')); });\n");
    auto pid = k.spawn("node", {"/stdin-end.js"}, {}, "/");
    CHECK(!k.wait(pid).has_value());
    const char* msg = "hi";
    CHECK(k.write_stdin(pid, reinterpret_cast<const uint8_t*>(msg), 2) == 2);
    k.close_stdin(pid);
    std::optional<int> code;
    for (int i = 0; i < 40 && !code; ++i) {
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
      code = k.wait(pid);
    }
    CHECK(code.has_value() && *code == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("end=hi") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/rl.js",
        "const rl=require('readline').createInterface({input:process.stdin,output:process.stdout});\n"
        "rl.question('name? ', function(a){ console.log('ans='+a); });\n"
        "rl.on('line', function(line){ console.log('line='+line); if(line==='quit') rl.close(); });\n"
        "rl.on('close', function(){ process.exit(0); });\n");
    auto pid = k.spawn("node", {"/rl.js"}, {}, "/");
    CHECK(!k.wait(pid).has_value());
    const char* lines = "ada\nquit\n";
    CHECK(k.write_stdin(pid, reinterpret_cast<const uint8_t*>(lines), 9) == 9);
    std::optional<int> code;
    for (int i = 0; i < 20 && !code; ++i) {
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
      code = k.wait(pid);
    }
    CHECK(code.has_value() && *code == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("name? ") != std::string::npos);
    CHECK(out.find("ans=ada") != std::string::npos);
    CHECK(out.find("line=quit") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/http.js",
        "const http=require('http');\n"
        "http.createServer(function(req,res){\n"
        "  var b='';\n"
        "  req.on('data', function(c){ b+=c; });\n"
        "  req.on('end', function(){\n"
        "    res.writeHead(201, {'X-Test':'yes'});\n"
        "    res.end(req.method+' '+req.url+' '+b);\n"
        "  });\n"
        "}).listen(3210);\n"
        "http.request({hostname:'127.0.0.1', port:3210, path:'/x', method:'POST'}, function(res){\n"
        "  var body='';\n"
        "  res.on('data', function(c){ body+=c; });\n"
        "  res.on('end', function(){ console.log('status='+res.statusCode+' body='+body+' x='+res.headers['x-test']); });\n"
        "}).end('z');\n"
        "var miss=http.request({hostname:'127.0.0.1', port:9, path:'/'}, function(){});\n"
        "miss.on('error', function(e){ console.log('code='+e.code); });\n"
        "miss.end();\n"
        "var blocked=http.request({hostname:'example.com', port:80, path:'/'}, function(){});\n"
        "blocked.on('error', function(){ console.log('blocked=1'); });\n"
        "blocked.end();\n");
    auto pid = k.spawn("node", {"/http.js"}, {}, "/");
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("status=201") != std::string::npos);
    CHECK(out.find("body=POST /x z") != std::string::npos);
    CHECK(out.find("x=yes") != std::string::npos);
    CHECK(out.find("code=ECONNREFUSED") != std::string::npos);
    CHECK(out.find("blocked=1") != std::string::npos);
    k.kill(pid);
  }
  {
    k.vfs().write_text(
        "/child.js",
        "console.log(process.argv.slice(2).join('+') + ':' + process.env.BN_CHILD);\n");
    k.vfs().write_text(
        "/parent.js",
        "const cp=require('child_process');\n"
        "cp.execFile(process.execPath, ['/child.js', 'a', 'b'], {env:{BN_CHILD:'ok'}}, function(err, stdout){\n"
        "  console.log('child=' + String(stdout||'').trim() + ' bad=' + (err?1:0));\n"
        "  process.exit(0);\n"
        "});\n");
    auto pid = k.spawn("node", {"/parent.js"}, {}, "/");
    std::optional<int> code;
    for (int i = 0; i < 20 && !code; ++i) {
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
      code = k.wait(pid);
    }
    CHECK(code.has_value() && *code == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("child=a+b:ok") != std::string::npos);
    CHECK(out.find("bad=0") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/fd.js",
        "const fs=require('fs');\n"
        "const w=fs.openSync('/fd.txt','w');\n"
        "if(fs.writeSync(w, Buffer.from('hello'))!==5) throw new Error('write');\n"
        "fs.closeSync(w);\n"
        "const buf=Buffer.alloc(8);\n"
        "const r=fs.openSync('/fd.txt','r');\n"
        "const n=fs.readSync(r, buf, 0, 8, 0);\n"
        "const st=fs.fstatSync(r);\n"
        "fs.closeSync(r);\n"
        "var bad=false;\n"
        "try{fs.readSync(r, buf, 0, 1, 0);}catch(e){bad=e.code==='EBADF';}\n"
        "const a=fs.openSync('/fd.txt','a');\n"
        "fs.writeSync(a, '!');\n"
        "fs.closeSync(a);\n"
        "console.log('fd='+n+':'+buf.toString().slice(0,n)+' size='+st.size+' bad='+bad+' all='+fs.readFileSync('/fd.txt'));\n");
    auto pid = k.spawn("node", {"/fd.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("fd=5:hello") != std::string::npos);
    CHECK(out.find("bad=true") != std::string::npos);
    CHECK(out.find("all=hello!") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/fd-p.js",
        "const fs=require('fs');\n"
        "const w=fs.openSync('/p.txt','w');\n"
        "fs.writeSync(w, 'hi');\n"
        "fs.closeSync(w);\n"
        "fs.promises.open('/p.txt','r').then(function(h){\n"
        "  var b=Buffer.alloc(4);\n"
        "  return h.read(b,0,4,0).then(function(got){\n"
        "    console.log('ph='+got.bytesRead+':'+b.toString().slice(0,got.bytesRead));\n"
        "    return h.close();\n"
        "  });\n"
        "}).catch(function(e){ console.log('ERR '+(e&&e.code)+' '+(e&&e.message)); });\n");
    auto pid = k.spawn("node", {"/fd-p.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("ph=2:hi") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/trunc.js",
        "const fs=require('fs');\n"
        "fs.writeFileSync('/t.txt', 'hello');\n"
        "fs.truncateSync('/t.txt', 2);\n"
        "fs.appendFileSync('/t.txt', '!');\n"
        "fs.appendFileSync('/new.txt', 'ab');\n"
        "fs.writeFileSync('/z.txt', 'ab');\n"
        "fs.truncateSync('/z.txt', 4);\n"
        "const pad=fs.readFileSync('/z.txt', 'buffer');\n"
        "const hex=pad.toString('hex');\n"
        "const fd=fs.openSync('/t.txt', 'r+');\n"
        "fs.ftruncateSync(fd, 1);\n"
        "fs.closeSync(fd);\n"
        "var bad=false;\n"
        "try{fs.ftruncateSync(fd, 0);}catch(e){bad=e.code==='EBADF';}\n"
        "try{fs.truncateSync('/missing-trunc', 0);}catch(e){bad=bad&&e.code==='ENOENT';}\n"
        "fs.promises.appendFile('/p2.txt', 'zz').then(function(){\n"
        "  return fs.promises.truncate('/p2.txt', 1);\n"
        "}).then(function(){\n"
        "  console.log('trunc='+fs.readFileSync('/t.txt')+'|'+fs.readFileSync('/new.txt')+'|'+hex+'|'+bad+'|'+fs.readFileSync('/p2.txt'));\n"
        "}).catch(function(e){ console.log('ERR '+(e&&e.code)+' '+(e&&e.message)); });\n");
    auto pid = k.spawn("node", {"/trunc.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("trunc=h|ab|61620000|true|z") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/fd-rw.js",
        "const fs=require('fs');\n"
        "fs.writeFileSync('/rw.txt', 'hello');\n"
        "const fd=fs.openSync('/rw.txt', 'r+');\n"
        "const s=fs.readFileSync(fd, 'utf8');\n"
        "fs.writeFileSync(fd, '!');\n"
        "fs.closeSync(fd);\n"
        "const r=fs.openSync('/rw.txt', 'r');\n"
        "const b=fs.readFileSync(r);\n"
        "fs.closeSync(r);\n"
        "var bad=false;\n"
        "try{fs.readFileSync(r, 'utf8');}catch(e){bad=e.code==='EBADF';}\n"
        "try{fs.writeFileSync(r, 'no');}catch(e){bad=bad&&e.code==='EBADF';}\n"
        "const w=fs.openSync('/rw.txt', 'r+');\n"
        "fs.writeFileSync(w, 'XY');\n"
        "fs.appendFileSync(w, '?');\n"
        "fs.closeSync(w);\n"
        "console.log('fdrw='+s+'|'+b.toString()+'|'+fs.readFileSync('/rw.txt')+'|'+bad);\n");
    auto pid = k.spawn("node", {"/fd-rw.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("fdrw=hello|hello!|XYllo!?|true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/win.js",
        "const path=require('path');\n"
        "const w=path.win32;\n"
        "const a=w.join('C:\\\\foo','bar','..','baz');\n"
        "const b=w.dirname('C:\\\\foo\\\\bar.txt');\n"
        "const c=w.basename('C:\\\\foo\\\\bar.txt','.txt');\n"
        "const d=w.extname('C:\\\\foo\\\\bar.txt');\n"
        "const e=w.normalize('C:\\\\foo\\\\\\\\bar\\\\..\\\\baz');\n"
        "const abs=w.isAbsolute('C:/foo')&&!w.isAbsolute('foo')&&w.isAbsolute('\\\\\\\\srv\\\\share');\n"
        "const p=w.parse('C:\\\\foo\\\\bar.txt');\n"
        "const rel=w.relative('C:\\\\foo\\\\bar','C:\\\\foo\\\\baz\\\\x');\n"
        "const res=w.resolve('C:\\\\foo','..\\\\bar');\n"
        "const posix=path.join('/a','b');\n"
        "console.log([a,b,c,d,e,abs?1:0,p.root,p.dir,p.base,p.ext,p.name,rel,res,posix,path.win32!==path.posix?1:0].join('|'));\n");
    auto pid = k.spawn("node", {"/win.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("C:\\foo\\baz|C:\\foo|bar|.txt|C:\\foo\\baz|1|C:\\|C:\\foo|bar.txt|.txt|bar|..\\baz\\x|C:\\bar|/a/b|1") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/ren.js",
        "const fs=require('fs');\n"
        "fs.writeFileSync('/a.txt','hi');\n"
        "const fd=fs.openSync('/a.txt','r');\n"
        "fs.renameSync('/a.txt','/b.txt');\n"
        "const n=fs.readFileSync(fd,'utf8');\n"
        "fs.closeSync(fd);\n"
        "fs.mkdirSync('/dir');\n"
        "fs.writeFileSync('/dir/x.txt','x');\n"
        "fs.renameSync('/dir','/dir2');\n"
        "var missing=false;\n"
        "try{fs.renameSync('/nope','/z');}catch(e){missing=e.code==='ENOENT';}\n"
        "fs.promises.rename('/b.txt','/c.txt').then(function(){\n"
        "  console.log(n+'|'+fs.readFileSync('/c.txt')+'|'+fs.readFileSync('/dir2/x.txt')+'|'+fs.existsSync('/a.txt')+'|'+missing);\n"
        "}).catch(function(e){ console.log('ERR '+(e&&e.code)+' '+(e&&e.message)); });\n");
    auto pid = k.spawn("node", {"/ren.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("hi|hi|x|false|true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/hr.js",
        "var a=process.hrtime();\n"
        "var b=process.hrtime(a);\n"
        "var c=process.hrtime();\n"
        "var nano=a[1]>=0&&a[1]<1000000000&&b[1]>=0&&b[1]<1000000000;\n"
        "var mono=c[0]>a[0]||(c[0]===a[0]&&c[1]>=a[1]);\n"
        "var u=process.uptime();\n"
        "console.log('hr='+(a.length===2&&nano&&b[0]>=0&&mono&&u>=0));\n");
    auto pid = k.spawn("node", {"/hr.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("hr=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/cd.js",
        "const fs=require('fs');\n"
        "fs.mkdirSync('/work/sub', {recursive:true});\n"
        "fs.writeFileSync('/work/sub/a.txt', 'ok');\n"
        "process.chdir('/work/sub');\n"
        "process.chdir('..');\n"
        "process.chdir('sub');\n"
        "var text=fs.readFileSync('a.txt');\n"
        "var cwd=process.cwd();\n"
        "var eno=false, nd=false;\n"
        "try{process.chdir('nope');}catch(e){eno=e.code==='ENOENT';}\n"
        "try{process.chdir('a.txt');}catch(e){nd=e.code==='ENOTDIR';}\n"
        "console.log(cwd+'|'+text+'|'+eno+'|'+nd);\n");
    auto pid = k.spawn("node", {"/cd.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("/work/sub|ok|true|true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/acc.js",
        "const fs=require('fs');\n"
        "fs.writeFileSync('/m.txt','a');\n"
        "fs.accessSync('/m.txt', fs.constants.R_OK);\n"
        "fs.accessSync('/m.txt', fs.constants.W_OK);\n"
        "var x=false, w=false, miss=false;\n"
        "try{fs.accessSync('/m.txt', fs.constants.X_OK);}catch(e){x=e.code==='EACCES';}\n"
        "fs.chmodSync('/m.txt', 0o444);\n"
        "try{fs.accessSync('/m.txt', fs.constants.W_OK);}catch(e){w=e.code==='EACCES';}\n"
        "fs.accessSync('/m.txt', fs.constants.R_OK);\n"
        "try{fs.accessSync('/no-access');}catch(e){miss=e.code==='ENOENT';}\n"
        "fs.promises.access('/m.txt', fs.constants.R_OK).then(function(){\n"
        "  console.log('acc='+x+'|'+w+'|'+miss);\n"
        "}).catch(function(e){ console.log('ERR '+(e&&e.code)+' '+(e&&e.message)); });\n");
    auto pid = k.spawn("node", {"/acc.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("acc=true|true|true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/rp.js",
        "const fs=require('fs');\n"
        "fs.mkdirSync('/real', {recursive:true});\n"
        "fs.writeFileSync('/real/file.txt', 'hi');\n"
        "fs.symlinkSync('/real/file.txt', '/link');\n"
        "fs.symlinkSync('file.txt', '/real/rel');\n"
        "fs.symlinkSync('/link', '/link2');\n"
        "fs.symlinkSync('/cycle/b', '/cycle/a');\n"
        "fs.symlinkSync('/cycle/a', '/cycle/b');\n"
        "var loop=false, miss=false;\n"
        "try{fs.realpathSync('/cycle/a');}catch(e){loop=e.code==='ELOOP';}\n"
        "try{fs.realpathSync('/no-such-real');}catch(e){miss=e.code==='ENOENT';}\n"
        "var got=fs.realpathSync('/link')+'|'+fs.realpathSync('/real/rel')+'|'+fs.realpathSync('/link2')+'|'+fs.realpathSync('/real/../real/./file.txt');\n"
        "console.log(got+'|'+loop+'|'+miss+'|'+(fs.realpathSync.native===fs.realpathSync));\n");
    auto pid = k.spawn("node", {"/rp.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("/real/file.txt|/real/file.txt|/real/file.txt|/real/file.txt|true|true|true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/uuid.js",
        "const c=require('crypto');\n"
        "const a=c.randomUUID();\n"
        "const b=c.randomUUID();\n"
        "const re=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;\n"
        "console.log('uuid='+(re.test(a)&&re.test(b)&&a!==b));\n");
    auto pid = k.spawn("node", {"/uuid.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("uuid=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/pbkdf2.js",
        "const c=require('crypto');\n"
        "const a=c.pbkdf2Sync('password','salt',1,20,'sha1').toString('hex');\n"
        "const b=c.pbkdf2Sync('password','salt',2,20,'sha1').toString('hex');\n"
        "const d=c.pbkdf2Sync('password','salt',1,32,'sha256').toString('hex');\n"
        "var bad=false;\n"
        "try{c.pbkdf2Sync('password','salt',0,20,'sha1');}catch(e){bad=e.code==='ERR_OUT_OF_RANGE';}\n"
        "console.log('pbkdf2='+(a==='0c60c80f961f0e71f3a9b524af6012062fe037a6'&&b==='ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957'&&d==='120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b'&&bad));\n");
    auto pid = k.spawn("node", {"/pbkdf2.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("pbkdf2=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/aes.js",
        "const c=require('crypto');\n"
        "const key=Buffer.alloc(32,1);\n"
        "const iv=Buffer.alloc(16,2);\n"
        "const enc=c.createCipheriv('aes-256-cbc', key, iv);\n"
        "const ct=Buffer.concat([enc.update('hello'), enc.final()]);\n"
        "const dec=c.createDecipheriv('aes-256-cbc', key, iv);\n"
        "const pt=Buffer.concat([dec.update(ct), dec.final()]).toString();\n"
        "const key2=Buffer.from('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4','hex');\n"
        "const iv2=Buffer.from('000102030405060708090a0b0c0d0e0f','hex');\n"
        "const block=Buffer.from('6bc1bee22e409f96e93d7e117393172a','hex');\n"
        "const rawEnc=c.createCipheriv('aes-256-cbc', key2, iv2);\n"
        "rawEnc.setAutoPadding(false);\n"
        "const raw=Buffer.concat([rawEnc.update(block), rawEnc.final()]).toString('hex');\n"
        "const rawDec=c.createDecipheriv('aes-256-cbc', key2, iv2);\n"
        "rawDec.setAutoPadding(false);\n"
        "const back=Buffer.concat([rawDec.update(Buffer.from(raw,'hex')), rawDec.final()]).toString('hex');\n"
        "console.log('aes='+(pt==='hello'&&ct.toString('hex')==='aaf7a0b1c5d4d4b8c8abeaa891ec2755'&&raw==='f58c4c04d6e5f1ba779eabfb5f7bfbd6'&&back==='6bc1bee22e409f96e93d7e117393172a'));\n");
    auto pid = k.spawn("node", {"/aes.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("aes=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/b64.js",
        "const hello=Buffer.from('hello').toString('base64');\n"
        "const back=Buffer.from('aGVsbG8=','base64').toString();\n"
        "const nopad=Buffer.from('aGVs bG8=','base64').toString();\n"
        "const bytes=Buffer.from([0,1,2,250,255]);\n"
        "const url=Buffer.from([0xfb,0xff,0xbf]).toString('base64url');\n"
        "const urlBack=Buffer.from('AAEC-v8','base64url').toString('hex');\n"
        "const latin=Buffer.from(String.fromCharCode(255),'latin1').toString('hex');\n"
        "const latinBack=Buffer.from([255]).toString('binary').charCodeAt(0);\n"
        "const ascii=Buffer.from(String.fromCharCode(65,321),'ascii').toString('hex');\n"
        "console.log('b64='+(hello==='aGVsbG8='&&back==='hello'&&nopad==='hello'&&bytes.toString('base64')==='AAEC+v8='&&url==='-_-_'&&urlBack==='000102faff'&&latin==='ff'&&latinBack===255&&ascii==='4141'));\n");
    auto pid = k.spawn("node", {"/b64.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("b64=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/utf8.js",
        "const grin=String.fromCharCode(0xD83D,0xDE00);\n"
        "const euro=String.fromCharCode(0x20AC);\n"
        "const g=Buffer.from(grin);\n"
        "const back=Buffer.from([0xf0,0x9f,0x98,0x80]).toString();\n"
        "const dst=Buffer.alloc(5);\n"
        "const copied=Buffer.from('hello').copy(dst,1,0,3);\n"
        "const filled=Buffer.alloc(4).fill('ab').toString('hex');\n"
        "const ok=g.toString('hex')==='f09f9880'&&g.toString()===grin&&back===grin&&Buffer.byteLength(grin)===4&&Buffer.byteLength(euro)===3&&Buffer.from(euro).toString('hex')==='e282ac';\n"
        "const cmp=Buffer.compare(Buffer.from('a'),Buffer.from('b'))===-1&&Buffer.compare(Buffer.from('a'),Buffer.from('aa'))===-1&&Buffer.from('ab').equals(Buffer.from('ab'))&&!Buffer.from('ab').equals(Buffer.from('a'));\n"
        "const find=Buffer.from('hello').indexOf('ll')===2&&Buffer.from('hello').indexOf(0x6c)===2&&!Buffer.from('hello').includes('x')&&copied===3&&dst.toString('hex')==='0068656c00'&&filled==='61626162';\n"
        "console.log('utf8='+(ok&&cmp&&find));\n");
    auto pid = k.spawn("node", {"/utf8.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("utf8=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/int.js",
        "const b=Buffer.from([0xff,0xfe,0xfd,0xfc,0x80]);\n"
        "const reads=[b.readUInt8(4),b.readUInt16BE(0),b.readUInt16LE(0),b.readUInt32BE(0),b.readUInt32LE(0),b.readInt8(4),b.readInt16BE(0),b.readInt16LE(0),b.readInt32BE(0),b.readInt32LE(0)].join(',');\n"
        "const w=Buffer.alloc(8);\n"
        "const n=w.writeUInt32BE(0x01020304,0);\n"
        "const n2=w.writeInt16LE(-2,4);\n"
        "const n3=w.writeUInt8(255,6);\n"
        "var bad=false;\n"
        "try{b.readUInt8(9);}catch(e){bad=e.code==='ERR_OUT_OF_RANGE';}\n"
        "const back=w.readUInt32BE(0)===0x01020304&&w.readInt16LE(4)===-2&&w.readUInt8(6)===255;\n"
        "console.log('int='+(reads==='128,65534,65279,4294901244,4244504319,-128,-2,-257,-66052,-50462977'&&n===4&&n2===6&&n3===7&&w.toString('hex')==='01020304feffff00'&&bad&&back));\n");
    auto pid = k.spawn("node", {"/int.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("int=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/ev.js",
        "const ev=require('events');\n"
        "const ee=new ev.EventEmitter();\n"
        "const order=[];\n"
        "ee.prependListener('a', function(){ order.push('pre'); });\n"
        "ee.addListener('a', function(){ order.push('on'); });\n"
        "ee.emit('a');\n"
        "var n=0;\n"
        "ee.once('b', function(x){ n=x; });\n"
        "ee.emit('b', 7);\n"
        "ee.emit('b', 9);\n"
        "var hit=0;\n"
        "function orig(){ hit++; }\n"
        "ee.once('d', orig);\n"
        "ee.off('d', orig);\n"
        "ee.emit('d');\n"
        "const names=ee.eventNames().join(',');\n"
        "const ee2=new ev.EventEmitter();\n"
        "const p=ev.once(ee, 'e').then(function(args){ return args[0]; });\n"
        "const p2=ev.once(ee2, 'z').then(function(){ return 'bad'; }, function(){ return 'err'; });\n"
        "ee.emit('e', 'ok');\n"
        "ee2.emit('error', new Error('nope'));\n"
        "Promise.all([p, p2]).then(function(r){\n"
        "  console.log('ev='+(order.join(',')==='pre,on'&&n===7&&hit===0&&names==='a'&&r[0]==='ok'&&r[1]==='err'&&ee.listeners('b').length===0));\n"
        "});\n");
    auto pid = k.spawn("node", {"/ev.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("ev=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/deep.js",
        "const a=require('assert');\n"
        "a.deepStrictEqual({a:1,b:2},{b:2,a:1});\n"
        "a.deepStrictEqual(Buffer.from('ab'),Buffer.from('ab'));\n"
        "a.deepStrictEqual(NaN,NaN);\n"
        "a.deepEqual(1,'1');\n"
        "a.deepStrictEqual(new Date(5),new Date(5));\n"
        "a.deepStrictEqual(/a/gi,/a/gi);\n"
        "a.strict.deepEqual({x:[1]},{x:[1]});\n"
        "var strictNum=false, undef=false, hole=false, buf=false;\n"
        "try{a.deepStrictEqual(1,'1');}catch(e){strictNum=e.code==='ERR_ASSERTION';}\n"
        "try{a.deepStrictEqual({a:undefined},{});}catch(e){undef=true;}\n"
        "try{a.deepStrictEqual([1,,3],[1,undefined,3]);}catch(e){hole=true;}\n"
        "try{a.deepStrictEqual(Buffer.from('a'),Buffer.from('b'));}catch(e){buf=true;}\n"
        "console.log('deep='+(strictNum&&undef&&hole&&buf));\n");
    auto pid = k.spawn("node", {"/deep.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("deep=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/rint.js",
        "const c=require('crypto');\n"
        "var ok=true;\n"
        "for (var i=0;i<40;i++){\n"
        "  var n=c.randomInt(5,8);\n"
        "  if (n<5||n>=8||n!==(n|0)) ok=false;\n"
        "  if (c.randomInt(1)!==0) ok=false;\n"
        "}\n"
        "var bad=false;\n"
        "try{c.randomInt(3,3);}catch(e){bad=e.code==='ERR_OUT_OF_RANGE';}\n"
        "var cbv=null;\n"
        "c.randomInt(2,4,function(err,n){cbv=n;});\n"
        "var ciphers=c.getCiphers().indexOf('aes-256-cbc')>=0&&c.getCiphers().indexOf('aes-128-cbc')>=0;\n"
        "console.log('rint='+(ok&&bad&&cbv>=2&&cbv<4&&ciphers));\n");
    auto pid = k.spawn("node", {"/rint.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("rint=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/fmt.js",
        "const u=require('util');\n"
        "const a=u.format('%s:%s','a','b','c')==='a:b c';\n"
        "const b=u.format(1,2,3)==='1 2 3';\n"
        "const c=u.format('%% %i %d',1.9,2.5)==='% 1 2.5';\n"
        "const d=u.format('%j',{a:1})==='{\"a\":1}';\n"
        "const e=u.format()==='';\n"
        "const f=u.format('%s')==='%s';\n"
        "const g=u.format('%s',{a:1})==='{ a: 1 }';\n"
        "const h=u.format('x',{a:1})==='x { a: 1 }';\n"
        "const i=u.isDeepStrictEqual({b:1,a:2},{a:2,b:1});\n"
        "const j=!u.isDeepStrictEqual(Buffer.from('a'),Buffer.from('b'));\n"
        "const k=u.inspect(Buffer.from('ab'))==='<Buffer 61 62>';\n"
        "console.log('fmt='+(a&&b&&c&&d&&e&&f&&g&&h&&i&&j&&k));\n");
    auto pid = k.spawn("node", {"/fmt.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("fmt=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/enc.js",
        "const fs=require('fs');\n"
        "fs.writeFileSync('/t.bin', Buffer.from([0,255,97]));\n"
        "const hex=fs.readFileSync('/t.bin','hex');\n"
        "const b64=fs.readFileSync('/t.bin',{encoding:'base64'});\n"
        "const buf=fs.readFileSync('/t.bin',{encoding:'buffer'});\n"
        "const expect=Buffer.from([0,255,97]).toString('base64');\n"
        "fs.writeFileSync('/w.txt','6869','hex');\n"
        "const back=fs.readFileSync('/w.txt');\n"
        "const utf=fs.readFileSync('/w.txt','utf8');\n"
        "console.log('enc='+(hex==='00ff61'&&b64===expect&&buf.toString('hex')==='00ff61'&&back==='hi'&&utf==='hi'));\n");
    auto pid = k.spawn("node", {"/enc.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("enc=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/base.js",
        "const p=require('path');\n"
        "const a=p.basename('a/b/c.txt','.txt')==='c';\n"
        "const b=p.basename('a/b/c.txt','txt')==='c.';\n"
        "const c=p.basename('a/b/.txt','.txt')==='.txt';\n"
        "const d=p.extname('dir.ext/file')==='';\n"
        "const e=p.extname('.gitignore')==='';\n"
        "const f=p.extname('a/b.tar.gz')==='.gz';\n"
        "const g=p.extname('a.')==='.';\n"
        "const h=p.win32.basename('C:\\\\foo\\\\bar.txt','.txt')==='bar';\n"
        "const i=p.win32.extname('C:\\\\foo.bar\\\\baz')==='';\n"
        "const j=p.basename('/a/b/')==='b';\n"
        "console.log('base='+(a&&b&&c&&d&&e&&f&&g&&h&&i&&j));\n");
    auto pid = k.spawn("node", {"/base.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("base=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/dirent.js",
        "const fs=require('fs');\n"
        "fs.mkdirSync('/dirents');\n"
        "fs.writeFileSync('/dirents/a.txt','hi');\n"
        "fs.mkdirSync('/dirents/sub');\n"
        "fs.symlinkSync('/dirents/a.txt','/dirents/link');\n"
        "const names=fs.readdirSync('/dirents');\n"
        "const ents=fs.readdirSync('/dirents',{withFileTypes:true});\n"
        "function find(list,n){for(var i=0;i<list.length;i++) if(list[i].name===n) return list[i];}\n"
        "const a=find(ents,'a.txt');\n"
        "const s=find(ents,'sub');\n"
        "const l=find(ents,'link');\n"
        "const plain=names.length===3&&names.indexOf('a.txt')>=0;\n"
        "const typed=a instanceof fs.Dirent&&a.isFile()&&!a.isDirectory()&&s.isDirectory()&&l.isSymbolicLink()&&!l.isFile();\n"
        "const opened=fs.opendirSync('/dirents').readSync();\n"
        "fs.promises.readdir('/dirents',{withFileTypes:true}).then(function(list){\n"
        "  const sub=find(list,'sub');\n"
        "  console.log('dirent='+(plain&&typed&&opened instanceof fs.Dirent&&sub&&sub.isDirectory()));\n"
        "});\n");
    auto pid = k.spawn("node", {"/dirent.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("dirent=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/fscb.js",
        "const fs=require('fs');\n"
        "fs.writeFileSync('/cb.txt','hi');\n"
        "var data='', missing=false, wrote=false, typed=false, bad=false;\n"
        "try{fs.readFile('/cb.txt');}catch(e){bad=e.code==='ERR_INVALID_ARG_TYPE';}\n"
        "var left=4;\n"
        "function done(){ if(--left) return; console.log('fscb='+(bad&&data==='hi'&&missing&&wrote&&typed)); }\n"
        "fs.readFile('/cb.txt','utf8',function(err,d){ data=d; done(); });\n"
        "fs.readFile('/no-such-cb',function(err){ missing=!!(err&&String(err.message||err).indexOf('ENOENT')>=0); done(); });\n"
        "fs.writeFile('/cb2.txt','yo',function(err){\n"
        "  fs.readFile('/cb2.txt','utf8',function(e,d){ wrote=!e&&d==='yo'; done(); });\n"
        "});\n"
        "fs.mkdirSync('/cbdir'); fs.writeFileSync('/cbdir/a','x');\n"
        "fs.readdir('/cbdir',{withFileTypes:true},function(err,list){\n"
        "  typed=!err&&list[0] instanceof fs.Dirent&&list[0].name==='a'&&list[0].isFile();\n"
        "  done();\n"
        "});\n");
    auto pid = k.spawn("node", {"/fscb.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("fscb=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/hdr.js",
        "const http=require('http');\n"
        "if(http.STATUS_CODES[404]!=='Not Found'||http.STATUS_CODES[200]!=='OK') throw new Error('codes');\n"
        "http.createServer(function(req,res){\n"
        "  res.setHeader('X-Test','yes');\n"
        "  res.setHeader('X-Drop','1');\n"
        "  res.removeHeader('x-drop');\n"
        "  if(res.getHeader('X-Test')!=='yes'||res.hasHeader('x-drop')){ res.statusCode=500; res.end('bad-header'); return; }\n"
        "  res.writeHead(404,'Missing');\n"
        "  res.end('gone');\n"
        "}).listen(3212);\n"
        "http.get({hostname:'127.0.0.1',port:3212,path:'/'},function(res){\n"
        "  var body='';\n"
        "  res.on('data',function(c){ body+=c; });\n"
        "  res.on('end',function(){\n"
        "    console.log('hdr='+(res.statusCode===404&&res.statusMessage==='Missing'&&body==='gone'&&res.headers['x-test']==='yes'&&!res.headers['x-drop']));\n"
        "  });\n"
        "});\n");
    auto pid = k.spawn("node", {"/hdr.js"}, {}, "/");
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("hdr=true") != std::string::npos);
    k.kill(pid);
  }
  {
    k.vfs().write_text(
        "/sd.js",
        "const sd=require('string_decoder');\n"
        "const d=new sd.StringDecoder('utf8');\n"
        "const a=d.write(Buffer.from([0xe2,0x82]));\n"
        "const b=d.write(Buffer.from([0xac]));\n"
        "const d2=new sd.StringDecoder('utf8');\n"
        "const c=d2.write(Buffer.from([0xe2]));\n"
        "const end=d2.end();\n"
        "const d3=new sd.StringDecoder('utf8');\n"
        "const g1=d3.write(Buffer.from([0xf0,0x9f]));\n"
        "const g2=d3.write(Buffer.from([0x98,0x80]));\n"
        "const hi=new sd.StringDecoder().write(Buffer.from('hi'));\n"
        "const euro=b===String.fromCharCode(0x20AC);\n"
        "const grin=g2===String.fromCharCode(0xD83D,0xDE00);\n"
        "console.log('sd='+(a===''&&euro&&c===''&&end.charCodeAt(0)===0xFFFD&&g1===''&&grin&&hi==='hi'));\n");
    auto pid = k.spawn("node", {"/sd.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("sd=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/bjson.js",
        "const b=Buffer.from('hi');\n"
        "const j=JSON.stringify(b);\n"
        "const back=Buffer.from(JSON.parse(j)).toString();\n"
        "const again=Buffer.from({type:'Buffer',data:[104,105]}).toString();\n"
        "console.log('bjson='+(j==='{\"type\":\"Buffer\",\"data\":[104,105]}'&&back==='hi'&&again==='hi'));\n");
    auto pid = k.spawn("node", {"/bjson.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("bjson=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/furl.js",
        "const url=require('url');\n"
        "const a=url.fileURLToPath('file:///tmp/a%20b')==='/tmp/a b';\n"
        "const b=url.fileURLToPath('file://localhost/tmp/a')==='/tmp/a';\n"
        "const c=String(url.pathToFileURL('/tmp/a b'))==='file:///tmp/a%20b';\n"
        "const d=url.fileURLToPath(url.pathToFileURL('/tmp/a b'))==='/tmp/a b';\n"
        "var scheme=false, host=false;\n"
        "try{url.fileURLToPath('http://x/y');}catch(e){scheme=e.code==='ERR_INVALID_URL_SCHEME';}\n"
        "try{url.fileURLToPath('file://example.com/tmp/a');}catch(e){host=e.code==='ERR_INVALID_FILE_URL_HOST';}\n"
        "console.log('furl='+(a&&b&&c&&d&&scheme&&host));\n");
    auto pid = k.spawn("node", {"/furl.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("furl=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/norm.js",
        "const p=require('path');\n"
        "const a=p.join('/a','b','..','c')==='/a/c';\n"
        "const b=p.normalize('/a/b/../c')==='/a/c';\n"
        "const c=p.normalize('/a/../../b')==='/b';\n"
        "const d=p.normalize('a/../../b')==='../b';\n"
        "const e=p.join('a','..','b')==='b';\n"
        "const f=p.resolve('/a','../b')==='/b';\n"
        "const g=p.normalize('')==='.';\n"
        "const h=p.normalize('/foo/bar//baz/asdf/quux/..')==='/foo/bar/baz/asdf';\n"
        "const i=p.normalize('/a/b/')==='/a/b/';\n"
        "const j=p.join('/a/','b/')==='/a/b/';\n"
        "const k=p.normalize('.')==='.';\n"
        "const l=p.join('/a','.','b')==='/a/b';\n"
        "console.log('norm='+(a&&b&&c&&d&&e&&f&&g&&h&&i&&j&&k&&l));\n");
    auto pid = k.spawn("node", {"/norm.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("norm=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/uparse.js",
        "const u=require('url');\n"
        "const a=u.parse('https://user:pass@example.com:8080/a/b?x=1&y=2#h');\n"
        "const b=u.parse('/a/b?x=1&x=2', true);\n"
        "const c=u.parse('http://localhost');\n"
        "const d=u.parse('mailto:a@b.com');\n"
        "const e=u.parse('http://[::1]:3000/p');\n"
        "const f=u.parse('//cdn.example/lib.js');\n"
        "const g=u.parse('//cdn.example/lib.js', false, true);\n"
        "const ok=a.protocol==='https:'&&a.slashes===true&&a.auth==='user:pass'&&a.host==='example.com:8080'&&a.port==='8080'&&a.hostname==='example.com'&&a.hash==='#h'&&a.search==='?x=1&y=2'&&a.query==='x=1&y=2'&&a.pathname==='/a/b'&&a.path==='/a/b?x=1&y=2'&&a.href==='https://user:pass@example.com:8080/a/b?x=1&y=2#h'\n"
        " &&b.query.x[0]==='1'&&b.query.x[1]==='2'&&b.pathname==='/a/b'\n"
        " &&c.pathname==='/'&&c.href==='http://localhost/'&&c.host==='localhost'&&c.port===null\n"
        " &&d.protocol==='mailto:'&&d.auth==='a'&&d.host==='b.com'&&d.pathname===null\n"
        " &&e.hostname==='::1'&&e.port==='3000'&&e.pathname==='/p'&&e.host==='[::1]:3000'\n"
        " &&f.pathname==='//cdn.example/lib.js'&&f.host===null\n"
        " &&g.host==='cdn.example'&&g.pathname==='/lib.js'&&g.slashes===true\n"
        " &&u.format(a)===a.href;\n"
        "console.log('uparse='+ok);\n");
    auto pid = k.spawn("node", {"/uparse.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("uparse=true") != std::string::npos);
  }
  {
    k.vfs().write_text(
        "/ocon.js",
        "const os=require('os');\n"
        "const c=require('constants');\n"
        "const s=os.constants.signals;\n"
        "const e=os.constants.errno;\n"
        "const ok=s.SIGINT===2&&s.SIGTERM===15&&s.SIGKILL===9&&s.SIGWINCH===28\n"
        " &&e.ENOENT===-2&&e.EEXIST===-17&&e.EACCES===-13&&e.EISDIR===-21&&e.ECONNREFUSED===-111&&e.ENOTEMPTY===-39\n"
        " &&os.constants.priority.PRIORITY_NORMAL===0\n"
        " &&c.os.errno.ENOENT===-2&&c.os.signals.SIGTERM===15&&c.fs.O_CREAT===64;\n"
        "console.log('ocon='+ok);\n");
    auto pid = k.spawn("node", {"/ocon.js"}, {}, "/");
    CHECK(k.wait(pid).value_or(1) == 0);
    auto out = k.get(pid)->stdout_buf.read_all_string();
    CHECK(out.find("ocon=true") != std::string::npos);
  }
#endif

  {
    CHECK(k.vfs().mkdir("/realdir", true));
    CHECK(k.vfs().write_text("/realdir/x.txt", "keep"));
    CHECK(k.vfs().symlink("/realdir", "/linkdir"));
    auto pid = k.spawn("rm", {"-r", "/linkdir"});
    CHECK(k.wait(pid).value_or(1) == 0);
    CHECK(k.vfs().exists("/realdir/x.txt"));
    CHECK(!k.vfs().exists("/linkdir"));
  }

  if (fails) {
    std::cerr << fails << " failure(s)\n";
    return 1;
  }
  std::cout << "node_test OK\n";
  return 0;
}
