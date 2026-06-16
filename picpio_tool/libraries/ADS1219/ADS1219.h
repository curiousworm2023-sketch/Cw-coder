// ADS1219.h — PICPIO C driver for the TI ADS1219 24-bit I2C ADC
// Usage: ADS1219_t adc; ADS1219_init(&adc); ADS1219_begin(&adc, ADS1219_ADDRESS);
//        ADS1219_setConfig(&adc, ADS1219_MUX_AIN0, ADS1219_GAIN_1X,
//                          ADS1219_DR_20SPS, ADS1219_MODE_SINGLE_SHOT, ADS1219_VREF_INTERNAL);
//        int32_t raw = ADS1219_readSingleShot(&adc);
//        float volts = ADS1219_computeVolts(&adc, raw);
#ifndef ADS1219_H
#define ADS1219_H

#include "Picpio.h"

// Default 7-bit I2C address (A0=A1=GND). Define ADS1219_ADDRESS before
// #include "ADS1219.h" to override.
#ifndef ADS1219_ADDRESS
#define ADS1219_ADDRESS 0x40
#endif

// Commands
#define ADS1219_CMD_RESET       0x06
#define ADS1219_CMD_START_SYNC  0x08
#define ADS1219_CMD_POWERDOWN   0x02
#define ADS1219_CMD_RDATA       0x10
#define ADS1219_CMD_WREG        0x40
#define ADS1219_CMD_RREG_CONFIG 0x20
#define ADS1219_CMD_RREG_STATUS 0x24

// Config register: MUX (bits 7-5)
#define ADS1219_MUX_AIN0_AIN1 0x00  // differential AIN0-AIN1 (default)
#define ADS1219_MUX_AIN2_AIN3 0x20  // differential AIN2-AIN3
#define ADS1219_MUX_AIN1_AIN2 0x40  // differential AIN1-AIN2
#define ADS1219_MUX_AIN0      0x60  // single-ended AIN0
#define ADS1219_MUX_AIN1      0x80  // single-ended AIN1
#define ADS1219_MUX_AIN2      0xA0  // single-ended AIN2
#define ADS1219_MUX_AIN3      0xC0  // single-ended AIN3
#define ADS1219_MUX_SHORTED   0xE0  // (AIN0+AIN1)/2, shorted inputs

// Config register: GAIN (bit 4)
#define ADS1219_GAIN_1X 0x00
#define ADS1219_GAIN_4X 0x10

// Config register: data rate (bits 3-2)
#define ADS1219_DR_20SPS   0x00
#define ADS1219_DR_90SPS   0x04
#define ADS1219_DR_330SPS  0x08
#define ADS1219_DR_1000SPS 0x0C

// Config register: conversion mode (bit 1)
#define ADS1219_MODE_SINGLE_SHOT 0x00
#define ADS1219_MODE_CONTINUOUS  0x02

// Config register: voltage reference (bit 0)
#define ADS1219_VREF_INTERNAL 0x00  // 2.048V internal reference
#define ADS1219_VREF_EXTERNAL 0x01  // REFP-REFN external reference

// Status register
#define ADS1219_STATUS_DRDY 0x80

typedef struct {
    uint8_t address;
    uint8_t config;
    float   vref;   // reference voltage in volts (2.048 for internal)
    uint8_t gain;   // ADS1219_GAIN_1X or ADS1219_GAIN_4X (cached for computeVolts)
} ADS1219_t;

// Sets defaults (address=ADS1219_ADDRESS, internal 2.048V ref, gain 1x).
void ADS1219_init(ADS1219_t *dev);

// Probes the device on the I2C bus. Returns false if it doesn't ACK.
bool ADS1219_begin(ADS1219_t *dev, uint8_t i2cAddr);

// Sends the RESET command, returning the device to its default configuration.
void ADS1219_reset(ADS1219_t *dev);

// Writes the config register (combine MUX | GAIN | DR | MODE | VREF flags).
void ADS1219_setConfig(ADS1219_t *dev, uint8_t mux, uint8_t gain, uint8_t dataRate,
                        uint8_t mode, uint8_t vref);

// If using VREF_EXTERNAL, set the actual reference voltage for computeVolts().
void ADS1219_setExternalVref(ADS1219_t *dev, float vrefVolts);

// Sends START/SYNC — begins a conversion (single-shot) or restarts continuous mode.
void ADS1219_start(ADS1219_t *dev);

// Reads the status register and returns true if a new conversion result is ready.
bool ADS1219_dataReady(ADS1219_t *dev);

// Reads the 24-bit conversion result via RDATA, sign-extended to int32_t.
int32_t ADS1219_readRaw(ADS1219_t *dev);

// Starts a single-shot conversion, blocks until DRDY, and returns the result.
int32_t ADS1219_readSingleShot(ADS1219_t *dev);

// Converts a raw code to volts using the configured reference and gain.
float ADS1219_computeVolts(ADS1219_t *dev, int32_t raw);

#endif // ADS1219_H
