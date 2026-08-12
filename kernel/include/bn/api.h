#pragma once

#include "bn/process.hpp"

#include <cstddef>
#include <cstdint>

// Stable C ABI for Emscripten / TypeScript host
extern "C" {

typedef struct BNKernel BNKernel;

BNKernel* bn_kernel_create(void);
void bn_kernel_destroy(BNKernel* k);

// VFS
int bn_vfs_mkdir(BNKernel* k, const char* path, int recursive);
int bn_vfs_write_text(BNKernel* k, const char* path, const char* text);
int bn_vfs_write_bytes(BNKernel* k, const char* path, const uint8_t* data, size_t len);
char* bn_vfs_read_text(BNKernel* k, const char* path);  // malloc'd; free with bn_free
/** malloc'd bytes; *out_len set; free with bn_free. NULL if missing. */
uint8_t* bn_vfs_read_bytes(BNKernel* k, const char* path, size_t* out_len);
int bn_vfs_unlink(BNKernel* k, const char* path);
int bn_vfs_rmdir(BNKernel* k, const char* path);
int bn_vfs_rename(BNKernel* k, const char* from, const char* to);
char* bn_vfs_readdir_json(BNKernel* k, const char* path);  // ["a","b"]
int bn_vfs_exists(BNKernel* k, const char* path);
int bn_vfs_stat_json(BNKernel* k, const char* path, char** out_json);
/** lstat: do not follow final symlink */
int bn_vfs_lstat_json(BNKernel* k, const char* path, char** out_json);
int bn_vfs_symlink(BNKernel* k, const char* target, const char* linkpath);
char* bn_vfs_readlink(BNKernel* k, const char* path);  // malloc'd; free with bn_free
int bn_vfs_chmod(BNKernel* k, const char* path, unsigned mode);
int bn_vfs_utimes(BNKernel* k, const char* path, double atime_ms, double mtime_ms);

// Process — env_json is optional JSON object {"KEY":"VAL"} (may be null or "{}")
int bn_spawn(BNKernel* k, const char* cmd, const char* argv_json, const char* cwd, const char* env_json);
int bn_wait(BNKernel* k, int pid);           // -1 if running, else exit code
int bn_kill(BNKernel* k, int pid);
/** Fire due timers / reap idle keep-alive. now_ms <= 0 uses wall clock. */
int bn_pump(BNKernel* k, double now_ms);
int bn_vfs_extract_tar(BNKernel* k, const uint8_t* data, size_t len, const char* dest_dir);
/** Current VFS file-byte usage (not a malloc'd string). */
double bn_vfs_usage(BNKernel* k);
int bn_read_stdout(BNKernel* k, int pid, uint8_t* buf, int buflen);
int bn_read_stderr(BNKernel* k, int pid, uint8_t* buf, int buflen);
int bn_write_stdin(BNKernel* k, int pid, const uint8_t* buf, int buflen);

// Keep-alive HTTP dispatch (JSON response: {status,headers,body}); malloc'd string
char* bn_http_dispatch(BNKernel* k, int port, const char* method, const char* path,
                       const char* headers_json, const char* body);

// Register built-in commands (node). Call once after create.
void bn_register_builtins(BNKernel* k);

void bn_free(void* p);

}  // extern "C"
