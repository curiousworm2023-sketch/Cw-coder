#define PICPIO_PIN_ALIASES   // HAL internals reference the native Rxx pin names
#include "Picpio.h"

// ── Pin map ───────────────────────────────────────────────────────────────────
// dsPIC30F4011 has no PORTA. All SFRs are 16-bit (__attribute__((__sfr__))),
// so tris/lat/port pointers are volatile unsigned int* (not uint8_t* as on
// the 8-bit XC8 HALs).
typedef struct {
    volatile unsigned int *tris;
    volatile unsigned int *lat;
    volatile unsigned int *port;
    uint8_t bit;
    int8_t  adc_ch; // ADCHS CH0SA value (AN0-AN8), or NO_ADC
} PinInfo;

#define NO_ADC -1

#if defined(__dsPIC30F3013__) || defined(__dsPIC30F2012__)
static const PinInfo _pins[] = {
    { &TRISB, &LATB, &PORTB, 0, 0 }, // D0  RB0/AN0
    { &TRISB, &LATB, &PORTB, 1, 1 }, // D1  RB1/AN1
    { &TRISB, &LATB, &PORTB, 2, 2 }, // D2  RB2/AN2
    { &TRISB, &LATB, &PORTB, 3, 3 }, // D3  RB3/AN3
    { &TRISB, &LATB, &PORTB, 4, 4 }, // D4  RB4/AN4
    { &TRISB, &LATB, &PORTB, 5, 5 }, // D5  RB5/AN5
    { &TRISB, &LATB, &PORTB, 6, 6 }, // D6  RB6/AN6
    { &TRISB, &LATB, &PORTB, 7, 7 }, // D7  RB7/AN7
    { &TRISB, &LATB, &PORTB, 8, 8 }, // D8  RB8/AN8/OC1 -- LED/PWM
    { &TRISB, &LATB, &PORTB, 9, 9 }, // D9  RB9/AN9/OC2 -- PWM
    { &TRISC, &LATC, &PORTC, 13, NO_ADC }, // D10 RC13 (CN1)
    { &TRISC, &LATC, &PORTC, 14, NO_ADC }, // D11 RC14 (CN0/T1CK)
    { &TRISC, &LATC, &PORTC, 15, NO_ADC }, // D12 RC15 (T2CK/SOSCO)
    { &TRISD, &LATD, &PORTD, 8, NO_ADC }, // D13 RD8 (IC1/INT1)
    { &TRISD, &LATD, &PORTD, 9, NO_ADC }, // D14 RD9 (IC2/INT2)
    { &TRISF, &LATF, &PORTF, 2, NO_ADC }, // D15 RF2 -- U1RX/SDI1/SDA
    { &TRISF, &LATF, &PORTF, 3, NO_ADC }, // D16 RF3 -- U1TX/SDO1/SCL
    { &TRISF, &LATF, &PORTF, 4, NO_ADC }, // D17 RF4 -- U2RX
    { &TRISF, &LATF, &PORTF, 5, NO_ADC }, // D18 RF5 -- U2TX
    { &TRISF, &LATF, &PORTF, 6, NO_ADC }, // D19 RF6 -- SCK1
};
#define PIN_COUNT 20
#elif defined(__dsPIC30F4013__) || defined(__dsPIC30F3014__)
static const PinInfo _pins[] = {
    { &TRISB, &LATB, &PORTB, 0, 0 },  // D0  RB0/AN0
    { &TRISB, &LATB, &PORTB, 1, 1 },  // D1  RB1/AN1
    { &TRISB, &LATB, &PORTB, 2, 2 },  // D2  RB2/AN2
    { &TRISB, &LATB, &PORTB, 3, 3 },  // D3  RB3/AN3
    { &TRISB, &LATB, &PORTB, 4, 4 },  // D4  RB4/AN4
    { &TRISB, &LATB, &PORTB, 5, 5 },  // D5  RB5/AN5
    { &TRISB, &LATB, &PORTB, 6, 6 },  // D6  RB6/AN6
    { &TRISB, &LATB, &PORTB, 7, 7 },  // D7  RB7/AN7
    { &TRISB, &LATB, &PORTB, 8, 8 },  // D8  RB8/AN8
    { &TRISB, &LATB, &PORTB, 9, 9 },  // D9  RB9/AN9
    { &TRISB, &LATB, &PORTB, 10, 10 }, // D10 RB10/AN10
    { &TRISB, &LATB, &PORTB, 11, 11 }, // D11 RB11/AN11
    { &TRISB, &LATB, &PORTB, 12, 12 }, // D12 RB12/AN12
    { &TRISC, &LATC, &PORTC, 13, NO_ADC }, // D13 RC13 (CN1)
    { &TRISC, &LATC, &PORTC, 14, NO_ADC }, // D14 RC14 (CN0/T1CK)
    { &TRISC, &LATC, &PORTC, 15, NO_ADC }, // D15 RC15 (SOSCO)
    { &TRISD, &LATD, &PORTD, 0, NO_ADC }, // D16 RD0/OC1 -- LED
    { &TRISD, &LATD, &PORTD, 1, NO_ADC }, // D17 RD1/OC2
    { &TRISD, &LATD, &PORTD, 2, NO_ADC }, // D18 RD2/OC3
    { &TRISD, &LATD, &PORTD, 3, NO_ADC }, // D19 RD3/OC4
    { &TRISD, &LATD, &PORTD, 8, NO_ADC }, // D20 RD8 (IC1/INT1)
    { &TRISD, &LATD, &PORTD, 9, NO_ADC }, // D21 RD9 (IC2/INT2)
    { &TRISF, &LATF, &PORTF, 0, NO_ADC }, // D22 RF0
    { &TRISF, &LATF, &PORTF, 1, NO_ADC }, // D23 RF1
    { &TRISF, &LATF, &PORTF, 2, NO_ADC }, // D24 RF2 -- U1RX/SDI1/SDA
    { &TRISF, &LATF, &PORTF, 3, NO_ADC }, // D25 RF3 -- U1TX/SDO1/SCL
    { &TRISF, &LATF, &PORTF, 4, NO_ADC }, // D26 RF4 -- U2RX
    { &TRISF, &LATF, &PORTF, 5, NO_ADC }, // D27 RF5 -- U2TX
    { &TRISF, &LATF, &PORTF, 6, NO_ADC }, // D28 RF6 -- SCK1
    { &TRISA, &LATA, &PORTA, 11, NO_ADC }, // D29 RA11
};
#define PIN_COUNT 30
#elif defined(__dsPIC30F2011__) || defined(__dsPIC30F3012__)
static const PinInfo _pins[] = {
    { &TRISB, &LATB, &PORTB, 0, 0 }, // D0  RB0/AN0
    { &TRISB, &LATB, &PORTB, 1, 1 }, // D1  RB1/AN1
    { &TRISB, &LATB, &PORTB, 2, 2 }, // D2  RB2/AN2
    { &TRISB, &LATB, &PORTB, 3, 3 }, // D3  RB3/AN3
    { &TRISB, &LATB, &PORTB, 4, 4 }, // D4  RB4/AN4 -- U1TX/SDO1/SCL
    { &TRISB, &LATB, &PORTB, 5, 5 }, // D5  RB5/AN5 -- U1RX/SDI1/SDA
    { &TRISB, &LATB, &PORTB, 6, 6 }, // D6  RB6/AN6 -- SCK1
    { &TRISB, &LATB, &PORTB, 7, 7 }, // D7  RB7/AN7 -- OC2
    { &TRISC, &LATC, &PORTC, 13, NO_ADC }, // D8  RC13 (CN1)
    { &TRISC, &LATC, &PORTC, 14, NO_ADC }, // D9  RC14 (CN0/T1CK)
    { &TRISC, &LATC, &PORTC, 15, NO_ADC }, // D10 RC15 (OSC2/CLKO)
    { &TRISD, &LATD, &PORTD, 0, NO_ADC }, // D11 RD0/OC1 -- LED
};
#define PIN_COUNT 12
#elif defined(__dsPIC30F6011A__) || defined(__dsPIC30F6011__) || defined(__dsPIC30F5011__) || defined(__dsPIC30F6012A__) || defined(__dsPIC30F6012__)
static const PinInfo _pins[] = {
    { &TRISB, &LATB, &PORTB, 0, 0 },   // D0  RB0/AN0
    { &TRISB, &LATB, &PORTB, 1, 1 },   // D1  RB1/AN1
    { &TRISB, &LATB, &PORTB, 2, 2 },   // D2  RB2/AN2 -- SS1
    { &TRISB, &LATB, &PORTB, 3, 3 },   // D3  RB3/AN3
    { &TRISB, &LATB, &PORTB, 4, 4 },   // D4  RB4/AN4
    { &TRISB, &LATB, &PORTB, 5, 5 },   // D5  RB5/AN5
    { &TRISB, &LATB, &PORTB, 6, 6 },   // D6  RB6/AN6
    { &TRISB, &LATB, &PORTB, 7, 7 },   // D7  RB7/AN7
    { &TRISB, &LATB, &PORTB, 8, 8 },   // D8  RB8/AN8
    { &TRISB, &LATB, &PORTB, 9, 9 },   // D9  RB9/AN9
    { &TRISB, &LATB, &PORTB, 10, 10 }, // D10 RB10/AN10
    { &TRISB, &LATB, &PORTB, 11, 11 }, // D11 RB11/AN11
    { &TRISB, &LATB, &PORTB, 12, 12 }, // D12 RB12/AN12
    { &TRISB, &LATB, &PORTB, 13, 13 }, // D13 RB13/AN13
    { &TRISB, &LATB, &PORTB, 14, 14 }, // D14 RB14/AN14
    { &TRISB, &LATB, &PORTB, 15, 15 }, // D15 RB15/AN15
    { &TRISC, &LATC, &PORTC, 1, NO_ADC },  // D16 RC1
    { &TRISC, &LATC, &PORTC, 2, NO_ADC },  // D17 RC2
    { &TRISC, &LATC, &PORTC, 13, NO_ADC }, // D18 RC13
    { &TRISC, &LATC, &PORTC, 14, NO_ADC }, // D19 RC14
    { &TRISC, &LATC, &PORTC, 15, NO_ADC }, // D20 RC15
    { &TRISD, &LATD, &PORTD, 0, NO_ADC },  // D21 RD0 -- OC1 -- LED
    { &TRISD, &LATD, &PORTD, 1, NO_ADC },  // D22 RD1 -- OC2
    { &TRISD, &LATD, &PORTD, 2, NO_ADC },  // D23 RD2 -- OC3
    { &TRISD, &LATD, &PORTD, 3, NO_ADC },  // D24 RD3 -- OC4
    { &TRISD, &LATD, &PORTD, 4, NO_ADC },  // D25 RD4 -- OC5
    { &TRISD, &LATD, &PORTD, 5, NO_ADC },  // D26 RD5 -- OC6
    { &TRISD, &LATD, &PORTD, 6, NO_ADC },  // D27 RD6 -- OC7
    { &TRISD, &LATD, &PORTD, 7, NO_ADC },  // D28 RD7 -- OC8
    { &TRISD, &LATD, &PORTD, 8, NO_ADC },  // D29 RD8
    { &TRISD, &LATD, &PORTD, 9, NO_ADC },  // D30 RD9
    { &TRISD, &LATD, &PORTD, 10, NO_ADC }, // D31 RD10
    { &TRISD, &LATD, &PORTD, 11, NO_ADC }, // D32 RD11
    { &TRISF, &LATF, &PORTF, 0, NO_ADC },  // D33 RF0
    { &TRISF, &LATF, &PORTF, 1, NO_ADC },  // D34 RF1
    { &TRISF, &LATF, &PORTF, 2, NO_ADC },  // D35 RF2 -- U1RX/SDI1
    { &TRISF, &LATF, &PORTF, 3, NO_ADC },  // D36 RF3 -- U1TX/SDO1
    { &TRISF, &LATF, &PORTF, 4, NO_ADC },  // D37 RF4 -- U2RX
    { &TRISF, &LATF, &PORTF, 5, NO_ADC },  // D38 RF5 -- U2TX
    { &TRISF, &LATF, &PORTF, 6, NO_ADC },  // D39 RF6 -- SCK1
    { &TRISG, &LATG, &PORTG, 0, NO_ADC },  // D40 RG0
    { &TRISG, &LATG, &PORTG, 1, NO_ADC },  // D41 RG1
    { &TRISG, &LATG, &PORTG, 2, NO_ADC },  // D42 RG2 -- SCL
    { &TRISG, &LATG, &PORTG, 3, NO_ADC },  // D43 RG3 -- SDA
    { &TRISG, &LATG, &PORTG, 6, NO_ADC },  // D44 RG6
    { &TRISG, &LATG, &PORTG, 7, NO_ADC },  // D45 RG7
    { &TRISG, &LATG, &PORTG, 8, NO_ADC },  // D46 RG8
    { &TRISG, &LATG, &PORTG, 9, NO_ADC },  // D47 RG9
    { &TRISG, &LATG, &PORTG, 12, NO_ADC }, // D48 RG12
    { &TRISG, &LATG, &PORTG, 13, NO_ADC }, // D49 RG13
    { &TRISG, &LATG, &PORTG, 14, NO_ADC }, // D50 RG14
    { &TRISG, &LATG, &PORTG, 15, NO_ADC }, // D51 RG15
};
#define PIN_COUNT 52
#elif defined(__dsPIC30F6010__)
static const PinInfo _pins[] = {
    { &TRISB, &LATB, &PORTB, 0, 0 }, // D0  RB0/AN0
    { &TRISB, &LATB, &PORTB, 1, 1 }, // D1  RB1/AN1
    { &TRISB, &LATB, &PORTB, 2, 2 }, // D2  RB2/AN2 -- SS1
    { &TRISB, &LATB, &PORTB, 3, 3 }, // D3  RB3/AN3
    { &TRISB, &LATB, &PORTB, 4, 4 }, // D4  RB4/AN4
    { &TRISB, &LATB, &PORTB, 5, 5 }, // D5  RB5/AN5
    { &TRISB, &LATB, &PORTB, 6, 6 }, // D6  RB6/AN6
    { &TRISB, &LATB, &PORTB, 7, 7 }, // D7  RB7/AN7
    { &TRISB, &LATB, &PORTB, 8, 8 }, // D8  RB8/AN8
    { &TRISB, &LATB, &PORTB, 9, 9 }, // D9  RB9/AN9
    { &TRISB, &LATB, &PORTB, 10, 10 }, // D10 RB10/AN10
    { &TRISB, &LATB, &PORTB, 11, 11 }, // D11 RB11/AN11
    { &TRISB, &LATB, &PORTB, 12, 12 }, // D12 RB12/AN12
    { &TRISB, &LATB, &PORTB, 13, 13 }, // D13 RB13/AN13
    { &TRISB, &LATB, &PORTB, 14, 14 }, // D14 RB14/AN14
    { &TRISB, &LATB, &PORTB, 15, 15 }, // D15 RB15/AN15
    { &TRISA, &LATA, &PORTA, 9, NO_ADC },  // D16 RA9
    { &TRISA, &LATA, &PORTA, 10, NO_ADC }, // D17 RA10
    { &TRISA, &LATA, &PORTA, 14, NO_ADC }, // D18 RA14
    { &TRISA, &LATA, &PORTA, 15, NO_ADC }, // D19 RA15
    { &TRISC, &LATC, &PORTC, 1, NO_ADC },  // D20 RC1
    { &TRISC, &LATC, &PORTC, 3, NO_ADC },  // D21 RC3
    { &TRISC, &LATC, &PORTC, 13, NO_ADC }, // D22 RC13
    { &TRISC, &LATC, &PORTC, 14, NO_ADC }, // D23 RC14
    { &TRISC, &LATC, &PORTC, 15, NO_ADC }, // D24 RC15
    { &TRISD, &LATD, &PORTD, 0, NO_ADC },  // D25 RD0 -- OC1 -- LED
    { &TRISD, &LATD, &PORTD, 1, NO_ADC },  // D26 RD1 -- OC2
    { &TRISD, &LATD, &PORTD, 2, NO_ADC },  // D27 RD2 -- OC3
    { &TRISD, &LATD, &PORTD, 3, NO_ADC },  // D28 RD3 -- OC4
    { &TRISD, &LATD, &PORTD, 4, NO_ADC },  // D29 RD4 -- OC5
    { &TRISD, &LATD, &PORTD, 5, NO_ADC },  // D30 RD5 -- OC6
    { &TRISD, &LATD, &PORTD, 6, NO_ADC },  // D31 RD6 -- OC7
    { &TRISD, &LATD, &PORTD, 7, NO_ADC },  // D32 RD7 -- OC8
    { &TRISD, &LATD, &PORTD, 8, NO_ADC },  // D33 RD8
    { &TRISD, &LATD, &PORTD, 9, NO_ADC },  // D34 RD9
    { &TRISD, &LATD, &PORTD, 10, NO_ADC }, // D35 RD10
    { &TRISD, &LATD, &PORTD, 11, NO_ADC }, // D36 RD11
    { &TRISD, &LATD, &PORTD, 12, NO_ADC }, // D37 RD12
    { &TRISD, &LATD, &PORTD, 13, NO_ADC }, // D38 RD13
    { &TRISD, &LATD, &PORTD, 14, NO_ADC }, // D39 RD14
    { &TRISD, &LATD, &PORTD, 15, NO_ADC }, // D40 RD15
    { &TRISE, &LATE, &PORTE, 0, NO_ADC },  // D41 RE0
    { &TRISE, &LATE, &PORTE, 1, NO_ADC },  // D42 RE1
    { &TRISE, &LATE, &PORTE, 2, NO_ADC },  // D43 RE2
    { &TRISE, &LATE, &PORTE, 3, NO_ADC },  // D44 RE3
    { &TRISE, &LATE, &PORTE, 4, NO_ADC },  // D45 RE4
    { &TRISE, &LATE, &PORTE, 5, NO_ADC },  // D46 RE5
    { &TRISE, &LATE, &PORTE, 6, NO_ADC },  // D47 RE6
    { &TRISE, &LATE, &PORTE, 7, NO_ADC },  // D48 RE7
    { &TRISE, &LATE, &PORTE, 8, NO_ADC },  // D49 RE8
    { &TRISE, &LATE, &PORTE, 9, NO_ADC },  // D50 RE9
    { &TRISF, &LATF, &PORTF, 0, NO_ADC },  // D51 RF0
    { &TRISF, &LATF, &PORTF, 1, NO_ADC },  // D52 RF1
    { &TRISF, &LATF, &PORTF, 2, NO_ADC },  // D53 RF2 -- U1RX/SDI1
    { &TRISF, &LATF, &PORTF, 3, NO_ADC },  // D54 RF3 -- U1TX/SDO1
    { &TRISF, &LATF, &PORTF, 4, NO_ADC },  // D55 RF4 -- U2RX
    { &TRISF, &LATF, &PORTF, 5, NO_ADC },  // D56 RF5 -- U2TX
    { &TRISF, &LATF, &PORTF, 6, NO_ADC },  // D57 RF6 -- SCK1
    { &TRISF, &LATF, &PORTF, 7, NO_ADC },  // D58 RF7 -- SDI1
    { &TRISF, &LATF, &PORTF, 8, NO_ADC },  // D59 RF8 -- SDO1
    { &TRISG, &LATG, &PORTG, 0, NO_ADC },  // D60 RG0
    { &TRISG, &LATG, &PORTG, 1, NO_ADC },  // D61 RG1
    { &TRISG, &LATG, &PORTG, 2, NO_ADC },  // D62 RG2 -- SCL
    { &TRISG, &LATG, &PORTG, 3, NO_ADC },  // D63 RG3 -- SDA
    { &TRISG, &LATG, &PORTG, 6, NO_ADC },  // D64 RG6
    { &TRISG, &LATG, &PORTG, 7, NO_ADC },  // D65 RG7
    { &TRISG, &LATG, &PORTG, 8, NO_ADC },  // D66 RG8
    { &TRISG, &LATG, &PORTG, 9, NO_ADC },  // D67 RG9
};
#define PIN_COUNT 68
#elif defined(__dsPIC30F6014A__) || defined(__dsPIC30F6014__) || defined(__dsPIC30F6013A__) || defined(__dsPIC30F6013__) || defined(__dsPIC30F5013__)
static const PinInfo _pins[] = {
    { &TRISB, &LATB, &PORTB, 0, 0 },   // D0  RB0/AN0
    { &TRISB, &LATB, &PORTB, 1, 1 },   // D1  RB1/AN1
    { &TRISB, &LATB, &PORTB, 2, 2 },   // D2  RB2/AN2
    { &TRISB, &LATB, &PORTB, 3, 3 },   // D3  RB3/AN3
    { &TRISB, &LATB, &PORTB, 4, 4 },   // D4  RB4/AN4
    { &TRISB, &LATB, &PORTB, 5, 5 },   // D5  RB5/AN5
    { &TRISB, &LATB, &PORTB, 6, 6 },   // D6  RB6/AN6
    { &TRISB, &LATB, &PORTB, 7, 7 },   // D7  RB7/AN7
    { &TRISB, &LATB, &PORTB, 8, 8 },   // D8  RB8/AN8
    { &TRISB, &LATB, &PORTB, 9, 9 },   // D9  RB9/AN9
    { &TRISB, &LATB, &PORTB, 10, 10 }, // D10 RB10/AN10
    { &TRISB, &LATB, &PORTB, 11, 11 }, // D11 RB11/AN11
    { &TRISB, &LATB, &PORTB, 12, 12 }, // D12 RB12/AN12
    { &TRISB, &LATB, &PORTB, 13, 13 }, // D13 RB13/AN13
    { &TRISB, &LATB, &PORTB, 14, 14 }, // D14 RB14/AN14
    { &TRISB, &LATB, &PORTB, 15, 15 }, // D15 RB15/AN15
    { &TRISD, &LATD, &PORTD, 0, NO_ADC },  // D16 RD0/OC1 -- LED
    { &TRISD, &LATD, &PORTD, 1, NO_ADC },  // D17 RD1/OC2
    { &TRISD, &LATD, &PORTD, 2, NO_ADC },  // D18 RD2/OC3
    { &TRISD, &LATD, &PORTD, 3, NO_ADC },  // D19 RD3/OC4
    { &TRISD, &LATD, &PORTD, 4, NO_ADC },  // D20 RD4/OC5
    { &TRISD, &LATD, &PORTD, 5, NO_ADC },  // D21 RD5/OC6
    { &TRISD, &LATD, &PORTD, 6, NO_ADC },  // D22 RD6/OC7
    { &TRISD, &LATD, &PORTD, 7, NO_ADC },  // D23 RD7/OC8
    { &TRISD, &LATD, &PORTD, 8, NO_ADC },  // D24 RD8
    { &TRISD, &LATD, &PORTD, 9, NO_ADC },  // D25 RD9
    { &TRISD, &LATD, &PORTD, 10, NO_ADC }, // D26 RD10
    { &TRISD, &LATD, &PORTD, 11, NO_ADC }, // D27 RD11
    { &TRISD, &LATD, &PORTD, 12, NO_ADC }, // D28 RD12
    { &TRISD, &LATD, &PORTD, 13, NO_ADC }, // D29 RD13
    { &TRISD, &LATD, &PORTD, 14, NO_ADC }, // D30 RD14
    { &TRISD, &LATD, &PORTD, 15, NO_ADC }, // D31 RD15
    { &TRISF, &LATF, &PORTF, 0, NO_ADC },  // D32 RF0
    { &TRISF, &LATF, &PORTF, 1, NO_ADC },  // D33 RF1
    { &TRISF, &LATF, &PORTF, 2, NO_ADC },  // D34 RF2 -- U1RX
    { &TRISF, &LATF, &PORTF, 3, NO_ADC },  // D35 RF3 -- U1TX
    { &TRISF, &LATF, &PORTF, 4, NO_ADC },  // D36 RF4 -- U2RX
    { &TRISF, &LATF, &PORTF, 5, NO_ADC },  // D37 RF5 -- U2TX
    { &TRISF, &LATF, &PORTF, 6, NO_ADC },  // D38 RF6 -- SCK1
    { &TRISF, &LATF, &PORTF, 7, NO_ADC },  // D39 RF7 -- SDI1
    { &TRISF, &LATF, &PORTF, 8, NO_ADC },  // D40 RF8 -- SDO1
    { &TRISG, &LATG, &PORTG, 0, NO_ADC },  // D41 RG0
    { &TRISG, &LATG, &PORTG, 1, NO_ADC },  // D42 RG1
    { &TRISG, &LATG, &PORTG, 2, NO_ADC },  // D43 RG2 -- SCL
    { &TRISG, &LATG, &PORTG, 3, NO_ADC },  // D44 RG3 -- SDA
    { &TRISG, &LATG, &PORTG, 6, NO_ADC },  // D45 RG6
    { &TRISG, &LATG, &PORTG, 7, NO_ADC },  // D46 RG7
    { &TRISG, &LATG, &PORTG, 8, NO_ADC },  // D47 RG8
    { &TRISG, &LATG, &PORTG, 9, NO_ADC },  // D48 RG9
    { &TRISG, &LATG, &PORTG, 12, NO_ADC }, // D49 RG12
    { &TRISG, &LATG, &PORTG, 13, NO_ADC }, // D50 RG13
    { &TRISG, &LATG, &PORTG, 14, NO_ADC }, // D51 RG14
    { &TRISG, &LATG, &PORTG, 15, NO_ADC }, // D52 RG15
    { &TRISC, &LATC, &PORTC, 1, NO_ADC },  // D53 RC1
    { &TRISC, &LATC, &PORTC, 2, NO_ADC },  // D54 RC2
    { &TRISC, &LATC, &PORTC, 3, NO_ADC },  // D55 RC3
    { &TRISC, &LATC, &PORTC, 4, NO_ADC },  // D56 RC4
    { &TRISC, &LATC, &PORTC, 13, NO_ADC }, // D57 RC13
    { &TRISC, &LATC, &PORTC, 14, NO_ADC }, // D58 RC14
    { &TRISC, &LATC, &PORTC, 15, NO_ADC }, // D59 RC15
    { &TRISA, &LATA, &PORTA, 6, NO_ADC },  // D60 RA6
    { &TRISA, &LATA, &PORTA, 7, NO_ADC },  // D61 RA7
    { &TRISA, &LATA, &PORTA, 9, NO_ADC },  // D62 RA9
    { &TRISA, &LATA, &PORTA, 10, NO_ADC }, // D63 RA10
    { &TRISA, &LATA, &PORTA, 12, NO_ADC }, // D64 RA12
    { &TRISA, &LATA, &PORTA, 13, NO_ADC }, // D65 RA13
    { &TRISA, &LATA, &PORTA, 14, NO_ADC }, // D66 RA14
    { &TRISA, &LATA, &PORTA, 15, NO_ADC }, // D67 RA15
};
#define PIN_COUNT 68
#elif !defined(__dsPIC30F2010__) && !defined(__dsPIC30F4012__) && !defined(__dsPIC30F3010__) && !defined(__dsPIC30F5015__) && !defined(__dsPIC30F5016__) && !defined(__dsPIC30F6015__)
static const PinInfo _pins[] = {
    { &TRISB, &LATB, &PORTB, 0, 0 }, // D0  RB0/AN0
    { &TRISB, &LATB, &PORTB, 1, 1 }, // D1  RB1/AN1
    { &TRISB, &LATB, &PORTB, 2, 2 }, // D2  RB2/AN2
    { &TRISB, &LATB, &PORTB, 3, 3 }, // D3  RB3/AN3
    { &TRISB, &LATB, &PORTB, 4, 4 }, // D4  RB4/AN4
    { &TRISB, &LATB, &PORTB, 5, 5 }, // D5  RB5/AN5
    { &TRISB, &LATB, &PORTB, 6, 6 }, // D6  RB6/AN6
    { &TRISB, &LATB, &PORTB, 7, 7 }, // D7  RB7/AN7
    { &TRISB, &LATB, &PORTB, 8, 8 }, // D8  RB8/AN8
    { &TRISC, &LATC, &PORTC, 13, NO_ADC }, // D9  RC13 (U1ATX/CN1)
    { &TRISC, &LATC, &PORTC, 14, NO_ADC }, // D10 RC14 (U1ARX/CN0/T1CK)
    { &TRISC, &LATC, &PORTC, 15, NO_ADC }, // D11 RC15 (T2CK/SOSCI)
    { &TRISD, &LATD, &PORTD, 0, NO_ADC }, // D12 RD0/OC1 -- LED
    { &TRISD, &LATD, &PORTD, 1, NO_ADC }, // D13 RD1/OC2
    { &TRISD, &LATD, &PORTD, 2, NO_ADC }, // D14 RD2/OC3
    { &TRISD, &LATD, &PORTD, 3, NO_ADC }, // D15 RD3/OC4
    { &TRISE, &LATE, &PORTE, 0, NO_ADC }, // D16 RE0/PWM1L
    { &TRISE, &LATE, &PORTE, 1, NO_ADC }, // D17 RE1/PWM1H
    { &TRISE, &LATE, &PORTE, 2, NO_ADC }, // D18 RE2/PWM2L
    { &TRISE, &LATE, &PORTE, 3, NO_ADC }, // D19 RE3/PWM2H
    { &TRISE, &LATE, &PORTE, 4, NO_ADC }, // D20 RE4/PWM3L
    { &TRISE, &LATE, &PORTE, 5, NO_ADC }, // D21 RE5/PWM3H
    { &TRISE, &LATE, &PORTE, 8, NO_ADC }, // D22 RE8/FLTA
    { &TRISF, &LATF, &PORTF, 0, NO_ADC }, // D23 RF0/C1RX
    { &TRISF, &LATF, &PORTF, 1, NO_ADC }, // D24 RF1/C1TX
    { &TRISF, &LATF, &PORTF, 2, NO_ADC }, // D25 RF2 -- U1RX/SDI1/SDA
    { &TRISF, &LATF, &PORTF, 3, NO_ADC }, // D26 RF3 -- U1TX/SDO1/SCL
    { &TRISF, &LATF, &PORTF, 4, NO_ADC }, // D27 RF4 -- U2RX
    { &TRISF, &LATF, &PORTF, 5, NO_ADC }, // D28 RF5 -- U2TX
    { &TRISF, &LATF, &PORTF, 6, NO_ADC }, // D29 RF6 -- SCK1
};
#define PIN_COUNT 30
#elif defined(__dsPIC30F5015__) || defined(__dsPIC30F6015__)
// dsPIC30F5015 / dsPIC30F6015 (64-pin, motor-control): B0-15(AN0-15), C13-15, D0-11, E0-7,
// F0-6, G2-3/G6-9. OC1-4 on RD0-3, no UART2.
static const PinInfo _pins[] = {
    { &TRISB, &LATB, &PORTB, 0, 0 }, // D0  RB0/AN0
    { &TRISB, &LATB, &PORTB, 1, 1 }, // D1  RB1/AN1
    { &TRISB, &LATB, &PORTB, 2, 2 }, // D2  RB2/AN2 -- SS1
    { &TRISB, &LATB, &PORTB, 3, 3 }, // D3  RB3/AN3
    { &TRISB, &LATB, &PORTB, 4, 4 }, // D4  RB4/AN4
    { &TRISB, &LATB, &PORTB, 5, 5 }, // D5  RB5/AN5
    { &TRISB, &LATB, &PORTB, 6, 6 }, // D6  RB6/AN6
    { &TRISB, &LATB, &PORTB, 7, 7 }, // D7  RB7/AN7
    { &TRISB, &LATB, &PORTB, 8, 8 }, // D8  RB8/AN8
    { &TRISB, &LATB, &PORTB, 9, 9 }, // D9  RB9/AN9
    { &TRISB, &LATB, &PORTB, 10, 10 }, // D10  RB10/AN10
    { &TRISB, &LATB, &PORTB, 11, 11 }, // D11  RB11/AN11
    { &TRISB, &LATB, &PORTB, 12, 12 }, // D12  RB12/AN12
    { &TRISB, &LATB, &PORTB, 13, 13 }, // D13  RB13/AN13
    { &TRISB, &LATB, &PORTB, 14, 14 }, // D14  RB14/AN14
    { &TRISB, &LATB, &PORTB, 15, 15 }, // D15  RB15/AN15
    { &TRISC, &LATC, &PORTC, 13, NO_ADC }, // D16  RC13
    { &TRISC, &LATC, &PORTC, 14, NO_ADC }, // D17  RC14
    { &TRISC, &LATC, &PORTC, 15, NO_ADC }, // D18  RC15
    { &TRISD, &LATD, &PORTD, 0, NO_ADC }, // D19  RD0 -- OC1
    { &TRISD, &LATD, &PORTD, 1, NO_ADC }, // D20  RD1 -- OC2
    { &TRISD, &LATD, &PORTD, 2, NO_ADC }, // D21  RD2 -- OC3
    { &TRISD, &LATD, &PORTD, 3, NO_ADC }, // D22  RD3 -- OC4
    { &TRISD, &LATD, &PORTD, 4, NO_ADC }, // D23  RD4
    { &TRISD, &LATD, &PORTD, 5, NO_ADC }, // D24  RD5
    { &TRISD, &LATD, &PORTD, 6, NO_ADC }, // D25  RD6
    { &TRISD, &LATD, &PORTD, 7, NO_ADC }, // D26  RD7
    { &TRISD, &LATD, &PORTD, 8, NO_ADC }, // D27  RD8
    { &TRISD, &LATD, &PORTD, 9, NO_ADC }, // D28  RD9
    { &TRISD, &LATD, &PORTD, 10, NO_ADC }, // D29  RD10
    { &TRISD, &LATD, &PORTD, 11, NO_ADC }, // D30  RD11
    { &TRISE, &LATE, &PORTE, 0, NO_ADC }, // D31  RE0
    { &TRISE, &LATE, &PORTE, 1, NO_ADC }, // D32  RE1
    { &TRISE, &LATE, &PORTE, 2, NO_ADC }, // D33  RE2
    { &TRISE, &LATE, &PORTE, 3, NO_ADC }, // D34  RE3
    { &TRISE, &LATE, &PORTE, 4, NO_ADC }, // D35  RE4
    { &TRISE, &LATE, &PORTE, 5, NO_ADC }, // D36  RE5
    { &TRISE, &LATE, &PORTE, 6, NO_ADC }, // D37  RE6
    { &TRISE, &LATE, &PORTE, 7, NO_ADC }, // D38  RE7
    { &TRISF, &LATF, &PORTF, 0, NO_ADC }, // D39  RF0
    { &TRISF, &LATF, &PORTF, 1, NO_ADC }, // D40  RF1
    { &TRISF, &LATF, &PORTF, 2, NO_ADC }, // D41  RF2 -- U1RX/SDI1
    { &TRISF, &LATF, &PORTF, 3, NO_ADC }, // D42  RF3 -- U1TX/SDO1
    { &TRISF, &LATF, &PORTF, 4, NO_ADC }, // D43  RF4
    { &TRISF, &LATF, &PORTF, 5, NO_ADC }, // D44  RF5
    { &TRISF, &LATF, &PORTF, 6, NO_ADC }, // D45  RF6 -- SCK1
    { &TRISG, &LATG, &PORTG, 2, NO_ADC }, // D46  RG2 -- SCL
    { &TRISG, &LATG, &PORTG, 3, NO_ADC }, // D47  RG3 -- SDA
    { &TRISG, &LATG, &PORTG, 6, NO_ADC }, // D48  RG6 -- SCK2
    { &TRISG, &LATG, &PORTG, 7, NO_ADC }, // D49  RG7 -- SDI2
    { &TRISG, &LATG, &PORTG, 8, NO_ADC }, // D50  RG8 -- SDO2
    { &TRISG, &LATG, &PORTG, 9, NO_ADC }, // D51  RG9 -- SS2
};
#define PIN_COUNT 52
#elif defined(__dsPIC30F5016__)
// dsPIC30F5016 (80-pin, motor-control): B0-15(AN0-15), A9/A10/A14/A15,
// C1/C3/C13-15, D0-15, E0-9, F0-8, G0-3/G6-9. OC1-4 on RD0-3, no UART2.
static const PinInfo _pins[] = {
    { &TRISB, &LATB, &PORTB, 0, 0 }, // D0  RB0/AN0
    { &TRISB, &LATB, &PORTB, 1, 1 }, // D1  RB1/AN1
    { &TRISB, &LATB, &PORTB, 2, 2 }, // D2  RB2/AN2 -- SS1
    { &TRISB, &LATB, &PORTB, 3, 3 }, // D3  RB3/AN3
    { &TRISB, &LATB, &PORTB, 4, 4 }, // D4  RB4/AN4
    { &TRISB, &LATB, &PORTB, 5, 5 }, // D5  RB5/AN5
    { &TRISB, &LATB, &PORTB, 6, 6 }, // D6  RB6/AN6
    { &TRISB, &LATB, &PORTB, 7, 7 }, // D7  RB7/AN7
    { &TRISB, &LATB, &PORTB, 8, 8 }, // D8  RB8/AN8
    { &TRISB, &LATB, &PORTB, 9, 9 }, // D9  RB9/AN9
    { &TRISB, &LATB, &PORTB, 10, 10 }, // D10  RB10/AN10
    { &TRISB, &LATB, &PORTB, 11, 11 }, // D11  RB11/AN11
    { &TRISB, &LATB, &PORTB, 12, 12 }, // D12  RB12/AN12
    { &TRISB, &LATB, &PORTB, 13, 13 }, // D13  RB13/AN13
    { &TRISB, &LATB, &PORTB, 14, 14 }, // D14  RB14/AN14
    { &TRISB, &LATB, &PORTB, 15, 15 }, // D15  RB15/AN15
    { &TRISA, &LATA, &PORTA, 9, NO_ADC }, // D16  RA9
    { &TRISA, &LATA, &PORTA, 10, NO_ADC }, // D17  RA10
    { &TRISA, &LATA, &PORTA, 14, NO_ADC }, // D18  RA14
    { &TRISA, &LATA, &PORTA, 15, NO_ADC }, // D19  RA15
    { &TRISC, &LATC, &PORTC, 1, NO_ADC }, // D20  RC1
    { &TRISC, &LATC, &PORTC, 3, NO_ADC }, // D21  RC3
    { &TRISC, &LATC, &PORTC, 13, NO_ADC }, // D22  RC13
    { &TRISC, &LATC, &PORTC, 14, NO_ADC }, // D23  RC14
    { &TRISC, &LATC, &PORTC, 15, NO_ADC }, // D24  RC15
    { &TRISD, &LATD, &PORTD, 0, NO_ADC }, // D25  RD0 -- OC1
    { &TRISD, &LATD, &PORTD, 1, NO_ADC }, // D26  RD1 -- OC2
    { &TRISD, &LATD, &PORTD, 2, NO_ADC }, // D27  RD2 -- OC3
    { &TRISD, &LATD, &PORTD, 3, NO_ADC }, // D28  RD3 -- OC4
    { &TRISD, &LATD, &PORTD, 4, NO_ADC }, // D29  RD4
    { &TRISD, &LATD, &PORTD, 5, NO_ADC }, // D30  RD5
    { &TRISD, &LATD, &PORTD, 6, NO_ADC }, // D31  RD6
    { &TRISD, &LATD, &PORTD, 7, NO_ADC }, // D32  RD7
    { &TRISD, &LATD, &PORTD, 8, NO_ADC }, // D33  RD8
    { &TRISD, &LATD, &PORTD, 9, NO_ADC }, // D34  RD9
    { &TRISD, &LATD, &PORTD, 10, NO_ADC }, // D35  RD10
    { &TRISD, &LATD, &PORTD, 11, NO_ADC }, // D36  RD11
    { &TRISD, &LATD, &PORTD, 12, NO_ADC }, // D37  RD12
    { &TRISD, &LATD, &PORTD, 13, NO_ADC }, // D38  RD13
    { &TRISD, &LATD, &PORTD, 14, NO_ADC }, // D39  RD14
    { &TRISD, &LATD, &PORTD, 15, NO_ADC }, // D40  RD15
    { &TRISE, &LATE, &PORTE, 0, NO_ADC }, // D41  RE0
    { &TRISE, &LATE, &PORTE, 1, NO_ADC }, // D42  RE1
    { &TRISE, &LATE, &PORTE, 2, NO_ADC }, // D43  RE2
    { &TRISE, &LATE, &PORTE, 3, NO_ADC }, // D44  RE3
    { &TRISE, &LATE, &PORTE, 4, NO_ADC }, // D45  RE4
    { &TRISE, &LATE, &PORTE, 5, NO_ADC }, // D46  RE5
    { &TRISE, &LATE, &PORTE, 6, NO_ADC }, // D47  RE6
    { &TRISE, &LATE, &PORTE, 7, NO_ADC }, // D48  RE7
    { &TRISE, &LATE, &PORTE, 8, NO_ADC }, // D49  RE8
    { &TRISE, &LATE, &PORTE, 9, NO_ADC }, // D50  RE9
    { &TRISF, &LATF, &PORTF, 0, NO_ADC }, // D51  RF0
    { &TRISF, &LATF, &PORTF, 1, NO_ADC }, // D52  RF1
    { &TRISF, &LATF, &PORTF, 2, NO_ADC }, // D53  RF2 -- U1RX
    { &TRISF, &LATF, &PORTF, 3, NO_ADC }, // D54  RF3 -- U1TX
    { &TRISF, &LATF, &PORTF, 4, NO_ADC }, // D55  RF4
    { &TRISF, &LATF, &PORTF, 5, NO_ADC }, // D56  RF5
    { &TRISF, &LATF, &PORTF, 6, NO_ADC }, // D57  RF6 -- SCK1
    { &TRISF, &LATF, &PORTF, 7, NO_ADC }, // D58  RF7 -- SDI1
    { &TRISF, &LATF, &PORTF, 8, NO_ADC }, // D59  RF8 -- SDO1
    { &TRISG, &LATG, &PORTG, 0, NO_ADC }, // D60  RG0
    { &TRISG, &LATG, &PORTG, 1, NO_ADC }, // D61  RG1
    { &TRISG, &LATG, &PORTG, 2, NO_ADC }, // D62  RG2 -- SCL
    { &TRISG, &LATG, &PORTG, 3, NO_ADC }, // D63  RG3 -- SDA
    { &TRISG, &LATG, &PORTG, 6, NO_ADC }, // D64  RG6 -- SCK2
    { &TRISG, &LATG, &PORTG, 7, NO_ADC }, // D65  RG7 -- SDI2
    { &TRISG, &LATG, &PORTG, 8, NO_ADC }, // D66  RG8 -- SDO2
    { &TRISG, &LATG, &PORTG, 9, NO_ADC }, // D67  RG9 -- SS2
};
#define PIN_COUNT 68
#else // __dsPIC30F2010__
static const PinInfo _pins[] = {
    { &TRISB, &LATB, &PORTB, 0, 0 }, // D0  RB0/AN0
    { &TRISB, &LATB, &PORTB, 1, 1 }, // D1  RB1/AN1
    { &TRISB, &LATB, &PORTB, 2, 2 }, // D2  RB2/AN2 (also SS1)
    { &TRISB, &LATB, &PORTB, 3, 3 }, // D3  RB3/AN3
    { &TRISB, &LATB, &PORTB, 4, 4 }, // D4  RB4/AN4
    { &TRISB, &LATB, &PORTB, 5, 5 }, // D5  RB5/AN5
    { &TRISC, &LATC, &PORTC, 13, NO_ADC }, // D6  RC13 (U1ATX/CN1)
    { &TRISC, &LATC, &PORTC, 14, NO_ADC }, // D7  RC14 (U1ARX/CN0/T1CK)
    { &TRISC, &LATC, &PORTC, 15, NO_ADC }, // D8  RC15 (T2CK/SOSCI)
    { &TRISD, &LATD, &PORTD, 0, NO_ADC }, // D9  RD0/OC1 -- LED
    { &TRISD, &LATD, &PORTD, 1, NO_ADC }, // D10 RD1/OC2
    { &TRISE, &LATE, &PORTE, 0, NO_ADC }, // D11 RE0/PWM1L
    { &TRISE, &LATE, &PORTE, 1, NO_ADC }, // D12 RE1/PWM1H
    { &TRISE, &LATE, &PORTE, 2, NO_ADC }, // D13 RE2/PWM2L
    { &TRISE, &LATE, &PORTE, 3, NO_ADC }, // D14 RE3/PWM2H
    { &TRISE, &LATE, &PORTE, 4, NO_ADC }, // D15 RE4/PWM3L
    { &TRISE, &LATE, &PORTE, 5, NO_ADC }, // D16 RE5/PWM3H
    { &TRISE, &LATE, &PORTE, 8, NO_ADC }, // D17 RE8 -- SCK1/FLTA
    { &TRISF, &LATF, &PORTF, 2, NO_ADC }, // D18 RF2 -- U1RX/SDI1/SDA
    { &TRISF, &LATF, &PORTF, 3, NO_ADC }, // D19 RF3 -- U1TX/SDO1/SCL
};
#define PIN_COUNT 20
#endif // __dsPIC30F2010__

