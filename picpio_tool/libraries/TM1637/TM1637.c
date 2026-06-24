// TM1637.c — TM1637 4-digit 7-segment driver (see TM1637.h).
// Bit-banged 2-wire protocol (TM1637 custom serial, not I2C): both lines are
// open-drain (driven LOW, released HIGH via the module's pull-ups).
#include "TM1637.h"

// 7-segment font, bit0=a .. bit6=g, for digits 0-9.
static const uint8_t TM_FONT[10] = {
    0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F
};

#define TM_CMD_DATA   0x40   // auto-increment write
#define TM_CMD_ADDR   0xC0   // set address (digit 0)
#define TM_CMD_DISP   0x88   // display ON | brightness

static void tm_delay(void) { sys_delay_us(5); }

// Open-drain helpers: input = released HIGH (pull-up), output-low = driven LOW.
static void clkHigh(TM1637_t *d) { gpio_mode(d->clk, GPIO_IN); }
static void clkLow(TM1637_t *d)  { gpio_mode(d->clk, GPIO_OUT); gpio_write(d->clk, GPIO_LOW); }
static void dioHigh(TM1637_t *d) { gpio_mode(d->dio, GPIO_IN); }
static void dioLow(TM1637_t *d)  { gpio_mode(d->dio, GPIO_OUT); gpio_write(d->dio, GPIO_LOW); }

static void tm_start(TM1637_t *d) {
    clkHigh(d); dioHigh(d); tm_delay();
    dioLow(d);  tm_delay();              // DIO falls while CLK high
}

static void tm_stop(TM1637_t *d) {
    clkLow(d);  tm_delay();
    dioLow(d);  tm_delay();
    clkHigh(d); tm_delay();
    dioHigh(d); tm_delay();              // DIO rises while CLK high
}

static void tm_writeByte(TM1637_t *d, uint8_t b) {
    uint8_t i;
    for (i = 0; i < 8; i++) {
        clkLow(d); tm_delay();
        if (b & 0x01) dioHigh(d); else dioLow(d);   // LSB first
        tm_delay();
        clkHigh(d); tm_delay();
        b >>= 1;
    }
    // 9th clock: read ACK (DIO released, slave pulls it low).
    clkLow(d); dioHigh(d); tm_delay();
    clkHigh(d); tm_delay();
    clkLow(d);  tm_delay();
}

void TM1637_init(TM1637_t *d, uint8_t clkPin, uint8_t dioPin) {
    d->clk = clkPin;
    d->dio = dioPin;
    d->bright = 4;
    d->colon = 0;
    clkHigh(d);
    dioHigh(d);
    TM1637_clear(d);
}

void TM1637_setBrightness(TM1637_t *d, uint8_t level) {
    d->bright = (uint8_t)(level & 0x07);
}

void TM1637_setColon(TM1637_t *d, uint8_t on) {
    d->colon = on ? 1 : 0;
}

void TM1637_showSegments(TM1637_t *d, const uint8_t seg[4]) {
    uint8_t i;
    tm_start(d); tm_writeByte(d, TM_CMD_DATA); tm_stop(d);

    tm_start(d); tm_writeByte(d, TM_CMD_ADDR);
    for (i = 0; i < 4; i++) tm_writeByte(d, seg[i]);
    tm_stop(d);

    tm_start(d); tm_writeByte(d, (uint8_t)(TM_CMD_DISP | d->bright)); tm_stop(d);
}

void TM1637_showDigits(TM1637_t *d, const uint8_t value[4]) {
    uint8_t seg[4];
    uint8_t i;
    for (i = 0; i < 4; i++)
        seg[i] = (value[i] <= 9) ? TM_FONT[value[i]] : 0x00;   // 0xFF -> blank
    if (d->colon) seg[1] |= 0x80;        // colon sits on digit index 1
    TM1637_showSegments(d, seg);
}

void TM1637_clear(TM1637_t *d) {
    uint8_t seg[4] = { 0, 0, 0, 0 };
    TM1637_showSegments(d, seg);
}

void TM1637_showNumber(TM1637_t *d, int16_t number) {
    uint8_t value[4] = { 0xFF, 0xFF, 0xFF, 0xFF };
    uint8_t neg = 0;
    int16_t n = number;
    if (n < 0) { neg = 1; n = (int16_t)(-n); }
    if (n > 9999) n = 9999;

    int8_t i = 3;
    value[i--] = (uint8_t)(n % 10); n /= 10;
    while (n > 0 && i >= 0) { value[i--] = (uint8_t)(n % 10); n /= 10; }
    if (neg && i >= 0) value[i] = 0xFE;   // sentinel for '-' (handled below)

    // Convert, mapping the '-' sentinel to segment g.
    uint8_t seg[4];
    for (i = 0; i < 4; i++) {
        if (value[i] == 0xFE)      seg[i] = 0x40;            // minus sign
        else if (value[i] <= 9)    seg[i] = TM_FONT[value[i]];
        else                       seg[i] = 0x00;            // blank
    }
    if (d->colon) seg[1] |= 0x80;
    TM1637_showSegments(d, seg);
}
