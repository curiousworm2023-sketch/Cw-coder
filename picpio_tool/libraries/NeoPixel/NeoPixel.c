// NeoPixel.c — see NeoPixel.h. WS2812B 800kHz protocol, bit-banged in
// cycle-exact PIC18 assembly with interrupts disabled. Tuned for Fosc=64MHz
// (Fcy=16MHz, 62.5ns/instruction cycle).
//
// The signal MUST be generated with exact timing — C (with -O2 and volatile
// pointer writes) is too imprecise and makes every bit read as '1' (all LEDs
// white). The inner bit loop below is hand-counted:
//   '0' high ~6cy (375ns), '1' high ~12cy (750ns), bit period ~17cy (1.06us).
// WS2812B accepts T0H 0.2-0.5us, T1H 0.55-0.85us, period 1.25us +/-0.6us.
#include "NeoPixel.h"

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

// Padding NOPs that set the HIGH-time of each bit (62.5ns each @ Fosc=64MHz).
// If colors are wrong on a scope, nudge these: more T0H/T1H = longer highs.
#define NP1 asm("nop")
#define NP2 NP1; NP1
#define NP4 NP2; NP2

void NeoPixel_show(NeoPixel_t *s) {
    uint16_t n = (uint16_t)(s->count * 3);
    if (!n) return;

    uint8_t hi = (uint8_t)(*s->lat | s->mask);
    uint8_t lo = (uint8_t)(*s->lat & (uint8_t)~s->mask);
    uint8_t *p = s->grb;

    // LAT register address — loaded into FSR0 each byte so INDF0 == the port.
    // (Writing INDF0 is one fast instruction, unlike dereferencing a pointer
    // local, which the original code did far too slowly -> all-white output.)
    uint16_t latAddr = (uint16_t)(s->lat);
    uint8_t  latL = (uint8_t)latAddr;
    uint8_t  latH = (uint8_t)(latAddr >> 8);

    uint8_t savedGIE = (uint8_t)GIE;
    GIE = 0;                                  // timing is interrupt-sensitive

    while (n--) {
        uint8_t byte = *p++;                  // (FSR0 may be used here for p)
        uint8_t bit  = 8;
        FSR0L = latL;                         // re-point FSR0 at the LAT after p
        FSR0H = latH;
        do {
            INDF0 = hi;                        // rising edge
            NP2;                               // T0H
            if (!(byte & 0x80)) INDF0 = lo;    // '0' drops here (~T0H)
            NP4;                               // T1H
            INDF0 = lo;                        // '1' drops here (~T1H); no-op for '0'
            byte = (uint8_t)(byte << 1);
        } while (--bit);
    }

    if (savedGIE) GIE = 1;
    // The >50us low gap before the next show() latches the data.
}
