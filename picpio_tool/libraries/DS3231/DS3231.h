// DS3231.h — PICPIO C driver for the Maxim DS3231 high-accuracy I2C RTC
// (Adafruit DS3231 breakout). 24-hour time; also exposes the on-chip
// temperature sensor.
//
// Usage:
//   ds3231_t rtc; ds3231_time_t t;
//   void init() {
//       i2c1.begin(); ds3231_begin(&rtc, DS3231_ADDR);
//       ds3231_time_t set = { 2026, 6, 18, 14, 30, 0 };   // y, mo, d, h, mi, s
//       ds3231_setTime(&rtc, &set);
//   }
//   void run() { ds3231_getTime(&rtc, &t); float c = ds3231_getTemperature(&rtc); }
#ifndef DS3231_H
#define DS3231_H

#include "Picpio.h"

#ifndef DS3231_ADDR
#define DS3231_ADDR 0x68             // fixed
#endif

typedef struct {
    uint16_t year;                   // full year, e.g. 2026
    uint8_t  month, day;             // 1-12, 1-31
    uint8_t  hour, minute, second;   // 24-hour
} ds3231_time_t;

typedef struct { uint8_t address; } ds3231_t;

uint8_t ds3231_begin(ds3231_t *dev, uint8_t addr);             // returns 1
void    ds3231_setTime(ds3231_t *dev, const ds3231_time_t *t);
void    ds3231_getTime(ds3231_t *dev, ds3231_time_t *t);
float   ds3231_getTemperature(ds3231_t *dev);                  // degrees C (0.25 resolution)

#endif // DS3231_H
