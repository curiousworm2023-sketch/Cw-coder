#include "Picpio.h"

// ── Pin map ───────────────────────────────────────────────────────────────────
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

static const PinInfo _pins[] = {
    { &TRISC, &LATC, &PORTC, NULL,   NULL,  0, NO_ADC }, // D0  RC0
    { &TRISC, &LATC, &PORTC, NULL,   NULL,  1, NO_ADC }, // D1  RC1
    { &TRISC, &LATC, &PORTC, NULL,   NULL,  2, NO_ADC }, // D2  RC2
    { &TRISC, &LATC, &PORTC, NULL,   NULL,  3, NO_ADC }, // D3  RC3 (SCL)
    { &TRISC, &LATC, &PORTC, NULL,   NULL,  4, NO_ADC }, // D4  RC4 (SDA)
    { &TRISC, &LATC, &PORTC, NULL,   NULL,  5, NO_ADC }, // D5  RC5 (PWM)
    { &TRISC, &LATC, &PORTC, NULL,   NULL,  6, NO_ADC }, // D6  RC6 (TX)
    { &TRISC, &LATC, &PORTC, NULL,   NULL,  7, NO_ADC }, // D7  RC7 (RX)
    { &TRISB, &LATB, &PORTB, NULL,   &WPUB, 0, NO_ADC }, // D8  RB0
    { &TRISB, &LATB, &PORTB, NULL,   &WPUB, 1, NO_ADC }, // D9  RB1
    { &TRISB, &LATB, &PORTB, NULL,   &WPUB, 2, NO_ADC }, // D10 RB2
    { &TRISB, &LATB, &PORTB, NULL,   &WPUB, 3, NO_ADC }, // D11 RB3
    { &TRISB, &LATB, &PORTB, NULL,   &WPUB, 4, NO_ADC }, // D12 RB4
    { &TRISB, &LATB, &PORTB, NULL,   &WPUB, 5, NO_ADC }, // D13 RB5 (LED)
    { &TRISA, &LATA, &PORTA, &ANSELA, NULL, 0, 0x00   }, // A0  RA0
    { &TRISA, &LATA, &PORTA, &ANSELA, NULL, 1, 0x01   }, // A1  RA1
    { &TRISA, &LATA, &PORTA, &ANSELA, NULL, 2, 0x02   }, // A2  RA2
    { &TRISA, &LATA, &PORTA, &ANSELA, NULL, 3, 0x03   }, // A3  RA3
    { &TRISA, &LATA, &PORTA, NULL,    NULL, 4, NO_ADC }, // A4  RA4 (no ADC)
    { &TRISA, &LATA, &PORTA, &ANSELA, NULL, 5, 0x04   }, // A5  RA5
#ifdef PICPIO_HAS_PORTDE
    { &TRISD, &LATD, &PORTD, &ANSELD, &WPUD, 0, NO_ADC }, // D14 RD0
    { &TRISD, &LATD, &PORTD, &ANSELD, &WPUD, 1, NO_ADC }, // D15 RD1
    { &TRISD, &LATD, &PORTD, &ANSELD, &WPUD, 2, NO_ADC }, // D16 RD2
    { &TRISD, &LATD, &PORTD, &ANSELD, &WPUD, 3, NO_ADC }, // D17 RD3
    { &TRISD, &LATD, &PORTD, &ANSELD, &WPUD, 4, NO_ADC }, // D18 RD4
    { &TRISD, &LATD, &PORTD, &ANSELD, &WPUD, 5, NO_ADC }, // D19 RD5
    { &TRISD, &LATD, &PORTD, &ANSELD, &WPUD, 6, NO_ADC }, // D20 RD6
    { &TRISD, &LATD, &PORTD, &ANSELD, &WPUD, 7, NO_ADC }, // D21 RD7
    { &TRISE, &LATE, &PORTE, &ANSELE, &WPUE, 0, NO_ADC }, // D22 RE0
    { &TRISE, &LATE, &PORTE, &ANSELE, &WPUE, 1, NO_ADC }, // D23 RE1
    { &TRISE, &LATE, &PORTE, &ANSELE, &WPUE, 2, NO_ADC }, // D24 RE2
#endif
};
#ifdef PICPIO_HAS_PORTDE
#define PIN_COUNT 31
#else
#define PIN_COUNT 20
#endif

// ── millis counter ────────────────────────────────────────────────────────────
static volatile uint32_t _ms = 0;

// ── Serial ring buffer ────────────────────────────────────────────────────────
#define RX_BUF 64
static volatile uint8_t _rxbuf[RX_BUF];
static volatile uint8_t _rxhead = 0, _rxtail = 0;

// ── ISR: Timer0 millis + EUSART1 RX ring buffer ───────────────────────────────
void __interrupt(high_priority) ISR_High(void) {
    if (TMR0IF && TMR0IE) {
        TMR0H = 0xFC; TMR0L = 0x18;
        _ms++;
        TMR0IF = 0;
    }
    if (RC1IF && RC1IE) {
        if (RC1STAbits.OERR) { RC1STAbits.CREN = 0; RC1STAbits.CREN = 1; }
        uint8_t b = RC1REG;
        uint8_t next = (_rxhead + 1) & (RX_BUF - 1);
        if (next != _rxtail) { _rxbuf[_rxhead] = b; _rxhead = next; }
    }
}

