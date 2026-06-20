// BMP280.c — see BMP280.h. Compensation formulas are Bosch Sensortec's
// reference fixed-point routines (BSD-3-Clause).
#include "BMP280.h"

static void _w8(bmp280_t *d, uint8_t reg, uint8_t val) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.write(val);
    i2c1.endTransmission();
}

// Reads chunked to <=8 bytes so this works on every PICPIO HAL, including the
// XC16 ones whose Wire receive buffer is only 8 bytes.
static void _readN(bmp280_t *d, uint8_t reg, uint8_t *buf, uint8_t n) {
    while (n) {
        uint8_t c = (n > 8) ? 8 : n;
        i2c1.beginTransmission(d->address);
        i2c1.write(reg);
        i2c1.endTransmission();
        i2c1.requestFrom(d->address, c);
        for (uint8_t i = 0; i < c; i++) *buf++ = (uint8_t)i2c1.read();
        reg = (uint8_t)(reg + c);
        n   = (uint8_t)(n - c);
    }
}

static uint8_t _r8(bmp280_t *d, uint8_t reg) { uint8_t v; _readN(d, reg, &v, 1); return v; }

static int32_t _comp_T(bmp280_t *d, int32_t adc_T) {
    int32_t v1, v2;
    v1 = ((((adc_T >> 3) - ((int32_t)d->T1 << 1))) * ((int32_t)d->T2)) >> 11;
    v2 = (((((adc_T >> 4) - ((int32_t)d->T1)) * ((adc_T >> 4) - ((int32_t)d->T1))) >> 12)
          * ((int32_t)d->T3)) >> 14;
    d->t_fine = v1 + v2;
    return (d->t_fine * 5 + 128) >> 8;            // hundredths of a degree C
}

static uint32_t _comp_P(bmp280_t *d, int32_t adc_P) {
    int32_t v1, v2;
    uint32_t p;
    v1 = (((int32_t)d->t_fine) >> 1) - (int32_t)64000;
    v2 = (((v1 >> 2) * (v1 >> 2)) >> 11) * ((int32_t)d->P6);
    v2 = v2 + ((v1 * ((int32_t)d->P5)) << 1);
    v2 = (v2 >> 2) + (((int32_t)d->P4) << 16);
    v1 = (((d->P3 * (((v1 >> 2) * (v1 >> 2)) >> 13)) >> 3)
          + ((((int32_t)d->P2) * v1) >> 1)) >> 18;
    v1 = ((((32768 + v1)) * ((int32_t)d->P1)) >> 15);
    if (v1 == 0) return 0;                         // avoid divide-by-zero
    p = (((uint32_t)(((int32_t)1048576) - adc_P) - (v2 >> 12))) * 3125;
    if (p < 0x80000000UL) p = (p << 1) / ((uint32_t)v1);
    else                  p = (p / (uint32_t)v1) * 2;
    v1 = (((int32_t)d->P9) * ((int32_t)(((p >> 3) * (p >> 3)) >> 13))) >> 12;
    v2 = (((int32_t)(p >> 2)) * ((int32_t)d->P8)) >> 13;
    p = (uint32_t)((int32_t)p + ((v1 + v2 + d->P7) >> 4));
    return p;                                      // Pascals
}

uint8_t bmp280_begin(bmp280_t *dev, uint8_t addr) {
    dev->address = addr;
    dev->t_fine  = 0;

    if (_r8(dev, 0xD0) != 0x58) return 0;          // chip id (0x58 = BMP280)

    _w8(dev, 0xE0, 0xB6);                           // soft reset
    sys_delay(10);

    uint8_t c[24];
    _readN(dev, 0x88, c, 24);                       // T/P calibration
    dev->T1 = (uint16_t)(c[0]  | (c[1]  << 8));
    dev->T2 = (int16_t) (c[2]  | (c[3]  << 8));
    dev->T3 = (int16_t) (c[4]  | (c[5]  << 8));
    dev->P1 = (uint16_t)(c[6]  | (c[7]  << 8));
    dev->P2 = (int16_t) (c[8]  | (c[9]  << 8));
    dev->P3 = (int16_t) (c[10] | (c[11] << 8));
    dev->P4 = (int16_t) (c[12] | (c[13] << 8));
    dev->P5 = (int16_t) (c[14] | (c[15] << 8));
    dev->P6 = (int16_t) (c[16] | (c[17] << 8));
    dev->P7 = (int16_t) (c[18] | (c[19] << 8));
    dev->P8 = (int16_t) (c[20] | (c[21] << 8));
    dev->P9 = (int16_t) (c[22] | (c[23] << 8));

    _w8(dev, 0xF4, 0x27);                           // ctrl_meas: temp 1x, press 1x, normal mode
    _w8(dev, 0xF5, 0xA0);                           // config: standby 1000ms, filter off
    return 1;
}

static void _readRaw(bmp280_t *d, int32_t *aT, int32_t *aP) {
    uint8_t b[6];
    _readN(d, 0xF7, b, 6);
    *aP = (int32_t)(((uint32_t)b[0] << 12) | ((uint32_t)b[1] << 4) | (b[2] >> 4));
    *aT = (int32_t)(((uint32_t)b[3] << 12) | ((uint32_t)b[4] << 4) | (b[5] >> 4));
}

float bmp280_readTemperature(bmp280_t *dev) {
    int32_t aT, aP; _readRaw(dev, &aT, &aP);
    return _comp_T(dev, aT) / 100.0f;
}

float bmp280_readPressure(bmp280_t *dev) {
    int32_t aT, aP; _readRaw(dev, &aT, &aP);
    _comp_T(dev, aT);                               // refresh t_fine first
    return (float)_comp_P(dev, aP);
}
