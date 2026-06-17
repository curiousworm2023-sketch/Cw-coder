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
// module SFR struct. Rename our SPI object to avoid the symbol
// clash -- sketches still write `SPI.transfer(...)` as normal.
#define SPI SPI_dev

// ── Per-part feature flags ────────────────────────────────────────────────────
// Small SMPS/general-purpose parts that lack a second UART and whose flash is
// too small for sprintf's float support (the lightweight float printer in
// wiring.c is used instead). Keyed on the specific device so the same HAL
// serves the whole dsPIC30F line.
// Parts with no second UART (no Serial2).
#if defined(__dsPIC30F2010__) || defined(__dsPIC30F2011__) || defined(__dsPIC30F2012__) || defined(__dsPIC30F4012__) || defined(__dsPIC30F3012__) || defined(__dsPIC30F5015__) || defined(__dsPIC30F5016__) || defined(__dsPIC30F3010__)
#  define PICPIO_NO_UART2
#endif
// Parts whose flash is too small for sprintf's float support (use the
// lightweight float printer). 4012 shares the 2010 pinout but has 4x the flash,
// and 3012 shares the 2011 pinout but has 2x the flash, so both keep sprintf --
// hence this is a separate list from PICPIO_NO_UART2.
#if defined(__dsPIC30F2010__) || defined(__dsPIC30F2011__) || defined(__dsPIC30F2012__)
#  define PICPIO_TINY_FLASH
#endif

// ── PICPIO types ─────────────────────────────────────────────────────────────
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
// ── PICPIO pin numbers -> dsPIC30F3013 / dsPIC30F2012 (28-pin) ──────────────
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

// ── Native port-pin names (use these directly, e.g. gpio_write(RB0, GPIO_HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
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
#endif // PICPIO_PIN_ALIASES

#elif defined(__dsPIC30F4013__) || defined(__dsPIC30F3014__)
// ── PICPIO pin numbers -> dsPIC30F4013 / dsPIC30F3014 (40/44-pin GP) ────────
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

// ── Native port-pin names (use these directly, e.g. gpio_write(RB0, GPIO_HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
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
#endif // PICPIO_PIN_ALIASES

#elif defined(__dsPIC30F2011__) || defined(__dsPIC30F3012__)
// ── PICPIO pin numbers -> dsPIC30F2011 (18-pin, no PORTE/PORTF) ─────────────
// All peripheral I/O is on PORTB on this chip (there is no PORTF):
// D0-D7  = RB0-RB7 (also A0-A7 = AN0-AN7)
//   D4=RB4 (U1TX/SDO1/SCL), D5=RB5 (U1RX/SDI1/SDA), D6=RB6 (SCK1),
//   D7=RB7 (OC2/AN7) -- RB4/RB5 are shared between UART1, SPI1 and I2C:
//   don't use Serial, SPI and Wire together on real hardware.
// D8-D10 = RC13-RC15 (RC15 = OSC2/CLKO)
// D11    = RD0 (OC1/IC1) -- LED / PWM pin
#define D0   0
#define D1   1
#define D2   2
#define D3   3
#define D4   4
#define D5   5
#define D6   6
#define D7   7    // RB7 / AN7 / OC2
#define D8   8
#define D9   9
#define D10  10
#define D11  11   // RD0 / OC1 -- LED pin
#define A0   D0
#define A1   D1
#define A2   D2
#define A3   D3
#define A4   D4
#define A5   D5
#define A6   D6
#define A7   D7
#define LED_BUILTIN  D11

// ── Native port-pin names (use these directly, e.g. gpio_write(RB0, GPIO_HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
#define RB0  D0
#define RB1  D1
#define RB2  D2
#define RB3  D3
#define RB4  D4
#define RB5  D5
#define RB6  D6
#define RB7  D7
#define RC13 D8
#define RC14 D9
#define RC15 D10
#define RD0  D11
#endif // PICPIO_PIN_ALIASES

