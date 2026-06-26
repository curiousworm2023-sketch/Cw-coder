#ifndef SOFTI2C_H
#define SOFTI2C_H

#include <Picpio.h>

// Bit-banged I2C master (7-bit addressing) on plain GPIO — for boards whose
// hardware MSSP/I2C is dead. Instance-based: pass a SoftI2C_t* so several buses
// can coexist. ~100 kHz with the default half-bit delay at Fosc = 64 MHz.
//
// TRUE OPEN-DRAIN: a line is driven LOW by switching the pin to OUTPUT (its
// latch is preloaded with 0); it is released HIGH by switching the pin back to
// INPUT and letting the pull-up raise it. The lines are NEVER actively driven
// high, exactly like real I2C.
//
//   >>> EXTERNAL PULL-UP RESISTORS ARE REQUIRED on SDA and SCL (typ. 4.7 kohm
//       to VDD). The PIC's internal weak pull-ups (~35 kohm) are usually too
//       weak for reliable I2C, but you can enable them as a fallback by passing
//       useInternalPullups = 1 to softi2c_init().
//
// Clock stretching is honoured: after releasing SCL the master waits until the
// slave lets SCL rise (bounded by a timeout).

typedef struct {
    uint8_t  sda;
    uint8_t  scl;
    uint16_t halfUs;    // half bit period in us (0 -> default ~5 us => ~100 kHz)
    uint8_t  relMode;   // line-release mode: GPIO_IN or GPIO_PULLUP (set in init)
    uint16_t timeout;   // clock-stretch / bus-stuck guard (loop iterations)
} SoftI2C_t;

// Configure an instance. halfUs = 0 uses ~5 us (~100 kHz). useInternalPullups:
// 1 = release lines with the internal weak pull-up enabled (fallback only).
void softi2c_init(SoftI2C_t *b, uint8_t sda, uint8_t scl, uint16_t halfUs, uint8_t useInternalPullups);

// Preload latches to 0 and release both lines (idle high). Call once in init().
void softi2c_begin(SoftI2C_t *b);

// Low-level bus primitives.
void    softi2c_start(SoftI2C_t *b);                       // START condition
void    softi2c_stop(SoftI2C_t *b);                        // STOP condition
void    softi2c_restart(SoftI2C_t *b);                     // repeated START
uint8_t softi2c_write_byte(SoftI2C_t *b, uint8_t value);   // returns 1 if slave ACKed
uint8_t softi2c_read_byte(SoftI2C_t *b, uint8_t send_ack); // master ACK (1) or NACK (0)

// High-level helpers. addr is the 7-bit slave address.
// Returns 1 on success (all bytes ACKed), 0 on NACK / bus timeout.
uint8_t softi2c_write(SoftI2C_t *b, uint8_t addr, const uint8_t *data, uint16_t len);
uint8_t softi2c_read(SoftI2C_t *b, uint8_t addr, uint8_t *buf, uint16_t len);

#endif // SOFTI2C_H
