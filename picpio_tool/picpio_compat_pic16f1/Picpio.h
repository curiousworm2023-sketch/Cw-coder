#ifndef PICPIO_H
#define PICPIO_H

#include <xc.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

// ── Chip config (place in sketch to override) ─────────────────────────────────
#ifndef _XTAL_FREQ
#  define _XTAL_FREQ 32000000UL
#endif

// ── Arduino types ─────────────────────────────────────────────────────────────
typedef uint8_t  byte;
typedef uint16_t word;
typedef bool     boolean;

// ── Pin modes & logic levels ──────────────────────────────────────────────────
#define INPUT          0
#define OUTPUT         1
#define INPUT_PULLUP   2
#define HIGH           1
#define LOW            0

#if defined(_16F1826) || defined(_16F1827)
// ── Arduino pin numbers → PIC16F1826/1827 (18-pin enhanced midrange) ─────────
// D0–D7  = RB0–RB7
// D8–D10 = RA2–RA4 (AN2-AN4)
// D11    = RA5 (MCLR-shared, input-only, no ADC, MCLRE=OFF)
// D12    = RA6 (OSC2-shared; SPI SDO1 via SDO1SEL=1)
// D13    = RA7 (OSC1-shared, LED pin)
// A0–A1  = RA0, RA1 (AN0-AN1)
// Serial RX/TX, I2C, and SPI are relocated via APFCON0/APFCON1 in
// arduino_init() so they land on separate pins with no sharing:
//   RXDTSEL=1 -> Serial RX = RB2 (D2)
//   TXCKSEL=1 -> Serial TX = RB5 (D5)
//   SDO1SEL=1 -> SPI SDO1  = RA6 (D12)
// I2C SDA1/SCL1 and SPI SDI1/SCK1 stay at their fixed pins (D1/D4).
#define D0   0
#define D1   1
#define D2   2
#define D3   3
#define D4   4
#define D5   5
#define D6   6
#define D7   7
#define D8   8
#define D9   9
#define D10  10
#define D11  11
#define D12  12
#define D13  13   // LED pin (RA7)
#define A0   14
#define A1   15
#define LED_BUILTIN  D13

// ── Native port-pin names (use these directly, e.g. digitalWrite(RB0, HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
#define RB0  D0
#define RB1  D1   // I2C SDA1/SPI SDI1 (fixed)
#define RB2  D2   // Serial RX (via RXDTSEL=1)
#define RB3  D3   // CCP1/PWM
#define RB4  D4   // I2C SCL1/SPI SCK1 (fixed)
#define RB5  D5   // Serial TX (via TXCKSEL=1)
#define RB6  D6
#define RB7  D7
#define RA2  D8
#define RA3  D9
#define RA4  D10
#define RA5  D11
#define RA6  D12  // SPI SDO1 (via SDO1SEL=1)
#define RA7  D13
#define RA0  A0
#define RA1  A1
#endif // PICPIO_PIN_ALIASES

#elif defined(_16F1823) || defined(_16F1824) || defined(_16F1825)
// ── Arduino pin numbers → PIC16F1823/1824/1825 (14-pin enhanced midrange) ────
// D0–D5  = RC0–RC5
// D6–D11 = RA0–RA5
// D9     = RA3 (MCLR-shared, input-only, no ADC, MCLRE=OFF)
// D10    = RA4 (OSC2-shared)
// D11    = RA5 (OSC1-shared, LED pin)
// Every ADC channel (AN0-AN7) already has a Dn macro, so no separate A0..An.
// This family has a single APFCON0 alternate-pin-function register (no
// APFCON1-equivalent bits used here). Serial RX is relocated via
// arduino_init() so Serial, I2C and SPI don't share pins:
//   RXDTSEL=1 -> Serial RX = RA1 (D7)
// Serial TX (RC4/D4), SPI SDO1 (RC2/D2) and SS (RC3/D3) stay at their
// power-on defaults. I2C SDA1/SCL1 and SPI SDI1/SCK1 are fixed at RC1/RC0
// (D1/D0) — shared MSSP1 pins, same as on the other PIC16F1 variants.
#define D0   0
#define D1   1
#define D2   2
#define D3   3
#define D4   4
#define D5   5
#define D6   6
#define D7   7
#define D8   8
#define D9   9
#define D10  10
#define D11  11
#define LED_BUILTIN  D11

// ── Native port-pin names (use these directly, e.g. digitalWrite(RC0, HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
#define RC0  D0   // I2C SCL1/SPI SCK1 (fixed)
#define RC1  D1   // I2C SDA1/SPI SDI1 (fixed)
#define RC2  D2   // SPI SDO1
#define RC3  D3   // SPI SS
#define RC4  D4   // Serial TX
#define RC5  D5   // CCP1/PWM
#define RA0  D6
#define RA1  D7   // Serial RX (via RXDTSEL=1)
#define RA2  D8
#define RA3  D9
#define RA4  D10
#define RA5  D11
#endif // PICPIO_PIN_ALIASES

