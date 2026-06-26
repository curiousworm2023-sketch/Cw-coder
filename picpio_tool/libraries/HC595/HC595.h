#ifndef HC595_H
#define HC595_H

#include "Picpio.h"

// 74HC595 serial-in / parallel-out shift register — use it as an output
// expander: 3 GPIO pins drive 8 outputs (Q0-Q7), and chips daisy-chain so N
// chips give 8*N outputs from the same 3 pins.
//
// Wiring (per chip):
//   DS   (pin 14) = data   -> dataPin
//   SHCP (pin 11) = clock  -> clockPin
//   STCP (pin 12) = latch  -> latchPin
//   OE   (pin 13) -> GND   (outputs always enabled)
//   MR   (pin 10) -> VCC   (never reset)
//   Q7S  (pin  9) -> next chip's DS, to chain
//
// Output numbering: pin 0..7 = first chip Q0..Q7, pin 8..15 = second chip, …
// The "first chip" is the one whose DS connects straight to the MCU.

#define HC595_MAX_CHIPS 8   // up to 64 outputs

typedef struct {
    uint8_t dataPin;
    uint8_t clockPin;
    uint8_t latchPin;
    uint8_t numChips;                 // 1..HC595_MAX_CHIPS
    uint8_t buf[HC595_MAX_CHIPS];     // buf[0] = first chip
} HC595_t;

// Set up the pins and shift out all-zeros. numChips = number of daisy-chained
// 74HC595s (1 if you only have one).
void HC595_init(HC595_t *dev, uint8_t dataPin, uint8_t clockPin, uint8_t latchPin, uint8_t numChips);

// Shift the current buffer out to the chips and latch it to the outputs.
void HC595_update(HC595_t *dev);

// Set a single output (pin = 0 .. numChips*8-1) and latch immediately.
void HC595_writePin(HC595_t *dev, uint8_t pin, uint8_t value);

// Set a single output in the buffer WITHOUT latching — batch several, then call
// HC595_update() once (avoids visible flicker / repeated latching).
void HC595_setPin(HC595_t *dev, uint8_t pin, uint8_t value);

// Read back what an output is currently set to (0/1) from the buffer.
uint8_t HC595_readPin(HC595_t *dev, uint8_t pin);

// Set a whole chip's 8 outputs at once (chip = 0 .. numChips-1) and latch.
void HC595_writeByte(HC595_t *dev, uint8_t chip, uint8_t value);

// Set every output to the same byte pattern across all chips and latch.
void HC595_setAll(HC595_t *dev, uint8_t value);

// Turn every output off and latch.
void HC595_clear(HC595_t *dev);

#endif // HC595_H
