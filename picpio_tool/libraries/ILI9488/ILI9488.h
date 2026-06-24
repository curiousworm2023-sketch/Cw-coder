// ILI9488.h — PICPIO C driver for the ILI9488 480x320 3.5" SPI TFT display
// (e.g. the 3.5" 480x320 ILI9488 touch module). 4-wire SPI interface
// (CS, DC, RST). Uses 16-bit RGB565 in the API, expanded to the ILI9488's
// required 18-bit (3 bytes/pixel) on the wire — ILI9488 does NOT support
// 16-bit pixels over 4-wire SPI. For touch, use the XPT2046 library.
//
// Usage:
//   #include "ILI9488.h"
//   ILI9488_t tft;
//   void init() {
//       SPI.begin();
//       ILI9488_init(&tft, D10, D9, D8);   // CS, DC, RST
//       ILI9488_begin(&tft, 480, 320);
//       ILI9488_fillScreen(&tft, ILI9488_BLACK);
//   }

#ifndef ILI9488_H
#define ILI9488_H

#include "Picpio.h"

// Color definitions (RGB565)
#define ILI9488_BLACK       0x0000
#define ILI9488_BLUE        0x001F
#define ILI9488_RED         0xF800
#define ILI9488_GREEN       0x07E0
#define ILI9488_CYAN        0x07FF
#define ILI9488_MAGENTA     0xF81F
#define ILI9488_YELLOW      0xFFE0
#define ILI9488_WHITE       0xFFFF

// Build an RGB565 color from 8-bit r,g,b components.
static inline uint16_t ILI9488_rgb565(uint8_t r, uint8_t g, uint8_t b) {
    return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

// ILI9488 commands (for LVGL / raw use)
#define ILI9488_SWRESET   0x01
#define ILI9488_SLPOUT    0x11
#define ILI9488_CASET     0x2A
#define ILI9488_RASET     0x2B
#define ILI9488_RAMWR     0x2C
#define ILI9488_RAMRD     0x2E
#define ILI9488_MADCTL    0x36
#define ILI9488_COLMOD    0x3A

typedef struct {
    uint8_t  cs, dc, rst;
    uint16_t width, height;     // current (orientation-adjusted) dimensions
    uint16_t baseW, baseH;      // dimensions passed to begin() (rotation 0)
    uint8_t  rotation;
    int16_t  cursorX, cursorY;
    uint16_t textSize;
    uint16_t textColor;
} ILI9488_t;

// Initialize the display struct (call before begin)
void ILI9488_init(ILI9488_t *dev, uint8_t cs, uint8_t dc, uint8_t rst);

// Initialize and configure the display (call after SPI.begin()). Returns true.
bool ILI9488_begin(ILI9488_t *dev, uint16_t width, uint16_t height);

// Basic drawing
void ILI9488_fillScreen(ILI9488_t *dev, uint16_t color);
void ILI9488_drawPixel(ILI9488_t *dev, int16_t x, int16_t y, uint16_t color);
void ILI9488_drawLine(ILI9488_t *dev, int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color);
void ILI9488_drawRect(ILI9488_t *dev, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
void ILI9488_fillRect(ILI9488_t *dev, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
void ILI9488_drawCircle(ILI9488_t *dev, int16_t x0, int16_t y0, int16_t r, uint16_t color);
void ILI9488_fillCircle(ILI9488_t *dev, int16_t x0, int16_t y0, int16_t r, uint16_t color);

// Text rendering
void ILI9488_setTextColor(ILI9488_t *dev, uint16_t color);
void ILI9488_setTextSize(ILI9488_t *dev, uint16_t size);
void ILI9488_setCursor(ILI9488_t *dev, int16_t x, int16_t y);
void ILI9488_print(ILI9488_t *dev, const char *str);

// Rotation (0-3)
void ILI9488_setRotation(ILI9488_t *dev, uint8_t r);

// Raw command/data
void ILI9488_cmd(ILI9488_t *dev, uint8_t cmd);
void ILI9488_data(ILI9488_t *dev, uint8_t data);
void ILI9488_addrSet(ILI9488_t *dev, uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1);

// Draw a 1-bpp bitmap (row-major, MSB-first, rows byte-padded) of size w x h
// at (x,y); set bits drawn in `color`. Pairs with the Display Designer export.
void ILI9488_drawBitmap(ILI9488_t *dev, int16_t x, int16_t y, const uint8_t *bitmap,
                        int16_t w, int16_t h, uint16_t color);

#endif // ILI9488_H
