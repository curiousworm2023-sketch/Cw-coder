// SHT4x.h — PICPIO C driver for the Sensirion SHT40/SHT41/SHT45 temperature /
// humidity sensor (I2C). Works with the Adafruit SHT4x breakout.
//
// Usage:
//   SHT4x_t sht;
//   void init() { i2c1.begin(); SHT4x_init(&sht, SHT4x_ADDR); }
//   void run()  { float t, h; SHT4x_getEvent(&sht, &t, &h); }  // degrees C, %RH
#ifndef SHT4X_H
#define SHT4X_H

#include "Picpio.h"

#ifndef SHT4x_ADDR
#define SHT4x_ADDR 0x44             // 0x45 on some variants
#endif

typedef struct { uint8_t address; } SHT4x_t;

uint8_t SHT4x_init(SHT4x_t *dev, uint8_t addr);                    // returns 1
// High-precision single-shot measurement: fills tempC and humidity (%RH).
uint8_t SHT4x_getEvent(SHT4x_t *dev, float *tempC, float *humidity);

#endif // SHT4X_H
