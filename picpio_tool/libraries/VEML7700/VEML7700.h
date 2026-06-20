// VEML7700.h — PICPIO C driver for the Vishay VEML7700 ambient light sensor
// (I2C, fixed address 0x10). Configured for gain 1x and 100ms integration time.
//
// Usage:
//   veml7700_t als;
//   void init() { i2c1.begin(); veml7700_begin(&als); }
//   void run()  { float lux = veml7700_readLux(&als); }
#ifndef VEML7700_H
#define VEML7700_H

#include "Picpio.h"

#define VEML7700_ADDR 0x10          // fixed I2C address

typedef struct { uint8_t address; } veml7700_t;

uint8_t  veml7700_begin(veml7700_t *dev);              // powers on; returns 1
uint16_t veml7700_readALS(veml7700_t *dev);            // raw 16-bit ALS count
float    veml7700_readLux(veml7700_t *dev);            // lux (gain 1x, IT 100ms)

#endif // VEML7700_H
