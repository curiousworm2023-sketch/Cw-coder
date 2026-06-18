// SHT31.h — PICPIO C driver for the Sensirion SHT31-D temperature / humidity
// sensor (I2C). Works with the Adafruit SHT31 breakout.
//
// Usage:
//   sht31_t sht;
//   void init() { i2c1.begin(); sht31_begin(&sht, SHT31_ADDR); }
//   void run()  { float t, h; if (sht31_read(&sht, &t, &h)) { ... } }
#ifndef SHT31_H
#define SHT31_H

#include "Picpio.h"

#ifndef SHT31_ADDR
#define SHT31_ADDR 0x44              // 0x45 if the ADDR pin is tied high
#endif

typedef struct { uint8_t address; } sht31_t;

uint8_t sht31_begin(sht31_t *dev, uint8_t addr);          // soft-reset; returns 1
// Single-shot, high-repeatability measurement. Fills tempC (degrees C) and
// humidity (%RH); returns 1 on success.
uint8_t sht31_read(sht31_t *dev, float *tempC, float *humidity);

#endif // SHT31_H
