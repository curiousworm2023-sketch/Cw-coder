// PCF8591.h — PICPIO C driver for the NXP PCF8591 8-bit I2C ADC/DAC.
// 4 single-ended analog inputs (AIN0-3) and one analog output (AOUT).
//
// Usage:
//   pcf8591_t adc;
//   void init() { i2c1.begin(); pcf8591_begin(&adc, PCF8591_ADDR); }
//   void run()  {
//       uint8_t v = pcf8591_read(&adc, 0);   // channel 0, 0..255
//       pcf8591_write(&adc, 128);            // DAC out ~ half scale
//   }
#ifndef PCF8591_H
#define PCF8591_H

#include "Picpio.h"

#ifndef PCF8591_ADDR
#define PCF8591_ADDR 0x48            // A2:A0 select 0x48..0x4F
#endif

typedef struct { uint8_t address; } pcf8591_t;

uint8_t pcf8591_begin(pcf8591_t *dev, uint8_t addr);          // returns 1 if present
uint8_t pcf8591_read(pcf8591_t *dev, uint8_t channel);        // channel 0-3, value 0-255
void    pcf8591_write(pcf8591_t *dev, uint8_t value);         // DAC output 0-255

#endif // PCF8591_H
