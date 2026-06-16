#include "LCD_HC595.h"
#include <stdarg.h>
#include <string.h>

#define LCD595_BUF_COLS 20

static const uint8_t ROW_OFFSETS_16x2[4] = {0x00, 0x40, 0x00, 0x40};
static const uint8_t ROW_OFFSETS_20x4[4] = {0x00, 0x40, 0x14, 0x54};
static const uint8_t ROW_OFFSETS_16x4[4] = {0x00, 0x40, 0x10, 0x50};

static const uint8_t BIG_LEFT_SIDE_CHAR[8]   = {0x07,0x0F,0x0F,0x0F,0x0F,0x0F,0x0F,0x0F};
static const uint8_t BIG_UPPER_BAR_CHAR[8]   = {0x1F,0x1F,0x1F,0x00,0x00,0x00,0x00,0x00};
static const uint8_t BIG_RIGHT_SIDE_CHAR[8]  = {0x1C,0x1E,0x1E,0x1E,0x1E,0x1E,0x1E,0x1C};
static const uint8_t BIG_LEFT_END_CHAR[8]    = {0x0F,0x07,0x00,0x00,0x00,0x00,0x03,0x07};
static const uint8_t BIG_LOWER_BAR_CHAR[8]   = {0x00,0x00,0x00,0x00,0x00,0x1F,0x1F,0x1F};
static const uint8_t BIG_RIGHT_END_CHAR[8]   = {0x1E,0x1C,0x00,0x00,0x00,0x00,0x18,0x1C};
static const uint8_t BIG_MIDDLE_BAR_CHAR[8]  = {0x1F,0x1F,0x1F,0x00,0x00,0x00,0x1F,0x1F};
static const uint8_t BIG_LOWER_END_CHAR[8]   = {0x00,0x00,0x00,0x00,0x00,0x00,0x07,0x0F};

// ── Low-level 74HC595 / HD44780 ────────────────────────────────────────────

static void LCD595_shift595(LCD595_t *dev, uint8_t data)
{
    digitalWrite(dev->latchPin, LOW);
    for (int8_t i = 7; i >= 0; i--) {
        digitalWrite(dev->clockPin, LOW);
        digitalWrite(dev->dataPin, (data >> i) & 0x01 ? HIGH : LOW);
        digitalWrite(dev->clockPin, HIGH);
    }
    digitalWrite(dev->latchPin, HIGH);
    delayMicroseconds(1);
}

static void LCD595_sendNibble(LCD595_t *dev, uint8_t nibble, bool rs)
{
    uint8_t data = (nibble & 0x0F) | (rs ? LCD595_RS : 0) | dev->backlightState;

    LCD595_shift595(dev, data | LCD595_EN);
    delayMicroseconds(1);
    LCD595_shift595(dev, data & (uint8_t)~LCD595_EN);
    delayMicroseconds(50);
}

static void LCD595_sendByte(LCD595_t *dev, uint8_t value, bool rs)
{
    LCD595_sendNibble(dev, value >> 4, rs);
    LCD595_sendNibble(dev, value & 0x0F, rs);
}

static void LCD595_command(LCD595_t *dev, uint8_t value)
{
    LCD595_sendByte(dev, value, false);

    if (value == 0x01 || value == 0x02) {
        delay(2);
    }
}

// ── Setup ───────────────────────────────────────────────────────────────

void LCD595_init(LCD595_t *dev, uint8_t dataPin, uint8_t clockPin, uint8_t latchPin)
{
    dev->dataPin  = dataPin;
    dev->clockPin = clockPin;
    dev->latchPin = latchPin;
    dev->cols = 16;
    dev->rows = 2;
    dev->displayControl = 0x0C; // Display ON, cursor OFF, blink OFF
    dev->backlightState = LCD595_BL;
    dev->rowOffsets = ROW_OFFSETS_16x2;
    dev->bigNumberCharsCreated = false;
    dev->lastBigNumber = -1;
    dev->lastDisplayedValue = -1;
    dev->lastBigNumberUpdate = 0;
}

