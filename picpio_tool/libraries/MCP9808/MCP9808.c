// MCP9808.c — see MCP9808.h
#include "MCP9808.h"

#define REG_AMBIENT  0x05
#define REG_MFR_ID   0x06

static uint16_t _r16(mcp9808_t *d, uint8_t reg) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.endTransmission();
    i2c1.requestFrom(d->address, 2);
    uint8_t hi = (uint8_t)i2c1.read();
    uint8_t lo = (uint8_t)i2c1.read();
    return (uint16_t)((hi << 8) | lo);
}

uint8_t mcp9808_begin(mcp9808_t *dev, uint8_t addr) {
    dev->address = addr;
    return (_r16(dev, REG_MFR_ID) == 0x0054) ? 1 : 0;   // Microchip manufacturer id
}

float mcp9808_readTemperature(mcp9808_t *dev) {
    uint16_t raw = _r16(dev, REG_AMBIENT);
    uint8_t upper = (uint8_t)(raw >> 8) & 0x1F;          // strip flag bits
    uint8_t lower = (uint8_t)(raw & 0xFF);
    if (upper & 0x10) {                                  // sign bit → below 0 C
        upper &= 0x0F;
        return 256.0f - ((float)upper * 16.0f + (float)lower / 16.0f);
    }
    return (float)upper * 16.0f + (float)lower / 16.0f;
}
