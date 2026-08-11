#pragma once

#include "bn/process.hpp"

namespace bn {

void register_node_command(Kernel& kernel);
void register_core_commands(Kernel& kernel);  // echo, cat, ls, ...

}  // namespace bn
