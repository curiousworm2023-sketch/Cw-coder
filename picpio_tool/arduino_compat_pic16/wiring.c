#include "Arduino.h"

// ── Pin map ───────────────────────────────────────────────────────────────────
// Classic PIC16F8xx (e.g. PIC16F877A) has no LATx (latch) registers — writes
// go straight to PORTx — and no per-pin ANSELx/WPUx registers, so this table
// is simpler than the PIC18F/enhanced-midrange variant.
typedef struct {
    volatile unsigned char *tris;
    volatile unsigned char *port;
    uint8_t bit;
    uint8_t adc_ch; // ADCON0 CHS value, or NO_ADC
} PinInfo;

#define NO_ADC 0xFF

static const PinInfo _pins[] = {
    { &TRISC, &PORTC, 0, NO_ADC }, // D0  RC0
    { &TRISC, &PORTC, 1, NO_ADC }, // D1  RC1
    { &TRISC, &PORTC, 2, NO_ADC }, // D2  RC2 (CCP1/PWM)
    { &TRISC, &PORTC, 3, NO_ADC }, // D3  RC3 (SCK/SCL)
    { &TRISC, &PORTC, 4, NO_ADC }, // D4  RC4 (SDI/SDA)
    { &TRISC, &PORTC, 5, NO_ADC }, // D5  RC5 (SDO)
    { &TRISC, &PORTC, 6, NO_ADC }, // D6  RC6 (TX)
    { &TRISC, &PORTC, 7, NO_ADC }, // D7  RC7 (RX)
    { &TRISB, &PORTB, 0, NO_ADC }, // D8  RB0
    { &TRISB, &PORTB, 1, NO_ADC }, // D9  RB1
    { &TRISB, &PORTB, 2, NO_ADC }, // D10 RB2
    { &TRISB, &PORTB, 3, NO_ADC }, // D11 RB3
    { &TRISB, &PORTB, 4, NO_ADC }, // D12 RB4
    { &TRISB, &PORTB, 5, NO_ADC }, // D13 RB5 (LED)
    { &TRISA, &PORTA, 0, 0x00   }, // A0  RA0/AN0
    { &TRISA, &PORTA, 1, 0x01   }, // A1  RA1/AN1
    { &TRISA, &PORTA, 2, 0x02   }, // A2  RA2/AN2
    { &TRISA, &PORTA, 3, 0x03   }, // A3  RA3/AN3
    { &TRISA, &PORTA, 4, NO_ADC }, // A4  RA4 (open-drain, no ADC)
    { &TRISA, &PORTA, 5, 0x04   }, // A5  RA5/AN4
};
#define PIN_COUNT 20

// ── millis counter (Timer1, 16-bit, Fosc/4, 1:1 prescale) ─────────────────────
#define TMR1_RELOAD (65536UL - (_XTAL_FREQ/4UL/1000UL))

static volatile uint32_t _ms = 0;

// ── Serial ring buffer ────────────────────────────────────────────────────────
#define RX_BUF 64
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

// ── arduino_init ──────────────────────────────────────────────────────────────
void arduino_init(void) {
    ADCON1 = 0x07; // PORTA/PORTE all digital I/O (analogRead switches as needed)

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
    if (mode == OUTPUT) {
        *p->tris &= ~mask;
    } else if (mode == INPUT_PULLUP) {
        *p->tris |= mask;
        // PORTB pull-ups are enabled globally via OPTION_REG<RBPU> (active low)
        if (p->port == &PORTB) OPTION_REG &= 0x7F;
    } else {
        *p->tris |= mask;
    }
}

void digitalWrite(uint8_t pin, uint8_t val) {
    if (pin >= PIN_COUNT) return;
    const PinInfo *p = &_pins[pin];
    uint8_t mask = (uint8_t)(1u << p->bit);
    if (val) *p->port |=  mask;
    else     *p->port &= ~mask;
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
    *p->tris |= (uint8_t)(1u << p->bit);

    uint8_t saved_adcon1 = ADCON1;
    ADCON1 = 0x80;                                  // ADFM=1 (right justify), PCFG=0000 (AN0-AN7 analog)
    ADCON0 = (uint8_t)(0x80 | (p->adc_ch << 3) | 0x01); // ADCS=Fosc/32, select channel, ADON=1
    __delay_us(20);                                 // acquisition time
    ADCON0bits.GO_nDONE = 1;
    while (ADCON0bits.GO_nDONE);
    int result = (int)(((uint16_t)ADRESH << 8) | ADRESL);
    ADCON0 = 0x00;                                  // ADON off
    ADCON1 = saved_adcon1;
    return result;
}

// ── PWM (CCP1 on RC2 = D5) ───────────────────────────────────────────────────
void analogWrite(uint8_t pin, uint8_t duty) {
    if (pin != D5) return;
    if (duty == 0)   { TRISCbits.TRISC2 = 1; return; }
    if (duty == 255) { TRISCbits.TRISC2 = 0; PORTC |= 0x04; return; }
    T2CON   = 0b00000101; // TMR2ON=1, 1:4 prescale
    PR2     = 255;
    CCP1CON = 0b00001100; // CCP1 PWM mode
    CCPR1L  = duty;
    TRISCbits.TRISC2 = 0;
}

