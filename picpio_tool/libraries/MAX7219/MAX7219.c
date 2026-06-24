// MAX7219.c — MAX7219/MAX7221 7-segment driver over SPI (see MAX7219.h).
#include "MAX7219.h"

// Register addresses
#define MAX_NOOP        0x00
#define MAX_DIGIT0      0x01   // digits are 0x01..0x08
#define MAX_DECODEMODE  0x09
#define MAX_INTENSITY   0x0A
#define MAX_SCANLIMIT   0x0B
#define MAX_SHUTDOWN    0x0C
#define MAX_DISPLAYTEST 0x0F

#define MAX_BLANK       0x0F   // BCD-decode code for a blank digit
#define MAX_DP          0x80   // OR into data to light the decimal point

static void max_send(MAX7219_t *d, uint8_t reg, uint8_t data) {
    gpio_write(d->cs, LOW);
    SPI.transfer(reg);
    SPI.transfer(data);
    gpio_write(d->cs, HIGH);
}

void MAX7219_init(MAX7219_t *d, uint8_t csPin, uint8_t numDigits) {
    d->cs = csPin;
    d->digits = (numDigits < 1) ? 1 : (numDigits > 8 ? 8 : numDigits);
    gpio_mode(csPin, GPIO_OUT);
    gpio_write(csPin, HIGH);

    max_send(d, MAX_DISPLAYTEST, 0x00);                 // normal operation
    max_send(d, MAX_SCANLIMIT, (uint8_t)(d->digits - 1));
    max_send(d, MAX_DECODEMODE, 0xFF);                  // BCD decode on all digits
    max_send(d, MAX_INTENSITY, 0x08);                   // mid brightness
    max_send(d, MAX_SHUTDOWN, 0x01);                    // wake up
    MAX7219_clear(d);
}

void MAX7219_setBrightness(MAX7219_t *d, uint8_t level) {
    max_send(d, MAX_INTENSITY, (uint8_t)(level & 0x0F));
}

void MAX7219_clear(MAX7219_t *d) {
    uint8_t i;
    for (i = 0; i < d->digits; i++)
        max_send(d, (uint8_t)(MAX_DIGIT0 + i), MAX_BLANK);
}

void MAX7219_showDigit(MAX7219_t *d, uint8_t pos, uint8_t value, uint8_t dp) {
    if (pos >= d->digits) return;
    uint8_t data = (value <= 9) ? value : MAX_BLANK;
    if (dp) data |= MAX_DP;
    max_send(d, (uint8_t)(MAX_DIGIT0 + pos), data);     // digit reg 1 = pos 0 = rightmost
}

void MAX7219_showNumber(MAX7219_t *d, int32_t number) {
    uint8_t neg = 0;
    int32_t n = number;
    if (n < 0) { neg = 1; n = -n; }

    uint8_t pos = 0;
    if (n == 0) {
        MAX7219_showDigit(d, 0, 0, 0);
        pos = 1;
    } else {
        while (n > 0 && pos < d->digits) {
            MAX7219_showDigit(d, pos, (uint8_t)(n % 10), 0);
            n /= 10;
            pos++;
        }
    }
    if (neg && pos < d->digits) {
        max_send(d, (uint8_t)(MAX_DIGIT0 + pos), 0x0A);  // '-' (BCD code-B minus)
        pos++;
    }
    // Blank any remaining leading digits.
    for (; pos < d->digits; pos++)
        max_send(d, (uint8_t)(MAX_DIGIT0 + pos), MAX_BLANK);
}
