#ifndef PICPIO_H
#define PICPIO_H

#include <xc.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

// ── Chip config (place in sketch to override) ─────────────────────────────────
// 7.3728MHz crystal in POSCMD=XT (no PLL) mode -> Fosc=7.3728MHz, FCY=3.6864MHz.
// Chosen because it divides evenly for exact UART baud rates (U1BRG=23 @ 9600).
#ifndef _XTAL_FREQ
#  define _XTAL_FREQ 7372800UL
#endif

// FCY (instruction clock) must be defined before <libpic30.h> so __delay_ms/us work.
// dsPIC33E: FCY = Fosc / 2 (no PLL) -- same as PIC24F, unlike dsPIC30F's Fosc/4.
#define FCY (_XTAL_FREQ / 2UL)
#include <libpic30.h>

// <xc.h> (p33EP512MU810.h) defines a typedef named "SPI" for the generic SPI
// module SFR struct. Rename our Arduino-style SPI object to avoid the symbol
// clash -- sketches still write `SPI.transfer(...)` as normal.
#define SPI SPI_dev

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

// ── Arduino pin numbers -> dsPIC33EP512MU810 (83 GPIO pins, PORTA-PORTG) ──────
// This is a Peripheral-Pin-Select (PPS) device: UART/SPI/OC pins are NOT fixed
// in silicon -- they are routed to remappable "RPn" pins at boot in
// arduino_init() (RPINRx for inputs, RPORx for outputs). I2C2 and the ADC are
// the exception (fixed pins). The assignments below are what the HAL programs.
//
// D0-D11  = RA0-RA7, RA9, RA10, RA14, RA15 (PORTA, 12 bits) -- all input-only RPI
// D12-D27 = RB0-RB15 (PORTB, 16 bits) -- A0-A15 = AN0-AN15 (full 16-ch ADC)
// D28-D35 = RC1-RC4, RC12-RC15 (PORTC, 8 bits)
//   D32=RC12/OSC1, D35=RC15/OSC2 -- left as plain GPIO (external XT used here).
// D36-D51 = RD0-RD15 (PORTD, 16 bits)
//   D36-D39 = RD0-RD3 = analogWrite targets (OC1-OC4 via PPS;
//   LED_BUILTIN=D36/RD0/OC1). RD0-RD7 (RP64-71) are full input+output RP pins.
// D52-D61 = RE0-RE9 (PORTE, 10 bits)
// D62-D70 = RF0,RF1,RF2,RF3,RF4,RF5,RF8,RF12,RF13 (PORTF, 9 bits) -- all full RP
//   D62=RF0=SDO1, D63=RF1=SDI1, D68=RF8=SCK1 (SPI/SPI1, via PPS)
//   D64=RF2=U1RX, D65=RF3=U1TX (Serial/UART1, via PPS)
//   D66=RF4=SDA2, D67=RF5=SCL2 (Wire/I2C2, FIXED pins, ALTI2C2_OFF)
//   D69=RF12=U2RX, D70=RF13=U2TX (Serial2/UART2, via PPS)
// D71-D82 = RG0,RG1,RG2,RG3,RG6,RG7,RG8,RG9,RG12-RG15 (PORTG, 12 bits)
//   D73=RG2, D74=RG3 = USB D+/D- (no RP) -- plain GPIO only.
//
// All four serial/SPI/I2C peripherals sit on separate PORTF pins, so Serial,
// Serial2, SPI and Wire can all be used at the same time.
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
#define D30  30
#define D31  31
#define D32  32
#define D33  33
#define D34  34
#define D35  35
#define D36  36   // RD0 / OC1 -- LED pin
#define D37  37   // RD1 / OC2
#define D38  38   // RD2 / OC3
#define D39  39   // RD3 / OC4
#define D40  40
#define D41  41
#define D42  42
#define D43  43
#define D44  44
#define D45  45
#define D46  46
#define D47  47
#define D48  48
#define D49  49
#define D50  50
#define D51  51
#define D52  52
#define D53  53
#define D54  54
#define D55  55
#define D56  56
#define D57  57
#define D58  58
#define D59  59
#define D60  60
#define D61  61
#define D62  62   // RF0  -- SDO1
#define D63  63   // RF1  -- SDI1
#define D64  64   // RF2  -- U1RX
#define D65  65   // RF3  -- U1TX
#define D66  66   // RF4  -- SDA2
#define D67  67   // RF5  -- SCL2
#define D68  68   // RF8  -- SCK1
#define D69  69   // RF12 -- U2RX
#define D70  70   // RF13 -- U2TX
#define D71  71
#define D72  72
#define D73  73
#define D74  74
#define D75  75
#define D76  76
#define D77  77
#define D78  78
#define D79  79
#define D80  80
#define D81  81
#define D82  82

