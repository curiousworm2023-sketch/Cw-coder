// LiquidCrystal_I2C.c — PICPIO C port of the YWROBOT/DFRobot HD44780-over-PCF8574 I2C LCD library
#include "LiquidCrystal_I2C.h"

#define LCD_EN 0x04  // Enable bit
#define LCD_RW 0x02  // Read/Write bit
#define LCD_RS 0x01  // Register select bit

static void LCD_expanderWrite(LCD_t *lcd, uint8_t data)
{
    Wire.beginTransmission(lcd->address);
    Wire.write((data) | lcd->backlightval);
    Wire.endTransmission();
}

static void LCD_pulseEnable(LCD_t *lcd, uint8_t data)
{
    LCD_expanderWrite(lcd, data | LCD_EN);
    delayMicroseconds(1);
    LCD_expanderWrite(lcd, data & ~LCD_EN);
    delayMicroseconds(50);
}

static void LCD_write4bits(LCD_t *lcd, uint8_t value)
{
    LCD_expanderWrite(lcd, value);
    LCD_pulseEnable(lcd, value);
}

static void LCD_send(LCD_t *lcd, uint8_t value, uint8_t mode)
{
    uint8_t highnib = value & 0xF0;
    uint8_t lownib  = (value << 4) & 0xF0;
    LCD_write4bits(lcd, highnib | mode);
    LCD_write4bits(lcd, lownib | mode);
}

void LCD_command(LCD_t *lcd, uint8_t value)
{
    LCD_send(lcd, value, 0);
}

void LCD_writeChar(LCD_t *lcd, uint8_t value)
{
    LCD_send(lcd, value, LCD_RS);
}

void LCD_init(LCD_t *lcd, uint8_t addr, uint8_t cols, uint8_t rows)
{
    lcd->address      = addr;
    lcd->cols         = cols;
    lcd->rows         = rows;
    lcd->backlightval = LCD_NOBACKLIGHT;
}

void LCD_begin(LCD_t *lcd, uint8_t cols, uint8_t lines, uint8_t charsize)
{
    lcd->displayfunction = LCD_4BITMODE | LCD_1LINE | LCD_5x8DOTS;

    if (lines > 1) {
        lcd->displayfunction |= LCD_2LINE;
    }
    lcd->numlines = lines;

    if ((charsize != 0) && (lines == 1)) {
        lcd->displayfunction |= LCD_5x10DOTS;
    }

    delay(50);

    LCD_expanderWrite(lcd, lcd->backlightval);
    delay(1000);

    // put the LCD into 4-bit mode (HD44780 datasheet figure 24)
    LCD_write4bits(lcd, 0x03 << 4);
    delayMicroseconds(4500);
    LCD_write4bits(lcd, 0x03 << 4);
    delayMicroseconds(4500);
    LCD_write4bits(lcd, 0x03 << 4);
    delayMicroseconds(150);
    LCD_write4bits(lcd, 0x02 << 4);

    LCD_command(lcd, LCD_FUNCTIONSET | lcd->displayfunction);

    lcd->displaycontrol = LCD_DISPLAYON | LCD_CURSOROFF | LCD_BLINKOFF;
    LCD_display(lcd);

    LCD_clear(lcd);

    lcd->displaymode = LCD_ENTRYLEFT | LCD_ENTRYSHIFTDECREMENT;
    LCD_command(lcd, LCD_ENTRYMODESET | lcd->displaymode);

    LCD_home(lcd);
}

void LCD_clear(LCD_t *lcd)
{
    LCD_command(lcd, LCD_CLEARDISPLAY);
    delayMicroseconds(2000);
}

void LCD_home(LCD_t *lcd)
{
    LCD_command(lcd, LCD_RETURNHOME);
    delayMicroseconds(2000);
}

