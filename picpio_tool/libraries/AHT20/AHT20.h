// AHT20.h — PICPIO C driver for the Aosong AHT20 (and AHT10) temperature /
// humidity sensor (I2C, fixed address 0x38).
//
// Usage:
//   aht20_t aht;
//   void init() { i2c1.begin(); aht20_begin(&aht); }
//   void run()  { float t, h; if (aht20_read(&aht, &t, &h)) { ... } }
#ifndef AHT20_H
#define AHT20_H

#include "Picpio.h"

#define AHT20_ADDR 0x38             // fixed I2C address

typedef struct { uint8_t address; } aht20_t;

uint8_t aht20_begin(aht20_t *dev);                         // returns 1 if calibrated
// Triggers a measurement and fills tempC (degrees C) and humidity (%RH);
// returns 1 on success, 0 if the sensor reported busy.
uint8_t aht20_read(aht20_t *dev, float *tempC, float *humidity);

#endif // AHT20_H
