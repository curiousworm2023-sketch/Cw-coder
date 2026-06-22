// INA260.c — see INA260.h
#include "INA260.h"

#define REG_CONFIG   0x00
#define REG_CURRENT  0x01
#define REG_BUSV     0x02
#define REG_POWER    0x03

static int16_t _r16(INA260_t *d, uint8_t reg) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.endTransmission();
    i2c1.requestFrom(d->address, 2);
    uint8_t hi = (uint8_t)i2c1.read();
    uint8_t lo = (uint8_t)i2c1.read();
    return (int16_t)((hi << 8) | lo);
}

void INA260_init(INA260_t *dev, uint8_t addr) { dev->address = addr; }

uint8_t INA260_begin(INA260_t *dev) {
    // Reset, then default config: avg 1, 1.1ms conv times, continuous shunt+bus.
    i2c1.beginTransmission(dev->address);
    i2c1.write(REG_CONFIG);
    i2c1.write(0x61);
    i2c1.write(0x27);
    return (i2c1.endTransmission() == 0) ? 1 : 0;
}

float INA260_getBusVoltage_V(INA260_t *dev) {
    return (float)_r16(dev, REG_BUSV) * 0.00125f;     // 1.25 mV/bit
}

float INA260_getCurrent_mA(INA260_t *dev) {
    return (float)_r16(dev, REG_CURRENT) * 1.25f;     // 1.25 mA/bit (signed)
}

float INA260_getPower_mW(INA260_t *dev) {
    return (float)(uint16_t)_r16(dev, REG_POWER) * 10.0f;  // 10 mW/bit
}
