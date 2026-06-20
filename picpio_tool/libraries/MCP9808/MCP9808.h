// MCP9808.h — PICPIO C driver for the Microchip MCP9808 +/-0.25 degree C
// digital temperature sensor (I2C).
//
// Usage:
//   mcp9808_t t;
//   void init() { i2c1.begin(); mcp9808_begin(&t, MCP9808_ADDR); }
//   void run()  { float c = mcp9808_readTemperature(&t); }   // degrees C
#ifndef MCP9808_H
#define MCP9808_H

#include "Picpio.h"

#ifndef MCP9808_ADDR
#define MCP9808_ADDR 0x18           // 0x18..0x1F via A0-A2
#endif

typedef struct { uint8_t address; } mcp9808_t;

uint8_t mcp9808_begin(mcp9808_t *dev, uint8_t addr);     // returns 1 if manufacturer id ok
float   mcp9808_readTemperature(mcp9808_t *dev);         // degrees C

#endif // MCP9808_H
