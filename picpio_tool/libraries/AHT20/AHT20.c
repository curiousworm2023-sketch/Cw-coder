// AHT20.c — see AHT20.h
#include "AHT20.h"

static uint8_t _status(aht20_t *d) {
    i2c1.requestFrom(d->address, 1);
    return (uint8_t)i2c1.read();
}

uint8_t aht20_begin(aht20_t *dev) {
    dev->address = AHT20_ADDR;
    sys_delay(40);                          // power-up time

    i2c1.beginTransmission(dev->address);   // initialize / calibrate
    i2c1.write(0xBE);
    i2c1.write(0x08);
    i2c1.write(0x00);
    i2c1.endTransmission();
    sys_delay(10);

    return (_status(dev) & 0x08) ? 1 : 0;   // bit3 = calibrated
}

uint8_t aht20_read(aht20_t *dev, float *tempC, float *humidity) {
    i2c1.beginTransmission(dev->address);   // trigger measurement
    i2c1.write(0xAC);
    i2c1.write(0x33);
    i2c1.write(0x00);
    i2c1.endTransmission();

    // Wait for the busy bit (bit7) to clear — typ. 80ms.
    for (uint8_t i = 0; i < 20; i++) {
        sys_delay(10);
        if (!(_status(dev) & 0x80)) break;
    }

    i2c1.requestFrom(dev->address, 7);
    uint8_t b[7];
    for (uint8_t i = 0; i < 7; i++) b[i] = (uint8_t)i2c1.read();
    if (b[0] & 0x80) return 0;              // still busy

    uint32_t rawH = ((uint32_t)b[1] << 12) | ((uint32_t)b[2] << 4) | (b[3] >> 4);
    uint32_t rawT = (((uint32_t)b[3] & 0x0F) << 16) | ((uint32_t)b[4] << 8) | b[5];

    *humidity = (float)rawH * 100.0f  / 1048576.0f;          // 2^20
    *tempC    = (float)rawT * 200.0f  / 1048576.0f - 50.0f;
    return 1;
}
