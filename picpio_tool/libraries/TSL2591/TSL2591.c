// TSL2591.c — see TSL2591.h. All register access uses the command byte
// (0xA0 | reg): bit7 = CMD, bits6:5 = 01 (normal/auto-increment).
#include "TSL2591.h"

#define CMD     0xA0
#define R_ENABLE 0x00
#define R_CONFIG 0x01
#define R_ID     0x12
#define R_C0DATA 0x14               // full spectrum (low byte first)
#define R_C1DATA 0x16               // IR

static void _w8(TSL2591_t *d, uint8_t reg, uint8_t val) {
    i2c1.beginTransmission(d->address);
    i2c1.write((uint8_t)(CMD | reg));
    i2c1.write(val);
    i2c1.endTransmission();
}

static uint16_t _r16(TSL2591_t *d, uint8_t reg) {
    i2c1.beginTransmission(d->address);
    i2c1.write((uint8_t)(CMD | reg));
    i2c1.endTransmission();
    i2c1.requestFrom(d->address, 2);
    uint8_t lo = (uint8_t)i2c1.read();
    uint8_t hi = (uint8_t)i2c1.read();
    return (uint16_t)((hi << 8) | lo);
}

void TSL2591_init(TSL2591_t *dev, uint8_t addr) { dev->address = addr; }

uint8_t TSL2591_begin(TSL2591_t *dev) {
    // Medium gain (0x10), 300ms integration (0x02).
    _w8(dev, R_CONFIG, 0x10 | 0x02);
    // Power on + ALS enable.
    _w8(dev, R_ENABLE, 0x03);
    i2c1.beginTransmission(dev->address);
    i2c1.write((uint8_t)(CMD | R_ID));
    i2c1.endTransmission();
    i2c1.requestFrom(dev->address, 1);
    return ((uint8_t)i2c1.read() == 0x50) ? 1 : 0;     // device id
}

uint32_t TSL2591_getFullLuminosity(TSL2591_t *dev) {
    uint16_t full = _r16(dev, R_C0DATA);
    uint16_t ir   = _r16(dev, R_C1DATA);
    return ((uint32_t)ir << 16) | full;
}
