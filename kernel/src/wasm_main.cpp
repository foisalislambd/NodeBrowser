// Emscripten entry — all work is via exported C ABI (bn_*)
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

#include "bn/api.h"

int main() {
  // Keep main so the module instantiates cleanly; host never relies on it.
  return 0;
}
