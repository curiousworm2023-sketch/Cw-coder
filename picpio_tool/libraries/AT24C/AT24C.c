// AT24C.c — I2C EEPROM driver (see AT24C.h).
#include "AT24C.h"

#define AT24C_RX_CHUNK   32     // Wire HAL RX buffer size
#define AT24C_WRITE_MS   5      // max write-cycle time for 24LCxx

static void at24c_sendAddr(AT24C_t *dev, uint32_t addr) {
    Wire.beginTransmission(dev->addr);
    if (dev->twoByte) Wire.write((uint8_t)(addr >> 8));
    Wire.write((uint8_t)(addr & 0xFF));
}

void AT24C_init(AT24C_t *dev, uint8_t i2cAddr, uint32_t sizeBytes, uint16_t pageSize) {
    dev->addr     = i2cAddr;
    dev->size     = sizeBytes;
    dev->pageSize = pageSize ? pageSize : 16;
    dev->twoByte  = (sizeBytes > 256) ? 1 : 0;
}

uint8_t AT24C_begin(AT24C_t *dev) {
    (void)AT24C_readByte(dev, 0);
    return 1;
}

uint8_t AT24C_write(AT24C_t *dev, uint32_t addr, const void *data, uint16_t len) {
    const uint8_t *p = (const uint8_t *)data;
    uint16_t done = 0;
    while (done < len) {
        if (addr >= dev->size) break;                    // past end
        // bytes left in the current physical page
        uint16_t pageRoom = (uint16_t)(dev->pageSize - (addr % dev->pageSize));
        uint16_t n = (uint16_t)(len - done);
        if (n > pageRoom) n = pageRoom;
        if (addr + n > dev->size) n = (uint16_t)(dev->size - addr);

        at24c_sendAddr(dev, addr);
        uint16_t i;
        for (i = 0; i < n; i++) Wire.write(p[done + i]);
        Wire.endTransmission();
        delay(AT24C_WRITE_MS);                           // wait write cycle

        addr += n; done += n;
    }
    return (done == len);
}

uint8_t AT24C_read(AT24C_t *dev, uint32_t addr, void *data, uint16_t len) {
    uint8_t *p = (uint8_t *)data;
    uint16_t done = 0;
    while (done < len) {
        if (addr >= dev->size) break;
        uint16_t n = (uint16_t)(len - done);
        if (n > AT24C_RX_CHUNK) n = AT24C_RX_CHUNK;
        if (addr + n > dev->size) n = (uint16_t)(dev->size - addr);

        at24c_sendAddr(dev, addr);
        Wire.endTransmission();                          // set the address pointer
        Wire.requestFrom(dev->addr, (uint8_t)n);
        uint16_t i;
        for (i = 0; i < n; i++) {
            int b = Wire.read();
            p[done + i] = (uint8_t)(b < 0 ? 0xFF : b);
        }
        addr += n; done += n;
    }
    return (done == len);
}

uint8_t AT24C_writeByte(AT24C_t *dev, uint32_t addr, uint8_t val) {
    return AT24C_write(dev, addr, &val, 1);
}

uint8_t AT24C_readByte(AT24C_t *dev, uint32_t addr) {
    uint8_t v = 0xFF;
    AT24C_read(dev, addr, &v, 1);
    return v;
}
