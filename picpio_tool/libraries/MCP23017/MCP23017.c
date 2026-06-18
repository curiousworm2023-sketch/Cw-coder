// MCP23017.c — see MCP23017.h. Register addresses assume the power-on default
// IOCON.BANK = 0 (A/B register pairs interleaved).
#include "MCP23017.h"

#define REG_IODIRA 0x00
#define REG_GPPUA  0x0C
#define REG_GPIOA  0x12
#define REG_OLATA  0x14

static void _w(mcp23017_t *d, uint8_t reg, uint8_t val) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.write(val);
    i2c1.endTransmission();
}

static uint8_t _r(mcp23017_t *d, uint8_t reg) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.endTransmission();
    i2c1.requestFrom(d->address, 1);
    return (uint8_t)i2c1.read();
}

uint8_t mcp23017_begin(mcp23017_t *dev, uint8_t addr) {
    dev->address = addr;
    dev->iodir[0] = dev->iodir[1] = 0xFF;   // all inputs
    dev->gppu[0]  = dev->gppu[1]  = 0x00;
    dev->olat[0]  = dev->olat[1]  = 0x00;
    _w(dev, REG_IODIRA + 0, 0xFF);
    _w(dev, REG_IODIRA + 1, 0xFF);
    _w(dev, REG_GPPUA + 0, 0x00);
    _w(dev, REG_GPPUA + 1, 0x00);
    return 1;
}

void mcp23017_pinMode(mcp23017_t *dev, uint8_t pin, uint8_t mode) {
    uint8_t port = (pin >> 3) & 1, bit = (uint8_t)(1u << (pin & 7));
    if (mode == GPIO_OUT) { dev->iodir[port] &= (uint8_t)~bit; dev->gppu[port] &= (uint8_t)~bit; }
    else {                  dev->iodir[port] |= bit;
                            if (mode == GPIO_PULLUP) dev->gppu[port] |= bit;
                            else                     dev->gppu[port] &= (uint8_t)~bit; }
    _w(dev, REG_IODIRA + port, dev->iodir[port]);
    _w(dev, REG_GPPUA  + port, dev->gppu[port]);
}

void mcp23017_write(mcp23017_t *dev, uint8_t pin, uint8_t val) {
    uint8_t port = (pin >> 3) & 1, bit = (uint8_t)(1u << (pin & 7));
    if (val) dev->olat[port] |= bit;
    else     dev->olat[port] &= (uint8_t)~bit;
    _w(dev, REG_OLATA + port, dev->olat[port]);
}

uint8_t mcp23017_read(mcp23017_t *dev, uint8_t pin) {
    uint8_t port = (pin >> 3) & 1, bit = (uint8_t)(1u << (pin & 7));
    return (_r(dev, REG_GPIOA + port) & bit) ? 1 : 0;
}

void mcp23017_writePort(mcp23017_t *dev, uint8_t port, uint8_t val) {
    port &= 1; dev->olat[port] = val; _w(dev, REG_OLATA + port, val);
}

uint8_t mcp23017_readPort(mcp23017_t *dev, uint8_t port) {
    return _r(dev, REG_GPIOA + (port & 1));
}
