// SevenSeg.h — PICPIO C driver for a RAW (no driver chip) 7-segment display
// wired straight to GPIO: 7 segment pins (a..g, +optional dp) shared across all
// digits, and one digit-select pin per digit. Supports 1, 2, 3 or 4 digits,
// common-anode or common-cathode.
//
// Multi-digit displays are time-multiplexed: call SevenSeg_refresh() rapidly
// (e.g. every loop pass) so each digit is lit in turn — persistence of vision
// makes them all appear on. A 1-digit display is always on; refresh still works.
//
// Wiring: tie each segment through a ~330R resistor. For common-anode, the
// digit-common pins go to the digit's anode (often via a PNP/driver); for
// common-cathode, to the cathode (via NPN/driver) for anything bright.
//
// Usage (4-digit common-cathode):
//   SevenSeg_t ss;
//   uint8_t segPins[8] = {D0,D1,D2,D3,D4,D5,D6,D7}; // a,b,c,d,e,f,g,dp
//   uint8_t digPins[4] = {D8,D9,D10,D11};
//   void init() { SevenSeg_init(&ss, segPins, digPins, 4, 0); SevenSeg_setNumber(&ss, 1234); }
//   void run()  { SevenSeg_refresh(&ss); }
#ifndef PICPIO_SEVENSEG_H
#define PICPIO_SEVENSEG_H

#include "Picpio.h"

typedef struct {
    uint8_t seg[8];      // segment pins: a,b,c,d,e,f,g,dp  (dp can be 0xFF if unused)
    uint8_t dig[4];      // digit-select pins (only [0..numDigits-1] used)
    uint8_t numDigits;   // 1..4
    uint8_t commonAnode; // 1 = common anode, 0 = common cathode
    uint8_t buf[4];      // per-digit segment pattern (bit0=a..bit6=g, bit7=dp)
    uint8_t cur;         // index of the digit lit by the next refresh()
} SevenSeg_t;

// Configure pins. segPins[8] = a,b,c,d,e,f,g,dp (set dp entry to 0xFF if your
// display has no decimal point). digPins[] needs numDigits entries.
void SevenSeg_init(SevenSeg_t *s, const uint8_t segPins[8],
                   const uint8_t digPins[], uint8_t numDigits, uint8_t commonAnode);

// Set one digit (pos 0 = leftmost). value 0..9, or 0xFF to blank. dp lights
// the decimal point on that digit.
void SevenSeg_setDigit(SevenSeg_t *s, uint8_t pos, uint8_t value, uint8_t dp);

// Set a raw segment pattern on one digit (bit0=a..bit6=g, bit7=dp).
void SevenSeg_setSegments(SevenSeg_t *s, uint8_t pos, uint8_t segbits);

// Show a signed integer, right-aligned with leading blanks.
void SevenSeg_setNumber(SevenSeg_t *s, int16_t number);

// Blank all digits.
void SevenSeg_clear(SevenSeg_t *s);

// Light the next digit (multiplexing). Call this continuously/rapidly.
// For a 1-digit display it simply keeps that digit lit.
void SevenSeg_refresh(SevenSeg_t *s);

#endif // PICPIO_SEVENSEG_H