// ── arduino_init ──────────────────────────────────────────────────────────────
void arduino_init(void) {
    ANSELA = 0x00; ANSELB = 0x00; ANSELC = 0x00;
    WPUB   = 0x00;
#ifdef PICPIO_HAS_PORTDE
    ANSELD = 0x00; ANSELE = 0x00;
    WPUD   = 0x00; WPUE   = 0x00;
#endif

    // Timer0: Fosc/4, 1:16 prescaler → 1MHz timer → reload 0xFC18 for 1ms
    T0CON1 = 0b01000100;
    TMR0H  = 0xFC; TMR0L = 0x18;
    T0CON0 = 0b10000000;
    TMR0IE = 1;
    GIE    = 1;
    PEIE   = 1;
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
    ADCON0  = 0x00;
    ADCON1  = 0b00100000;
    ADCON2  = 0x00;
    ADPCH   = p->adc_ch;
    ADCON0bits.ADON = 1;
    __delay_us(10);
    ADCON0bits.GO = 1;
    while (ADCON0bits.GO);
    int result = (int)(((uint16_t)ADRESH << 8) | ADRESL) >> 2;
    ADCON0bits.ADON = 0;
    return result;
}

// ── PWM (CCP1 on RC2 = D5) ───────────────────────────────────────────────────
void analogWrite(uint8_t pin, uint8_t duty) {
    if (pin != D5) return;
    if (duty == 0)   { TRISCbits.TRISC2 = 1; return; }
    if (duty == 255) { TRISCbits.TRISC2 = 0; LATCbits.LATC2 = 1; return; }
    T2CON   = 0b00000101;
    PR2     = 255;
    CCP1CON = 0b00001100;
    RC2PPS  = 0x09;
    CCPR1L  = duty;
    TRISCbits.TRISC2 = 0;
}

// ── Timing ────────────────────────────────────────────────────────────────────
uint32_t millis(void) {
    uint32_t t; GIE = 0; t = _ms; GIE = 1; return t;
}
uint32_t micros(void)              { return millis() * 1000UL; }
void delay(uint32_t ms)            { uint32_t s = millis(); while ((millis()-s) < ms); }
void delayMicroseconds(uint32_t us){ while (us--) __delay_us(1); }

// ── Serial (EUSART1, RC6=TX, RC7=RX) ─────────────────────────────────────────
static void _serial_begin(uint32_t baud) {
    // PPS: route EUSART1 TX output to RC6, route RC7 to RX input
    RC6PPS  = 0x09;          // TX1 → RC6
    RXPPS   = 0x17;          // RC7 → RX1
    TRISCbits.TRISC6 = 0;   // TX output
    TRISCbits.TRISC7 = 1;   // RX input

    BAUD1CON = 0x08;         // BRG16=1
    uint16_t brg = (uint16_t)(_XTAL_FREQ / (4UL * baud) - 1);
    SPBRGH1 = (uint8_t)(brg >> 8);
    SPBRG1  = (uint8_t)(brg);
    TX1STA  = 0b00100100;    // BRGH=1, TXEN=1, SYNC=0
    RC1STA  = 0b10010000;    // SPEN=1, CREN=1
    RC1IE   = 1;
}

static void _serial_write(uint8_t b) {
    while (!TX1STAbits.TRMT);
    TX1REG = b;
}

static void _serial_print_s(const char *s)   { while (*s) _serial_write((uint8_t)*s++); }

static void _serial_print_i(int32_t n) {
    char buf[12];
    sprintf(buf, "%ld", (long)n);
    _serial_print_s(buf);
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
static int  _serial_available(void) { return (_rxhead != _rxtail) ? 1 : 0; }
static int  _serial_read(void) {
    if (_rxhead == _rxtail) return -1;
    uint8_t b = _rxbuf[_rxtail];
    _rxtail = (_rxtail + 1) & (RX_BUF - 1);
    return b;
}
static void _serial_flush(void) { while (!TX1STAbits.TRMT); }
static void _serial_end(void)   { RC1STA = 0x00; TX1STA = 0x00; }

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

// ── Wire / I2C (SSP1 as I2C Master, RC3=SCL, RC4=SDA) ────────────────────────
static uint8_t _i2c_rxbuf[32];
static uint8_t _i2c_rxlen = 0, _i2c_rxpos = 0;

static void _ssp_wait(void) { while (!SSP1IF) {} SSP1IF = 0; }

static void _wire_begin(void) {
    RC3PPS      = 0x0F;   // SSP1SCK/SCL → RC3
    RC4PPS      = 0x10;   // SSP1SDA/SDO → RC4
    SSP1CLKPPS  = 0x13;   // RC3 → SSP1 CLK input
    SSP1DATPPS  = 0x14;   // RC4 → SSP1 DAT input
    TRISCbits.TRISC3 = 1;
    TRISCbits.TRISC4 = 1;
    SSP1STAT = 0x80;      // SMP=1, slew rate disabled (100kHz)
    SSP1CON1 = 0x28;      // SSPEN=1, SSPM=1000 (I2C Master Fosc/(4*(ADD+1)))
    SSP1CON2 = 0x00;
    SSP1ADD  = 159;       // 100kHz @ 64MHz: 64M/(4*100k)-1=159
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

// ── SPI (SSP1 as SPI Master, RC3=SCK, RC5=MOSI, RC4=MISO) ───────────────────
// NOTE: SSP1 is shared with Wire — do not use SPI and Wire simultaneously
static void _spi_begin(void) {
    RC3PPS      = 0x0F;   // SCK1 → RC3
    RC5PPS      = 0x10;   // SDO1/MOSI → RC5
    SSP1DATPPS  = 0x14;   // RC4 → SDI1/MISO input
    TRISCbits.TRISC3 = 0;
    TRISCbits.TRISC5 = 0;
    TRISCbits.TRISC4 = 1;
    SSP1STAT = 0x40;      // CKE=1 (Mode 0 default)
    SSP1CON1 = 0x20;      // SSPEN=1, SSPM=0000 (SPI Master Fosc/4)
}

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
