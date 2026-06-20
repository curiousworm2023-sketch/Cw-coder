// DWIN.h — PICPIO C driver for DWIN serial TFT displays
// Uses HardwareSerial (Serial) for communication with DWIN displays.
//
// Usage:
//   #include "DWIN.h"
//   DWIN_t dwin;
//   void init() {
//       Serial.begin(115200);
//       DWIN_init(&dwin);
//   }
//   void run() {
//       DWIN_setText(&dwin, 1, 1, "Hello");
//   }

#ifndef DWIN_H
#define DWIN_H

#include "Picpio.h"

#define DWIN_HEADER_H  0x5A
#define DWIN_HEADER_L  0xA5

// DWIN command types
#define DWIN_CMD_WRITE_VAR     0x80
#define DWIN_CMD_WRITE_REG     0x81
#define DWIN_CMD_READ_VAR      0x82
#define DWIN_CMD_READ_REG      0x83
#define DWIN_CMD_WRITE_CURVE   0x84
#define DWIN_CMD_WRITE_TEXT    0x85
#define DWIN_CMD_READ_TEXT     0x86

typedef struct {
    HardwareSerial_t* serial;
} DWIN_t;

void DWIN_init(DWIN_t *dev);
void DWIN_setText(DWIN_t *dev, uint8_t page, uint8_t widget, const char *text);
void DWIN_setValue(DWIN_t *dev, uint16_t addr, uint32_t value);
void DWIN_setIcon(DWIN_t *dev, uint8_t page, uint8_t widget, uint8_t icon);

#endif // DWIN_H