#ifndef PICPIO_H
#define PICPIO_H

#include <xc.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

// ── Chip config (place in sketch to override) ─────────────────────────────────
// 7.3728MHz crystal in FPR=XT (no PLL) mode -> Fosc=7.3728MHz, FCY=1.8432MHz.
// Chosen because it divides evenly for exact UART baud rates (U1BRG=11 @ 9600).
#ifndef _XTAL_FREQ
#  define _XTAL_FREQ 7372800UL
#endif

// FCY (instruction clock) must be defined before <libpic30.h> so __delay_ms/us work.
#define FCY (_XTAL_FREQ / 4UL)
#include <libpic30.h>

// <xc.h> (p30F4011.h) defines a typedef named "SPI" for the generic SPI
// module SFR struct. Rename our Arduino-style SPI object to avoid the symbol
// clash -- sketches still write `SPI.transfer(...)` as normal.
#define SPI SPI_dev

// ── Per-part feature flags ────────────────────────────────────────────────────
// Small SMPS/general-purpose parts that lack a second UART and whose flash is
// too small for sprintf's float support (the lightweight float printer in
// wiring.c is used instead). Keyed on the specific device so the same HAL
// serves the whole dsPIC30F line.
#if defined(__dsPIC30F2010__) || defined(__dsPIC30F2011__) || defined(__dsPIC30F2012__)
#  define PICPIO_NO_UART2
#  define PICPIO_TINY_FLASH
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

#if defined(__dsPIC30F3013__) || defined(__dsPIC30F2012__)
// ── Arduino pin numbers -> dsPIC30F3013 / dsPIC30F2012 (28-pin) ──────────────
// Identical pinout; the 2012 just has no UART2 (so its RF4/RF5 are plain GPIO,
// not U2RX/U2TX) and smaller flash. No PORTA/PORTE on either.
// D0-D9   = RB0-RB9   (also A0-A9 = AN0-AN9, all analog-capable)
//   D8=RB8 (AN8/OC1) and D9=RB9 (AN9/OC2) are the two analogWrite/PWM pins --
//   note PWM is on PORTB here, not PORTD as on the 4011/2010.
// D10-D12 = RC13-RC15 (only 3 PORTC bits exist on this chip)
// D13-D14 = RD8-RD9   (IC1/INT1, IC2/INT2)
// D15-D19 = RF2-RF6
//   D15=RF2 (U1RX/SDI1/SDA), D16=RF3 (U1TX/SDO1/SCL), D17=RF4 (U2RX on 3013),
//   D18=RF5 (U2TX on 3013), D19=RF6 (SCK1) -- RF2/RF3 are shared between
//   UART1, SPI1 and I2C (fixed, non-PPS pins): don't use Serial, SPI and Wire
//   at the same time on real hardware.
#define D0   0
#define D1   1
#define D2   2
#define D3   3
#define D4   4
#define D5   5
#define D6   6
#define D7   7
#define D8   8    // RB8 / AN8 / OC1 -- LED pin (PWM-capable)
#define D9   9    // RB9 / AN9 / OC2 (PWM-capable)
#define D10  10
#define D11  11
#define D12  12
#define D13  13
#define D14  14
#define D15  15
#define D16  16
#define D17  17
#define D18  18
#define D19  19
#define A0   D0
#define A1   D1
#define A2   D2
#define A3   D3
#define A4   D4
#define A5   D5
#define A6   D6
#define A7   D7
#define A8   D8
#define A9   D9
#define LED_BUILTIN  D8

// ── Native port-pin names (use these directly, e.g. digitalWrite(RB0, HIGH)) ──
#define RB0  D0
#define RB1  D1
#define RB2  D2
#define RB3  D3
#define RB4  D4
#define RB5  D5
#define RB6  D6
#define RB7  D7
#define RB8  D8
#define RB9  D9
#define RC13 D10
#define RC14 D11
#define RC15 D12
#define RD8  D13
#define RD9  D14
#define RF2  D15
#define RF3  D16
#define RF4  D17
#define RF5  D18
#define RF6  D19

