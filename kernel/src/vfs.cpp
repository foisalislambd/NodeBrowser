#include "bn/vfs.hpp"

#include <chrono>
#include <sstream>
#include <stdexcept>

namespace bn {
namespace {

int64_t now_ms() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

}  // namespace

// --- VfsFile ---

VfsFile::VfsFile(std::vector<uint8_t> data) : data_(std::move(data)), mtime_ms_(now_ms()) {}

Stat VfsFile::stat() const {
  return Stat{NodeKind::File, data_.size(), mtime_ms_, mode_};
}

void VfsFile::set_data(std::vector<uint8_t> d) {
  data_ = std::move(d);
  mtime_ms_ = now_ms();
}

void VfsFile::truncate(size_t n) {
  if (n < data_.size()) data_.resize(n);
  else data_.resize(n, 0);
  mtime_ms_ = now_ms();
}

// --- VfsDir ---

VfsDir::VfsDir() : mtime_ms_(now_ms()) {}

Stat VfsDir::stat() const {
  return Stat{NodeKind::Directory, 0, mtime_ms_, mode_};
}

bool VfsDir::has(std::string_view name) const {
  return children_.find(std::string(name)) != children_.end();
}

std::shared_ptr<VfsNode> VfsDir::get(std::string_view name) const {
  auto it = children_.find(std::string(name));
  if (it == children_.end()) return nullptr;
  return it->second;
}

void VfsDir::set(std::string name, std::shared_ptr<VfsNode> node) {
  children_[std::move(name)] = std::move(node);
  mtime_ms_ = now_ms();
}

bool VfsDir::erase(std::string_view name) {
  auto it = children_.find(std::string(name));
  if (it == children_.end()) return false;
  children_.erase(it);
  mtime_ms_ = now_ms();
  return true;
}

std::vector<std::string> VfsDir::entries() const {
  std::vector<std::string> out;
  out.reserve(children_.size());
  for (const auto& [k, _] : children_) out.push_back(k);
  return out;
}

// --- VfsSymlink ---

VfsSymlink::VfsSymlink(std::string target)
    : target_(std::move(target)), mtime_ms_(now_ms()) {}

Stat VfsSymlink::stat() const {
  return Stat{NodeKind::Symlink, target_.size(), mtime_ms_, 0777};
}

// --- Vfs ---

Vfs::Vfs() : root_(std::make_shared<VfsDir>()) {}

std::string Vfs::normalize(std::string_view path) {
  if (path.empty()) return "/";
  std::vector<std::string> parts;
  std::string cur;
  auto push = [&](std::string_view p) {
    if (p.empty() || p == ".") return;
    if (p == "..") {
      if (!parts.empty()) parts.pop_back();
      return;
    }
    parts.emplace_back(p);
  };

  bool abs = !path.empty() && path.front() == '/';
  for (char c : path) {
    if (c == '/') {
      push(cur);
      cur.clear();
    } else {
      cur.push_back(c);
    }
  }
  push(cur);

  std::string out = abs || parts.empty() ? "/" : "";
  for (size_t i = 0; i < parts.size(); ++i) {
    if (i || abs) out += "/";
    // For absolute we always start with /
    if (abs) {
      // rebuild absolute
    }
  }
  if (abs) {
    out = "/";
    for (size_t i = 0; i < parts.size(); ++i) {
      if (i) out += "/";
      out += parts[i];
    }
    if (parts.empty()) out = "/";
  } else {
    out.clear();
    for (size_t i = 0; i < parts.size(); ++i) {
      if (i) out += "/";
      out += parts[i];
    }
    if (out.empty()) out = ".";
  }
  return out;
}

std::vector<std::string> Vfs::split(std::string_view path) {
  auto n = normalize(path);
  std::vector<std::string> parts;
  std::string cur;
  for (char c : n) {
    if (c == '/') {
      if (!cur.empty()) {
        parts.push_back(cur);
        cur.clear();
      }
    } else {
      cur.push_back(c);
    }
  }
  if (!cur.empty()) parts.push_back(cur);
  return parts;
}

Vfs::ResolveResult Vfs::resolve(std::string_view path, bool follow_symlinks, int depth) const {
  if (depth > 32) return {};
  auto parts = split(path);
  auto dir = root_;
  if (parts.empty()) {
    return {nullptr, "", root_};
  }

  for (size_t i = 0; i + 1 < parts.size(); ++i) {
    auto child = dir->get(parts[i]);
    if (!child) return {dir, parts[i], nullptr};
    if (child->kind() == NodeKind::Symlink && follow_symlinks) {
      auto* sl = static_cast<VfsSymlink*>(child.get());
      auto target = sl->target();
      std::string next;
      if (!target.empty() && target.front() == '/') {
        next = target;
      } else {
        // relative to current dir path
        std::string prefix = "/";
        for (size_t j = 0; j < i; ++j) {
          if (j) prefix += "/";
          prefix += parts[j];
        }
        if (prefix == "/") next = "/" + target;
        else next = prefix + "/" + target;
      }
      // continue resolving remaining from symlink target + rest
      std::string rest = next;
      for (size_t j = i + 1; j < parts.size(); ++j) {
        rest += "/";
        rest += parts[j];
      }
      return resolve(rest, follow_symlinks, depth + 1);
    }
    if (child->kind() != NodeKind::Directory) return {dir, parts[i], nullptr};
    dir = std::static_pointer_cast<VfsDir>(child);
  }

  const auto& name = parts.back();
  auto node = dir->get(name);
  if (node && node->kind() == NodeKind::Symlink && follow_symlinks) {
    auto* sl = static_cast<VfsSymlink*>(node.get());
    auto target = sl->target();
    std::string next;
    if (!target.empty() && target.front() == '/') next = target;
    else {
      std::string prefix = "/";
      for (size_t j = 0; j + 1 < parts.size(); ++j) {
        if (j) prefix += "/";
        prefix += parts[j];
      }
      next = (prefix == "/" ? "/" + target : prefix + "/" + target);
    }
    return resolve(next, follow_symlinks, depth + 1);
  }
  return {dir, name, node};
}

bool Vfs::exists(std::string_view path) const {
  std::lock_guard lock(mu_);
  auto r = resolve(path, true);
  return r.node != nullptr || (r.parent == nullptr && r.node == root_);
}

std::optional<Stat> Vfs::stat(std::string_view path, bool follow_symlinks) const {
  std::lock_guard lock(mu_);
  auto r = resolve(path, follow_symlinks);
  if (!r.node) {
    if (normalize(path) == "/") return root_->stat();
    return std::nullopt;
  }
  return r.node->stat();
}

bool Vfs::mkdir(std::string_view path, bool recursive) {
  std::lock_guard lock(mu_);
  auto parts = split(path);
  if (parts.empty()) return true;
  auto dir = root_;
  for (size_t i = 0; i < parts.size(); ++i) {
    auto child = dir->get(parts[i]);
    if (!child) {
      if (!recursive && i + 1 != parts.size()) return false;
      auto nd = std::make_shared<VfsDir>();
      dir->set(parts[i], nd);
      dir = nd;
      continue;
    }
    if (child->kind() != NodeKind::Directory) return false;
    dir = std::static_pointer_cast<VfsDir>(child);
  }
  return true;
}

bool Vfs::write_file(std::string_view path, std::vector<uint8_t> data, bool create_parents) {
  auto parts = split(path);
  if (parts.empty()) return false;
  if (create_parents && parts.size() > 1) {
    std::string parent = "/";
    for (size_t i = 0; i + 1 < parts.size(); ++i) {
      if (i) parent += "/";
      parent += parts[i];
    }
    if (!mkdir(parent, true)) return false;
  }
  std::lock_guard lock(mu_);
  auto r = resolve(path, false);
  if (!r.parent) return false;
  if (r.node && r.node->kind() == NodeKind::Directory) return false;
  if (r.node && r.node->kind() == NodeKind::File) {
    static_cast<VfsFile*>(r.node.get())->set_data(std::move(data));
    return true;
  }
  r.parent->set(r.name, std::make_shared<VfsFile>(std::move(data)));
  return true;
}

bool Vfs::write_text(std::string_view path, std::string_view text, bool create_parents) {
  std::vector<uint8_t> data(text.begin(), text.end());
  return write_file(path, std::move(data), create_parents);
}

std::optional<std::vector<uint8_t>> Vfs::read_file(std::string_view path) const {
  std::lock_guard lock(mu_);
  auto r = resolve(path, true);
  if (!r.node || r.node->kind() != NodeKind::File) return std::nullopt;
  return static_cast<VfsFile*>(r.node.get())->data();
}

std::optional<std::string> Vfs::read_text(std::string_view path) const {
  auto d = read_file(path);
  if (!d) return std::nullopt;
  return std::string(d->begin(), d->end());
}

bool Vfs::unlink(std::string_view path) {
  std::lock_guard lock(mu_);
  auto r = resolve(path, false);
  if (!r.parent || !r.node) return false;
  if (r.node->kind() == NodeKind::Directory) return false;
  return r.parent->erase(r.name);
}

bool Vfs::rmdir(std::string_view path) {
  std::lock_guard lock(mu_);
  auto r = resolve(path, false);
  if (!r.parent || !r.node) return false;
  if (r.node->kind() != NodeKind::Directory) return false;
  auto* d = static_cast<VfsDir*>(r.node.get());
  if (!d->entries().empty()) return false;
  return r.parent->erase(r.name);
}

bool Vfs::rename(std::string_view from, std::string_view to) {
  std::lock_guard lock(mu_);
  auto a = resolve(from, false);
  if (!a.parent || !a.node) return false;
  auto node = a.node;
  if (!a.parent->erase(a.name)) return false;
  // unlock not possible easily; call internal path creation
  // Re-resolve destination parent
  auto parts = split(to);
  if (parts.empty()) return false;
  auto dir = root_;
  for (size_t i = 0; i + 1 < parts.size(); ++i) {
    auto child = dir->get(parts[i]);
    if (!child || child->kind() != NodeKind::Directory) return false;
    dir = std::static_pointer_cast<VfsDir>(child);
  }
  dir->set(parts.back(), node);
  return true;
}

std::optional<std::vector<std::string>> Vfs::readdir(std::string_view path) const {
  std::lock_guard lock(mu_);
  if (normalize(path) == "/") return root_->entries();
  auto r = resolve(path, true);
  if (!r.node || r.node->kind() != NodeKind::Directory) return std::nullopt;
  return static_cast<VfsDir*>(r.node.get())->entries();
}

bool Vfs::symlink(std::string_view target, std::string_view linkpath) {
  auto parts = split(linkpath);
  if (parts.empty()) return false;
  if (parts.size() > 1) {
    std::string parent = "/";
    for (size_t i = 0; i + 1 < parts.size(); ++i) {
      if (i) parent += "/";
      parent += parts[i];
    }
    if (!mkdir(parent, true)) return false;
  }
  std::lock_guard lock(mu_);
  auto r = resolve(linkpath, false);
  if (!r.parent) return false;
  r.parent->set(r.name, std::make_shared<VfsSymlink>(std::string(target)));
  return true;
}

void Vfs::mount_tree(const std::unordered_map<std::string, std::string>& files) {
  for (const auto& [path, contents] : files) {
    write_text(path, contents, true);
  }
}

void Vfs::clear() {
  std::lock_guard lock(mu_);
  root_ = std::make_shared<VfsDir>();
}

}  // namespace bn
