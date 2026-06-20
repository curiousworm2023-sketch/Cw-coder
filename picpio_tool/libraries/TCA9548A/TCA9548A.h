// TCA9548A.h — PICPIO C driver for the TI TCA9548A 1-to-8 I2C multiplexer.
// Lets you put up to 8 devices that share the same I2C address on one bus by
// switching which downstream channel is connected to the master.
//
// Usage:
//   tca9548a_t mux;
//   void init() { i2c1.begin(); tca9548a_begin(&mux, TCA9548A_ADDR); }
//   void run()  {
//       tca9548a_select(&mux, 0);   // talk to whatever is on channel 0
//       // ... normal i2c1 transactions to the device on channel 0 ...
//       tca9548a_select(&mux, 3);   // switch to channel 3
//   }
#ifndef TCA9548A_H
#define TCA9548A_H

#include "Picpio.h"

#ifndef TCA9548A_ADDR
#define TCA9548A_ADDR 0x70           // A2:A0 select 0x70..0x77
#endif

typedef struct { uint8_t address; } tca9548a_t;

uint8_t tca9548a_begin(tca9548a_t *dev, uint8_t addr);   // returns 1 if present
void    tca9548a_select(tca9548a_t *dev, uint8_t channel);   // 0-7, exclusive
void    tca9548a_setChannels(tca9548a_t *dev, uint8_t mask); // raw bitmask (multiple)
void    tca9548a_disable(tca9548a_t *dev);                   // disconnect all channels

#endif // TCA9548A_H
