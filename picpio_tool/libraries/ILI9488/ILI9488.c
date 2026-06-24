// ILI9488.c — PICPIO C driver for the ILI9488 480x320 3.5" SPI TFT display.
// Adapted from the ILI9341 driver. Key differences for ILI9488 over 4-wire
// SPI: 480x320 geometry, an ILI9488-specific init sequence, and 18-bit color
// (3 bytes/pixel) — ILI9488 cannot accept 16-bit pixels in 4-wire SPI mode,
// so each RGB565 color is expanded to RGB666 on the wire.
#include "ILI9488.h"
#include "ili9488_font.h"

#define ILI9488_SLPIN     0x10
#define ILI9488_DISON     0x29
#define ILI9488_DISOFF    0x28

static void ili9488_cmd(ILI9488_t *dev, uint8_t cmd) {
    gpio_write(dev->dc, LOW);
    gpio_write(dev->cs, LOW);
    SPI.transfer(cmd);
    gpio_write(dev->cs, HIGH);
}

static void ili9488_data(ILI9488_t *dev, uint8_t data) {
    gpio_write(dev->dc, HIGH);
    gpio_write(dev->cs, LOW);
    SPI.transfer(data);
    gpio_write(dev->cs, HIGH);
}

// Send a command followed by n data bytes (used by the init sequence).
static void ili9488_cmdN(ILI9488_t *dev, uint8_t cmd, const uint8_t *data, uint8_t n) {
    ili9488_cmd(dev, cmd);
    for (uint8_t i = 0; i < n; i++) ili9488_data(dev, data[i]);
}

// Push one RGB565 color as 3 bytes (RGB666) — assumes CS already LOW, DC HIGH.
static void ili9488_color3(uint16_t color) {
    uint8_t r = (color >> 11) & 0x1F;   // 5 bits
    uint8_t g = (color >> 5)  & 0x3F;   // 6 bits
    uint8_t b =  color        & 0x1F;   // 5 bits
    SPI.transfer((uint8_t)(r << 3));    // MSB-align each channel into its byte
    SPI.transfer((uint8_t)(g << 2));
    SPI.transfer((uint8_t)(b << 3));
}

void ILI9488_cmd(ILI9488_t *dev, uint8_t cmd)  { ili9488_cmd(dev, cmd); }
void ILI9488_data(ILI9488_t *dev, uint8_t data) { ili9488_data(dev, data); }

void ILI9488_addrSet(ILI9488_t *dev, uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1) {
    ili9488_cmd(dev, ILI9488_CASET);
    ili9488_data(dev, x0 >> 8);
    ili9488_data(dev, x0 & 0xFF);
    ili9488_data(dev, x1 >> 8);
    ili9488_data(dev, x1 & 0xFF);
    ili9488_cmd(dev, ILI9488_RASET);
    ili9488_data(dev, y0 >> 8);
    ili9488_data(dev, y0 & 0xFF);
    ili9488_data(dev, y1 >> 8);
    ili9488_data(dev, y1 & 0xFF);
}

void ILI9488_init(ILI9488_t *dev, uint8_t cs, uint8_t dc, uint8_t rst) {
    dev->cs = cs;
    dev->dc = dc;
    dev->rst = rst;
    dev->rotation = 0;
    dev->cursorX = 0;
    dev->cursorY = 0;
    dev->textSize = 1;
    dev->textColor = ILI9488_WHITE;
}