#elif defined(__dsPIC30F6011A__) || defined(__dsPIC30F6011__) || defined(__dsPIC30F5011__) || defined(__dsPIC30F6012A__) || defined(__dsPIC30F6012__)
// ── PICPIO pin numbers -> dsPIC30F6011A / dsPIC30F6012A (64-pin) ────────────
// D0-D15  = RB0-RB15 (A0-A15 = AN0-AN15, 16-ch ADC; RB2 also SS1)
// D16-D20 = RC1,RC2,RC13,RC14,RC15
// D21-D32 = RD0-RD11 (D21-D28 = OC1-OC8 -- 8 PWM analogWrite targets; LED=D21/RD0)
// D33-D39 = RF0-RF6
//   D35=RF2 (U1RX/SDI1), D36=RF3 (U1TX/SDO1), D37=RF4 (U2RX), D38=RF5 (U2TX),
//   D39=RF6 (SCK1) -- SPI1 data shares RF2/RF3 with UART1 (like the 4011);
//   I2C is on separate pins (RG2/RG3).
// D40-D51 = RG0,RG1,RG2,RG3,RG6,RG7,RG8,RG9,RG12,RG13,RG14,RG15
//   D42=RG2 (SCL), D43=RG3 (SDA); RG6-RG9 = SPI2 (GPIO here).
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
#define D21  21   // RD0 / OC1 -- LED pin
#define D22  22   // RD1 / OC2
#define D23  23   // RD2 / OC3
#define D24  24   // RD3 / OC4
#define D25  25   // RD4 / OC5
#define D26  26   // RD5 / OC6
#define D27  27   // RD6 / OC7
#define D28  28   // RD7 / OC8
#define D29  29
#define D30  30
#define D31  31
#define D32  32
#define D33  33
#define D34  34
#define D35  35
#define D36  36
#define D37  37
#define D38  38
#define D39  39
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
#define A13  D13
#define A14  D14
#define A15  D15
#define LED_BUILTIN  D21

// ── Native port-pin names (use these directly, e.g. gpio_write(RB0, GPIO_HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
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
#define RB13 D13
#define RB14 D14
#define RB15 D15
#define RC1  D16
#define RC2  D17
#define RC13 D18
#define RC14 D19
#define RC15 D20
#define RD0  D21
#define RD1  D22
#define RD2  D23
#define RD3  D24
#define RD4  D25
#define RD5  D26
#define RD6  D27
#define RD7  D28
#define RD8  D29
#define RD9  D30
#define RD10 D31
#define RD11 D32
#define RF0  D33
#define RF1  D34
#define RF2  D35
#define RF3  D36
#define RF4  D37
#define RF5  D38
#define RF6  D39
#define RG0  D40
#define RG1  D41
#define RG2  D42
#define RG3  D43
#define RG6  D44
#define RG7  D45
#define RG8  D46
#define RG9  D47
#define RG12 D48
#define RG13 D49
#define RG14 D50
#define RG15 D51
#endif // PICPIO_PIN_ALIASES

#elif defined(__dsPIC30F6010__)
// ── PICPIO pin numbers -> dsPIC30F6010 (80-pin, PORTA-G, motor-control) ─────
// D0-D15  = RB0-RB15 (A0-A15 = AN0-AN15, 16-ch ADC; RB2 also SS1)
// D16-D19 = RA9,RA10,RA14,RA15      D20-D24 = RC1,RC3,RC13,RC14,RC15
// D25-D40 = RD0-RD15 (D25-D32 = OC1-OC8 PWM; LED=D25/RD0)
// D41-D50 = RE0-RE9 (PWM motor-control outputs -- GPIO here)
// D51-D59 = RF0-RF8 (RF2=U1RX, RF3=U1TX, RF4=U2RX, RF5=U2TX, RF6=SCK1,
//                    RF7=SDI1, RF8=SDO1)
// D60-D67 = RG0,RG1,RG2,RG3,RG6,RG7,RG8,RG9 (RG2=SCL, RG3=SDA)
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
#define D25  25   // RD0 / OC1 -- LED pin
#define D26  26   // RD1 / OC2
#define D27  27   // RD2 / OC3
#define D28  28   // RD3 / OC4
#define D29  29   // RD4 / OC5
#define D30  30   // RD5 / OC6
#define D31  31   // RD6 / OC7
#define D32  32   // RD7 / OC8
#define D33  33
#define D34  34
#define D35  35
#define D36  36
#define D37  37
#define D38  38
#define D39  39
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
#define D62  62
#define D63  63
#define D64  64
#define D65  65
#define D66  66
#define D67  67
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
#define A13  D13
#define A14  D14
#define A15  D15
#define LED_BUILTIN  D25

