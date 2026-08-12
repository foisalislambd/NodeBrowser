#include "bn/api.h"

#include "bn/node_runner.hpp"
#include "bn/process.hpp"

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

struct BNKernel {
  bn::Kernel kernel;
};

extern "C" {

BNKernel* bn_kernel_create(void) {
  return new BNKernel();
}

void bn_kernel_destroy(BNKernel* k) {
  if (k) {
    bn::release_all_retained_http();
    delete k;
  }
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

uint8_t* bn_vfs_read_bytes(BNKernel* k, const char* path, size_t* out_len) {
  if (out_len) *out_len = 0;
  if (!k || !path) return nullptr;
  auto data = k->kernel.vfs().read_file(path);
  if (!data) return nullptr;
  auto* buf = static_cast<uint8_t*>(std::malloc(data->size() ? data->size() : 1));
  if (!buf) return nullptr;
  if (!data->empty()) std::memcpy(buf, data->data(), data->size());
  if (out_len) *out_len = data->size();
  return buf;
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

int bn_vfs_lstat_json(BNKernel* k, const char* path, char** out_json) {
  if (!k || !path || !out_json) return 0;
  auto st = k->kernel.vfs().stat(path, false);
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

int bn_vfs_symlink(BNKernel* k, const char* target, const char* linkpath) {
  if (!k || !target || !linkpath) return 0;
  return k->kernel.vfs().symlink(target, linkpath) ? 1 : 0;
}

char* bn_vfs_readlink(BNKernel* k, const char* path) {
  if (!k || !path) return nullptr;
  auto t = k->kernel.vfs().readlink(path);
  if (!t) return nullptr;
  return dup_cstr(*t);
}

int bn_vfs_chmod(BNKernel* k, const char* path, unsigned mode) {
  if (!k || !path) return 0;
  return k->kernel.vfs().chmod(path, mode) ? 1 : 0;
}

int bn_vfs_utimes(BNKernel* k, const char* path, double atime_ms, double mtime_ms) {
  if (!k || !path) return 0;
  return k->kernel.vfs().utimes(path, static_cast<int64_t>(atime_ms), static_cast<int64_t>(mtime_ms)) ? 1 : 0;
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

// Minimal JSON object parser for string values: {"a":"b","c":"d"}
static std::unordered_map<std::string, std::string> parse_json_string_object(const char* json) {
  std::unordered_map<std::string, std::string> out;
  if (!json) return out;
  const char* p = json;
  while (*p && *p != '{') ++p;
  if (*p != '{') return out;
  ++p;
  auto read_str = [&](std::string& s) -> bool {
    while (*p && (*p == ' ' || *p == '\n' || *p == '\t')) ++p;
    if (*p != '"') return false;
    ++p;
    s.clear();
    while (*p && *p != '"') {
      if (*p == '\\' && p[1]) {
        ++p;
        s.push_back(*p++);
      } else {
        s.push_back(*p++);
      }
    }
    if (*p != '"') return false;
    ++p;
    return true;
  };
  while (*p) {
    while (*p && (*p == ' ' || *p == ',' || *p == '\n' || *p == '\t')) ++p;
    if (*p == '}') break;
    std::string key, val;
    if (!read_str(key)) break;
    while (*p && (*p == ' ' || *p == '\n' || *p == '\t')) ++p;
    if (*p != ':') break;
    ++p;
    if (!read_str(val)) break;
    out.emplace(std::move(key), std::move(val));
  }
  return out;
}

int bn_spawn(BNKernel* k, const char* cmd, const char* argv_json, const char* cwd, const char* env_json) {
  if (!k || !cmd) return -1;
  auto argv = parse_json_string_array(argv_json);
  auto env = parse_json_string_object(env_json);
  return k->kernel.spawn(cmd, std::move(argv), std::move(env), cwd ? cwd : "/");
}

char* bn_http_dispatch(BNKernel* k, int port, const char* method, const char* path,
                       const char* headers_json, const char* body) {
  if (!k) return nullptr;
  auto json = bn::http_dispatch_json(port, method, path, headers_json, body);
  if (json.empty()) {
#ifdef __EMSCRIPTEN__
    // Fallback: host bridge table (populated by NodeBrowser.#wireHttp)
    char* result = (char*)EM_ASM_PTR({
      try {
        if (typeof globalThis.__bn_wasm_http_dispatch !== 'function') return 0;
        var method = UTF8ToString($0);
        var path = UTF8ToString($1);
        var headers = UTF8ToString($2);
        var body = UTF8ToString($3);
        var port = $4;
        var out = globalThis.__bn_wasm_http_dispatch(port, method, path, headers, body);
        if (out == null) return 0;
        var s = String(out);
        var len = lengthBytesUTF8(s) + 1;
        var ptr = _malloc(len);
        stringToUTF8(s, ptr, len);
        return ptr;
      } catch (e) {
        return 0;
      }
    }, method ? method : "", path ? path : "/", headers_json ? headers_json : "{}", body ? body : "", port);
    return result;
#else
    return nullptr;
#endif
  }
  return dup_cstr(json);
}

int bn_wait(BNKernel* k, int pid) {
  if (!k) return 127;
  auto code = k->kernel.wait(pid);
  if (!code) return -1;
  return *code;
}

int bn_pump(BNKernel* k, double now_ms) {
  if (!k) return 0;
  return k->kernel.pump(static_cast<int64_t>(now_ms));
}

int bn_vfs_extract_tar(BNKernel* k, const uint8_t* data, size_t len, const char* dest_dir) {
  if (!k || !data) return 0;
  return k->kernel.vfs().extract_tar(data, len, dest_dir ? dest_dir : "/");
}

double bn_vfs_usage(BNKernel* k) {
  if (!k) return 0;
  return static_cast<double>(k->kernel.vfs().usage_bytes());
}

int bn_kill(BNKernel* k, int pid) {
  if (!k) return 0;
  return k->kernel.kill_tree(pid) > 0 ? 1 : 0;
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