// A0-A15 = D12-D27 = RB0-RB15 = AN0-AN15
#define A0   D12
#define A1   D13
#define A2   D14
#define A3   D15
#define A4   D16
#define A5   D17
#define A6   D18
#define A7   D19
#define A8   D20
#define A9   D21
#define A10  D22
#define A11  D23
#define A12  D24
#define A13  D25
#define A14  D26
#define A15  D27

#define LED_BUILTIN  D36

// ── Native port-pin names (use these directly, e.g. digitalWrite(RD7, HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
#define RA0  D0
#define RA1  D1
#define RA2  D2
#define RA3  D3
#define RA4  D4
#define RA5  D5
#define RA6  D6
#define RA7  D7
#define RA9  D8
#define RA10 D9
#define RA14 D10
#define RA15 D11
#endif // PICPIO_PIN_ALIASES

#define RB0  D12
#define RB1  D13
#define RB2  D14
#define RB3  D15
#define RB4  D16
#define RB5  D17
#define RB6  D18
#define RB7  D19
#define RB8  D20
#define RB9  D21
#define RB10 D22
#define RB11 D23
#define RB12 D24
#define RB13 D25
#define RB14 D26
#define RB15 D27

#define RC1  D28
#define RC2  D29
#define RC3  D30
#define RC4  D31
#define RC12 D32
#define RC13 D33
#define RC14 D34
#define RC15 D35

#define RD0  D36
#define RD1  D37
#define RD2  D38
#define RD3  D39
#define RD4  D40
#define RD5  D41
#define RD6  D42
#define RD7  D43
#define RD8  D44
#define RD9  D45
#define RD10 D46
#define RD11 D47
#define RD12 D48
#define RD13 D49
#define RD14 D50
#define RD15 D51

#define RE0  D52
#define RE1  D53
#define RE2  D54
#define RE3  D55
#define RE4  D56
#define RE5  D57
#define RE6  D58
#define RE7  D59
#define RE8  D60
#define RE9  D61

#define RF0  D62
#define RF1  D63
#define RF2  D64
#define RF3  D65
#define RF4  D66
#define RF5  D67
#define RF8  D68
#define RF12 D69
#define RF13 D70

#define RG0  D71
#define RG1  D72
#define RG2  D73
#define RG3  D74
#define RG6  D75
#define RG7  D76
#define RG8  D77
#define RG9  D78
#define RG12 D79
#define RG13 D80
#define RG14 D81
#define RG15 D82

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
int     analogRead(uint8_t pin);                // 10-bit result (0-1023), pins D12-D27/A0-A15 only
void    analogWrite(uint8_t pin, uint8_t duty); // 8-bit PWM via OC1-OC4 (D36-D39)

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

extern HardwareSerial_t Serial;   // UART1 TX=RF3, RX=RF2 (via PPS)
extern HardwareSerial_t Serial2;  // UART2 TX=RF13, RX=RF12 (via PPS)

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

extern TwoWire_t Wire; // I2C2 (SCL2=RF5/D67, SDA2=RF4/D66, fixed pins)

// ── SPI (function-pointer struct) ─────────────────────────────────────────────
typedef struct {
    void    (*begin)(void);
    void    (*end)(void);
    uint8_t (*transfer)(uint8_t b);
    void    (*setBitOrder)(uint8_t order);
    void    (*setDataMode)(uint8_t mode);
    void    (*setClockDivider)(uint8_t div);
} SPIClass_t;

extern SPIClass_t SPI; // SPI1 (SCK1=RF8/D68, SDI1=RF1/D63, SDO1=RF0/D62, via PPS)

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
