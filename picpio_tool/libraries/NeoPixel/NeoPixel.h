// NeoPixel.h — PICPIO C driver for WS2812 / WS2812B / WS2811 ("NeoPixel")
// addressable RGB LED strips. Single-wire, bit-banged.
//
// IMPORTANT: the bit-bang timing is tuned for PIC18 running at Fosc = 64 MHz
// (the PICPIO default, e.g. PIC18F27K40). On a different clock you may need to
// adjust NEOPIXEL_T0H/T1H/TLO below (with a logic analyzer / by eye). PIC18
// only — uses the LATx output latch registers.
//
// Usage:
//   #define LED_PIN   D5
//   #define LED_COUNT 16
//   NeoPixel_t strip;
//   void init() {
//       NeoPixel_init(&strip, LED_COUNT, LED_PIN);
//       NeoPixel_begin(&strip);
//       NeoPixel_setPixelColor(&strip, 0, 255, 0, 0);   // pixel 0 = red
//       NeoPixel_show(&strip);
//   }
#ifndef NEOPIXEL_H
#define NEOPIXEL_H

#include "Picpio.h"

// Max LEDs the internal GRB buffer holds (3 bytes each). Override before
// including if you need more/less (watch RAM: 64 LEDs = 192 bytes).
#ifndef NEOPIXEL_MAX_LEDS
#define NEOPIXEL_MAX_LEDS 64
#endif

typedef struct {
    uint16_t count;                          // number of active LEDs
    uint8_t  pin;                            // PICPIO pin number (D0-D13, A0-A5)
    volatile uint8_t *lat;                   // output latch register for `pin`
    uint8_t  mask;                           // bit mask within that register
    uint8_t  grb[NEOPIXEL_MAX_LEDS * 3];     // pixel data, WS2812 GRB order
} NeoPixel_t;

void    NeoPixel_init(NeoPixel_t *s, uint16_t count, uint8_t pin);
uint8_t NeoPixel_begin(NeoPixel_t *s);                       // pin -> output; clears buffer
void    NeoPixel_setPixelColor(NeoPixel_t *s, uint16_t i, uint8_t r, uint8_t g, uint8_t b);
void    NeoPixel_clear(NeoPixel_t *s);                       // all pixels off (call show after)
void    NeoPixel_show(NeoPixel_t *s);                        // push the buffer to the strip

#endif // NEOPIXEL_H
