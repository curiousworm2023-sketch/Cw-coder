// DWIN.c — PICPIO C driver for DWIN serial TFT displays
#include "DWIN.h"

static uint8_t dwin_crc(uint8_t *data, uint8_t len) {
    uint8_t crc = 0;
    for (uint8_t i = 0; i < len; i++) {
        crc += data[i];
    }
    return crc;
}

void DWIN_init(DWIN_t *dev) {
    dev->serial = &Serial;
}

// Write text to a text widget (page, widget)
void DWIN_setText(DWIN_t *dev, uint8_t page, uint8_t widget, const char *text) {
    uint8_t len = 0;
    while (text[len] && len < 50) len++;
    
    uint8_t buf[60];
    uint8_t idx = 0;
    buf[idx++] = DWIN_HEADER_H;
    buf[idx++] = DWIN_HEADER_L;
    buf[idx++] = DWIN_CMD_WRITE_TEXT;
    buf[idx++] = page;
    buf[idx++] = widget;
    buf[idx++] = len;
    
    for (uint8_t i = 0; i < len; i++) {
        buf[idx++] = (uint8_t)text[i];
    }
    
    buf[idx++] = dwin_crc(buf + 2, idx - 2);
    buf[idx++] = 0xFF;
    
    for (uint8_t i = 0; i < idx; i++) {
        dev->serial->write(buf[i]);
    }
}

// Write a 32-bit value to a variable address
void DWIN_setValue(DWIN_t *dev, uint16_t addr, uint32_t value) {
    uint8_t buf[12];
    uint8_t idx = 0;
    buf[idx++] = DWIN_HEADER_H;
    buf[idx++] = DWIN_HEADER_L;
    buf[idx++] = DWIN_CMD_WRITE_VAR;
    buf[idx++] = addr >> 8;
    buf[idx++] = addr & 0xFF;
    buf[idx++] = value >> 24;
    buf[idx++] = value >> 16;
    buf[idx++] = value >> 8;
    buf[idx++] = value & 0xFF;
    
    buf[idx++] = dwin_crc(buf + 2, idx - 2);
    buf[idx++] = 0xFF;
    
    for (uint8_t i = 0; i < idx; i++) {
        dev->serial->write(buf[i]);
    }
}