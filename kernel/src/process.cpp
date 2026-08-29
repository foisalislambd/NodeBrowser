#include "bn/process.hpp"
#include "bn/node_runner.hpp"

#include <chrono>
#include <cstring>
#include <unordered_map>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

namespace bn {

size_t PipeBuffer::write(const uint8_t* buf, size_t n) {
  if (closed) return 0;
  size_t room = kMax > data.size() ? kMax - data.size() : 0;
  size_t w = n < room ? n : room;
  data.insert(data.end(), buf, buf + w);
  return w;
}

size_t PipeBuffer::read(uint8_t* buf, size_t n) {
  size_t r = n < data.size() ? n : data.size();
  for (size_t i = 0; i < r; ++i) {
    buf[i] = data.front();
    data.pop_front();
  }
  return r;
}

std::string PipeBuffer::read_all_string() {
  std::string s(data.begin(), data.end());
  data.clear();
  return s;
}

Kernel::Kernel() = default;

void Kernel::register_command(std::string name, CommandHandler handler) {
  std::lock_guard lock(mu_);
  commands_[std::move(name)] = std::move(handler);
}

static std::string spawn_join(const std::string& cwd, const std::string& rel) {
  if (!rel.empty() && rel.front() == '/') return rel;
  if (cwd.empty() || cwd == "/") return "/" + rel;
  if (cwd.back() == '/') return cwd + rel;
  return cwd + "/" + rel;
}

Pid Kernel::spawn(std::string cmd,
                  std::vector<std::string> argv,
                  std::unordered_map<std::string, std::string> env,
                  std::string cwd,
                  Pid parent_pid) {
  CommandHandler handler;
  {
    std::lock_guard lock(mu_);
    auto it = commands_.find(cmd);
    if (it != commands_.end()) handler = it->second;
  }
  if (!handler) {
    std::string candidate;
    if (cmd.find('/') != std::string::npos) {
      candidate = spawn_join(cwd, cmd);
    } else {
      candidate = spawn_join(cwd, "node_modules/.bin/" + cmd);
    }
    auto st = vfs_.stat(candidate, true);
    if (st && st->kind == NodeKind::File) {
      argv.insert(argv.begin(), candidate);
      cmd = "node";
      std::lock_guard lock(mu_);
      auto it = commands_.find("node");
      if (it != commands_.end()) handler = it->second;
    }
  }
  if (!handler) {
    std::lock_guard lock(mu_);
    auto proc = std::make_shared<Process>();
    proc->pid = next_pid_++;
    proc->parent_pid = parent_pid;
    proc->cmd = cmd;
    proc->argv = std::move(argv);
    proc->env = std::move(env);
    proc->cwd = std::move(cwd);
    proc->state = ProcessState::Exited;
    proc->exit_code = 127;
    std::string msg = "browsernode: command not found: " + cmd + "\n";
    proc->stderr_buf.write(reinterpret_cast<const uint8_t*>(msg.data()), msg.size());
    procs_[proc->pid] = proc;
    return proc->pid;
  }

  auto proc = std::make_shared<Process>();
  proc->pid = next_pid_++;
  proc->parent_pid = parent_pid;
  proc->cmd = std::move(cmd);
  proc->argv = std::move(argv);
  proc->env = std::move(env);
  proc->cwd = std::move(cwd);
  proc->state = ProcessState::Running;
  {
    std::lock_guard lock(mu_);
    procs_[proc->pid] = proc;
  }

  // Run handler synchronously for MVP (Asyncify / worker later)
  int code = 127;
  try {
    code = handler(*this, *proc);
  } catch (const std::exception& e) {
    std::string msg = std::string("browsernode: exception: ") + e.what() + "\n";
    proc->stderr_buf.write(reinterpret_cast<const uint8_t*>(msg.data()), msg.size());
    code = 1;
  }
  // Keep-alive servers (http.listen) stay Running until kill/exit
  if (proc->keep_alive || code == -1) {
    proc->state = ProcessState::Running;
    proc->exit_code = -1;
    proc->keep_alive = true;
    return proc->pid;
  }
  proc->state = ProcessState::Exited;
  proc->exit_code = code;
  proc->stdout_buf.closed = true;
  proc->stderr_buf.closed = true;
  return proc->pid;
}

bool Kernel::kill(Pid pid, int /*signal*/) {
  bool ok = false;
  {
    std::lock_guard lock(mu_);
    auto it = procs_.find(pid);
    if (it == procs_.end()) return false;
    if (it->second->state == ProcessState::Running) {
      it->second->keep_alive = false;
      it->second->state = ProcessState::Killed;
      it->second->exit_code = 137;
      it->second->stdout_buf.closed = true;
      it->second->stderr_buf.closed = true;
    }
    for (auto lit = listeners_.begin(); lit != listeners_.end();) {
      if (lit->second == pid) lit = listeners_.erase(lit);
      else ++lit;
    }
    for (auto& t : timers_) {
      if (t.pid == pid) t.cancelled = true;
    }
    ok = true;
  }
  release_retained_http_for_pid(pid);
  release_retained_js_for_pid(pid);
  return ok;
}

int Kernel::kill_tree(Pid root, int signal) {
  if (root <= 0) return 0;
  std::vector<Pid> order;
  {
    std::lock_guard lock(mu_);
    std::vector<Pid> stack{root};
    std::unordered_map<Pid, bool> seen;
    while (!stack.empty()) {
      Pid p = stack.back();
      stack.pop_back();
      if (seen[p]) continue;
      seen[p] = true;
      for (const auto& kv : procs_) {
        if (kv.second && kv.second->parent_pid == p) stack.push_back(kv.first);
      }
      order.push_back(p);
    }
  }
  int n = 0;
  for (auto it = order.rbegin(); it != order.rend(); ++it) {
    if (kill(*it, signal)) ++n;
  }
  return n;
}

std::shared_ptr<Process> Kernel::get(Pid pid) {
  std::lock_guard lock(mu_);
  auto it = procs_.find(pid);
  if (it == procs_.end()) return nullptr;
  return it->second;
}

std::optional<int> Kernel::wait(Pid pid) {
  pump(0);
  auto p = get(pid);
  if (!p) return 127;
  if (p->state == ProcessState::Running) return std::nullopt;
  return p->exit_code;
}

int Kernel::timer_start(Pid pid, int32_t delay_ms, bool interval) {
  if (delay_ms < 0) delay_ms = 0;
  int64_t now = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::steady_clock::now().time_since_epoch())
                    .count();
  std::lock_guard lock(mu_);
  Timer t;
  t.id = next_timer_++;
  t.pid = pid;
  t.due_ms = now + delay_ms;
  t.interval_ms = delay_ms;
  t.interval = interval;
  timers_.push_back(t);
  return t.id;
}

