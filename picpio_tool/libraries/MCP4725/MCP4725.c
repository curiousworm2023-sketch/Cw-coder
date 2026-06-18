// MCP4725.c — see MCP4725.h
#include "MCP4725.h"

void mcp4725_begin(mcp4725_t *dev, uint8_t addr) { dev->address = addr; }

// Fast-write command: two bytes, PD bits = 00 (normal). value is 12-bit.
void mcp4725_setValue(mcp4725_t *dev, uint16_t value) {
    value &= 0x0FFF;
    i2c1.beginTransmission(dev->address);
    i2c1.write((uint8_t)(value >> 8));     // 0b0000 xxxx : C2=C1=0 (fast), PD=00, D11-D8
    i2c1.write((uint8_t)(value & 0xFF));   // D7-D0
    i2c1.endTransmission();
}

// "Write DAC and EEPROM" command (0x60): the value also becomes the power-on
// default. value is 12-bit, left-justified into the two data bytes.
void mcp4725_setValueEEPROM(mcp4725_t *dev, uint16_t value) {
    value &= 0x0FFF;
    i2c1.beginTransmission(dev->address);
    i2c1.write(0x60);                              // write DAC register + EEPROM, PD=00
    i2c1.write((uint8_t)(value >> 4));             // D11-D4
    i2c1.write((uint8_t)((value & 0x0F) << 4));    // D3-D0 in the high nibble
    i2c1.endTransmission();
    sys_delay(50);                                 // EEPROM write time
}
