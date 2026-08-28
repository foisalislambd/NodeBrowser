cmake_minimum_required(VERSION 3.20)
project(browsernode VERSION 1.2.5 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)

option(BN_BUILD_NATIVE_TESTS "Build native (non-WASM) kernel tests" ON)
option(BN_BUILD_WASM "Build WASM kernel with Emscripten" OFF)
option(BN_WITH_QUICKJS "Link QuickJS engine" ON)

enable_testing()

add_subdirectory(kernel)

if(BN_WITH_QUICKJS)
  add_subdirectory(vendor)
endif()
