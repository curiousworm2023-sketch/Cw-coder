// BME280.h — PICPIO C driver for the Bosch BME280 temperature / pressure /
// humidity sensor over I2C (works with the Adafruit BME280 breakout, and with
// a BMP280 too — humidity then reads 0). Compensation uses Bosch Sensortec's
// fixed-point reference algorithms (BSD-3-Clause, (c) Bosch Sensortec GmbH).
//
// Usage:
//   #include "BME280.h"
//   bme280_t bme;
//   void init() {
//       i2c1.begin();
//       if (!bme280_begin(&bme, BME280_ADDR)) uart1.println("no BME280");
//   }
//   void run() {
//       float t = bme280_readTemperature(&bme); // °C
//       float p = bme280_readPressure(&bme);    // Pa  (/100 -> hPa)
//       float h = bme280_readHumidity(&bme);    // %RH (0 on a BMP280)
//   }
#ifndef BME280_H
#define BME280_H

#include "Picpio.h"

// 7-bit I2C address. Adafruit's board defaults to 0x77 (SDO->VDD); a bare
// module is usually 0x76 (SDO->GND). #define BME280_ADDR before this include
// to override.
#ifndef BME280_ADDR
#define BME280_ADDR 0x77
#endif

typedef struct {
    uint8_t  address;
    int32_t  t_fine;                 // carries temperature into P/H compensation
    uint16_t T1; int16_t T2, T3;
    uint16_t P1; int16_t P2, P3, P4, P5, P6, P7, P8, P9;
    uint8_t  H1, H3; int16_t H2, H4, H5; int8_t H6;
} bme280_t;

// Probe the device, load calibration, start continuous 1x-oversampled
// measurement. Returns 1 if a BME280/BMP280 answered, else 0.
uint8_t bme280_begin(bme280_t *dev, uint8_t addr);

// Each helper does a fresh burst read and recomputes temperature first (so the
// pressure/humidity compensation is correct), then returns its value.
float bme280_readTemperature(bme280_t *dev);  // degrees C
float bme280_readPressure(bme280_t *dev);     // Pascals
float bme280_readHumidity(bme280_t *dev);     // %RH (0 on a BMP280)

#endif // BME280_H
