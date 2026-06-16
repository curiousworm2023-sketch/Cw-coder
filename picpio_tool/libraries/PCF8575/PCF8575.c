// PCF8575.c — PICPIO C port of RobTillaart/PCF8575 (16-channel I2C IO expander)
#include "PCF8575.h"

void PCF8575_init(PCF8575_t *dev, uint8_t deviceAddress)
{
    dev->address    = deviceAddress;
    dev->dataIn     = 0;
    dev->dataOut    = 0xFFFF;
    dev->buttonMask = 0xFFFF;
    dev->error      = PCF8575_OK;
}

bool PCF8575_begin(PCF8575_t *dev, uint16_t value)
{
    if (!PCF8575_isConnected(dev)) return false;
    PCF8575_write16(dev, value);
    return true;
}

bool PCF8575_isConnected(PCF8575_t *dev)
{
    Wire.beginTransmission(dev->address);
    return Wire.endTransmission() == 0;
}

bool PCF8575_setAddress(PCF8575_t *dev, uint8_t deviceAddress)
{
    if ((deviceAddress < 0x20) || (deviceAddress > 0x27)) return false;
    dev->address = deviceAddress;
    return PCF8575_isConnected(dev);
}

uint8_t PCF8575_getAddress(PCF8575_t *dev)
{
    return dev->address;
}

uint16_t PCF8575_read16(PCF8575_t *dev)
{
    if (Wire.requestFrom(dev->address, 2) != 2) {
        dev->error = PCF8575_I2C_ERROR;
        return dev->dataIn;
    }
    dev->dataIn  = Wire.read();
    dev->dataIn |= ((uint16_t)Wire.read() << 8);
    return dev->dataIn;
}

uint8_t PCF8575_read(PCF8575_t *dev, uint8_t pin)
{
    if (pin > 15) {
        dev->error = PCF8575_PIN_ERROR;
        return 0;
    }
    PCF8575_read16(dev);
    return (dev->dataIn & (1U << pin)) > 0;
}

uint16_t PCF8575_value(PCF8575_t *dev)
{
    return dev->dataIn;
}

void PCF8575_write16(PCF8575_t *dev, uint16_t value)
{
    dev->dataOut = value;
    Wire.beginTransmission(dev->address);
    Wire.write(dev->dataOut & 0xFF);
    Wire.write(dev->dataOut >> 8);
    dev->error = Wire.endTransmission();
}

void PCF8575_write(PCF8575_t *dev, uint8_t pin, uint8_t value)
{
    if (pin > 15) {
        dev->error = PCF8575_PIN_ERROR;
        return;
    }
    if (value == LOW) {
        dev->dataOut &= ~(1U << pin);
    } else {
        dev->dataOut |= (1U << pin);
    }
    PCF8575_write16(dev, dev->dataOut);
}

uint16_t PCF8575_valueOut(PCF8575_t *dev)
{
    return dev->dataOut;
}

void PCF8575_toggle(PCF8575_t *dev, uint8_t pin)
{
    if (pin > 15) {
        dev->error = PCF8575_PIN_ERROR;
        return;
    }
    PCF8575_toggleMask(dev, 1U << pin);
}

void PCF8575_toggleMask(PCF8575_t *dev, uint16_t mask)
{
    dev->dataOut ^= mask;
    PCF8575_write16(dev, dev->dataOut);
}

void PCF8575_shiftRight(PCF8575_t *dev, uint8_t n)
{
    if ((n == 0) || (dev->dataOut == 0)) return;
    if (n > 15) dev->dataOut = 0;
    if (dev->dataOut != 0) dev->dataOut >>= n;
    PCF8575_write16(dev, dev->dataOut);
}

void PCF8575_shiftLeft(PCF8575_t *dev, uint8_t n)
{
    if ((n == 0) || (dev->dataOut == 0)) return;
    if (n > 15) dev->dataOut = 0;
    if (dev->dataOut != 0) dev->dataOut <<= n;
    PCF8575_write16(dev, dev->dataOut);
}

void PCF8575_rotateRight(PCF8575_t *dev, uint8_t n)
{
    uint8_t r = n & 15;
    if (r == 0) return;
    dev->dataOut = (dev->dataOut >> r) | (dev->dataOut << (16 - r));
    PCF8575_write16(dev, dev->dataOut);
}

void PCF8575_rotateLeft(PCF8575_t *dev, uint8_t n)
{
    PCF8575_rotateRight(dev, 16 - (n & 15));
}

void PCF8575_reverse(PCF8575_t *dev)
{
    uint16_t x = dev->dataOut;
    x = (((x & 0xAAAA) >> 1) | ((x & 0x5555) << 1));
    x = (((x & 0xCCCC) >> 2) | ((x & 0x3333) << 2));
    x = (((x & 0xF0F0) >> 4) | ((x & 0x0F0F) << 4));
    x = (x >> 8) | (x << 8);
    PCF8575_write16(dev, x);
}

uint16_t PCF8575_readButton16Mask(PCF8575_t *dev, uint16_t mask)
{
    uint16_t saved = dev->dataOut;
    PCF8575_write16(dev, mask | dev->dataOut);
    PCF8575_read16(dev);
    PCF8575_write16(dev, saved);
    return dev->dataIn;
}

uint16_t PCF8575_readButton16(PCF8575_t *dev)
{
    return PCF8575_readButton16Mask(dev, dev->buttonMask);
}

uint8_t PCF8575_readButton(PCF8575_t *dev, uint8_t pin)
{
    if (pin > 15) {
        dev->error = PCF8575_PIN_ERROR;
        return 0;
    }
    uint16_t saved = dev->dataOut;
    PCF8575_write(dev, pin, HIGH);
    uint8_t rtn = PCF8575_read(dev, pin);
    PCF8575_write16(dev, saved);
    return rtn;
}

void PCF8575_setButtonMask(PCF8575_t *dev, uint16_t mask)
{
    dev->buttonMask = mask;
}

uint16_t PCF8575_getButtonMask(PCF8575_t *dev)
{
    return dev->buttonMask;
}

void PCF8575_select(PCF8575_t *dev, uint8_t pin)
{
    uint16_t n = 0x0000;
    if (pin < 16) n = (uint16_t)(1UL << pin);
    PCF8575_write16(dev, n);
}

void PCF8575_selectN(PCF8575_t *dev, uint8_t pin)
{
    uint16_t n = 0xFFFF;
    if (pin < 16) n = (uint16_t)((2UL << pin) - 1);
    PCF8575_write16(dev, n);
}

void PCF8575_selectNone(PCF8575_t *dev)
{
    PCF8575_write16(dev, 0x0000);
}

void PCF8575_selectAll(PCF8575_t *dev)
{
    PCF8575_write16(dev, 0xFFFF);
}

int PCF8575_lastError(PCF8575_t *dev)
{
    int e = dev->error;
    dev->error = PCF8575_OK;
    return e;
}
