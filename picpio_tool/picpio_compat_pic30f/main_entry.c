#include <xc.h>

// dsPIC30F configuration words.
// XC16 v2.10 has no #pragma config database for dsPIC30F -- use the
// (deprecated but functional) _FOSC/_FWDT/_FBORPOR/_FGS macros instead.
#if defined(__dsPIC30F3013__) || defined(__dsPIC30F4013__) || defined(__dsPIC30F3014__) || defined(__dsPIC30F2012__) || defined(__dsPIC30F2011__) || defined(__dsPIC30F3012__) || defined(__dsPIC30F6014A__) || defined(__dsPIC30F6013A__) || defined(__dsPIC30F6011A__) || defined(__dsPIC30F6012A__)
// General-purpose parts: FOSC has no separate PRI bit (XT selects the primary
// oscillator on its own) and there is no motor-control PWM, so the
// PWMxL/PWMxH/RST_IOPIN config bits don't exist on these chips.
_FOSC(XT & CSW_FSCM_OFF);                                          // external crystal, no PLL, clock switch/monitor off
_FWDT(WDT_OFF);                                                    // watchdog timer disabled
_FBORPOR(PWRT_OFF & PBOR_OFF & MCLR_EN);                           // power-up timer off, BOR off, MCLR enabled
#if defined(__dsPIC30F6013A__)
_FGS(GWRP_OFF & GSS_OFF);                                          // this part names code-protect GSS_OFF (no CODE_PROT_OFF macro)
#else
_FGS(GWRP_OFF & CODE_PROT_OFF);                                    // no write protect / code protect
#endif
#elif defined(__dsPIC30F6010__) || defined(__dsPIC30F6014__) || defined(__dsPIC30F5011__) || defined(__dsPIC30F6011__) || defined(__dsPIC30F6012__) || defined(__dsPIC30F6013__) || defined(__dsPIC30F5013__)
// Have the PRI oscillator-source bit but no PWMxL_ACT_HI/PWMxH_ACT_HI/RST_IOPIN
// motor-PWM config bits (6010 names its PWM active-level bit RST_PWMPIN; 5011/6011/
// 6012/6013/6014 have no motor PWM at all), so use the plain FBORPOR.
_FOSC(XT & PRI & CSW_FSCM_OFF);                                    // external crystal, no PLL, clock switch/monitor off
_FWDT(WDT_OFF);                                                    // watchdog timer disabled
_FBORPOR(PWRT_OFF & PBOR_OFF & MCLR_EN);                           // power-up timer off, BOR off, MCLR enabled
_FGS(GWRP_OFF & CODE_PROT_OFF);                                    // no write protect / code protect
#elif defined(__dsPIC30F5015__) || defined(__dsPIC30F5016__) || defined(__dsPIC30F3010__) || defined(__dsPIC30F3011__) || defined(__dsPIC30F6015__)
// No PRI oscillator-source bit (XT alone selects the primary oscillator), but
// these ARE motor-control parts with the PWMxL/PWMxH/RST_IOPIN config bits.
_FOSC(XT & CSW_FSCM_OFF);                                          // external crystal, no PLL, clock switch/monitor off
_FWDT(WDT_OFF);                                                    // watchdog timer disabled
_FBORPOR(PWRT_OFF & PBOR_OFF & MCLR_EN & PWMxL_ACT_HI & PWMxH_ACT_HI & RST_IOPIN); // power-up timer off, BOR off, MCLR enabled
// FGS code-protect macro name varies by part: 5015/5016 = GCP_CODE_PROT_OFF,
// 6015 = GSS_OFF, 3010/3011 = CODE_PROT_OFF.
#if defined(__dsPIC30F5015__) || defined(__dsPIC30F5016__)
_FGS(GWRP_OFF & GCP_CODE_PROT_OFF);                               // no write protect / code protect
#elif defined(__dsPIC30F6015__)
_FGS(GWRP_OFF & GSS_OFF);                                          // no write protect / code protect
#else
_FGS(GWRP_OFF & CODE_PROT_OFF);                                   // no write protect / code protect (3010/3011)
#endif
#else
_FOSC(XT & PRI & CSW_FSCM_OFF);                                    // external crystal, no PLL, clock switch/monitor off
_FWDT(WDT_OFF);                                                    // watchdog timer disabled
_FBORPOR(PWRT_OFF & PBOR_OFF & MCLR_EN & PWMxL_ACT_HI & PWMxH_ACT_HI & RST_IOPIN); // power-up timer off, BOR off, MCLR enabled
_FGS(GWRP_OFF & CODE_PROT_OFF);                                    // no write protect / code protect
#endif

#include "Picpio.h"

int main(void) {
    arduino_init();
    init();
    while (1) {
        run();
    }
    return 0;
}
