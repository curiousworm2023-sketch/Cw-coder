#include "Picpio.h"

// ── Pin map ───────────────────────────────────────────────────────────────────
// PIC24FJ128GA010 -- 85 GPIO pins across PORTA-PORTG. All SFRs are 16-bit
// (__attribute__((__sfr__))), so tris/lat/port pointers are
// volatile unsigned int* (not uint8_t* as on the 8-bit XC8 HALs).
typedef struct {
    volatile unsigned int *tris;
    volatile unsigned int *lat;
    volatile unsigned int *port;
    uint8_t bit;
    int8_t  adc_ch; // AD1CHS CH0SA value (AN0-AN15), or NO_ADC
} PinInfo;

#define NO_ADC -1

static const PinInfo _pins[] = {
    // PORTA -- D0-D11
    { &TRISA, &LATA, &PORTA, 0,  NO_ADC }, // D0  RA0
    { &TRISA, &LATA, &PORTA, 1,  NO_ADC }, // D1  RA1
    { &TRISA, &LATA, &PORTA, 2,  NO_ADC }, // D2  RA2/SCL2
    { &TRISA, &LATA, &PORTA, 3,  NO_ADC }, // D3  RA3/SDA2
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
    { &TRISB, &LATB, &PORTB, 2,  2  }, // D14 RB2/AN2 (also SS1)
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
    { &TRISD, &LATD, &PORTD, 0,  NO_ADC }, // D36 RD0/OC1 -- LED
    { &TRISD, &LATD, &PORTD, 1,  NO_ADC }, // D37 RD1/OC2
    { &TRISD, &LATD, &PORTD, 2,  NO_ADC }, // D38 RD2/OC3
    { &TRISD, &LATD, &PORTD, 3,  NO_ADC }, // D39 RD3/OC4
    { &TRISD, &LATD, &PORTD, 4,  NO_ADC }, // D40 RD4/OC5
    { &TRISD, &LATD, &PORTD, 5,  NO_ADC }, // D41 RD5
    { &TRISD, &LATD, &PORTD, 6,  NO_ADC }, // D42 RD6
    { &TRISD, &LATD, &PORTD, 7,  NO_ADC }, // D43 RD7
    { &TRISD, &LATD, &PORTD, 8,  NO_ADC }, // D44 RD8/IC1
    { &TRISD, &LATD, &PORTD, 9,  NO_ADC }, // D45 RD9/IC2
    { &TRISD, &LATD, &PORTD, 10, NO_ADC }, // D46 RD10/IC3
    { &TRISD, &LATD, &PORTD, 11, NO_ADC }, // D47 RD11/IC4
    { &TRISD, &LATD, &PORTD, 12, NO_ADC }, // D48 RD12/IC5
    { &TRISD, &LATD, &PORTD, 13, NO_ADC }, // D49 RD13
    { &TRISD, &LATD, &PORTD, 14, NO_ADC }, // D50 RD14
    { &TRISD, &LATD, &PORTD, 15, NO_ADC }, // D51 RD15
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
    // PORTF -- D62-D72
    { &TRISF, &LATF, &PORTF, 0,  NO_ADC }, // D62 RF0
    { &TRISF, &LATF, &PORTF, 1,  NO_ADC }, // D63 RF1
    { &TRISF, &LATF, &PORTF, 2,  NO_ADC }, // D64 RF2 -- U1RX
    { &TRISF, &LATF, &PORTF, 3,  NO_ADC }, // D65 RF3 -- U1TX
    { &TRISF, &LATF, &PORTF, 4,  NO_ADC }, // D66 RF4 -- U2RX
    { &TRISF, &LATF, &PORTF, 5,  NO_ADC }, // D67 RF5 -- U2TX
    { &TRISF, &LATF, &PORTF, 6,  NO_ADC }, // D68 RF6 -- SCK1
    { &TRISF, &LATF, &PORTF, 7,  NO_ADC }, // D69 RF7 -- SDI1
    { &TRISF, &LATF, &PORTF, 8,  NO_ADC }, // D70 RF8 -- SDO1
    { &TRISF, &LATF, &PORTF, 12, NO_ADC }, // D71 RF12/U2CTS
    { &TRISF, &LATF, &PORTF, 13, NO_ADC }, // D72 RF13/U2RTS
    // PORTG -- D73-D84
    { &TRISG, &LATG, &PORTG, 0,  NO_ADC }, // D73 RG0
    { &TRISG, &LATG, &PORTG, 1,  NO_ADC }, // D74 RG1
    { &TRISG, &LATG, &PORTG, 2,  NO_ADC }, // D75 RG2 -- SCL1
    { &TRISG, &LATG, &PORTG, 3,  NO_ADC }, // D76 RG3 -- SDA1
    { &TRISG, &LATG, &PORTG, 6,  NO_ADC }, // D77 RG6/SCK2
    { &TRISG, &LATG, &PORTG, 7,  NO_ADC }, // D78 RG7/SDI2
    { &TRISG, &LATG, &PORTG, 8,  NO_ADC }, // D79 RG8/SDO2
    { &TRISG, &LATG, &PORTG, 9,  NO_ADC }, // D80 RG9/SS2
    { &TRISG, &LATG, &PORTG, 12, NO_ADC }, // D81 RG12
    { &TRISG, &LATG, &PORTG, 13, NO_ADC }, // D82 RG13
    { &TRISG, &LATG, &PORTG, 14, NO_ADC }, // D83 RG14
    { &TRISG, &LATG, &PORTG, 15, NO_ADC }, // D84 RG15
};
#define PIN_COUNT 85

