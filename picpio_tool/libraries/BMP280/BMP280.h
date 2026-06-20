// BMP280.h — PICPIO C driver for the Bosch BMP280 barometric pressure /
// temperature sensor (I2C). Same silicon as the BME280 minus humidity.
//
// Usage:
//   bmp280_t bmp;
//   void init() { i2c1.begin(); bmp280_begin(&bmp, BMP280_ADDR); }
//   void run()  { float t = bmp280_readTemperature(&bmp);   // degrees C
//                 float p = bmp280_readPressure(&bmp); }     // Pascals
#ifndef BMP280_H
#define BMP280_H

#include "Picpio.h"

#ifndef BMP280_ADDR
#define BMP280_ADDR 0x77            // 0x76 if SDO is tied low
#endif

typedef struct {
    uint8_t  address;
    uint16_t T1;  int16_t T2, T3;
    uint16_t P1;  int16_t P2, P3, P4, P5, P6, P7, P8, P9;
    int32_t  t_fine;
} bmp280_t;

uint8_t bmp280_begin(bmp280_t *dev, uint8_t addr);   // returns 1 if chip id matches
float   bmp280_readTemperature(bmp280_t *dev);       // degrees C
float   bmp280_readPressure(bmp280_t *dev);          // Pascals

#endif // BMP280_H
