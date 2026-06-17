#include <xc.h>
// PIC18F K40/Q10 family configuration — valid settings for these chips
#pragma config FEXTOSC = OFF
#pragma config RSTOSC  = HFINTOSC_64MHZ
#pragma config WDTE    = OFF
#pragma config MCLRE   = EXTMCLR
#pragma config PWRTE   = OFF
// Q10 devices have no DEBUG config bit (ICSP debug is controlled elsewhere) —
// only set it on K40 parts, which do have this bit.
#if defined(_18F24K40) || defined(_18F25K40) || defined(_18F26K40) || defined(_18F27K40) || \
    defined(_18F45K40) || defined(_18F46K40) || defined(_18F47K40)
#pragma config DEBUG   = OFF
#endif
#pragma config XINST   = OFF
#pragma config WDTCPS  = WDTCPS_31
#pragma config WDTCWS  = WDTCWS_7
#pragma config LVP     = ON

#include "Picpio.h"

void main(void) {
    arduino_init();
    init();
    while (1) {
        run();
    }
}