bool ILI9488_begin(ILI9488_t *dev, uint16_t width, uint16_t height) {
    dev->width = width;
    dev->height = height;
    dev->baseW = width;
    dev->baseH = height;

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

    ili9488_cmd(dev, ILI9488_SWRESET);
    sys_delay(120);

    // Positive gamma control
    static const uint8_t pgamma[15] = {0x00,0x03,0x09,0x08,0x16,0x0A,0x3F,0x78,0x4C,0x09,0x0A,0x08,0x16,0x1A,0x0F};
    ili9488_cmdN(dev, 0xE0, pgamma, 15);
    // Negative gamma control
    static const uint8_t ngamma[15] = {0x00,0x16,0x19,0x03,0x0F,0x05,0x32,0x45,0x46,0x04,0x0E,0x0D,0x35,0x37,0x0F};
    ili9488_cmdN(dev, 0xE1, ngamma, 15);

    static const uint8_t pc1[2] = {0x17, 0x15};   ili9488_cmdN(dev, 0xC0, pc1, 2);   // Power control 1
    static const uint8_t pc2[1] = {0x41};         ili9488_cmdN(dev, 0xC1, pc2, 1);   // Power control 2
    static const uint8_t vcom[3] = {0x00,0x12,0x80}; ili9488_cmdN(dev, 0xC5, vcom, 3); // VCOM control

    ili9488_cmd(dev, ILI9488_MADCTL);  ili9488_data(dev, 0x48);   // memory access: BGR, landscape
    ili9488_cmd(dev, ILI9488_COLMOD);  ili9488_data(dev, 0x66);   // 18-bit/pixel (required for SPI)

    static const uint8_t ifmode[1] = {0x00};      ili9488_cmdN(dev, 0xB0, ifmode, 1);  // interface mode
    static const uint8_t frmrate[1] = {0xA0};     ili9488_cmdN(dev, 0xB1, frmrate, 1); // frame rate
    static const uint8_t invctl[1] = {0x02};      ili9488_cmdN(dev, 0xB4, invctl, 1);  // display inversion
    static const uint8_t dfc[3] = {0x02,0x02,0x3B}; ili9488_cmdN(dev, 0xB6, dfc, 3);   // display function
    static const uint8_t entry[1] = {0xC6};       ili9488_cmdN(dev, 0xB7, entry, 1);   // entry mode
    static const uint8_t adj3[4] = {0xA9,0x51,0x2C,0x82}; ili9488_cmdN(dev, 0xF7, adj3, 4); // adjust control 3

    ili9488_cmd(dev, ILI9488_SLPOUT);
    sys_delay(120);
    ili9488_cmd(dev, ILI9488_DISON);
    sys_delay(25);

    return true;
}

void ILI9488_fillScreen(ILI9488_t *dev, uint16_t color) {
    ILI9488_fillRect(dev, 0, 0, dev->width, dev->height, color);
}

void ILI9488_drawPixel(ILI9488_t *dev, int16_t x, int16_t y, uint16_t color) {
    if (x < 0 || x >= dev->width || y < 0 || y >= dev->height) return;

    ILI9488_addrSet(dev, x, y, x, y);
    ili9488_cmd(dev, ILI9488_RAMWR);

    gpio_write(dev->dc, HIGH);
    gpio_write(dev->cs, LOW);
    ili9488_color3(color);
    gpio_write(dev->cs, HIGH);
}

void ILI9488_drawBitmap(ILI9488_t *dev, int16_t x, int16_t y, const uint8_t *bitmap,
                        int16_t w, int16_t h, uint16_t color) {
    int16_t byteWidth = (int16_t)((w + 7) / 8);
    for (int16_t j = 0; j < h; j++) {
        for (int16_t i = 0; i < w; i++) {
            uint8_t b = bitmap[j * byteWidth + (i >> 3)];
            if (b & (uint8_t)(0x80 >> (i & 7)))
                ILI9488_drawPixel(dev, (int16_t)(x + i), (int16_t)(y + j), color);
        }
    }
}

void ILI9488_drawLine(ILI9488_t *dev, int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color) {
    int16_t dx = x1 - x0, dy = y1 - y0;
    int16_t sx = (dx >= 0) ? 1 : -1;
    int16_t sy = (dy >= 0) ? 1 : -1;
    dx = abs(dx); dy = abs(dy);

    int16_t x = x0, y = y0;
    if (dx >= dy) {
        int16_t err = dx / 2;
        for (int16_t i = 0; i <= dx; i++) {
            ILI9488_drawPixel(dev, x, y, color);
            err -= dy;
            if (err < 0) { y += sy; err += dx; }
            x += sx;
        }
    } else {
        int16_t err = dy / 2;
        for (int16_t i = 0; i <= dy; i++) {
            ILI9488_drawPixel(dev, x, y, color);
            err -= dx;
            if (err < 0) { x += sx; err += dy; }
            y += sy;
        }
    }
}

void ILI9488_drawRect(ILI9488_t *dev, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
    ILI9488_drawLine(dev, x, y, x + w - 1, y, color);
    ILI9488_drawLine(dev, x, y + h - 1, x + w - 1, y + h - 1, color);
    ILI9488_drawLine(dev, x, y, x, y + h - 1, color);
    ILI9488_drawLine(dev, x + w - 1, y, x + w - 1, y + h - 1, color);
}