void LCD595_begin(LCD595_t *dev, uint8_t cols, uint8_t rows)
{
    dev->cols = cols;
    dev->rows = rows;

    if (cols == 20 && rows == 4) {
        dev->rowOffsets = ROW_OFFSETS_20x4;
    } else if (cols == 16 && rows == 4) {
        dev->rowOffsets = ROW_OFFSETS_16x4;
    } else {
        dev->rowOffsets = ROW_OFFSETS_16x2;
    }

    pinMode(dev->dataPin, OUTPUT);
    pinMode(dev->clockPin, OUTPUT);
    pinMode(dev->latchPin, OUTPUT);

    LCD595_shift595(dev, 0x00);
    delay(50);

    LCD595_sendNibble(dev, 0x03, false);
    delayMicroseconds(4500);
    LCD595_sendNibble(dev, 0x03, false);
    delayMicroseconds(150);
    LCD595_sendNibble(dev, 0x03, false);
    delayMicroseconds(150);

    LCD595_sendNibble(dev, 0x02, false);
    delayMicroseconds(150);

    LCD595_command(dev, 0x28);             // 4-bit, 2 lines, 5x8 font
    LCD595_command(dev, dev->displayControl);
    LCD595_command(dev, 0x06);             // entry mode: increment, no shift
    LCD595_clear(dev);
}

// ── Basic commands ──────────────────────────────────────────────────────

void LCD595_clear(LCD595_t *dev)
{
    LCD595_command(dev, 0x01);
    dev->lastBigNumber = -1;
    dev->lastDisplayedValue = -1;
    dev->lastBigNumberUpdate = 0;
}

void LCD595_home(LCD595_t *dev)
{
    LCD595_command(dev, 0x02);
}

void LCD595_setCursor(LCD595_t *dev, uint8_t row, uint8_t col)
{
    if (row >= dev->rows) row = (uint8_t)(dev->rows - 1);
    if (col >= dev->cols) col = (uint8_t)(dev->cols - 1);

    uint8_t address = dev->rowOffsets[row] + col;
    LCD595_command(dev, 0x80 | address);
}

// ── Display control ─────────────────────────────────────────────────────

void LCD595_display(LCD595_t *dev)
{
    dev->displayControl |= 0x04;
    LCD595_command(dev, dev->displayControl);
}

void LCD595_noDisplay(LCD595_t *dev)
{
    dev->displayControl &= ~0x04;
    LCD595_command(dev, dev->displayControl);
}

void LCD595_cursor(LCD595_t *dev)
{
    dev->displayControl |= 0x02;
    LCD595_command(dev, dev->displayControl);
}

void LCD595_noCursor(LCD595_t *dev)
{
    dev->displayControl &= ~0x02;
    LCD595_command(dev, dev->displayControl);
}

void LCD595_blink(LCD595_t *dev)
{
    dev->displayControl |= 0x01;
    LCD595_command(dev, dev->displayControl);
}

void LCD595_noBlink(LCD595_t *dev)
{
    dev->displayControl &= ~0x01;
    LCD595_command(dev, dev->displayControl);
}

void LCD595_backlight(LCD595_t *dev, bool state)
{
    dev->backlightState = state ? LCD595_BL : 0;
    LCD595_shift595(dev, dev->backlightState);
}

// ── Character output ────────────────────────────────────────────────────

void LCD595_write(LCD595_t *dev, uint8_t value)
{
    LCD595_sendByte(dev, value, true);
}

void LCD595_print(LCD595_t *dev, const char *str)
{
    while (*str) {
        LCD595_write(dev, (uint8_t)*str++);
    }
}

void LCD595_printAt(LCD595_t *dev, uint8_t row, uint8_t col, const char *str)
{
    LCD595_setCursor(dev, row, col);
    LCD595_print(dev, str);
}

// ── Custom characters ───────────────────────────────────────────────────

void LCD595_createChar(LCD595_t *dev, uint8_t location, const uint8_t charmap[8])
{
    if (location > 15) return;

    LCD595_command(dev, 0x40 | (location << 3)); // set CGRAM address

    for (uint8_t i = 0; i < 8; i++) {
        LCD595_sendByte(dev, charmap[i], true);
    }

    LCD595_command(dev, 0x80); // back to DDRAM
}

