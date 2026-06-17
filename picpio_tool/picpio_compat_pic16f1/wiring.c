#define PICPIO_PIN_ALIASES   // HAL internals reference the native Rxx pin names
#include "Picpio.h"

// ── Pin map ───────────────────────────────────────────────────────────────────
// PIC16F1829/1826/1827/1823/1824/1825 are enhanced midrange (have LATx/
// ANSELx/WPUx like K40) but have NO PPS — peripherals are on fixed pins
// (1826/1827 have a split APFCON0/APFCON1 register; 1823/1824/1825 have a
// single APFCON0 register with the same bit layout — see picpio_init()) —
// and the ADC selects channels via ADCON0.CHS<4:0> (no ADPCH/PCFG).
typedef struct {
    volatile unsigned char *tris;
    volatile unsigned char *lat;
    volatile unsigned char *port;
    volatile unsigned char *ansel;
    volatile unsigned char *wpu;
    uint8_t bit;
    uint8_t adc_ch;
} PinInfo;

#define NO_ADC 0xFF

#if defined(_16F1826) || defined(_16F1827)
static const PinInfo _pins[] = {
    { &TRISB, &LATB, &PORTB, NULL,    &WPUB, 0, NO_ADC }, // D0  RB0 (T1G/INT/FLT0)
    { &TRISB, &LATB, &PORTB, &ANSELB, &WPUB, 1, 11     }, // D1  RB1/AN11 (SSP1 SDA/SDI, Serial RX)
    { &TRISB, &LATB, &PORTB, &ANSELB, &WPUB, 2, 10     }, // D2  RB2/AN10 (Serial TX, fixed)
    { &TRISB, &LATB, &PORTB, &ANSELB, &WPUB, 3, 9      }, // D3  RB3/AN9 (CCP1/PWM)
    { &TRISB, &LATB, &PORTB, &ANSELB, &WPUB, 4, 8      }, // D4  RB4/AN8 (SSP1 SCL/SCK)
    { &TRISB, &LATB, &PORTB, &ANSELB, &WPUB, 5, 7      }, // D5  RB5/AN7
    { &TRISB, &LATB, &PORTB, &ANSELB, &WPUB, 6, 5      }, // D6  RB6/AN5 (T1OSI)
    { &TRISB, &LATB, &PORTB, &ANSELB, &WPUB, 7, 6      }, // D7  RB7/AN6 (T1OSO)
    { &TRISA, &LATA, &PORTA, &ANSELA, NULL,  2, 2      }, // D8  RA2/AN2
    { &TRISA, &LATA, &PORTA, &ANSELA, NULL,  3, 3      }, // D9  RA3/AN3
    { &TRISA, &LATA, &PORTA, &ANSELA, NULL,  4, 4      }, // D10 RA4/AN4
    { &TRISA, &LATA, &PORTA, NULL,    &WPUA, 5, NO_ADC }, // D11 RA5 (MCLR-shared, input-only, MCLRE=OFF)
    { &TRISA, &LATA, &PORTA, NULL,    NULL,  6, NO_ADC }, // D12 RA6 (OSC2-shared; SPI SDO1 via SDO1SEL=1)
    { &TRISA, &LATA, &PORTA, NULL,    NULL,  7, NO_ADC }, // D13 RA7 (OSC1-shared, LED)
    { &TRISA, &LATA, &PORTA, &ANSELA, NULL,  0, 0      }, // A0  RA0/AN0
    { &TRISA, &LATA, &PORTA, &ANSELA, NULL,  1, 1      }, // A1  RA1/AN1
};
#define PIN_COUNT 16
#elif defined(_16F1823) || defined(_16F1824) || defined(_16F1825)
static const PinInfo _pins[] = {
    { &TRISC, &LATC, &PORTC, &ANSELC, &WPUC, 0, 4      }, // D0  RC0/AN4 (SSP1 SCL1/SCK1, fixed)
    { &TRISC, &LATC, &PORTC, &ANSELC, &WPUC, 1, 5      }, // D1  RC1/AN5 (SSP1 SDA1/SDI1, fixed)
    { &TRISC, &LATC, &PORTC, &ANSELC, &WPUC, 2, 6      }, // D2  RC2/AN6 (SPI SDO1, default)
    { &TRISC, &LATC, &PORTC, &ANSELC, &WPUC, 3, 7      }, // D3  RC3/AN7 (SPI SS, default)
    { &TRISC, &LATC, &PORTC, NULL,    &WPUC, 4, NO_ADC }, // D4  RC4 (Serial TX, default)
    { &TRISC, &LATC, &PORTC, NULL,    &WPUC, 5, NO_ADC }, // D5  RC5 (CCP1/PWM)
    { &TRISA, &LATA, &PORTA, &ANSELA, &WPUA, 0, 0      }, // D6  RA0/AN0
    { &TRISA, &LATA, &PORTA, &ANSELA, &WPUA, 1, 1      }, // D7  RA1/AN1 (Serial RX via RXDTSEL=1)
    { &TRISA, &LATA, &PORTA, &ANSELA, &WPUA, 2, 2      }, // D8  RA2/AN2
    { &TRISA, &LATA, &PORTA, NULL,    &WPUA, 3, NO_ADC }, // D9  RA3 (MCLR-shared, input-only, MCLRE=OFF)
    { &TRISA, &LATA, &PORTA, &ANSELA, &WPUA, 4, 3      }, // D10 RA4/AN3 (OSC2-shared)
    { &TRISA, &LATA, &PORTA, NULL,    &WPUA, 5, NO_ADC }, // D11 RA5 (OSC1-shared, LED)
};
#define PIN_COUNT 12
#else
static const PinInfo _pins[] = {
    { &TRISC, &LATC, &PORTC, &ANSELC, NULL,  0, 4      }, // D0  RC0/AN4
    { &TRISC, &LATC, &PORTC, &ANSELC, NULL,  1, 5      }, // D1  RC1/AN5
    { &TRISC, &LATC, &PORTC, &ANSELC, NULL,  2, 6      }, // D2  RC2/AN6
    { &TRISC, &LATC, &PORTC, &ANSELC, NULL,  3, 7      }, // D3  RC3/AN7 (CCP2 alt)
    { &TRISC, &LATC, &PORTC, &ANSELC, NULL,  4, NO_ADC }, // D4  RC4 (USART TX)
    { &TRISC, &LATC, &PORTC, &ANSELC, NULL,  5, NO_ADC }, // D5  RC5 (USART RX, CCP1/PWM)
    { &TRISC, &LATC, &PORTC, &ANSELC, NULL,  6, 8      }, // D6  RC6/AN8
    { &TRISC, &LATC, &PORTC, &ANSELC, NULL,  7, 9      }, // D7  RC7/AN9 (SSP1 SDO)
    { &TRISB, &LATB, &PORTB, &ANSELB, &WPUB, 4, 10     }, // D8  RB4/AN10 (SSP1 SDA/SDI)
    { &TRISB, &LATB, &PORTB, &ANSELB, &WPUB, 5, 11     }, // D9  RB5/AN11
    { &TRISB, &LATB, &PORTB, &ANSELB, &WPUB, 6, NO_ADC }, // D10 RB6 (SSP1 SCL/SCK)
    { &TRISB, &LATB, &PORTB, NULL,    &WPUB, 7, NO_ADC }, // D11 RB7
    { &TRISA, &LATA, &PORTA, NULL,    NULL,  3, NO_ADC }, // D12 RA3 (input-only, MCLRE=OFF)
    { &TRISA, &LATA, &PORTA, &ANSELA, &WPUA, 5, NO_ADC }, // D13 RA5 (LED)
    { &TRISA, &LATA, &PORTA, &ANSELA, &WPUA, 0, 0      }, // A0  RA0/AN0
    { &TRISA, &LATA, &PORTA, &ANSELA, &WPUA, 1, 1      }, // A1  RA1/AN1
    { &TRISA, &LATA, &PORTA, &ANSELA, &WPUA, 2, 2      }, // A2  RA2/AN2 (CCP3 alt)
    { &TRISA, &LATA, &PORTA, &ANSELA, &WPUA, 4, 3      }, // A3  RA4/AN3 (T1G alt)
};
#define PIN_COUNT 18
#endif

