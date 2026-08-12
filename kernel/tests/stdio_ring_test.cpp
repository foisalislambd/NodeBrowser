#include "bn/stdio_ring.hpp"

#include <iostream>
#include <string>
#include <vector>

using namespace bn;

static int fails = 0;
#define CHECK(cond)                                                                 \
  do {                                                                              \
    if (!(cond)) {                                                                  \
      std::cerr << "FAIL: " << #cond << " at " << __FILE__ << ":" << __LINE__ << "\n"; \
      ++fails;                                                                      \
    }                                                                               \
  } while (0)

int main() {
  constexpr uint32_t cap = 64;
  std::vector<uint8_t> mem(StdioRing::kHeader + cap);
  auto ring = StdioRing::init(mem.data(), cap);
  CHECK(StdioRing::load_u32(mem.data()) == StdioRing::kMagic);
  CHECK(ring.exit_code() == -1);

  const char* msg = "hello-sab";
  CHECK(ring.write(reinterpret_cast<const uint8_t*>(msg), 9) == 9);
  uint8_t buf[16]{};
  CHECK(ring.read(buf, 16) == 9);
  CHECK(std::string(reinterpret_cast<char*>(buf), 9) == "hello-sab");
  CHECK(ring.read(buf, 16) == 0);

  std::string big(80, 'x');
  size_t w = ring.write(reinterpret_cast<const uint8_t*>(big.data()), big.size());
  CHECK(w == cap);
  ring.close(0);
  CHECK(ring.closed() == 1);
  CHECK(ring.exit_code() == 0);
  CHECK(ring.write(reinterpret_cast<const uint8_t*>("z"), 1) == 0);

  if (fails) {
    std::cerr << fails << " failure(s)\n";
    return 1;
  }
  std::cout << "stdio_ring_test OK\n";
  return 0;
}
