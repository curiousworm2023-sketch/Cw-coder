// TSL2591.h — PICPIO C driver for the AMS TSL2591 high-dynamic-range light
// sensor (I2C). Returns raw full-spectrum and IR channel counts.
//
// Usage:
//   TSL2591_t tsl;
//   void init() { i2c1.begin(); TSL2591_init(&tsl, 0x29); TSL2591_begin(&tsl); }
//   void run()  {
//     uint32_t lum = TSL2591_getFullLuminosity(&tsl);
//     uint16_t ir = lum >> 16, full = lum & 0xFFFF;
//   }
#ifndef TSL2591_H
#define TSL2591_H

#include "Picpio.h"

#ifndef TSL2591_ADDR
#define TSL2591_ADDR 0x29           // fixed address (passed in for consistency)
#endif

typedef struct { uint8_t address; } TSL2591_t;

void     TSL2591_init(TSL2591_t *dev, uint8_t addr);   // store the I2C address
uint8_t  TSL2591_begin(TSL2591_t *dev);                // power on; returns 1 if id ok
// Returns (IR << 16) | full-spectrum, each a 16-bit channel count.
uint32_t TSL2591_getFullLuminosity(TSL2591_t *dev);

#endif // TSL2591_H