#else
// ── Arduino pin numbers → PIC16F1829 (20-pin enhanced midrange) ──────────────
// D0–D7  = RC0–RC7
// D8–D11 = RB4–RB7
// D12    = RA3 (input-only, no output driver, no ADC)
// D13    = RA5 (LED pin)
// A0–A3  = RA0, RA1, RA2, RA4 (AN0-AN3)
#define D0   0
#define D1   1
#define D2   2
#define D3   3
#define D4   4
#define D5   5
#define D6   6
#define D7   7
#define D8   8
#define D9   9
#define D10  10
#define D11  11
#define D12  12
#define D13  13   // LED pin (RA5)
#define A0   14
#define A1   15
#define A2   16
#define A3   17
#define LED_BUILTIN  D13

// ── Native port-pin names (use these directly, e.g. digitalWrite(RC0, HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
#define RC0  D0
#define RC1  D1
#define RC2  D2
#define RC3  D3
#define RC4  D4   // USART TX (fixed, no PPS)
#define RC5  D5   // USART RX (fixed) + CCP1/PWM — shared pin, see analogWrite() below
#define RC6  D6
#define RC7  D7   // SSP1 SDO
#define RB4  D8   // SSP1 SDA/SDI
#define RB5  D9
#define RB6  D10  // SSP1 SCL/SCK
#define RB7  D11
#define RA3  D12
#define RA5  D13
#define RA0  A0
#define RA1  A1
#define RA2  A2
#define RA4  A3
#endif // PICPIO_PIN_ALIASES
#endif

// ── Math ──────────────────────────────────────────────────────────────────────
#define PI        3.14159265358979f
#define TWO_PI    6.28318530717959f
#define HALF_PI   1.57079632679490f
#define DEG_TO_RAD 0.01745329251994f
#define RAD_TO_DEG 57.2957795130823f
#define min(a,b)  ((a)<(b)?(a):(b))
#define max(a,b)  ((a)>(b)?(a):(b))
#define abs(x)    ((x)>0?(x):-(x))
#define constrain(x,lo,hi) ((x)<(lo)?(lo):(x)>(hi)?(hi):(x))
#define map(x,fl,fh,tl,th) ((long)(x-fl)*(th-tl)/(fh-fl)+tl)
#define sq(x)     ((x)*(x))
#define round(x)  ((long)((x)+0.5f))
#define bitRead(v,b)        (((v)>>(b))&1)
#define bitSet(v,b)         ((v)|=(1<<(b)))
#define bitClear(v,b)       ((v)&=~(1<<(b)))
#define bitWrite(v,b,val)   ((val)?bitSet(v,b):bitClear(v,b))
#define bit(b)              (1<<(b))
#define lowByte(w)          ((uint8_t)((w)&0xFF))
#define highByte(w)         ((uint8_t)((w)>>8))

// ── Digital / Analog ──────────────────────────────────────────────────────────
void    pinMode(uint8_t pin, uint8_t mode);
void    digitalWrite(uint8_t pin, uint8_t val);
int     digitalRead(uint8_t pin);
int     analogRead(uint8_t pin);        // 10-bit result (0-1023)
void    analogWrite(uint8_t pin, uint8_t duty); // 8-bit PWM on the CCP1 pin only
                                                 // (D5/RC5 on PIC16F1829/1823/1824/1825,
                                                 // D3/RB3 on PIC16F1826/1827) — see
                                                 // pin-map notes above for pin-sharing
                                                 // caveats.

// ── Timing ────────────────────────────────────────────────────────────────────
void        delay(uint32_t ms);
void        delayMicroseconds(uint32_t us);
uint32_t    millis(void);
uint32_t    micros(void);

// ── Serial (function-pointer struct — works in C, syntax = Arduino C++) ───────
#ifdef _16F1823
// PIC16F1823 has only 128 bytes of RAM — print_i/print_f (and the sprintf-
// based _dbuf they pull in, ~32 bytes) don't fit alongside Serial's other
// members. print_s/println_s (plain strings) are still available; format
// numbers into a string yourself (e.g. with a small itoa) before printing.
typedef struct {
    void    (*begin)(uint32_t baud);
    void    (*end)(void);
    void    (*print)(const char *s);     // string overload
    void    (*println)(const char *s);   // string overload
    void    (*print_s)(const char *s);
    void    (*println_s)(const char *s);
    void    (*write)(uint8_t b);
    int     (*available)(void);
    int     (*read)(void);
    void    (*flush)(void);
} HardwareSerial_t;

extern HardwareSerial_t Serial;
#else
typedef struct {
    void    (*begin)(uint32_t baud);
    void    (*end)(void);
    void    (*print)(const char *s);     // string overload — use Serial_print() for int/float
    void    (*println)(const char *s);   // string overload — use Serial_println() for int/float
    void    (*print_s)(const char *s);
    void    (*print_i)(int32_t n);
    void    (*print_f)(float f, uint8_t decimals);
    void    (*println_s)(const char *s);
    void    (*println_i)(int32_t n);
    void    (*println_f)(float f, uint8_t decimals);
    void    (*write)(uint8_t b);
    int     (*available)(void);
    int     (*read)(void);
    void    (*flush)(void);
} HardwareSerial_t;

