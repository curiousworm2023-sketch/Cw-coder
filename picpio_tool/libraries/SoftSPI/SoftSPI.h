#ifndef SOFTSPI_H
#define SOFTSPI_H

#include <Picpio.h>

// Bit-banged SPI master on plain GPIO — for boards whose hardware MSSP/SPI is
// dead or unreliable. Instance-based: pass a SoftSPI_t* so several buses can
// coexist on different pins. All four SPI modes, MSB- or LSB-first.
//
// Speed: with the portable gpio_ calls below this runs a few hundred kHz up to
// ~1 MHz (halfDelayUs = 0). Set halfDelayUs > 0 to slow the clock for slow
// slaves. PORTABILITY vs SPEED: gpio_write/gpio_read work on every PIC family
// but cost ~1-2 us each. For maximum clock on ONE known chip, replace the
// gpio_write(s->sck,…)/gpio_read(s->miso) calls in SoftSPI.c with direct
// LATxbits/PORTxbits access (e.g. LATCbits.LATC5 = 1;).
//
// CS may be 0xFF ("no CS pin") if you drive chip-select yourself.

typedef struct {
    uint8_t sck;          // clock  (output)
    uint8_t mosi;         // master-out (output)
    uint8_t miso;         // master-in  (input)
    uint8_t cs;           // chip-select (output, active low); 0xFF = none
    uint8_t mode;         // 0..3
    uint8_t msbFirst;     // 1 = MSB first (usual), 0 = LSB first
    uint8_t halfDelayUs;  // half-clock delay; 0 = fastest
    uint8_t cpol;         // derived: SCK idle level
    uint8_t cpha;         // derived: sample edge (0 = leading, 1 = trailing)
} SoftSPI_t;

// Configure an instance. mode 0..3 sets CPOL/CPHA. msbFirst: 1 or 0.
// halfDelayUs: 0 for fastest, or microseconds of half-clock delay for slow parts.
void softspi_init(SoftSPI_t *s, uint8_t sck, uint8_t mosi, uint8_t miso, uint8_t cs,
                  uint8_t mode, uint8_t msbFirst, uint8_t halfDelayUs);

// Set pin directions and park SCK at its idle level (per CPOL) and CS high.
// Call once in init() after softspi_init().
void softspi_begin(SoftSPI_t *s);

// Full-duplex: shift one byte out on MOSI while reading one byte from MISO.
uint8_t softspi_transfer(SoftSPI_t *s, uint8_t out);

// In-place block transfer: each byte of buf is sent and replaced by the byte
// read back. len bytes.
void softspi_transfer_block(SoftSPI_t *s, uint8_t *buf, uint16_t len);

// Assert / de-assert the (active-low) chip-select. No-ops if cs == 0xFF.
void softspi_select(SoftSPI_t *s);
void softspi_deselect(SoftSPI_t *s);

#endif // SOFTSPI_H
