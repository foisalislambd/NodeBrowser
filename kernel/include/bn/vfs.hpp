#pragma once

#include <cstdint>
#include <cstddef>
#include <string>
#include <string_view>
#include <vector>
#include <memory>
#include <unordered_map>
#include <optional>
#include <functional>
#include <mutex>

namespace bn {

enum class NodeKind : uint8_t { File, Directory, Symlink };

struct Stat {
  NodeKind kind{};
  uint64_t size{};
  int64_t mtime_ms{};
  uint32_t mode{0644};
};

class VfsNode {
public:
  virtual ~VfsNode() = default;
  virtual NodeKind kind() const = 0;
  virtual Stat stat() const = 0;
};

class VfsFile final : public VfsNode {
public:
  explicit VfsFile(std::vector<uint8_t> data = {});
  NodeKind kind() const override { return NodeKind::File; }
  Stat stat() const override;
  const std::vector<uint8_t>& data() const { return data_; }
  std::vector<uint8_t>& data() { return data_; }
  void set_data(std::vector<uint8_t> d);
  void truncate(size_t n);
  void set_mtime(int64_t ms) { mtime_ms_ = ms; }
  void set_mode(uint32_t mode) { mode_ = mode; }

private:
  std::vector<uint8_t> data_;
  int64_t mtime_ms_;
  uint32_t mode_{0644};
};

class VfsDir final : public VfsNode {
public:
  VfsDir();
  NodeKind kind() const override { return NodeKind::Directory; }
  Stat stat() const override;
  bool has(std::string_view name) const;
  std::shared_ptr<VfsNode> get(std::string_view name) const;
  void set(std::string name, std::shared_ptr<VfsNode> node);
  bool erase(std::string_view name);
  std::vector<std::string> entries() const;
  void set_mtime(int64_t ms) { mtime_ms_ = ms; }
  void set_mode(uint32_t mode) { mode_ = mode; }

private:
  std::unordered_map<std::string, std::shared_ptr<VfsNode>> children_;
  int64_t mtime_ms_;
  uint32_t mode_{0755};
};

class VfsSymlink final : public VfsNode {
public:
  explicit VfsSymlink(std::string target);
  NodeKind kind() const override { return NodeKind::Symlink; }
  Stat stat() const override;
  const std::string& target() const { return target_; }
  void set_mtime(int64_t ms) { mtime_ms_ = ms; }
  void set_mode(uint32_t mode) { mode_ = mode; }

private:
  std::string target_;
  int64_t mtime_ms_;
  uint32_t mode_{0777};
};

// In-memory POSIX-ish filesystem rooted at "/"
class Vfs {
public:
  Vfs();

  // Path helpers
  static std::string normalize(std::string_view path);
  static std::vector<std::string> split(std::string_view path);

  bool exists(std::string_view path) const;
  std::optional<Stat> stat(std::string_view path, bool follow_symlinks = true) const;

  bool mkdir(std::string_view path, bool recursive = false);
  bool write_file(std::string_view path, std::vector<uint8_t> data, bool create_parents = true);
  bool write_text(std::string_view path, std::string_view text, bool create_parents = true);
  std::optional<std::vector<uint8_t>> read_file(std::string_view path) const;
  std::optional<std::string> read_text(std::string_view path) const;
  bool unlink(std::string_view path);
  bool rmdir(std::string_view path);
  bool rename(std::string_view from, std::string_view to);
  std::optional<std::vector<std::string>> readdir(std::string_view path) const;
  bool symlink(std::string_view target, std::string_view linkpath);
  /** Read symlink target without following. */
  std::optional<std::string> readlink(std::string_view path) const;
  /** Set permission bits (stored on node; used by npm script heuristics). */
  bool chmod(std::string_view path, uint32_t mode);
  /** Set mtime (atime accepted for API parity; stored as mtime when distinct). */
  bool utimes(std::string_view path, int64_t atime_ms, int64_t mtime_ms);

  // Mount a JSON-like tree from host: path -> file contents
  void mount_tree(const std::unordered_map<std::string, std::string>& files);

  void clear();

private:
  struct ResolveResult {
    std::shared_ptr<VfsDir> parent;
    std::string name;
    std::shared_ptr<VfsNode> node; // may be null if missing
  };

  ResolveResult resolve(std::string_view path, bool follow_symlinks, int depth = 0) const;
  std::shared_ptr<VfsDir> root_;
  mutable std::mutex mu_;
};

}  // namespace bn