// ── Timing ────────────────────────────────────────────────────────────────────
uint32_t millis(void) {
    uint32_t t; INTCONbits.GIE = 0; t = _ms; INTCONbits.GIE = 1; return t;
}
uint32_t micros(void)              { return millis() * 1000UL; }
void delay(uint32_t ms)            { uint32_t s = millis(); while ((millis()-s) < ms); }
void delayMicroseconds(uint32_t us){ while (us--) __delay_us(1); }

// ── Serial (USART, RC6=TX, RC7=RX) ───────────────────────────────────────────
static void _serial_begin(uint32_t baud) {
    TRISCbits.TRISC6 = 1;   // TX — peripheral drives the pin regardless of TRIS
    TRISCbits.TRISC7 = 1;   // RX input

    TXSTAbits.BRGH = 1;     // high-speed baud rate generator
    TXSTAbits.SYNC = 0;     // asynchronous mode
    SPBRG = (uint8_t)(_XTAL_FREQ / (16UL * baud) - 1);
    TXSTAbits.TXEN = 1;
    RCSTAbits.SPEN = 1;
    RCSTAbits.CREN = 1;
    PIE1bits.RCIE  = 1;
}

static void _serial_write(uint8_t b) {
    while (!TXSTAbits.TRMT);
    TXREG = b;
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
static void _serial_flush(void) { while (!TXSTAbits.TRMT); }
static void _serial_end(void)   { RCSTA = 0x00; TXSTA = 0x00; }

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

// ── Wire / I2C (MSSP as I2C Master, RC3=SCL, RC4=SDA) ────────────────────────
static uint8_t _i2c_rxbuf[32];
static uint8_t _i2c_rxlen = 0, _i2c_rxpos = 0;

static void _ssp_wait(void) { while (!PIR1bits.SSPIF) {} PIR1bits.SSPIF = 0; }

static void _wire_begin(void) {
    TRISCbits.TRISC3 = 1; // SCL
    TRISCbits.TRISC4 = 1; // SDA
    SSPSTAT = 0x80;       // SMP=1, slew rate disabled (100kHz)
    SSPCON  = 0x28;       // SSPEN=1, SSPM=1000 (I2C Master, Fosc/(4*(ADD+1)))
    SSPCON2 = 0x00;
    SSPADD  = (uint8_t)(_XTAL_FREQ / (4UL * 100000UL) - 1); // 100kHz
}

static void _wire_beginTx(uint8_t addr) {
    SSPCON2bits.SEN = 1;
    _ssp_wait();
    SSPBUF = (uint8_t)(addr << 1);
    _ssp_wait();
}

static void _wire_write(uint8_t b) {
    SSPBUF = b;
    _ssp_wait();
}

static uint8_t _wire_endTx(void) {
    SSPCON2bits.PEN = 1;
    _ssp_wait();
    return 0;
}

static uint8_t _wire_requestFrom(uint8_t addr, uint8_t len) {
    _i2c_rxlen = 0; _i2c_rxpos = 0;
    SSPCON2bits.SEN = 1;
    _ssp_wait();
    SSPBUF = (uint8_t)((addr << 1) | 1);
    _ssp_wait();
    for (uint8_t i = 0; i < len; i++) {
        SSPCON2bits.RCEN = 1;
        _ssp_wait();
        _i2c_rxbuf[i] = SSPBUF;
        _i2c_rxlen++;
        SSPCON2bits.ACKDT = (i < (uint8_t)(len - 1)) ? 0 : 1;
        SSPCON2bits.ACKEN = 1;
        _ssp_wait();
    }
    SSPCON2bits.PEN = 1;
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

// ── SPI (MSSP as SPI Master, RC3=SCK, RC5=SDO, RC4=SDI) ──────────────────────
// NOTE: MSSP is shared with Wire — do not use SPI and Wire simultaneously
static void _spi_begin(void) {
    TRISCbits.TRISC3 = 0; // SCK output
    TRISCbits.TRISC5 = 0; // SDO output
    TRISCbits.TRISC4 = 1; // SDI input
    SSPSTAT = 0x40;       // CKE=1 (Mode 0 default)
    SSPCON  = 0x20;       // SSPEN=1, SSPM=0000 (SPI Master, Fosc/4)
}

static uint8_t _spi_transfer(uint8_t b) {
    PIR1bits.SSPIF = 0;
    SSPBUF = b;
    while (!PIR1bits.SSPIF);
    PIR1bits.SSPIF = 0;
    return SSPBUF;
}

static void _spi_setBitOrder(uint8_t o)  { (void)o; /* MSSP has no bit order control */ }
static void _spi_setDataMode(uint8_t m)  {
    SSPCONbits.CKP  = (m >> 1) & 1;
    SSPSTATbits.CKE = !(m & 1);
}
static void _spi_setClkDiv(uint8_t d) {
    uint8_t sspm = (d <= 4) ? 0 : (d <= 16) ? 1 : 2;
    SSPCON = (SSPCON & 0xE0) | sspm;
}
static void _spi_end(void) { SSPCONbits.SSPEN = 0; }

SPIClass_t SPI = {
    .begin          = _spi_begin,
    .end            = _spi_end,
    .transfer       = _spi_transfer,
    .setBitOrder    = _spi_setBitOrder,
    .setDataMode    = _spi_setDataMode,
    .setClockDivider= _spi_setClkDiv,
};