void LCD_setCursor(LCD_t *lcd, uint8_t col, uint8_t row)
{
    static const uint8_t rowOffsets[] = { 0x00, 0x40, 0x14, 0x54 };
    if (row > lcd->numlines) {
        row = lcd->numlines - 1;
    }
    LCD_command(lcd, LCD_SETDDRAMADDR | (col + rowOffsets[row]));
}

void LCD_noDisplay(LCD_t *lcd)
{
    lcd->displaycontrol &= ~LCD_DISPLAYON;
    LCD_command(lcd, LCD_DISPLAYCONTROL | lcd->displaycontrol);
}

void LCD_display(LCD_t *lcd)
{
    lcd->displaycontrol |= LCD_DISPLAYON;
    LCD_command(lcd, LCD_DISPLAYCONTROL | lcd->displaycontrol);
}

void LCD_noCursor(LCD_t *lcd)
{
    lcd->displaycontrol &= ~LCD_CURSORON;
    LCD_command(lcd, LCD_DISPLAYCONTROL | lcd->displaycontrol);
}

void LCD_cursor(LCD_t *lcd)
{
    lcd->displaycontrol |= LCD_CURSORON;
    LCD_command(lcd, LCD_DISPLAYCONTROL | lcd->displaycontrol);
}

void LCD_noBlink(LCD_t *lcd)
{
    lcd->displaycontrol &= ~LCD_BLINKON;
    LCD_command(lcd, LCD_DISPLAYCONTROL | lcd->displaycontrol);
}

void LCD_blink(LCD_t *lcd)
{
    lcd->displaycontrol |= LCD_BLINKON;
    LCD_command(lcd, LCD_DISPLAYCONTROL | lcd->displaycontrol);
}

void LCD_scrollDisplayLeft(LCD_t *lcd)
{
    LCD_command(lcd, LCD_CURSORSHIFT | LCD_DISPLAYMOVE | LCD_MOVELEFT);
}

void LCD_scrollDisplayRight(LCD_t *lcd)
{
    LCD_command(lcd, LCD_CURSORSHIFT | LCD_DISPLAYMOVE | LCD_MOVERIGHT);
}

void LCD_leftToRight(LCD_t *lcd)
{
    lcd->displaymode |= LCD_ENTRYLEFT;
    LCD_command(lcd, LCD_ENTRYMODESET | lcd->displaymode);
}

void LCD_rightToLeft(LCD_t *lcd)
{
    lcd->displaymode &= ~LCD_ENTRYLEFT;
    LCD_command(lcd, LCD_ENTRYMODESET | lcd->displaymode);
}

void LCD_autoscroll(LCD_t *lcd)
{
    lcd->displaymode |= LCD_ENTRYSHIFTINCREMENT;
    LCD_command(lcd, LCD_ENTRYMODESET | lcd->displaymode);
}

void LCD_noAutoscroll(LCD_t *lcd)
{
    lcd->displaymode &= ~LCD_ENTRYSHIFTINCREMENT;
    LCD_command(lcd, LCD_ENTRYMODESET | lcd->displaymode);
}

void LCD_createChar(LCD_t *lcd, uint8_t location, const uint8_t charmap[8])
{
    location &= 0x7;
    LCD_command(lcd, LCD_SETCGRAMADDR | (location << 3));
    for (uint8_t i = 0; i < 8; i++) {
        LCD_writeChar(lcd, charmap[i]);
    }
}

void LCD_noBacklight(LCD_t *lcd)
{
    lcd->backlightval = LCD_NOBACKLIGHT;
    LCD_expanderWrite(lcd, 0);
}

void LCD_backlight(LCD_t *lcd)
{
    lcd->backlightval = LCD_BACKLIGHT;
    LCD_expanderWrite(lcd, 0);
}

void LCD_setBacklight(LCD_t *lcd, uint8_t on)
{
    if (on) LCD_backlight(lcd);
    else    LCD_noBacklight(lcd);
}

void LCD_print(LCD_t *lcd, const char *str)
{
    while (*str) {
        LCD_writeChar(lcd, (uint8_t)*str++);
    }
}
