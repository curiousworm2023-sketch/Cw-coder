#ifndef LCD_HC595_H
#define LCD_HC595_H

#include "Picpio.h"

// HD44780 character LCD driven in 4-bit mode through a 74HC595 shift
// register (3 GPIO pins: data, clock, latch). Bit mapping on the 595:
//   Q0-Q3 = LCD D4-D7, Q4 = RS, Q5 = EN, Q6 = backlight, Q7 = unused.

#define LCD595_D4 (1 << 0)
#define LCD595_D5 (1 << 1)
#define LCD595_D6 (1 << 2)
#define LCD595_D7 (1 << 3)
#define LCD595_RS (1 << 4)
#define LCD595_EN (1 << 5)
#define LCD595_BL (1 << 6)

// Big-number custom character slots (CGRAM locations 0-7)
#define LCD595_BIG_LEFT_SIDE   0
#define LCD595_BIG_UPPER_BAR   1
#define LCD595_BIG_RIGHT_SIDE  2
#define LCD595_BIG_LEFT_END    3
#define LCD595_BIG_LOWER_BAR   4
#define LCD595_BIG_RIGHT_END   5
#define LCD595_BIG_MIDDLE_BAR  6
#define LCD595_BIG_LOWER_END   7

typedef struct {
    uint8_t dataPin;
    uint8_t clockPin;
    uint8_t latchPin;

    uint8_t cols;
    uint8_t rows;
    uint8_t displayControl;
    uint8_t backlightState;

    const uint8_t *rowOffsets;

    bool     bigNumberCharsCreated;
    int      lastBigNumber;
    int      lastDisplayedValue;
    uint32_t lastBigNumberUpdate;
} LCD595_t;

// Setup
void LCD595_init(LCD595_t *dev, uint8_t dataPin, uint8_t clockPin, uint8_t latchPin);
void LCD595_begin(LCD595_t *dev, uint8_t cols, uint8_t rows);

// Basic commands
void LCD595_clear(LCD595_t *dev);
void LCD595_home(LCD595_t *dev);
void LCD595_setCursor(LCD595_t *dev, uint8_t row, uint8_t col);

// Display control
void LCD595_display(LCD595_t *dev);
void LCD595_noDisplay(LCD595_t *dev);
void LCD595_cursor(LCD595_t *dev);
void LCD595_noCursor(LCD595_t *dev);
void LCD595_blink(LCD595_t *dev);
void LCD595_noBlink(LCD595_t *dev);
void LCD595_backlight(LCD595_t *dev, bool state);

// Character output
void LCD595_write(LCD595_t *dev, uint8_t value);
void LCD595_print(LCD595_t *dev, const char *str);
void LCD595_printAt(LCD595_t *dev, uint8_t row, uint8_t col, const char *str);

// Custom characters
void LCD595_createChar(LCD595_t *dev, uint8_t location, const uint8_t charmap[8]);

// Big numbers (2-row, 3-column digits 0-9)
void LCD595_createBigNumberChars(LCD595_t *dev);
void LCD595_printDigit(LCD595_t *dev, int digit, uint8_t col, uint8_t row);
void LCD595_printBigNumber(LCD595_t *dev, int value, uint8_t col, bool clearPrevious);
void LCD595_printBigNumberCentered20x4(LCD595_t *dev, int value);

// Helpers
void LCD595_printf(LCD595_t *dev, uint8_t row, uint8_t col, const char *format, ...);
void LCD595_centerText(LCD595_t *dev, uint8_t row, const char *text);
void LCD595_progressBar(LCD595_t *dev, uint8_t row, uint8_t percentage);
void LCD595_scrollText(LCD595_t *dev, uint8_t row, const char *text, uint16_t speed_ms);
void LCD595_startupAnimation(LCD595_t *dev);

#endif
