// XPT2046.c — PICPIO C driver for the XPT2046 resistive touchscreen controller
#include "XPT2046.h"

// XPT2046 commands (12-bit, D7=1 for differential mode)
#define XPT2046_READ_X  0x98  // Read X position, differential, 12-bit
#define XPT2046_READ_Y  0xD8  // Read Y position, differential, 12-bit
#define XPT2046_READ_Z1 0xA8  // Read Z1 (touch pressure)
#define XPT2046_READ_Z2 0xE8  // Read Z2 (touch pressure)

static uint16_t xpt2046_readChannel(XPT2046_t *dev, uint8_t cmd) {
    gpio_write(dev->cs, LOW);
    SPI.transfer(cmd);
    SPI.transfer(0x00);
    SPI.transfer(0x00);
    uint16_t result = SPI.transfer(0x00);
    result >>= 3;  // 12-bit result in bits 15-4, shift down
    gpio_write(dev->cs, HIGH);
    return result & 0x0FFF;
}

void XPT2046_init(XPT2046_t *dev, uint8_t cs, uint8_t irq) {
    dev->cs = cs;
    dev->irq = irq;
    dev->width = 240;
    dev->height = 320;
    pinMode(dev->cs, OUTPUT);
    gpio_write(dev->cs, HIGH);
    if (irq != 0xFF) {
        pinMode(dev->irq, INPUT);
    }
}

void XPT2046_setRotation(XPT2046_t *dev, uint8_t rotation) {
    // Rotation affects coordinate mapping
    // 0=portrait, 1=landscape, 2=portrait flip, 3=landscape flip
    dev->rotation = rotation;
}

bool XPT2046_touched(XPT2046_t *dev) {
    if (dev->irq != 0xFF) {
        return digitalRead(dev->irq) == LOW;  // IRQ active low
    }
    // If no IRQ, check Z2 pressure reading
    uint16_t z2 = xpt2046_readChannel(dev, XPT2046_READ_Z2);
    return z2 > 100;  // Threshold for touch detection
}

void XPT2046_read(XPT2046_t *dev, uint16_t *x, uint16_t *y) {
    uint16_t raw_x = xpt2046_readChannel(dev, XPT2046_READ_X);
    uint16_t raw_y = xpt2046_readChannel(dev, XPT2046_READ_Y);
    
    // Apply rotation and map to display dimensions
    switch (dev->rotation & 3) {
        case 0:  // Portrait
            *x = map(raw_x, 0, 4095, 0, dev->width - 1);
            *y = map(raw_y, 0, 4095, 0, dev->height - 1);
            break;
        case 1:  // Landscape
            *x = map(raw_y, 0, 4095, 0, dev->width - 1);
            *y = map(dev->height - 1 - raw_x, 0, 4095, 0, dev->height - 1);
            break;
        case 2:  // Portrait flipped
            *x = map(dev->width - 1 - raw_x, 0, 4095, 0, dev->width - 1);
            *y = map(dev->height - 1 - raw_y, 0, 4095, 0, dev->height - 1);
            break;
        case 3:  // Landscape flipped
            *x = map(dev->width - 1 - raw_y, 0, 4095, 0, dev->width - 1);
            *y = map(raw_x, 0, 4095, 0, dev->height - 1);
            break;
    }
}