#elif defined(__dsPIC30F4013__) || defined(__dsPIC30F3014__)
// ── Arduino pin numbers -> dsPIC30F4013 / dsPIC30F3014 (40/44-pin GP) ────────
// Identical pinout on both; the only difference is analogWrite/PWM channels:
// 4013 has OC1-OC4 on RD0-RD3, 3014 has only OC1/OC2 on RD0/RD1.
// D0-D12  = RB0-RB12 (also A0-A12 = AN0-AN12, all analog-capable)
// D13-D15 = RC13-RC15
// D16-D19 = RD0-RD3  (OC PWM analogWrite targets; LED_BUILTIN=D16/RD0)
// D20-D21 = RD8-RD9  (IC1/INT1, IC2/INT2)
// D22-D28 = RF0-RF6
//   D24=RF2 (U1RX/SDI1/SDA), D25=RF3 (U1TX/SDO1/SCL), D26=RF4 (U2RX),
//   D27=RF5 (U2TX), D28=RF6 (SCK1) -- RF2/RF3 are shared between UART1,
//   SPI1 and I2C (fixed, non-PPS pins): don't use Serial, SPI and Wire at
//   the same time on real hardware.
// D29     = RA11 (only PORTA bit bonded out on this chip)
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
#define D13  13
#define D14  14
#define D15  15
#define D16  16   // RD0 / OC1 -- LED pin
#define D17  17   // RD1 / OC2
#define D18  18   // RD2 / OC3
#define D19  19   // RD3 / OC4
#define D20  20
#define D21  21
#define D22  22
#define D23  23
#define D24  24
#define D25  25
#define D26  26
#define D27  27
#define D28  28
#define D29  29
#define A0   D0
#define A1   D1
#define A2   D2
#define A3   D3
#define A4   D4
#define A5   D5
#define A6   D6
#define A7   D7
#define A8   D8
#define A9   D9
#define A10  D10
#define A11  D11
#define A12  D12
#define LED_BUILTIN  D16

// ── Native port-pin names (use these directly, e.g. digitalWrite(RB0, HIGH)) ──
#define RB0  D0
#define RB1  D1
#define RB2  D2
#define RB3  D3
#define RB4  D4
#define RB5  D5
#define RB6  D6
#define RB7  D7
#define RB8  D8
#define RB9  D9
#define RB10 D10
#define RB11 D11
#define RB12 D12
#define RC13 D13
#define RC14 D14
#define RC15 D15
#define RD0  D16
#define RD1  D17
#define RD2  D18
#define RD3  D19
#define RD8  D20
#define RD9  D21
#define RF0  D22
#define RF1  D23
#define RF2  D24
#define RF3  D25
#define RF4  D26
#define RF5  D27
#define RF6  D28
#define RA11 D29

#elif !defined(__dsPIC30F2010__)
// ── Arduino pin numbers -> dsPIC30F4011 (no PORTA on this chip) ──────────────
// D0-D8   = RB0-RB8   (also A0-A8 = AN0-AN8, all analog-capable)
// D9-D11  = RC13-RC15 (only 3 PORTC bits exist on this chip)
// D12-D15 = RD0-RD3   (OC1-OC4 -- PWM-capable, analogWrite targets; LED_BUILTIN=D12/RD0)
// D16-D22 = RE0-RE5, RE8 (7 PORTE bits; PWMxL/PWMxH outputs on RE0-RE5)
// D23-D29 = RF0-RF6
//   D25=RF2 (U1RX/SDI1/SDA), D26=RF3 (U1TX/SDO1/SCL), D27=RF4 (U2RX),
//   D28=RF5 (U2TX), D29=RF6 (SCK1) -- note RF2/RF3 are shared between
//   UART1, SPI1 and I2C (fixed, non-PPS pins): don't use Serial, SPI and
//   Wire at the same time on real hardware.
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
#define D12  12   // RD0 / OC1 -- LED pin
#define D13  13   // RD1 / OC2
#define D14  14   // RD2 / OC3
#define D15  15   // RD3 / OC4
#define D16  16
#define D17  17
#define D18  18
#define D19  19
#define D20  20
#define D21  21
#define D22  22
#define D23  23
#define D24  24
#define D25  25
#define D26  26
#define D27  27
#define D28  28
#define D29  29
#define A0   D0
#define A1   D1
#define A2   D2
#define A3   D3
#define A4   D4
#define A5   D5
#define A6   D6
#define A7   D7
#define A8   D8
#define LED_BUILTIN  D12