// ── Big numbers ─────────────────────────────────────────────────────────

void LCD595_createBigNumberChars(LCD595_t *dev)
{
    LCD595_createChar(dev, LCD595_BIG_LEFT_SIDE,  BIG_LEFT_SIDE_CHAR);
    LCD595_createChar(dev, LCD595_BIG_UPPER_BAR,  BIG_UPPER_BAR_CHAR);
    LCD595_createChar(dev, LCD595_BIG_RIGHT_SIDE, BIG_RIGHT_SIDE_CHAR);
    LCD595_createChar(dev, LCD595_BIG_LEFT_END,   BIG_LEFT_END_CHAR);
    LCD595_createChar(dev, LCD595_BIG_LOWER_BAR,  BIG_LOWER_BAR_CHAR);
    LCD595_createChar(dev, LCD595_BIG_RIGHT_END,  BIG_RIGHT_END_CHAR);
    LCD595_createChar(dev, LCD595_BIG_MIDDLE_BAR, BIG_MIDDLE_BAR_CHAR);
    LCD595_createChar(dev, LCD595_BIG_LOWER_END,  BIG_LOWER_END_CHAR);

    dev->bigNumberCharsCreated = true;
}

static void LCD595_clearBigNumberArea(LCD595_t *dev, uint8_t col, uint8_t width, uint8_t startRow)
{
    if ((uint8_t)(startRow + 1) >= dev->rows) return;

    for (uint8_t r = startRow; r < startRow + 2 && r < dev->rows; r++) {
        LCD595_setCursor(dev, r, col);
        for (uint8_t i = 0; i < width && (col + i) < dev->cols; i++) {
            LCD595_write(dev, ' ');
        }
    }
}

static void LCD595_digit0(LCD595_t *dev, uint8_t col, uint8_t row)
{
    LCD595_setCursor(dev, row, col);
    LCD595_write(dev, LCD595_BIG_LEFT_SIDE);
    LCD595_write(dev, LCD595_BIG_UPPER_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);

    LCD595_setCursor(dev, row + 1, col);
    LCD595_write(dev, LCD595_BIG_LEFT_SIDE);
    LCD595_write(dev, LCD595_BIG_LOWER_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);
}

static void LCD595_digit1(LCD595_t *dev, uint8_t col, uint8_t row)
{
    LCD595_setCursor(dev, row, col);
    LCD595_write(dev, ' ');
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);
    LCD595_write(dev, ' ');

    LCD595_setCursor(dev, row + 1, col);
    LCD595_write(dev, ' ');
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);
    LCD595_write(dev, ' ');
}

static void LCD595_digit2(LCD595_t *dev, uint8_t col, uint8_t row)
{
    LCD595_setCursor(dev, row, col);
    LCD595_write(dev, LCD595_BIG_LEFT_END);
    LCD595_write(dev, LCD595_BIG_MIDDLE_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);

    LCD595_setCursor(dev, row + 1, col);
    LCD595_write(dev, LCD595_BIG_LEFT_SIDE);
    LCD595_write(dev, LCD595_BIG_LOWER_BAR);
    LCD595_write(dev, LCD595_BIG_LOWER_BAR);
}

static void LCD595_digit3(LCD595_t *dev, uint8_t col, uint8_t row)
{
    LCD595_setCursor(dev, row, col);
    LCD595_write(dev, LCD595_BIG_LEFT_END);
    LCD595_write(dev, LCD595_BIG_MIDDLE_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);

    LCD595_setCursor(dev, row + 1, col);
    LCD595_write(dev, LCD595_BIG_LOWER_END);
    LCD595_write(dev, LCD595_BIG_LOWER_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);
}

static void LCD595_digit4(LCD595_t *dev, uint8_t col, uint8_t row)
{
    LCD595_setCursor(dev, row, col);
    LCD595_write(dev, LCD595_BIG_LEFT_SIDE);
    LCD595_write(dev, LCD595_BIG_LOWER_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);

    LCD595_setCursor(dev, row + 1, col);
    LCD595_write(dev, ' ');
    LCD595_write(dev, ' ');
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);
}