// ── millis (Timer1, Type A timer, auto-resets on PR1 period match) ───────────
static volatile uint32_t _millis_count = 0;

void __attribute__((interrupt, auto_psv)) _T1Interrupt(void) {
    IFS0bits.T1IF = 0;
    _millis_count++;
}

// ── picpio_init ──────────────────────────────────────────────────────────────
void picpio_init(void) {
    ADPCFG = 0xFFFF;       // all AN-capable pins start as digital I/O
    ADCON1 = 0x0000;       // SSRC=000 (SAMP-controlled), FORM=00 (integer)
    ADCON2 = 0x0000;
    ADCON3bits.ADCS = 8;   // Tad = (8+1)*Tcy, well above the 334ns minimum
    ADCON1bits.ADON = 1;

    // Timer1: 1ms tick, internal clock (FCY), 1:1 prescale, auto-reload via PR1
    T1CON = 0x0000;
    TMR1  = 0;
    PR1   = (uint16_t)(FCY / 1000UL) - 1;
    IFS0bits.T1IF = 0;
    IEC0bits.T1IE = 1;
    T1CONbits.TON = 1;

    // Timer2: shared PWM time base for analogWrite (OC1-4/D12-D15 on 4011, OC1-2/D9-D10 on 2010)
    T2CON = 0x0000;
    TMR2  = 0;
    PR2   = 255;
    T2CONbits.TON = 1;
}

