#include <xc.h>
// Classic PIC16F8xxA configuration — 14-bit core (no internal oscillator)
#pragma config FOSC = HS    // HS oscillator (4-20MHz crystal/resonator)
#pragma config WDTE = OFF
#pragma config PWRTE = OFF
#pragma config BOREN = ON
#pragma config LVP   = OFF
#pragma config CPD   = OFF
// PIC16F628A has no WRT config bit (unlike 873A/874A/876A/877A) — only set
// it on chips that have it.
#if !defined(_16F628A)
#pragma config WRT   = OFF
#endif
#pragma config CP    = OFF
// PIC16F628A has an MCLRE config bit (873A/874A/876A/877A do not) — keep
// RA5 as the MCLR pin.
#if defined(_16F628A)
#pragma config MCLRE = ON
#endif

#include "Picpio.h"

void main(void) {
    picpio_init();
    init();
    while (1) {
        run();
    }
}
