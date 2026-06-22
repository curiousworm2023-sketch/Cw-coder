// SI7021.c — see SI7021.h. Uses the "no hold master" measurement commands.
#include "SI7021.h"

static uint16_t _measure(SI7021_t *d, uint8_t cmd) {
    i2c1.beginTransmission(d->address);
    i2c1.write(cmd);
    i2c1.endTransmission();
    sys_delay(25);                          // max conversion time

    i2c1.requestFrom(d->address, 2);
    uint8_t msb = (uint8_t)i2c1.read();
    uint8_t lsb = (uint8_t)i2c1.read();
    return (uint16_t)((msb << 8) | lsb);
}

uint8_t SI7021_begin(SI7021_t *dev, uint8_t addr) {
    dev->address = addr;
    i2c1.beginTransmission(dev->address);
    i2c1.write(0xFE);                       // soft reset
    i2c1.endTransmission();
    sys_delay(20);
    return 1;
}

float SI7021_readHumidity(SI7021_t *dev) {
    uint16_t raw = _measure(dev, 0xF5);     // measure RH, no hold
    float h = 125.0f * (float)raw / 65536.0f - 6.0f;
    if (h < 0.0f)   h = 0.0f;
    if (h > 100.0f) h = 100.0f;
    return h;
}

float SI7021_readTemperature(SI7021_t *dev) {
    uint16_t raw = _measure(dev, 0xF3);     // measure temp, no hold
    return 175.72f * (float)raw / 65536.0f - 46.85f;
}
