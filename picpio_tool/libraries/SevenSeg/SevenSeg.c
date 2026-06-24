// SevenSeg.c — raw multiplexed 7-segment driver (see SevenSeg.h).
#include "SevenSeg.h"

// 7-segment font, bit0=a .. bit6=g, for digits 0-9.
static const uint8_t SS_FONT[10] = {
    0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F
};

void SevenSeg_init(SevenSeg_t *s, const uint8_t segPins[8],
                   const uint8_t digPins[], uint8_t numDigits, uint8_t commonAnode) {
    uint8_t i;
    s->numDigits   = (numDigits < 1) ? 1 : (numDigits > 4 ? 4 : numDigits);
    s->commonAnode = commonAnode ? 1 : 0;
    s->cur = 0;

    for (i = 0; i < 8; i++) {
        s->seg[i] = segPins[i];
        if (s->seg[i] != 0xFF) {
            gpio_mode(s->seg[i], GPIO_OUT);
            gpio_write(s->seg[i], s->commonAnode ? GPIO_HIGH : GPIO_LOW);  // segment off
        }
    }
    for (i = 0; i < s->numDigits; i++) {
        s->dig[i] = digPins[i];
        gpio_mode(s->dig[i], GPIO_OUT);
        gpio_write(s->dig[i], s->commonAnode ? GPIO_LOW : GPIO_HIGH);      // digit off
    }
    SevenSeg_clear(s);
}

void SevenSeg_setSegments(SevenSeg_t *s, uint8_t pos, uint8_t segbits) {
    if (pos < s->numDigits) s->buf[pos] = segbits;
}

void SevenSeg_setDigit(SevenSeg_t *s, uint8_t pos, uint8_t value, uint8_t dp) {
    if (pos >= s->numDigits) return;
    uint8_t bits = (value <= 9) ? SS_FONT[value] : 0x00;   // 0xFF -> blank
    if (dp) bits |= 0x80;
    s->buf[pos] = bits;
}

void SevenSeg_clear(SevenSeg_t *s) {
    uint8_t i;
    for (i = 0; i < 4; i++) s->buf[i] = 0x00;
}

void SevenSeg_setNumber(SevenSeg_t *s, int16_t number) {
    uint8_t i;
    for (i = 0; i < 4; i++) s->buf[i] = 0x00;             // blank all

    uint8_t neg = 0;
    int16_t n = number;
    if (n < 0) { neg = 1; n = (int16_t)(-n); }

    int8_t p = (int8_t)(s->numDigits - 1);                // rightmost digit index
    s->buf[p--] = SS_FONT[n % 10]; n /= 10;
    while (n > 0 && p >= 0) { s->buf[p--] = SS_FONT[n % 10]; n /= 10; }
    if (neg && p >= 0) s->buf[p] = 0x40;                  // '-'
}

void SevenSeg_refresh(SevenSeg_t *s) {
    uint8_t i;
    uint8_t segOff = s->commonAnode ? GPIO_HIGH : GPIO_LOW;
    uint8_t segOn  = s->commonAnode ? GPIO_LOW  : GPIO_HIGH;
    uint8_t digOff = s->commonAnode ? GPIO_LOW  : GPIO_HIGH;
    uint8_t digOn  = s->commonAnode ? GPIO_HIGH : GPIO_LOW;

    // Turn every digit off first (avoids ghosting between digits).
    for (i = 0; i < s->numDigits; i++) gpio_write(s->dig[i], digOff);

    // Drive the segment pins for the current digit's pattern.
    uint8_t pat = s->buf[s->cur];
    for (i = 0; i < 8; i++) {
        if (s->seg[i] == 0xFF) continue;                 // dp unused
        gpio_write(s->seg[i], (pat & (uint8_t)(1u << i)) ? segOn : segOff);
    }

    // Enable just the current digit, then advance.
    gpio_write(s->dig[s->cur], digOn);
    s->cur++;
    if (s->cur >= s->numDigits) s->cur = 0;
}
