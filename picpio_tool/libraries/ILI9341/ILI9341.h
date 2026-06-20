// ILI9341.h — PICPIO C driver for the ILI9341 240x320 / 240x240 / 320x240 SPI TFT display
// Works with SPI interface (CS, DC, RST pins). Uses 16-bit RGB565 color.
//
// Usage:
//   #include "ILI9341.h"
//   ILI9341_t tft;
//   void init() {
//       SPI.begin();
//       ILI9341_init(&tft, D10, D9, D8); // CS, DC, RST
//       ILI9341_begin(&tft, 240, 320);
//       ILI9341_fillScreen(&tft, ILI9341_BLACK);
//   }

#ifndef ILI9341_H
#define ILI9341_H

#include "Picpio.h"

// Color definitions (RGB565)
#define ILI9341_BLACK       0x0000
#define ILI9341_BLUE        0x001F
#define ILI9341_RED         0xF800
#define ILI9341_GREEN       0x07E0
#define ILI9341_CYAN        0x07FF
#define ILI9341_MAGENTA     0xF81F
#define ILI9341_YELLOW      0xFFE0
#define ILI9341_WHITE       0xFFFF

// ILI9341 commands (for LVGL port)
#define ILI9341_SWRESET   0x01
#define ILI9341_SLPOUT    0x11
#define ILI9341_CASET     0x2A
#define ILI9341_RASET     0x2B
#define ILI9341_RAMWR    0x2C
#define ILI9341_RAMRD    0x2E
#define ILI9341_MADCTL   0x36
#define ILI9341_COLMOD  0x3A

typedef struct {
    uint8_t  cs, dc, rst;
    uint16_t width, height;
    uint8_t  rotation;
    int16_t  cursorX, cursorY;
    uint16_t textSize;
    uint16_t textColor;
} ILI9341_t;

// Initialize the display struct (call before begin)
void ILI9341_init(ILI9341_t *dev, uint8_t cs, uint8_t dc, uint8_t rst);

// Initialize and configure the display (call after SPI.begin())
// Returns true if the display responds correctly.
bool ILI9341_begin(ILI9341_t *dev, uint16_t width, uint16_t height);

// Basic drawing
void ILI9341_fillScreen(ILI9341_t *dev, uint16_t color);
void ILI9341_drawPixel(ILI9341_t *dev, int16_t x, int16_t y, uint16_t color);
void ILI9341_drawLine(ILI9341_t *dev, int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color);
void ILI9341_drawRect(ILI9341_t *dev, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
void ILI9341_fillRect(ILI9341_t *dev, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
void ILI9341_drawCircle(ILI9341_t *dev, int16_t x0, int16_t y0, int16_t r, uint16_t color);
void ILI9341_fillCircle(ILI9341_t *dev, int16_t x0, int16_t y0, int16_t r, uint16_t color);

// Text rendering
void ILI9341_setTextColor(ILI9341_t *dev, uint16_t color);
void ILI9341_setTextSize(ILI9341_t *dev, uint16_t size);
void ILI9341_setCursor(ILI9341_t *dev, int16_t x, int16_t y);
void ILI9341_print(ILI9341_t *dev, const char *str);

// Rotation
void ILI9341_setRotation(ILI9341_t *dev, uint8_t r);

// Raw command/data for LVGL port
void ILI9341_cmd(ILI9341_t *dev, uint8_t cmd);
void ILI9341_data(ILI9341_t *dev, uint8_t data);
void ILI9341_addrSet(ILI9341_t *dev, uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1);

#endif // ILI9341_H