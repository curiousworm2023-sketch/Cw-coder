// SHT4x.c — see SHT4x.h
#include "SHT4x.h"

uint8_t SHT4x_init(SHT4x_t *dev, uint8_t addr) {
    dev->address = addr;
    i2c1.beginTransmission(dev->address);
    i2c1.write(0x94);                       // soft reset
    i2c1.endTransmission();
    sys_delay(2);
    return 1;
}

uint8_t SHT4x_getEvent(SHT4x_t *dev, float *tempC, float *humidity) {
    i2c1.beginTransmission(dev->address);
    i2c1.write(0xFD);                       // measure, high precision
    i2c1.endTransmission();
    sys_delay(10);                          // ~8.3ms conversion

    i2c1.requestFrom(dev->address, 6);
    uint8_t b[6];
    for (uint8_t i = 0; i < 6; i++) b[i] = (uint8_t)i2c1.read();

    uint16_t rawT = (uint16_t)((b[0] << 8) | b[1]);   // b[2] = CRC
    uint16_t rawH = (uint16_t)((b[3] << 8) | b[4]);   // b[5] = CRC

    *tempC = -45.0f + 175.0f * (float)rawT / 65535.0f;
    float h = -6.0f + 125.0f * (float)rawH / 65535.0f;
    if (h < 0.0f)   h = 0.0f;
    if (h > 100.0f) h = 100.0f;
    *humidity = h;
    return 1;
}
