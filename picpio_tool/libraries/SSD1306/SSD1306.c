// SSD1306.c — PICPIO C driver for the SSD1306 128x64 / 128x32 I2C OLED display
#include "SSD1306.h"
#include "ssd1306_font.h"

// Fundamental commands
#define SSD1306_SETCONTRAST       0x81
#define SSD1306_DISPLAYALLON_RESUME 0xA4
#define SSD1306_NORMALDISPLAY     0xA6
#define SSD1306_INVERTDISPLAY     0xA7
#define SSD1306_DISPLAYOFF        0xAE
#define SSD1306_DISPLAYON         0xAF

// Addressing setting commands
#define SSD1306_SETMEMORYMODE     0x20
#define SSD1306_COLUMNADDR        0x21
#define SSD1306_PAGEADDR          0x22

// Hardware configuration commands
#define SSD1306_SETSTARTLINE      0x40
#define SSD1306_SEGREMAP          0xA1
#define SSD1306_SETMULTIPLEX      0xA8
#define SSD1306_COMSCANDEC        0xC8
#define SSD1306_SETDISPLAYOFFSET  0xD3
#define SSD1306_SETCOMPINS        0xDA

// Timing & driving scheme commands
#define SSD1306_SETDISPLAYCLOCKDIV 0xD5
#define SSD1306_SETPRECHARGE      0xD9
#define SSD1306_SETVCOMDETECT     0xDB
#define SSD1306_CHARGEPUMP        0x8D

static void ssd1306_command1(SSD1306_t *dev, uint8_t cmd)
{
    Wire.beginTransmission(dev->address);
    Wire.write(0x00); // Co=0, D/C=0 -> command stream
    Wire.write(cmd);
    Wire.endTransmission();
}

void SSD1306_init(SSD1306_t *dev, uint8_t address, uint8_t width, uint8_t height, uint8_t *buffer)
{
    dev->address  = address;
    dev->width    = width;
    dev->height   = height;
    dev->buffer   = buffer;
    dev->cursorX  = 0;
    dev->cursorY  = 0;
    dev->textColor = SSD1306_WHITE;
    dev->textSize  = 1;
}

bool SSD1306_begin(SSD1306_t *dev)
{
    Wire.beginTransmission(dev->address);
    if (Wire.endTransmission() != 0) return false;

    uint8_t comPins = (dev->height == 64) ? 0x12 : 0x02;

    ssd1306_command1(dev, SSD1306_DISPLAYOFF);
    ssd1306_command1(dev, SSD1306_SETDISPLAYCLOCKDIV);
    ssd1306_command1(dev, 0x80);
    ssd1306_command1(dev, SSD1306_SETMULTIPLEX);
    ssd1306_command1(dev, dev->height - 1);
    ssd1306_command1(dev, SSD1306_SETDISPLAYOFFSET);
    ssd1306_command1(dev, 0x00);
    ssd1306_command1(dev, SSD1306_SETSTARTLINE | 0x00);
    ssd1306_command1(dev, SSD1306_CHARGEPUMP);
    ssd1306_command1(dev, 0x14);
    ssd1306_command1(dev, SSD1306_SETMEMORYMODE);
    ssd1306_command1(dev, 0x00); // horizontal addressing mode
    ssd1306_command1(dev, SSD1306_SEGREMAP);
    ssd1306_command1(dev, SSD1306_COMSCANDEC);
    ssd1306_command1(dev, SSD1306_SETCOMPINS);
    ssd1306_command1(dev, comPins);
    ssd1306_command1(dev, SSD1306_SETCONTRAST);
    ssd1306_command1(dev, 0x8F);
    ssd1306_command1(dev, SSD1306_SETPRECHARGE);
    ssd1306_command1(dev, 0xF1);
    ssd1306_command1(dev, SSD1306_SETVCOMDETECT);
    ssd1306_command1(dev, 0x40);
    ssd1306_command1(dev, SSD1306_DISPLAYALLON_RESUME);
    ssd1306_command1(dev, SSD1306_NORMALDISPLAY);
    ssd1306_command1(dev, SSD1306_DISPLAYON);

    SSD1306_clearDisplay(dev);
    return true;
}

