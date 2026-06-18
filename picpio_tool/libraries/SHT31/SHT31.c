// SHT31.c — see SHT31.h
#include "SHT31.h"

static void _cmd(sht31_t *d, uint16_t c) {
    i2c1.beginTransmission(d->address);
    i2c1.write((uint8_t)(c >> 8));
    i2c1.write((uint8_t)(c & 0xFF));
    i2c1.endTransmission();
}

uint8_t sht31_begin(sht31_t *dev, uint8_t addr) {
    dev->address = addr;
    _cmd(dev, 0x30A2);              // soft reset
    sys_delay(2);
    return 1;
}

uint8_t sht31_read(sht31_t *dev, float *tempC, float *humidity) {
    _cmd(dev, 0x2400);             // single shot, high repeatability, no clock stretch
    sys_delay(20);                 // ~15ms conversion

    i2c1.requestFrom(dev->address, 6);
    uint8_t b[6];
    for (uint8_t i = 0; i < 6; i++) b[i] = (uint8_t)i2c1.read();

    uint16_t rawT = (uint16_t)((b[0] << 8) | b[1]);   // b[2] = CRC (ignored)
    uint16_t rawH = (uint16_t)((b[3] << 8) | b[4]);   // b[5] = CRC (ignored)

    *tempC    = -45.0f + 175.0f * ((float)rawT / 65535.0f);
    *humidity = 100.0f * ((float)rawH / 65535.0f);
    return 1;
}
