#include <xc.h>
// PIC16F877A configuration — classic 14-bit core (no internal oscillator)
#pragma config FOSC = HS    // HS oscillator (4-20MHz crystal/resonator)
#pragma config WDTE = OFF
#pragma config PWRTE = OFF
#pragma config BOREN = ON
#pragma config LVP   = OFF
#pragma config CPD   = OFF
#pragma config WRT   = OFF
#pragma config CP    = OFF

#include "Arduino.h"

void main(void) {
    arduino_init();
    setup();
    while (1) {
        loop();
    }
}
