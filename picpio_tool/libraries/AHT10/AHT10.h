// AHT10.h — PICPIO C driver for the Aosong AHT10 temperature / humidity
// sensor (I2C). Sibling of the AHT20. The I2C address is passed in from your
// sketch (default 0x38) so boards with a non-standard address still work.
//
// Usage:
//   aht10_t aht;
//   void init() { i2c1.begin(); AHT10_init(&aht, AHT10_ADDR); }
//   void run()  { float t = AHT10_readTemperature(&aht);   // degrees C
//                 float h = AHT10_readHumidity(&aht); }     // %RH
#ifndef AHT10_H
#define AHT10_H

#include "Picpio.h"

#ifndef AHT10_ADDR
#define AHT10_ADDR 0x38             // default I2C address
#endif

typedef struct { uint8_t address; } AHT10_t;

uint8_t AHT10_init(AHT10_t *dev, uint8_t addr);    // calibrate; returns 1 on success
float   AHT10_readTemperature(AHT10_t *dev);       // degrees C
float   AHT10_readHumidity(AHT10_t *dev);          // %RH

#endif // AHT10_H
