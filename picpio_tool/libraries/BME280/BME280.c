// BME280.c — see BME280.h. Compensation formulas are Bosch Sensortec's
// reference fixed-point routines (BSD-3-Clause).
#include "BME280.h"

// ── Low-level I2C ─────────────────────────────────────────────────────────────
// Reads are chunked to <=8 bytes so this works on every PICPIO HAL, including
// the XC16 ones whose Wire receive buffer is only 8 bytes.
static void _w8(bme280_t *d, uint8_t reg, uint8_t val) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.write(val);
    i2c1.endTransmission();
}

static void _readN(bme280_t *d, uint8_t reg, uint8_t *buf, uint8_t n) {
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

static uint8_t _r8(bme280_t *d, uint8_t reg) { uint8_t v; _readN(d, reg, &v, 1); return v; }

// ── Bosch fixed-point compensation (reference algorithms) ─────────────────────
static int32_t _comp_T(bme280_t *d, int32_t adc_T) {
    int32_t v1, v2;
    v1 = ((((adc_T >> 3) - ((int32_t)d->T1 << 1))) * ((int32_t)d->T2)) >> 11;
    v2 = (((((adc_T >> 4) - ((int32_t)d->T1)) * ((adc_T >> 4) - ((int32_t)d->T1))) >> 12)
          * ((int32_t)d->T3)) >> 14;
    d->t_fine = v1 + v2;
    return (d->t_fine * 5 + 128) >> 8;            // hundredths of a degree C
}

static uint32_t _comp_P(bme280_t *d, int32_t adc_P) {
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

static uint32_t _comp_H(bme280_t *d, int32_t adc_H) {
    int32_t v = (d->t_fine - ((int32_t)76800));
    v = (((((adc_H << 14) - (((int32_t)d->H4) << 20) - (((int32_t)d->H5) * v))
          + ((int32_t)16384)) >> 15)
         * (((((((v * ((int32_t)d->H6)) >> 10)
               * (((v * ((int32_t)d->H3)) >> 11) + ((int32_t)32768))) >> 10)
             + ((int32_t)2097152)) * ((int32_t)d->H2) + 8192) >> 14));
    v = v - (((((v >> 15) * (v >> 15)) >> 7) * ((int32_t)d->H1)) >> 4);
    if (v < 0)         v = 0;
    if (v > 419430400) v = 419430400;
    return (uint32_t)(v >> 12);                    // %RH in Q22.10 (units of 1/1024)
}

// ── Public API ────────────────────────────────────────────────────────────────
uint8_t bme280_begin(bme280_t *dev, uint8_t addr) {
    dev->address = addr;
    dev->t_fine  = 0;

    uint8_t id = _r8(dev, 0xD0);                    // chip id
    if (id != 0x60 && id != 0x58) return 0;        // 0x60 = BME280, 0x58 = BMP280

    _w8(dev, 0xE0, 0xB6);                           // soft reset
    sys_delay(10);                                  // wait for NVM copy

    uint8_t c[26];
    _readN(dev, 0x88, c, 26);                       // T/P calibration (+ H1 at end)
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
    dev->H1 = c[25];

    uint8_t h[7];
    _readN(dev, 0xE1, h, 7);                        // humidity calibration
    dev->H2 = (int16_t)(h[0] | (h[1] << 8));
    dev->H3 = h[2];
    dev->H4 = (int16_t)(((int8_t)h[3] << 4) | (h[4] & 0x0F));
    dev->H5 = (int16_t)(((int8_t)h[5] << 4) | (h[4] >> 4));
    dev->H6 = (int8_t)h[6];

    _w8(dev, 0xF2, 0x01);                           // ctrl_hum: humidity 1x
    _w8(dev, 0xF4, 0x27);                           // ctrl_meas: temp 1x, press 1x, normal mode
    _w8(dev, 0xF5, 0xA0);                           // config: standby 1000ms, filter off
    return 1;
}

static void _readRaw(bme280_t *d, int32_t *aT, int32_t *aP, int32_t *aH) {
    uint8_t b[8];
    _readN(d, 0xF7, b, 8);
    *aP = (int32_t)(((uint32_t)b[0] << 12) | ((uint32_t)b[1] << 4) | (b[2] >> 4));
    *aT = (int32_t)(((uint32_t)b[3] << 12) | ((uint32_t)b[4] << 4) | (b[5] >> 4));
    *aH = (int32_t)(((uint32_t)b[6] << 8)  | b[7]);
}

float bme280_readTemperature(bme280_t *dev) {
    int32_t aT, aP, aH; _readRaw(dev, &aT, &aP, &aH);
    return _comp_T(dev, aT) / 100.0f;
}

float bme280_readPressure(bme280_t *dev) {
    int32_t aT, aP, aH; _readRaw(dev, &aT, &aP, &aH);
    _comp_T(dev, aT);                               // refresh t_fine
    return (float)_comp_P(dev, aP);
}

float bme280_readHumidity(bme280_t *dev) {
    int32_t aT, aP, aH; _readRaw(dev, &aT, &aP, &aH);
    _comp_T(dev, aT);                               // refresh t_fine
    return _comp_H(dev, aH) / 1024.0f;
}
