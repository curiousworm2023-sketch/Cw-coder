#define PICPIO_PIN_ALIASES   // HAL internals reference the native Rxx pin names
#include "Picpio.h"

// ── Pin map ───────────────────────────────────────────────────────────────────
// dsPIC33EP512MU810 -- 83 GPIO pins across PORTA-PORTG. All SFRs are 16-bit
// (__attribute__((__sfr__))), so tris/lat/port pointers are
// volatile unsigned int* (not uint8_t* as on the 8-bit XC8 HALs).
typedef struct {
    volatile unsigned int *tris;
    volatile unsigned int *lat;
    volatile unsigned int *port;
    uint8_t bit;
    int8_t  adc_ch; // AD1CHS0 CH0SA value (AN0-AN15), or NO_ADC
} PinInfo;

#define NO_ADC -1

static const PinInfo _pins[] = {
    // PORTA -- D0-D11
    { &TRISA, &LATA, &PORTA, 0,  NO_ADC }, // D0  RA0
    { &TRISA, &LATA, &PORTA, 1,  NO_ADC }, // D1  RA1
    { &TRISA, &LATA, &PORTA, 2,  NO_ADC }, // D2  RA2
    { &TRISA, &LATA, &PORTA, 3,  NO_ADC }, // D3  RA3
    { &TRISA, &LATA, &PORTA, 4,  NO_ADC }, // D4  RA4
    { &TRISA, &LATA, &PORTA, 5,  NO_ADC }, // D5  RA5
    { &TRISA, &LATA, &PORTA, 6,  NO_ADC }, // D6  RA6
    { &TRISA, &LATA, &PORTA, 7,  NO_ADC }, // D7  RA7
    { &TRISA, &LATA, &PORTA, 9,  NO_ADC }, // D8  RA9
    { &TRISA, &LATA, &PORTA, 10, NO_ADC }, // D9  RA10
    { &TRISA, &LATA, &PORTA, 14, NO_ADC }, // D10 RA14
    { &TRISA, &LATA, &PORTA, 15, NO_ADC }, // D11 RA15
    // PORTB -- D12-D27 / A0-A15 / AN0-AN15
    { &TRISB, &LATB, &PORTB, 0,  0  }, // D12 RB0/AN0
    { &TRISB, &LATB, &PORTB, 1,  1  }, // D13 RB1/AN1
    { &TRISB, &LATB, &PORTB, 2,  2  }, // D14 RB2/AN2
    { &TRISB, &LATB, &PORTB, 3,  3  }, // D15 RB3/AN3
    { &TRISB, &LATB, &PORTB, 4,  4  }, // D16 RB4/AN4
    { &TRISB, &LATB, &PORTB, 5,  5  }, // D17 RB5/AN5
    { &TRISB, &LATB, &PORTB, 6,  6  }, // D18 RB6/AN6
    { &TRISB, &LATB, &PORTB, 7,  7  }, // D19 RB7/AN7
    { &TRISB, &LATB, &PORTB, 8,  8  }, // D20 RB8/AN8
    { &TRISB, &LATB, &PORTB, 9,  9  }, // D21 RB9/AN9
    { &TRISB, &LATB, &PORTB, 10, 10 }, // D22 RB10/AN10
    { &TRISB, &LATB, &PORTB, 11, 11 }, // D23 RB11/AN11
    { &TRISB, &LATB, &PORTB, 12, 12 }, // D24 RB12/AN12
    { &TRISB, &LATB, &PORTB, 13, 13 }, // D25 RB13/AN13
    { &TRISB, &LATB, &PORTB, 14, 14 }, // D26 RB14/AN14
    { &TRISB, &LATB, &PORTB, 15, 15 }, // D27 RB15/AN15
    // PORTC -- D28-D35
    { &TRISC, &LATC, &PORTC, 1,  NO_ADC }, // D28 RC1
    { &TRISC, &LATC, &PORTC, 2,  NO_ADC }, // D29 RC2
    { &TRISC, &LATC, &PORTC, 3,  NO_ADC }, // D30 RC3
    { &TRISC, &LATC, &PORTC, 4,  NO_ADC }, // D31 RC4
    { &TRISC, &LATC, &PORTC, 12, NO_ADC }, // D32 RC12/OSC1
    { &TRISC, &LATC, &PORTC, 13, NO_ADC }, // D33 RC13
    { &TRISC, &LATC, &PORTC, 14, NO_ADC }, // D34 RC14
    { &TRISC, &LATC, &PORTC, 15, NO_ADC }, // D35 RC15/OSC2
    // PORTD -- D36-D51
    { &TRISD, &LATD, &PORTD, 0,  NO_ADC }, // D36 RD0/RP64/OC1 -- LED
    { &TRISD, &LATD, &PORTD, 1,  NO_ADC }, // D37 RD1/RP65/OC2
    { &TRISD, &LATD, &PORTD, 2,  NO_ADC }, // D38 RD2/RP66/OC3
    { &TRISD, &LATD, &PORTD, 3,  NO_ADC }, // D39 RD3/RP67/OC4
    { &TRISD, &LATD, &PORTD, 4,  NO_ADC }, // D40 RD4/RP68
    { &TRISD, &LATD, &PORTD, 5,  NO_ADC }, // D41 RD5/RP69
    { &TRISD, &LATD, &PORTD, 6,  NO_ADC }, // D42 RD6/RP70
    { &TRISD, &LATD, &PORTD, 7,  NO_ADC }, // D43 RD7/RP71
    { &TRISD, &LATD, &PORTD, 8,  NO_ADC }, // D44 RD8
    { &TRISD, &LATD, &PORTD, 9,  NO_ADC }, // D45 RD9
    { &TRISD, &LATD, &PORTD, 10, NO_ADC }, // D46 RD10
    { &TRISD, &LATD, &PORTD, 11, NO_ADC }, // D47 RD11
    { &TRISD, &LATD, &PORTD, 12, NO_ADC }, // D48 RD12
    { &TRISD, &LATD, &PORTD, 13, NO_ADC }, // D49 RD13
    { &TRISD, &LATD, &PORTD, 14, NO_ADC }, // D50 RD14
    { &TRISD, &LATD, &PORTD, 15, NO_ADC }, // D51 RD15/RP79
    // PORTE -- D52-D61
    { &TRISE, &LATE, &PORTE, 0, NO_ADC }, // D52 RE0
    { &TRISE, &LATE, &PORTE, 1, NO_ADC }, // D53 RE1
    { &TRISE, &LATE, &PORTE, 2, NO_ADC }, // D54 RE2
    { &TRISE, &LATE, &PORTE, 3, NO_ADC }, // D55 RE3
    { &TRISE, &LATE, &PORTE, 4, NO_ADC }, // D56 RE4
    { &TRISE, &LATE, &PORTE, 5, NO_ADC }, // D57 RE5
    { &TRISE, &LATE, &PORTE, 6, NO_ADC }, // D58 RE6
    { &TRISE, &LATE, &PORTE, 7, NO_ADC }, // D59 RE7
    { &TRISE, &LATE, &PORTE, 8, NO_ADC }, // D60 RE8
    { &TRISE, &LATE, &PORTE, 9, NO_ADC }, // D61 RE9
    // PORTF -- D62-D70
    { &TRISF, &LATF, &PORTF, 0,  NO_ADC }, // D62 RF0/RP96  -- SDO1
    { &TRISF, &LATF, &PORTF, 1,  NO_ADC }, // D63 RF1/RP97  -- SDI1
    { &TRISF, &LATF, &PORTF, 2,  NO_ADC }, // D64 RF2/RP98  -- U1RX
    { &TRISF, &LATF, &PORTF, 3,  NO_ADC }, // D65 RF3/RP99  -- U1TX
    { &TRISF, &LATF, &PORTF, 4,  NO_ADC }, // D66 RF4/RP100 -- SDA2
    { &TRISF, &LATF, &PORTF, 5,  NO_ADC }, // D67 RF5/RP101 -- SCL2
    { &TRISF, &LATF, &PORTF, 8,  NO_ADC }, // D68 RF8/RP104 -- SCK1
    { &TRISF, &LATF, &PORTF, 12, NO_ADC }, // D69 RF12/RP108 -- U2RX
    { &TRISF, &LATF, &PORTF, 13, NO_ADC }, // D70 RF13/RP109 -- U2TX
    // PORTG -- D71-D82
    { &TRISG, &LATG, &PORTG, 0,  NO_ADC }, // D71 RG0/RP112
    { &TRISG, &LATG, &PORTG, 1,  NO_ADC }, // D72 RG1/RP113
    { &TRISG, &LATG, &PORTG, 2,  NO_ADC }, // D73 RG2/USB D+
    { &TRISG, &LATG, &PORTG, 3,  NO_ADC }, // D74 RG3/USB D-
    { &TRISG, &LATG, &PORTG, 6,  NO_ADC }, // D75 RG6/RP118
    { &TRISG, &LATG, &PORTG, 7,  NO_ADC }, // D76 RG7/RPI119
    { &TRISG, &LATG, &PORTG, 8,  NO_ADC }, // D77 RG8/RP120
    { &TRISG, &LATG, &PORTG, 9,  NO_ADC }, // D78 RG9/RPI121
    { &TRISG, &LATG, &PORTG, 12, NO_ADC }, // D79 RG12
    { &TRISG, &LATG, &PORTG, 13, NO_ADC }, // D80 RG13/RP125
    { &TRISG, &LATG, &PORTG, 14, NO_ADC }, // D81 RG14/RP126
    { &TRISG, &LATG, &PORTG, 15, NO_ADC }, // D82 RG15/RP127
};
#define PIN_COUNT 83