void SSD1306_display(SSD1306_t *dev)
{
    ssd1306_command1(dev, SSD1306_COLUMNADDR);
    ssd1306_command1(dev, 0);
    ssd1306_command1(dev, dev->width - 1);
    ssd1306_command1(dev, SSD1306_PAGEADDR);
    ssd1306_command1(dev, 0);
    ssd1306_command1(dev, (dev->height / 8) - 1);

    uint16_t count = SSD1306_BUFFER_SIZE(dev->width, dev->height);
    Wire.beginTransmission(dev->address);
    Wire.write(0x40); // Co=0, D/C=1 -> data stream
    for (uint16_t i = 0; i < count; i++) {
        Wire.write(dev->buffer[i]);
    }
    Wire.endTransmission();
}

void SSD1306_clearDisplay(SSD1306_t *dev)
{
    uint16_t count = SSD1306_BUFFER_SIZE(dev->width, dev->height);
    for (uint16_t i = 0; i < count; i++) {
        dev->buffer[i] = 0x00;
    }
}

void SSD1306_setContrast(SSD1306_t *dev, uint8_t contrast)
{
    ssd1306_command1(dev, SSD1306_SETCONTRAST);
    ssd1306_command1(dev, contrast);
}

void SSD1306_invertDisplay(SSD1306_t *dev, bool invert)
{
    ssd1306_command1(dev, invert ? SSD1306_INVERTDISPLAY : SSD1306_NORMALDISPLAY);
}

void SSD1306_dim(SSD1306_t *dev, bool dimmed)
{
    SSD1306_setContrast(dev, dimmed ? 0x00 : 0x8F);
}

void SSD1306_drawPixel(SSD1306_t *dev, int16_t x, int16_t y, uint8_t color)
{
    if (x < 0 || x >= dev->width || y < 0 || y >= dev->height) return;

    uint16_t idx = (uint16_t)x + (uint16_t)(y / 8) * dev->width;
    uint8_t  bit = (uint8_t)(1 << (y & 7));

    switch (color) {
        case SSD1306_WHITE:   dev->buffer[idx] |= bit;  break;
        case SSD1306_BLACK:   dev->buffer[idx] &= ~bit; break;
        case SSD1306_INVERSE: dev->buffer[idx] ^= bit;  break;
    }
}

void SSD1306_drawLine(SSD1306_t *dev, int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint8_t color)
{
    int16_t dx = x1 - x0, dy = y1 - y0;
    int16_t sx = (dx >= 0) ? 1 : -1;
    int16_t sy = (dy >= 0) ? 1 : -1;
    dx = abs(dx);
    dy = abs(dy);

    int16_t x = x0, y = y0;
    if (dx >= dy) {
        int16_t err = dx / 2;
        for (int16_t i = 0; i <= dx; i++) {
            SSD1306_drawPixel(dev, x, y, color);
            err -= dy;
            if (err < 0) { y += sy; err += dx; }
            x += sx;
        }
    } else {
        int16_t err = dy / 2;
        for (int16_t i = 0; i <= dy; i++) {
            SSD1306_drawPixel(dev, x, y, color);
            err -= dx;
            if (err < 0) { x += sx; err += dy; }
            y += sy;
        }
    }
}

void SSD1306_drawRect(SSD1306_t *dev, int16_t x, int16_t y, int16_t w, int16_t h, uint8_t color)
{
    SSD1306_drawLine(dev, x,         y,         x + w - 1, y,         color);
    SSD1306_drawLine(dev, x,         y + h - 1, x + w - 1, y + h - 1, color);
    SSD1306_drawLine(dev, x,         y,         x,         y + h - 1, color);
    SSD1306_drawLine(dev, x + w - 1, y,         x + w - 1, y + h - 1, color);
}

void SSD1306_fillRect(SSD1306_t *dev, int16_t x, int16_t y, int16_t w, int16_t h, uint8_t color)
{
    for (int16_t j = y; j < y + h; j++) {
        for (int16_t i = x; i < x + w; i++) {
            SSD1306_drawPixel(dev, i, j, color);
        }
    }
}