// ── Digital ───────────────────────────────────────────────────────────────────
void pinMode(uint8_t pin, uint8_t mode) {
    if (pin >= PIN_COUNT) return;
    const PinInfo *p = &_pins[pin];
    unsigned int mask = (unsigned int)(1u << p->bit);
    if (mode == OUTPUT) *p->tris &= ~mask;
    else                *p->tris |= mask; // INPUT / INPUT_PULLUP (no internal WPU on this chip)
}

void digitalWrite(uint8_t pin, uint8_t val) {
    if (pin >= PIN_COUNT) return;
    const PinInfo *p = &_pins[pin];
    unsigned int mask = (unsigned int)(1u << p->bit);
    if (val) *p->lat |=  mask;
    else     *p->lat &= ~mask;
}

int digitalRead(uint8_t pin) {
    if (pin >= PIN_COUNT) return 0;
    const PinInfo *p = &_pins[pin];
    return (*p->port >> p->bit) & 1;
}

// ── Analog input (ADC, D0-D8/A0-A8 only) ─────────────────────────────────────
int analogRead(uint8_t pin) {
    if (pin >= PIN_COUNT) return 0;
    const PinInfo *p = &_pins[pin];
    if (p->adc_ch == NO_ADC) return 0;
    *p->tris |= (unsigned int)(1u << p->bit);          // input
    ADPCFG &= (unsigned int)~(1u << p->adc_ch);        // PCFGn=0 -> analog

    ADCHSbits.CH0SA = (unsigned int)p->adc_ch;
    ADCON1bits.SAMP = 1;
    __delay_us(5);                                     // acquisition time
    ADCON1bits.SAMP = 0;                               // start conversion
    while (!ADCON1bits.DONE);
    return (int)ADCBUF0;
}