// ── millis (Timer1, Type A timer, auto-resets on PR1 period match) ───────────
static volatile uint32_t _millis_count = 0;

void __attribute__((interrupt, auto_psv)) _T1Interrupt(void) {
    IFS0bits.T1IF = 0;
    _millis_count++;
}

// ── Peripheral Pin Select (PPS) routing ──────────────────────────────────────
// dsPIC33EP512MU810 has no fixed UART/SPI/OC pins; they are mapped at boot.
// Input sources take the RPn pin NUMBER; output pins take a function CODE.
//   Output codes: U1TX=3, U2TX=5, SDO1=7, SCK1OUT=8, OC1=18, OC2=19, OC3=20, OC4=21
static void _pps_setup(void) {
    __builtin_write_OSCCONL(OSCCON & 0xBF); // unlock (clear IOLOCK = OSCCON<6>)

    // Inputs: assign the RPn number of the source pin
    RPINR18bits.U1RXR = 98;  // U1RX  <- RP98  (RF2/D64)
    RPINR19bits.U2RXR = 108; // U2RX  <- RP108 (RF12/D69)
    RPINR20bits.SDI1R = 97;  // SDI1  <- RP97  (RF1/D63)

    // Outputs: assign the function code to the RPn output register
    _RP99R  = 3;   // RF3/D65  = U1TX
    _RP109R = 5;   // RF13/D70 = U2TX
    _RP96R  = 7;   // RF0/D62  = SDO1
    _RP104R = 8;   // RF8/D68  = SCK1OUT
    _RP64R  = 18;  // RD0/D36  = OC1
    _RP65R  = 19;  // RD1/D37  = OC2
    _RP66R  = 20;  // RD2/D38  = OC3
    _RP67R  = 21;  // RD3/D39  = OC4

    __builtin_write_OSCCONL(OSCCON | 0x40); // lock (set IOLOCK)
}

