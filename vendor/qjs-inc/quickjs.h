/* Forward to QuickJS without adding vendor/quickjs to the -I path.
   That directory contains a file named "version", which shadows the C++ <version> header. */
#include "../quickjs/quickjs.h"
