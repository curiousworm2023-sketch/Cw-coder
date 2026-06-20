// DS1307.h — PICPIO C driver for the Maxim DS1307 I2C real-time clock.
// 24-hour time. (Same register layout as the DS3231, minus the temperature
// sensor; the DS1307 instead has a clock-halt bit in the seconds register.)
//
// Usage:
//   ds1307_t rtc; ds1307_time_t t;
//   void init() {
//       i2c1.begin(); ds1307_begin(&rtc, DS1307_ADDR);
//       ds1307_time_t set = { 2026, 6, 18, 14, 30, 0 };   // y, mo, d, h, mi, s
//       ds1307_setTime(&rtc, &set);
//   }
//   void run() { ds1307_getTime(&rtc, &t); }
#ifndef DS1307_H
#define DS1307_H

#include "Picpio.h"

#ifndef DS1307_ADDR
#define DS1307_ADDR 0x68             // fixed
#endif

typedef struct {
    uint16_t year;                   // full year, e.g. 2026
    uint8_t  month, day;             // 1-12, 1-31
    uint8_t  hour, minute, second;   // 24-hour
} ds1307_time_t;

typedef struct { uint8_t address; } ds1307_t;

uint8_t ds1307_begin(ds1307_t *dev, uint8_t addr);             // returns 1 if present
uint8_t ds1307_isRunning(ds1307_t *dev);                       // 1 if clock not halted
void    ds1307_setTime(ds1307_t *dev, const ds1307_time_t *t); // also clears clock-halt
void    ds1307_getTime(ds1307_t *dev, ds1307_time_t *t);

#endif // DS1307_H
