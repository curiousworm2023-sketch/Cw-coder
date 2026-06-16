// ADS1115.c — PICPIO C port of the ADS1115_CWORM 16-bit I2C ADC driver
#include "ADS1115.h"

#define ADS1115_REG_CONVERT  0x00
#define ADS1115_REG_CONFIG   0x01

#define ADS1115_CFG_CQUE_NONE   0x0003
#define ADS1115_CFG_MODE_SINGLE 0x0100
#define ADS1115_CFG_OS_SINGLE   0x8000

#define ADS1115_MUX_DIFF_0_1 0x0000
#define ADS1115_MUX_DIFF_0_3 0x1000
#define ADS1115_MUX_DIFF_1_3 0x2000
#define ADS1115_MUX_DIFF_2_3 0x3000
#define ADS1115_MUX_SINGLE_0 0x4000
#define ADS1115_MUX_SINGLE_1 0x5000
#define ADS1115_MUX_SINGLE_2 0x6000
#define ADS1115_MUX_SINGLE_3 0x7000

static void ADS1115_writeRegister(ADS1115_t *dev, uint8_t reg, uint16_t value)
{
    Wire.beginTransmission(dev->address);
    Wire.write(reg);
    Wire.write((uint8_t)(value >> 8));
    Wire.write((uint8_t)(value & 0xFF));
    Wire.endTransmission();
}

static uint16_t ADS1115_readRegister(ADS1115_t *dev, uint8_t reg)
{
    Wire.beginTransmission(dev->address);
    Wire.write(reg);
    Wire.endTransmission();
    Wire.requestFrom(dev->address, 2);
    uint16_t hi = Wire.read();
    uint16_t lo = Wire.read();
    return (hi << 8) | lo;
}

static void ADS1115_startReading(ADS1115_t *dev, uint16_t mux)
{
    uint16_t config = ADS1115_CFG_CQUE_NONE | ADS1115_CFG_MODE_SINGLE |
                       dev->gain | dev->dataRate | mux | ADS1115_CFG_OS_SINGLE;
    ADS1115_writeRegister(dev, ADS1115_REG_CONFIG, config);
}

static bool ADS1115_conversionComplete(ADS1115_t *dev)
{
    return (ADS1115_readRegister(dev, ADS1115_REG_CONFIG) & ADS1115_CFG_OS_SINGLE) != 0;
}

static int16_t ADS1115_lastConversion(ADS1115_t *dev)
{
    return (int16_t)ADS1115_readRegister(dev, ADS1115_REG_CONVERT);
}

void ADS1115_init(ADS1115_t *dev)
{
    dev->address  = ADS1115_ADDRESS;
    dev->gain     = ADS1115_GAIN_TWOTHIRDS;
    dev->dataRate = ADS1115_RATE_128SPS;
}

bool ADS1115_begin(ADS1115_t *dev, uint8_t i2cAddr)
{
    dev->address = i2cAddr;
    Wire.beginTransmission(dev->address);
    return Wire.endTransmission() == 0;
}

void ADS1115_setGain(ADS1115_t *dev, uint16_t gain)
{
    dev->gain = gain;
}

uint16_t ADS1115_getGain(ADS1115_t *dev)
{
    return dev->gain;
}

void ADS1115_setDataRate(ADS1115_t *dev, uint16_t rate)
{
    dev->dataRate = rate;
}

uint16_t ADS1115_getDataRate(ADS1115_t *dev)
{
    return dev->dataRate;
}

int16_t ADS1115_readADC_SingleEnded(ADS1115_t *dev, uint8_t channel)
{
    if (channel > 3) return 0;
    const uint16_t muxes[] = {
        ADS1115_MUX_SINGLE_0, ADS1115_MUX_SINGLE_1,
        ADS1115_MUX_SINGLE_2, ADS1115_MUX_SINGLE_3
    };
    ADS1115_startReading(dev, muxes[channel]);
    while (!ADS1115_conversionComplete(dev)) { }
    return ADS1115_lastConversion(dev);
}

int16_t ADS1115_readADC_Differential_0_1(ADS1115_t *dev)
{
    ADS1115_startReading(dev, ADS1115_MUX_DIFF_0_1);
    while (!ADS1115_conversionComplete(dev)) { }
    return ADS1115_lastConversion(dev);
}

int16_t ADS1115_readADC_Differential_0_3(ADS1115_t *dev)
{
    ADS1115_startReading(dev, ADS1115_MUX_DIFF_0_3);
    while (!ADS1115_conversionComplete(dev)) { }
    return ADS1115_lastConversion(dev);
}

int16_t ADS1115_readADC_Differential_1_3(ADS1115_t *dev)
{
    ADS1115_startReading(dev, ADS1115_MUX_DIFF_1_3);
    while (!ADS1115_conversionComplete(dev)) { }
    return ADS1115_lastConversion(dev);
}

int16_t ADS1115_readADC_Differential_2_3(ADS1115_t *dev)
{
    ADS1115_startReading(dev, ADS1115_MUX_DIFF_2_3);
    while (!ADS1115_conversionComplete(dev)) { }
    return ADS1115_lastConversion(dev);
}

float ADS1115_computeVolts(ADS1115_t *dev, int16_t counts)
{
    float fsRange;
    switch (dev->gain) {
        case ADS1115_GAIN_TWOTHIRDS: fsRange = 6.144f; break;
        case ADS1115_GAIN_1X:        fsRange = 4.096f; break;
        case ADS1115_GAIN_2X:        fsRange = 2.048f; break;
        case ADS1115_GAIN_4X:        fsRange = 1.024f; break;
        case ADS1115_GAIN_8X:        fsRange = 0.512f; break;
        case ADS1115_GAIN_16X:       fsRange = 0.256f; break;
        default: fsRange = 0.0f;
    }
    return counts * (fsRange / 32768.0f);
}
