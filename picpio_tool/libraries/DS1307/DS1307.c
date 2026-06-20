// DS1307.c — see DS1307.h. Time registers are BCD; the century is assumed 20xx.
// Bit7 of the seconds register (0x00) is CH (Clock Halt): 1 = stopped.
#include "DS1307.h"

static uint8_t _bcd2dec(uint8_t b) { return (uint8_t)((b >> 4) * 10 + (b & 0x0F)); }
static uint8_t _dec2bcd(uint8_t d) { return (uint8_t)(((d / 10) << 4) | (d % 10)); }

uint8_t ds1307_begin(ds1307_t *dev, uint8_t addr) {
    dev->address = addr;
    i2c1.beginTransmission(addr);
    return (i2c1.endTransmission() == 0) ? 1 : 0;   // ACK = present
}

uint8_t ds1307_isRunning(ds1307_t *dev) {
    i2c1.beginTransmission(dev->address);
    i2c1.write(0x00);
    i2c1.endTransmission();
    i2c1.requestFrom(dev->address, 1);
    return (((uint8_t)i2c1.read()) & 0x80) ? 0 : 1;  // CH set → halted
}

void ds1307_setTime(ds1307_t *dev, const ds1307_time_t *t) {
    i2c1.beginTransmission(dev->address);
    i2c1.write(0x00);                                // start at seconds register
    i2c1.write(_dec2bcd(t->second) & 0x7F);          // CH = 0 → start oscillator
    i2c1.write(_dec2bcd(t->minute));
    i2c1.write(_dec2bcd(t->hour));                   // bit6=0 → 24-hour mode
    i2c1.write(1);                                   // day-of-week (unused, 1-7)
    i2c1.write(_dec2bcd(t->day));
    i2c1.write(_dec2bcd(t->month));
    i2c1.write(_dec2bcd((uint8_t)(t->year % 100)));
    i2c1.endTransmission();
}

void ds1307_getTime(ds1307_t *dev, ds1307_time_t *t) {
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
    t->second = _bcd2dec(s & 0x7F);                  // mask CH bit
    t->minute = _bcd2dec(mi & 0x7F);
    t->hour   = _bcd2dec(h & 0x3F);                  // 24-hour
    t->day    = _bcd2dec(d & 0x3F);
    t->month  = _bcd2dec(mo & 0x1F);
    t->year   = (uint16_t)(2000 + _bcd2dec(y));
}