// ── arduino_init ──────────────────────────────────────────────────────────────
void arduino_init(void) {
    // All analog-capable pins default to analog on reset -- force digital.
    // (dsPIC33E uses per-port ANSELx, not the single AD1PCFG of PIC24F.)
    ANSELA = 0x0000;
    ANSELB = 0x0000;
    ANSELC = 0x0000;
    ANSELD = 0x0000;
    ANSELE = 0x0000;
    ANSELG = 0x0000; // no ANSELF on this device

    _pps_setup();

    // ADC1 in 10-bit manual mode (conversion starts when SAMP is cleared).
    AD1CON1 = 0x0000;       // AD12B=0 (10-bit), SSRC=0000, FORM=00 (integer)
    AD1CON2 = 0x0000;
    AD1CON3 = 0x0000;
    AD1CON3bits.ADCS = 0x3F; // slow Tad, comfortably above the minimum
    AD1CON1bits.ADON = 1;

    // Timer1: 1ms tick, internal clock (FCY), 1:1 prescale, auto-reload via PR1
    T1CON = 0x0000;
    TMR1  = 0;
    PR1   = (uint16_t)(FCY / 1000UL) - 1;
    IFS0bits.T1IF = 0;
    IEC0bits.T1IE = 1;
    T1CONbits.TON = 1;
}

