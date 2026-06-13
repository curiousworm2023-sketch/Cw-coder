#include <xc.h>

// PIC24FJ128GA010 configuration words.
// XC16 v2.10 has no #pragma config database for this part -- use the
// (deprecated but functional) _CONFIG1/_CONFIG2 macros instead.
_CONFIG2(POSCMOD_XT & OSCIOFNC_ON & FCKSM_CSDCMD & FNOSC_PRI & IESO_OFF); // external XT crystal, no PLL, clock switch/monitor off
_CONFIG1(JTAGEN_OFF & GCP_OFF & GWRP_OFF & FWDTEN_OFF & ICS_PGx2);        // JTAG off, no code/write protect, watchdog off

#include "Picpio.h"

int main(void) {
    arduino_init();
    setup();
    while (1) {
        loop();
    }
    return 0;
}
