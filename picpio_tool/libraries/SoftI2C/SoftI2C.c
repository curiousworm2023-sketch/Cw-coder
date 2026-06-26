#include "SoftI2C.h"

// ── Open-drain line control ──────────────────────────────────────────────────
// Latches are preloaded to 0 in softi2c_begin(), so driving a line low is just
// switching it to OUTPUT, and releasing it is switching back to INPUT. We never
// write a 1 to the latch, so the lines are never actively driven high.

static void i2c_delay(SoftI2C_t *b) {
    if (b->halfUs) delayMicroseconds(b->halfUs);
}

static void sda_low(SoftI2C_t *b)  { gpio_mode(b->sda, GPIO_OUT); }
static void sda_release(SoftI2C_t *b) { gpio_mode(b->sda, b->relMode); }
static uint8_t sda_read(SoftI2C_t *b) { return (uint8_t)gpio_read(b->sda); }

static void scl_low(SoftI2C_t *b)  { gpio_mode(b->scl, GPIO_OUT); }

// Release SCL and wait for it to actually go high (clock stretching), bounded
// by timeout. Returns 1 if SCL rose, 0 if it stayed low (slave stuck / no pull-up).
static uint8_t scl_release(SoftI2C_t *b) {
    gpio_mode(b->scl, b->relMode);
    uint16_t t = b->timeout;
    while (!gpio_read(b->scl)) {
        if (t && --t == 0) return 0;
    }
    return 1;
}

void softi2c_init(SoftI2C_t *b, uint8_t sda, uint8_t scl, uint16_t halfUs, uint8_t useInternalPullups) {
    b->sda     = sda;
    b->scl     = scl;
    b->halfUs  = halfUs ? halfUs : 5;     // ~100 kHz default
    b->relMode = useInternalPullups ? GPIO_PULLUP : GPIO_IN;
    b->timeout = 2000;                    // generous stretch/stuck guard
}

void softi2c_begin(SoftI2C_t *b) {
    gpio_write(b->sda, 0);    // preload latches low (driven only via direction)
    gpio_write(b->scl, 0);
    sda_release(b);           // idle high
    scl_release(b);
    i2c_delay(b);
}

void softi2c_start(SoftI2C_t *b) {
    sda_release(b);
    scl_release(b);
    i2c_delay(b);
    sda_low(b);               // SDA high->low while SCL high = START
    i2c_delay(b);
    scl_low(b);
    i2c_delay(b);
}

void softi2c_restart(SoftI2C_t *b) {
    scl_low(b);
    sda_release(b);
    i2c_delay(b);
    scl_release(b);
    i2c_delay(b);
    sda_low(b);               // START again
    i2c_delay(b);
    scl_low(b);
    i2c_delay(b);
}

void softi2c_stop(SoftI2C_t *b) {
    sda_low(b);
    i2c_delay(b);
    scl_release(b);
    i2c_delay(b);
    sda_release(b);           // SDA low->high while SCL high = STOP
    i2c_delay(b);
}

uint8_t softi2c_write_byte(SoftI2C_t *b, uint8_t value) {
    for (uint8_t i = 0; i < 8; i++) {
        if (value & 0x80) sda_release(b); else sda_low(b);   // MSB first
        i2c_delay(b);
        scl_release(b);
        i2c_delay(b);
        scl_low(b);
        value = (uint8_t)(value << 1);
    }
    // 9th clock: read the slave's ACK (SDA pulled low by slave = ACK).
    sda_release(b);
    i2c_delay(b);
    scl_release(b);
    uint8_t ack = (uint8_t)(!sda_read(b));
    i2c_delay(b);
    scl_low(b);
    return ack;
}

uint8_t softi2c_read_byte(SoftI2C_t *b, uint8_t send_ack) {
    uint8_t v = 0;
    sda_release(b);           // let the slave drive SDA
    for (uint8_t i = 0; i < 8; i++) {
        scl_release(b);
        i2c_delay(b);
        v = (uint8_t)((v << 1) | (sda_read(b) & 1));   // MSB first
        i2c_delay(b);
        scl_low(b);
    }
    // 9th clock: master ACK (drive low) or NACK (release).
    if (send_ack) sda_low(b); else sda_release(b);
    i2c_delay(b);
    scl_release(b);
    i2c_delay(b);
    scl_low(b);
    sda_release(b);
    return v;
}

uint8_t softi2c_write(SoftI2C_t *b, uint8_t addr, const uint8_t *data, uint16_t len) {
    softi2c_start(b);
    uint8_t ok = softi2c_write_byte(b, (uint8_t)((addr << 1) | 0));   // write
    for (uint16_t i = 0; ok && i < len; i++) ok = softi2c_write_byte(b, data[i]);
    softi2c_stop(b);
    return ok;
}

uint8_t softi2c_read(SoftI2C_t *b, uint8_t addr, uint8_t *buf, uint16_t len) {
    softi2c_start(b);
    uint8_t ok = softi2c_write_byte(b, (uint8_t)((addr << 1) | 1));   // read
    if (!ok) { softi2c_stop(b); return 0; }
    for (uint16_t i = 0; i < len; i++) {
        buf[i] = softi2c_read_byte(b, (uint8_t)(i < (len - 1)));      // ACK all but last
    }
    softi2c_stop(b);
    return 1;
}