void Kernel::timer_clear(int id) {
  std::lock_guard lock(mu_);
  for (auto& t : timers_) {
    if (t.id == id) t.cancelled = true;
  }
}

bool Kernel::has_timers(Pid pid) const {
  std::lock_guard lock(mu_);
  for (const auto& t : timers_) {
    if (!t.cancelled && t.pid == pid) return true;
  }
  return false;
}

bool Kernel::has_running_children(Pid pid) const {
  std::lock_guard lock(mu_);
  for (const auto& kv : procs_) {
    if (kv.second && kv.second->parent_pid == pid && kv.second->state == ProcessState::Running) {
      return true;
    }
  }
  return false;
}

void Kernel::complete(Pid pid, int exit_code) {
  std::lock_guard lock(mu_);
  auto it = procs_.find(pid);
  if (it == procs_.end() || !it->second) return;
  it->second->keep_alive = false;
  it->second->state = ProcessState::Exited;
  it->second->exit_code = exit_code;
  it->second->stdout_buf.closed = true;
  it->second->stderr_buf.closed = true;
  for (auto& t : timers_) {
    if (t.pid == pid) t.cancelled = true;
  }
  for (auto lit = listeners_.begin(); lit != listeners_.end();) {
    if (lit->second == pid) lit = listeners_.erase(lit);
    else ++lit;
  }
}

void Kernel::forward_child_stdio() {
  struct Pair {
    Pid child;
    Pid parent;
  };
  std::vector<Pair> pairs;
  {
    std::lock_guard lock(mu_);
    for (const auto& kv : procs_) {
      auto& child = kv.second;
      if (!child || child->parent_pid <= 0) continue;
      auto pit = procs_.find(child->parent_pid);
      if (pit == procs_.end() || !pit->second) continue;
      const auto& pcmd = pit->second->cmd;
      // Only live keep-alive children of a shell. Draining exited `echo` here
      // races sh redirection (`echo hi > file`) which reads the child's stdout.
      if (pcmd != "sh" && pcmd != "bash") continue;
      if (child->state != ProcessState::Running || !child->keep_alive) continue;
      pairs.push_back({child->pid, child->parent_pid});
    }
  }
  for (const auto& pr : pairs) {
    auto child = get(pr.child);
    auto parent = get(pr.parent);
    if (!child || !parent) continue;
    auto out = child->stdout_buf.read_all_string();
    if (!out.empty()) {
      parent->stdout_buf.write(reinterpret_cast<const uint8_t*>(out.data()), out.size());
    }
    auto err = child->stderr_buf.read_all_string();
    if (!err.empty()) {
      parent->stderr_buf.write(reinterpret_cast<const uint8_t*>(err.data()), err.size());
    }
  }
}

