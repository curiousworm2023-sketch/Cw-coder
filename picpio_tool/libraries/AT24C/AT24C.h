// AT24C.h — PICPIO C driver for I2C EEPROMs (Microchip 24LCxx / Atmel
// AT24Cxx and compatibles) on the Wire/i2c1 bus.
//
// Supports the common parts:
//   - 1-byte word address:  24LC01 (128 B), 24LC02 (256 B)
//   - 2-byte word address:  24LC32 (4 KB) ... 24LC512 (64 KB)
// The block-select oddballs (24LC04/08/16) are NOT supported.
//
// Usage:
//   AT24C_t ee;
//   void init() {
//       Wire.begin();
//       AT24C_init(&ee, 0x50, 32768, 64);   // addr, total bytes, page size
//       AT24C_writeByte(&ee, 0, 42);
//       uint8_t v = AT24C_readByte(&ee, 0);
//   }
#ifndef PICPIO_AT24C_H
#define PICPIO_AT24C_H

#include "Picpio.h"

typedef struct {
    uint8_t  addr;       // 7-bit I2C address (0x50..0x57)
    uint32_t size;       // total capacity in bytes
    uint16_t pageSize;   // write page size in bytes (8/16/32/64/128)
    uint8_t  twoByte;    // 1 = 16-bit word address (size > 256)
} AT24C_t;

// Configure the device. `pageSize` is the chip's write page (see datasheet;
// 24LC32/64 = 32, 24LC128/256 = 64, 24LC512 = 128).
void    AT24C_init(AT24C_t *dev, uint8_t i2cAddr, uint32_t sizeBytes, uint16_t pageSize);

// Best-effort presence check (the PICPIO Wire HAL can't report NACK, so this
// just performs a read and returns 1). Provided for API symmetry.
uint8_t AT24C_begin(AT24C_t *dev);

uint8_t AT24C_writeByte(AT24C_t *dev, uint32_t addr, uint8_t val);
uint8_t AT24C_readByte (AT24C_t *dev, uint32_t addr);

// Write/read arbitrary lengths. Write splits on page boundaries and waits the
// 5 ms write cycle after each page; read is chunked to the Wire RX buffer.
// Return 1 on success (writes that run past the device size are truncated).
uint8_t AT24C_write(AT24C_t *dev, uint32_t addr, const void *data, uint16_t len);
uint8_t AT24C_read (AT24C_t *dev, uint32_t addr, void *data, uint16_t len);

#endif // PICPIO_AT24C_H
