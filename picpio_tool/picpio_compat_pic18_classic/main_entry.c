#include <xc.h>
// Classic PIC18F4550/452/2550 configuration.
// PIC18F452 has its own config-word layout: OSC (not FOSC), STVR (not
// STVREN), and no MCLRE/XINST/USB bits at all (POR defaults apply).
#if defined(_18F452)
#pragma config OSC    = HS
#pragma config WDT    = OFF
#pragma config PWRT   = OFF
#pragma config LVP    = OFF
#pragma config DEBUG  = OFF
#pragma config CPD    = OFF
#pragma config STVR   = OFF
#else
#pragma config FOSC   = HS
#pragma config WDT    = OFF
#pragma config PWRT   = OFF
#pragma config LVP    = OFF
#pragma config DEBUG  = OFF
#pragma config CPD    = OFF
#pragma config STVREN = OFF
#pragma config MCLRE  = ON
#pragma config XINST  = OFF
#endif

#include "Picpio.h"

void main(void) {
    arduino_init();
    setup();
    while (1) {
        loop();
    }
}
