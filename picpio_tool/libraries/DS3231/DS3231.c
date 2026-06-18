// DS3231.c — see DS3231.h. Time registers are BCD; the century is assumed 20xx.
#include "DS3231.h"

static uint8_t _bcd2dec(uint8_t b) { return (uint8_t)((b >> 4) * 10 + (b & 0x0F)); }
static uint8_t _dec2bcd(uint8_t d) { return (uint8_t)(((d / 10) << 4) | (d % 10)); }

uint8_t ds3231_begin(ds3231_t *dev, uint8_t addr) {
    dev->address = addr;
    i2c1.beginTransmission(addr);
    return (i2c1.endTransmission() == 0) ? 1 : 0;   // ACK = present
}

void ds3231_setTime(ds3231_t *dev, const ds3231_time_t *t) {
    i2c1.beginTransmission(dev->address);
    i2c1.write(0x00);                                // start at seconds register
    i2c1.write(_dec2bcd(t->second));
    i2c1.write(_dec2bcd(t->minute));
    i2c1.write(_dec2bcd(t->hour));                   // bit6=0 -> 24-hour mode
    i2c1.write(1);                                   // day-of-week (unused, 1-7)
    i2c1.write(_dec2bcd(t->day));
    i2c1.write(_dec2bcd(t->month));                  // bit7 (century) left 0
    i2c1.write(_dec2bcd((uint8_t)(t->year % 100)));
    i2c1.endTransmission();
}

void ds3231_getTime(ds3231_t *dev, ds3231_time_t *t) {
    i2c1.beginTransmission(dev->address);
    i2c1.write(0x00);
    i2c1.endTransmission();
    i2c1.requestFrom(dev->address, 7);
    uint8_t s  = (uint8_t)i2c1.read();
    uint8_t mi = (uint8_t)i2c1.read();
    uint8_t h  = (uint8_t)i2c1.read();
    (void)i2c1.read();                               // day-of-week
    uint8_t d  = (uint8_t)i2c1.read();
    uint8_t mo = (uint8_t)i2c1.read();
    uint8_t y  = (uint8_t)i2c1.read();
    t->second = _bcd2dec(s & 0x7F);
    t->minute = _bcd2dec(mi & 0x7F);
    t->hour   = _bcd2dec(h & 0x3F);                  // 24-hour
    t->day    = _bcd2dec(d & 0x3F);
    t->month  = _bcd2dec(mo & 0x1F);
    t->year   = (uint16_t)(2000 + _bcd2dec(y));
}

float ds3231_getTemperature(ds3231_t *dev) {
    i2c1.beginTransmission(dev->address);
    i2c1.write(0x11);                                // temperature MSB
    i2c1.endTransmission();
    i2c1.requestFrom(dev->address, 2);
    int8_t  msb = (int8_t)i2c1.read();
    uint8_t lsb = (uint8_t)i2c1.read();
    return (float)msb + ((lsb >> 6) * 0.25f);
}