// ── millis (Timer1, Type A timer, auto-resets on PR1 period match) ───────────
static volatile uint32_t _millis_count = 0;

void __attribute__((interrupt, auto_psv)) _T1Interrupt(void) {
    IFS0bits.T1IF = 0;
    _millis_count++;
}

// ── arduino_init ──────────────────────────────────────────────────────────────
void arduino_init(void) {
    AD1PCFG = 0xFFFF;       // all AN-capable pins start as digital I/O
    AD1CON1 = 0x0000;       // SSRC=000 (SAMP-controlled), FORM=00 (integer)
    AD1CON2 = 0x0000;
    AD1CON3bits.ADCS = 8;   // Tad = (8+1)*Tcy, well above the 334ns minimum
    AD1CON1bits.ADON = 1;

    // Timer1: 1ms tick, internal clock (FCY), 1:1 prescale, auto-reload via PR1
    T1CON = 0x0000;
    TMR1  = 0;
    PR1   = (uint16_t)(FCY / 1000UL) - 1;
    IFS0bits.T1IF = 0;
    IEC0bits.T1IE = 1;
    T1CONbits.TON = 1;

    // Timer2: shared PWM time base for analogWrite (OC1-OC5 / D36-D40)
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

// ── Analog input (ADC, D12-D27/A0-A15 only) ──────────────────────────────────
int analogRead(uint8_t pin) {
    if (pin >= PIN_COUNT) return 0;
    const PinInfo *p = &_pins[pin];
    if (p->adc_ch == NO_ADC) return 0;
    *p->tris |= (unsigned int)(1u << p->bit);          // input
    AD1PCFG &= (unsigned int)~(1u << p->adc_ch);       // PCFGn=0 -> analog

    AD1CHSbits.CH0SA = (unsigned int)p->adc_ch;
    AD1CON1bits.SAMP = 1;
    __delay_us(5);                                     // acquisition time
    AD1CON1bits.SAMP = 0;                              // start conversion
    while (!AD1CON1bits.DONE);
    return (int)ADC1BUF0;
}

// ── PWM (OC1-OC5 on D36-D40, driven by Timer2) ───────────────────────────────
void analogWrite(uint8_t pin, uint8_t duty) {
    switch (pin) {
        case D36:
            OC1RS = duty; OC1R = duty;
            OC1CONbits.OCTSEL = 0; OC1CONbits.OCM = 0b110;
            TRISDbits.TRISD0 = 0;
            break;
        case D37:
            OC2RS = duty; OC2R = duty;
            OC2CONbits.OCTSEL = 0; OC2CONbits.OCM = 0b110;
            TRISDbits.TRISD1 = 0;
            break;
        case D38:
            OC3RS = duty; OC3R = duty;
            OC3CONbits.OCTSEL = 0; OC3CONbits.OCM = 0b110;
            TRISDbits.TRISD2 = 0;
            break;
        case D39:
            OC4RS = duty; OC4R = duty;
            OC4CONbits.OCTSEL = 0; OC4CONbits.OCM = 0b110;
            TRISDbits.TRISD3 = 0;
            break;
        case D40:
            OC5RS = duty; OC5R = duty;
            OC5CONbits.OCTSEL = 0; OC5CONbits.OCM = 0b110;
            TRISDbits.TRISD4 = 0;
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

// ── Serial (UART1, RF3=TX/D65, RF2=RX/D64) ───────────────────────────────────
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

// ── Serial2 (UART2, RF5=TX/D67, RF4=RX/D66) ──────────────────────────────────
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

// ── SPI (SPI1, SCK1=RF6/D68, SDI1=RF7/D69, SDO1=RF8/D70) ─────────────────────
static void _spi_begin(void) {
    TRISFbits.TRISF6 = 0; // RF6 = SCK1 output (master)
    TRISFbits.TRISF8 = 0; // RF8 = SDO1 output
    TRISFbits.TRISF7 = 1; // RF7 = SDI1 input

    SPI1CON1bits.MSTEN  = 1;
    SPI1CON1bits.MODE16 = 0;
    SPI1CON1bits.SMP    = 0;
    SPI1CON1bits.CKP    = 0;
    SPI1CON1bits.CKE    = 1;
    SPI1CON1bits.PPRE  = 0b10; // primary prescale 4:1
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

// ── Wire / I2C1 (SCL1=RG2/D75, SDA1=RG3/D76) ─────────────────────────────────
static uint8_t _i2c_rxbuf[8];
static uint8_t _i2c_rxlen = 0, _i2c_rxpos = 0;

static void _i2c_idle(void) {
    while (I2C1CONbits.SEN || I2C1CONbits.RSEN || I2C1CONbits.PEN ||
           I2C1CONbits.RCEN || I2C1CONbits.ACKEN || I2C1STATbits.TRSTAT);
}

static void _wire_begin(void) {
    TRISGbits.TRISG3 = 1; // SDA1
    TRISGbits.TRISG2 = 1; // SCL1
    I2C1BRG = (uint16_t)(FCY / 100000UL) - (uint16_t)(FCY / 1111111UL) - 1; // ~100kHz
    I2C1CONbits.I2CEN = 1;
}

static void _wire_beginTx(uint8_t addr) {
    _i2c_idle();
    I2C1CONbits.SEN = 1;
    while (I2C1CONbits.SEN);
    I2C1TRN = (unsigned int)(addr << 1);
    while (I2C1STATbits.TBF);
    _i2c_idle();
}

static void _wire_write(uint8_t b) {
    I2C1TRN = b;
    while (I2C1STATbits.TBF);
    _i2c_idle();
}

static uint8_t _wire_endTx(void) {
    _i2c_idle();
    I2C1CONbits.PEN = 1;
    while (I2C1CONbits.PEN);
    return 0;
}

static uint8_t _wire_requestFrom(uint8_t addr, uint8_t len) {
    _i2c_rxlen = 0; _i2c_rxpos = 0;
    if (len > sizeof(_i2c_rxbuf)) len = sizeof(_i2c_rxbuf);

    _i2c_idle();
    I2C1CONbits.SEN = 1;
    while (I2C1CONbits.SEN);
    I2C1TRN = (unsigned int)((addr << 1) | 1);
    while (I2C1STATbits.TBF);
    _i2c_idle();

    for (uint8_t i = 0; i < len; i++) {
        I2C1CONbits.RCEN = 1;
        while (I2C1CONbits.RCEN);
        while (!I2C1STATbits.RBF);
        _i2c_rxbuf[i] = (uint8_t)I2C1RCV;
        _i2c_rxlen++;
        I2C1CONbits.ACKDT = (i < (uint8_t)(len - 1)) ? 0 : 1;
        I2C1CONbits.ACKEN = 1;
        while (I2C1CONbits.ACKEN);
    }
    I2C1CONbits.PEN = 1;
    while (I2C1CONbits.PEN);
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
