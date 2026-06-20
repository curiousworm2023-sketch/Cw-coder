// VEML7700.c — see VEML7700.h. Registers are 16-bit little-endian.
// Config (0x00): gain ALS_GAIN=1x (00), integration ALS_IT=100ms (0000),
// persistence 1, interrupts off, ALS_SD=0 (power on) → 0x0000.
// At gain 1x / IT 100ms the resolution is 0.0576 lux per count.
#include "VEML7700.h"

#define REG_ALS_CONF 0x00
#define REG_ALS      0x04
#define LUX_PER_BIT  0.0576f

static void _w16(veml7700_t *d, uint8_t reg, uint16_t val) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.write((uint8_t)(val & 0xFF));      // low byte first
    i2c1.write((uint8_t)(val >> 8));
    i2c1.endTransmission();
}

static uint16_t _r16(veml7700_t *d, uint8_t reg) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.endTransmission();
    i2c1.requestFrom(d->address, 2);
    uint8_t lo = (uint8_t)i2c1.read();
    uint8_t hi = (uint8_t)i2c1.read();
    return (uint16_t)((hi << 8) | lo);
}

uint8_t veml7700_begin(veml7700_t *dev) {
    dev->address = VEML7700_ADDR;
    _w16(dev, REG_ALS_CONF, 0x0000);        // gain 1x, IT 100ms, powered on
    sys_delay(5);                           // wait > one integration cycle
    return 1;
}

uint16_t veml7700_readALS(veml7700_t *dev) { return _r16(dev, REG_ALS); }

float veml7700_readLux(veml7700_t *dev) {
    return (float)veml7700_readALS(dev) * LUX_PER_BIT;
}
