// ILI9341.c — PICPIO C driver for the ILI9341 SPI TFT display
#include "ILI9341.h"
#include "ili9341_font.h"

// ILI9341 commands
#define ILI9341_SWRESET   0x01
#define ILI9341_SLPOUT    0x11
#define ILI9341_CASET     0x2A
#define ILI9341_RASET     0x2B
#define ILI9341_RAMWR    0x2C
#define ILI9341_RAMRD    0x2E
#define ILI9341_MADCTL   0x36
#define ILI9341_COLMOD  0x3A
#define ILI9341_SLPIN    0x10
#define ILI9341_DISON    0x29
#define ILI9341_DISOFF    0x28
#define ILI9341_IDRD    0x04
#define ILI9341_RDID1   0xDA
#define ILI9341_RDID2   0xDB
#define ILI9341_RDID3   0xDC
#define ILI9341_RDID4   0xDD

static void ili9341_cmd(ILI9341_t *dev, uint8_t cmd) {
    gpio_write(dev->dc, LOW);
    gpio_write(dev->cs, LOW);
    SPI.transfer(cmd);
    gpio_write(dev->cs, HIGH);
}

static void ili9341_data(ILI9341_t *dev, uint8_t data) {
    gpio_write(dev->dc, HIGH);
    gpio_write(dev->cs, LOW);
    SPI.transfer(data);
    gpio_write(dev->cs, HIGH);
}

static void ili9341_cmdData(ILI9341_t *dev, uint8_t cmd, uint8_t data) {
    ili9341_cmd(dev, cmd);
    ili9341_data(dev, data);
}

static void ili9341_cmdData16(ILI9341_t *dev, uint8_t cmd, uint16_t data) {
    ili9341_cmd(dev, cmd);
    gpio_write(dev->dc, HIGH);
    gpio_write(dev->cs, LOW);
    SPI.transfer(data >> 8);
    SPI.transfer(data & 0xFF);
    gpio_write(dev->cs, HIGH);
}

void ILI9341_addrSet(ILI9341_t *dev, uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1) {
    ILI9341_cmd(dev, ILI9341_CASET);
    ILI9341_data(dev, x0 >> 8);
    ILI9341_data(dev, x0 & 0xFF);
    ILI9341_data(dev, x1 >> 8);
    ILI9341_data(dev, x1 & 0xFF);
    ILI9341_cmd(dev, ILI9341_RASET);
    ILI9341_data(dev, y0 >> 8);
    ILI9341_data(dev, y0 & 0xFF);
    ILI9341_data(dev, y1 >> 8);
    ILI9341_data(dev, y1 & 0xFF);
}

void ILI9341_init(ILI9341_t *dev, uint8_t cs, uint8_t dc, uint8_t rst) {
    dev->cs = cs;
    dev->dc = dc;
    dev->rst = rst;
    dev->rotation = 0;
    dev->cursorX = 0;
    dev->cursorY = 0;
    dev->textSize = 1;
    dev->textColor = ILI9341_WHITE;
}

bool ILI9341_begin(ILI9341_t *dev, uint16_t width, uint16_t height) {
    dev->width = width;
    dev->height = height;
    
    pinMode(dev->cs, OUTPUT);
    pinMode(dev->dc, OUTPUT);
    pinMode(dev->rst, OUTPUT);
    gpio_write(dev->cs, HIGH);
    gpio_write(dev->dc, HIGH);
    
    if (dev->rst != 0xFF) {
        gpio_write(dev->rst, HIGH);
        sys_delay(5);
        gpio_write(dev->rst, LOW);
        sys_delay(20);
        gpio_write(dev->rst, HIGH);
        sys_delay(150);
    }
    
    // Software reset
    ili9341_cmd(dev, ILI9341_SWRESET);
    sys_delay(150);
    
    // Read display ID (optional check)
    ili9341_cmd(dev, ILI9341_RDID1);
    uint8_t id1 = SPI.transfer(0);
    ili9341_cmd(dev, ILI9341_RDID2);
    uint8_t id2 = SPI.transfer(0);
    ili9341_cmd(dev, ILI9341_RDID3);
    uint8_t id3 = SPI.transfer(0);
    
    // Exit sleep mode
    ili9341_cmd(dev, ILI9341_SLPOUT);
    sys_delay(500);
    
    // Frame memory access control
    ili9341_cmdData(dev, ILI9341_MADCTL, 0x0C); // BGR, vertical refresh
    
    // Pixel format: 16-bit/pixel
    ili9341_cmdData(dev, ILI9341_COLMOD, 0x05);
    
    // Display on
    ili9341_cmd(dev, ILI9341_DISON);
    sys_delay(100);
    
    return true;
}

