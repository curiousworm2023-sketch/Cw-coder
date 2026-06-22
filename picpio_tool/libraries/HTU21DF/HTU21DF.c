// HTU21DF.c — see HTU21DF.h. Uses the "no hold master" measurement commands so
// the bus is free during the conversion.
#include "HTU21DF.h"

static uint16_t _measure(htu21df_t *d, uint8_t cmd) {
    i2c1.beginTransmission(d->address);
    i2c1.write(cmd);
    i2c1.endTransmission();
    sys_delay(55);                         // max conversion time (14-bit)

    i2c1.requestFrom(d->address, 3);
    uint8_t msb = (uint8_t)i2c1.read();
    uint8_t lsb = (uint8_t)i2c1.read();
    (void)i2c1.read();                     // CRC (ignored)

    // Low two status bits are not part of the measurement.
    return (uint16_t)(((msb << 8) | lsb) & 0xFFFC);
}

uint8_t htu21df_begin(htu21df_t *dev, uint8_t addr) {
    dev->address = addr;
    i2c1.beginTransmission(dev->address);
    i2c1.write(0xFE);                      // soft reset
    i2c1.endTransmission();
    sys_delay(15);
    return 1;
}

float htu21df_readTemperature(htu21df_t *dev) {
    uint16_t raw = _measure(dev, 0xF3);    // trigger temperature, no hold
    return -46.85f + 175.72f * (float)raw / 65536.0f;
}

float htu21df_readHumidity(htu21df_t *dev) {
    uint16_t raw = _measure(dev, 0xF5);    // trigger humidity, no hold
    return -6.0f + 125.0f * (float)raw / 65536.0f;
}
