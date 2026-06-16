// SSD1306.h — PICPIO C driver for the SSD1306 128x64 / 128x32 I2C OLED display
// Usage:
//   uint8_t fb[SSD1306_BUFFER_SIZE(128, 64)];
//   SSD1306_t oled;
//   SSD1306_init(&oled, SSD1306_ADDRESS, 128, 64, fb);
//   SSD1306_begin(&oled);
//   SSD1306_clearDisplay(&oled);
//   SSD1306_setCursor(&oled, 0, 0);
//   SSD1306_print(&oled, "Hello");
//   SSD1306_display(&oled);
#ifndef SSD1306_H
#define SSD1306_H

#include "Picpio.h"

// Common 7-bit I2C addresses (some boards use 0x3D). Define SSD1306_ADDRESS
// before #include "SSD1306.h" to override.
#ifndef SSD1306_ADDRESS
#define SSD1306_ADDRESS 0x3C
#endif

#define SSD1306_BLACK   0
#define SSD1306_WHITE   1
#define SSD1306_INVERSE 2

// Size of the framebuffer (bytes) the caller must allocate for a given resolution.
#define SSD1306_BUFFER_SIZE(w, h) ((uint16_t)(w) * (uint16_t)(h) / 8)

typedef struct {
    uint8_t  address;
    uint8_t  width;
    uint8_t  height;
    uint8_t *buffer;     // SSD1306_BUFFER_SIZE(width,height) bytes, caller-allocated

    int16_t  cursorX;
    int16_t  cursorY;
    uint8_t  textColor;
    uint8_t  textSize;
} SSD1306_t;

// Stores dimensions/address and assigns the (caller-allocated) framebuffer.
void SSD1306_init(SSD1306_t *dev, uint8_t address, uint8_t width, uint8_t height, uint8_t *buffer);

// Runs the SSD1306 power-on init sequence over I2C. Returns false if the device
// doesn't ACK its address.
bool SSD1306_begin(SSD1306_t *dev);

// Sends the framebuffer contents to the display.
void SSD1306_display(SSD1306_t *dev);

// Fills the framebuffer with black (does not update the display until SSD1306_display()).
void SSD1306_clearDisplay(SSD1306_t *dev);

void SSD1306_setContrast(SSD1306_t *dev, uint8_t contrast);
void SSD1306_invertDisplay(SSD1306_t *dev, bool invert);
void SSD1306_dim(SSD1306_t *dev, bool dimmed);

// color = SSD1306_BLACK, SSD1306_WHITE, or SSD1306_INVERSE (XOR existing pixel).
void SSD1306_drawPixel(SSD1306_t *dev, int16_t x, int16_t y, uint8_t color);

void SSD1306_drawLine(SSD1306_t *dev, int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint8_t color);
void SSD1306_drawRect(SSD1306_t *dev, int16_t x, int16_t y, int16_t w, int16_t h, uint8_t color);
void SSD1306_fillRect(SSD1306_t *dev, int16_t x, int16_t y, int16_t w, int16_t h, uint8_t color);
void SSD1306_drawCircle(SSD1306_t *dev, int16_t x0, int16_t y0, int16_t r, uint8_t color);
void SSD1306_fillCircle(SSD1306_t *dev, int16_t x0, int16_t y0, int16_t r, uint8_t color);

// Text rendering using the built-in 5x7 font.
void SSD1306_setTextColor(SSD1306_t *dev, uint8_t color);
void SSD1306_setTextSize(SSD1306_t *dev, uint8_t size);   // 1 = 6x8px/char, 2 = 12x16px/char, etc.
void SSD1306_setCursor(SSD1306_t *dev, int16_t x, int16_t y);
void SSD1306_drawChar(SSD1306_t *dev, int16_t x, int16_t y, char c, uint8_t color, uint8_t size);

// Writes text starting at the current cursor, advancing the cursor and wrapping
// to the next line (every 8*textSize px) when it would run off the right edge.
void SSD1306_print(SSD1306_t *dev, const char *str);

#endif // SSD1306_H
