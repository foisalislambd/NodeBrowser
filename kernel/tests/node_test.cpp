#include "bn/node_runner.hpp"
#include "bn/process.hpp"

#include <iostream>
#include <string>

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
#endif

  {
    auto parent = k.spawn("true", {});
    auto child = k.spawn("echo", {"tree"}, {}, "/", parent);
    CHECK(k.get(child)->parent_pid == parent);
    CHECK(k.kill_tree(parent) >= 1);
    auto cp = k.get(child);
    CHECK(cp);
    CHECK(cp->state != ProcessState::Running);
  }

  if (fails) {
    std::cerr << fails << " failure(s)\n";
    return 1;
  }
  std::cout << "node_test OK\n";
  return 0;
}
