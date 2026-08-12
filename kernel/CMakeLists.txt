set(BN_KERNEL_SOURCES
  src/vfs.cpp
  src/process.cpp
  src/api.cpp
  src/node_runner.cpp
)

add_library(bn_kernel STATIC ${BN_KERNEL_SOURCES})
target_include_directories(bn_kernel PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

if(BN_WITH_QUICKJS)
  target_compile_definitions(bn_kernel PUBLIC BN_HAS_QUICKJS=1)
  target_link_libraries(bn_kernel PUBLIC quickjs)
endif()

if(BN_BUILD_NATIVE_TESTS)
  add_executable(bn_vfs_test tests/vfs_test.cpp)
  target_link_libraries(bn_vfs_test PRIVATE bn_kernel)

  add_executable(bn_node_test tests/node_test.cpp)
  target_link_libraries(bn_node_test PRIVATE bn_kernel)

  enable_testing()
  add_test(NAME vfs_test COMMAND bn_vfs_test)
  add_test(NAME node_test COMMAND bn_node_test)
endif()

if(BN_BUILD_WASM)
  if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "BN_BUILD_WASM requires Emscripten toolchain")
  endif()

  add_executable(browsernode_kernel src/wasm_main.cpp)
  target_link_libraries(browsernode_kernel PRIVATE bn_kernel)
  target_link_options(browsernode_kernel PRIVATE
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_NAME=createBrowserNodeKernel"
    "SHELL:-s EXPORT_ES6=1"
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','stringToUTF8','lengthBytesUTF8','HEAPU8','getValue','setValue']"
    "SHELL:-s EXPORTED_FUNCTIONS=['_main','_bn_kernel_create','_bn_kernel_destroy','_bn_vfs_mkdir','_bn_vfs_write_text','_bn_vfs_write_bytes','_bn_vfs_read_text','_bn_vfs_read_bytes','_bn_vfs_unlink','_bn_vfs_rmdir','_bn_vfs_rename','_bn_vfs_readdir_json','_bn_vfs_exists','_bn_vfs_stat_json','_bn_vfs_lstat_json','_bn_vfs_symlink','_bn_vfs_readlink','_bn_spawn','_bn_wait','_bn_kill','_bn_pump','_bn_vfs_extract_tar','_bn_vfs_usage','_bn_read_stdout','_bn_read_stderr','_bn_write_stdin','_bn_http_dispatch','_bn_register_builtins','_bn_free','_malloc','_free']"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    "SHELL:-s INITIAL_MEMORY=67108864"
    "SHELL:-s STACK_SIZE=4194304"
    "SHELL:-s ENVIRONMENT=web,worker,node"
    "SHELL:-s FILESYSTEM=0"
    "SHELL:-s INVOKE_RUN=0"
  )
  set_target_properties(browsernode_kernel PROPERTIES
    OUTPUT_NAME "browsernode_kernel"
    SUFFIX ".js"
  )
endif()