// ── PWM (OC1-OC4 on D12-D15 [4011] / OC1-OC2 on D9-D10 [2010], driven by Timer2) ──
void analogWrite(uint8_t pin, uint8_t duty) {
#if defined(__dsPIC30F3013__) || defined(__dsPIC30F2012__)
    // OC1/OC2 output on RB8/RB9 (PORTB) on these chips, not PORTD.
    switch (pin) {
        case D8:
            OC1RS = duty; OC1R = duty;
            OC1CONbits.OCTSEL = 0; OC1CONbits.OCM = 0b110;
            TRISBbits.TRISB8 = 0;
            break;
        case D9:
            OC2RS = duty; OC2R = duty;
            OC2CONbits.OCTSEL = 0; OC2CONbits.OCM = 0b110;
            TRISBbits.TRISB9 = 0;
            break;
        default:
            return;
    }
#elif defined(__dsPIC30F3014__)
    // Same pinout as 4013 but only OC1/OC2 (no OC3/OC4 module), on RD0/RD1.
    switch (pin) {
        case RD0:
            OC1RS = duty; OC1R = duty;
            OC1CONbits.OCTSEL = 0; OC1CONbits.OCM = 0b110;
            TRISDbits.TRISD0 = 0;
            break;
        case RD1:
            OC2RS = duty; OC2R = duty;
            OC2CONbits.OCTSEL = 0; OC2CONbits.OCM = 0b110;
            TRISDbits.TRISD1 = 0;
            break;
        default:
            return;
    }
#elif defined(__dsPIC30F2011__) || defined(__dsPIC30F3012__)
    // OC1 on RD0, OC2 on RB7 (this chip has no PORTF and only one PORTD pin).
    switch (pin) {
        case RD0:
            OC1RS = duty; OC1R = duty;
            OC1CONbits.OCTSEL = 0; OC1CONbits.OCM = 0b110;
            TRISDbits.TRISD0 = 0;
            break;
        case RB7:
            OC2RS = duty; OC2R = duty;
            OC2CONbits.OCTSEL = 0; OC2CONbits.OCM = 0b110;
            TRISBbits.TRISB7 = 0;
            break;
        default:
            return;
    }
#elif defined(__dsPIC30F6014A__) || defined(__dsPIC30F6014__) || defined(__dsPIC30F6013A__) || defined(__dsPIC30F6013__) || defined(__dsPIC30F6011A__) || defined(__dsPIC30F6011__) || defined(__dsPIC30F5011__) || defined(__dsPIC30F6012A__) || defined(__dsPIC30F6012__) || defined(__dsPIC30F6010__) || defined(__dsPIC30F5013__) || defined(__dsPIC30F6015__)
    // 8 PWM channels: OC1-OC8 on RD0-RD7.
    switch (pin) {
        case RD0: OC1RS = duty; OC1R = duty; OC1CONbits.OCTSEL = 0; OC1CONbits.OCM = 0b110; TRISDbits.TRISD0 = 0; break;
        case RD1: OC2RS = duty; OC2R = duty; OC2CONbits.OCTSEL = 0; OC2CONbits.OCM = 0b110; TRISDbits.TRISD1 = 0; break;
        case RD2: OC3RS = duty; OC3R = duty; OC3CONbits.OCTSEL = 0; OC3CONbits.OCM = 0b110; TRISDbits.TRISD2 = 0; break;
        case RD3: OC4RS = duty; OC4R = duty; OC4CONbits.OCTSEL = 0; OC4CONbits.OCM = 0b110; TRISDbits.TRISD3 = 0; break;
        case RD4: OC5RS = duty; OC5R = duty; OC5CONbits.OCTSEL = 0; OC5CONbits.OCM = 0b110; TRISDbits.TRISD4 = 0; break;
        case RD5: OC6RS = duty; OC6R = duty; OC6CONbits.OCTSEL = 0; OC6CONbits.OCM = 0b110; TRISDbits.TRISD5 = 0; break;
        case RD6: OC7RS = duty; OC7R = duty; OC7CONbits.OCTSEL = 0; OC7CONbits.OCM = 0b110; TRISDbits.TRISD6 = 0; break;
        case RD7: OC8RS = duty; OC8R = duty; OC8CONbits.OCTSEL = 0; OC8CONbits.OCM = 0b110; TRISDbits.TRISD7 = 0; break;
        default:
            return;
    }
#elif !defined(__dsPIC30F2010__) && !defined(__dsPIC30F4012__) && !defined(__dsPIC30F3010__)
    // 4011 and 4013 both put OC1-OC4 on RD0-RD3 (the RDx macros resolve to the
    // right Dn per chip), so this one branch serves both.
    switch (pin) {
        case RD0:
            OC1RS = duty; OC1R = duty;
            OC1CONbits.OCTSEL = 0; OC1CONbits.OCM = 0b110;
            TRISDbits.TRISD0 = 0;
            break;
        case RD1:
            OC2RS = duty; OC2R = duty;
            OC2CONbits.OCTSEL = 0; OC2CONbits.OCM = 0b110;
            TRISDbits.TRISD1 = 0;
            break;
        case RD2:
            OC3RS = duty; OC3R = duty;
            OC3CONbits.OCTSEL = 0; OC3CONbits.OCM = 0b110;
            TRISDbits.TRISD2 = 0;
            break;
        case RD3:
            OC4RS = duty; OC4R = duty;
            OC4CONbits.OCTSEL = 0; OC4CONbits.OCM = 0b110;
            TRISDbits.TRISD3 = 0;
            break;
        default:
            return;
    }
#else
    switch (pin) {
        case D9:
            OC1RS = duty; OC1R = duty;
            OC1CONbits.OCTSEL = 0; OC1CONbits.OCM = 0b110;
            TRISDbits.TRISD0 = 0;
            break;
        case D10:
            OC2RS = duty; OC2R = duty;
            OC2CONbits.OCTSEL = 0; OC2CONbits.OCM = 0b110;
            TRISDbits.TRISD1 = 0;
            break;
        default:
            return;
    }
#endif
}

