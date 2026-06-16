// PCF8575.h — PICPIO C port of RobTillaart/PCF8575 (16-channel I2C IO expander)
// Usage: PCF8575_t io; PCF8575_init(&io, 0x20); PCF8575_begin(&io, 0xFFFF);
//        PCF8575_write(&io, 0, HIGH); val = PCF8575_read(&io, 1);
#ifndef PCF8575_H
#define PCF8575_H

#include "Picpio.h"

#define PCF8575_INITIAL_VALUE  0xFFFF

#define PCF8575_OK         0x00
#define PCF8575_PIN_ERROR  0x81
#define PCF8575_I2C_ERROR  0x82

typedef struct {
    uint8_t  address;
    uint16_t dataIn;
    uint16_t dataOut;
    uint16_t buttonMask;
    int      error;
} PCF8575_t;

// deviceAddress base = 0x20 (+ 0..7 depending on address pins)
void     PCF8575_init(PCF8575_t *dev, uint8_t deviceAddress);

// Writes the initial value and returns false if the device doesn't ACK.
bool     PCF8575_begin(PCF8575_t *dev, uint16_t value);
bool     PCF8575_isConnected(PCF8575_t *dev);

bool     PCF8575_setAddress(PCF8575_t *dev, uint8_t deviceAddress);
uint8_t  PCF8575_getAddress(PCF8575_t *dev);

uint16_t PCF8575_read16(PCF8575_t *dev);
uint8_t  PCF8575_read(PCF8575_t *dev, uint8_t pin);
uint16_t PCF8575_value(PCF8575_t *dev);

void     PCF8575_write16(PCF8575_t *dev, uint16_t value);
void     PCF8575_write(PCF8575_t *dev, uint8_t pin, uint8_t value);
uint16_t PCF8575_valueOut(PCF8575_t *dev);

uint16_t PCF8575_readButton16(PCF8575_t *dev);
uint16_t PCF8575_readButton16Mask(PCF8575_t *dev, uint16_t mask);
uint8_t  PCF8575_readButton(PCF8575_t *dev, uint8_t pin);
void     PCF8575_setButtonMask(PCF8575_t *dev, uint16_t mask);
uint16_t PCF8575_getButtonMask(PCF8575_t *dev);

// rotate/shift/toggle/reverse expect all 16 lines to be used as outputs
void     PCF8575_toggle(PCF8575_t *dev, uint8_t pin);
void     PCF8575_toggleMask(PCF8575_t *dev, uint16_t mask);
void     PCF8575_shiftRight(PCF8575_t *dev, uint8_t n);
void     PCF8575_shiftLeft(PCF8575_t *dev, uint8_t n);
void     PCF8575_rotateRight(PCF8575_t *dev, uint8_t n);
void     PCF8575_rotateLeft(PCF8575_t *dev, uint8_t n);
void     PCF8575_reverse(PCF8575_t *dev);

void     PCF8575_select(PCF8575_t *dev, uint8_t pin);
void     PCF8575_selectN(PCF8575_t *dev, uint8_t pin);
void     PCF8575_selectNone(PCF8575_t *dev);
void     PCF8575_selectAll(PCF8575_t *dev);

int      PCF8575_lastError(PCF8575_t *dev);

#endif // PCF8575_H
