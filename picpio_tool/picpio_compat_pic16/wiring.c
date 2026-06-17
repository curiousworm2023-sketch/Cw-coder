#define PICPIO_PIN_ALIASES   // HAL internals reference the native Rxx pin names
#include "Picpio.h"

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

#if defined(_16F628A)
// PIC16F628A: 18-pin, only PORTA/PORTB, no ADC at all.
static const PinInfo _pins[] = {
    { &TRISB, &PORTB, 0, NO_ADC }, // D0  RB0
    { &TRISB, &PORTB, 1, NO_ADC }, // D1  RB1 (USART RX)
    { &TRISB, &PORTB, 2, NO_ADC }, // D2  RB2 (USART TX)
    { &TRISB, &PORTB, 3, NO_ADC }, // D3  RB3 (CCP1/PWM)
    { &TRISB, &PORTB, 4, NO_ADC }, // D4  RB4
    { &TRISB, &PORTB, 5, NO_ADC }, // D5  RB5 (LED)
    { &TRISB, &PORTB, 6, NO_ADC }, // D6  RB6
    { &TRISB, &PORTB, 7, NO_ADC }, // D7  RB7
    { &TRISA, &PORTA, 0, NO_ADC }, // A0  RA0 (Wire SCL)
    { &TRISA, &PORTA, 1, NO_ADC }, // A1  RA1 (Wire SDA)
    { &TRISA, &PORTA, 2, NO_ADC }, // A2  RA2 (SPI SCK)
    { &TRISA, &PORTA, 3, NO_ADC }, // A3  RA3 (SPI MOSI)
    { &TRISA, &PORTA, 4, NO_ADC }, // A4  RA4 (SPI MISO)
};
#define PIN_COUNT 13

#else // classic 28/40-pin PIC16F8xxA (873A/874A/876A/877A)

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
#ifdef PICPIO_HAS_PORTDE
    { &TRISD, &PORTD, 0, NO_ADC }, // D14 RD0
    { &TRISD, &PORTD, 1, NO_ADC }, // D15 RD1
    { &TRISD, &PORTD, 2, NO_ADC }, // D16 RD2
    { &TRISD, &PORTD, 3, NO_ADC }, // D17 RD3
    { &TRISD, &PORTD, 4, NO_ADC }, // D18 RD4
    { &TRISD, &PORTD, 5, NO_ADC }, // D19 RD5
    { &TRISD, &PORTD, 6, NO_ADC }, // D20 RD6
    { &TRISD, &PORTD, 7, NO_ADC }, // D21 RD7
    { &TRISE, &PORTE, 0, 0x05   }, // D22 RE0/AN5
    { &TRISE, &PORTE, 1, 0x06   }, // D23 RE1/AN6
    { &TRISE, &PORTE, 2, 0x07   }, // D24 RE2/AN7
#endif
};
#ifdef PICPIO_HAS_PORTDE
#define PIN_COUNT 31
#else
#define PIN_COUNT 20
#endif

#endif // _16F628A

// ── millis counter (Timer1, 16-bit, Fosc/4, 1:1 prescale) ─────────────────────
#define TMR1_RELOAD (65536UL - (_XTAL_FREQ/4UL/1000UL))

static volatile uint32_t _ms = 0;

// ── Serial ring buffer ────────────────────────────────────────────────────────
#ifdef PICPIO_SMALL_RAM
#define RX_BUF 16
#else
#define RX_BUF 64
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
#if defined(_16F628A)
    CMCON = 0x07;  // disable comparators so RA0-RA3 are plain digital I/O
#else
    ADCON1 = 0x07; // PORTA/PORTE all digital I/O (analogRead switches as needed)
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
#if defined(_16F628A)
// PIC16F628A has no ADC hardware at all.
int analogRead(uint8_t pin) {
    (void)pin;
    return 0;
}
#else
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
#endif

// ── PWM (CCP1) ────────────────────────────────────────────────────────────────
#if defined(_16F628A)
// CCP1 on RB3 = D3
void analogWrite(uint8_t pin, uint8_t duty) {
    if (pin != D3) return;
    if (duty == 0)   { TRISBbits.TRISB3 = 1; return; }
    if (duty == 255) { TRISBbits.TRISB3 = 0; PORTB |= 0x08; return; }
    T2CON   = 0b00000101; // TMR2ON=1, 1:4 prescale
    PR2     = 255;
    CCP1CON = 0b00001100; // CCP1 PWM mode
    CCPR1L  = duty;
    TRISBbits.TRISB3 = 0;
}
#else
// CCP1 on RC2 = D5
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
#endif

