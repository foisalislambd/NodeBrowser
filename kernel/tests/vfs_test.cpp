#include "bn/vfs.hpp"

#include <cassert>
#include <cstdio>
#include <iostream>
#include <string>
#include <vector>

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

  // Phase 38: path fuzz (no crash / no escape)
  {
    CHECK(!vfs.exists("/../etc/passwd"));
    CHECK(!vfs.write_text("", "x"));
    CHECK(vfs.mkdir("/fuzz/a/b", true));
    CHECK(vfs.write_text("/fuzz/a/b/c.txt", "ok"));
    CHECK(vfs.exists("/fuzz/a/b/c.txt"));
    const char* nasty[] = {
      "/fuzz/./c.txt",
      "/fuzz/a/../a/b/c.txt",
      "/fuzz/a/b/c.txt",
    };
    (void)nasty;
    auto t2 = vfs.read_text("/fuzz/a/b/c.txt");
    CHECK(t2.has_value() && *t2 == "ok");
    CHECK(vfs.unlink("/fuzz/a/b/c.txt"));
  }

  {
    vfs.set_max_bytes(8);
    CHECK(!vfs.write_text("/cap.txt", "0123456789"));
    vfs.set_max_bytes(512ull * 1024ull * 1024ull);
    CHECK(vfs.write_text("/cap.txt", "ok"));
    CHECK(vfs.usage_bytes() >= 2);
  }

  {
    std::vector<uint8_t> tar(512 + 512, 0);
    const char* name = "hello.txt";
    for (int i = 0; name[i]; ++i) tar[static_cast<size_t>(i)] = static_cast<uint8_t>(name[i]);
    const char* sz = "00000000005";
    for (int i = 0; i < 11; ++i) tar[124 + i] = static_cast<uint8_t>(sz[i]);
    tar[156] = '0';
    unsigned sum = 0;
    for (int i = 0; i < 512; ++i) sum += (i >= 148 && i < 156) ? 32 : tar[static_cast<size_t>(i)];
    char chk[8];
    std::snprintf(chk, sizeof(chk), "%06o", sum);
    for (int i = 0; i < 6; ++i) tar[148 + i] = static_cast<uint8_t>(chk[i]);
    tar[154] = '\0';
    tar[155] = ' ';
    tar[512] = 'h';
    tar[513] = 'e';
    tar[514] = 'l';
    tar[515] = 'l';
    tar[516] = 'o';
    CHECK(vfs.extract_tar(tar.data(), tar.size(), "/untar") >= 1);
    auto ht = vfs.read_text("/untar/hello.txt");
    CHECK(ht.has_value() && *ht == "hello");
  }

  {
    CHECK(vfs.mkdir("/keep", true));
    CHECK(vfs.write_text("/keep/a.txt", "a"));
    CHECK(!vfs.rename("/keep/a.txt", "/no-parent/a.txt"));
    CHECK(vfs.exists("/keep/a.txt"));
    CHECK(vfs.mkdir("/exists-dir", true));
    CHECK(!vfs.mkdir("/exists-dir", false));
    CHECK(vfs.mkdir("/exists-dir", true));
  }

  {
    std::vector<uint8_t> tar(512 + 512, 0);
    const char* name = "../pwn.txt";
    for (int i = 0; name[i]; ++i) tar[static_cast<size_t>(i)] = static_cast<uint8_t>(name[i]);
    const char* sz = "00000000001";
    for (int i = 0; i < 11; ++i) tar[124 + i] = static_cast<uint8_t>(sz[i]);
    tar[156] = '0';
    unsigned sum = 0;
    for (int i = 0; i < 512; ++i) sum += (i >= 148 && i < 156) ? 32 : tar[static_cast<size_t>(i)];
    char chk[8];
    std::snprintf(chk, sizeof(chk), "%06o", sum);
    for (int i = 0; i < 6; ++i) tar[148 + i] = static_cast<uint8_t>(chk[i]);
    tar[154] = '\0';
    tar[155] = ' ';
    tar[512] = 'X';
    vfs.extract_tar(tar.data(), tar.size(), "/safe");
    CHECK(!vfs.exists("/pwn.txt"));
  }

  {
    const char* nasty[] = {
      "/fuzz/./c.txt",
      "/fuzz/a/../a/b/c.txt",
      "/fuzz/a/b/c.txt",
    };
    CHECK(vfs.mkdir("/fuzz/a/b", true));
    CHECK(vfs.write_text("/fuzz/a/b/c.txt", "ok"));
    CHECK(vfs.read_text(nasty[1]).has_value());
    CHECK(*vfs.read_text(nasty[1]) == "ok");
  }

  if (fails) {
    std::cerr << fails << " failure(s)\n";
    return 1;
  }
  std::cout << "vfs_test OK\n";
  return 0;
}
