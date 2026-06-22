// INA260.h — PICPIO C driver for the TI INA260 current / power monitor with an
// integrated 2 mOhm shunt (I2C). Fixed LSBs: current 1.25 mA, bus 1.25 mV.
//
// Usage:
//   INA260_t ina;
//   void init() { i2c1.begin(); INA260_init(&ina, 0x40); INA260_begin(&ina); }
//   void run()  { float v = INA260_getBusVoltage_V(&ina);   // V
//                 float i = INA260_getCurrent_mA(&ina); }    // mA
#ifndef INA260_H
#define INA260_H

#include "Picpio.h"

#ifndef INA260_ADDR
#define INA260_ADDR 0x40            // default; A0/A1 select 0x40..0x4F
#endif

typedef struct { uint8_t address; } INA260_t;

void  INA260_init(INA260_t *dev, uint8_t addr);   // store the I2C address
uint8_t INA260_begin(INA260_t *dev);              // returns 1 if present
float INA260_getBusVoltage_V(INA260_t *dev);      // Volts
float INA260_getCurrent_mA(INA260_t *dev);        // milliAmps (signed)
float INA260_getPower_mW(INA260_t *dev);          // milliWatts

#endif // INA260_H
