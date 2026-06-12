#include <xc.h>
// PIC18F27K40 configuration — valid settings for this chip
#pragma config FEXTOSC = OFF
#pragma config RSTOSC  = HFINTOSC_64MHZ
#pragma config WDTE    = OFF
#pragma config MCLRE   = EXTMCLR
#pragma config PWRTE   = OFF
#pragma config DEBUG   = OFF
#pragma config XINST   = OFF
#pragma config WDTCPS  = WDTCPS_31
#pragma config WDTCWS  = WDTCWS_7
#pragma config LVP     = ON

#include "Picpio.h"

void main(void) {
    arduino_init();
    setup();
    while (1) {
        loop();
    }
}