// ── Timing ────────────────────────────────────────────────────────────────────
uint32_t millis(void) {
    uint32_t t; INTCONbits.GIE = 0; t = _ms; INTCONbits.GIE = 1; return t;
}
uint32_t micros(void)              { return millis() * 1000UL; }
void delay(uint32_t ms)            { uint32_t s = millis(); while ((millis()-s) < ms); }
void delayMicroseconds(uint32_t us){ while (us--) __delay_us(1); }

// ── Serial (USART) ────────────────────────────────────────────────────────────
#if defined(_16F628A)
// RB2=TX, RB1=RX
static void _serial_begin(uint32_t baud) {
    TRISBbits.TRISB2 = 1;   // TX — peripheral drives the pin regardless of TRIS
    TRISBbits.TRISB1 = 1;   // RX input

    TXSTAbits.BRGH = 1;     // high-speed baud rate generator
    TXSTAbits.SYNC = 0;     // asynchronous mode
    SPBRG = (uint8_t)(_XTAL_FREQ / (16UL * baud) - 1);
    TXSTAbits.TXEN = 1;
    RCSTAbits.SPEN = 1;
    RCSTAbits.CREN = 1;
    PIE1bits.RCIE  = 1;
}
#else
// RC6=TX, RC7=RX
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
#endif

static void _serial_write(uint8_t b) {
    while (!TXSTAbits.TRMT);
    TXREG = b;
}

static void _serial_print_s(const char *s)   { while (*s) _serial_write((uint8_t)*s++); }

