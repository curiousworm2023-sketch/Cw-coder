// INA219.c — see INA219.h. 32V/2A calibration: current LSB = 0.1 mA/bit,
// power LSB = 2 mW/bit, bus-voltage LSB = 4 mV/bit (TI datasheet, Adafruit cfg).
#include "INA219.h"

#define REG_CONFIG   0x00
#define REG_SHUNT    0x01
#define REG_BUS      0x02
#define REG_POWER    0x03
#define REG_CURRENT  0x04
#define REG_CALIB    0x05

static void _w16(ina219_t *d, uint8_t reg, uint16_t val) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.write((uint8_t)(val >> 8));
    i2c1.write((uint8_t)(val & 0xFF));
    i2c1.endTransmission();
}

static int16_t _r16(ina219_t *d, uint8_t reg) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.endTransmission();
    i2c1.requestFrom(d->address, 2);
    uint8_t hi = (uint8_t)i2c1.read();
    uint8_t lo = (uint8_t)i2c1.read();
    return (int16_t)((hi << 8) | lo);
}

uint8_t ina219_begin(ina219_t *dev, uint8_t addr) {
    dev->address = addr;
    // Calibration for 32V / 2A with a 0.1 ohm shunt → current LSB 0.1 mA.
    _w16(dev, REG_CALIB, 4096);
    // Config: bus 32V range, PGA /8 (+/-320mV), 12-bit 1-sample averaging,
    // shunt+bus continuous (0x399F).
    _w16(dev, REG_CONFIG, 0x399F);
    return 1;
}

float ina219_shuntVoltage(ina219_t *dev) {
    return (float)_r16(dev, REG_SHUNT) * 0.01f;       // 10 uV/bit → mV
}

float ina219_busVoltage(ina219_t *dev) {
    // Bits 15..3 hold the voltage; LSB = 4 mV.
    int16_t raw = _r16(dev, REG_BUS);
    return (float)((raw >> 3) * 4) * 0.001f;          // mV → V
}

float ina219_current(ina219_t *dev) {
    // Re-write calibration first (cleared on power-fault) for a stable reading.
    _w16(dev, REG_CALIB, 4096);
    return (float)_r16(dev, REG_CURRENT) * 0.1f;      // 0.1 mA/bit
}

float ina219_power(ina219_t *dev) {
    _w16(dev, REG_CALIB, 4096);
    return (float)_r16(dev, REG_POWER) * 2.0f;        // 2 mW/bit
}
