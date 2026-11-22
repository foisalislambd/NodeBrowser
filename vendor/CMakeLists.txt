# BrowserNode vendor deps
# QuickJS lives in vendor/quickjs as a Git submodule:
#   git submodule update --init --recursive

set(QUICKJS_DIR ${CMAKE_CURRENT_SOURCE_DIR}/quickjs)

if(NOT EXISTS "${QUICKJS_DIR}/quickjs.c")
  message(FATAL_ERROR
    "QuickJS submodule missing at ${QUICKJS_DIR}.\n"
    "Run:  git submodule update --init --recursive")
endif()

# Core engine only (no quickjs-libc — BrowserNode supplies host I/O)
set(QUICKJS_SOURCES
  ${QUICKJS_DIR}/quickjs.c
  ${QUICKJS_DIR}/libregexp.c
  ${QUICKJS_DIR}/libunicode.c
  ${QUICKJS_DIR}/cutils.c
)
if(EXISTS "${QUICKJS_DIR}/dtoa.c")
  list(APPEND QUICKJS_SOURCES ${QUICKJS_DIR}/dtoa.c)
endif()

add_library(quickjs STATIC ${QUICKJS_SOURCES})

# Public includes go through qjs-inc so the QuickJS repo root (which contains a
# file named "version") is not on the -I path. libc++ #include <version> otherwise
# picks up that file and the C++ build fails.
target_include_directories(quickjs PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/qjs-inc)

set(BN_QJS_VERSION "unknown")
if(EXISTS "${QUICKJS_DIR}/VERSION")
  file(READ "${QUICKJS_DIR}/VERSION" BN_QJS_VERSION)
  string(STRIP "${BN_QJS_VERSION}" BN_QJS_VERSION)
endif()

target_compile_definitions(quickjs PUBLIC
  CONFIG_VERSION="${BN_QJS_VERSION}"
  _GNU_SOURCE
)

if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(quickjs PRIVATE
    -Wno-unused-parameter
    -Wno-sign-compare
    -Wno-unused-variable
    -Wno-implicit-fallthrough
  )
endif()
