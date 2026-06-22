// SI7021.h — PICPIO C driver for the Silicon Labs Si7021 temperature /
// humidity sensor (I2C). The address is passed in from your sketch
// (default 0x40).
//
// Usage:
//   SI7021_t si;
//   void init() { i2c1.begin(); SI7021_begin(&si, SI7021_ADDR); }
//   void run()  { float t = SI7021_readTemperature(&si);   // degrees C
//                 float h = SI7021_readHumidity(&si); }     // %RH
#ifndef SI7021_H
#define SI7021_H

#include "Picpio.h"

#ifndef SI7021_ADDR
#define SI7021_ADDR 0x40            // default I2C address
#endif

typedef struct { uint8_t address; } SI7021_t;

uint8_t SI7021_begin(SI7021_t *dev, uint8_t addr);     // soft reset; returns 1
float   SI7021_readTemperature(SI7021_t *dev);         // degrees C
float   SI7021_readHumidity(SI7021_t *dev);            // %RH

#endif // SI7021_H