static void LCD595_digit5(LCD595_t *dev, uint8_t col, uint8_t row)
{
    LCD595_setCursor(dev, row, col);
    LCD595_write(dev, LCD595_BIG_LEFT_SIDE);
    LCD595_write(dev, LCD595_BIG_MIDDLE_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_END);

    LCD595_setCursor(dev, row + 1, col);
    LCD595_write(dev, LCD595_BIG_LOWER_END);
    LCD595_write(dev, LCD595_BIG_LOWER_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);
}

static void LCD595_digit6(LCD595_t *dev, uint8_t col, uint8_t row)
{
    LCD595_setCursor(dev, row, col);
    LCD595_write(dev, LCD595_BIG_LEFT_SIDE);
    LCD595_write(dev, LCD595_BIG_MIDDLE_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_END);

    LCD595_setCursor(dev, row + 1, col);
    LCD595_write(dev, LCD595_BIG_LEFT_SIDE);
    LCD595_write(dev, LCD595_BIG_LOWER_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);
}

static void LCD595_digit7(LCD595_t *dev, uint8_t col, uint8_t row)
{
    LCD595_setCursor(dev, row, col);
    LCD595_write(dev, LCD595_BIG_UPPER_BAR);
    LCD595_write(dev, LCD595_BIG_UPPER_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);

    LCD595_setCursor(dev, row + 1, col);
    LCD595_write(dev, ' ');
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);
    LCD595_write(dev, ' ');
}

static void LCD595_digit8(LCD595_t *dev, uint8_t col, uint8_t row)
{
    LCD595_setCursor(dev, row, col);
    LCD595_write(dev, LCD595_BIG_LEFT_SIDE);
    LCD595_write(dev, LCD595_BIG_MIDDLE_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);

    LCD595_setCursor(dev, row + 1, col);
    LCD595_write(dev, LCD595_BIG_LEFT_SIDE);
    LCD595_write(dev, LCD595_BIG_LOWER_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);
}

static void LCD595_digit9(LCD595_t *dev, uint8_t col, uint8_t row)
{
    LCD595_setCursor(dev, row, col);
    LCD595_write(dev, LCD595_BIG_LEFT_SIDE);
    LCD595_write(dev, LCD595_BIG_MIDDLE_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);

    LCD595_setCursor(dev, row + 1, col);
    LCD595_write(dev, LCD595_BIG_LOWER_END);
    LCD595_write(dev, LCD595_BIG_LOWER_BAR);
    LCD595_write(dev, LCD595_BIG_RIGHT_SIDE);
}

void LCD595_printDigit(LCD595_t *dev, int digit, uint8_t col, uint8_t row)
{
    if (!dev->bigNumberCharsCreated) {
        LCD595_createBigNumberChars(dev);
    }

    if ((uint8_t)(row + 1) >= dev->rows) row = 0;
    if ((uint16_t)(col + 2) >= dev->cols) return;

    switch (digit) {
        case 0: LCD595_digit0(dev, col, row); break;
        case 1: LCD595_digit1(dev, col, row); break;
        case 2: LCD595_digit2(dev, col, row); break;
        case 3: LCD595_digit3(dev, col, row); break;
        case 4: LCD595_digit4(dev, col, row); break;
        case 5: LCD595_digit5(dev, col, row); break;
        case 6: LCD595_digit6(dev, col, row); break;
        case 7: LCD595_digit7(dev, col, row); break;
        case 8: LCD595_digit8(dev, col, row); break;
        case 9: LCD595_digit9(dev, col, row); break;
        default: LCD595_clearBigNumberArea(dev, col, 3, row); break;
    }
}

void LCD595_printBigNumber(LCD595_t *dev, int value, uint8_t col, bool clearPrevious)
{
    if (!dev->bigNumberCharsCreated) {
        LCD595_createBigNumberChars(dev);
    }

    if (value == dev->lastBigNumber && !clearPrevious) return;

    value = (int)constrain(value, 0, 99);

    if (clearPrevious || dev->lastBigNumber == -1) {
        LCD595_clearBigNumberArea(dev, col, 6, 0);
    }

    int tens = value / 10;
    int ones = value % 10;

    if (tens > 0) {
        LCD595_printDigit(dev, tens, col, 0);
    } else {
        LCD595_clearBigNumberArea(dev, col, 3, 0);
    }

    LCD595_printDigit(dev, ones, (uint8_t)(col + 4), 0);

    dev->lastBigNumber = value;
}