// ── Digital ───────────────────────────────────────────────────────────────────
void pinMode(uint8_t pin, uint8_t mode) {
    if (pin >= PIN_COUNT) return;
    const PinInfo *p = &_pins[pin];
    unsigned int mask = (unsigned int)(1u << p->bit);
    if (mode == OUTPUT) *p->tris &= ~mask;
    else                *p->tris |= mask; // INPUT / INPUT_PULLUP (no internal WPU wired here)
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

// ── Analog input (ADC, D12-D27/A0-A15 only) ──────────────────────────────────
int analogRead(uint8_t pin) {
    if (pin >= PIN_COUNT) return 0;
    const PinInfo *p = &_pins[pin];
    if (p->adc_ch == NO_ADC) return 0;
    *p->tris |= (unsigned int)(1u << p->bit);          // input
    ANSELB   |= (unsigned int)(1u << p->adc_ch);       // ANSELn=1 -> analog (PORTB = AN0-15)

    AD1CHS0bits.CH0SA = (unsigned int)p->adc_ch;
    AD1CON1bits.SAMP = 1;
    __delay_us(5);                                     // acquisition time
    AD1CON1bits.SAMP = 0;                              // start conversion
    while (!AD1CON1bits.DONE);
    return (int)ADC1BUF0;
}

// ── PWM (OC1-OC4 on D36-D39, each OC's own dedicated timer, self-synchronized) ─
// dsPIC33E OC modules run an internal timer; OCxRS sets the period (SYNCSEL=0x1F
// self-sync) and OCxR the duty. No shared Timer2/PR2 base is needed.
static void _oc_pwm(volatile unsigned int *con1, volatile unsigned int *con2,
                    volatile unsigned int *ocr,  volatile unsigned int *ocrs,
                    uint8_t duty) {
    *con1 = 0x0000;
    *con2 = 0x0000;
    *ocr  = duty;            // duty cycle (0-255)
    *ocrs = 255;             // period
    *con2 = 0x001F;          // SYNCSEL=0x1F -> OCxRS is the period (self-sync)
    *con1 = 0x1C06;          // OCTSEL=111 (peripheral clock) | OCM=110 (edge PWM)
}

void analogWrite(uint8_t pin, uint8_t duty) {
    switch (pin) {
        case D36:
            _oc_pwm(&OC1CON1, &OC1CON2, &OC1R, &OC1RS, duty);
            TRISDbits.TRISD0 = 0;
            break;
        case D37:
            _oc_pwm(&OC2CON1, &OC2CON2, &OC2R, &OC2RS, duty);
            TRISDbits.TRISD1 = 0;
            break;
        case D38:
            _oc_pwm(&OC3CON1, &OC3CON2, &OC3R, &OC3RS, duty);
            TRISDbits.TRISD2 = 0;
            break;
        case D39:
            _oc_pwm(&OC4CON1, &OC4CON2, &OC4R, &OC4RS, duty);
            TRISDbits.TRISD3 = 0;
            break;
        default:
            return;
    }
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

// ── Serial (UART1, RF3=TX/D65, RF2=RX/D64, routed via PPS) ────────────────────
static void _serial_begin(uint32_t baud) {
    TRISFbits.TRISF2 = 1; // RF2 = U1RX input
    TRISFbits.TRISF3 = 0; // RF3 = U1TX output
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

static void _serial_print_f(float f, uint8_t dec) {
    char buf[20];
    if      (dec == 0) sprintf(buf, "%ld",  (long)f);
    else if (dec == 1) sprintf(buf, "%.1f", (double)f);
    else if (dec == 2) sprintf(buf, "%.2f", (double)f);
    else               sprintf(buf, "%.3f", (double)f);
    _serial_print_s(buf);
}

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

// ── Serial2 (UART2, RF13=TX/D70, RF12=RX/D69, routed via PPS) ─────────────────
static void _serial2_begin(uint32_t baud) {
    TRISFbits.TRISF12 = 1; // RF12 = U2RX input
    TRISFbits.TRISF13 = 0; // RF13 = U2TX output
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

// ── SPI (SPI1, SCK1=RF8/D68, SDI1=RF1/D63, SDO1=RF0/D62, routed via PPS) ──────
static void _spi_begin(void) {
    TRISFbits.TRISF8 = 0; // RF8 = SCK1 output (master)
    TRISFbits.TRISF0 = 0; // RF0 = SDO1 output
    TRISFbits.TRISF1 = 1; // RF1 = SDI1 input

    SPI1CON1bits.MSTEN  = 1;
    SPI1CON1bits.MODE16 = 0;
    SPI1CON1bits.SMP    = 0;
    SPI1CON1bits.CKP    = 0;
    SPI1CON1bits.CKE    = 1;
    SPI1CON1bits.PPRE  = 0b10;  // primary prescale 4:1
    SPI1CON1bits.SPRE  = 0b110; // secondary prescale 4:1
    SPI1STATbits.SPIEN = 1;
}

static uint8_t _spi_transfer(uint8_t b) {
    SPI1BUF = b;
    while (!SPI1STATbits.SPIRBF);
    return (uint8_t)SPI1BUF;
}

static void _spi_setBitOrder(uint8_t o) { (void)o; /* MSB-first only */ }
static void _spi_setDataMode(uint8_t m) {
    SPI1CON1bits.CKP = (m >> 1) & 1;
    SPI1CON1bits.CKE = !(m & 1);
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

// ── Wire / I2C2 (SCL2=RF5/D67, SDA2=RF4/D66, fixed pins, ALTI2C2_OFF) ─────────
static uint8_t _i2c_rxbuf[8];
static uint8_t _i2c_rxlen = 0, _i2c_rxpos = 0;

static void _i2c_idle(void) {
    while (I2C2CONbits.SEN || I2C2CONbits.RSEN || I2C2CONbits.PEN ||
           I2C2CONbits.RCEN || I2C2CONbits.ACKEN || I2C2STATbits.TRSTAT);
}

static void _wire_begin(void) {
    TRISFbits.TRISF4 = 1; // SDA2
    TRISFbits.TRISF5 = 1; // SCL2
    I2C2BRG = (uint16_t)(FCY / 100000UL) - (uint16_t)(FCY / 1111111UL) - 1; // ~100kHz
    I2C2CONbits.I2CEN = 1;
}

static void _wire_beginTx(uint8_t addr) {
    _i2c_idle();
    I2C2CONbits.SEN = 1;
    while (I2C2CONbits.SEN);
    I2C2TRN = (unsigned int)(addr << 1);
    while (I2C2STATbits.TBF);
    _i2c_idle();
}

static void _wire_write(uint8_t b) {
    I2C2TRN = b;
    while (I2C2STATbits.TBF);
    _i2c_idle();
}

static uint8_t _wire_endTx(void) {
    _i2c_idle();
    I2C2CONbits.PEN = 1;
    while (I2C2CONbits.PEN);
    return 0;
}

static uint8_t _wire_requestFrom(uint8_t addr, uint8_t len) {
    _i2c_rxlen = 0; _i2c_rxpos = 0;
    if (len > sizeof(_i2c_rxbuf)) len = sizeof(_i2c_rxbuf);

    _i2c_idle();
    I2C2CONbits.SEN = 1;
    while (I2C2CONbits.SEN);
    I2C2TRN = (unsigned int)((addr << 1) | 1);
    while (I2C2STATbits.TBF);
    _i2c_idle();

    for (uint8_t i = 0; i < len; i++) {
        I2C2CONbits.RCEN = 1;
        while (I2C2CONbits.RCEN);
        while (!I2C2STATbits.RBF);
        _i2c_rxbuf[i] = (uint8_t)I2C2RCV;
        _i2c_rxlen++;
        I2C2CONbits.ACKDT = (i < (uint8_t)(len - 1)) ? 0 : 1;
        I2C2CONbits.ACKEN = 1;
        while (I2C2CONbits.ACKEN);
    }
    I2C2CONbits.PEN = 1;
    while (I2C2CONbits.PEN);
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
