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
  std::string cmd;
  std::vector<std::string> argv;
  std::unordered_map<std::string, std::string> env;
  std::string cwd{"/"};
  ProcessState state{ProcessState::Starting};
  int exit_code{-1};
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
            std::string cwd = "/");

  bool kill(Pid pid, int signal = 15);
  std::shared_ptr<Process> get(Pid pid);
  std::optional<int> wait(Pid pid);  // non-blocking: nullopt if still running

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
};

}  // namespace bn
