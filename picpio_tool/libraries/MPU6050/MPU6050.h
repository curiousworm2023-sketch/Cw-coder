// MPU6050.h — PICPIO C driver for the InvenSense MPU-6050 6-axis IMU
// (3-axis accelerometer + 3-axis gyroscope, I2C).
//
// Usage:
//   mpu6050_t mpu;
//   void init() { i2c1.begin(); mpu6050_begin(&mpu, MPU6050_ADDR); }
//   void run()  {
//     float ax,ay,az, gx,gy,gz;
//     mpu6050_readAccel(&mpu, &ax,&ay,&az);   // g
//     mpu6050_readGyro(&mpu,  &gx,&gy,&gz);   // deg/s
//     float t = mpu6050_readTemp(&mpu);       // degrees C
//   }
#ifndef MPU6050_H
#define MPU6050_H

#include "Picpio.h"

#ifndef MPU6050_ADDR
#define MPU6050_ADDR 0x68           // 0x69 if AD0 is tied high
#endif

typedef struct { uint8_t address; } mpu6050_t;

uint8_t mpu6050_begin(mpu6050_t *dev, uint8_t addr);   // wakes device; returns 1 if WHO_AM_I ok
void    mpu6050_readAccel(mpu6050_t *dev, float *ax, float *ay, float *az);  // g  (default +/-2g)
void    mpu6050_readGyro (mpu6050_t *dev, float *gx, float *gy, float *gz);  // deg/s (default +/-250)
float   mpu6050_readTemp (mpu6050_t *dev);                                    // degrees C

#endif // MPU6050_H
