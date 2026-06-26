#include "SoftSPI.h"

// Half-clock delay (skipped entirely when halfDelayUs == 0 for max speed).
static void ss_delay(SoftSPI_t *s) {
    if (s->halfDelayUs) delayMicroseconds(s->halfDelayUs);
}

void softspi_init(SoftSPI_t *s, uint8_t sck, uint8_t mosi, uint8_t miso, uint8_t cs,
                  uint8_t mode, uint8_t msbFirst, uint8_t halfDelayUs) {
    s->sck         = sck;
    s->mosi        = mosi;
    s->miso        = miso;
    s->cs          = cs;
    s->mode        = mode & 0x03;
    s->msbFirst    = msbFirst ? 1 : 0;
    s->halfDelayUs = halfDelayUs;
    s->cpol        = (s->mode & 0x02) ? 1 : 0;   // mode 2/3 idle high
    s->cpha        = (s->mode & 0x01) ? 1 : 0;   // mode 1/3 sample on trailing edge
}

void softspi_begin(SoftSPI_t *s) {
    gpio_write(s->sck, s->cpol);       // park clock at idle level first
    gpio_mode(s->sck, GPIO_OUT);
    gpio_write(s->sck, s->cpol);

    gpio_write(s->mosi, 0);
    gpio_mode(s->mosi, GPIO_OUT);

    gpio_mode(s->miso, GPIO_IN);

    if (s->cs != 0xFF) {
        gpio_write(s->cs, 1);          // de-asserted (active low)
        gpio_mode(s->cs, GPIO_OUT);
    }
}

uint8_t softspi_transfer(SoftSPI_t *s, uint8_t out) {
    uint8_t in   = 0;
    uint8_t lead = (uint8_t)!s->cpol;  // SCK level at the leading (active) edge
    uint8_t idle = s->cpol;            // SCK level at the trailing (idle) edge

    for (uint8_t i = 0; i < 8; i++) {
        uint8_t bitpos = s->msbFirst ? (uint8_t)(7 - i) : i;
        uint8_t obit   = (uint8_t)((out >> bitpos) & 1);
        uint8_t ibit;

        if (s->cpha == 0) {
            // CPHA0: data valid before the leading edge; sample on leading edge.
            gpio_write(s->mosi, obit);
            ss_delay(s);
            gpio_write(s->sck, lead);
            ibit = (uint8_t)gpio_read(s->miso);
            ss_delay(s);
            gpio_write(s->sck, idle);
        } else {
            // CPHA1: shift on the leading edge; sample on the trailing edge.
            gpio_write(s->sck, lead);
            gpio_write(s->mosi, obit);
            ss_delay(s);
            gpio_write(s->sck, idle);
            ibit = (uint8_t)gpio_read(s->miso);
            ss_delay(s);
        }

        if (ibit) in |= (uint8_t)(1u << bitpos);
    }
    return in;
}

void softspi_transfer_block(SoftSPI_t *s, uint8_t *buf, uint16_t len) {
    for (uint16_t i = 0; i < len; i++) buf[i] = softspi_transfer(s, buf[i]);
}

void softspi_select(SoftSPI_t *s) {
    if (s->cs != 0xFF) gpio_write(s->cs, 0);
}

void softspi_deselect(SoftSPI_t *s) {
    if (s->cs != 0xFF) gpio_write(s->cs, 1);
}
