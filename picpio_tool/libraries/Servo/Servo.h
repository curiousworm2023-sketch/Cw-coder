// Servo.h — PICPIO C driver for hobby RC servos (software-timed, any pin).
//
// Drives up to SERVO_MAX servos by bit-banging the 1-2 ms pulse every ~20 ms.
// Call Servo_refresh() frequently from run() (it self-paces to a 20 ms frame
// using millis()); each refresh emits one pulse per attached servo.
//
// Usage:
//   Servo_t s;
//   void init() { Servo_attach(&s, D9); Servo_write(&s, 90); }
//   void run()  { Servo_refresh(); /* ...your code... */ }
#ifndef PICPIO_SERVO_H
#define PICPIO_SERVO_H

#include "Picpio.h"

#ifndef SERVO_MAX
#define SERVO_MAX 8            // max simultaneously attached servos
#endif

typedef struct {
    uint8_t  pin;
    uint16_t pulseUs;          // current pulse width
    uint16_t minUs, maxUs;     // pulse range mapped to 0..180 degrees
    uint8_t  active;
} Servo_t;

// Attach on `pin` with the default 1000-2000 us range; servo holds 90 deg.
void     Servo_attach(Servo_t *s, uint8_t pin);
// Attach with a custom pulse range (e.g. 544/2400 for full 180 deg travel).
void     Servo_attachRange(Servo_t *s, uint8_t pin, uint16_t minUs, uint16_t maxUs);
void     Servo_detach(Servo_t *s);

void     Servo_write(Servo_t *s, uint8_t angle);            // 0..180 degrees
void     Servo_writeMicroseconds(Servo_t *s, uint16_t us);  // raw pulse width
uint16_t Servo_read(Servo_t *s);                            // last angle (0..180)

// Emit pulses to all attached servos. Call often from run(); returns
// immediately until ~20 ms have elapsed since the last frame.
void     Servo_refresh(void);

#endif // PICPIO_SERVO_H