// ── Native port-pin names (use these directly, e.g. gpio_write(RB0, GPIO_HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
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
#define RB13 D13
#define RB14 D14
#define RB15 D15
#define RA9  D16
#define RA10 D17
#define RA14 D18
#define RA15 D19
#define RC1  D20
#define RC3  D21
#define RC13 D22
#define RC14 D23
#define RC15 D24
#define RD0  D25
#define RD1  D26
#define RD2  D27
#define RD3  D28
#define RD4  D29
#define RD5  D30
#define RD6  D31
#define RD7  D32
#define RD8  D33
#define RD9  D34
#define RD10 D35
#define RD11 D36
#define RD12 D37
#define RD13 D38
#define RD14 D39
#define RD15 D40
#define RE0  D41
#define RE1  D42
#define RE2  D43
#define RE3  D44
#define RE4  D45
#define RE5  D46
#define RE6  D47
#define RE7  D48
#define RE8  D49
#define RE9  D50
#define RF0  D51
#define RF1  D52
#define RF2  D53
#define RF3  D54
#define RF4  D55
#define RF5  D56
#define RF6  D57
#define RF7  D58
#define RF8  D59
#define RG0  D60
#define RG1  D61
#define RG2  D62
#define RG3  D63
#define RG6  D64
#define RG7  D65
#define RG8  D66
#define RG9  D67
#endif // PICPIO_PIN_ALIASES

#elif defined(__dsPIC30F6014A__) || defined(__dsPIC30F6014__) || defined(__dsPIC30F6013A__) || defined(__dsPIC30F6013__) || defined(__dsPIC30F5013__)
// ── PICPIO pin numbers -> dsPIC30F6014A / dsPIC30F6013A (64/80-pin, PORTA-G) ─
// D0-D15  = RB0-RB15 (also A0-A15 = AN0-AN15, all analog-capable)
// D16-D31 = RD0-RD15 (D16-D23 = OC1-OC8 -- 8 PWM analogWrite targets; LED=D16/RD0)
// D32-D40 = RF0-RF8
//   D34=RF2 (U1RX), D35=RF3 (U1TX), D36=RF4 (U2RX), D37=RF5 (U2TX),
//   D38=RF6 (SCK1), D39=RF7 (SDI1), D40=RF8 (SDO1)
// D41-D52 = RG0,RG1,RG2,RG3,RG6,RG7,RG8,RG9,RG12,RG13,RG14,RG15
//   D43=RG2 (SCL), D44=RG3 (SDA)
// D53-D59 = RC1-RC4, RC13-RC15
// D60-D67 = RA6,RA7,RA9,RA10,RA12,RA13,RA14,RA15
// Unlike the smaller dsPIC30F parts, UART1 (RF2/RF3), SPI1 (RF6-RF8), I2C
// (RG2/RG3) and UART2 (RF4/RF5) are all on separate pins -- Serial, Serial2,
// SPI and Wire can be used together on this chip.
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
#define D20  20   // RD4 / OC5
#define D21  21   // RD5 / OC6
#define D22  22   // RD6 / OC7
#define D23  23   // RD7 / OC8
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
#define D36  36
#define D37  37
#define D38  38
#define D39  39
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
#define D62  62
#define D63  63
#define D64  64
#define D65  65
#define D66  66
#define D67  67
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
#define A13  D13
#define A14  D14
#define A15  D15
#define LED_BUILTIN  D16

// ── Native port-pin names (use these directly, e.g. gpio_write(RB0, GPIO_HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
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
#define RB13 D13
#define RB14 D14
#define RB15 D15
#define RD0  D16
#define RD1  D17
#define RD2  D18
#define RD3  D19
#define RD4  D20
#define RD5  D21
#define RD6  D22
#define RD7  D23
#define RD8  D24
#define RD9  D25
#define RD10 D26
#define RD11 D27
#define RD12 D28
#define RD13 D29
#define RD14 D30
#define RD15 D31
#define RF0  D32
#define RF1  D33
#define RF2  D34
#define RF3  D35
#define RF4  D36
#define RF5  D37
#define RF6  D38
#define RF7  D39
#define RF8  D40
#define RG0  D41
#define RG1  D42
#define RG2  D43
#define RG3  D44
#define RG6  D45
#define RG7  D46
#define RG8  D47
#define RG9  D48
#define RG12 D49
#define RG13 D50
#define RG14 D51
#define RG15 D52
#define RC1  D53
#define RC2  D54
#define RC3  D55
#define RC4  D56
#define RC13 D57
#define RC14 D58
#define RC15 D59
#define RA6  D60
#define RA7  D61
#define RA9  D62
#define RA10 D63
#define RA12 D64
#define RA13 D65
#define RA14 D66
#define RA15 D67
#endif // PICPIO_PIN_ALIASES

#elif !defined(__dsPIC30F2010__) && !defined(__dsPIC30F4012__) && !defined(__dsPIC30F3010__) && !defined(__dsPIC30F5015__) && !defined(__dsPIC30F5016__) && !defined(__dsPIC30F6015__)
// ── PICPIO pin numbers -> dsPIC30F4011 (no PORTA on this chip) ──────────────
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

