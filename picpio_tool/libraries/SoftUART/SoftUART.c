#include "SoftUART.h"

void softuart_init(SoftUART_t *u, uint8_t tx, uint8_t rx, uint32_t baud) {
    u->tx     = tx;
    u->rx     = rx;
    u->baud   = baud ? baud : 9600;
    u->bitUs  = (uint16_t)(1000000UL / u->baud);
    u->halfUs = (uint16_t)(u->bitUs / 2);
}

void softuart_begin(SoftUART_t *u) {
    if (u->tx != 0xFF) {
        gpio_write(u->tx, 1);            // idle high
        gpio_mode(u->tx, GPIO_OUT);
        gpio_write(u->tx, 1);
    }
    if (u->rx != 0xFF) {
        gpio_mode(u->rx, GPIO_PULLUP);   // idle high via pull-up
    }
}

void softuart_write(SoftUART_t *u, uint8_t b) {
    if (u->tx == 0xFF) return;

    gpio_write(u->tx, 0);                // start bit
    delayMicroseconds(u->bitUs);

    for (uint8_t i = 0; i < 8; i++) {    // 8 data bits, LSB first
        gpio_write(u->tx, (uint8_t)((b >> i) & 1));
        delayMicroseconds(u->bitUs);
    }

    gpio_write(u->tx, 1);                // stop bit
    delayMicroseconds(u->bitUs);
}

void softuart_print(SoftUART_t *u, const char *s) {
    while (*s) softuart_write(u, (uint8_t)*s++);
}

void softuart_println(SoftUART_t *u, const char *s) {
    softuart_print(u, s);
    softuart_write(u, '\r');
    softuart_write(u, '\n');
}

void softuart_print_i(SoftUART_t *u, int32_t n) {
    static char buf[12];                 // static: avoid an auto array on the stack
    uint8_t  i   = 0;
    uint8_t  neg = 0;
    uint32_t x;

    if (n < 0) { neg = 1; x = (uint32_t)(-(n + 1)) + 1u; }   // safe for INT32_MIN
    else       { x = (uint32_t)n; }

    if (x == 0) buf[i++] = '0';
    while (x) { buf[i++] = (char)('0' + (x % 10)); x /= 10; }

    if (neg) softuart_write(u, '-');
    while (i) softuart_write(u, (uint8_t)buf[--i]);
}

uint8_t softuart_available(SoftUART_t *u) {
    if (u->rx == 0xFF) return 0;
    return (uint8_t)(gpio_read(u->rx) == 0);   // start bit pulls the line low
}

int softuart_read(SoftUART_t *u) {
    if (u->rx == 0xFF) return -1;

    // Wait for a start edge (line goes low), bounded so run() never hangs.
    uint32_t guard = 200000UL;
    while (gpio_read(u->rx)) {
        if (--guard == 0) return -1;
    }

    // Move to the middle of data bit 0: 1.5 bit periods after the start edge.
    delayMicroseconds(u->bitUs + u->halfUs);

    uint8_t v = 0;
    for (uint8_t i = 0; i < 8; i++) {          // LSB first
        if (gpio_read(u->rx)) v |= (uint8_t)(1u << i);
        delayMicroseconds(u->bitUs);
    }

    // We are now near the middle of the stop bit; let it finish.
    delayMicroseconds(u->halfUs);
    return (int)v;
}
