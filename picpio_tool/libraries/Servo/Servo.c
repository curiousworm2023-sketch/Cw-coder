// Servo.c — software-timed RC servo driver (see Servo.h).
#include "Servo.h"

#define SERVO_FRAME_MS 20      // standard 50 Hz refresh

static Servo_t *s_list[SERVO_MAX];
static uint8_t  s_count = 0;
static uint32_t s_lastFrame = 0;

static uint16_t s_clamp(uint16_t v, uint16_t lo, uint16_t hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

void Servo_attachRange(Servo_t *s, uint8_t pin, uint16_t minUs, uint16_t maxUs) {
    s->pin     = pin;
    s->minUs   = minUs;
    s->maxUs   = maxUs;
    s->pulseUs = (uint16_t)((minUs + maxUs) / 2);   // start centered
    s->active  = 1;
    gpio_mode(pin, GPIO_OUT);
    gpio_write(pin, GPIO_LOW);
    // register (avoid duplicates)
    uint8_t i;
    for (i = 0; i < s_count; i++) if (s_list[i] == s) return;
    if (s_count < SERVO_MAX) s_list[s_count++] = s;
}

void Servo_attach(Servo_t *s, uint8_t pin) {
    Servo_attachRange(s, pin, 1000, 2000);
}

void Servo_detach(Servo_t *s) {
    s->active = 0;
    uint8_t i, j;
    for (i = 0; i < s_count; i++) {
        if (s_list[i] == s) {
            for (j = i; j + 1 < s_count; j++) s_list[j] = s_list[j + 1];
            s_count--;
            break;
        }
    }
}

void Servo_writeMicroseconds(Servo_t *s, uint16_t us) {
    s->pulseUs = s_clamp(us, s->minUs, s->maxUs);
}

void Servo_write(Servo_t *s, uint8_t angle) {
    if (angle > 180) angle = 180;
    uint16_t span = (uint16_t)(s->maxUs - s->minUs);
    s->pulseUs = (uint16_t)(s->minUs + ((uint32_t)angle * span) / 180);
}

uint16_t Servo_read(Servo_t *s) {
    uint16_t span = (uint16_t)(s->maxUs - s->minUs);
    if (span == 0) return 0;
    return (uint16_t)(((uint32_t)(s->pulseUs - s->minUs) * 180) / span);
}

void Servo_refresh(void) {
    if ((uint32_t)(millis() - s_lastFrame) < SERVO_FRAME_MS) return;
    s_lastFrame = millis();
    uint8_t i;
    for (i = 0; i < s_count; i++) {
        Servo_t *s = s_list[i];
        if (!s || !s->active) continue;
        gpio_write(s->pin, GPIO_HIGH);
        delayMicroseconds(s->pulseUs);
        gpio_write(s->pin, GPIO_LOW);
    }
}
