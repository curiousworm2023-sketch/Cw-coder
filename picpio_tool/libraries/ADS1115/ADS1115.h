// ADS1115.h — PICPIO C port of the ADS1115_CWORM 16-bit I2C ADC driver
// Usage: ADS1115_t adc; ADS1115_init(&adc); ADS1115_begin(&adc, ADS1115_ADDRESS);
//        ADS1115_setGain(&adc, ADS1115_GAIN_TWOTHIRDS);
//        int16_t raw = ADS1115_readADC_SingleEnded(&adc, 0);
//        float volts = ADS1115_computeVolts(&adc, raw);
#ifndef ADS1115_H
#define ADS1115_H

#include "Picpio.h"

#ifndef ADS1115_ADDRESS
#define ADS1115_ADDRESS 0x48
#endif

// Programmable gain amplifier settings (also select the full-scale range)
#define ADS1115_GAIN_TWOTHIRDS 0x0000  // +/-6.144V
#define ADS1115_GAIN_1X        0x0200  // +/-4.096V
#define ADS1115_GAIN_2X        0x0400  // +/-2.048V
#define ADS1115_GAIN_4X        0x0600  // +/-1.024V
#define ADS1115_GAIN_8X        0x0800  // +/-0.512V
#define ADS1115_GAIN_16X       0x0A00  // +/-0.256V

// Data rate (samples per second)
#define ADS1115_RATE_8SPS    0x0000
#define ADS1115_RATE_16SPS   0x0020
#define ADS1115_RATE_32SPS   0x0040
#define ADS1115_RATE_64SPS   0x0060
#define ADS1115_RATE_128SPS  0x0080
#define ADS1115_RATE_250SPS  0x00A0
#define ADS1115_RATE_475SPS  0x00C0
#define ADS1115_RATE_860SPS  0x00E0

typedef struct {
    uint8_t  address;
    uint16_t gain;
    uint16_t dataRate;
} ADS1115_t;

// Sets defaults (GAIN_TWOTHIRDS, 128SPS). Call before begin().
void ADS1115_init(ADS1115_t *dev);

// Returns false if the device doesn't ACK on the I2C bus.
bool ADS1115_begin(ADS1115_t *dev, uint8_t i2cAddr);

void     ADS1115_setGain(ADS1115_t *dev, uint16_t gain);
uint16_t ADS1115_getGain(ADS1115_t *dev);

void     ADS1115_setDataRate(ADS1115_t *dev, uint16_t rate);
uint16_t ADS1115_getDataRate(ADS1115_t *dev);

// channel = 0..3 (AINx vs GND)
int16_t ADS1115_readADC_SingleEnded(ADS1115_t *dev, uint8_t channel);

int16_t ADS1115_readADC_Differential_0_1(ADS1115_t *dev);
int16_t ADS1115_readADC_Differential_0_3(ADS1115_t *dev);
int16_t ADS1115_readADC_Differential_1_3(ADS1115_t *dev);
int16_t ADS1115_readADC_Differential_2_3(ADS1115_t *dev);

// Converts a raw 16-bit result to volts based on the current gain setting.
float ADS1115_computeVolts(ADS1115_t *dev, int16_t counts);

#endif // ADS1115_H