extern HardwareSerial_t Serial;

// Overload-like print macro (C11 _Generic)
// Use: Serial.print("text")  or  Serial.print(42)  or  Serial.print(3.14f)
#define Serial_print(x)   _Generic((x), \
    char*:       Serial.print_s,         \
    const char*: Serial.print_s,         \
    float:       _serial_print_f_def,    \
    double:      _serial_print_d_def,    \
    default:     Serial.print_i          \
)(x)

#define Serial_println(x) _Generic((x), \
    char*:       Serial.println_s,       \
    const char*: Serial.println_s,       \
    float:       _serial_println_f_def,  \
    double:      _serial_println_d_def,  \
    default:     Serial.println_i        \
)(x)

void _serial_print_f_def(float f);
void _serial_println_f_def(float f);
void _serial_print_d_def(double d);
void _serial_println_d_def(double d);
#endif // !_16F1823

// PIC16F1823 has only 128 bytes of RAM — the always-instantiated Serial
// struct plus its sprintf-based print buffers already consume nearly all of
// it, leaving no room for the Wire/SPI structs (~32 bytes). Wire and SPI are
// therefore unavailable on this chip; referencing them is a compile error.
#ifndef _16F1823

// ── Wire / I2C (function-pointer struct) ─────────────────────────────────────
typedef struct {
    void    (*begin)(void);
    void    (*beginTransmission)(uint8_t addr);
    uint8_t (*endTransmission)(void);
    uint8_t (*requestFrom)(uint8_t addr, uint8_t len);
    void    (*write)(uint8_t b);
    int     (*available)(void);
    int     (*read)(void);
} TwoWire_t;

extern TwoWire_t Wire;

// ── SPI (function-pointer struct) ─────────────────────────────────────────────
typedef struct {
    void    (*begin)(void);
    void    (*end)(void);
    uint8_t (*transfer)(uint8_t b);
    void    (*setBitOrder)(uint8_t order);
    void    (*setDataMode)(uint8_t mode);
    void    (*setClockDivider)(uint8_t div);
} SPIClass_t;

extern SPIClass_t SPI;

#endif // !_16F1823

#define MSBFIRST 1
#define LSBFIRST 0
#define SPI_MODE0 0
#define SPI_MODE1 1
#define SPI_MODE2 2
#define SPI_MODE3 3
#define SPI_CLOCK_DIV2   2
#define SPI_CLOCK_DIV4   4
#define SPI_CLOCK_DIV8   8
#define SPI_CLOCK_DIV16  16
#define SPI_CLOCK_DIV32  32
#define SPI_CLOCK_DIV64  64
#define SPI_CLOCK_DIV128 128

// ── Interrupt helpers ─────────────────────────────────────────────────────────
#define interrupts()    (INTCONbits.GIE = 1)
#define noInterrupts()  (INTCONbits.GIE = 0)

// ── Internal init (called by main_entry.c before setup()) ─────────────────────
void arduino_init(void);

// ── User-defined (sketch) ─────────────────────────────────────────────────────
void setup(void);
void loop(void);

// ════════════════════════════════════════════════════════════════════════════
// PICPIO native API — subsystem-prefixed names (the preferred/canonical names).
// The Arduino-style names above stay available so existing sketches and the
// bundled libraries keep compiling; new code should use the names below.
// ════════════════════════════════════════════════════════════════════════════
// GPIO (digital)
#define gpio_mode      pinMode
#define gpio_write     digitalWrite
#define gpio_read      digitalRead
#define GPIO_IN        INPUT
#define GPIO_OUT       OUTPUT
#define GPIO_PULLUP    INPUT_PULLUP
#define GPIO_HIGH      HIGH
#define GPIO_LOW       LOW
#define BUILTIN_LED    LED_BUILTIN
// ADC / PWM
#define adc_read       analogRead
#define pwm_write      analogWrite
// System / timing
#define sys_delay      delay
#define sys_delay_us   delayMicroseconds
#define sys_millis     millis
#define sys_micros     micros
#define sys_init       arduino_init
// Peripherals (objects keep their .begin/.read/.write/... methods)
#define uart1          Serial
#define uart2          Serial2
#define i2c1           Wire
#define i2c2           Wire2
#define spi1           SPI
#define uart1_print    Serial_print
#define uart1_println  Serial_println
// SPI constants
#define SPI_MSB        MSBFIRST
#define SPI_LSB        LSBFIRST
// Bit / byte helpers
#define bit_read       bitRead
#define bit_set        bitSet
#define bit_clr        bitClear
#define bit_write      bitWrite
#define byte_lo        lowByte
#define byte_hi        highByte

#endif // PICPIO_H
