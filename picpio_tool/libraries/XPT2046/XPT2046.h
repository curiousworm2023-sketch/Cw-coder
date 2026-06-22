// XPT2046.h — PICPIO C driver for the XPT2046 resistive touchscreen controller
// Works with SPI interface. Provides touch coordinates in ADC counts (12-bit, 0-4095).
//
// Usage:
//   #include "XPT2046.h"
//   XPT2046_t touch;
//   void init() {
//       SPI.begin();
//       XPT2046_init(&touch, D7, D8); // CS, IRQ (IRQ can be 0xFF if not used)
//   }
//   void run() {
//       if (XPT2046_touched(&touch)) {
//           uint16_t x, y;
//           XPT2046_read(&touch, &x, &y);
//       }
//   }

#ifndef XPT2046_H
#define XPT2046_H

#include "Picpio.h"

typedef struct {
    uint8_t cs, irq;
    uint16_t width, height;
    uint8_t rotation;
} XPT2046_t;

// Initialize touchscreen struct
void XPT2046_init(XPT2046_t *dev, uint8_t cs, uint8_t irq);

// Set display dimensions for coordinate mapping
void XPT2046_setRotation(XPT2046_t *dev, uint8_t rotation);

// Check if screen is touched (returns true if pressed)
bool XPT2046_touched(XPT2046_t *dev);

// Read raw X/Y coordinates (12-bit ADC values 0-4095)
void XPT2046_read(XPT2046_t *dev, uint16_t *x, uint16_t *y);

#endif // XPT2046_H