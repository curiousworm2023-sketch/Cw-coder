// MCP23008.h — PICPIO C driver for the Microchip MCP23008 8-bit I2C GPIO
// expander. Pins are numbered 0-7. (8-bit sibling of the MCP23017.)
//
// Usage:
//   mcp23008_t io;
//   void init() {
//       i2c1.begin();
//       mcp23008_begin(&io, MCP23008_ADDR);
//       mcp23008_pinMode(&io, 0, GPIO_OUT);
//       mcp23008_pinMode(&io, 1, GPIO_PULLUP);
//   }
//   void run() { mcp23008_write(&io, 0, mcp23008_read(&io, 1)); }
#ifndef MCP23008_H
#define MCP23008_H

#include "Picpio.h"

#ifndef MCP23008_ADDR
#define MCP23008_ADDR 0x20           // A2:A0 = 000; 0x20..0x27
#endif

typedef struct {
    uint8_t address;
    uint8_t iodir;                   // shadow of IODIR (1 = input)
    uint8_t gppu;                    // shadow of GPPU  (1 = pull-up)
    uint8_t olat;                    // shadow of output latch
} mcp23008_t;

uint8_t mcp23008_begin(mcp23008_t *dev, uint8_t addr);   // all pins input, no pull-ups
void    mcp23008_pinMode(mcp23008_t *dev, uint8_t pin, uint8_t mode);  // GPIO_IN/OUT/PULLUP
void    mcp23008_write(mcp23008_t *dev, uint8_t pin, uint8_t val);     // 0/1
uint8_t mcp23008_read(mcp23008_t *dev, uint8_t pin);                   // 0/1
void    mcp23008_writePort(mcp23008_t *dev, uint8_t val);             // all 8 outputs
uint8_t mcp23008_readPort(mcp23008_t *dev);                          // all 8 inputs

#endif // MCP23008_H
