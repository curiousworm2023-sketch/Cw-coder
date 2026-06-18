// MCP4725.h — PICPIO C driver for the Microchip MCP4725 12-bit I2C DAC
// (Adafruit MCP4725 breakout).
//
// Usage:
//   mcp4725_t dac;
//   void init() { i2c1.begin(); mcp4725_begin(&dac, MCP4725_ADDR); }
//   void run()  { mcp4725_setValue(&dac, 2048); }      // mid-scale (~Vcc/2)
#ifndef MCP4725_H
#define MCP4725_H

#include "Picpio.h"

#ifndef MCP4725_ADDR
#define MCP4725_ADDR 0x62            // 0x60..0x67 depending on A0 / variant
#endif

typedef struct { uint8_t address; } mcp4725_t;

void mcp4725_begin(mcp4725_t *dev, uint8_t addr);
void mcp4725_setValue(mcp4725_t *dev, uint16_t value);     // 0..4095 (fast write, volatile)
void mcp4725_setValueEEPROM(mcp4725_t *dev, uint16_t value);// also store as power-on default

#endif // MCP4725_H