// ── Timing ────────────────────────────────────────────────────────────────────
uint32_t millis(void) {
    uint32_t m;
    noInterrupts();
    m = _millis_count;
    interrupts();
    return m;
}
uint32_t micros(void)               { return millis() * 1000UL; }
void delay(uint32_t ms)             { uint32_t s = millis(); while ((millis() - s) < ms); }
void delayMicroseconds(uint32_t us) { while (us--) __delay_us(1); }

// ── Serial (UART1, RF3=TX, RF2=RX) ───────────────────────────────────────────
// NOTE: RF2/RF3 are also SDI1/SDA and SDO1/SCL -- don't use Serial together
// with SPI or Wire on real hardware.
static void _serial_begin(uint32_t baud) {
#if defined(__dsPIC30F2011__) || defined(__dsPIC30F3012__)
    TRISBbits.TRISB5 = 1; // RB5 = U1RX input
    TRISBbits.TRISB4 = 0; // RB4 = U1TX output
#else
    TRISFbits.TRISF2 = 1; // RF2 = U1RX input
    TRISFbits.TRISF3 = 0; // RF3 = U1TX output
#endif
    U1BRG = (uint16_t)(FCY / (16UL * baud)) - 1;
    U1MODEbits.UARTEN = 1;
    U1STAbits.UTXEN = 1;
}