// ── millis counter (Timer1, 16-bit, Fosc/4, 1:1 prescale) ─────────────────────
#define TMR1_RELOAD (65536UL - (_XTAL_FREQ/4UL/1000UL))

static volatile uint32_t _ms = 0;

// ── Serial ring buffer ────────────────────────────────────────────────────────
// Sized to fit available RAM: 1823=128B, 1824/1826=256B, 1827=384B, 1825/1829=1024B
#if defined(_16F1823)
#define RX_BUF 8
#elif defined(_16F1826) || defined(_16F1827) || defined(_16F1824)
#define RX_BUF 16
#else
#define RX_BUF 64
#endif

// ── I2C receive buffer (sized with the same RAM tiers as RX_BUF above) ────────
#if defined(_16F1823)
#define I2C_RXBUF_SIZE 4
#elif defined(_16F1826) || defined(_16F1827) || defined(_16F1824)
#define I2C_RXBUF_SIZE 8
#else
#define I2C_RXBUF_SIZE 32
#endif

static volatile uint8_t _rxbuf[RX_BUF];
static volatile uint8_t _rxhead = 0, _rxtail = 0;

// ── ISR: Timer1 millis + USART RX ring buffer ─────────────────────────────────
void __interrupt() ISR(void) {
    if (PIR1bits.TMR1IF && PIE1bits.TMR1IE) {
        TMR1H = (uint8_t)(TMR1_RELOAD >> 8);
        TMR1L = (uint8_t)(TMR1_RELOAD & 0xFF);
        _ms++;
        PIR1bits.TMR1IF = 0;
    }
    if (PIR1bits.RCIF && PIE1bits.RCIE) {
        if (RCSTAbits.OERR) { RCSTAbits.CREN = 0; RCSTAbits.CREN = 1; }
        uint8_t b = RCREG;
        uint8_t next = (_rxhead + 1) & (RX_BUF - 1);
        if (next != _rxtail) { _rxbuf[_rxhead] = b; _rxhead = next; }
    }
}