void ILI9341_fillScreen(ILI9341_t *dev, uint16_t color) {
    ILI9341_fillRect(dev, 0, 0, dev->width, dev->height, color);
}

void ILI9341_drawPixel(ILI9341_t *dev, int16_t x, int16_t y, uint16_t color) {
    if (x < 0 || x >= dev->width || y < 0 || y >= dev->height) return;
    
    ILI9341_addrSet(dev, x, y, x, y);
    ili9341_cmd(dev, ILI9341_RAMWR);
    
    gpio_write(dev->dc, HIGH);
    gpio_write(dev->cs, LOW);
    SPI.transfer(color >> 8);
    SPI.transfer(color & 0xFF);
    gpio_write(dev->cs, HIGH);
}

void ILI9341_drawLine(ILI9341_t *dev, int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color) {
    int16_t dx = x1 - x0, dy = y1 - y0;
    int16_t sx = (dx >= 0) ? 1 : -1;
    int16_t sy = (dy >= 0) ? 1 : -1;
    dx = abs(dx); dy = abs(dy);
    
    int16_t x = x0, y = y0;
    if (dx >= dy) {
        int16_t err = dx / 2;
        for (int16_t i = 0; i <= dx; i++) {
            ILI9341_drawPixel(dev, x, y, color);
            err -= dy;
            if (err < 0) { y += sy; err += dx; }
            x += sx;
        }
    } else {
        int16_t err = dy / 2;
        for (int16_t i = 0; i <= dy; i++) {
            ILI9341_drawPixel(dev, x, y, color);
            err -= dx;
            if (err < 0) { x += sx; err += dy; }
            y += sy;
        }
    }
}

void ILI9341_drawRect(ILI9341_t *dev, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
    ILI9341_drawLine(dev, x, y, x + w - 1, y, color);
    ILI9341_drawLine(dev, x, y + h - 1, x + w - 1, y + h - 1, color);
    ILI9341_drawLine(dev, x, y, x, y + h - 1, color);
    ILI9341_drawLine(dev, x + w - 1, y, x + w - 1, y + h - 1, color);
}

void ILI9341_fillRect(ILI9341_t *dev, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
    if (x < 0 || y < 0 || x + w > dev->width || y + h > dev->height) return;
    
    ILI9341_addrSet(dev, x, y, x + w - 1, y + h - 1);
    ili9341_cmd(dev, ILI9341_RAMWR);
    
    gpio_write(dev->dc, HIGH);
    gpio_write(dev->cs, LOW);
    for (int32_t i = 0; i < (int32_t)w * h; i++) {
        SPI.transfer(color >> 8);
        SPI.transfer(color & 0xFF);
    }
    gpio_write(dev->cs, HIGH);
}

void ILI9341_drawCircle(ILI9341_t *dev, int16_t x0, int16_t y0, int16_t r, uint16_t color) {
    int16_t f = 1 - r;
    int16_t ddF_x = 1, ddF_y = -2 * r;
    int16_t x = 0, y = r;
    
    ILI9341_drawPixel(dev, x0, y0 + r, color);
    ILI9341_drawPixel(dev, x0, y0 - r, color);
    ILI9341_drawPixel(dev, x0 + r, y0, color);
    ILI9341_drawPixel(dev, x0 - r, y0, color);
    
    while (x < y) {
        if (f >= 0) { y--; ddF_y += 2; f += ddF_y; }
        x++; ddF_x += 2; f += ddF_x;
        
        ILI9341_drawPixel(dev, x0 + x, y0 + y, color);
        ILI9341_drawPixel(dev, x0 - x, y0 + y, color);
        ILI9341_drawPixel(dev, x0 + x, y0 - y, color);
        ILI9341_drawPixel(dev, x0 - x, y0 - y, color);
        ILI9341_drawPixel(dev, x0 + y, y0 + x, color);
        ILI9341_drawPixel(dev, x0 - y, y0 + x, color);
        ILI9341_drawPixel(dev, x0 + y, y0 - x, color);
        ILI9341_drawPixel(dev, x0 - y, y0 - x, color);
    }
}

