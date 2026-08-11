#include "bn/api.h"

#include "bn/node_runner.hpp"
#include "bn/process.hpp"

#include <cstdlib>
#include <cstring>
#include <sstream>
#include <string>
#include <vector>

struct BNKernel {
  bn::Kernel kernel;
};

extern "C" {

BNKernel* bn_kernel_create(void) {
  return new BNKernel();
}

void bn_kernel_destroy(BNKernel* k) {
  delete k;
}

void bn_free(void* p) {
  std::free(p);
}

static char* dup_cstr(const std::string& s) {
  char* p = static_cast<char*>(std::malloc(s.size() + 1));
  if (!p) return nullptr;
  std::memcpy(p, s.c_str(), s.size() + 1);
  return p;
}

int bn_vfs_mkdir(BNKernel* k, const char* path, int recursive) {
  if (!k || !path) return 0;
  return k->kernel.vfs().mkdir(path, recursive != 0) ? 1 : 0;
}

int bn_vfs_write_text(BNKernel* k, const char* path, const char* text) {
  if (!k || !path || !text) return 0;
  return k->kernel.vfs().write_text(path, text, true) ? 1 : 0;
}

int bn_vfs_write_bytes(BNKernel* k, const char* path, const uint8_t* data, size_t len) {
  if (!k || !path || (!data && len)) return 0;
  std::vector<uint8_t> buf(data, data + len);
  return k->kernel.vfs().write_file(path, std::move(buf), true) ? 1 : 0;
}

char* bn_vfs_read_text(BNKernel* k, const char* path) {
  if (!k || !path) return nullptr;
  auto t = k->kernel.vfs().read_text(path);
  if (!t) return nullptr;
  return dup_cstr(*t);
}

int bn_vfs_unlink(BNKernel* k, const char* path) {
  if (!k || !path) return 0;
  return k->kernel.vfs().unlink(path) ? 1 : 0;
}

char* bn_vfs_readdir_json(BNKernel* k, const char* path) {
  if (!k || !path) return nullptr;
  auto entries = k->kernel.vfs().readdir(path);
  if (!entries) return nullptr;
  std::ostringstream oss;
  oss << '[';
  for (size_t i = 0; i < entries->size(); ++i) {
    if (i) oss << ',';
    oss << '"';
    for (char c : (*entries)[i]) {
      if (c == '"' || c == '\\') oss << '\\';
      oss << c;
    }
    oss << '"';
  }
  oss << ']';
  return dup_cstr(oss.str());
}

int bn_vfs_exists(BNKernel* k, const char* path) {
  if (!k || !path) return 0;
  return k->kernel.vfs().exists(path) ? 1 : 0;
}

int bn_vfs_stat_json(BNKernel* k, const char* path, char** out_json) {
  if (!k || !path || !out_json) return 0;
  auto st = k->kernel.vfs().stat(path);
  if (!st) return 0;
  const char* kind = "file";
  if (st->kind == bn::NodeKind::Directory) kind = "directory";
  else if (st->kind == bn::NodeKind::Symlink) kind = "symlink";
  std::ostringstream oss;
  oss << "{\"kind\":\"" << kind << "\",\"size\":" << st->size
      << ",\"mtimeMs\":" << st->mtime_ms << ",\"mode\":" << st->mode << '}';
  *out_json = dup_cstr(oss.str());
  return 1;
}

// Minimal JSON string array parser: ["a","b"]
static std::vector<std::string> parse_json_string_array(const char* json) {
  std::vector<std::string> out;
  if (!json) return out;
  const char* p = json;
  while (*p && *p != '[') ++p;
  if (*p != '[') return out;
  ++p;
  while (*p) {
    while (*p && (*p == ' ' || *p == ',' || *p == '\n' || *p == '\t')) ++p;
    if (*p == ']') break;
    if (*p != '"') break;
    ++p;
    std::string s;
    while (*p && *p != '"') {
      if (*p == '\\' && p[1]) {
        ++p;
        s.push_back(*p++);
      } else {
        s.push_back(*p++);
      }
    }
    if (*p == '"') ++p;
    out.push_back(std::move(s));
  }
  return out;
}

int bn_spawn(BNKernel* k, const char* cmd, const char* argv_json, const char* cwd) {
  if (!k || !cmd) return -1;
  auto argv = parse_json_string_array(argv_json);
  return k->kernel.spawn(cmd, std::move(argv), {}, cwd ? cwd : "/");
}

int bn_wait(BNKernel* k, int pid) {
  if (!k) return 127;
  auto code = k->kernel.wait(pid);
  if (!code) return -1;
  return *code;
}

int bn_kill(BNKernel* k, int pid) {
  if (!k) return 0;
  return k->kernel.kill(pid) ? 1 : 0;
}

int bn_read_stdout(BNKernel* k, int pid, uint8_t* buf, int buflen) {
  if (!k || !buf || buflen <= 0) return 0;
  return static_cast<int>(k->kernel.read_stdout(pid, buf, static_cast<size_t>(buflen)));
}

int bn_read_stderr(BNKernel* k, int pid, uint8_t* buf, int buflen) {
  if (!k || !buf || buflen <= 0) return 0;
  return static_cast<int>(k->kernel.read_stderr(pid, buf, static_cast<size_t>(buflen)));
}

int bn_write_stdin(BNKernel* k, int pid, const uint8_t* buf, int buflen) {
  if (!k || !buf || buflen <= 0) return 0;
  return static_cast<int>(k->kernel.write_stdin(pid, buf, static_cast<size_t>(buflen)));
}

void bn_register_builtins(BNKernel* k) {
  if (!k) return;
  bn::register_node_command(k->kernel);
}

}  // extern "C"
