#include <xc.h>

// dsPIC33EP512MU810 configuration words.
// XC16 v2.10 has no #pragma config database for this part -- use the
// (deprecated but functional) _Fxxx() macros instead.
_FGS(GWRP_OFF & GSS_OFF & GSSK_OFF);                              // no code/segment protect
_FOSCSEL(FNOSC_PRI & IESO_OFF);                                  // primary oscillator, no two-speed start
_FOSC(POSCMD_XT & OSCIOFNC_ON & IOL1WAY_OFF & FCKSM_CSDCMD);     // XT crystal; IOL1WAY_OFF allows PPS unlock
_FWDT(FWDTEN_OFF);                                               // watchdog off
_FPOR(FPWRT_PWR128 & BOREN_ON & ALTI2C2_OFF);                    // I2C2 on default SDA2/SCL2 (RF4/RF5)
_FICD(ICS_PGD2 & JTAGEN_OFF);                                    // PGEC2/PGED2 debug pins, JTAG off

#include "Picpio.h"

int main(void) {
    picpio_init();
    init();
    while (1) {
        run();
    }
    return 0;
}