// ── Native port-pin names (use these directly, e.g. gpio_write(RB0, GPIO_HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
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
#endif // PICPIO_PIN_ALIASES

#elif defined(__dsPIC30F5015__) || defined(__dsPIC30F6015__)
// ── PICPIO pin numbers -> dsPIC30F5015 / dsPIC30F6015 (64-pin, motor-control,
//    PORTE) ─ identical pin map; 6015 additionally has UART2 (RF4/RF5) and
//    OC5-OC8 on RD4-RD7 (5015 only has OC1-4 and no UART2). ─────────────────
// D0-D15  = RB0-RB15 (A0-A15 = AN0-AN15, 16-ch ADC; RB2 also SS1)
// D16-D18 = RC13-RC15      D19-D30 = RD0-RD11 (D19-D22 = OC1-OC4 PWM; LED=D19/RD0)
// D31-D38 = RE0-RE7        D39-D45 = RF0-RF6
//   D41=RF2 (U1RX/SDI1), D42=RF3 (U1TX/SDO1), D45=RF6 (SCK1) -- SPI1 data shares
//   RF2/RF3 with UART1 (like the 4011); no UART2 on this part.
// D46-D51 = RG2,RG3,RG6-RG9  (D46=RG2=SCL, D47=RG3=SDA; RG6-9 = SPI2, GPIO here)
#define D0   0
#define D1   1
#define D2   2   // RB2 SS1
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
#define D19  19   // RD0 OC1 -- LED pin
#define D20  20   // RD1 OC2
#define D21  21   // RD2 OC3
#define D22  22   // RD3 OC4
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
#define D36  36
#define D37  37
#define D38  38
#define D39  39
#define D40  40
#define D41  41   // RF2 U1RX/SDI1
#define D42  42   // RF3 U1TX/SDO1
#define D43  43
#define D44  44
#define D45  45   // RF6 SCK1
#define D46  46   // RG2 SCL
#define D47  47   // RG3 SDA
#define D48  48   // RG6 SCK2
#define D49  49   // RG7 SDI2
#define D50  50   // RG8 SDO2
#define D51  51   // RG9 SS2
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
#define A13  D13
#define A14  D14
#define A15  D15
#define LED_BUILTIN  D19

// ── Native port-pin names (use these directly, e.g. gpio_write(RB0, GPIO_HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
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
#define RB13 D13
#define RB14 D14
#define RB15 D15
#define RC13 D16
#define RC14 D17
#define RC15 D18
#define RD0  D19
#define RD1  D20
#define RD2  D21
#define RD3  D22
#define RD4  D23
#define RD5  D24
#define RD6  D25
#define RD7  D26
#define RD8  D27
#define RD9  D28
#define RD10 D29
#define RD11 D30
#define RE0  D31
#define RE1  D32
#define RE2  D33
#define RE3  D34
#define RE4  D35
#define RE5  D36
#define RE6  D37
#define RE7  D38
#define RF0  D39
#define RF1  D40
#define RF2  D41
#define RF3  D42
#define RF4  D43
#define RF5  D44
#define RF6  D45
#define RG2  D46
#define RG3  D47
#define RG6  D48
#define RG7  D49
#define RG8  D50
#define RG9  D51
#endif // PICPIO_PIN_ALIASES

#elif defined(__dsPIC30F5016__)
// ── PICPIO pin numbers -> dsPIC30F5016 (80-pin, motor-control, has PORTE) ───
// D0-D15  = RB0-RB15 (A0-A15 = AN0-AN15, 16-ch ADC; RB2 also SS1)
// D16-D19 = RA9,RA10,RA14,RA15   D20-D24 = RC1,RC3,RC13-RC15
// D25-D40 = RD0-RD15 (D25-D28 = OC1-OC4 PWM; LED=D25/RD0)
// D41-D50 = RE0-RE9        D51-D59 = RF0-RF8
//   D53=RF2 (U1RX), D54=RF3 (U1TX), D57=RF6 (SCK1), D58=RF7 (SDI1), D59=RF8 (SDO1);
//   no UART2 on this part. I2C on RG2/RG3.
// D60-D67 = RG0,RG1,RG2,RG3,RG6-RG9  (D62=RG2=SCL, D63=RG3=SDA; RG6-9 = SPI2, GPIO)
#define D0   0
#define D1   1
#define D2   2   // RB2 SS1
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
#define D25  25   // RD0 OC1 -- LED pin
#define D26  26   // RD1 OC2
#define D27  27   // RD2 OC3
#define D28  28   // RD3 OC4
#define D29  29
#define D30  30
#define D31  31
#define D32  32
#define D33  33
#define D34  34
#define D35  35
#define D36  36
#define D37  37
#define D38  38
#define D39  39
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
#define D53  53   // RF2 U1RX
#define D54  54   // RF3 U1TX
#define D55  55
#define D56  56
#define D57  57   // RF6 SCK1
#define D58  58   // RF7 SDI1
#define D59  59   // RF8 SDO1
#define D60  60
#define D61  61
#define D62  62   // RG2 SCL
#define D63  63   // RG3 SDA
#define D64  64   // RG6 SCK2
#define D65  65   // RG7 SDI2
#define D66  66   // RG8 SDO2
#define D67  67   // RG9 SS2
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
#define A13  D13
#define A14  D14
#define A15  D15
#define LED_BUILTIN  D25

