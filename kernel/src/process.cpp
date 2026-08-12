#include "bn/process.hpp"
#include "bn/node_runner.hpp"

#include <cstring>

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
                  std::string cwd) {
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
    ok = true;
  }
  release_retained_http_for_pid(pid);
  return ok;
}

std::shared_ptr<Process> Kernel::get(Pid pid) {
  std::lock_guard lock(mu_);
  auto it = procs_.find(pid);
  if (it == procs_.end()) return nullptr;
  return it->second;
}

std::optional<int> Kernel::wait(Pid pid) {
  auto p = get(pid);
  if (!p) return 127;
  if (p->state == ProcessState::Running) return std::nullopt;
  return p->exit_code;
}

size_t Kernel::write_stdin(Pid pid, const uint8_t* data, size_t n) {
  auto p = get(pid);
  if (!p) return 0;
  return p->stdin_buf.write(data, n);
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
