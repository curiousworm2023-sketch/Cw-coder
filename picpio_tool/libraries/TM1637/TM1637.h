// TM1637.h — PICPIO C driver for TM1637 4-digit 7-segment display modules
// (the common 2-wire CLK/DIO breakout, often with a center colon).
//
// Wiring: CLK and DIO to any two GPIO pins, plus VCC (5V or 3.3V) and GND.
// The module has its own pull-ups, so no external resistors are needed.
//
// Usage:
//   TM1637_t disp;
//   void init() {
//       TM1637_init(&disp, D2, D3);      // CLK=D2, DIO=D3
//       TM1637_setBrightness(&disp, 4);  // 0..7
//       TM1637_showNumber(&disp, 1234);
//   }
#ifndef PICPIO_TM1637_H
#define PICPIO_TM1637_H

#include "Picpio.h"

typedef struct {
    uint8_t clk;        // CLK GPIO pin
    uint8_t dio;        // DIO GPIO pin
    uint8_t bright;     // 0..7 (display-control brightness)
    uint8_t colon;      // 1 = light the center colon
} TM1637_t;

// Configure the two pins and turn the display on at mid brightness.
void TM1637_init(TM1637_t *d, uint8_t clkPin, uint8_t dioPin);

// Brightness 0 (dim) .. 7 (bright). Applied on the next write.
void TM1637_setBrightness(TM1637_t *d, uint8_t level);

// Turn the center colon on (1) or off (0). Affects the next number/refresh.
void TM1637_setColon(TM1637_t *d, uint8_t on);

// Blank all four digits.
void TM1637_clear(TM1637_t *d);

// Show a signed integer (-999..9999), right-aligned, leading blanks.
void TM1637_showNumber(TM1637_t *d, int16_t number);

// Show four raw digit values (0..9, or 0xFF for a blank digit), left to right.
void TM1637_showDigits(TM1637_t *d, const uint8_t value[4]);

// Show four raw segment patterns (bit0=a..bit6=g, bit7=colon/dp), left to right.
void TM1637_showSegments(TM1637_t *d, const uint8_t seg[4]);

#endif // PICPIO_TM1637_H
