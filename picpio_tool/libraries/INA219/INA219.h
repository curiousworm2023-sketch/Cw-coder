// INA219.h — PICPIO C driver for the TI INA219 high-side current / power
// monitor (I2C). Calibrated for the common 32V / 2A range with a 0.1 ohm shunt
// (matches the Adafruit breakout default).
//
// Usage:
//   ina219_t ina;
//   void init() { i2c1.begin(); ina219_begin(&ina, INA219_ADDR); }
//   void run()  {
//     float v = ina219_busVoltage(&ina);   // V
//     float i = ina219_current(&ina);       // mA
//     float p = ina219_power(&ina);         // mW
//   }
#ifndef INA219_H
#define INA219_H

#include "Picpio.h"

#ifndef INA219_ADDR
#define INA219_ADDR 0x40            // A0/A1 select 0x40..0x4F
#endif

typedef struct { uint8_t address; } ina219_t;

uint8_t ina219_begin(ina219_t *dev, uint8_t addr);   // configures 32V/2A; returns 1
float   ina219_busVoltage(ina219_t *dev);            // Volts
float   ina219_shuntVoltage(ina219_t *dev);          // milliVolts
float   ina219_current(ina219_t *dev);               // milliAmps
float   ina219_power(ina219_t *dev);                 // milliWatts

#endif // INA219_H