// ── picpio_init ──────────────────────────────────────────────────────────────
void picpio_init(void) {
    // 32MHz: 8MHz HFINTOSC (IRCF=1110) x 4 software PLL (SPLLEN=1)
    OSCCON = 0xF0;

#if defined(_16F1826) || defined(_16F1827)
    ANSELA = 0x00; ANSELB = 0x00;
    WPUA   = 0x00; WPUB   = 0x00;

    // Relocate EUSART RX/TX and SPI SDO1 so Serial, I2C and SPI don't share pins:
    //   RX -> RB2 (D2), TX -> RB5 (D5), SPI SDO1 -> RA6 (D12)
    APFCON0bits.RXDTSEL = 1;
    APFCON0bits.SDO1SEL = 1;
    APFCON1bits.TXCKSEL = 1;
#elif defined(_16F1823) || defined(_16F1824) || defined(_16F1825)
    ANSELA = 0x00; ANSELC = 0x00;
    WPUA   = 0x00; WPUC   = 0x00;

    // Relocate EUSART RX off RC5 (shared with CCP1/P1A) onto RA1 (D7).
    // TX (RC4/D4), SPI SDO1 (RC2/D2) and SS (RC3/D3) stay at POR defaults.
    APFCON0bits.RXDTSEL = 1;
#else
    ANSELA = 0x00; ANSELB = 0x00; ANSELC = 0x00;
    WPUA   = 0x00; WPUB   = 0x00;
#endif

    T1CON = 0x01;  // TMR1ON=1, 1:1 prescale, internal clock (Fosc/4)
    TMR1H = (uint8_t)(TMR1_RELOAD >> 8);
    TMR1L = (uint8_t)(TMR1_RELOAD & 0xFF);
    PIE1bits.TMR1IE = 1;
    INTCONbits.PEIE = 1;
    INTCONbits.GIE  = 1;
}

