// PCF8591.c — see PCF8591.h. Control byte: bit6 = enable analog output,
// bits1:0 = ADC channel. The first byte read back after a control write is the
// PREVIOUS conversion, so we read two and return the second (fresh) one.
#include "PCF8591.h"

#define CTRL_DAC_EN 0x40

uint8_t pcf8591_begin(pcf8591_t *dev, uint8_t addr) {
    dev->address = addr;
    i2c1.beginTransmission(addr);
    return (i2c1.endTransmission() == 0) ? 1 : 0;   // ACK = present
}

uint8_t pcf8591_read(pcf8591_t *dev, uint8_t channel) {
    i2c1.beginTransmission(dev->address);
    i2c1.write((uint8_t)(CTRL_DAC_EN | (channel & 0x03)));
    i2c1.endTransmission();

    i2c1.requestFrom(dev->address, 2);
    (void)i2c1.read();                  // stale (previous conversion)
    return (uint8_t)i2c1.read();        // fresh conversion for `channel`
}

void pcf8591_write(pcf8591_t *dev, uint8_t value) {
    i2c1.beginTransmission(dev->address);
    i2c1.write(CTRL_DAC_EN);            // enable DAC
    i2c1.write(value);
    i2c1.endTransmission();
}
