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
#  define _XTAL_FREQ 20000000UL
#endif

// ── 40-pin classic PIC18F detection ───────────────────────────────────────────
// PIC18F2550 is a 28-pin chip with PORTA-C plus a single input-only RE3 pin
// (shared with MCLR), so it has no usable PORTD/E. PIC18F4550/452 are 40-pin
// chips with a full PORTD and PORTE (RE0-RE2), exposed below as D14-D21/D22-D24.
#if defined(_18F4550) || defined(_18F452)
#define PICPIO_HAS_PORTDE 1
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

// ── Arduino pin numbers → classic PIC18F4550/452/2550 ────────────────────────
// D0–D7  = RC0–RC7   (D2=RC2 CCP1/PWM, D3-D5=SCK/SDI/SDO, D6=TX, D7=RX)
// D8–D13 = RB0–RB5   (D13 = RB5, the "LED" pin)
// A0–A5  = RA0–RA5
// PIC18F2550 (28-pin) stops here (D0-D13, A0-A5).
// PIC18F4550/452 (40-pin) additionally have:
// D14–D21 = RD0–RD7
// D22–D24 = RE0–RE2 (also AN5-AN7)
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
#define D13  13   // LED pin (RB5)
#define A0   14
#define A1   15
#define A2   16
#define A3   17
#define A4   18
#define A5   19
#define LED_BUILTIN  D13

// ── Native port-pin names (use these directly, e.g. digitalWrite(RB0, HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
#define RC0  D0
#define RC1  D1
#define RC2  D2
#define RC3  D3
#define RC4  D4
#define RC5  D5
#define RC6  D6
#define RC7  D7
#define RB0  D8
#define RB1  D9
#define RB2  D10
#define RB3  D11
#define RB4  D12
#define RB5  D13
#define RA0  A0
#define RA1  A1
#define RA2  A2
#define RA3  A3
#define RA4  A4
#define RA5  A5
#endif // PICPIO_PIN_ALIASES

#ifdef PICPIO_HAS_PORTDE
#define D14  20
#define D15  21
#define D16  22
#define D17  23
#define D18  24
#define D19  25
#define D20  26
#define D21  27
#define D22  28
#define D23  29
#define D24  30
#define RD0  D14
#define RD1  D15
#define RD2  D16
#define RD3  D17
#define RD4  D18
#define RD5  D19
#define RD6  D20
#define RD7  D21
#define RE0  D22
#define RE1  D23
#define RE2  D24
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
void    analogWrite(uint8_t pin, uint8_t duty); // 8-bit PWM via CCP1 on RC2 (D2)

// ── Timing ────────────────────────────────────────────────────────────────────
void        delay(uint32_t ms);
void        delayMicroseconds(uint32_t us);
uint32_t    millis(void);
uint32_t    micros(void);

// ── Serial (function-pointer struct — works in C, syntax = Arduino C++) ───────
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

extern HardwareSerial_t Serial;   // USART TX=RC6, RX=RC7

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

extern TwoWire_t Wire;  // I2C SCL=RC3, SDA=RC4

// ── SPI (function-pointer struct) ─────────────────────────────────────────────
typedef struct {
    void    (*begin)(void);
    void    (*end)(void);
    uint8_t (*transfer)(uint8_t b);
    void    (*setBitOrder)(uint8_t order);
    void    (*setDataMode)(uint8_t mode);
    void    (*setClockDivider)(uint8_t div);
} SPIClass_t;

extern SPIClass_t SPI;  // SPI SCK=RC3, SDI=RC4, SDO=RC5

// ── Second-instance protocols (software/bit-banged) ──────────────────────────
// PIC18F4550/452/2550 have only ONE hardware EUSART and ONE MSSP module, so
// these "doubled" protocols are implemented by bit-banging free GPIO pins:
//   Serial2 : software UART — TX2=RC0 (D0), RX2=RC1 (D1)
//   Wire2   : software I2C  — SCL2=RB0 (D8), SDA2=RB1 (D9) (needs external pull-ups)
//   SPI2    : software SPI  — SCK2=RB2 (D10), MOSI2=RB3 (D11), MISO2=RB4 (D12)
//             (no fixed CS — drive any free pin manually with digitalWrite)
extern HardwareSerial_t Serial2;  // soft-UART TX=RC0, RX=RC1
extern TwoWire_t Wire2;
extern SPIClass_t SPI2;

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
void init(void);   // runs once at boot   (define this; `setup` still works)
void run(void);    // runs forever        (define this; `loop` still works)
#define setup init
#define loop  run

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