// ── Digital ───────────────────────────────────────────────────────────────────
void pinMode(uint8_t pin, uint8_t mode) {
    if (pin >= PIN_COUNT) return;
    const PinInfo *p = &_pins[pin];
    uint8_t mask = (uint8_t)(1u << p->bit);
    if (p->ansel) *p->ansel &= ~mask;
    if (mode == OUTPUT) {
        *p->tris &= ~mask;
    } else if (mode == INPUT_PULLUP) {
        *p->tris |= mask;
        if (p->wpu) *p->wpu |= mask;
    } else {
        *p->tris |= mask;
    }
}

void digitalWrite(uint8_t pin, uint8_t val) {
    if (pin >= PIN_COUNT) return;
    const PinInfo *p = &_pins[pin];
    uint8_t mask = (uint8_t)(1u << p->bit);
    if (val) *p->lat |=  mask;
    else     *p->lat &= ~mask;
}

int digitalRead(uint8_t pin) {
    if (pin >= PIN_COUNT) return 0;
    const PinInfo *p = &_pins[pin];
    return (*p->port >> p->bit) & 1;
}

// ── Analog ────────────────────────────────────────────────────────────────────
int analogRead(uint8_t pin) {
    if (pin >= PIN_COUNT) return 0;
    const PinInfo *p = &_pins[pin];
    if (p->adc_ch == NO_ADC) return 0;
    if (p->ansel) *p->ansel |= (uint8_t)(1u << p->bit);
    *p->tris |= (uint8_t)(1u << p->bit);
    ADCON1 = 0xE0;                                       // ADFM=1 (right justify), ADCS=110 (Fosc/64)
    ADCON0 = (uint8_t)((p->adc_ch << 2) | 0x01);         // CHS=channel, ADON=1
    __delay_us(5);
    ADCON0bits.GO_nDONE = 1;
    while (ADCON0bits.GO_nDONE);
    int result = (int)(((uint16_t)ADRESH << 8) | ADRESL);
    ADCON0bits.ADON = 0;
    return result;
}

#if defined(_16F1826) || defined(_16F1827)
// ── PWM (CCP1 on RB3 = D3, Timer2) ───────────────────────────────────────────
void analogWrite(uint8_t pin, uint8_t duty) {
    if (pin != D3) return;
    if (duty == 0)   { TRISBbits.TRISB3 = 1; return; }
    if (duty == 255) { TRISBbits.TRISB3 = 0; LATBbits.LATB3 = 1; return; }
    T2CON   = 0b00000101; // TMR2ON=1, 1:4 prescale
    PR2     = 255;
    CCP1CON = 0b00001100; // CCP1 PWM mode
    CCPR1L  = duty;
    TRISBbits.TRISB3 = 0;
}
#else
// ── PWM (CCP1 on RC5 = D5, Timer2) ───────────────────────────────────────────
void analogWrite(uint8_t pin, uint8_t duty) {
    if (pin != D5) return;
    if (duty == 0)   { TRISCbits.TRISC5 = 1; return; }
    if (duty == 255) { TRISCbits.TRISC5 = 0; LATCbits.LATC5 = 1; return; }
    T2CON   = 0b00000101; // TMR2ON=1, 1:4 prescale
    PR2     = 255;
    CCP1CON = 0b00001100; // CCP1 PWM mode
    CCPR1L  = duty;
    TRISCbits.TRISC5 = 0;
}
#endif

// ── Timing ────────────────────────────────────────────────────────────────────
uint32_t millis(void) {
    uint32_t t; INTCONbits.GIE = 0; t = _ms; INTCONbits.GIE = 1; return t;
}
uint32_t micros(void)              { return millis() * 1000UL; }
void delay(uint32_t ms)            { uint32_t s = millis(); while ((millis()-s) < ms); }
void delayMicroseconds(uint32_t us){ while (us--) __delay_us(1); }

