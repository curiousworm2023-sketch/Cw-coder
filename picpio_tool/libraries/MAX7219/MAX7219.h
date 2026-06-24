// MAX7219.h — PICPIO C driver for MAX7219/MAX7221 7-segment display drivers
// (up to 8 digits) over hardware SPI. Uses the chip's built-in BCD decoder so
// you write plain digit values 0-9.
//
// Wiring: DIN->MOSI(RC1), CLK->SCK(RC5), CS/LOAD-> any GPIO. VCC 5V, GND common.
//   (Shares the SPI bus — don't run another SPI device's transfers in between
//    without re-selecting; CS keeps them separate.)
//
// Usage:
//   MAX7219_t seg;
//   void init() {
//       SPI.begin();
//       MAX7219_init(&seg, D0, 4);        // CS=D0, 4 digits
//       MAX7219_setBrightness(&seg, 8);   // 0..15
//       MAX7219_showNumber(&seg, 1234);
//   }
#ifndef PICPIO_MAX7219_H
#define PICPIO_MAX7219_H

#include "Picpio.h"

typedef struct {
    uint8_t cs;        // CS/LOAD GPIO pin
    uint8_t digits;    // number of digits in use (1..8)
} MAX7219_t;

// Initialise the driver: set scan limit, enable BCD decode, wake from
// shutdown, mid brightness, and clear. Call SPI.begin() first.
void MAX7219_init(MAX7219_t *d, uint8_t csPin, uint8_t numDigits);

// Brightness 0 (dim) .. 15 (bright).
void MAX7219_setBrightness(MAX7219_t *d, uint8_t level);

// Blank all digits.
void MAX7219_clear(MAX7219_t *d);

// Show one digit. pos 0 = rightmost. value 0..9 (or 0x0F for blank);
// dp = 1 lights the decimal point.
void MAX7219_showDigit(MAX7219_t *d, uint8_t pos, uint8_t value, uint8_t dp);

// Show a signed integer, right-aligned with leading blanks.
void MAX7219_showNumber(MAX7219_t *d, int32_t number);

#endif // PICPIO_MAX7219_H