void ILI9488_fillRect(ILI9488_t *dev, int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
    if (x < 0 || y < 0 || x + w > dev->width || y + h > dev->height) return;

    ILI9488_addrSet(dev, x, y, x + w - 1, y + h - 1);
    ili9488_cmd(dev, ILI9488_RAMWR);

    gpio_write(dev->dc, HIGH);
    gpio_write(dev->cs, LOW);
    for (int32_t i = 0; i < (int32_t)w * h; i++) {
        ili9488_color3(color);
    }
    gpio_write(dev->cs, HIGH);
}

void ILI9488_drawCircle(ILI9488_t *dev, int16_t x0, int16_t y0, int16_t r, uint16_t color) {
    int16_t f = 1 - r;
    int16_t ddF_x = 1, ddF_y = -2 * r;
    int16_t x = 0, y = r;

    ILI9488_drawPixel(dev, x0, y0 + r, color);
    ILI9488_drawPixel(dev, x0, y0 - r, color);
    ILI9488_drawPixel(dev, x0 + r, y0, color);
    ILI9488_drawPixel(dev, x0 - r, y0, color);

    while (x < y) {
        if (f >= 0) { y--; ddF_y += 2; f += ddF_y; }
        x++; ddF_x += 2; f += ddF_x;

        ILI9488_drawPixel(dev, x0 + x, y0 + y, color);
        ILI9488_drawPixel(dev, x0 - x, y0 + y, color);
        ILI9488_drawPixel(dev, x0 + x, y0 - y, color);
        ILI9488_drawPixel(dev, x0 - x, y0 - y, color);
        ILI9488_drawPixel(dev, x0 + y, y0 + x, color);
        ILI9488_drawPixel(dev, x0 - y, y0 + x, color);
        ILI9488_drawPixel(dev, x0 + y, y0 - x, color);
        ILI9488_drawPixel(dev, x0 - y, y0 - x, color);
    }
}

void ILI9488_fillCircle(ILI9488_t *dev, int16_t x0, int16_t y0, int16_t r, uint16_t color) {
    ILI9488_drawLine(dev, x0, y0 - r, x0, y0 + r, color);

    int16_t f = 1 - r;
    int16_t ddF_x = 1, ddF_y = -2 * r;
    int16_t x = 0, y = r;

    while (x < y) {
        if (f >= 0) { y--; ddF_y += 2; f += ddF_y; }
        x++; ddF_x += 2; f += ddF_x;

        ILI9488_drawLine(dev, x0 + x, y0 - y, x0 + x, y0 + y, color);
        ILI9488_drawLine(dev, x0 - x, y0 - y, x0 - x, y0 + y, color);
        ILI9488_drawLine(dev, x0 + y, y0 - x, x0 + y, y0 + x, color);
        ILI9488_drawLine(dev, x0 - y, y0 - x, x0 - y, y0 + x, color);
    }
}

void ILI9488_setTextColor(ILI9488_t *dev, uint16_t color) { dev->textColor = color; }
void ILI9488_setTextSize(ILI9488_t *dev, uint16_t size)   { dev->textSize = (size == 0) ? 1 : size; }
void ILI9488_setCursor(ILI9488_t *dev, int16_t x, int16_t y) { dev->cursorX = x; dev->cursorY = y; }

void ILI9488_print(ILI9488_t *dev, const char *str) {
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
                    ILI9488_fillRect(dev, dev->cursorX + col * dev->textSize,
                                     dev->cursorY + row * dev->textSize,
                                     dev->textSize, dev->textSize, dev->textColor);
                }
            }
        }
        dev->cursorX += 6 * dev->textSize;
    }
}

void ILI9488_setRotation(ILI9488_t *dev, uint8_t r) {
    dev->rotation = r & 3;
    // Odd rotations are landscape — swap logical width/height.
    if (dev->rotation & 1) { dev->width = dev->baseH; dev->height = dev->baseW; }
    else                   { dev->width = dev->baseW; dev->height = dev->baseH; }
    uint8_t madctl;
    switch (dev->rotation) {
        case 0: madctl = 0x48; break;   // landscape
        case 1: madctl = 0x28; break;   // portrait
        case 2: madctl = 0x88; break;   // landscape flipped
        case 3: madctl = 0xE8; break;   // portrait flipped
        default: madctl = 0x48; break;
    }
    ili9488_cmd(dev, ILI9488_MADCTL);
    ili9488_data(dev, madctl);
}
