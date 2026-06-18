// MCP23017.h — PICPIO C driver for the Microchip MCP23017 16-bit I2C GPIO
// expander (Adafruit MCP23017 breakout). Pins are numbered 0-15: 0-7 = port A,
// 8-15 = port B.
//
// Usage:
//   mcp23017_t io;
//   void init() {
//       i2c1.begin();
//       mcp23017_begin(&io, MCP23017_ADDR);
//       mcp23017_pinMode(&io, 0, GPIO_OUT);
//       mcp23017_pinMode(&io, 8, GPIO_PULLUP);
//   }
//   void run() { mcp23017_write(&io, 0, mcp23017_read(&io, 8)); }
#ifndef MCP23017_H
#define MCP23017_H

#include "Picpio.h"

#ifndef MCP23017_ADDR
#define MCP23017_ADDR 0x20           // A2:A0 = 000; 0x20..0x27
#endif

typedef struct {
    uint8_t address;
    uint8_t iodir[2];                // shadow of IODIRA/B (1 = input)
    uint8_t gppu[2];                 // shadow of GPPUA/B  (1 = pull-up)
    uint8_t olat[2];                 // shadow of output latches
} mcp23017_t;

uint8_t mcp23017_begin(mcp23017_t *dev, uint8_t addr);    // all pins input, no pull-ups
void    mcp23017_pinMode(mcp23017_t *dev, uint8_t pin, uint8_t mode);  // GPIO_IN/OUT/PULLUP
void    mcp23017_write(mcp23017_t *dev, uint8_t pin, uint8_t val);     // 0/1
uint8_t mcp23017_read(mcp23017_t *dev, uint8_t pin);                   // 0/1
void    mcp23017_writePort(mcp23017_t *dev, uint8_t port, uint8_t val);// port 0=A,1=B
uint8_t mcp23017_readPort(mcp23017_t *dev, uint8_t port);

#endif // MCP23017_H
