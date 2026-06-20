// HTU21DF.h — PICPIO C driver for the TE/MEAS HTU21D-F temperature /
// humidity sensor (I2C, fixed address 0x40). Also covers the Si7021 footprint
// for the basic no-hold measurement commands.
//
// Usage:
//   htu21df_t htu;
//   void init() { i2c1.begin(); htu21df_begin(&htu); }
//   void run()  { float t = htu21df_readTemperature(&htu);   // degrees C
//                 float h = htu21df_readHumidity(&htu); }     // %RH
#ifndef HTU21DF_H
#define HTU21DF_H

#include "Picpio.h"

#define HTU21DF_ADDR 0x40           // fixed I2C address

typedef struct { uint8_t address; } htu21df_t;

uint8_t htu21df_begin(htu21df_t *dev);                 // soft reset; returns 1
float   htu21df_readTemperature(htu21df_t *dev);       // degrees C
float   htu21df_readHumidity(htu21df_t *dev);          // %RH

#endif // HTU21DF_H