void SSD1306_drawCircle(SSD1306_t *dev, int16_t x0, int16_t y0, int16_t r, uint8_t color)
{
    int16_t f = 1 - r;
    int16_t ddF_x = 1;
    int16_t ddF_y = -2 * r;
    int16_t x = 0, y = r;

    SSD1306_drawPixel(dev, x0,     y0 + r, color);
    SSD1306_drawPixel(dev, x0,     y0 - r, color);
    SSD1306_drawPixel(dev, x0 + r, y0,     color);
    SSD1306_drawPixel(dev, x0 - r, y0,     color);

    while (x < y) {
        if (f >= 0) {
            y--;
            ddF_y += 2;
            f += ddF_y;
        }
        x++;
        ddF_x += 2;
        f += ddF_x;

        SSD1306_drawPixel(dev, x0 + x, y0 + y, color);
        SSD1306_drawPixel(dev, x0 - x, y0 + y, color);
        SSD1306_drawPixel(dev, x0 + x, y0 - y, color);
        SSD1306_drawPixel(dev, x0 - x, y0 - y, color);
        SSD1306_drawPixel(dev, x0 + y, y0 + x, color);
        SSD1306_drawPixel(dev, x0 - y, y0 + x, color);
        SSD1306_drawPixel(dev, x0 + y, y0 - x, color);
        SSD1306_drawPixel(dev, x0 - y, y0 - x, color);
    }
}

void SSD1306_fillCircle(SSD1306_t *dev, int16_t x0, int16_t y0, int16_t r, uint8_t color)
{
    SSD1306_drawLine(dev, x0, y0 - r, x0, y0 + r, color);

    int16_t f = 1 - r;
    int16_t ddF_x = 1;
    int16_t ddF_y = -2 * r;
    int16_t x = 0, y = r;

    while (x < y) {
        if (f >= 0) {
            y--;
            ddF_y += 2;
            f += ddF_y;
        }
        x++;
        ddF_x += 2;
        f += ddF_x;

        SSD1306_drawLine(dev, x0 + x, y0 - y, x0 + x, y0 + y, color);
        SSD1306_drawLine(dev, x0 - x, y0 - y, x0 - x, y0 + y, color);
        SSD1306_drawLine(dev, x0 + y, y0 - x, x0 + y, y0 + x, color);
        SSD1306_drawLine(dev, x0 - y, y0 - x, x0 - y, y0 + x, color);
    }
}

void SSD1306_setTextColor(SSD1306_t *dev, uint8_t color)
{
    dev->textColor = color;
}

void SSD1306_setTextSize(SSD1306_t *dev, uint8_t size)
{
    dev->textSize = (size == 0) ? 1 : size;
}

void SSD1306_setCursor(SSD1306_t *dev, int16_t x, int16_t y)
{
    dev->cursorX = x;
    dev->cursorY = y;
}

void SSD1306_drawChar(SSD1306_t *dev, int16_t x, int16_t y, char c, uint8_t color, uint8_t size)
{
    uint16_t glyph = (uint8_t)c * 5;

    for (uint8_t col = 0; col < 5; col++) {
        uint8_t line = font5x7[glyph + col];
        for (uint8_t row = 0; row < 8; row++) {
            if (line & (1 << row)) {
                if (size == 1) {
                    SSD1306_drawPixel(dev, x + col, y + row, color);
                } else {
                    SSD1306_fillRect(dev, x + col * size, y + row * size, size, size, color);
                }
            }
        }
    }
}

void SSD1306_print(SSD1306_t *dev, const char *str)
{
    uint8_t charW = 6 * dev->textSize;  // 5px glyph + 1px space
    uint8_t charH = 8 * dev->textSize;

    while (*str) {
        char c = *str++;
        if (c == '\n') {
            dev->cursorX = 0;
            dev->cursorY += charH;
            continue;
        }
        if (c == '\r') continue;

        if (dev->cursorX + charW > dev->width) {
            dev->cursorX = 0;
            dev->cursorY += charH;
        }

        SSD1306_drawChar(dev, dev->cursorX, dev->cursorY, c, dev->textColor, dev->textSize);
        dev->cursorX += charW;
    }
}
