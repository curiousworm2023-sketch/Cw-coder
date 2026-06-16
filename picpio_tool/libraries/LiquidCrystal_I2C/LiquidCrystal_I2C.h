// LiquidCrystal_I2C.h — PICPIO C port of the YWROBOT/DFRobot HD44780-over-PCF8574 I2C LCD library
// Usage: LCD_t lcd; LCD_init(&lcd, 0x27, 16, 2); LCD_begin(&lcd, 16, 2, LCD_5x8DOTS);
//        LCD_backlight(&lcd); LCD_setCursor(&lcd, 0, 0); LCD_print(&lcd, "Hello");
#ifndef LIQUIDCRYSTAL_I2C_H
#define LIQUIDCRYSTAL_I2C_H

#include "Picpio.h"

// commands
#define LCD_CLEARDISPLAY   0x01
#define LCD_RETURNHOME     0x02
#define LCD_ENTRYMODESET   0x04
#define LCD_DISPLAYCONTROL 0x08
#define LCD_CURSORSHIFT    0x10
#define LCD_FUNCTIONSET    0x20
#define LCD_SETCGRAMADDR   0x40
#define LCD_SETDDRAMADDR   0x80

// flags for display entry mode
#define LCD_ENTRYRIGHT          0x00
#define LCD_ENTRYLEFT           0x02
#define LCD_ENTRYSHIFTINCREMENT 0x01
#define LCD_ENTRYSHIFTDECREMENT 0x00

// flags for display on/off control
#define LCD_DISPLAYON  0x04
#define LCD_DISPLAYOFF 0x00
#define LCD_CURSORON   0x02
#define LCD_CURSOROFF  0x00
#define LCD_BLINKON    0x01
#define LCD_BLINKOFF   0x00

// flags for display/cursor shift
#define LCD_DISPLAYMOVE 0x08
#define LCD_CURSORMOVE  0x00
#define LCD_MOVERIGHT   0x04
#define LCD_MOVELEFT    0x00

// flags for function set
#define LCD_8BITMODE 0x10
#define LCD_4BITMODE 0x00
#define LCD_2LINE    0x08
#define LCD_1LINE    0x00
#define LCD_5x10DOTS 0x04
#define LCD_5x8DOTS  0x00

// flags for backlight control
#define LCD_BACKLIGHT   0x08
#define LCD_NOBACKLIGHT 0x00

typedef struct {
    uint8_t address;
    uint8_t displayfunction;
    uint8_t displaycontrol;
    uint8_t displaymode;
    uint8_t numlines;
    uint8_t cols;
    uint8_t rows;
    uint8_t backlightval;
} LCD_t;

// Sets the I2C address and dimensions. Call LCD_begin() afterwards.
void LCD_init(LCD_t *lcd, uint8_t addr, uint8_t cols, uint8_t rows);

// Runs the HD44780 4-bit init sequence. charsize = LCD_5x8DOTS or LCD_5x10DOTS.
void LCD_begin(LCD_t *lcd, uint8_t cols, uint8_t rows, uint8_t charsize);

void LCD_clear(LCD_t *lcd);
void LCD_home(LCD_t *lcd);
void LCD_setCursor(LCD_t *lcd, uint8_t col, uint8_t row);

void LCD_noDisplay(LCD_t *lcd);
void LCD_display(LCD_t *lcd);
void LCD_noCursor(LCD_t *lcd);
void LCD_cursor(LCD_t *lcd);
void LCD_noBlink(LCD_t *lcd);
void LCD_blink(LCD_t *lcd);

void LCD_scrollDisplayLeft(LCD_t *lcd);
void LCD_scrollDisplayRight(LCD_t *lcd);
void LCD_leftToRight(LCD_t *lcd);
void LCD_rightToLeft(LCD_t *lcd);
void LCD_autoscroll(LCD_t *lcd);
void LCD_noAutoscroll(LCD_t *lcd);

// charmap = 8 bytes, 5 lsb of each used as one row of the 5x8 glyph. location = 0..7.
void LCD_createChar(LCD_t *lcd, uint8_t location, const uint8_t charmap[8]);

void LCD_noBacklight(LCD_t *lcd);
void LCD_backlight(LCD_t *lcd);
void LCD_setBacklight(LCD_t *lcd, uint8_t on);

// Low-level: send a command byte (RS=0) or write a data byte (RS=1).
void LCD_command(LCD_t *lcd, uint8_t value);
void LCD_writeChar(LCD_t *lcd, uint8_t value);

// Writes a null-terminated string at the current cursor position.
void LCD_print(LCD_t *lcd, const char *str);

#endif // LIQUIDCRYSTAL_I2C_H
