// ADS1219.c — PICPIO C driver for the TI ADS1219 24-bit I2C ADC
#include "ADS1219.h"

static void ADS1219_sendCommand(ADS1219_t *dev, uint8_t cmd)
{
    Wire.beginTransmission(dev->address);
    Wire.write(cmd);
    Wire.endTransmission();
}

void ADS1219_init(ADS1219_t *dev)
{
    dev->address = ADS1219_ADDRESS;
    dev->config  = ADS1219_MUX_AIN0_AIN1 | ADS1219_GAIN_1X | ADS1219_DR_20SPS |
                    ADS1219_MODE_SINGLE_SHOT | ADS1219_VREF_INTERNAL;
    dev->vref = 2.048f;
    dev->gain = ADS1219_GAIN_1X;
}

bool ADS1219_begin(ADS1219_t *dev, uint8_t i2cAddr)
{
    dev->address = i2cAddr;
    Wire.beginTransmission(dev->address);
    return Wire.endTransmission() == 0;
}

void ADS1219_reset(ADS1219_t *dev)
{
    ADS1219_sendCommand(dev, ADS1219_CMD_RESET);
    dev->config = ADS1219_MUX_AIN0_AIN1 | ADS1219_GAIN_1X | ADS1219_DR_20SPS |
                   ADS1219_MODE_SINGLE_SHOT | ADS1219_VREF_INTERNAL;
    dev->gain = ADS1219_GAIN_1X;
}

void ADS1219_setConfig(ADS1219_t *dev, uint8_t mux, uint8_t gain, uint8_t dataRate,
                        uint8_t mode, uint8_t vref)
{
    dev->config = mux | gain | dataRate | mode | vref;
    dev->gain   = gain;
    if (vref == ADS1219_VREF_INTERNAL) dev->vref = 2.048f;

    Wire.beginTransmission(dev->address);
    Wire.write(ADS1219_CMD_WREG);
    Wire.write(dev->config);
    Wire.endTransmission();
}

void ADS1219_setExternalVref(ADS1219_t *dev, float vrefVolts)
{
    dev->vref = vrefVolts;
}

void ADS1219_start(ADS1219_t *dev)
{
    ADS1219_sendCommand(dev, ADS1219_CMD_START_SYNC);
}

bool ADS1219_dataReady(ADS1219_t *dev)
{
    Wire.beginTransmission(dev->address);
    Wire.write(ADS1219_CMD_RREG_STATUS);
    Wire.endTransmission();
    Wire.requestFrom(dev->address, 1);
    uint8_t status = Wire.read();
    return (status & ADS1219_STATUS_DRDY) != 0;
}

int32_t ADS1219_readRaw(ADS1219_t *dev)
{
    Wire.beginTransmission(dev->address);
    Wire.write(ADS1219_CMD_RDATA);
    Wire.endTransmission();
    Wire.requestFrom(dev->address, 3);

    uint32_t b2 = Wire.read();
    uint32_t b1 = Wire.read();
    uint32_t b0 = Wire.read();
    uint32_t raw = (b2 << 16) | (b1 << 8) | b0;

    // sign-extend 24-bit two's complement to 32-bit
    if (raw & 0x800000UL) raw |= 0xFF000000UL;
    return (int32_t)raw;
}

int32_t ADS1219_readSingleShot(ADS1219_t *dev)
{
    ADS1219_start(dev);
    while (!ADS1219_dataReady(dev)) { }
    return ADS1219_readRaw(dev);
}

float ADS1219_computeVolts(ADS1219_t *dev, int32_t raw)
{
    float gainFactor = (dev->gain == ADS1219_GAIN_4X) ? 4.0f : 1.0f;
    return ((float)raw * dev->vref) / (8388608.0f * gainFactor);
}