// ── Native port-pin names (use these directly, e.g. digitalWrite(RB0, HIGH)) ──
#define RB0  D0
#define RB1  D1
#define RB2  D2
#define RB3  D3
#define RB4  D4
#define RB5  D5
#define RB6  D6
#define RB7  D7
#define RB8  D8
#define RC13 D9
#define RC14 D10
#define RC15 D11
#define RD0  D12
#define RD1  D13
#define RD2  D14
#define RD3  D15
#define RE0  D16
#define RE1  D17
#define RE2  D18
#define RE3  D19
#define RE4  D20
#define RE5  D21
#define RE8  D22
#define RF0  D23
#define RF1  D24
#define RF2  D25
#define RF3  D26
#define RF4  D27
#define RF5  D28
#define RF6  D29

#else // __dsPIC30F2010__

// ── Arduino pin numbers -> dsPIC30F2010 (28-pin, no PORTA on this chip) ──────
// D0-D5  = RB0-RB5  (also A0-A5 = AN0-AN5, all analog-capable)
// D6-D8  = RC13-RC15 (only 3 PORTC bits exist on this chip)
// D9-D10 = RD0-RD1  (OC1/OC2 -- PWM-capable, analogWrite targets; LED_BUILTIN=D9/RD0)
// D11-D17= RE0-RE5, RE8 (7 PORTE bits; D17=RE8 also doubles as SCK1)
// D18-D19= RF2-RF3
//   D18=RF2 (U1RX/SDI1/SDA), D19=RF3 (U1TX/SDO1/SCL) -- shared between
//   UART1, SPI1 (data lines) and I2C (fixed, non-PPS pins): don't use
//   Serial, SPI and Wire at the same time on real hardware. This chip has
//   no UART2 hardware, so there is no Serial2.
#define D0   0
#define D1   1
#define D2   2
#define D3   3
#define D4   4
#define D5   5
#define D6   6
#define D7   7
#define D8   8
#define D9   9    // RD0 / OC1 -- LED pin
#define D10  10   // RD1 / OC2
#define D11  11
#define D12  12
#define D13  13
#define D14  14
#define D15  15
#define D16  16
#define D17  17   // RE8 / SCK1
#define D18  18   // RF2 -- U1RX/SDI1/SDA
#define D19  19   // RF3 -- U1TX/SDO1/SCL
#define A0   D0
#define A1   D1
#define A2   D2
#define A3   D3
#define A4   D4
#define A5   D5
#define LED_BUILTIN  D9

// ── Native port-pin names (use these directly, e.g. digitalWrite(RB0, HIGH)) ──
#define RB0  D0
#define RB1  D1
#define RB2  D2
#define RB3  D3
#define RB4  D4
#define RB5  D5
#define RC13 D6
#define RC14 D7
#define RC15 D8
#define RD0  D9
#define RD1  D10
#define RE0  D11
#define RE1  D12
#define RE2  D13
#define RE3  D14
#define RE4  D15
#define RE5  D16
#define RE8  D17
#define RF2  D18
#define RF3  D19

#endif // __dsPIC30F2010__

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
int     analogRead(uint8_t pin);                // 10-bit result (0-1023), pins D0-D8/A0-A8 only
void    analogWrite(uint8_t pin, uint8_t duty); // 8-bit PWM via OC1-OC4 (D12-D15 on 4011) / OC1-OC2 (D9-D10 on 2010)

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

extern HardwareSerial_t Serial;   // UART1 (RF3=TX, RF2=RX)
#ifndef PICPIO_NO_UART2
extern HardwareSerial_t Serial2;  // UART2 (RF5=TX, RF4=RX) — real hardware module
#endif

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

extern TwoWire_t Wire; // I2C module (SCL=RF3, SDA=RF2 -- D26/D25 on 4011, D19/D18 on 2010)

// ── SPI (function-pointer struct) ─────────────────────────────────────────────
typedef struct {
    void    (*begin)(void);
    void    (*end)(void);
    uint8_t (*transfer)(uint8_t b);
    void    (*setBitOrder)(uint8_t order);
    void    (*setDataMode)(uint8_t mode);
    void    (*setClockDivider)(uint8_t div);
} SPIClass_t;

extern SPIClass_t SPI; // SPI1 (SDO=RF3, SDI=RF2 -- D26/D25 on 4011, D19/D18 on 2010; SCK=RF6/D29 on 4011, SCK=RE8/D17 on 2010)

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
#define interrupts()    (__builtin_enable_interrupts())
#define noInterrupts()  (__builtin_disable_interrupts())

// ── Internal init (called by main_entry.c before setup()) ─────────────────────
void arduino_init(void);

// ── User-defined (sketch) ─────────────────────────────────────────────────────
void setup(void);
void loop(void);

#endif // PICPIO_H
