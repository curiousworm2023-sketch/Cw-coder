#include <xc.h>

// dsPIC30F4011 configuration words.
// XC16 v2.10 has no #pragma config database for dsPIC30F -- use the
// (deprecated but functional) _FOSC/_FWDT/_FBORPOR/_FGS macros instead.
_FOSC(XT & PRI & CSW_FSCM_OFF);                                    // external crystal, no PLL, clock switch/monitor off
_FWDT(WDT_OFF);                                                    // watchdog timer disabled
_FBORPOR(PWRT_OFF & PBOR_OFF & MCLR_EN & PWMxL_ACT_HI & PWMxH_ACT_HI & RST_IOPIN); // power-up timer off, BOR off, MCLR enabled
_FGS(GWRP_OFF & CODE_PROT_OFF);                                    // no write protect / code protect

#include "Picpio.h"

int main(void) {
    arduino_init();
    setup();
    while (1) {
        loop();
    }
    return 0;
}