static void _serial_write(uint8_t b) {
    while (U1STAbits.UTXBF);
    U1TXREG = b;
}

static void _serial_print_s(const char *s) { while (*s) _serial_write((uint8_t)*s++); }

static void _serial_print_i(int32_t n) {
    char buf[11];
    uint32_t un;
    if (n < 0) {
        _serial_write('-');
        un = (uint32_t)(-(n + 1)) + 1u; // avoids overflow on INT32_MIN
    } else {
        un = (uint32_t)n;
    }
    uint8_t i = 0;
    do {
        buf[i++] = (char)('0' + (un % 10));
        un /= 10;
    } while (un);
    while (i) _serial_write((uint8_t)buf[--i]);
}

#ifndef PICPIO_TINY_FLASH
static void _serial_print_f(float f, uint8_t dec) {
    char buf[20];
    if      (dec == 0) sprintf(buf, "%ld",  (long)f);
    else if (dec == 1) sprintf(buf, "%.1f", (double)f);
    else if (dec == 2) sprintf(buf, "%.2f", (double)f);
    else               sprintf(buf, "%.3f", (double)f);
    _serial_print_s(buf);
}
#else
// No-sprintf float print -- on the small-flash parts (2010/2011/2012), pulling
// in sprintf's float support overflows program memory (see
// [[picpio_dspic30f_xc16_quirks]]).
static void _serial_print_f(float f, uint8_t dec) {
    if (f < 0) { _serial_write('-'); f = -f; }
    int32_t ip = (int32_t)f;
    _serial_print_i(ip);
    if (dec) {
        _serial_write('.');
        float frac = f - (float)ip;
        while (dec--) {
            frac *= 10.0f;
            int32_t d = (int32_t)frac;
            _serial_write((uint8_t)('0' + d));
            frac -= (float)d;
        }
    }
}
#endif

