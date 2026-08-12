#pragma once

#include "bn/process.hpp"

#include <string>

namespace bn {

void register_node_command(Kernel& kernel);
void register_core_commands(Kernel& kernel);  // echo, cat, ls, ...

/** Invoke retained QuickJS HTTP handler; returns JSON {status,headers,body} or empty. */
std::string http_dispatch_json(int port, const char* method, const char* path,
                               const char* headers_json, const char* body);

void release_retained_http_port(int port);
void release_retained_http_for_pid(Pid pid);
void release_all_retained_http();
void invoke_guest_timer(Pid pid, int timer_id, bool interval);
void release_retained_js_for_pid(Pid pid);

}  // namespace bn
