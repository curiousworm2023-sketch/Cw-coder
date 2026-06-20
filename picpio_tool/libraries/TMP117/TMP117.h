// TMP117.h — PICPIO C driver for the TI TMP117 high-accuracy digital
// temperature sensor (I2C).
//
// Usage:
//   tmp117_t tmp;
//   void init() { i2c1.begin(); tmp117_begin(&tmp, TMP117_ADDR); }
//   void run()  { float t = tmp117_readTemperature(&tmp); }   // degrees C
#ifndef TMP117_H
#define TMP117_H

#include "Picpio.h"

#ifndef TMP117_ADDR
#define TMP117_ADDR 0x48            // 0x48..0x4B via ADD0 pin
#endif

typedef struct { uint8_t address; } tmp117_t;

uint8_t tmp117_begin(tmp117_t *dev, uint8_t addr);     // returns 1 if device id matches
float   tmp117_readTemperature(tmp117_t *dev);         // degrees C

#endif // TMP117_H
