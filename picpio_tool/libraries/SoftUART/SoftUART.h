#ifndef SOFTUART_H
#define SOFTUART_H

#include <Picpio.h>

// Bit-banged UART (8N1) on plain GPIO — for boards whose hardware EUSART is
// dead. Instance-based: pass a SoftUART_t* so several ports can coexist.
// Framing: idle HIGH, 1 start bit (LOW), 8 data bits LSB-first, 1 stop bit (HIGH).
//
// TX is half-duplex polled; RX is polled (read() blocks waiting for a start
// edge, then samples each bit at its middle). The bit period is computed from
// baud at init.
//
// RELIABLE BAUD: because RX/TX use the portable gpio_ calls (~1-2 us each) plus
// delayMicroseconds(), the dependable range is ~9600-38400 polled. 9600-19200
// is rock-solid; 38400 works but is timing-tight. For higher rates on ONE known
// chip, replace gpio_write(u->tx,…)/gpio_read(u->rx) in SoftUART.c with direct
// LATxbits/PORTxbits access and trim the bit period for instruction overhead.
//
// RETUNING for a different Fosc: the bit period is 1,000,000 / baud microseconds
// regardless of Fosc, BUT delayMicroseconds() must itself be accurate — make
// sure _XTAL_FREQ matches your real clock so the HAL's delays are calibrated.

typedef struct {
    uint8_t  tx;
    uint8_t  rx;
    uint32_t baud;
    uint16_t bitUs;     // one bit period in microseconds
    uint16_t halfUs;    // half bit period (for mid-bit RX sampling)
} SoftUART_t;

// Configure an instance. tx/rx are PICPIO pins (use 0xFF to disable that half).
void softuart_init(SoftUART_t *u, uint8_t tx, uint8_t rx, uint32_t baud);

// Park TX idle high and set RX as a pulled-up input. Call once in init().
void softuart_begin(SoftUART_t *u);

// Transmit.
void softuart_write(SoftUART_t *u, uint8_t b);
void softuart_print(SoftUART_t *u, const char *s);
void softuart_println(SoftUART_t *u, const char *s);   // print + "\r\n"
void softuart_print_i(SoftUART_t *u, int32_t n);       // signed decimal

// Receive (polled).
// available() is 1 when RX is low (a start bit may be beginning).
// read() waits for a start edge, samples a full 8N1 frame, and returns the byte
// (0..255), or -1 if no start edge arrives within a bounded guard time.
uint8_t softuart_available(SoftUART_t *u);
int     softuart_read(SoftUART_t *u);

#endif // SOFTUART_H
