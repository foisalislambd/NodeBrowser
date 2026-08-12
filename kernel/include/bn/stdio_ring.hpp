#pragma once

#include <cstdint>
#include <cstring>

namespace bn {

/**
 * SharedArrayBuffer stdio ring — same 32-byte header as packages/api/src/io/sab-stdio.ts
 *
 *  0 magic     u32  0x31424153 ('SAB1' LE)
 *  4 cap       u32  payload bytes
 *  8 write_pos u32
 * 12 read_pos  u32
 * 16 closed    i32  0 open, 1 closed
 * 20 exit_code i32  -1 running
 * 24 reserved
 * 28 reserved
 * 32 payload[cap]
 *
 * Host JS uses Atomics on this layout (Worker ↔ UI). Native tests check the format.
 */
struct StdioRing {
  static constexpr uint32_t kHeader = 32;
  static constexpr uint32_t kMagic = 0x31424153u;

  uint8_t* base{nullptr};
  uint32_t cap{0};

  static uint32_t load_u32(const uint8_t* p) {
    uint32_t v;
    std::memcpy(&v, p, 4);
    return v;
  }
  static void store_u32(uint8_t* p, uint32_t v) { std::memcpy(p, &v, 4); }
  static int32_t load_i32(const uint8_t* p) {
    int32_t v;
    std::memcpy(&v, p, 4);
    return v;
  }
  static void store_i32(uint8_t* p, int32_t v) { std::memcpy(p, &v, 4); }

  static StdioRing init(uint8_t* mem, uint32_t payload_cap) {
    StdioRing r;
    r.base = mem;
    r.cap = payload_cap;
    std::memset(mem, 0, kHeader + payload_cap);
    store_u32(mem + 0, kMagic);
    store_u32(mem + 4, payload_cap);
    store_i32(mem + 20, -1);
    return r;
  }

  uint8_t* payload() { return base + kHeader; }
  uint32_t write_pos() const { return load_u32(base + 8); }
  uint32_t read_pos() const { return load_u32(base + 12); }
  int32_t closed() const { return load_i32(base + 16); }
  int32_t exit_code() const { return load_i32(base + 20); }

  size_t write(const uint8_t* src, size_t n) {
    if (!n || closed()) return 0;
    uint32_t w = write_pos();
    uint32_t r = read_pos();
    uint32_t used = w - r;
    if (used >= cap) return 0;
    uint32_t room = cap - used;
    size_t nwrite = n < room ? n : room;
    for (size_t i = 0; i < nwrite; ++i) {
      payload()[(w + static_cast<uint32_t>(i)) % cap] = src[i];
    }
    store_u32(base + 8, w + static_cast<uint32_t>(nwrite));
    return nwrite;
  }

  size_t read(uint8_t* dst, size_t n) {
    uint32_t w = write_pos();
    uint32_t r = read_pos();
    uint32_t avail = w - r;
    size_t nread = n < avail ? n : avail;
    for (size_t i = 0; i < nread; ++i) {
      dst[i] = payload()[(r + static_cast<uint32_t>(i)) % cap];
    }
    store_u32(base + 12, r + static_cast<uint32_t>(nread));
    return nread;
  }

  void close(int32_t code) {
    store_i32(base + 20, code);
    store_i32(base + 16, 1);
  }
};

}  // namespace bn
