#include "bn/vfs.hpp"

#include <cassert>
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
  Vfs vfs;
  CHECK(vfs.mkdir("/home/project", true));
  CHECK(vfs.write_text("/home/project/hello.js", "console.log('hi')"));
  auto t = vfs.read_text("/home/project/hello.js");
  CHECK(t.has_value());
  CHECK(*t == "console.log('hi')");
  auto entries = vfs.readdir("/home/project");
  CHECK(entries.has_value());
  CHECK(entries->size() == 1);
  CHECK((*entries)[0] == "hello.js");
  CHECK(vfs.exists("/home/project/hello.js"));
  CHECK(!vfs.exists("/nope"));
  CHECK(vfs.unlink("/home/project/hello.js"));
  CHECK(!vfs.exists("/home/project/hello.js"));

  vfs.mount_tree({
    {"/app/index.js", "require('./lib')"},
    {"/app/lib.js", "module.exports = 1"},
  });
  CHECK(vfs.read_text("/app/lib.js") == std::string("module.exports = 1"));

  if (fails) {
    std::cerr << fails << " failure(s)\n";
    return 1;
  }
  std::cout << "vfs_test OK\n";
  return 0;
}
