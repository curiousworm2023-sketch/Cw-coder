// TCA9548A.c — see TCA9548A.h. The only register is the control byte: each bit
// enables the corresponding downstream channel (bit0 = SC0/SD0 ... bit7 = SC7).
#include "TCA9548A.h"

static void _write(tca9548a_t *d, uint8_t mask) {
    i2c1.beginTransmission(d->address);
    i2c1.write(mask);
    i2c1.endTransmission();
}

uint8_t tca9548a_begin(tca9548a_t *dev, uint8_t addr) {
    dev->address = addr;
    i2c1.beginTransmission(addr);
    return (i2c1.endTransmission() == 0) ? 1 : 0;   // ACK = present
}

void tca9548a_select(tca9548a_t *dev, uint8_t channel) {
    if (channel > 7) return;
    _write(dev, (uint8_t)(1u << channel));
}

void tca9548a_setChannels(tca9548a_t *dev, uint8_t mask) { _write(dev, mask); }

void tca9548a_disable(tca9548a_t *dev) { _write(dev, 0x00); }