static void _serial_print_i(int32_t n) {
    // Avoid sprintf("%ld", ...) here: XC8's doprnt.c reserves an 80-byte
    // static _dbuf for float conversion, which doesn't fit in the 224B RAM
    // of PIC16F628A. A hand-rolled decimal conversion needs no such buffer.
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

#ifndef _16F628A
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
#endif // !_16F628A

// ── PIC16F628A: bit-banged Wire (I2C, SCL=RA0, SDA=RA1) and SPI ──────────────
// PIC16F628A has no MSSP module, so Wire and SPI are software-implemented
// here directly (no separate Wire2/SPI2 — see Picpio.h).
#if defined(_16F628A)
#define WIRE_SCL RA0
#define WIRE_SDA RA1
#define I2C_DELAY() delayMicroseconds(5) // ~100kHz

static uint8_t _i2c_rxbuf[32];
static uint8_t _i2c_rxlen = 0, _i2c_rxpos = 0;

static void _i2c_sda_release(void) { pinMode(WIRE_SDA, INPUT); }
static void _i2c_sda_low(void)     { pinMode(WIRE_SDA, OUTPUT); digitalWrite(WIRE_SDA, LOW); }
static void _i2c_scl_release(void) { pinMode(WIRE_SCL, INPUT); while (!digitalRead(WIRE_SCL)); } // clock stretch
static void _i2c_scl_low(void)     { pinMode(WIRE_SCL, OUTPUT); digitalWrite(WIRE_SCL, LOW); }

static void _i2c_start(void) {
    _i2c_sda_release(); _i2c_scl_release(); I2C_DELAY();
    _i2c_sda_low();      I2C_DELAY();
    _i2c_scl_low();      I2C_DELAY();
}

static void _i2c_stop(void) {
    _i2c_sda_low();     I2C_DELAY();
    _i2c_scl_release(); I2C_DELAY();
    _i2c_sda_release(); I2C_DELAY();
}

static uint8_t _i2c_write_byte(uint8_t b) {
    for (int8_t i = 7; i >= 0; i--) {
        if ((b >> i) & 1) _i2c_sda_release(); else _i2c_sda_low();
        I2C_DELAY();
        _i2c_scl_release(); I2C_DELAY();
        _i2c_scl_low();
    }
    _i2c_sda_release(); I2C_DELAY();
    _i2c_scl_release(); I2C_DELAY();
    uint8_t ack = !digitalRead(WIRE_SDA); // ACK = SDA held low by slave
    _i2c_scl_low();
    return ack;
}

static uint8_t _i2c_read_byte(uint8_t ack) {
    uint8_t b = 0;
    _i2c_sda_release();
    for (uint8_t i = 0; i < 8; i++) {
        _i2c_scl_release(); I2C_DELAY();
        b = (uint8_t)((b << 1) | digitalRead(WIRE_SDA));
        _i2c_scl_low(); I2C_DELAY();
    }
    if (ack) _i2c_sda_low(); else _i2c_sda_release();
    I2C_DELAY();
    _i2c_scl_release(); I2C_DELAY();
    _i2c_scl_low();
    _i2c_sda_release();
    return b;
}

static void _wire_begin(void) {
    _i2c_sda_release();
    _i2c_scl_release();
}

static void _wire_beginTx(uint8_t addr) {
    _i2c_start();
    _i2c_write_byte((uint8_t)(addr << 1));
}

static void _wire_write(uint8_t b) { _i2c_write_byte(b); }

static uint8_t _wire_endTx(void) { _i2c_stop(); return 0; }

static uint8_t _wire_requestFrom(uint8_t addr, uint8_t len) {
    _i2c_rxlen = 0; _i2c_rxpos = 0;
    _i2c_start();
    _i2c_write_byte((uint8_t)((addr << 1) | 1));
    for (uint8_t i = 0; i < len; i++) {
        _i2c_rxbuf[i] = _i2c_read_byte(i < (uint8_t)(len - 1));
        _i2c_rxlen++;
    }
    _i2c_stop();
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

// SPI: SCK=RA2, MOSI=RA3, MISO=RA4
#define SPI_SCK  RA2
#define SPI_MOSI RA3
#define SPI_MISO RA4

static uint8_t _spi_mode = SPI_MODE0;

static void _spi_begin(void) {
    pinMode(SPI_SCK,  OUTPUT);
    pinMode(SPI_MOSI, OUTPUT);
    pinMode(SPI_MISO, INPUT);
    digitalWrite(SPI_SCK, (_spi_mode >> 1) & 1); // idle level = CPOL
}

static uint8_t _spi_transfer(uint8_t b) {
    uint8_t cpol = (_spi_mode >> 1) & 1;
    uint8_t cpha = _spi_mode & 1;
    for (int8_t i = 7; i >= 0; i--) {
        uint8_t outbit = (b >> i) & 1;
        if (cpha == 0) {
            digitalWrite(SPI_MOSI, outbit);
            digitalWrite(SPI_SCK, !cpol);
            b = (uint8_t)((b & ~(1u << i)) | (digitalRead(SPI_MISO) << i));
            digitalWrite(SPI_SCK, cpol);
        } else {
            digitalWrite(SPI_SCK, !cpol);
            digitalWrite(SPI_MOSI, outbit);
            digitalWrite(SPI_SCK, cpol);
            b = (uint8_t)((b & ~(1u << i)) | (digitalRead(SPI_MISO) << i));
        }
    }
    return b;
}

static void _spi_setBitOrder(uint8_t o)  { (void)o; /* MSB-first only */ }
static void _spi_setDataMode(uint8_t m)  { _spi_mode = m; digitalWrite(SPI_SCK, (m >> 1) & 1); }
static void _spi_setClkDiv(uint8_t d)    { (void)d; /* speed is bit-bang loop overhead */ }
static void _spi_end(void) {
    pinMode(SPI_SCK,  INPUT);
    pinMode(SPI_MOSI, INPUT);
}

SPIClass_t SPI = {
    .begin          = _spi_begin,
    .end            = _spi_end,
    .transfer       = _spi_transfer,
    .setBitOrder    = _spi_setBitOrder,
    .setDataMode    = _spi_setDataMode,
    .setClockDivider= _spi_setClkDiv,
};
#endif // _16F628A

#ifndef _16F628A
// ── Serial2 (software UART bit-bang, TX2=RC0, RX2=RC1) ───────────────────────
// Blocking TX/RX — no ISR/ring buffer, so loop() must call Serial2.read()
// promptly after available() to avoid missing the start bit.
#define SERIAL2_TX RC0
#define SERIAL2_RX RC1

static uint32_t _ser2_bit_us;

static void _serial2_begin(uint32_t baud) {
    _ser2_bit_us = 1000000UL / baud;
    pinMode(SERIAL2_TX, OUTPUT);
    digitalWrite(SERIAL2_TX, HIGH); // idle high
    pinMode(SERIAL2_RX, INPUT);
}

static void _serial2_write(uint8_t b) {
    noInterrupts();
    digitalWrite(SERIAL2_TX, LOW);              // start bit
    delayMicroseconds(_ser2_bit_us);
    for (uint8_t i = 0; i < 8; i++) {
        digitalWrite(SERIAL2_TX, (b >> i) & 1); // LSB first
        delayMicroseconds(_ser2_bit_us);
    }
    digitalWrite(SERIAL2_TX, HIGH);             // stop bit
    delayMicroseconds(_ser2_bit_us);
    interrupts();
}

static void _serial2_print_s(const char *s) { while (*s) _serial2_write((uint8_t)*s++); }

static void _serial2_print_i(int32_t n) {
    char buf[12];
    sprintf(buf, "%ld", (long)n);
    _serial2_print_s(buf);
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

static int _serial2_available(void) { return digitalRead(SERIAL2_RX) == LOW ? 1 : 0; }

static int _serial2_read(void) {
    if (digitalRead(SERIAL2_RX) != LOW) return -1; // idle high = no start bit
    noInterrupts();
    delayMicroseconds(_ser2_bit_us + _ser2_bit_us / 2); // skip start bit, center on bit 0
    uint8_t b = 0;
    for (uint8_t i = 0; i < 8; i++) {
        b |= (uint8_t)(digitalRead(SERIAL2_RX) << i); // LSB first
        delayMicroseconds(_ser2_bit_us);
    }
    interrupts();
    return b;
}

static void _serial2_flush(void) { /* writes are blocking — nothing buffered */ }
static void _serial2_end(void) {
    pinMode(SERIAL2_TX, INPUT);
    pinMode(SERIAL2_RX, INPUT);
}

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

// ── Wire2 (software I2C bit-bang, SCL2=RB0, SDA2=RB1) ────────────────────────
// Requires external pull-up resistors (~4.7k) to VCC on both lines.
#define WIRE2_SCL RB0
#define WIRE2_SDA RB1
#define I2C2_DELAY() delayMicroseconds(5) // ~100kHz

static uint8_t _i2c2_rxbuf[32];
static uint8_t _i2c2_rxlen = 0, _i2c2_rxpos = 0;

static void _i2c2_sda_release(void) { pinMode(WIRE2_SDA, INPUT); }
static void _i2c2_sda_low(void)     { pinMode(WIRE2_SDA, OUTPUT); digitalWrite(WIRE2_SDA, LOW); }
static void _i2c2_scl_release(void) { pinMode(WIRE2_SCL, INPUT); while (!digitalRead(WIRE2_SCL)); } // clock stretch
static void _i2c2_scl_low(void)     { pinMode(WIRE2_SCL, OUTPUT); digitalWrite(WIRE2_SCL, LOW); }

static void _i2c2_start(void) {
    _i2c2_sda_release(); _i2c2_scl_release(); I2C2_DELAY();
    _i2c2_sda_low();      I2C2_DELAY();
    _i2c2_scl_low();      I2C2_DELAY();
}

static void _i2c2_stop(void) {
    _i2c2_sda_low();     I2C2_DELAY();
    _i2c2_scl_release(); I2C2_DELAY();
    _i2c2_sda_release(); I2C2_DELAY();
}

static uint8_t _i2c2_write_byte(uint8_t b) {
    for (int8_t i = 7; i >= 0; i--) {
        if ((b >> i) & 1) _i2c2_sda_release(); else _i2c2_sda_low();
        I2C2_DELAY();
        _i2c2_scl_release(); I2C2_DELAY();
        _i2c2_scl_low();
    }
    _i2c2_sda_release(); I2C2_DELAY();
    _i2c2_scl_release(); I2C2_DELAY();
    uint8_t ack = !digitalRead(WIRE2_SDA); // ACK = SDA held low by slave
    _i2c2_scl_low();
    return ack;
}

static uint8_t _i2c2_read_byte(uint8_t ack) {
    uint8_t b = 0;
    _i2c2_sda_release();
    for (uint8_t i = 0; i < 8; i++) {
        _i2c2_scl_release(); I2C2_DELAY();
        b = (uint8_t)((b << 1) | digitalRead(WIRE2_SDA));
        _i2c2_scl_low(); I2C2_DELAY();
    }
    if (ack) _i2c2_sda_low(); else _i2c2_sda_release();
    I2C2_DELAY();
    _i2c2_scl_release(); I2C2_DELAY();
    _i2c2_scl_low();
    _i2c2_sda_release();
    return b;
}

static void _wire2_begin(void) {
    _i2c2_sda_release();
    _i2c2_scl_release();
}

static void _wire2_beginTx(uint8_t addr) {
    _i2c2_start();
    _i2c2_write_byte((uint8_t)(addr << 1));
}

static void _wire2_write(uint8_t b) { _i2c2_write_byte(b); }

static uint8_t _wire2_endTx(void) { _i2c2_stop(); return 0; }

static uint8_t _wire2_requestFrom(uint8_t addr, uint8_t len) {
    _i2c2_rxlen = 0; _i2c2_rxpos = 0;
    _i2c2_start();
    _i2c2_write_byte((uint8_t)((addr << 1) | 1));
    for (uint8_t i = 0; i < len; i++) {
        _i2c2_rxbuf[i] = _i2c2_read_byte(i < (uint8_t)(len - 1));
        _i2c2_rxlen++;
    }
    _i2c2_stop();
    return _i2c2_rxlen;
}

static int _wire2_available(void) { return _i2c2_rxpos < _i2c2_rxlen; }
static int _wire2_read(void)      { return _wire2_available() ? _i2c2_rxbuf[_i2c2_rxpos++] : -1; }

TwoWire_t Wire2 = {
    .begin             = _wire2_begin,
    .beginTransmission = _wire2_beginTx,
    .endTransmission   = _wire2_endTx,
    .requestFrom       = _wire2_requestFrom,
    .write             = _wire2_write,
    .available         = _wire2_available,
    .read              = _wire2_read,
};

// ── SPI2 (software SPI bit-bang, SCK2=RB2, MOSI2=RB3, MISO2=RB4) ─────────────
// No fixed CS pin — drive any free GPIO manually with digitalWrite() around transfer().
#define SPI2_SCK  RB2
#define SPI2_MOSI RB3
#define SPI2_MISO RB4

static uint8_t _spi2_mode = SPI_MODE0;

static void _spi2_begin(void) {
    pinMode(SPI2_SCK,  OUTPUT);
    pinMode(SPI2_MOSI, OUTPUT);
    pinMode(SPI2_MISO, INPUT);
    digitalWrite(SPI2_SCK, (_spi2_mode >> 1) & 1); // idle level = CPOL
}

static uint8_t _spi2_transfer(uint8_t b) {
    uint8_t cpol = (_spi2_mode >> 1) & 1;
    uint8_t cpha = _spi2_mode & 1;
    for (int8_t i = 7; i >= 0; i--) {
        uint8_t outbit = (b >> i) & 1;
        if (cpha == 0) {
            digitalWrite(SPI2_MOSI, outbit);
            digitalWrite(SPI2_SCK, !cpol);
            b = (uint8_t)((b & ~(1u << i)) | (digitalRead(SPI2_MISO) << i));
            digitalWrite(SPI2_SCK, cpol);
        } else {
            digitalWrite(SPI2_SCK, !cpol);
            digitalWrite(SPI2_MOSI, outbit);
            digitalWrite(SPI2_SCK, cpol);
            b = (uint8_t)((b & ~(1u << i)) | (digitalRead(SPI2_MISO) << i));
        }
    }
    return b;
}

static void _spi2_setBitOrder(uint8_t o)  { (void)o; /* MSB-first only */ }
static void _spi2_setDataMode(uint8_t m)  { _spi2_mode = m; digitalWrite(SPI2_SCK, (m >> 1) & 1); }
static void _spi2_setClkDiv(uint8_t d)    { (void)d; /* speed is bit-bang loop overhead */ }
static void _spi2_end(void) {
    pinMode(SPI2_SCK,  INPUT);
    pinMode(SPI2_MOSI, INPUT);
}

SPIClass_t SPI2 = {
    .begin          = _spi2_begin,
    .end            = _spi2_end,
    .transfer       = _spi2_transfer,
    .setBitOrder    = _spi2_setBitOrder,
    .setDataMode    = _spi2_setDataMode,
    .setClockDivider= _spi2_setClkDiv,
};
#endif // !_16F628A
