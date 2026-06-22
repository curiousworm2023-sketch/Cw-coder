// AHT10.c — see AHT10.h
#include "AHT10.h"

uint8_t AHT10_init(AHT10_t *dev, uint8_t addr) {
    dev->address = addr;
    sys_delay(40);
    i2c1.beginTransmission(dev->address);   // initialize / calibrate
    i2c1.write(0xE1);
    i2c1.write(0x08);
    i2c1.write(0x00);
    i2c1.endTransmission();
    sys_delay(10);
    i2c1.requestFrom(dev->address, 1);
    return (i2c1.read() & 0x08) ? 1 : 0;    // bit3 = calibrated
}

// Triggers one measurement and returns both raw 20-bit values.
static void _measure(AHT10_t *d, uint32_t *rawH, uint32_t *rawT) {
    i2c1.beginTransmission(d->address);
    i2c1.write(0xAC);
    i2c1.write(0x33);
    i2c1.write(0x00);
    i2c1.endTransmission();
    sys_delay(85);                          // ~75ms conversion

    i2c1.requestFrom(d->address, 6);
    uint8_t b[6];
    for (uint8_t i = 0; i < 6; i++) b[i] = (uint8_t)i2c1.read();
    *rawH = ((uint32_t)b[1] << 12) | ((uint32_t)b[2] << 4) | (b[3] >> 4);
    *rawT = (((uint32_t)b[3] & 0x0F) << 16) | ((uint32_t)b[4] << 8) | b[5];
}

float AHT10_readTemperature(AHT10_t *dev) {
    uint32_t h, t; _measure(dev, &h, &t);
    return (float)t * 200.0f / 1048576.0f - 50.0f;
}

float AHT10_readHumidity(AHT10_t *dev) {
    uint32_t h, t; _measure(dev, &h, &t);
    return (float)h * 100.0f / 1048576.0f;
}
