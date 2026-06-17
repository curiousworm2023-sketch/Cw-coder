#include <xc.h>
// PIC16F1829 configuration — enhanced midrange, internal oscillator + 4xPLL (32MHz)
#pragma config FOSC     = INTOSC
#pragma config WDTE     = OFF
#pragma config PWRTE    = OFF
#pragma config MCLRE    = OFF
#pragma config CP       = OFF
#pragma config CPD      = OFF
#pragma config BOREN    = ON
#pragma config CLKOUTEN = OFF
#pragma config IESO     = OFF
#pragma config FCMEN    = OFF
#pragma config WRT      = OFF
#pragma config STVREN   = ON
#pragma config BORV     = LO
#pragma config LVP      = OFF

#include "Picpio.h"

void main(void) {
    arduino_init();
    init();
    while (1) {
        run();
    }
}
