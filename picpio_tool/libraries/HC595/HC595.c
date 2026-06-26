#include "HC595.h"

void HC595_init(HC595_t *dev, uint8_t dataPin, uint8_t clockPin, uint8_t latchPin, uint8_t numChips)
{
    dev->dataPin  = dataPin;
    dev->clockPin = clockPin;
    dev->latchPin = latchPin;
    dev->numChips = (numChips < 1) ? 1 :
                    (numChips > HC595_MAX_CHIPS) ? HC595_MAX_CHIPS : numChips;
    for (uint8_t i = 0; i < HC595_MAX_CHIPS; i++) dev->buf[i] = 0;

    pinMode(dev->dataPin,  OUTPUT);
    pinMode(dev->clockPin, OUTPUT);
    pinMode(dev->latchPin, OUTPUT);
    digitalWrite(dev->clockPin, LOW);
    digitalWrite(dev->latchPin, LOW);

    HC595_update(dev);   // start with all outputs low
}

void HC595_update(HC595_t *dev)
{
    digitalWrite(dev->latchPin, LOW);
    // Shift the farthest chip first so buf[0] lands on the chip nearest the MCU.
    for (int8_t c = (int8_t)dev->numChips - 1; c >= 0; c--) {
        uint8_t data = dev->buf[c];
        for (int8_t i = 7; i >= 0; i--) {        // MSB first: Q7..Q0
            digitalWrite(dev->clockPin, LOW);
            digitalWrite(dev->dataPin, ((data >> i) & 0x01) ? HIGH : LOW);
            digitalWrite(dev->clockPin, HIGH);
        }
    }
    digitalWrite(dev->clockPin, LOW);
    digitalWrite(dev->latchPin, HIGH);           // latch -> outputs change
    delayMicroseconds(1);
    digitalWrite(dev->latchPin, LOW);
}

void HC595_setPin(HC595_t *dev, uint8_t pin, uint8_t value)
{
    uint8_t chip = pin >> 3;          // pin / 8
    uint8_t bit  = pin & 0x07;        // pin % 8
    if (chip >= dev->numChips) return;
    if (value) dev->buf[chip] |=  (uint8_t)(1u << bit);
    else       dev->buf[chip] &= (uint8_t)~(1u << bit);
}

void HC595_writePin(HC595_t *dev, uint8_t pin, uint8_t value)
{
    HC595_setPin(dev, pin, value);
    HC595_update(dev);
}

uint8_t HC595_readPin(HC595_t *dev, uint8_t pin)
{
    uint8_t chip = pin >> 3;
    uint8_t bit  = pin & 0x07;
    if (chip >= dev->numChips) return 0;
    return (dev->buf[chip] >> bit) & 0x01;
}

void HC595_writeByte(HC595_t *dev, uint8_t chip, uint8_t value)
{
    if (chip >= dev->numChips) return;
    dev->buf[chip] = value;
    HC595_update(dev);
}

void HC595_setAll(HC595_t *dev, uint8_t value)
{
    for (uint8_t c = 0; c < dev->numChips; c++) dev->buf[c] = value;
    HC595_update(dev);
}

void HC595_clear(HC595_t *dev)
{
    HC595_setAll(dev, 0x00);
}
