// MPU6050.c — see MPU6050.h. Default full-scale ranges (+/-2g, +/-250 deg/s).
#include "MPU6050.h"

static void _w8(mpu6050_t *d, uint8_t reg, uint8_t val) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.write(val);
    i2c1.endTransmission();
}

// Reads up to 8 bytes (the MPU6050 Wire RX buffer limit on XC16 HALs).
static void _readN(mpu6050_t *d, uint8_t reg, uint8_t *buf, uint8_t n) {
    i2c1.beginTransmission(d->address);
    i2c1.write(reg);
    i2c1.endTransmission();
    i2c1.requestFrom(d->address, n);
    for (uint8_t i = 0; i < n; i++) buf[i] = (uint8_t)i2c1.read();
}

uint8_t mpu6050_begin(mpu6050_t *dev, uint8_t addr) {
    dev->address = addr;

    uint8_t who; _readN(dev, 0x75, &who, 1);        // WHO_AM_I
    if (who != 0x68 && who != 0x72) return 0;       // 0x68 MPU6050, 0x72 MPU6500/9250 variants

    _w8(dev, 0x6B, 0x00);                            // PWR_MGMT_1: wake, internal 8MHz osc
    sys_delay(100);
    _w8(dev, 0x1B, 0x00);                            // GYRO_CONFIG:  +/-250 deg/s
    _w8(dev, 0x1C, 0x00);                            // ACCEL_CONFIG: +/-2g
    return 1;
}

void mpu6050_readAccel(mpu6050_t *dev, float *ax, float *ay, float *az) {
    uint8_t b[6];
    _readN(dev, 0x3B, b, 6);
    *ax = (int16_t)((b[0] << 8) | b[1]) / 16384.0f;
    *ay = (int16_t)((b[2] << 8) | b[3]) / 16384.0f;
    *az = (int16_t)((b[4] << 8) | b[5]) / 16384.0f;
}

void mpu6050_readGyro(mpu6050_t *dev, float *gx, float *gy, float *gz) {
    uint8_t b[6];
    _readN(dev, 0x43, b, 6);
    *gx = (int16_t)((b[0] << 8) | b[1]) / 131.0f;
    *gy = (int16_t)((b[2] << 8) | b[3]) / 131.0f;
    *gz = (int16_t)((b[4] << 8) | b[5]) / 131.0f;
}

float mpu6050_readTemp(mpu6050_t *dev) {
    uint8_t b[2];
    _readN(dev, 0x41, b, 2);
    int16_t raw = (int16_t)((b[0] << 8) | b[1]);
    return (float)raw / 340.0f + 36.53f;
}
