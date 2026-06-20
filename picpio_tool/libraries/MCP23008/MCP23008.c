// MCP23008.c — see MCP23008.h
#include "MCP23008.h"

#define REG_IODIR  0x00
#define REG_GPPU   0x06
#define REG_GPIO   0x09
#define REG_OLAT   0x0A

static void _w8(mcp23008_t *d, uint8_t reg, uint8_t val) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.write(val);
    i2c1.endTransmission();
}

static uint8_t _r8(mcp23008_t *d, uint8_t reg) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.endTransmission();
    i2c1.requestFrom(d->address, 1);
    return (uint8_t)i2c1.read();
}

uint8_t mcp23008_begin(mcp23008_t *dev, uint8_t addr) {
    dev->address = addr;
    dev->iodir = 0xFF;               // all inputs
    dev->gppu  = 0x00;
    dev->olat  = 0x00;
    _w8(dev, REG_IODIR, dev->iodir);
    _w8(dev, REG_GPPU,  dev->gppu);
    _w8(dev, REG_OLAT,  dev->olat);
    return 1;
}

void mcp23008_pinMode(mcp23008_t *dev, uint8_t pin, uint8_t mode) {
    if (pin > 7) return;
    uint8_t mask = (uint8_t)(1u << pin);
    if (mode == GPIO_OUT) {
        dev->iodir &= (uint8_t)~mask;
        dev->gppu  &= (uint8_t)~mask;
    } else {                          // GPIO_IN or GPIO_PULLUP
        dev->iodir |= mask;
        if (mode == GPIO_PULLUP) dev->gppu |= mask;
        else                     dev->gppu &= (uint8_t)~mask;
    }
    _w8(dev, REG_IODIR, dev->iodir);
    _w8(dev, REG_GPPU,  dev->gppu);
}

void mcp23008_write(mcp23008_t *dev, uint8_t pin, uint8_t val) {
    if (pin > 7) return;
    uint8_t mask = (uint8_t)(1u << pin);
    if (val) dev->olat |= mask;
    else     dev->olat &= (uint8_t)~mask;
    _w8(dev, REG_OLAT, dev->olat);
}

uint8_t mcp23008_read(mcp23008_t *dev, uint8_t pin) {
    if (pin > 7) return 0;
    return (_r8(dev, REG_GPIO) >> pin) & 1;
}

void mcp23008_writePort(mcp23008_t *dev, uint8_t val) {
    dev->olat = val;
    _w8(dev, REG_OLAT, val);
}

uint8_t mcp23008_readPort(mcp23008_t *dev) {
    return _r8(dev, REG_GPIO);
}