static void _serial_println_s(const char *s) { _serial_print_s(s); _serial_write('\r'); _serial_write('\n'); }
static void _serial_println_i(int32_t n)     { _serial_print_i(n); _serial_write('\r'); _serial_write('\n'); }
static void _serial_println_f(float f, uint8_t dec) { _serial_print_f(f, dec); _serial_write('\r'); _serial_write('\n'); }

static int _serial_available(void) { return U1STAbits.URXDA ? 1 : 0; }
static int _serial_read(void) {
    if (!U1STAbits.URXDA) return -1;
    return (int)U1RXREG;
}
static void _serial_flush(void) { while (!U1STAbits.TRMT); }
static void _serial_end(void)   { U1MODEbits.UARTEN = 0; }

HardwareSerial_t Serial = {
    .begin     = _serial_begin,
    .end       = _serial_end,
    .print     = _serial_print_s,
    .println   = _serial_println_s,
    .print_s   = _serial_print_s,
    .print_i   = _serial_print_i,
    .print_f   = _serial_print_f,
    .println_s = _serial_println_s,
    .println_i = _serial_println_i,
    .println_f = _serial_println_f,
    .write     = _serial_write,
    .available = _serial_available,
    .read      = _serial_read,
    .flush     = _serial_flush,
};

void _serial_print_f_def(float f)    { _serial_print_f(f, 2); }
void _serial_println_f_def(float f)  { _serial_println_f(f, 2); }
void _serial_print_d_def(double d)   { _serial_print_f((float)d, 2); }
void _serial_println_d_def(double d) { _serial_println_f((float)d, 2); }

#ifndef PICPIO_NO_UART2
// ── Serial2 (UART2, real hardware module -- RF5=TX, RF4=RX) ─────────────────
static void _serial2_begin(uint32_t baud) {
    TRISFbits.TRISF4 = 1; // RF4 = U2RX input
    TRISFbits.TRISF5 = 0; // RF5 = U2TX output
    U2BRG = (uint16_t)(FCY / (16UL * baud)) - 1;
    U2MODEbits.UARTEN = 1;
    U2STAbits.UTXEN = 1;
}

static void _serial2_write(uint8_t b) {
    while (U2STAbits.UTXBF);
    U2TXREG = b;
}

static void _serial2_print_s(const char *s) { while (*s) _serial2_write((uint8_t)*s++); }

static void _serial2_print_i(int32_t n) {
    char buf[11];
    uint32_t un;
    if (n < 0) {
        _serial2_write('-');
        un = (uint32_t)(-(n + 1)) + 1u;
    } else {
        un = (uint32_t)n;
    }
    uint8_t i = 0;
    do {
        buf[i++] = (char)('0' + (un % 10));
        un /= 10;
    } while (un);
    while (i) _serial2_write((uint8_t)buf[--i]);
}

static void _serial2_print_f(float f, uint8_t dec) {
    char buf[20];
    if      (dec == 0) sprintf(buf, "%ld",  (long)f);
    else if (dec == 1) sprintf(buf, "%.1f", (double)f);
    else if (dec == 2) sprintf(buf, "%.2f", (double)f);
    else               sprintf(buf, "%.3f", (double)f);
    _serial2_print_s(buf);
}