#if defined(_16F1826) || defined(_16F1827)
// ── Serial (EUSART, RB5=TX via TXCKSEL=1, RB2=RX via RXDTSEL=1) ──────────────
static void _serial_begin(uint32_t baud) {
    TRISBbits.TRISB5 = 1;   // TX — peripheral drives the pin regardless of TRIS
    TRISBbits.TRISB2 = 1;   // RX input

    BAUDCONbits.BRG16 = 1;
#elif defined(_16F1823) || defined(_16F1824) || defined(_16F1825)
// ── Serial (EUSART, RC4=TX (default), RA1=RX via RXDTSEL=1) ──────────────────
static void _serial_begin(uint32_t baud) {
    TRISCbits.TRISC4 = 1;   // TX — peripheral drives the pin regardless of TRIS
    TRISAbits.TRISA1 = 1;   // RX input

    BAUDCONbits.BRG16 = 1;
#else
// ── Serial (EUSART, RC4=TX, RC5=RX) ──────────────────────────────────────────
static void _serial_begin(uint32_t baud) {
    TRISCbits.TRISC4 = 1;   // TX — peripheral drives the pin regardless of TRIS
    TRISCbits.TRISC5 = 1;   // RX input

    BAUDCONbits.BRG16 = 1;
#endif
    uint16_t brg = (uint16_t)(_XTAL_FREQ / (4UL * baud) - 1);
    SPBRGH = (uint8_t)(brg >> 8);
    SPBRGL = (uint8_t)(brg);
    TXSTA  = 0b00100100; // BRGH=1, TXEN=1, SYNC=0
    RCSTA  = 0b10010000; // SPEN=1, CREN=1
    PIE1bits.RCIE = 1;
}

static void _serial_write(uint8_t b) {
    while (!TXSTAbits.TRMT);
    TXREG = b;
}

static void _serial_print_s(const char *s)   { while (*s) _serial_write((uint8_t)*s++); }

// print_i/print_f (and the println_* variants below) pull in sprintf's
// ~32-byte _dbuf, which doesn't fit on PIC16F1823's 128-byte RAM — omitted
// for that chip (see HardwareSerial_t in Picpio.h).
#ifndef _16F1823
static void _serial_print_i(int32_t n) {
    char buf[12];
    sprintf(buf, "%ld", (long)n);
    _serial_print_s(buf);
}

// Formats without sprintf's "%f" — XC8's floating-point printf support pulls
// in several KB of code, which doesn't fit on the smaller-flash 16F1 parts.
static void _serial_print_f(float f, uint8_t dec) {
    char buf[20];
    if (dec == 0) { sprintf(buf, "%ld", (long)f); _serial_print_s(buf); return; }
    if (dec > 3) dec = 3;

    uint8_t neg = (f < 0);
    if (neg) f = -f;

    long whole = (long)f;
    float frac = f - (float)whole;

    uint16_t scale = 1;
    for (uint8_t i = 0; i < dec; i++) scale *= 10;

    uint16_t fracInt = (uint16_t)(frac * (float)scale + 0.5f);
    if (fracInt >= scale) { fracInt -= scale; whole++; }

    switch (dec) {
        case 1: sprintf(buf, "%s%ld.%01u", neg ? "-" : "", whole, fracInt); break;
        case 2: sprintf(buf, "%s%ld.%02u", neg ? "-" : "", whole, fracInt); break;
        default: sprintf(buf, "%s%ld.%03u", neg ? "-" : "", whole, fracInt); break;
    }
    _serial_print_s(buf);
}
#endif // !_16F1823

static void _serial_println_s(const char *s) { _serial_print_s(s); _serial_write('\r'); _serial_write('\n'); }
#ifndef _16F1823
static void _serial_println_i(int32_t n)     { _serial_print_i(n); _serial_write('\r'); _serial_write('\n'); }
static void _serial_println_f(float f, uint8_t dec) { _serial_print_f(f, dec); _serial_write('\r'); _serial_write('\n'); }
#endif // !_16F1823
static int  _serial_available(void) { return (_rxhead != _rxtail) ? 1 : 0; }
static int  _serial_read(void) {
    if (_rxhead == _rxtail) return -1;
    uint8_t b = _rxbuf[_rxtail];
    _rxtail = (_rxtail + 1) & (RX_BUF - 1);
    return b;
}
static void _serial_flush(void) { while (!TXSTAbits.TRMT); }
static void _serial_end(void)   { RCSTA = 0x00; TXSTA = 0x00; }

#ifdef _16F1823
HardwareSerial_t Serial = {
    .begin     = _serial_begin,
    .end       = _serial_end,
    .print     = _serial_print_s,
    .println   = _serial_println_s,
    .print_s   = _serial_print_s,
    .println_s = _serial_println_s,
    .write     = _serial_write,
    .available = _serial_available,
    .read      = _serial_read,
    .flush     = _serial_flush,
};
#else
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
#endif // _16F1823

// PIC16F1823 has only 128 bytes of RAM, which can't accommodate the
// always-instantiated Wire/SPI structs (~32 bytes) on top of Serial and its
// sprintf buffers — Wire and SPI are omitted entirely for this chip (see
// Picpio.h).
#ifndef _16F1823

static uint8_t _i2c_rxbuf[I2C_RXBUF_SIZE];
static uint8_t _i2c_rxlen = 0, _i2c_rxpos = 0;

static void _ssp_wait(void) { while (!SSP1IF) {} SSP1IF = 0; }

#if defined(_16F1826) || defined(_16F1827)
// ── Wire / I2C (SSP1 as I2C Master, RB4=SCL1, RB1=SDA1, both fixed) ──────────
static void _wire_begin(void) {
    TRISBbits.TRISB4 = 1; // SCL1
    TRISBbits.TRISB1 = 1; // SDA1
    SSP1STAT = 0x80;      // SMP=1, slew rate disabled (100kHz)
#elif defined(_16F1824) || defined(_16F1825)
// ── Wire / I2C (SSP1 as I2C Master, RC0=SCL1/SCK1, RC1=SDA1/SDI1, both fixed) ─
static void _wire_begin(void) {
    TRISCbits.TRISC0 = 1; // SCL1
    TRISCbits.TRISC1 = 1; // SDA1
    SSP1STAT = 0x80;      // SMP=1, slew rate disabled (100kHz)
#else
// ── Wire / I2C (SSP1 as I2C Master, RB6=SCL, RB4=SDA) ────────────────────────
static void _wire_begin(void) {
    TRISBbits.TRISB6 = 1; // SCL
    TRISBbits.TRISB4 = 1; // SDA
    SSP1STAT = 0x80;      // SMP=1, slew rate disabled (100kHz)
#endif
    SSP1CON1 = 0x28;      // SSPEN=1, SSPM=1000 (I2C Master, Fosc/(4*(ADD+1)))
    SSP1CON2 = 0x00;
    SSP1ADD  = (uint8_t)(_XTAL_FREQ / (4UL * 100000UL) - 1); // 100kHz
}

static void _wire_beginTx(uint8_t addr) {
    SSP1CON2bits.SEN = 1;
    _ssp_wait();
    SSP1BUF = (uint8_t)(addr << 1);
    _ssp_wait();
}

static void _wire_write(uint8_t b) {
    SSP1BUF = b;
    _ssp_wait();
}

static uint8_t _wire_endTx(void) {
    SSP1CON2bits.PEN = 1;
    _ssp_wait();
    return 0;
}

static uint8_t _wire_requestFrom(uint8_t addr, uint8_t len) {
    _i2c_rxlen = 0; _i2c_rxpos = 0;
    SSP1CON2bits.SEN = 1;
    _ssp_wait();
    SSP1BUF = (uint8_t)((addr << 1) | 1);
    _ssp_wait();
    for (uint8_t i = 0; i < len; i++) {
        SSP1CON2bits.RCEN = 1;
        _ssp_wait();
        _i2c_rxbuf[i] = SSP1BUF;
        _i2c_rxlen++;
        SSP1CON2bits.ACKDT = (i < (uint8_t)(len - 1)) ? 0 : 1;
        SSP1CON2bits.ACKEN = 1;
        _ssp_wait();
    }
    SSP1CON2bits.PEN = 1;
    _ssp_wait();
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

#if defined(_16F1826) || defined(_16F1827)
// ── SPI (SSP1 as SPI Master, RB4=SCK1, RA6=SDO1/MOSI via SDO1SEL=1, RB1=SDI1/MISO) ─
// NOTE: SSP1 is shared with Wire — do not use SPI and Wire simultaneously
static void _spi_begin(void) {
    TRISBbits.TRISB4 = 0; // SCK1 output
    TRISAbits.TRISA6 = 0; // SDO1 output (relocated to RA6 via SDO1SEL=1)
    TRISBbits.TRISB1 = 1; // SDI1 input
    SSP1STAT = 0x40;      // CKE=1 (Mode 0 default)
    SSP1CON1 = 0x20;      // SSPEN=1, SSPM=0000 (SPI Master, Fosc/4)
}
#elif defined(_16F1824) || defined(_16F1825)
// ── SPI (SSP1 as SPI Master, RC0=SCK1, RC2=SDO1/MOSI (default), RC1=SDI1/MISO) ─
// NOTE: SSP1 is shared with Wire — do not use SPI and Wire simultaneously
static void _spi_begin(void) {
    TRISCbits.TRISC0 = 0; // SCK1 output
    TRISCbits.TRISC2 = 0; // SDO1 output
    TRISCbits.TRISC1 = 1; // SDI1 input
    SSP1STAT = 0x40;      // CKE=1 (Mode 0 default)
    SSP1CON1 = 0x20;      // SSPEN=1, SSPM=0000 (SPI Master, Fosc/4)
}
#else
// ── SPI (SSP1 as SPI Master, RB6=SCK, RC7=SDO/MOSI, RB4=SDI/MISO) ────────────
// NOTE: SSP1 is shared with Wire — do not use SPI and Wire simultaneously
static void _spi_begin(void) {
    TRISBbits.TRISB6 = 0; // SCK output
    TRISCbits.TRISC7 = 0; // SDO output
    TRISBbits.TRISB4 = 1; // SDI input
    SSP1STAT = 0x40;      // CKE=1 (Mode 0 default)
    SSP1CON1 = 0x20;      // SSPEN=1, SSPM=0000 (SPI Master, Fosc/4)
}
#endif

static uint8_t _spi_transfer(uint8_t b) {
    SSP1IF  = 0;
    SSP1BUF = b;
    while (!SSP1IF);
    SSP1IF = 0;
    return SSP1BUF;
}

static void _spi_setBitOrder(uint8_t o)  { (void)o; /* MSSP has no bit order control */ }
static void _spi_setDataMode(uint8_t m)  {
    SSP1CON1bits.CKP = (m >> 1) & 1;
    SSP1STATbits.CKE = !(m & 1);
}
static void _spi_setClkDiv(uint8_t d) {
    uint8_t sspm = (d <= 4) ? 0 : (d <= 16) ? 1 : 2;
    SSP1CON1 = (SSP1CON1 & 0xE0) | sspm;
}
static void _spi_end(void) { SSP1CON1bits.SSPEN = 0; }

SPIClass_t SPI = {
    .begin          = _spi_begin,
    .end            = _spi_end,
    .transfer       = _spi_transfer,
    .setBitOrder    = _spi_setBitOrder,
    .setDataMode    = _spi_setDataMode,
    .setClockDivider= _spi_setClkDiv,
};

#endif // !_16F1823