// ── Native port-pin names (use these directly, e.g. gpio_write(RB0, GPIO_HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
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
#define RB13 D13
#define RB14 D14
#define RB15 D15
#define RA9  D16
#define RA10 D17
#define RA14 D18
#define RA15 D19
#define RC1  D20
#define RC3  D21
#define RC13 D22
#define RC14 D23
#define RC15 D24
#define RD0  D25
#define RD1  D26
#define RD2  D27
#define RD3  D28
#define RD4  D29
#define RD5  D30
#define RD6  D31
#define RD7  D32
#define RD8  D33
#define RD9  D34
#define RD10 D35
#define RD11 D36
#define RD12 D37
#define RD13 D38
#define RD14 D39
#define RD15 D40
#define RE0  D41
#define RE1  D42
#define RE2  D43
#define RE3  D44
#define RE4  D45
#define RE5  D46
#define RE6  D47
#define RE7  D48
#define RE8  D49
#define RE9  D50
#define RF0  D51
#define RF1  D52
#define RF2  D53
#define RF3  D54
#define RF4  D55
#define RF5  D56
#define RF6  D57
#define RF7  D58
#define RF8  D59
#define RG0  D60
#define RG1  D61
#define RG2  D62
#define RG3  D63
#define RG6  D64
#define RG7  D65
#define RG8  D66
#define RG9  D67
#endif // PICPIO_PIN_ALIASES

#else // __dsPIC30F2010__ / __dsPIC30F4012__ (pin-identical; 4012 just has more flash + no Serial2 quirk handled elsewhere)

// ── PICPIO pin numbers -> dsPIC30F2010 / dsPIC30F4012 (28-pin, no PORTA) ────
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

// ── Native port-pin names (use these directly, e.g. gpio_write(RB0, GPIO_HIGH)) ──
#ifdef PICPIO_PIN_ALIASES   // native Rxx names shadow the chip's register bits; opt in to use them (else use Dn numbers)
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
#endif // PICPIO_PIN_ALIASES

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
#undef round   // drop math.h round macro so this round macro wins (no redefinition warning)
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

// ── Serial (function-pointer struct — works in C, method-call syntax) ───────
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

extern HardwareSerial_t Serial;   // UART1 TX=RF3, RX=RF2
#ifndef PICPIO_NO_UART2
extern HardwareSerial_t Serial2;  // UART2 TX=RF5, RX=RF4 — real hardware module
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

extern TwoWire_t Wire; // I2C SCL=RF3, SDA=RF2 (4011-class; bigger parts use RG2/RG3)

// ── SPI (function-pointer struct) ─────────────────────────────────────────────
typedef struct {
    void    (*begin)(void);
    void    (*end)(void);
    uint8_t (*transfer)(uint8_t b);
    void    (*setBitOrder)(uint8_t order);
    void    (*setDataMode)(uint8_t mode);
    void    (*setClockDivider)(uint8_t div);
} SPIClass_t;

extern SPIClass_t SPI; // SPI1 SCK=RF6, SDI=RF2, SDO=RF3 (4011-class)

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
void picpio_init(void);

// ── User-defined (sketch) ─────────────────────────────────────────────────────
void init(void);   // runs once at boot   (define this; `setup` still works)
void run(void);    // runs forever        (define this; `loop` still works)
#define setup init
#define loop  run

// ════════════════════════════════════════════════════════════════════════════
// PICPIO native API — subsystem-prefixed names (the preferred/canonical names).
// The classic Arduino-compatible names above remain available as aliases so
// existing sketches and the bundled libraries keep compiling; new code should
// use the PICPIO names below.
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
#define sys_init       picpio_init
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
