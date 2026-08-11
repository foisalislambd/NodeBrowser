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
#endif

  if (fails) {
    std::cerr << fails << " failure(s)\n";
    return 1;
  }
  std::cout << "node_test OK\n";
  return 0;
}