void ILI9341_fillCircle(ILI9341_t *dev, int16_t x0, int16_t y0, int16_t r, uint16_t color) {
    ILI9341_drawLine(dev, x0, y0 - r, x0, y0 + r, color);
    
    int16_t f = 1 - r;
    int16_t ddF_x = 1, ddF_y = -2 * r;
    int16_t x = 0, y = r;
    
    while (x < y) {
        if (f >= 0) { y--; ddF_y += 2; f += ddF_y; }
        x++; ddF_x += 2; f += ddF_x;
        
        ILI9341_drawLine(dev, x0 + x, y0 - y, x0 + x, y0 + y, color);
        ILI9341_drawLine(dev, x0 - x, y0 - y, x0 - x, y0 + y, color);
        ILI9341_drawLine(dev, x0 + y, y0 - x, x0 + y, y0 + x, color);
        ILI9341_drawLine(dev, x0 - y, y0 - x, x0 - y, y0 + x, color);
    }
}

void ILI9341_setTextColor(ILI9341_t *dev, uint16_t color) {
    dev->textColor = color;
}

void ILI9341_setTextSize(ILI9341_t *dev, uint16_t size) {
    dev->textSize = (size == 0) ? 1 : size;
}

void ILI9341_setCursor(ILI9341_t *dev, int16_t x, int16_t y) {
    dev->cursorX = x;
    dev->cursorY = y;
}

void ILI9341_print(ILI9341_t *dev, const char *str) {
    const uint8_t *font = (const uint8_t*)font5x7;
    while (*str) {
        char c = *str++;
        if (c == '\n') {
            dev->cursorX = 0;
            dev->cursorY += 8 * dev->textSize;
            continue;
        }
        
        uint16_t glyph = (uint8_t)c * 5;
        for (uint8_t col = 0; col < 5; col++) {
            uint8_t line = font[glyph + col];
            for (uint8_t row = 0; row < 8; row++) {
                if (line & (1 << row)) {
                    ILI9341_fillRect(dev, dev->cursorX + col * dev->textSize,
                                     dev->cursorY + row * dev->textSize,
                                     dev->textSize, dev->textSize, dev->textColor);
                } else if (dev->textColor == ILI9341_WHITE) {
                    ILI9341_fillRect(dev, dev->cursorX + col * dev->textSize,
                                     dev->cursorY + row * dev->textSize,
                                     dev->textSize, dev->textSize, ILI9341_BLACK);
                }
            }
        }
        dev->cursorX += 6 * dev->textSize;
    }
}

void ILI9341_setRotation(ILI9341_t *dev, uint8_t r) {
    dev->rotation = r;
    uint8_t madctl;
    switch (r & 3) {
        case 0: madctl = 0x0C; break;
        case 1: madctl = 0x6C; break;
        case 2: madctl = 0x8C; break;
        case 3: madctl = 0xCC; break;
        default: madctl = 0x0C; break;
    }
    ili9341_cmdData(dev, ILI9341_MADCTL, madctl);
}

void ILI9341_cmd(ILI9341_t *dev, uint8_t cmd) {
    gpio_write(dev->dc, LOW);
    gpio_write(dev->cs, LOW);
    SPI.transfer(cmd);
    gpio_write(dev->cs, HIGH);
}

void ILI9341_data(ILI9341_t *dev, uint8_t data) {
    gpio_write(dev->dc, HIGH);
    gpio_write(dev->cs, LOW);
    SPI.transfer(data);
    gpio_write(dev->cs, HIGH);
}