void LCD595_printBigNumberCentered20x4(LCD595_t *dev, int value)
{
    if (!dev->bigNumberCharsCreated) {
        LCD595_createBigNumberChars(dev);
    }

    uint32_t now = millis();
    if (now - dev->lastBigNumberUpdate < 1000) return;

    if (value == dev->lastDisplayedValue) {
        dev->lastBigNumberUpdate = now;
        return;
    }

    value = (int)constrain(value, 0, 100);

    if (dev->lastDisplayedValue != -1) {
        for (uint8_t i = 0; i < 20; i++) {
            LCD595_setCursor(dev, 1, i);
            LCD595_write(dev, ' ');
            LCD595_setCursor(dev, 2, i);
            LCD595_write(dev, ' ');
        }
    }

    if (value == 100) {
        LCD595_printDigit(dev, 1, 5, 1);
        LCD595_printDigit(dev, 0, 8, 1);
        LCD595_printDigit(dev, 0, 11, 1);
    } else {
        LCD595_printDigit(dev, value / 10, 7, 1);
        LCD595_printDigit(dev, value % 10, 10, 1);
    }

    dev->lastDisplayedValue = value;
    dev->lastBigNumberUpdate = now;
}

// ── Helpers ─────────────────────────────────────────────────────────────

void LCD595_printf(LCD595_t *dev, uint8_t row, uint8_t col, const char *format, ...)
{
    char buffer[LCD595_BUF_COLS + 1];
    va_list args;
    va_start(args, format);
    vsnprintf(buffer, sizeof(buffer), format, args);
    va_end(args);

    LCD595_printAt(dev, row, col, buffer);
}

void LCD595_centerText(LCD595_t *dev, uint8_t row, const char *text)
{
    uint8_t len = (uint8_t)strlen(text);
    if (len > dev->cols) {
        LCD595_printAt(dev, row, 0, text);
        return;
    }

    uint8_t startPos = (uint8_t)((dev->cols - len) / 2);
    LCD595_printAt(dev, row, startPos, text);
}

void LCD595_progressBar(LCD595_t *dev, uint8_t row, uint8_t percentage)
{
    if (percentage > 100) percentage = 100;

    uint8_t barWidth = (uint8_t)(dev->cols - 2);
    uint8_t filled = (uint8_t)((percentage * barWidth) / 100);

    LCD595_setCursor(dev, row, 0);
    LCD595_write(dev, '[');

    for (uint8_t i = 0; i < barWidth; i++) {
        LCD595_write(dev, i < filled ? 0xFF : '-');
    }

    LCD595_write(dev, ']');
}

void LCD595_scrollText(LCD595_t *dev, uint8_t row, const char *text, uint16_t speed_ms)
{
    int len = (int)strlen(text);
    if (len <= dev->cols) {
        LCD595_printAt(dev, row, 0, text);
        return;
    }

    char buffer[LCD595_BUF_COLS + 1];
    uint8_t cols = dev->cols;
    if (cols > LCD595_BUF_COLS) cols = LCD595_BUF_COLS;
    buffer[cols] = '\0';

    for (int i = 0; i <= len + cols; i++) {
        for (uint8_t j = 0; j < cols; j++) {
            int idx = i - cols + j;
            buffer[j] = (idx >= 0 && idx < len) ? text[idx] : ' ';
        }

        LCD595_printAt(dev, row, 0, buffer);
        delay(speed_ms);
    }
}

void LCD595_startupAnimation(LCD595_t *dev)
{
    LCD595_clear(dev);

    for (uint8_t i = 0; i < dev->cols; i++) {
        LCD595_setCursor(dev, 0, i);
        LCD595_write(dev, 0xFF);
        delay(50);
    }

    delay(200);
    LCD595_clear(dev);

    LCD595_centerText(dev, 0, "LCD HC595");
    LCD595_centerText(dev, 1, "Library Ready");
    delay(1500);
    LCD595_clear(dev);
}
