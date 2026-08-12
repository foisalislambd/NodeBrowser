#pragma once

#include "bn/vfs.hpp"

#include <atomic>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace bn {

using Pid = int32_t;

struct PipeBuffer {
  std::deque<uint8_t> data;
  bool closed{false};
  static constexpr size_t kMax = 1 << 20;  // 1 MiB

  size_t write(const uint8_t* buf, size_t n);
  size_t read(uint8_t* buf, size_t n);
  std::string read_all_string();
};

enum class ProcessState : uint8_t { Starting, Running, Exited, Killed };

struct Process {
  Pid pid{};
  Pid parent_pid{0};
  std::string cmd;
  std::vector<std::string> argv;
  std::unordered_map<std::string, std::string> env;
  std::string cwd{"/"};
  ProcessState state{ProcessState::Starting};
  int exit_code{-1};
  bool keep_alive{false};  // set by http.listen / timers / child wait
  int complete_code{0};    // JS/shell exit to apply when event loop drains
  PipeBuffer stdin_buf;
  PipeBuffer stdout_buf;
  PipeBuffer stderr_buf;
};

class Kernel;

// Pluggable command handlers (node, npm, ...)
using CommandHandler = std::function<int(Kernel&, Process&)>;

class Kernel {
public:
  Kernel();

  Vfs& vfs() { return vfs_; }
  const Vfs& vfs() const { return vfs_; }

  void register_command(std::string name, CommandHandler handler);

  Pid spawn(std::string cmd,
            std::vector<std::string> argv,
            std::unordered_map<std::string, std::string> env = {},
            std::string cwd = "/",
            Pid parent_pid = 0);

  bool kill(Pid pid, int signal = 15);
  /** Kill pid and every descendant (parent_pid chain). */
  int kill_tree(Pid pid, int signal = 15);
  std::shared_ptr<Process> get(Pid pid);
  std::optional<int> wait(Pid pid);  // non-blocking: nullopt if still running

  int timer_start(Pid pid, int32_t delay_ms, bool interval);
  void timer_clear(int id);
  bool has_timers(Pid pid) const;
  bool has_running_children(Pid pid) const;
  /** Fire due timers + reap keep-alive shells/nodes with an empty event loop. */
  int pump(int64_t now_ms);

  using TimerFireCb = std::function<void(Pid, int /*timer_id*/, bool /*interval*/)>;
  void on_timer_fire(TimerFireCb cb) { timer_fire_ = std::move(cb); }

  void complete(Pid pid, int exit_code);

  // stdio helpers for host
  size_t write_stdin(Pid pid, const uint8_t* data, size_t n);
  size_t read_stdout(Pid pid, uint8_t* data, size_t n);
  size_t read_stderr(Pid pid, uint8_t* data, size_t n);

  // Virtual HTTP servers
  void register_server(Pid pid, int port);
  void unregister_server(Pid pid, int port);
  std::optional<Pid> server_owner(int port) const;

  using ServerReadyCb = std::function<void(Pid, int /*port*/)>;
  void on_server_ready(ServerReadyCb cb) { server_ready_ = std::move(cb); }

  void notify_server_ready(Pid pid, int port);

private:
  Vfs vfs_;
  mutable std::mutex mu_;
  std::atomic<Pid> next_pid_{1};
  std::unordered_map<Pid, std::shared_ptr<Process>> procs_;
  std::unordered_map<std::string, CommandHandler> commands_;
  std::unordered_map<int, Pid> listeners_;  // port -> pid
  ServerReadyCb server_ready_;
  TimerFireCb timer_fire_;
  struct Timer {
    int id{};
    Pid pid{};
    int64_t due_ms{};
    int32_t interval_ms{};
    bool interval{false};
    bool cancelled{false};
  };
  int next_timer_{1};
  std::vector<Timer> timers_;
  bool pumping_{false};
};

}  // namespace bn
