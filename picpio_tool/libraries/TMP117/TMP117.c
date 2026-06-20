// TMP117.c — see TMP117.h. Temperature register LSB = 7.8125 m degrees C.
#include "TMP117.h"

#define REG_TEMP    0x00
#define REG_DEVID   0x0F

static int16_t _r16(tmp117_t *d, uint8_t reg) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.endTransmission();
    i2c1.requestFrom(d->address, 2);
    uint8_t hi = (uint8_t)i2c1.read();
    uint8_t lo = (uint8_t)i2c1.read();
    return (int16_t)((hi << 8) | lo);
}

uint8_t tmp117_begin(tmp117_t *dev, uint8_t addr) {
    dev->address = addr;
    return ((_r16(dev, REG_DEVID) & 0x0FFF) == 0x0117) ? 1 : 0;
}

float tmp117_readTemperature(tmp117_t *dev) {
    return (float)_r16(dev, REG_TEMP) * 0.0078125f;
}