int Kernel::pump(int64_t now_ms) {
  if (pumping_) return 0;
  pumping_ = true;
  struct PumpGuard {
    bool* flag;
    ~PumpGuard() { *flag = false; }
  } guard{&pumping_};

  forward_child_stdio();

  if (now_ms <= 0) {
    now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                 std::chrono::steady_clock::now().time_since_epoch())
                 .count();
  }
  struct Due {
    Pid pid;
    int id;
    bool interval;
  };
  std::vector<Due> due;
  {
    std::lock_guard lock(mu_);
    for (auto& t : timers_) {
      if (t.cancelled) continue;
      if (t.due_ms > now_ms) continue;
      due.push_back({t.pid, t.id, t.interval});
      if (t.interval) t.due_ms = now_ms + (t.interval_ms > 0 ? t.interval_ms : 1);
      else t.cancelled = true;
    }
  }
  int n = 0;
  for (const auto& d : due) {
    if (timer_fire_) timer_fire_(d.pid, d.id, d.interval);
    auto p = get(d.pid);
    if (p && p->state != ProcessState::Running) {
      release_retained_http_for_pid(d.pid);
      release_retained_js_for_pid(d.pid);
    }
    ++n;
  }
  std::vector<Pid> idle;
  {
    std::lock_guard lock(mu_);
    for (const auto& kv : procs_) {
      auto& p = kv.second;
      if (!p || p->state != ProcessState::Running || !p->keep_alive) continue;
      if (p->cmd != "sh" && p->cmd != "bash" && p->cmd != "node" && p->cmd != "sleep") continue;
      bool http = false;
      for (const auto& l : listeners_) {
        if (l.second == p->pid) {
          http = true;
          break;
        }
      }
      bool timers = false;
      for (const auto& t : timers_) {
        if (!t.cancelled && t.pid == p->pid) {
          timers = true;
          break;
        }
      }
      bool kids = false;
      for (const auto& c : procs_) {
        if (c.second && c.second->parent_pid == p->pid && c.second->state == ProcessState::Running) {
          kids = true;
          break;
        }
      }
      if (!http && !timers && !kids) idle.push_back(p->pid);
    }
  }
  for (Pid pid : idle) {
    auto p = get(pid);
    if (!p) continue;
    complete(pid, p->complete_code);
    release_retained_http_for_pid(pid);
    release_retained_js_for_pid(pid);
  }
  return n;
}

size_t Kernel::write_stdin(Pid pid, const uint8_t* data, size_t n) {
  auto p = get(pid);
  if (!p) return 0;
  return p->stdin_buf.write(data, n);
}

size_t Kernel::write_stdout(Pid pid, const uint8_t* data, size_t n) {
  auto p = get(pid);
  if (!p || !data || !n) return 0;
  return p->stdout_buf.write(data, n);
}

size_t Kernel::write_stderr(Pid pid, const uint8_t* data, size_t n) {
  auto p = get(pid);
  if (!p || !data || !n) return 0;
  return p->stderr_buf.write(data, n);
}

size_t Kernel::read_stdout(Pid pid, uint8_t* data, size_t n) {
  auto p = get(pid);
  if (!p) return 0;
  return p->stdout_buf.read(data, n);
}

size_t Kernel::read_stderr(Pid pid, uint8_t* data, size_t n) {
  auto p = get(pid);
  if (!p) return 0;
  return p->stderr_buf.read(data, n);
}

void Kernel::register_server(Pid pid, int port) {
  std::lock_guard lock(mu_);
  listeners_[port] = pid;
}

void Kernel::unregister_server(Pid pid, int port) {
  std::lock_guard lock(mu_);
  auto it = listeners_.find(port);
  if (it != listeners_.end() && it->second == pid) listeners_.erase(it);
}

std::optional<Pid> Kernel::server_owner(int port) const {
  std::lock_guard lock(mu_);
  auto it = listeners_.find(port);
  if (it == listeners_.end()) return std::nullopt;
  return it->second;
}

void Kernel::notify_server_ready(Pid pid, int port) {
  register_server(pid, port);
  if (server_ready_) server_ready_(pid, port);
#ifdef __EMSCRIPTEN__
  EM_ASM({
    if (typeof globalThis.__bn_on_server_ready === 'function') {
      globalThis.__bn_on_server_ready($0);
    }
  }, port);
#endif
}

}  // namespace bn