static void _serial2_println_s(const char *s) { _serial2_print_s(s); _serial2_write('\r'); _serial2_write('\n'); }
static void _serial2_println_i(int32_t n)     { _serial2_print_i(n); _serial2_write('\r'); _serial2_write('\n'); }
static void _serial2_println_f(float f, uint8_t dec) { _serial2_print_f(f, dec); _serial2_write('\r'); _serial2_write('\n'); }

static int _serial2_available(void) { return U2STAbits.URXDA ? 1 : 0; }
static int _serial2_read(void) {
    if (!U2STAbits.URXDA) return -1;
    return (int)U2RXREG;
}
static void _serial2_flush(void) { while (!U2STAbits.TRMT); }
static void _serial2_end(void)   { U2MODEbits.UARTEN = 0; }

HardwareSerial_t Serial2 = {
    .begin     = _serial2_begin,
    .end       = _serial2_end,
    .print     = _serial2_print_s,
    .println   = _serial2_println_s,
    .print_s   = _serial2_print_s,
    .print_i   = _serial2_print_i,
    .print_f   = _serial2_print_f,
    .println_s = _serial2_println_s,
    .println_i = _serial2_println_i,
    .println_f = _serial2_println_f,
    .write     = _serial2_write,
    .available = _serial2_available,
    .read      = _serial2_read,
    .flush     = _serial2_flush,
};
#endif // PICPIO_NO_UART2

// ── SPI (SPI1, SDO1=RF3, SDI1=RF2; SCK1=RF6 on 4011 / RE8 on 2010) ───────────
// NOTE: SDI1/SDO1 share pins with U1RX/U1TX and SDA/SCL -- don't use SPI
// together with Serial or Wire on real hardware.
static void _spi_begin(void) {
#if defined(__dsPIC30F2011__) || defined(__dsPIC30F3012__)
    TRISBbits.TRISB6 = 0; // RB6 = SCK1 output (master)
    TRISBbits.TRISB4 = 0; // RB4 = SDO1 output
    TRISBbits.TRISB5 = 1; // RB5 = SDI1 input
#elif defined(__dsPIC30F6014A__) || defined(__dsPIC30F6014__) || defined(__dsPIC30F6013A__) || defined(__dsPIC30F6013__) || defined(__dsPIC30F6010__) || defined(__dsPIC30F5013__) || defined(__dsPIC30F5016__)
    TRISFbits.TRISF6 = 0; // RF6 = SCK1 output (master)
    TRISFbits.TRISF8 = 0; // RF8 = SDO1 output
    TRISFbits.TRISF7 = 1; // RF7 = SDI1 input
#else
#if !defined(__dsPIC30F2010__) && !defined(__dsPIC30F4012__) && !defined(__dsPIC30F3010__)
    TRISFbits.TRISF6 = 0; // RF6 = SCK1 output (master)
#else
    TRISEbits.TRISE8 = 0; // RE8 = SCK1 output (master, 2010/4012)
#endif
    TRISFbits.TRISF3 = 0; // RF3 = SDO1 output
    TRISFbits.TRISF2 = 1; // RF2 = SDI1 input
#endif

    SPI1CONbits.MSTEN  = 1;
    SPI1CONbits.MODE16 = 0;
    SPI1CONbits.SMP    = 0;
    SPI1CONbits.CKP    = 0;
    SPI1CONbits.CKE    = 1;
    SPI1CONbits.PPRE1  = 1; SPI1CONbits.PPRE0 = 0; // primary prescale 4:1
    SPI1CONbits.SPRE2  = 0; SPI1CONbits.SPRE1 = 1; SPI1CONbits.SPRE0 = 1; // secondary prescale 4:1
    SPI1STATbits.SPIEN = 1;
}

static uint8_t _spi_transfer(uint8_t b) {
    SPI1BUF = b;
    while (!SPI1STATbits.SPIRBF);
    return (uint8_t)SPI1BUF;
}

static void _spi_setBitOrder(uint8_t o) { (void)o; /* MSB-first only */ }
static void _spi_setDataMode(uint8_t m) {
    SPI1CONbits.CKP = (m >> 1) & 1;
    SPI1CONbits.CKE = !(m & 1);
}
static void _spi_setClockDivider(uint8_t d) { (void)d; /* fixed prescale set in _spi_begin */ }
static void _spi_end(void) { SPI1STATbits.SPIEN = 0; }

SPIClass_t SPI = {
    .begin           = _spi_begin,
    .end             = _spi_end,
    .transfer        = _spi_transfer,
    .setBitOrder     = _spi_setBitOrder,
    .setDataMode     = _spi_setDataMode,
    .setClockDivider = _spi_setClockDivider,
};

// ── Wire / I2C (SCL=RF3, SDA=RF2) ─────────────────────────────────────────────
// NOTE: shares pins with U1TX/U1RX and SDO1/SDI1 -- don't use Wire together
// with Serial or SPI on real hardware.
static uint8_t _i2c_rxbuf[8];
static uint8_t _i2c_rxlen = 0, _i2c_rxpos = 0;

static void _i2c_idle(void) {
    while (I2CCONbits.SEN || I2CCONbits.RSEN || I2CCONbits.PEN ||
           I2CCONbits.RCEN || I2CCONbits.ACKEN || I2CSTATbits.TRSTAT);
}

static void _wire_begin(void) {
#if defined(__dsPIC30F2011__) || defined(__dsPIC30F3012__)
    TRISBbits.TRISB5 = 1; // RB5 = SDA
    TRISBbits.TRISB4 = 1; // RB4 = SCL
#elif defined(__dsPIC30F6014A__) || defined(__dsPIC30F6014__) || defined(__dsPIC30F6013A__) || defined(__dsPIC30F6013__) || defined(__dsPIC30F6011A__) || defined(__dsPIC30F6011__) || defined(__dsPIC30F5011__) || defined(__dsPIC30F6012A__) || defined(__dsPIC30F6012__) || defined(__dsPIC30F6010__) || defined(__dsPIC30F5013__) || defined(__dsPIC30F5015__) || defined(__dsPIC30F5016__) || defined(__dsPIC30F6015__)
    TRISGbits.TRISG3 = 1; // RG3 = SDA
    TRISGbits.TRISG2 = 1; // RG2 = SCL
#else
    TRISFbits.TRISF2 = 1; // SDA
    TRISFbits.TRISF3 = 1; // SCL
#endif
    I2CBRG = (uint16_t)(FCY / 100000UL) - (uint16_t)(FCY / 1111111UL) - 1; // ~100kHz
    I2CCONbits.I2CEN = 1;
}

static void _wire_beginTx(uint8_t addr) {
    _i2c_idle();
    I2CCONbits.SEN = 1;
    while (I2CCONbits.SEN);
    I2CTRN = (unsigned int)(addr << 1);
    while (I2CSTATbits.TBF);
    _i2c_idle();
}

static void _wire_write(uint8_t b) {
    I2CTRN = b;
    while (I2CSTATbits.TBF);
    _i2c_idle();
}

static uint8_t _wire_endTx(void) {
    _i2c_idle();
    I2CCONbits.PEN = 1;
    while (I2CCONbits.PEN);
    return 0;
}

static uint8_t _wire_requestFrom(uint8_t addr, uint8_t len) {
    _i2c_rxlen = 0; _i2c_rxpos = 0;
    if (len > sizeof(_i2c_rxbuf)) len = sizeof(_i2c_rxbuf);

    _i2c_idle();
    I2CCONbits.SEN = 1;
    while (I2CCONbits.SEN);
    I2CTRN = (unsigned int)((addr << 1) | 1);
    while (I2CSTATbits.TBF);
    _i2c_idle();

    for (uint8_t i = 0; i < len; i++) {
        I2CCONbits.RCEN = 1;
        while (I2CCONbits.RCEN);
        while (!I2CSTATbits.RBF);
        _i2c_rxbuf[i] = (uint8_t)I2CRCV;
        _i2c_rxlen++;
        I2CCONbits.ACKDT = (i < (uint8_t)(len - 1)) ? 0 : 1;
        I2CCONbits.ACKEN = 1;
        while (I2CCONbits.ACKEN);
    }
    I2CCONbits.PEN = 1;
    while (I2CCONbits.PEN);
    return _i2c_rxlen;
}

static int _wire_available(void) { return _i2c_rxpos < _i2c_rxlen; }
static int _wire_read(void)      { return _wire_available() ? _i2c_rxbuf[_i2c_rxpos++] : -1; }

TwoWire_t Wire = {
    .begin             = _wire_begin,
    .beginTransmission = _wire_beginTx,
    .endTransmission   = _wire_endTx,
    .requestFrom       = _wire_requestFrom,
    .write             = _wire_write,
    .available         = _wire_available,
    .read              = _wire_read,
};
