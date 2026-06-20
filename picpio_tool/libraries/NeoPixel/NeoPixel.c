// NeoPixel.c — see NeoPixel.h. WS2812B 800kHz protocol, bit-banged with
// interrupts disabled. Timing tuned for PIC18 @ Fosc=64MHz (Fcy=16MHz,
// 62.5ns/instruction cycle).
//
// WS2812B bit timing (relaxed spec, +/-150ns):
//   '0' code: ~0.35us high, then low   ('0' drops early)
//   '1' code: ~0.70us high, then low
//   bit period ~1.25us; >50us low = latch/reset.
#include "NeoPixel.h"

#define NP asm("nop")

// Hold-time padding (instruction cycles ~ NOPs). Adjust for other clocks.
#define NEOPIXEL_T0H 2     // extra nops after the rising edge before a '0' drops
#define NEOPIXEL_T1H 4     // extra nops from the '0'-drop point to the '1' drop
#define NEOPIXEL_TLO 3     // extra nops of low tail to round out the bit period

// Map a PICPIO pin number to its PIC18 output latch register + bit mask.
// D0-D7 = RC0-RC7, D8-D13 = RB0-RB5, A0-A5 = RA0-RA5 (see picpio_compat).
static void _resolve(NeoPixel_t *s) {
    uint8_t p = s->pin;
    if (p <= 7)        { s->lat = &LATC; s->mask = (uint8_t)(1u << p); }
    else if (p <= 13)  { s->lat = &LATB; s->mask = (uint8_t)(1u << (p - 8)); }
    else               { s->lat = &LATA; s->mask = (uint8_t)(1u << (p - 14)); }
}

void NeoPixel_init(NeoPixel_t *s, uint16_t count, uint8_t pin) {
    if (count > NEOPIXEL_MAX_LEDS) count = NEOPIXEL_MAX_LEDS;
    s->count = count;
    s->pin   = pin;
}

uint8_t NeoPixel_begin(NeoPixel_t *s) {
    gpio_mode(s->pin, GPIO_OUT);
    gpio_write(s->pin, GPIO_LOW);
    _resolve(s);
    NeoPixel_clear(s);
    return 1;
}

void NeoPixel_setPixelColor(NeoPixel_t *s, uint16_t i, uint8_t r, uint8_t g, uint8_t b) {
    if (i >= s->count) return;
    uint16_t o = (uint16_t)(i * 3);
    s->grb[o]     = g;                       // WS2812 transmits Green, Red, Blue
    s->grb[o + 1] = r;
    s->grb[o + 2] = b;
}

void NeoPixel_clear(NeoPixel_t *s) {
    for (uint16_t i = 0; i < (uint16_t)(s->count * 3); i++) s->grb[i] = 0;
}

void NeoPixel_show(NeoPixel_t *s) {
    volatile uint8_t *lat = s->lat;
    uint8_t  mask = s->mask;
    uint16_t n    = (uint16_t)(s->count * 3);
    uint8_t *p    = s->grb;

    uint8_t hi = (uint8_t)(*lat | mask);
    uint8_t lo = (uint8_t)(*lat & (uint8_t)~mask);

    uint8_t savedGIE = (uint8_t)GIE;
    GIE = 0;                                  // timing is interrupt-sensitive

    while (n--) {
        uint8_t byte = *p++;
        uint8_t bit  = 8;
        do {
            *lat = hi;                        // rising edge
#if NEOPIXEL_T0H >= 1
            NP;
#endif
#if NEOPIXEL_T0H >= 2
            NP;
#endif
#if NEOPIXEL_T0H >= 3
            NP;
#endif
            if (!(byte & 0x80)) *lat = lo;    // '0' drops here (~T0H)
#if NEOPIXEL_T1H >= 1
            NP;
#endif
#if NEOPIXEL_T1H >= 2
            NP;
#endif
#if NEOPIXEL_T1H >= 3
            NP;
#endif
#if NEOPIXEL_T1H >= 4
            NP;
#endif
            *lat = lo;                        // '1' drops here (~T1H); no-op for '0'
            byte = (uint8_t)(byte << 1);
#if NEOPIXEL_TLO >= 1
            NP;
#endif
#if NEOPIXEL_TLO >= 2
            NP;
#endif
#if NEOPIXEL_TLO >= 3
            NP;
#endif
        } while (--bit);
    }

    if (savedGIE) GIE = 1;
    // The >50us low gap before the next show() latches the data.
}
