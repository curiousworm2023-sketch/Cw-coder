#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');
const os   = require('os');

// Highlight the [PICPIO] tag in console output using the brand orange
// (matches the VS Code extension's accent color), when writing to a TTY
// (or when the caller forces color, e.g. the VS Code extension's tracked
// terminal, which renders true-color ANSI correctly).
if (process.stdout.isTTY || process.env.FORCE_COLOR) {
    const ORANGE = '\x1b[38;2;242;127;12m';
    const RESET  = '\x1b[0m';
    const colorize = s => typeof s === 'string'
        ? s.replace(/\[PICPIO\]/g, `${ORANGE}[PICPIO]${RESET}`)
        : s;
    for (const fn of ['log', 'warn', 'error']) {
        const orig = console[fn].bind(console);
        console[fn] = (...a) => orig(...a.map(colorize));
    }
}

// DFP pack storage (used by resolvePack/findDFP/cmdInstallDFP below)
const PACKS_DIR             = 'C:\\picpio\\packs';
const PACK_INDEX_PATH       = path.join(PACKS_DIR, 'index.idx');
const PACK_INDEX_URL        = 'https://packs.download.microchip.com/index.idx';
const DFP_MANIFEST_PATH     = path.join(PACKS_DIR, 'manifest.json');
const PACK_INDEX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── LIB REGISTRY ────────────────────────────────────────────────────────────
// Bundled libraries live in picpio_tool/libraries/<DirName>/ as plain-C sources
// (struct + function API) written against the PICPIO HAL.
// The set of bundled libraries is discovered at runtime by scanning the
// libraries/ folders that ship with picpio (plus any project-local
// libraries/ dir) — the same search paths libAdd() copies from. This keeps
// the advertised list exactly in sync with the libraries that actually exist
// and can be installed, so `lib search` / the Library Manager never offer a
// library that would then fail to add. Drop a new <Name>/ folder under
// picpio_tool/libraries/ and it shows up automatically.
function bundledLibSearchPaths() {
    const scriptDir = path.dirname(process.argv[1]);
    return [
        path.join(process.cwd(), 'libraries'),
        path.join(scriptDir, 'libraries'),
        path.join(scriptDir, '..', 'libraries'),
    ];
}

function listBundledLibs() {
    const seen = new Map(); // lowercase key -> first-seen display name
    for (const base of bundledLibSearchPaths()) {
        if (!fs.existsSync(base)) continue;
        for (const d of fs.readdirSync(base)) {
            try { if (!fs.statSync(path.join(base, d)).isDirectory()) continue; }
            catch { continue; }
            const key = d.toLowerCase();
            if (!seen.has(key)) seen.set(key, d);
        }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// ─── LIB COMPATIBILITY ───────────────────────────────────────────────────────
// Before installing a bundled library we check it against the project's MCU.
// A library's hardware needs are inferred from its source (which HAL objects it
// calls) unless it ships a library.json that overrides them. Anything we can't
// determine is treated as compatible — we never block on a guess.
//
// library.json (all fields optional):
//   { "requires": ["i2c","spi"],     // peripherals the chip must have
//     "families": ["PIC18","PIC24"], // whitelist (omit = any family)
//     "excludeFamilies": ["PIC16"],  // blacklist
//     "depends": ["PID"],            // other bundled libs auto-installed first
//     "note": "Needs >=8KB RAM" }    // human hint shown with the warning

// Supported parts that physically lack a peripheral. The PIC16F62x/PIC16F84
// have no MSSP (USART only / nothing), so they can't run hardware I2C or SPI.
const MCU_MISSING_PERIPH = {
    i2c:  [/PIC16F62[78]/i, /PIC16F84/i],
    spi:  [/PIC16F62[78]/i, /PIC16F84/i],
    uart: [/PIC16F84A?$/i],
};

function mcuHasPeriph(mcu, periph) {
    return !(MCU_MISSING_PERIPH[periph] || []).some(re => re.test(mcu || ''));
}

function findLibDir(name) {
    const lname = (name || '').toLowerCase();
    for (const base of bundledLibSearchPaths()) {
        if (!fs.existsSync(base)) continue;
        const d = fs.readdirSync(base).find(e =>
            e.toLowerCase() === lname && fs.statSync(path.join(base, e)).isDirectory());
        if (d) return path.join(base, d);
    }
    return null;
}

function readLibManifest(dir) {
    const f = path.join(dir, 'library.json');
    if (!fs.existsSync(f)) return {};
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; }
}

// Infer required peripherals from which HAL objects the library's source calls.
function inferLibRequires(dir) {
    let src = '';
    for (const f of fs.readdirSync(dir)) {
        if (/\.(c|h|cpp|hpp)$/i.test(f)) {
            try { src += fs.readFileSync(path.join(dir, f), 'utf8'); } catch { /* skip */ }
        }
    }
    const req = [];
    if (/\b(?:i2c1|i2c2|Wire2?)\s*\./.test(src))     req.push('i2c');
    if (/\b(?:SPI2?)\s*\./.test(src))                req.push('spi');
    if (/\b(?:uart1|uart2|Serial2?)\s*\./.test(src)) req.push('uart');
    return req;
}

// Returns { ok, reasons:[...], note }. Non-bundled names (github:/http/unknown)
// are reported ok — we can't inspect them.
function checkLibCompat(name, cfg) {
    const dir = findLibDir(name);
    if (!dir) return { ok: true, reasons: [], note: '' };
    const man     = readLibManifest(dir);
    const mcu     = (cfg && cfg.mcu) || '';
    const family  = ((cfg && cfg.family) || '').toUpperCase();
    const reasons = [];

    const requires = Array.isArray(man.requires) ? man.requires : inferLibRequires(dir);
    for (const p of requires) {
        if (!mcuHasPeriph(mcu, p)) {
            reasons.push(`${mcu || 'this MCU'} has no hardware ${p.toUpperCase()} (required by this library)`);
        }
    }
    if (Array.isArray(man.families) && man.families.length &&
        !man.families.some(f => f.toUpperCase() === family)) {
        reasons.push(`supported only on ${man.families.join(', ')} (project family is ${family || 'unknown'})`);
    }
    if (Array.isArray(man.excludeFamilies) &&
        man.excludeFamilies.some(f => f.toUpperCase() === family)) {
        reasons.push(`not supported on ${family}`);
    }
    return { ok: reasons.length === 0, reasons, note: man.note || '' };
}

// Starter usage snippets injected into src/main.cpp when a bundled library
// with a known API (the picpio_tool/libraries/<Name>/ ports) is installed
// via `picpio lib add`. Only covers libraries that actually exist as plain-C
// ports under picpio_tool/libraries/ — unlisted bundled names are skipped.
const LIB_SNIPPETS = {
    PID: {
        include: '#include "PID.h"',
        globals: [
            'PID_t pid;',
            'double pidInput, pidOutput, pidSetpoint = 100;',
        ],
        setup: [
            'PID_init(&pid, &pidInput, &pidOutput, &pidSetpoint, 2.0, 0.5, 1.0, PID_DIRECT);',
            'PID_setMode(&pid, PID_AUTOMATIC);',
        ],
        loop: [
            'pidInput = analogRead(A0);',
            'PID_compute(&pid);',
            'analogWrite(D5, (uint8_t)pidOutput);',
        ],
    },
    // Auto-tuning companion for PID. Adds the serial protocol the VS Code
    // "Auto PID Tuning" panel drives (relay test + live gain changes). Assumes
    // the PID library scaffold is present (pid / pidInput / pidOutput /
    // pidSetpoint). PIDTune_service() streams telemetry + parses host commands;
    // keep your own PID_compute() — it no-ops while the tuner holds RELAY mode.
    PIDTune: {
        include: '#include "PIDTune.h"',
        globals: [
            'PIDTune_t pidtune;',
        ],
        setup: [
            'PIDTune_init(&pidtune, &pid, &pidInput, &pidOutput, &pidSetpoint);',
        ],
        loop: [
            'PIDTune_service(&pidtune);  // host auto-tuner: telemetry + live gain/relay control',
        ],
    },
    PCF8575: {
        include: '#include "PCF8575.h"',
        globals: [
            'PCF8575_t pcf8575;',
        ],
        setup: [
            'Wire.begin();',
            'PCF8575_init(&pcf8575, 0x20);',
            'PCF8575_begin(&pcf8575, 0xFFFF);',
        ],
        loop: [
            'PCF8575_write(&pcf8575, 0, HIGH);',
            'uint8_t pcf8575_btn = PCF8575_read(&pcf8575, 1);',
        ],
    },
    ADS1115: {
        include: '#include "ADS1115.h"',
        define: '#define ADS1115_ADDRESS 0x48  // change to match ADDR pin wiring (0x48-0x4B)',
        globals: [
            'ADS1115_t ads1115;',
        ],
        setup: [
            'Wire.begin();',
            'ADS1115_init(&ads1115);',
            'ADS1115_begin(&ads1115, ADS1115_ADDRESS);',
        ],
        loop: [
            'int16_t ads1115_raw   = ADS1115_readADC_SingleEnded(&ads1115, 0);',
            'float   ads1115_volts = ADS1115_computeVolts(&ads1115, ads1115_raw);',
        ],
    },
    ADS1219: {
        include: '#include "ADS1219.h"',
        define: '#define ADS1219_ADDRESS 0x40  // change to match A0/A1 pin wiring',
        globals: [
            'ADS1219_t ads1219;',
        ],
        setup: [
            'Wire.begin();',
            'ADS1219_init(&ads1219);',
            'ADS1219_begin(&ads1219, ADS1219_ADDRESS);',
            'ADS1219_setConfig(&ads1219, ADS1219_MUX_AIN0, ADS1219_GAIN_1X,',
            '                  ADS1219_DR_20SPS, ADS1219_MODE_SINGLE_SHOT, ADS1219_VREF_INTERNAL);',
        ],
        loop: [
            'int32_t ads1219_raw   = ADS1219_readSingleShot(&ads1219);',
            'float   ads1219_volts = ADS1219_computeVolts(&ads1219, ads1219_raw);',
        ],
    },
    LiquidCrystal_I2C: {
        include: '#include "LiquidCrystal_I2C.h"',
        globals: [
            'LCD_t lcd;',
        ],
        setup: [
            'Wire.begin();',
            'LCD_init(&lcd, 0x27, 16, 2);',
            'LCD_begin(&lcd, 16, 2, LCD_5x8DOTS);',
            'LCD_backlight(&lcd);',
            'LCD_setCursor(&lcd, 0, 0);',
            'LCD_print(&lcd, "Hello, World!");',
        ],
        loop: [],
    },
    SSD1306: {
        include: '#include "SSD1306.h"',
        define: '#define SSD1306_ADDRESS 0x3C  // OLED I2C address — change to 0x3D if needed',
        globals: [
            'SSD1306_t oled;',
            'uint8_t ssd1306_buf[SSD1306_BUFFER_SIZE(128, 64)];',
        ],
        setup: [
            'Wire.begin();',
            'SSD1306_init(&oled, SSD1306_ADDRESS, 128, 64, ssd1306_buf);',
            'SSD1306_begin(&oled);',
            'SSD1306_clearDisplay(&oled);',
            'SSD1306_setCursor(&oled, 0, 0);',
            'SSD1306_print(&oled, "Hello!");',
            'SSD1306_display(&oled);',
        ],
        // Multiple displays on one I2C bus, each at its own address (e.g.
        // SSD1306-compatible clones with address pins/jumpers — the genuine
        // SSD1306 itself only supports 0x3C/0x3D). Used when the user asks
        // for more than one display when installing this library.
        defaultAddrs: ['0x3C', '0x3D'],
        multi: (i, addr) => ({
            define: `#define SSD1306_ADDRESS_${i} ${addr}  // OLED #${i} I2C address — edit to match your hardware`,
            globals: [
                `SSD1306_t oled${i};`,
                `uint8_t ssd1306_buf${i}[SSD1306_BUFFER_SIZE(128, 64)];`,
            ],
            setup: [
                `SSD1306_init(&oled${i}, SSD1306_ADDRESS_${i}, 128, 64, ssd1306_buf${i});`,
                `SSD1306_begin(&oled${i});`,
                `SSD1306_clearDisplay(&oled${i});`,
                `SSD1306_setCursor(&oled${i}, 0, 0);`,
                `SSD1306_print(&oled${i}, "OLED ${i}");`,
                `SSD1306_display(&oled${i});`,
            ],
        }),
        loop: [],
    },
LCD_HC595: {
         include: '#include "LCD_HC595.h"',
         globals: [
             'LCD595_t lcd595;',
         ],
         setup: [
             'LCD595_init(&lcd595, D6, D7, D8);',
             'LCD595_begin(&lcd595, 16, 2);',
             'LCD595_backlight(&lcd595, true);',
             'LCD595_setCursor(&lcd595, 0, 0);',
             'LCD595_print(&lcd595, "Hello, World!");',
         ],
         loop: [],
     },
     HC595: {
         include: '#include "HC595.h"',
         globals: [
             'HC595_t exp;',
             '// 74HC595 output expander: 3 pins -> 8 outputs (chain chips for more).',
             '// Wire: DS=data, SHCP=clock, STCP=latch (the three pins passed below).',
         ],
         setup: [
             'HC595_init(&exp, D5, D6, D7, 1);   // data, clock, latch, numChips',
             'HC595_writePin(&exp, 0, HIGH);     // turn on output Q0',
         ],
         loop: [],
     },
     // ─── SOFTWARE (BIT-BANGED) BUSES — pure GPIO, no hardware MSSP/EUSART ────────
     SoftSPI: {
         include: '#include "SoftSPI.h"',
         globals: ['SoftSPI_t spi;  // bit-bang SPI master'],
         setup: [
             '// pins: SCK, MOSI, MISO, CS | mode 0-3 | msbFirst 1/0 | halfDelayUs (0=fast)',
             'softspi_init(&spi, D5, D6, D7, D4, 0, 1, 0);',
             'softspi_begin(&spi);',
             'softspi_select(&spi);',
             'uint8_t in = softspi_transfer(&spi, 0xA5);',
             'softspi_deselect(&spi);',
         ],
         loop: [],
     },
     SoftI2C: {
         include: '#include "SoftI2C.h"',
         globals: ['SoftI2C_t i2c;  // bit-bang I2C master (needs external pull-ups!)'],
         setup: [
             '// pins: SDA, SCL | halfUs (0=~100kHz) | useInternalPullups 0/1',
             'softi2c_init(&i2c, D4, D3, 0, 0);',
             'softi2c_begin(&i2c);',
             'uint8_t reg = 0x00;',
             'softi2c_write(&i2c, 0x68, &reg, 1);   // point device 0x68 at register 0',
             'uint8_t val;',
             'softi2c_read(&i2c, 0x68, &val, 1);    // read 1 byte back',
         ],
         loop: [],
     },
     SoftUART: {
         include: '#include "SoftUART.h"',
         globals: ['SoftUART_t ser;  // bit-bang UART 8N1'],
         setup: [
             '// pins: TX, RX | baud (9600-38400 reliable)',
             'softuart_init(&ser, D6, D7, 9600);',
             'softuart_begin(&ser);',
             'softuart_println(&ser, "SoftUART up");',
         ],
         loop: [
             'if (softuart_available(&ser)) {',
             '    int c = softuart_read(&ser);',
             '    if (c >= 0) softuart_write(&ser, (uint8_t)c);   // echo',
             '}',
         ],
     },
     // ─── DISPLAYS ───────────────────────────────────────────────────────────────
     SH110X: {
         include: '#include "SH110X.h"',
         globals: ['SH110X_t oled;', 'uint8_t oled_buf[1024];'],
         setup: [
             'Wire.begin();',
             'SH110X_init(&oled, 0x3C, 128, 64, oled_buf);',
             'SH110X_begin(&oled);',
             'SH110X_clearDisplay(&oled);',
             'SH110X_display(&oled);',
         ],
         loop: [],
     },
     ILI9341: {
         include: '#include "ILI9341.h"',
         globals: ['ILI9341_t tft;'],
         setup: [
             'SPI.begin();',
             'ILI9341_init(&tft, D10, D9, D8); // CS, DC, RST',
             'ILI9341_begin(&tft, 240, 320);',
'ILI9341_fillScreen(&tft, ILI9341_BLACK);',
          ],
          loop: [],
      },
     ILI9488: {
         include: '#include "ILI9488.h"',
         globals: ['ILI9488_t tft;'],
         setup: [
             'SPI.begin();',
             'ILI9488_init(&tft, D10, D9, D8); // CS, DC, RST',
             'ILI9488_begin(&tft, 480, 320);  // 3.5" 480x320',
             'ILI9488_fillScreen(&tft, ILI9488_BLUE);',
             'ILI9488_setTextColor(&tft, ILI9488_WHITE);',
             'ILI9488_setTextSize(&tft, 3);',
             'ILI9488_setCursor(&tft, 20, 20);',
             'ILI9488_print(&tft, "PICPIO ILI9488");',
             'ILI9488_fillCircle(&tft, 240, 200, 60, ILI9488_YELLOW);',
          ],
          loop: [],
      },
      XPT2046: {
          include: '#include "XPT2046.h"',
          globals: ['XPT2046_t touch;'],
          setup: [
              'SPI.begin();',
              'XPT2046_init(&touch, D7, D6); // CS, IRQ',
          ],
          loop: [
              'if (XPT2046_touched(&touch)) {',
              '    uint16_t tx, ty;',
              '    XPT2046_read(&touch, &tx, &ty);',
              '}',
          ],
      },
      ST7735: {
         include: '#include "ST7735.h"',
         globals: ['ST7735_t tft;'],
         setup: [
             'SPI.begin();',
             'ST7735_init(&tft, D10, D9, D8); // CS, DC, RST',
             'ST7735_begin(&tft, 128, 160);',
             'ST7735_fillScreen(&tft, 0x0000);',
         ],
         loop: [],
     },
     ST7789: {
         include: '#include "ST7789.h"',
         globals: ['ST7789_t tft;'],
         setup: [
             'SPI.begin();',
             'ST7789_init(&tft, D10, D9, D8); // CS, DC, RST',
             'ST7789_begin(&tft, 240, 240);',
'ST7789_fillScreen(&tft, 0x0000);',
          ],
          loop: [],
      },
      LVGL: {
          include: '#include "lv_conf.h"',
          globals: [
              'lv_disp_draw_buf_t draw_buf;',
              'static lv_color_t buf1[LV_HOR_RES * 10];',
              'lv_disp_drv_t disp_drv;',
              'lv_indev_drv_t indev_drv;',
          ],
          setup: [
              '// WARNING: LVGL needs 8KB+ RAM. Most PIC16/PIC18 have 2-4KB.',
              '// Use PIC24/dsPIC or PIC32 for LVGL projects.',
              '// Download LVGL to lib/LVGL/, then add lv_port_disp.c and lv_port_indev.c',
              '// to your project. Call lv_port_disp_init(&tft) and lv_port_indev_init(&touch).',
          ],
          loop: [
              'lv_timer_handler(); // Call periodically to handle LVGL tasks',
              'sys_delay(5); // LVGL tick requires ~5ms delay minimum',
          ],
      },
      DWIN: {
          include: '#include "DWIN.h"',
          globals: ['DWIN_t dwin;'],
          setup: [
              'Serial.begin(115200);',
              'DWIN_init(&dwin);',
          ],
          loop: [
              '// DWIN_setText(&dwin, page, widget, "text");',
              '// DWIN_setValue(&dwin, addr, value);',
          ],
      },
      DotStar: {
         include: '#include "DotStar.h"',
         globals: ['DotStar_t strip;'],
         setup: [
             'SPI.begin();',
             'DotStar_init(&strip, 16, D10, D11);',
             'DotStar_setPixelColor(&strip, 0, 255, 0, 0);',
             'DotStar_show(&strip);',
         ],
         loop: [],
     },
     NeoPixel: {
         include: '#include "NeoPixel.h"',
         define: '#define LED_PIN D5\n#define LED_COUNT 16',
         globals: ['NeoPixel_t strip;'],
         setup: [
             'NeoPixel_init(&strip, LED_COUNT, LED_PIN);',
             'NeoPixel_begin(&strip);',
             'NeoPixel_setPixelColor(&strip, 0, 255, 0, 0);',
             'NeoPixel_show(&strip);',
         ],
         loop: [],
     },
     HT16K33: {
         include: '#include "HT16K33.h"',
         globals: ['HT16K33_t matrix;'],
         setup: [
             'Wire.begin();',
             'HT16K33_begin(&matrix, 0x70);',
         ],
         loop: [
             'HT16K33_drawPixel(&matrix, 0, 0, true);',
             'HT16K33_writeDisplay(&matrix);',
         ],
     },
     TLC5947: {
         include: '#include "TLC5947.h"',
         globals: ['TLC5947_t tlc;'],
         setup: [
             'SPI.begin();',
             'TLC5947_init(&tlc, 1, D10, D9); // 1 board, DIN/CLK on SPI, LAT=D10, OE=D9',
             'TLC5947_begin(&tlc);',
         ],
         loop: [
             'TLC5947_setPWM(&tlc, 0, 4095);',
             'TLC5947_write(&tlc);',
         ],
     },
     // ─── ENVIRONMENTAL SENSORS ───────────────────────────────────────────────────
     BME280: {
         include: '#include "BME280.h"',
         globals: ['bme280_t bme280;'],
         setup: [
             'Wire.begin();',
             'bme280_begin(&bme280, BME280_ADDR);',
         ],
         loop: [
             'float bme280_temp = bme280_readTemperature(&bme280); // degrees C',
             'float bme280_pres = bme280_readPressure(&bme280);    // Pascals',
             'float bme280_hum  = bme280_readHumidity(&bme280);    // %RH',
         ],
     },
     BME680: {
         include: '#include "BME680.h"',
         globals: ['BME680_t bme680;'],
         setup: [
             'Wire.begin();',
             'BME680_init(&bme680, 0x77);',
             'BME680_begin(&bme680);',
         ],
         loop: [
             'float temperature = BME680_readTemperature(&bme680);',
             'float gas_res = BME680_readGas(&bme680);',
         ],
     },
     BMP280: {
         include: '#include "BMP280.h"',
         globals: ['bmp280_t bmp;'],
         setup: [
             'Wire.begin();',
             'bmp280_begin(&bmp, BMP280_ADDR);',
         ],
         loop: [
             'float bmp280_temp = bmp280_readTemperature(&bmp);        // degrees C',
             'float bmp280_pres = bmp280_readPressure(&bmp) / 100.0;   // hPa',
         ],
     },
     BMP3XX: {
         include: '#include "BMP3XX.h"',
         globals: ['BMP3XX_t bmp;'],
         setup: [
             'Wire.begin();',
             'BMP3XX_init(&bmp, 0x77);',
             'BMP3XX_begin(&bmp);',
         ],
         loop: [
             'float temp = BMP3XX_readTemperature(&bmp);',
             'float pres = BMP3XX_readPressure(&bmp) / 100.0; // hPa',
         ],
     },
     DPS310: {
         include: '#include "DPS310.h"',
         globals: ['DPS310_t dps;'],
         setup: [
             'Wire.begin();',
             'DPS310_init(&dps, 0x77);',
             'DPS310_begin(&dps);',
         ],
         loop: [
             'float pressure = DPS310_readPressure(&dps);',
             'float temperature = DPS310_readTemperature(&dps);',
         ],
     },
     LPS22: {
         include: '#include "LPS22.h"',
         globals: ['LPS22_t lps;'],
         setup: [
             'Wire.begin();',
             'LPS22_init(&lps);',
             'LPS22_begin(&lps);',
         ],
         loop: [
             'float pres = LPS22_readPressure(&lps);',
             'float temp = LPS22_readTemperature(&lps);',
         ],
     },
     LPS25: {
         include: '#include "LPS25.h"',
         globals: ['LPS25_t lps;'],
         setup: [
             'Wire.begin();',
             'LPS25_init(&lps);',
             'LPS25_begin(&lps);',
         ],
         loop: [
             'float pres = LPS25_readPressure(&lps);',
             'float temp = LPS25_readTemperature(&lps);',
         ],
     },
     SHT31: {
         include: '#include "SHT31.h"',
         globals: ['sht31_t sht;'],
         setup: [
             'Wire.begin();',
             'sht31_begin(&sht, SHT31_ADDR);',
         ],
         loop: [
             'float sht31_temp, sht31_hum;',
             'sht31_read(&sht, &sht31_temp, &sht31_hum); // degrees C, %RH',
         ],
     },
     SHT4x: {
         include: '#include "SHT4x.h"',
         globals: ['SHT4x_t sht;'],
         setup: [
             'Wire.begin();',
             'SHT4x_init(&sht, 0x44);',
         ],
         loop: [
             'float temp, hum;',
             'SHT4x_getEvent(&sht, &temp, &hum);',
         ],
     },
     AHT10: {
         include: '#include "AHT10.h"',
         globals: ['AHT10_t aht;'],
         setup: [
             'Wire.begin();',
             'AHT10_init(&aht, AHT10_ADDR);',
         ],
         loop: [
             'float aht10_temp = AHT10_readTemperature(&aht); // degrees C',
             'float aht10_hum  = AHT10_readHumidity(&aht);    // %RH',
         ],
     },
     AHT20: {
         include: '#include "AHT20.h"',
         globals: ['aht20_t aht;'],
         setup: [
             'Wire.begin();',
             'aht20_begin(&aht, AHT20_ADDR);',
         ],
         loop: [
             'float aht20_temp, aht20_hum;',
             'aht20_read(&aht, &aht20_temp, &aht20_hum); // degrees C, %RH',
         ],
     },
     HTS221: {
         include: '#include "HTS221.h"',
         globals: ['HTS221_t hts;'],
         setup: [
             'Wire.begin();',
             'HTS221_init(&hts);',
         ],
         loop: [
             'float temp = HTS221_readTemperature(&hts);',
             'float hum = HTS221_readHumidity(&hts);',
         ],
     },
     HDC1000: {
         include: '#include "HDC1000.h"',
         globals: ['HDC1000_t hdc;'],
         setup: [
             'Wire.begin();',
             'HDC1000_init(&hdc);',
         ],
         loop: [
             'float temp = HDC1000_readTemperature(&hdc);',
             'float hum = HDC1000_readHumidity(&hdc);',
         ],
     },
     SI7021: {
         include: '#include "SI7021.h"',
         globals: ['SI7021_t si;'],
         setup: [
             'Wire.begin();',
             'SI7021_begin(&si, SI7021_ADDR);',
         ],
         loop: [
             'float si7021_temp = SI7021_readTemperature(&si); // degrees C',
             'float si7021_hum  = SI7021_readHumidity(&si);    // %RH',
         ],
     },
     // ─── MOTION / IMU ────────────────────────────────────────────────────────────
     MPU6050: {
         include: '#include "MPU6050.h"',
         globals: ['mpu6050_t mpu;'],
         setup: [
             'Wire.begin();',
             'mpu6050_begin(&mpu, MPU6050_ADDR);',
         ],
         loop: [
             'float ax, ay, az;',
             'mpu6050_readAccel(&mpu, &ax, &ay, &az); // g',
             'float mpu_temp = mpu6050_readTemp(&mpu); // degrees C',
         ],
     },
     MPU9250: {
         include: '#include "MPU9250.h"',
         globals: ['MPU9250_t imu;'],
         setup: [
             'Wire.begin();',
             'MPU9250_begin(&imu, 0x68);',
         ],
         loop: [
             'float ax, ay, az, gx, gy, gz, mx, my, mz;',
             'MPU9250_readAccel(&imu, &ax, &ay, &az);',
             'MPU9250_readMag(&imu, &mx, &my, &mz);',
         ],
     },
     ICM20948: {
         include: '#include "ICM20948.h"',
         globals: ['ICM20948_t imu;'],
         setup: [
             'Wire.begin();',
             'ICM20948_init(&imu);',
             'ICM20948_begin(&imu);',
         ],
         loop: [
             'float ax, ay, az;',
             'ICM20948_readAccel(&imu, &ax, &ay, &az);',
         ],
     },
     LSM6DS3: {
         include: '#include "LSM6DS3.h"',
         globals: ['LSM6DS3_t lsm;'],
         setup: [
             'Wire.begin();',
             'LSM6DS3_init(&lsm, 0x6A);',
             'LSM6DS3_begin(&lsm);',
         ],
         loop: [
             'float ax, ay, az, gx, gy, gz;',
             'LSM6DS3_readAcceleration(&lsm, &ax, &ay, &az);',
             'LSM6DS3_readGyroscope(&lsm, &gx, &gy, &gz);',
         ],
     },
     BNO055: {
         include: '#include "BNO055.h"',
         globals: ['BNO055_t bno;'],
         setup: [
             'Wire.begin();',
             'BNO055_init(&bno, 0x28);',
             'BNO055_begin(&bno, BNO055_OPERATION_MODE_NDOF);',
         ],
         loop: [
             'bno_quat_t q = BNO055_getQuat(&bno);',
         ],
     },
     // ─── OTHER SENSORS ───────────────────────────────────────────────────────────
     INA219: {
         include: '#include "INA219.h"',
         globals: ['ina219_t ina219;'],
         setup: [
             'Wire.begin();',
             'ina219_begin(&ina219, INA219_ADDR);',
         ],
         loop: [
             'float ina219_bus_v      = ina219_busVoltage(&ina219); // Volts',
             'float ina219_current_ma = ina219_current(&ina219);    // milliAmps',
         ],
     },
     INA260: {
         include: '#include "INA260.h"',
         globals: ['INA260_t ina;'],
         setup: [
             'Wire.begin();',
             'INA260_init(&ina, 0x40);',
             'INA260_begin(&ina);',
         ],
         loop: [
             'float bus_v = INA260_getBusVoltage_V(&ina);',
             'float current_ma = INA260_getCurrent_mA(&ina);',
         ],
     },
     MCP4725: {
         include: '#include "MCP4725.h"',
         globals: ['mcp4725_t dac;'],
         setup: [
             'Wire.begin();',
             'mcp4725_begin(&dac, MCP4725_ADDR);',
         ],
         loop: [
             'mcp4725_setValue(&dac, 2048); // 50% output (0-4095)',
         ],
     },
     MCP23017: {
         include: '#include "MCP23017.h"',
         globals: ['mcp23017_t mcp;'],
         setup: [
             'Wire.begin();',
             'mcp23017_begin(&mcp, MCP23017_ADDR);',
             'mcp23017_pinMode(&mcp, 0, GPIO_OUT);',
         ],
         loop: [
             'mcp23017_write(&mcp, 0, GPIO_HIGH);',
             'sys_delay(500);',
             'mcp23017_write(&mcp, 0, GPIO_LOW);',
             'sys_delay(500);',
         ],
     },
     MCP23008: {
         include: '#include "MCP23008.h"',
         globals: ['mcp23008_t mcp;'],
         setup: [
             'Wire.begin();',
             'mcp23008_begin(&mcp, MCP23008_ADDR);',
             'mcp23008_pinMode(&mcp, 0, GPIO_OUT);',
         ],
         loop: [
             'mcp23008_write(&mcp, 0, GPIO_HIGH);',
             'sys_delay(500);',
             'mcp23008_write(&mcp, 0, GPIO_LOW);',
             'sys_delay(500);',
         ],
     },
     TCA9548A: {
         include: '#include "TCA9548A.h"',
         setup: [
             'Wire.begin();',
             'TCA9548A_selectChannel(0x70, 0); // Switch to I2C channel 0',
         ],
         loop: [],
     },
     MAX31855: {
         include: '#include "MAX31855.h"',
         globals: ['MAX31855_t max31855;'],
         setup: [
             'SPI.begin();',
             'MAX31855_init(&max31855, D10); // CS pin D10',
         ],
         loop: [
             'double temp = MAX31855_readCelsius(&max31855);',
         ],
     },
     DS3231: {
         include: '#include "DS3231.h"',
         globals: ['ds3231_t rtc;', 'ds3231_time_t now;'],
         setup: [
             'Wire.begin();',
             'ds3231_begin(&rtc, DS3231_ADDR);',
             'ds3231_time_t set = { 2026, 6, 18, 14, 30, 0 }; // y,mo,d,h,mi,s — set clock once',
             'ds3231_setTime(&rtc, &set);',
         ],
         loop: [
             'ds3231_getTime(&rtc, &now); // now.year/month/day/hour/minute/second',
             'float ds3231_temp = ds3231_getTemperature(&rtc); // degrees C',
         ],
     },
     dht22: {
         include: '#include "dht22.h"',
         globals: ['DHT22_t dht;'],
         setup: [
             'DHT22_init(&dht, D2);',
         ],
         loop: [
             'float hum = DHT22_readHumidity(&dht);',
             'float tmp = DHT22_readTemperature(&dht);',
         ],
     },
     // ─── PROXIMITY / DISTANCE ────────────────────────────────────────────────────
     VL53L0X: {
         include: '#include "VL53L0X.h"',
         globals: ['VL53L0X_t sensor;'],
         setup: [
             'Wire.begin();',
             'VL53L0X_init(&sensor);',
             'VL53L0X_setTimeout(&sensor, 500);',
             'VL53L0X_startContinuous(&sensor, 0);',
         ],
         loop: [
             'uint16_t distance = VL53L0X_readRangeContinuousMillimeters(&sensor);',
         ],
     },
     VL6180X: {
         include: '#include "VL6180X.h"',
         globals: ['VL6180X_t sensor;'],
         setup: [
             'Wire.begin();',
             'VL6180X_init(&sensor);',
         ],
         loop: [
             'uint8_t dist = VL6180X_readRange(&sensor);',
         ],
     },
     // ─── LIGHT / COLOR ───────────────────────────────────────────────────────────
     TSL2561: {
         include: '#include "TSL2561.h"',
         globals: ['TSL2561_t tsl;'],
         setup: [
             'Wire.begin();',
             'TSL2561_init(&tsl, TSL2561_ADDR_FLOAT);',
             'TSL2561_begin(&tsl);',
         ],
         loop: [
             'uint32_t lux = TSL2561_calculateLux(&tsl);',
         ],
     },
     TSL2591: {
         include: '#include "TSL2591.h"',
         globals: ['TSL2591_t tsl;'],
         setup: [
             'Wire.begin();',
             'TSL2591_init(&tsl, TSL2591_ADDR);',
             'TSL2591_begin(&tsl);',
         ],
         loop: [
             'uint32_t lum = TSL2591_getFullLuminosity(&tsl);',
             'uint16_t ir = lum >> 16;',
             'uint16_t full = lum & 0xFFFF;',
         ],
     },
     TCS34725: {
         include: '#include "TCS34725.h"',
         globals: ['TCS34725_t tcs;'],
         setup: [
             'Wire.begin();',
             'TCS34725_init(&tcs, TCS34725_INTEGRATIONTIME_50MS, TCS34725_GAIN_4X);',
             'TCS34725_begin(&tcs);',
         ],
         loop: [
             'uint16_t r, g, b, c;',
             'TCS34725_getRawData(&tcs, &r, &g, &b, &c);',
         ],
     },
     APDS9960: {
         include: '#include "APDS9960.h"',
         globals: ['APDS9960_t apds;'],
         setup: [
             'Wire.begin();',
             'APDS9960_init(&apds);',
             'APDS9960_enableGesture(&apds, true);',
         ],
         loop: [
             'uint8_t gesture = APDS9960_readGesture(&apds);',
         ],
     },
     // ─── STORAGE ────────────────────────────────────────────────────────────────
     SD: {
         include: '#include "SD.h"',
         define: '#define SD_CS D0  // SD card chip-select pin',
         globals: ['SD_t sd;', 'SD_File sd_file;'],
         setup: [
             'SPI.begin();',
             'if (SD_begin(&sd, SD_CS)) {',
             '    if (SD_open(&sd, &sd_file, "LOG.CSV", SD_APPEND)) {',
             '        SD_print(&sd_file, "booted\\n");',
             '        SD_close(&sd_file);',
             '    }',
             '}',
         ],
         loop: [
             '// SD_open(&sd, &sd_file, "LOG.CSV", SD_APPEND);',
             '// SD_print(&sd_file, "1,2,3\\n");',
             '// SD_close(&sd_file);',
         ],
     },
     // ─── NETWORK ────────────────────────────────────────────────────────────────
     W5500: {
         include: '#include "W5500.h"',
         define: '#define W5500_CS D0  // W5500 Ethernet chip-select pin',
         globals: [
             'W5500_t eth;',
             'uint8_t eth_mac[6] = {0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01};',
             'uint8_t eth_ip[4]  = {192, 168, 1, 50};',
             'uint8_t eth_sub[4] = {255, 255, 255, 0};',
             'uint8_t eth_gw[4]  = {192, 168, 1, 1};',
         ],
         setup: [
             'SPI.begin();',
             'if (W5500_begin(&eth, W5500_CS, eth_mac, eth_ip, eth_sub, eth_gw)) {',
             '    // Ethernet ready (W5500 detected)',
             '}',
         ],
         loop: [
             '// TCP client example:',
             '// uint8_t host[4] = {192, 168, 1, 10};',
             '// if (W5500_connect(&eth, 0, host, 80)) {',
             '//     W5500_send(&eth, 0, (const uint8_t *)"GET /\\r\\n\\r\\n", 9);',
             '//     uint8_t buf[64];',
             '//     uint16_t n = W5500_recv(&eth, 0, buf, sizeof buf);',
             '//     W5500_close(&eth, 0);',
             '// }',
         ],
     },
     // ─── 7-SEGMENT DISPLAYS ──────────────────────────────────────────────────────
     TM1637: {
         include: '#include "TM1637.h"',
         define: '#define TM1637_CLK D2   // RC2\n#define TM1637_DIO D3   // RC3',
         globals: ['TM1637_t disp;'],
         setup: [
             'TM1637_init(&disp, TM1637_CLK, TM1637_DIO);',
             'TM1637_setBrightness(&disp, 4);   // 0..7',
             'TM1637_showNumber(&disp, 1234);',
         ],
         loop: [],
     },
     MAX7219: {
         include: '#include "MAX7219.h"',
         define: '#define MAX7219_CS D0  // CS/LOAD = RC0   (DIN->RC1, CLK->RC5)',
         globals: ['MAX7219_t seg;'],
         setup: [
             'SPI.begin();',
             'MAX7219_init(&seg, MAX7219_CS, 4);   // 4 digits',
             'MAX7219_setBrightness(&seg, 8);      // 0..15',
             'MAX7219_showNumber(&seg, 1234);',
         ],
         loop: [],
     },
     SevenSeg: {
         include: '#include "SevenSeg.h"',
         globals: [
             'SevenSeg_t ss;',
             '// 7-segment wiring: 8 segment pins (a,b,c,d,e,f,g,dp) then one select pin per digit.',
             '// Change the pins below to match your wiring (see this chip\'s Pin Map in REFERENCE.md).',
             'uint8_t ss_seg[8] = {D0, D1, D2, D3, D4, D5, D6, D7}; // segments a,b,c,d,e,f,g,dp (use 0xFF for dp if unused)',
             'uint8_t ss_dig[4] = {D8, D9, D10, D11};               // digit-select pins, one per digit',
         ],
         setup: [
             'SevenSeg_init(&ss, ss_seg, ss_dig, 4, 0); // numDigits=4 (1..4), 0=common-cathode',
             'SevenSeg_setNumber(&ss, 1234);',
         ],
         loop: [
             'SevenSeg_refresh(&ss);   // call continuously to multiplex the digits',
         ],
     },
     Servo: {
         include: '#include "Servo.h"',
         define: '#define SERVO_PIN D9',
         globals: ['Servo_t servo;'],
         setup: [
             'Servo_attach(&servo, SERVO_PIN);',
             'Servo_write(&servo, 90); // center position (0-180)',
         ],
         loop: [
             'Servo_refresh(); // keep calling so the servo holds position',
         ],
     },
     AT24C: {
         include: '#include "AT24C.h"',
         globals: ['AT24C_t eeprom;'],
         setup: [
             'Wire.begin();',
             'AT24C_init(&eeprom, 0x50, 32768, 64); // 24LC256: addr 0x50, 32KB, 64B page',
             'AT24C_writeByte(&eeprom, 0, 42);',
             'uint8_t eeprom_v = AT24C_readByte(&eeprom, 0);',
         ],
         loop: [],
     },
     // ─── RTC ──────────────────────────────────────────────────────────────────────
     DS1307: {
         include: '#include "DS1307.h"',
         globals: ['ds1307_t rtc;', 'ds1307_time_t now;'],
         setup: [
             'Wire.begin();',
             'ds1307_begin(&rtc, DS1307_ADDR);',
             'ds1307_time_t set = { 2026, 6, 18, 14, 30, 0 }; // y,mo,d,h,mi,s — set clock once',
             'ds1307_setTime(&rtc, &set);',
         ],
         loop: [
             'ds1307_getTime(&rtc, &now); // now.year/month/day/hour/minute/second',
         ],
     },
     // ─── MORE ENVIRONMENTAL / TEMP / LIGHT SENSORS ────────────────────────────────
     HTU21DF: {
         include: '#include "HTU21DF.h"',
         globals: ['htu21df_t htu;'],
         setup: [
             'Wire.begin();',
             'htu21df_begin(&htu, HTU21DF_ADDR);',
         ],
         loop: [
             'float htu_temp = htu21df_readTemperature(&htu); // degrees C',
             'float htu_hum  = htu21df_readHumidity(&htu);    // %RH',
         ],
     },
     MCP9808: {
         include: '#include "MCP9808.h"',
         globals: ['mcp9808_t mcp9808;'],
         setup: [
             'Wire.begin();',
             'mcp9808_begin(&mcp9808, MCP9808_ADDR);',
         ],
         loop: [
             'float mcp9808_temp = mcp9808_readTemperature(&mcp9808); // degrees C',
         ],
     },
     TMP117: {
         include: '#include "TMP117.h"',
         globals: ['tmp117_t tmp117;'],
         setup: [
             'Wire.begin();',
             'tmp117_begin(&tmp117, TMP117_ADDR);',
         ],
         loop: [
             'float tmp117_temp = tmp117_readTemperature(&tmp117); // degrees C',
         ],
     },
     VEML7700: {
         include: '#include "VEML7700.h"',
         globals: ['veml7700_t veml7700;'],
         setup: [
             'Wire.begin();',
             'veml7700_begin(&veml7700, VEML7700_ADDR);',
         ],
         loop: [
             'float veml7700_lux = veml7700_readLux(&veml7700); // lux',
         ],
     },
     // ─── ADC / DAC ────────────────────────────────────────────────────────────────
     PCF8591: {
         include: '#include "PCF8591.h"',
         globals: ['pcf8591_t pcf8591;'],
         setup: [
             'Wire.begin();',
             'pcf8591_begin(&pcf8591, PCF8591_ADDR);',
         ],
         loop: [
             'uint8_t pcf8591_ain0 = pcf8591_read(&pcf8591, 0); // channel 0, 0-255',
             'pcf8591_write(&pcf8591, 128);                     // DAC out ~half scale',
         ],
     },
};

// ─── CLI ──────────────────────────────────────────────────────────────────────
// Single source of truth for the tool version. `picpio update` re-runs the
// GitHub installer, so bump this when publishing so users can tell old vs new.
const PICPIO_VERSION = '1.4.2';
// Where `picpio update` pulls the latest installer from.
const PICPIO_INSTALL_URL = 'https://raw.githubusercontent.com/curiousworm2023-sketch/Cw-coder/main/install.ps1';
// Where `picpio update --check` reads the latest published version from (the
// PICPIO_VERSION line in the repo's picpio.js). Declared up here (not down by
// cmdUpdate) because the CLI switch runs before that point -- a const defined
// later would be in its temporal dead zone when `update` dispatches.
const PICPIO_LATEST_URL = 'https://raw.githubusercontent.com/curiousworm2023-sketch/Cw-coder/main/picpio_tool/picpio.js';

const args = process.argv.slice(2);
const cmd  = args[0];

if (!cmd || cmd === '--help' || cmd === '-h') { printHelp(); process.exit(0); }
if (cmd === '--version' || cmd === '-v') { console.log(`picpio ${PICPIO_VERSION}`); process.exit(0); }

// One-line "update available" notice (from cache only, no network) on normal
// commands. Skipped for `update`/`version` so their output stays clean.
if (cmd !== 'update' && cmd !== 'version') { maybeNotifyUpdate(); }

switch (cmd) {
    case 'build':   cmdBuild(args.slice(1));  break;
    case 'upload':  cmdUpload(args.slice(1)); break;
    case 'clean':   cmdClean();               break;
    case 'monitor': cmdMonitor();             break;
    case 'init':    cmdInit(args.slice(1));   break;
    case 'reference': cmdReference();          break;
    case 'lib':          cmdLib(args.slice(1));    break;
    case 'vscode':       cmdVscode();              break;
    case 'erase':        cmdErase();               break;
    case 'install-dfp':  cmdInstallDFP(args[1]);   break;
    case 'devices':      cmdDevices(args.slice(1)); break;
    case 'doctor':       cmdDoctor(args.slice(1));   break;
    case 'update':       cmdUpdate(args.slice(1));   break;
    case 'version':      console.log(`picpio ${PICPIO_VERSION}`); break;
    default:
        console.error(`[PICPIO] Unknown command: ${cmd}`);
        printHelp();
        process.exit(1);
}

// ─── UPDATE CHECK ─────────────────────────────────────────────────────────────
// Small JSON file (next to picpio.js) caching the last update check, so the
// per-command notice never has to hit the network: { lastCheck, latest }.
function updateCachePath() { return path.join(path.dirname(process.argv[1]), '.update-check.json'); }
function readUpdateCache() { try { return JSON.parse(fs.readFileSync(updateCachePath(), 'utf8')); } catch { return null; } }
function writeUpdateCache(o) { try { fs.writeFileSync(updateCachePath(), JSON.stringify(o)); } catch { /* ignore */ } }

// Compare dotted numeric versions: 1 if a>b, -1 if a<b, 0 if equal.
function versionCmp(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d > 0 ? 1 : -1;
    }
    return 0;
}

// Fetches the latest published PICPIO_VERSION from GitHub (best-effort, with a
// timeout). cb(version|null).
function fetchLatestVersion(timeoutMs, cb) {
    let done = false;
    const finish = v => { if (!done) { done = true; cb(v); } };
    try {
        const https = require('https');
        const req = https.get(PICPIO_LATEST_URL, { headers: { 'User-Agent': 'picpio' } }, res => {
            if (res.statusCode !== 200) { res.resume(); return finish(null); }
            let data = '';
            res.on('data', d => { data += d; });
            res.on('end', () => {
                const m = data.match(/PICPIO_VERSION\s*=\s*'([^']+)'/);
                finish(m ? m[1] : null);
            });
        });
        req.on('error', () => finish(null));
        req.setTimeout(timeoutMs, () => { req.destroy(); finish(null); });
    } catch { finish(null); }
}

// Printed (to stderr, so it never corrupts a command's stdout/JSON) at the
// start of any command when the cached latest version is newer than ours. The
// cache is refreshed by `picpio update --check` and the VS Code extension's
// daily check — so this notice costs no network on a normal command.
function maybeNotifyUpdate() {
    const c = readUpdateCache();
    if (c && c.latest && versionCmp(c.latest, PICPIO_VERSION) > 0) {
        console.error(`[PICPIO] Update available: v${c.latest} (you have v${PICPIO_VERSION}). Run 'picpio update'.`);
    }
}

// ─── UPDATE ──────────────────────────────────────────────────────────────────
// `picpio update`          -> re-runs the GitHub installer (refreshes CLI, HAL,
//                             libraries, extension; XC8/MPLAB X/Node skipped).
// `picpio update --check`  -> just reports whether a newer version exists.
// `picpio update --check --json` -> machine-readable (used by the extension).
function cmdUpdate(args) {
    args = args || [];
    if (args.includes('--check') || args.includes('--check-json')) {
        const asJson = args.includes('--json') || args.includes('--check-json');
        fetchLatestVersion(8000, latest => {
            const available = !!(latest && versionCmp(latest, PICPIO_VERSION) > 0);
            if (latest) writeUpdateCache({ lastCheck: Date.now(), latest });
            if (asJson) {
                console.log(JSON.stringify({ current: PICPIO_VERSION, latest: latest || null, updateAvailable: available }));
            } else if (!latest) {
                console.warn('[PICPIO] Could not check for updates (no network?).');
            } else if (available) {
                console.log(`[PICPIO] Update available: v${latest} (you have v${PICPIO_VERSION}). Run 'picpio update'.`);
            } else {
                console.log(`[PICPIO] You are on the latest version (v${PICPIO_VERSION}).`);
            }
            process.exit(0);
        });
        return;
    }

    console.log(`[PICPIO] Updating PICPIO (current: v${PICPIO_VERSION})`);
    console.log(`[PICPIO] Fetching latest installer from GitHub...`);
    if (process.platform !== 'win32') {
        console.error('[PICPIO] Auto-update is only supported on Windows.');
        console.error(`         Re-run the installer manually: ${PICPIO_INSTALL_URL}`);
        process.exit(1);
    }
    const r = cp.spawnSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-Command', `iex (irm ${PICPIO_INSTALL_URL})`,
    ], { stdio: 'inherit' });
    if (r.error) {
        console.error(`[PICPIO] Update failed: ${r.error.message}`);
        process.exit(1);
    }
    // Now on the latest -- clear the "update available" cache.
    writeUpdateCache({ lastCheck: Date.now(), latest: PICPIO_VERSION });
    process.exit(r.status || 0);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function printHelp() {
    console.log(`
PICPIO - PIC Microcontroller Build Tool v${PICPIO_VERSION}

Usage: picpio <command> [options]

Commands:
  build         Compile the project
  build -v      Verbose build output
  build --size  Show memory usage after build
  upload        Flash firmware to device
  clean         Delete build artifacts
  monitor       Open serial monitor
  lib add       <name|github:user/repo|https://url> [--count N]
                --count N scaffolds N numbered instances (e.g. multiple
                SSD1306 displays at different I2C addresses) instead of one
  lib remove    <name>
  lib list      List installed libraries
  lib search    [query]  List available bundled libraries
  lib check     <name>   Check if a library is compatible with this MCU
  lib update    Update library registry
  init          Create a new project (use --name --mcu --family etc.)
  reference     (Re)generate REFERENCE.md (pin map + API) and DATASHEET.md
                for this project
  vscode        Generate .vscode/tasks.json and c_cpp_properties.json
  install-dfp [device|pack]  Download a Device Family Pack.
                Defaults to the [project] mcu in picpio.ini.
                Accepts any device part number (e.g. PIC16F877A)
                or DFP pack name (e.g. PIC16Fxxx_DFP).
  devices       Check whether a PICkit/ICD/Snap programmer is connected
  doctor        Check the toolchain + project health (XC8/16/32, IPE, DFPs)
  update        Update PICPIO (CLI, HAL, libraries, extension) to the latest
  update --check  Check whether a newer version is available (no install)
  version       Print the installed PICPIO version
`);
}

// ─── CONFIG PARSER ───────────────────────────────────────────────────────────
function readIni(file) {
    if (!fs.existsSync(file)) return null;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const cfg   = {};
    for (const line of lines) {
        const m = line.match(/^\s*(\w+)\s*=\s*(.+)/);
        if (m) cfg[m[1].trim()] = m[2].trim();
    }
    return cfg;
}

function requireConfig() {
    const ini = path.join(process.cwd(), 'picpio.ini');
    const cfg = readIni(ini);
    if (!cfg) {
        console.error('[PICPIO] No picpio.ini found in current directory.');
        console.error('         Run "picpio init" to create a new project.');
        process.exit(1);
    }
    return cfg;
}

// ─── TOOLCHAIN FINDER ────────────────────────────────────────────────────────
function findXC8() {
    const base = 'C:\\Program Files\\Microchip\\xc8';
    if (!fs.existsSync(base)) return null;
    const vers = fs.readdirSync(base)
        .filter(d => d.startsWith('v') && fs.existsSync(path.join(base, d, 'bin', 'xc8-cc.exe')))
        .sort((a, b) => parseFloat(b.slice(1)) - parseFloat(a.slice(1)));
    return vers.length ? path.join(base, vers[0], 'bin', 'xc8-cc.exe') : null;
}

// ─── DFP RESOLUTION (Microchip Packs Index) ──────────────────────────────────
// picpio can install the DFP for ANY Microchip device by downloading and
// querying the official pack index, instead of relying on a hardcoded list.

function loadDFPManifest() {
    try { return JSON.parse(fs.readFileSync(DFP_MANIFEST_PATH, 'utf8')); } catch { return {}; }
}

function saveDFPManifest(manifest) {
    fs.mkdirSync(PACKS_DIR, { recursive: true });
    fs.writeFileSync(DFP_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// Download (or reuse a cached copy of) Microchip's full pack index, used to
// resolve any device name to its Device Family Pack name + latest version.
function ensurePackIndex() {
    if (fs.existsSync(PACK_INDEX_PATH)) {
        const age = Date.now() - fs.statSync(PACK_INDEX_PATH).mtimeMs;
        if (age < PACK_INDEX_MAX_AGE_MS) return PACK_INDEX_PATH;
    }
    fs.mkdirSync(PACKS_DIR, { recursive: true });
    console.log('[PICPIO] Fetching Microchip pack index (one-time, ~40MB)...');
    const result = cp.spawnSync(
        `powershell -Command "Invoke-WebRequest -Uri '${PACK_INDEX_URL}' -OutFile '${PACK_INDEX_PATH}' -UseBasicParsing"`,
        [], { shell: true, stdio: 'inherit', timeout: 180000 }
    );
    if (result.status !== 0 || !fs.existsSync(PACK_INDEX_PATH)) return null;
    return PACK_INDEX_PATH;
}

// Resolve `name` to a DFP: either a device part number (e.g. "PIC16F877A",
// found by searching every pack's device list) or a DFP pack name itself
// (e.g. "PIC16Fxxx_DFP", matched directly). Returns { name, version } or null.
function resolvePack(name) {
    const idxPath = ensurePackIndex();
    if (!idxPath) return null;
    const data   = fs.readFileSync(idxPath, 'utf8');
    const target = name.toUpperCase();
    const blocks = data.split(/(?=<pdsc )/);
    for (const block of blocks) {
        if (!block.startsWith('<pdsc ')) continue;
        const nameM = block.match(/atmel:name="([^"]+)"/);
        if (!nameM || !/_DFP$/.test(nameM[1])) continue;
        const verM = block.match(/^<pdsc[^>]*\sversion="([^"]+)"/);
        if (!verM) continue;
        if (nameM[1].toUpperCase() === target) return { name: nameM[1], version: verM[1] };
        const re = new RegExp(`<atmel:device name="${target}"`, 'i');
        if (re.test(block)) return { name: nameM[1], version: verM[1] };
    }
    return null;
}

// Download + extract a pack by exact name/version into C:\picpio\packs\<name>
function downloadPack(name, version) {
    const destDir = path.join(PACKS_DIR, name);
    fs.mkdirSync(destDir, { recursive: true });
    const url = `https://packs.download.microchip.com/Microchip.${name}.${version}.atpack`;
    const tmp = path.join(os.tmpdir(), `${name}_${version}.zip`);
    console.log(`[PICPIO] Downloading ${name} v${version}...`);
    const result = cp.spawnSync(
        `powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${tmp}' -UseBasicParsing"`,
        [], { shell: true, stdio: 'inherit', timeout: 180000 }
    );
    if (result.status === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 10000) {
        console.log('[PICPIO] Extracting...');
        cp.spawnSync(
            `powershell -Command "Expand-Archive -Path '${tmp}' -DestinationPath '${destDir}' -Force"`,
            [], { shell: true, stdio: 'inherit' }
        );
        fs.rmSync(tmp, { force: true });
        return destDir;
    }
    try { fs.rmSync(tmp, { force: true }); } catch {}
    fs.rmSync(destDir, { recursive: true, force: true });
    return null;
}

// XC8 v3.x / XC16 v2.x require a DFP for device-specific headers/linker scripts.
// Search order: manifest (from a previous "picpio install-dfp") → family-name
// guess → MPLAB X packs → ~/.mchp_packs → C:\picpio\packs
function findDFP(mcu) {
    const manifest = loadDFPManifest();
    const family = manifest[(mcu || '').toUpperCase()] || dfpFamilyFor(mcu);
    if (!family) return null; // e.g. dsPIC30F: XC16 bundles headers/linker scripts, no DFP needed
    // XC8 needs the xc8/ subdirectory inside the pack
    const xc8Sub = (p) => {
        const sub = path.join(p, 'xc8');
        return fs.existsSync(sub) ? sub : (fs.existsSync(p) ? p : null);
    };
    const candidates = [
        xc8Sub(`C:\\picpio\\packs\\${family}`),
        xc8Sub(`${process.env.USERPROFILE}\\.mchp_packs\\Microchip\\${family}`),
        ...findVersionedDFP(`C:\\Program Files\\Microchip\\MPLABX`, family),
        ...findVersionedDFP(`${process.env.USERPROFILE}\\.mchp_packs\\Microchip`, family),
    ].filter(Boolean);
    for (const c of candidates) {
        if (c && fs.existsSync(c)) return c;
    }
    return null;
}

// Auto-download the DFP for `mcu` when findDFP() comes up empty, so a fresh
// checkout/build doesn't require a separate "picpio install-dfp" step.
// Returns the resolved DFP path, or null if it couldn't be resolved/downloaded.
function ensureDFP(mcu) {
    const pack = resolvePack(mcu);
    if (!pack) return null;

    const destDir = path.join(PACKS_DIR, pack.name);
    if (!(fs.existsSync(destDir) && fs.readdirSync(destDir).length > 0)) {
        const dir = downloadPack(pack.name, pack.version);
        if (!dir) return null;
        console.log(`[PICPIO] DFP installed: ${dir} (${pack.name} v${pack.version})`);
    }

    const manifest = loadDFPManifest();
    manifest[mcu.toUpperCase()] = pack.name;
    saveDFPManifest(manifest);

    return findDFP(mcu);
}

// Fast offline guess used as a fallback when no manifest entry exists yet.
function dfpFamilyFor(mcu) {
    const u = (mcu || '').toUpperCase();
    if (u.match(/PIC18F\d+K/))   return 'PIC18F-K_DFP';
    if (u.match(/PIC18F\d+J/))   return 'PIC18F-J_DFP';
    if (u.match(/PIC18F\d+Q10/)) return 'PIC18F-Q_DFP';
    if (u.match(/PIC18F/))        return 'PIC18F_DFP';
    if (u.match(/PIC16F1/))       return 'PIC12-16F1xxx_DFP';
    if (u.match(/PIC16/))         return 'PIC16Fxxx_DFP';
    if (u.match(/DSPIC30F/))      return ''; // XC16 v2.10 bundles dsPIC30F headers/linker scripts -- no DFP needed
    if (u.match(/PIC24FJ/))       return ''; // XC16 v2.10 bundles PIC24F headers/linker scripts -- no DFP needed
    if (u.match(/PIC24/))         return 'PIC24F_DFP';
    if (u.match(/DSPIC33EP/))     return ''; // XC16 v2.10 bundles dsPIC33E headers/linker scripts -- no DFP needed
    if (u.match(/DSPIC33/))       return 'dsPIC33_DFP';
    if (u.match(/PIC32MX/))       return 'PIC32MX_DFP';
    if (u.match(/PIC32MZ/))       return 'PIC32MZ_DFP';
    return 'PIC18F-K_DFP';
}

// Short family tag (PIC16/PIC18/PIC24/DSPIC/PIC32) derived from a part number.
// Used as the picpio.ini `family` default when --family isn't given.
function familyFromMcu(mcu) {
    const u = (mcu || '').toUpperCase();
    if (u.startsWith('DSPIC30')) return 'DSPIC30';
    if (u.startsWith('DSPIC33')) return 'DSPIC33';
    if (u.startsWith('DSPIC'))   return 'DSPIC';
    if (u.startsWith('PIC32'))   return 'PIC32';
    if (u.startsWith('PIC24'))   return 'PIC24';
    if (u.startsWith('PIC18'))   return 'PIC18';
    if (u.startsWith('PIC16'))   return 'PIC16';
    if (u.startsWith('PIC12'))   return 'PIC12';
    if (u.startsWith('PIC10'))   return 'PIC10';
    return 'PIC18';
}

// Picks the HAL ("picpio_compat*") variant for a given MCU.
// The "picpio" framework selects the Arduino-style HAL (vs "bare-metal").
// 'arduino' is accepted as a legacy alias so older picpio.ini files still work.
function isPicpioFw(fw) { const f = (fw || '').toLowerCase(); return f === 'picpio' || f === 'arduino'; }

function halVariantFor(mcu) {
    const u = (mcu || '').toUpperCase();
    if (u.match(/PIC16F1/)) return 'picpio_compat_pic16f1';
    if (u.match(/PIC16/))   return 'picpio_compat_pic16';
    if (u.match(/PIC18F(4550|452|2550)/)) return 'picpio_compat_pic18_classic';
    if (u.match(/DSPIC30F/)) return 'picpio_compat_pic30f';
    if (u.match(/PIC24FJ/)) return 'picpio_compat_pic24';
    if (u.match(/DSPIC33EP/)) return 'picpio_compat_dspic33e';
    return 'picpio_compat';
}

function findVersionedDFP(base, family) {
    if (!fs.existsSync(base)) return [];
    try {
        const name = family || '';
        const dirs = fs.readdirSync(base)
            .filter(d => !name || d.startsWith(name) || d.includes(name))
            .map(d => {
                const full = path.join(base, d);
                if (!fs.statSync(full).isDirectory()) return null;
                const versions = fs.readdirSync(full)
                    .filter(v => /^\d/.test(v))
                    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
                const root = versions.length ? path.join(full, versions[0]) : full;
                // XC8 needs the xc8/ subdirectory inside the DFP pack
                const xc8sub = path.join(root, 'xc8');
                return fs.existsSync(xc8sub) ? xc8sub : root;
            })
            .filter(Boolean);
        return dirs;
    } catch { return []; }
}

function findXC16() {
    const base = 'C:\\Program Files\\Microchip\\xc16';
    if (!fs.existsSync(base)) return null;
    const vers = fs.readdirSync(base)
        .filter(d => d.startsWith('v') && fs.existsSync(path.join(base, d, 'bin', 'xc16-gcc.exe')))
        .sort((a, b) => parseFloat(b.slice(1)) - parseFloat(a.slice(1)));
    return vers.length ? path.join(base, vers[0], 'bin', 'xc16-gcc.exe') : null;
}

function findXC32() {
    const base = 'C:\\Program Files\\Microchip\\xc32';
    if (!fs.existsSync(base)) return null;
    const vers = fs.readdirSync(base)
        .filter(d => d.startsWith('v') && fs.existsSync(path.join(base, d, 'bin', 'xc32-gcc.exe')))
        .sort((a, b) => parseFloat(b.slice(1)) - parseFloat(a.slice(1)));
    return vers.length ? path.join(base, vers[0], 'bin', 'xc32-gcc.exe') : null;
}

function findCompiler(family) {
    family = (family || 'PIC18').toUpperCase();
    if (family.startsWith('PIC32') || family === 'PIC32') return findXC32();
    if (family.startsWith('PIC24') || family.startsWith('DSPIC')) return findXC16();
    return findXC8();
}

// ─── PROGRAMMER DETECTION ────────────────────────────────────────────────────
// Microchip's USB vendor ID is 04D8. Known product IDs identify which tool
// (PICkit/ICD/Snap) is plugged in; unrecognized 04D8 devices still show up
// so the user knows *something* Microchip-branded is connected.
function detectProgrammers() {
    const MICROCHIP_PID_NAMES = {
        '900A': 'PICkit 3',
        '9006': 'PICkit 3 (bootloader mode)',
        '9012': 'PICkit 4',
        '9018': 'PICkit 4 (bootloader mode)',
        '9026': 'PICkit 5',
        '9007': 'MPLAB ICD 3',
        '9011': 'MPLAB ICD 4',
        '9024': 'MPLAB Snap',
    };

    const ps = "Get-PnpDevice | Where-Object { $_.InstanceId -match 'VID_04D8' -and $_.Status -eq 'OK' } | Select-Object -Property FriendlyName,InstanceId | ConvertTo-Json -Compress";
    const result = cp.spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout || !result.stdout.trim()) return [];

    let raw;
    try { raw = JSON.parse(result.stdout.trim()); } catch { return []; }
    const list = Array.isArray(raw) ? raw : [raw];

    const devices = list.map(d => {
        const m = /PID_([0-9A-Fa-f]{4})/.exec(d.InstanceId || '');
        const pid = m ? m[1].toUpperCase() : null;
        return {
            name: (pid && MICROCHIP_PID_NAMES[pid]) || d.FriendlyName || 'Unknown Microchip device',
            pid,
        };
    });

    // A single physical tool often shows up as multiple PnP entries
    // (composite USB device + HID interface) -- dedupe by PID.
    const seen = new Set();
    return devices.filter(d => {
        const key = d.pid || d.name;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function cmdDevices(args = []) {
    const devices = detectProgrammers();

    if (args.includes('--json')) {
        console.log(JSON.stringify(devices));
        return;
    }

    if (devices.length === 0) {
        console.log('[PICPIO] No PICkit / ICD / Snap programmer detected.');
        console.log('         Plug in your programmer via USB and try again');
        console.log('         (Windows can take a few seconds to recognize it after plugging in).');
        process.exitCode = 1;
        return;
    }
    console.log('[PICPIO] Connected Microchip programmers:');
    for (const d of devices) {
        console.log(`  - ${d.name}${d.pid ? ` (USB VID_04D8&PID_${d.pid})` : ''}`);
    }
}

// ─── DOCTOR ──────────────────────────────────────────────────────────────────
// One-shot health check of the toolchain + current project. Reports what's
// installed/missing so setup problems are obvious. `--json` for machine output.
function cmdDoctor(args = []) {
    const checks = [];
    // sev: 'ok' = good, 'warn' = optional/info (won't fail the check), 'fail' = real problem
    const add = (sev, label, detail, hint) => checks.push({ sev, label, detail: detail || '', hint: hint || '' });
    const yn = (cond, fail, warn) => cond ? 'ok' : (warn ? 'warn' : 'fail');

    add('ok', 'Node.js', process.version);
    add('ok', 'picpio', `v${PICPIO_VERSION}  (${path.dirname(process.argv[1])})`);

    // compilers
    const xc8 = findXC8(), xc16 = findXC16(), xc32 = findXC32();
    add(yn(xc8),       'XC8 (PIC10/12/16/18)', xc8  || 'not found', xc8  ? '' : 'Install XC8 from microchip.com or run: picpio update');
    add(yn(xc16,0,1),  'XC16 (PIC24/dsPIC)',   xc16 || 'not installed', 'Optional — only needed for PIC24/dsPIC targets');
    add(yn(xc32,0,1),  'XC32 (PIC32)',         xc32 || 'not installed', 'Optional — only needed for PIC32 targets');

    // programmer tool
    const ipe = findIPE();
    add(yn(ipe,0,1), 'MPLAB IPE (ipecmd)', ipe || 'not found', ipe ? '' : 'Install MPLAB X (IPE) — needed for upload/erase (not for build)');

    // DFP packs
    let packCount = 0;
    try { packCount = fs.readdirSync(PACKS_DIR).filter(d => /_DFP/i.test(d)).length; } catch { /* none */ }
    add(yn(packCount > 0, 0, 1), 'Device Family Packs', `${packCount} installed in ${PACKS_DIR}`,
        packCount ? '' : 'Auto-installs on first build, or run: picpio install-dfp <device>');

    // bundled libraries
    let libCount = 0;
    try { libCount = listBundledLibs().length; } catch { /* ignore */ }
    add(yn(libCount > 0, 0, 1), 'Bundled libraries', `${libCount} available (picpio lib search)`);

    // connected programmers
    let progs = [];
    try { progs = detectProgrammers(); } catch { /* ignore */ }
    add(yn(progs.length > 0, 0, 1), 'Programmer connected',
        progs.length ? progs.map(p => p.name).join(', ') : 'none detected',
        progs.length ? '' : 'Plug in a PICkit/ICD/Snap to upload (not needed to build)');

    // serial ports
    let ports = [];
    try {
        ports = cp.execSync('powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object"',
            { timeout: 5000 }).toString().trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } catch { /* ignore */ }
    add('ok', 'Serial ports', ports.length ? ports.join(', ') : 'none (only needed for the serial monitor)');

    // current project (if run inside one)
    const cfg = readIni(path.join(process.cwd(), 'picpio.ini'));
    if (cfg) {
        add('ok', 'Project', `${cfg.name || '(unnamed)'} — ${cfg.mcu} (${cfg.family}, ${cfg.framework})`);
        const need = findCompiler(cfg.family);
        add(yn(need), `Compiler for ${cfg.family}`, need || 'not found',
            need ? '' : `This project needs ${(cfg.family || '').startsWith('PIC32') ? 'XC32' : ((cfg.family || '').match(/PIC24|DSPIC/) ? 'XC16' : 'XC8')} installed`);
    }

    if (args.includes('--json')) { console.log(JSON.stringify(checks, null, 2)); return; }

    const MARK = { ok: 'OK  ', warn: '--  ', fail: 'XX  ' };
    console.log('[PICPIO] Environment check\n');
    let problems = 0;
    for (const c of checks) {
        if (c.sev === 'fail') problems++;
        console.log(`  ${MARK[c.sev]}${c.label.padEnd(26)} ${c.detail}`);
        if (c.sev !== 'ok' && c.hint) console.log(`       -> ${c.hint}`);
    }
    console.log('');
    if (problems === 0) console.log('[PICPIO] All good — ready to build & upload.');
    else { console.log(`[PICPIO] ${problems} item(s) need attention (see -> hints above).`); process.exitCode = 1; }
}

function findIPE() {
    const base = 'C:\\Program Files\\Microchip\\MPLABX';
    if (!fs.existsSync(base)) return null;
    const vers = fs.readdirSync(base)
        .filter(d => d.startsWith('v'))
        .sort((a, b) => parseFloat(b.slice(1)) - parseFloat(a.slice(1)));
    for (const v of vers) {
        // MPLAB X v6+ moved IPE to mplab_platform/mplab_ipe/
        const candidates = [
            path.join(base, v, 'mplab_platform', 'mplab_ipe', 'ipecmd.exe'),
            path.join(base, v, 'mplab_ipe', 'ipecmd.exe'),
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) return p;
        }
    }
    return null;
}

// ─── SOURCE COLLECTOR ────────────────────────────────────────────────────────
function collectSources(cfg) {
    const sources   = [];
    const includes  = [];
    const tempFiles = [];
    const root      = process.cwd();
    const srcDir    = path.join(root, cfg.src_dir || 'src');
    const libDir    = path.join(root, 'lib');
    const scriptDir = path.dirname(process.argv[1]);
    // picpio_compat: look next to picpio.js (tool-level), never required in project.
    // Classic PIC16F8xx and enhanced-midrange PIC16F1xxx parts use separate HAL variants.
    const acName = halVariantFor(cfg.mcu);
    const acDir = [
        path.join(scriptDir, acName),
        path.join(scriptDir, '..', acName),
    ].find(d => fs.existsSync(d)) || path.join(root, acName);

    // src/
    if (fs.existsSync(srcDir)) {
        scanDir(srcDir, sources, tempFiles);
        includes.push(srcDir);
    }

    // include/ (user headers, like PlatformIO)
    const incDir = path.join(root, 'include');
    if (fs.existsSync(incDir)) includes.push(incDir);

    // picpio_compat/ (tool-level, if framework = picpio)
    if (isPicpioFw(cfg.framework) && fs.existsSync(acDir)) {
        scanDir(acDir, sources, tempFiles);
        includes.push(acDir);
    }

    // lib/*/ (project-local libraries)
    if (fs.existsSync(libDir)) {
        for (const entry of fs.readdirSync(libDir)) {
            const d = path.join(libDir, entry);
            if (fs.statSync(d).isDirectory()) {
                scanDir(d, sources, tempFiles);
                includes.push(d);
            }
        }
    }

    // lib_extra_dirs (shared/external library paths, like PlatformIO)
    const extraRaw = (cfg.lib_extra_dirs || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const extraRoot of extraRaw) {
        if (!fs.existsSync(extraRoot)) {
            console.warn(`[PICPIO] lib_extra_dirs: path not found — ${extraRoot}`);
            continue;
        }
        for (const entry of fs.readdirSync(extraRoot)) {
            const d = path.join(extraRoot, entry);
            if (fs.statSync(d).isDirectory()) {
                scanDir(d, sources, tempFiles);
                includes.push(d);
            }
        }
    }

    return { sources, includes, tempFiles };
}

function scanDir(dir, out, tempOut) {
    for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
            scanDir(full, out, tempOut);
        } else if (/\.cpp$/i.test(f)) {
            // XC8 does not support .cpp — compile a temporary .c copy, then delete it
            const renamed = full.replace(/\.cpp$/i, '.c');
            fs.copyFileSync(full, renamed);
            out.push(renamed);
            if (tempOut) tempOut.push(renamed);
        } else if (/\.c$/i.test(f)) {
            out.push(full);
        }
    }
}

// ─── BUILD ────────────────────────────────────────────────────────────────────
function cmdBuild(opts) {
    const verbose  = opts.includes('-v') || opts.includes('--verbose');
    const showSize = opts.includes('--size');

    // Auto-generate .vscode/c_cpp_properties.json if missing (enables Ctrl+Click)
    if (!fs.existsSync(path.join(process.cwd(), '.vscode', 'c_cpp_properties.json'))) {
        cmdVscode();
    }

    const cfg      = requireConfig();
    const family   = (cfg.family || 'PIC18').toUpperCase();
    const mcu      = cfg.mcu || 'PIC18F27K40';
    const clock    = cfg.clock_hz || '64000000';
    const optLevel = cfg.opt_level || '2';
    const buildDir = path.join(process.cwd(), cfg.build_dir || '.picpio');

    const compiler = findCompiler(family);
    if (!compiler) {
        console.error(`[PICPIO] Compiler not found for family ${family}.`);
        console.error(`         Install XC8/XC16/XC32 from https://www.microchip.com/xc`);
        process.exit(1);
    }

    fs.mkdirSync(buildDir, { recursive: true });

    const { sources, includes, tempFiles } = collectSources(cfg);

    if (!sources.length) {
        console.error('[PICPIO] No source files found in src/ or lib/');
        process.exit(1);
    }

    const outHex  = path.join(buildDir, (cfg.name || 'firmware') + '.hex');

    const incFlags = includes.map(i => `-I"${i}"`).join(' ');

    // DFP flag (required by XC8 v3.x / XC16 v2.x for device-specific headers)
    // dsPIC30F and PIC24FJ are bundled directly in XC16 v2.10 and need no DFP at all.
    const needsDFP = !family.startsWith('PIC32') && !/DSPIC30F/.test(mcu.toUpperCase()) && !/PIC24FJ/.test(mcu.toUpperCase()) && !/DSPIC33EP/.test(mcu.toUpperCase());
    let dfpFlag = '';
    if (needsDFP) {
        let dfp = cfg.dfp_path ? cfg.dfp_path : findDFP(mcu);
        if (!dfp && !cfg.dfp_path) {
            console.log(`[PICPIO] DFP pack not found for ${mcu}; downloading automatically...`);
            dfp = ensureDFP(mcu);
        }
        if (dfp) {
            dfpFlag = `-mdfp="${dfp}"`;
            if (verbose) console.log(`[PICPIO] DFP: ${dfp}`);
        } else {
            console.warn('[PICPIO] WARNING: DFP pack not found. Build may fail.');
            console.warn('         Run: picpio install-dfp   (auto-detects the device from picpio.ini)');
            console.warn('         Or set dfp_path in picpio.ini [build] section.');
        }
    }

    let compilerFlags = '';
    if (family.startsWith('PIC32')) {
        compilerFlags = `-mprocessor=${mcu} -O${optLevel} -D_XTAL_FREQ=${clock}`;
    } else if (family.startsWith('PIC24') || family.toUpperCase().startsWith('DSPIC')) {
        // XC16's -mcpu wants the bare part number, e.g. "30F4011" not "dsPIC30F4011".
        // -mcpu alone doesn't select the device linker script -- pass -T explicitly,
        // it's found via xc16-gcc's built-in -L search of support/*/gld/.
        const xc16Cpu = mcu.replace(/^(dsPIC|PIC)/i, '');
        compilerFlags = `-mcpu=${xc16Cpu} ${dfpFlag} -O${optLevel} -D_XTAL_FREQ=${clock} -Wl,-Tp${xc16Cpu}.gld`;
    } else {
        // XC8 — lowercase MCU name required
        compilerFlags = `-mcpu=${mcu.toLowerCase()} ${dfpFlag} -O${optLevel} -D_XTAL_FREQ=${clock} -std=c99`;
    }

    const outFile = outHex;
    const srcList = sources.map(s => `"${s}"`).join(' ');
    const command = `"${compiler}" ${compilerFlags} ${incFlags} ${srcList} -o "${outFile}"`;

    console.log(`[PICPIO] Building ${cfg.name || 'firmware'} for ${mcu}...`);
    if (verbose) console.log(`[PICPIO] ${command}`);

    const result = cp.spawnSync(command, [], {
        shell: true,
        stdio: 'inherit',
        cwd:   process.cwd()
    });

    // Remove temp .c copies generated from .cpp files
    for (const tmp of tempFiles) {
        try { fs.unlinkSync(tmp); } catch (_) {}
    }

    if (result.status !== 0) {
        console.error('\n[PICPIO] BUILD FAILED');
        process.exit(result.status || 1);
    }

    console.log(`\n[PICPIO] BUILD SUCCESSFUL`);
    console.log(`[PICPIO] Output: ${outFile}`);

    // Generate compile_commands.json for IntelliSense / clangd / Ctrl+Click
    const compileCommands = sources.map(src => ({
        directory: process.cwd().replace(/\\/g, '/'),
        command:   `"${compiler.replace(/\\/g, '/')}" ${compilerFlags} ${incFlags} "${src.replace(/\\/g, '/')}"`,
        file:      src.replace(/\\/g, '/')
    }));
    fs.writeFileSync(
        path.join(process.cwd(), 'compile_commands.json'),
        JSON.stringify(compileCommands, null, 2)
    );

    if (showSize && fs.existsSync(outFile)) {
        const stat = fs.statSync(outFile);
        console.log(`[PICPIO] Output size: ${(stat.size / 1024).toFixed(1)} KB`);
    }
}

// ─── DFP HELPERS ─────────────────────────────────────────────────────────────
function getDFPName(mcuFamily) {
    return {
        'PIC18': 'PIC18F-K_DFP',
        'PIC16': 'PIC16Fxxx_DFP',
        'PIC24': 'PIC24F-GA-GB_DFP',
    }[mcuFamily] || null;
}

// ─── DFP INSTALLER FOR MPLAB X ──────────────────────────────────────────────
function ensureDFPinMPLABX(family) {
    family = family || 'PIC18F-K_DFP';

    // Where picpio keeps the DFP
    const srcDir = path.join('C:\\picpio\\packs', family);
    if (!fs.existsSync(srcDir)) {
        console.warn(`[PICPIO] DFP not found at ${srcDir}. Run "picpio install-dfp" first.`);
        return;
    }

    // Read version from pdsc
    let version = '1.0.0';
    const pdsc = path.join(srcDir, `Microchip.${family}.pdsc`);
    if (fs.existsSync(pdsc)) {
        const m = fs.readFileSync(pdsc, 'utf8').match(/release version="([^"]+)"/);
        if (m) version = m[1];
    }

    // MPLAB X (and ipecmd's -OWD flag) read packs from the shared Packs cache
    // at %USERPROFILE%\.mchp_packs\Microchip\<DFP>\<version>\ -- the same
    // location the Pack Manager downloads to. Installing into the MPLAB X
    // program directory instead leaves -OWD unable to find the pack, which
    // makes ipecmd crash silently (no output, exit code 1).
    const destDir = path.join(process.env.USERPROFILE, '.mchp_packs', 'Microchip', family, version);
    if (fs.existsSync(destDir)) return; // already installed

    console.log(`[PICPIO] Installing DFP ${family} v${version} into MPLAB X packs cache...`);
    try {
        copyDirRecursive(srcDir, destDir);
        console.log(`[PICPIO] DFP installed at ${destDir}`);
    } catch (e) {
        console.warn(`[PICPIO] Could not install DFP: ${e.message}`);
        console.warn(`[PICPIO] Manual fix: open MPLAB X → Tools → Packs → install ${family}`);
    }
}

function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath  = path.join(src,  entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// ─── UPLOAD ──────────────────────────────────────────────────────────────────
function cmdUpload(opts) {
    const cfg      = requireConfig();
    const mcu      = cfg.mcu || 'PIC18F27K40';
    const prog     = cfg.programmer || 'PICKit4';
    const buildDir = path.join(process.cwd(), cfg.build_dir || '.picpio');
    const hexFile  = path.join(buildDir, (cfg.name || 'firmware') + '.hex');

    if (!fs.existsSync(hexFile)) {
        console.log('[PICPIO] No hex file found. Building first...');
        cmdBuild([]);
    }

    const ipecmd = findIPE();
    if (!ipecmd) {
        console.error('[PICPIO] MPLAB IPE not found.');
        console.error('         Install MPLAB X from https://www.microchip.com/mplabx');
        process.exit(1);
    }

    const devices = detectProgrammers();
    if (devices.length === 0) {
        console.warn(`[PICPIO] WARNING: No PICkit/ICD/Snap detected on USB (expected ${prog}).`);
        console.warn('         Connect your programmer -- continuing anyway...');
    } else {
        console.log(`[PICPIO] Programmer detected: ${devices.map(d => d.name).join(', ')}`);
    }

    // Make sure the DFP is in MPLAB X's packs cache so ipecmd can
    // auto-discover it (it picks up the pack on its own -- passing it
    // explicitly via -OWD makes ipecmd crash with no output).
    const dfpName = getDFPName(cfg.family);
    if (dfpName) ensureDFPinMPLABX(dfpName);

    const progFlag = {
        'PICKit4': '-TPPK4',
        'PICKit5': '-TPPK5',
        'PICKit3': '-TPPK3',
        'ICD4':    '-TPICD4',
        'ICD5':    '-TPICD5',
        'Snap':    '-TPSNAP',
    }[prog] || '-TPPK4';

    // Power the target board from the programmer (e.g. power_voltage = 5.0 in
    // picpio.ini's [upload] section). Without this, ipecmd fails to find the
    // target on boards that have no separate power supply.
    const powerFlag = cfg.power_voltage ? `-W${cfg.power_voltage}` : '';
    if (powerFlag) {
        console.log(`[PICPIO] Powering target from ${prog} at ${cfg.power_voltage}V`);
    }

    // ipecmd's -P device name excludes the "PIC"/"dsPIC" prefix, e.g.
    // PIC18F27K40 -> -P18F27K40. Passing the prefix gives "Could not find
    // device:PICPIC18F27K40".
    const devPart = mcu.replace(/^(PIC|dsPIC)/i, '');

    const command = `"${ipecmd}" -P${devPart} ${progFlag} -F"${hexFile}" -M ${powerFlag} -OL`;
    console.log(`[PICPIO] Uploading to ${mcu} via ${prog}...`);
    console.log(`[PICPIO] Running: ${command}`);

    const result = cp.spawnSync(command, [], { shell: true, stdio: 'inherit' });
    if (result.error) {
        console.error(`[PICPIO] Failed to launch MPLAB IPE: ${result.error.message}`);
    }
    if (result.status !== 0) {
        console.error('[PICPIO] UPLOAD FAILED');
        process.exit(result.status || 1);
    }
    console.log('[PICPIO] UPLOAD SUCCESSFUL');
}

// ─── CLEAN ───────────────────────────────────────────────────────────────────
function cmdClean() {
    const cfg      = requireConfig();
    const buildDir = path.join(process.cwd(), cfg.build_dir || '.picpio');
    if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        console.log(`[PICPIO] Cleaned: ${buildDir}`);
    } else {
        console.log('[PICPIO] Nothing to clean.');
    }
}

// ─── MONITOR ─────────────────────────────────────────────────────────────────
function cmdMonitor() {
    const cfg  = requireConfig();
    const port = cfg.monitor_port || 'COM3';
    const baud = cfg.monitor_baud || '9600';

    // Check port actually exists before trying to open it
    try {
        const available = cp.execSync(
            'powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object"',
            { timeout: 5000 }
        ).toString().trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);

        if (available.length === 0) {
            console.error('[PICPIO] No serial ports detected. Connect your device and try again.');
            process.exit(1);
        }
        if (!available.includes(port)) {
            console.error(`[PICPIO] Port '${port}' not found. Available ports: ${available.join(', ')}`);
            console.error(`         Update monitor_port in picpio.ini to one of the above.`);
            process.exit(1);
        }
    } catch (e) {
        // If we can't check, try anyway
    }

    console.log(`[PICPIO] Serial Monitor on ${port} @ ${baud} baud — Ctrl+C to exit`);
    try {
        cp.execSync(
            `powershell -NoProfile -Command "$p=new-object System.IO.Ports.SerialPort '${port}',${baud},'None',8,'One'; $p.Open(); try { while($true){ $l=$p.ReadLine(); Write-Host $l } } finally { $p.Close() }"`,
            { stdio: 'inherit' }
        );
    } catch {}
}

// ─── ERASE ───────────────────────────────────────────────────────────────────
function cmdErase() {
    const cfg     = requireConfig();
    const mcu     = cfg.mcu || 'PIC18F27K40';
    const prog    = cfg.programmer || 'PICKit4';
    const ipecmd  = findIPE();
    if (!ipecmd) { console.error('[PICPIO] MPLAB IPE not found.'); process.exit(1); }

    const devices = detectProgrammers();
    if (devices.length === 0) {
        console.warn(`[PICPIO] WARNING: No PICkit/ICD/Snap detected on USB (expected ${prog}).`);
        console.warn('         Connect your programmer -- continuing anyway...');
    } else {
        console.log(`[PICPIO] Programmer detected: ${devices.map(d => d.name).join(', ')}`);
    }

    const dfpName = getDFPName(cfg.family);
    if (dfpName) ensureDFPinMPLABX(dfpName);

    const progFlag = {
        'PICKit4': '-TPPK4',
        'PICKit5': '-TPPK5',
        'PICKit3': '-TPPK3',
        'ICD4':    '-TPICD4',
        'ICD5':    '-TPICD5',
        'Snap':    '-TPSNAP',
    }[prog] || '-TPPK4';

    const powerFlag = cfg.power_voltage ? `-W${cfg.power_voltage}` : '';
    if (powerFlag) {
        console.log(`[PICPIO] Powering target from ${prog} at ${cfg.power_voltage}V`);
    }

    const devPart = mcu.replace(/^(PIC|dsPIC)/i, '');
    const eraseCommand = `"${ipecmd}" -P${devPart} ${progFlag} -E ${powerFlag} -OL`;
    console.log(`[PICPIO] Running: ${eraseCommand}`);
    const eraseResult = cp.spawnSync(eraseCommand, [], { shell: true, stdio: 'inherit' });
    if (eraseResult.error) {
        console.error(`[PICPIO] Failed to launch MPLAB IPE: ${eraseResult.error.message}`);
    }
}

// ─── LIB ─────────────────────────────────────────────────────────────────────
// Bundled libraries live in picpio_tool/libraries/<DirName>/ as plain-C sources
// (struct + function API) written against the PICPIO HAL.
// BUNDLED_LIBS and LIB_SNIPPETS are declared near the top of this file
// (before the CLI dispatch switch) since cmdLib runs synchronously from there.

// Insert `line` right after the last top-level #include in `content`
// (or at the top of the file if there are none).
function insertAfterLastInclude(content, line) {
    const lines = content.split('\n');
    let last = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^#include\s/.test(lines[i])) last = i;
    }
    if (last === -1) {
        lines.unshift(line, '');
    } else {
        lines.splice(last + 1, 0, line);
    }
    return lines.join('\n');
}

// Insert `lines` (joined) immediately before the boot function. PICPIO sketches
// use init()/run(); setup()/loop() are accepted as legacy aliases.
function insertBeforeSetup(content, lines) {
    if (!lines.length) return content;
    const m = content.match(/\bvoid\s+(?:init|setup)\s*\([^)]*\)/);
    if (!m) return content;
    const text = lines.join('\n') + '\n\n';
    return content.slice(0, m.index) + text + content.slice(m.index);
}

// Insert `lines` (indented) just before the closing brace of the first matching
// `void <name>(...) { ... }`, trying each name in `fnNames` (e.g. ['run','loop'])
// so it works whether the sketch uses init()/run() or setup()/loop(). Uses
// brace-depth tracking so nested braces in an existing body don't confuse it.
function insertIntoFunctionBody(content, fnNames, lines) {
    if (!lines.length) return content;
    const names = Array.isArray(fnNames) ? fnNames : [fnNames];
    for (const fnName of names) {
        const re = new RegExp(`void\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`);
        const m = content.match(re);
        if (!m) continue;

        let depth = 1;
        let i = m.index + m[0].length;
        for (; i < content.length; i++) {
            if (content[i] === '{') depth++;
            else if (content[i] === '}') { depth--; if (depth === 0) break; }
        }
        if (i >= content.length) return content;

        const body = '\n' + lines.map(l => '    ' + l).join('\n') + '\n';
        return content.slice(0, i) + body + content.slice(i);
    }
    return content;
}

// After a bundled library with a known snippet is installed, drop a starter
// #include + struct declaration + setup()/loop() calls into src/main.cpp so
// the user has working example code to build on. If `count` > 1 and the
// library declares a `multi` template (e.g. several I2C displays/sensors at
// different addresses on one bus), generate one numbered instance per count
// instead of the single default instance.
function scaffoldMainUsage(dirEntry, count) {
    // Match the snippet key case-insensitively — the folder name (e.g. "MPU6050")
    // may differ in case from the LIB_SNIPPETS key (e.g. "mpu6050").
    const snippet = LIB_SNIPPETS[dirEntry]
        || LIB_SNIPPETS[Object.keys(LIB_SNIPPETS).find(k => k.toLowerCase() === dirEntry.toLowerCase())];
    if (!snippet) return;

    const cfg = readIni(path.join(process.cwd(), 'picpio.ini'));
    if (!cfg || !isPicpioFw(cfg.framework)) return;

    // The sketch may be main.cpp or main.c.
    const srcDir = path.join(process.cwd(), cfg.src_dir || 'src');
    const mainFile = [path.join(srcDir, 'main.cpp'), path.join(srcDir, 'main.c')]
        .find(p => fs.existsSync(p));
    if (!mainFile) return;
    const mainRel = path.relative(process.cwd(), mainFile);

    let content = fs.readFileSync(mainFile, 'utf8');

    const marker = `// ---- ${dirEntry} (added by picpio lib add) ----`;
    if (content.includes(marker)) {
        console.log(`[PICPIO] ${mainRel} already has ${dirEntry} example code — skipping.`);
        return;
    }

    // If the sketch already includes this library's header (user wired it up
    // manually), don't scaffold a duplicate #include/#define/usage.
    const hdrM = (snippet.include || '').match(/["<]([^">]+)[">]/);
    if (hdrM && content.includes(hdrM[1])) {
        console.log(`[PICPIO] ${mainRel} already includes ${hdrM[1]} — skipping example scaffold.`);
        return;
    }

    let globals = snippet.globals;
    let setup   = snippet.setup;
    let loop    = snippet.loop;
    let defineLines = snippet.define ? [snippet.define] : [];

    if (count > 1 && snippet.multi) {
        const addrs = snippet.defaultAddrs || ['0x3C'];
        globals = []; setup = ['Wire.begin();']; loop = []; defineLines = [];
        for (let i = 1; i <= count; i++) {
            const part = snippet.multi(i, addrs[(i - 1) % addrs.length]);
            defineLines.push(part.define);
            globals.push(...part.globals);
            setup.push(...part.setup);
            loop.push(...(part.loop || []));
        }
    }

    // Rewrite Dn pin tokens to this MCU's native names (RC2, RB0, …) so the
    // scaffolded code matches the chip's datasheet pin labels.
    const nat = makeNativeTranslator(cfg.mcu);
    globals     = globals.map(nat);
    setup       = setup.map(nat);
    loop        = loop.map(nat);
    defineLines = defineLines.map(nat);

    content = insertIntoFunctionBody(content, ['run', 'loop'],   [marker, ...loop]);
    content = insertIntoFunctionBody(content, ['init', 'setup'], [marker, ...setup]);
    content = insertBeforeSetup(content, [marker, ...globals]);
    const includeLine = defineLines.length
        ? `${defineLines.join('\n')}\n${snippet.include}  ${marker}`
        : `${snippet.include}  ${marker}`;
    content = insertAfterLastInclude(content, includeLine);

    fs.writeFileSync(mainFile, content);
    console.log(`[PICPIO] Added ${dirEntry} example code to ${mainRel}`);
}

// Reverse of scaffoldMainUsage: strip the marked #include / #define / globals /
// setup / loop blocks that `picpio lib add` injected for `dirEntry`, so
// `picpio lib remove` cleans up src/main.* too. Marker-based, so user code that
// doesn't carry the marker is left untouched.
function unscaffoldMainUsage(dirEntry) {
    const snippet = LIB_SNIPPETS[dirEntry]
        || LIB_SNIPPETS[Object.keys(LIB_SNIPPETS).find(k => k.toLowerCase() === dirEntry.toLowerCase())];

    const cfg = readIni(path.join(process.cwd(), 'picpio.ini'));
    if (!cfg || !isPicpioFw(cfg.framework)) return;
    const srcDir = path.join(process.cwd(), cfg.src_dir || 'src');
    const mainFile = [path.join(srcDir, 'main.cpp'), path.join(srcDir, 'main.c')]
        .find(p => fs.existsSync(p));
    if (!mainFile) return;
    const mainRel = path.relative(process.cwd(), mainFile);

    const marker   = `// ---- ${dirEntry} (added by picpio lib add) ----`;
    const markerLc = marker.toLowerCase();   // match case-insensitively (user may type "sd"/"SD")
    const content  = fs.readFileSync(mainFile, 'utf8');
    if (!content.toLowerCase().includes(markerLc)) return;

    // #define macro names this snippet added (removed even if the value was
    // edited, e.g. a changed I2C address).
    const defNames = [];
    if (snippet && snippet.define) {
        for (const dl of snippet.define.split('\n')) {
            const dm = dl.match(/^\s*#define\s+(\w+)/);
            if (dm) defNames.push(dm[1]);
        }
    }
    const isAddedDefine = (line) => defNames.some(n => new RegExp(`^\\s*#define\\s+${n}\\b`).test(line));
    const ANY_MARK = '(added by picpio lib add)';

    const lines = content.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const t = line.trim();
        if (line.toLowerCase().includes(markerLc) && t.startsWith('#include')) { i++; continue; }  // marked include
        if (isAddedDefine(line))                               { i++; continue; }  // our #define
        if (t.toLowerCase() === markerLc) {                                         // a block
            if (out.length && out[out.length - 1].trim() === '') out.pop();         // drop separator above
            i++;                                                                    // skip marker line
            while (i < lines.length) {
                const bt = lines[i].trim();
                if (bt === '' || bt === '}' || bt.startsWith('void ') || lines[i].includes(ANY_MARK)) break;
                i++;
            }
            if (i < lines.length && lines[i].trim() === '') i++;                     // drop trailing blank
            continue;
        }
        out.push(line); i++;
    }
    const result = out.join('\n');
    if (result !== content) {
        fs.writeFileSync(mainFile, result);
        console.log(`[PICPIO] Removed ${dirEntry} example code from ${mainRel}`);
    }
}

function cmdLib(args) {
    const sub = args[0];
    if (!sub) { console.log('Usage: picpio lib <add|remove|list|search|check|update>'); return; }

    if (sub === 'list') {
        const libDir = path.join(process.cwd(), 'lib');
        if (!fs.existsSync(libDir)) { console.log('[PICPIO] No libraries installed.'); return; }
        const libs = fs.readdirSync(libDir).filter(d => fs.statSync(path.join(libDir, d)).isDirectory());
        if (!libs.length) { console.log('[PICPIO] No libraries installed.'); return; }
        console.log('[PICPIO] Installed libraries:');
        libs.forEach(l => console.log(`  - ${l}`));
        return;
    }

    if (sub === 'update') {
        console.log('[PICPIO] Registry is bundled — no update needed for bundled libraries.');
        return;
    }

    if (sub === 'add') {
        const name = args[1];
        if (!name) { console.error('[PICPIO] Usage: picpio lib add <name>'); process.exit(1); }
        const countIdx = args.indexOf('--count');
        const count = countIdx >= 0 ? (parseInt(args[countIdx + 1], 10) || 1) : 1;
        const force = args.includes('--force') || args.includes('-f');
        libAdd(name, count, force);
        return;
    }

    // Report whether a library is compatible with the current project's MCU
    // without installing it. `--json` prints machine-readable output for the
    // whole registry (used by the VS Code Library Manager).
    if (sub === 'check') {
        const cfg = readIni(path.join(process.cwd(), 'picpio.ini'));
        if (args.includes('--json')) {
            const out = listBundledLibs().map(n => {
                const c = checkLibCompat(n, cfg);
                return { name: n, ok: c.ok, reasons: c.reasons, note: c.note };
            });
            console.log(JSON.stringify(out));
            return;
        }
        const name = args[1];
        if (!name) { console.error('[PICPIO] Usage: picpio lib check <name> [--json]'); process.exit(1); }
        const c = checkLibCompat(name, cfg);
        if (c.ok) {
            console.log(`[PICPIO] '${name}' is compatible with ${cfg ? cfg.mcu : 'this project'}.`);
        } else {
            console.warn(`[PICPIO] '${name}' may NOT be compatible with ${cfg ? cfg.mcu : 'this project'}:`);
            c.reasons.forEach(r => console.warn(`         - ${r}`));
            if (c.note) console.warn(`         note: ${c.note}`);
        }
        return;
    }

    if (sub === 'remove') {
        const name = args[1];
        if (!name) { console.error('[PICPIO] Usage: picpio lib remove <name>'); process.exit(1); }
        libRemove(name);
        return;
    }

    if (sub === 'search') {
        const q = (args[1] || '').toLowerCase();
        const libs = listBundledLibs().filter(l => !q || l.toLowerCase().includes(q));
        if (!libs.length) {
            console.log(q
                ? `[PICPIO] No bundled library matches "${args[1]}".`
                : '[PICPIO] No bundled libraries found.');
            return;
        }
        console.log('[PICPIO] Available libraries:');
        libs.forEach(l => console.log(`  ${l}`));
        return;
    }

    console.error(`[PICPIO] Unknown lib subcommand: ${sub}`);
}

function libAdd(name, count, force) {
    const libDir = path.join(process.cwd(), 'lib');
    fs.mkdirSync(libDir, { recursive: true });

    // Compatibility guard: warn (and stop) if the bundled library can't run on
    // the project's MCU. Skipped for github:/http downloads (can't inspect) and
    // overridable with --force.
    if (!name.startsWith('github:') && !name.startsWith('http')) {
        const cfg = readIni(path.join(process.cwd(), 'picpio.ini'));
        const compat = checkLibCompat(name, cfg);
        if (!compat.ok) {
            console.warn(`[PICPIO] '${name}' may NOT be compatible with ${cfg ? cfg.mcu : 'this project'}:`);
            compat.reasons.forEach(r => console.warn(`         - ${r}`));
            if (compat.note) console.warn(`         note: ${compat.note}`);
            if (!force) {
                console.warn(`         Not installed. Re-run with --force to install anyway:`);
                console.warn(`           picpio lib add ${name} --force`);
                return;
            }
            console.warn(`         --force given: installing anyway.`);
        }
    }

    // GitHub shorthand
    if (name.startsWith('github:')) {
        const repo = name.slice(7);
        const url  = `https://github.com/${repo}/archive/refs/heads/main.zip`;
        console.log(`[PICPIO] Downloading from GitHub: ${repo}`);
        downloadAndExtract(url, libDir, repo.split('/').pop());
        return;
    }

    // Direct URL
    if (name.startsWith('http://') || name.startsWith('https://')) {
        const fname = path.basename(name);
        console.log(`[PICPIO] Downloading: ${name}`);
        downloadFile(name, path.join(libDir, fname));
        return;
    }

    // Install declared dependencies first (library.json "depends": ["PID"]),
    // so e.g. PIDTune gets PID's headers + scaffold before its own.
    const selfDir = findLibDir(name);
    if (selfDir) {
        const deps = readLibManifest(selfDir).depends;
        if (Array.isArray(deps)) {
            for (const dep of deps) {
                const already = fs.existsSync(libDir) &&
                    fs.readdirSync(libDir).some(d => d.toLowerCase() === dep.toLowerCase());
                if (!already) {
                    console.log(`[PICPIO] '${name}' requires '${dep}' — installing it first.`);
                    libAdd(dep, 1, force);
                }
            }
        }
    }

    // Bundled library — copy from picpio_tool/libraries/<DirName>/
    const lname    = name.toLowerCase();
    const scriptDir = path.dirname(process.argv[1]);

    const searchPaths = [
        path.join(process.cwd(), 'libraries'),
        path.join(scriptDir, 'libraries'),
        path.join(scriptDir, '..', 'libraries'),
    ];

    let found = false;
    for (const base of searchPaths) {
        if (!fs.existsSync(base)) continue;
        const dirEntry = fs.readdirSync(base).find(d =>
            fs.statSync(path.join(base, d)).isDirectory() && d.toLowerCase() === lname
        );
        if (dirEntry) {
            const src  = path.join(base, dirEntry);
            const dest = path.join(libDir, dirEntry);
            fs.mkdirSync(dest, { recursive: true });
            const files = fs.readdirSync(src).filter(f => fs.statSync(path.join(src, f)).isFile());
            files.forEach(f => fs.copyFileSync(path.join(src, f), path.join(dest, f)));
            console.log(`[PICPIO] Installed library '${dirEntry}' (${files.length} files)`);
            updateIniLibs(dirEntry);
            scaffoldMainUsage(dirEntry, count);
            writeLibraryReference(dirEntry, src);    // per-library <Name>_reference.md
            refreshVscodeConfig();               // re-index so IntelliSense sees the new header
            found = true;
            break;
        }
    }

    if (!found) {
        console.error(`[PICPIO] Library '${name}' not found in bundled registry.`);
        console.log(`         Try: picpio lib add github:user/${name}`);
        console.log(`         Or:  picpio lib add https://url/to/library.h`);
    }
}

function libRemove(name) {
    const libRoot = path.join(process.cwd(), 'lib');
    // Resolve the real folder name case-insensitively (user may type "sd"/"SD").
    let actual = name;
    if (fs.existsSync(libRoot)) {
        const found = fs.readdirSync(libRoot).find(d =>
            d.toLowerCase() === name.toLowerCase() && fs.statSync(path.join(libRoot, d)).isDirectory());
        if (found) actual = found;
    }
    const libDir    = path.join(libRoot, actual);
    const hadFolder = fs.existsSync(libDir);

    // Always strip the scaffolded code + ini entry, even if the lib/ folder was
    // already deleted — otherwise stranded example code (and a broken #include)
    // would be left in main.* with no way to clean it via the tool.
    unscaffoldMainUsage(actual);                 // strip its code from main.* first
    if (hadFolder) fs.rmSync(libDir, { recursive: true, force: true });
    try { fs.unlinkSync(path.join(process.cwd(), `${actual}_reference.md`)); } catch {} // drop its per-lib reference
    removeIniLib(actual);                        // drop it from picpio.ini [libraries]
    refreshVscodeConfig();                       // re-index so IntelliSense drops the removed header

    if (hadFolder) console.log(`[PICPIO] Removed library '${actual}'`);
    else           console.log(`[PICPIO] '${actual}' folder was already gone — cleaned its code + picpio.ini entry`);
}

function removeIniLib(name) {
    const iniPath = path.join(process.cwd(), 'picpio.ini');
    if (!fs.existsSync(iniPath)) return;
    let text = fs.readFileSync(iniPath, 'utf8');
    const m = text.match(/^installed\s*=\s*(.*)$/m);
    if (!m) return;
    const existing = m[1].split(',').map(s => s.trim()).filter(Boolean)
        .filter(l => l.toLowerCase() !== name.toLowerCase());
    text = text.replace(/^installed\s*=.*$/m, `installed  = ${existing.join(', ')}`);
    fs.writeFileSync(iniPath, text);
}

function updateIniLibs(name) {
    const iniPath = path.join(process.cwd(), 'picpio.ini');
    if (!fs.existsSync(iniPath)) return;
    let text = fs.readFileSync(iniPath, 'utf8');
    const m  = text.match(/^installed\s*=\s*(.*)$/m);
    if (m) {
        const existing = m[1].split(',').map(s => s.trim()).filter(Boolean);
        if (!existing.includes(name)) {
            existing.push(name);
            text = text.replace(/^installed\s*=.*$/m, `installed  = ${existing.join(', ')}`);
            fs.writeFileSync(iniPath, text);
        }
    }
}

function downloadFile(url, dest) {
    const result = cp.spawnSync(
        `powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${dest}'"`,
        [], { shell: true, stdio: 'inherit' }
    );
    if (result.status !== 0) console.error('[PICPIO] Download failed.');
}

function downloadAndExtract(url, libDir, name) {
    const tmp = path.join(os.tmpdir(), `picpio_${Date.now()}.zip`);
    downloadFile(url, tmp);
    if (!fs.existsSync(tmp)) return;
    const dest = path.join(libDir, name);
    fs.mkdirSync(dest, { recursive: true });
    cp.spawnSync(
        `powershell -Command "Expand-Archive -Path '${tmp}' -DestinationPath '${dest}' -Force"`,
        [], { shell: true, stdio: 'inherit' }
    );
    fs.rmSync(tmp, { force: true });
    console.log(`[PICPIO] Installed '${name}'`);
    updateIniLibs(name);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
// ─── REFERENCE.md GENERATOR ──────────────────────────────────────────────────
// Builds a per-project REFERENCE.md from the selected MCU's HAL header: the full
// pin map (pin number <-> native port pin <-> analog channel), the available
// PICPIO API, and copy-paste usage. Everything except the API prose is derived by
// lightly preprocessing the HAL's Picpio.h with the device macro the real compiler
// predefines, so the table always matches what actually compiles for that chip.

function deviceMacrosFor(mcu) {
    const set = new Set();
    if (!mcu) return set;
    if (/^PIC1[68]/i.test(mcu)) set.add('_' + mcu.replace(/^PIC/i, ''));  // XC8: _16F877A, _18F47K40
    set.add('__' + mcu + '__');                                          // XC16: __dsPIC30F2010__
    return set;
}

// Build a function that rewrites Dn/An pin tokens (D5, A0, …) into that MCU's
// native port-pin name (RC5, RA0, …) using its HAL pin map. Used so all visible
// example code — scaffolded sketches and generated references — shows the
// chip's real pin names while the stored snippets stay portable Dn. Falls back
// to identity if the HAL can't be parsed or a pin has no native name.
function makeNativeTranslator(mcu) {
    try {
        const halDir = resolveHalDir(mcu);
        if (!halDir) return (s) => s;
        const h = parseHalHeader(halDir, mcu);
        return (s) => String(s).replace(/\b([DA])(\d+)\b/g, (m, p, n) => {
            const v = h.resolve(p + n);
            return (v != null && h.nativeByVal[v]) ? h.nativeByVal[v] : m;
        });
    } catch (_) {
        return (s) => s;
    }
}

function resolveHalDir(mcu) {
    const scriptDir = path.dirname(process.argv[1]);
    const acName = halVariantFor(mcu);
    return [
        path.join(scriptDir, acName),
        path.join(scriptDir, '..', acName),
        path.join(process.cwd(), acName),
    ].find(d => fs.existsSync(path.join(d, 'Picpio.h')));
}

// Tiny C preprocessor: keep only lines whose #if/#ifdef/#ifndef/#elif/#else nesting
// is active for the given predefined macros, tracking #define/#undef as it goes so
// derived macros (e.g. PICPIO_HAS_PORTDE) resolve too. Splices line continuations.
// Returns { text } of surviving non-directive lines and { macros } name->value for
// every active #define (the directive lines themselves are consumed).
function preprocessHeader(text, predefined) {
    const joined = text.replace(/\\\r?\n/g, ' ');
    const out = [];
    const macros = new Map();
    for (const n of predefined) macros.set(n, '1');
    const has = (n) => macros.has(n);
    const stack = [];                       // { active, taken, parent }
    const active = () => stack.every(s => s.active);
    const evalExpr = (expr) => {
        let e = expr.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/, '');
        e = e.replace(/defined\s*\(\s*([A-Za-z_]\w*)\s*\)/g, (_, n) => has(n) ? '1' : '0');
        e = e.replace(/defined\s+([A-Za-z_]\w*)/g, (_, n) => has(n) ? '1' : '0');
        e = e.replace(/[A-Za-z_]\w*/g, '0'); // any remaining identifier -> 0
        e = e.replace(/[^0-9()!&|<>=+\-*/% :?]/g, ' ');
        try { return !!Function('"use strict";return (' + e + ')')(); } catch { return false; }
    };
    for (const line of joined.split('\n')) {
        const m = line.match(/^\s*#\s*(ifdef|ifndef|if|elif|else|endif|define|undef)\b(.*)$/);
        if (m) {
            const dir = m[1], rest = m[2].trim();
            if (dir === 'ifdef' || dir === 'ifndef') {
                const parent = active();
                let cond = has(rest.split(/\s+/)[0]);
                if (dir === 'ifndef') cond = !cond;
                stack.push({ active: parent && cond, taken: parent && cond, parent });
            } else if (dir === 'if') {
                const parent = active(), cond = evalExpr(rest);
                stack.push({ active: parent && cond, taken: parent && cond, parent });
            } else if (dir === 'elif') {
                const top = stack[stack.length - 1];
                if (top) {
                    const cond = evalExpr(rest);
                    if (top.parent && !top.taken && cond) { top.active = true; top.taken = true; }
                    else top.active = false;
                }
            } else if (dir === 'else') {
                const top = stack[stack.length - 1];
                if (top) { top.active = top.parent && !top.taken; top.taken = top.taken || top.active; }
            } else if (dir === 'endif') {
                stack.pop();
            } else if (dir === 'define') {
                if (active()) {
                    const dm = rest.match(/^([A-Za-z_]\w*)\s*(.*)$/);
                    if (dm && !macros.has(dm[1])) macros.set(dm[1], dm[2].trim());
                }
            } else if (dir === 'undef') {
                if (active()) macros.delete(rest.split(/\s+/)[0]);
            }
            continue;
        }
        if (active()) out.push(line);
    }
    return { text: out.join('\n'), macros };
}

function parseHalHeader(halDir, mcu) {
    const { text, macros } = preprocessHeader(fs.readFileSync(path.join(halDir, 'Picpio.h'), 'utf8'), deviceMacrosFor(mcu));

    const defs = {};
    for (const [k, v] of macros) { const tok = (v || '').match(/^[^\s/]+/); defs[k] = tok ? tok[0] : ''; }
    const resolve = (tok, seen) => {
        if (tok == null) return null;
        if (/^0x[0-9a-f]+$/i.test(tok)) return parseInt(tok, 16);
        if (/^\d+$/.test(tok)) return parseInt(tok, 10);
        seen = seen || new Set();
        if (defs[tok] != null && !seen.has(tok)) { seen.add(tok); return resolve(defs[tok], seen); }
        return null;
    };

    const names = Object.keys(defs);
    const dPins = names.filter(n => /^D\d+$/.test(n)).sort((a, b) => resolve(a) - resolve(b));
    const aPins = names.filter(n => /^A\d+$/.test(n)).sort((a, b) => (+a.slice(1)) - (+b.slice(1)));
    const natives = names.filter(n => /^R[A-Z]\d+$/.test(n));
    const nativeByVal = {}, analogByVal = {};
    for (const n of natives) { const v = resolve(n); if (v != null && nativeByVal[v] == null) nativeByVal[v] = n; }
    for (const a of aPins)   { const v = resolve(a); if (v != null) analogByVal[v] = a; }

    const grabExtern = (type, nm) => {
        const m = text.match(new RegExp('extern\\s+' + type + '\\s+' + nm + '\\s*;[ \\t]*(?://[ \\t]*(.*))?'));
        return m ? { present: true, note: (m[1] || '').trim() } : { present: false, note: '' };
    };
    const grabProto = (sig) => {
        const m = text.match(new RegExp(sig + '[^;]*;[ \\t]*(?://[ \\t]*(.*))?'));
        return m && m[1] ? m[1].trim() : '';
    };

    return {
        resolve, dPins, aPins, nativeByVal, analogByVal, ledVal: resolve('LED_BUILTIN'),
        serial:  grabExtern('HardwareSerial_t', 'Serial'),
        serial2: grabExtern('HardwareSerial_t', 'Serial2'),
        wire:    grabExtern('TwoWire_t', 'Wire'),
        wire2:   grabExtern('TwoWire_t', 'Wire2'),
        spi:     grabExtern('SPIClass_t', 'SPI'),
        spi2:    grabExtern('SPIClass_t', 'SPI2'),
        analogReadNote:  grabProto('int\\s+analogRead\\(uint8_t pin\\)'),
        analogWriteNote: grabProto('void\\s+analogWrite\\(uint8_t pin, uint8_t duty\\)'),
        hasADC: aPins.length > 0,
        hasInterrupt: /\battachInterrupt\s*\(/.test(text),
        hasTone: /\bvoid\s+tone\s*\(/.test(text),
        hasEEPROM: /\bEEPROM_read\s*\(/.test(text),
    };
}

// Parse a library header for its public functions and emit a standalone
// per-library reference (e.g. HC595_reference.md). Function prototypes are read
// straight from the .h: the `//` comment block above a prototype (or a trailing
// `//` on the same line) becomes its description. Members inside typedef structs
// and function-pointer fields are skipped, so only the real C API is listed.
function buildLibraryReferenceMd(libName, headerText, snippet, nat) {
    const L = [];
    const p = (...s) => L.push(...s);
    const tr = nat || ((s) => s);   // Dn -> native pin-name translator

    // Render the library's install snippet as a complete, ready-to-run sketch so
    // the reference shows real usage — the same code `picpio lib add` scaffolds.
    const renderExample = () => {
        if (!snippet || !snippet.include) return null;
        const defines = (snippet.define ? [snippet.define] : []).map(tr);
        const globals = (snippet.globals || []).map(tr);
        const setup   = (snippet.setup   || []).map(tr);
        const loop    = (snippet.loop    || []).map(tr);
        const out = ['#include <Picpio.h>'];
        for (const d of defines) out.push(d);
        out.push(snippet.include, '');
        for (const g of globals) out.push(g);
        if (globals.length) out.push('');
        out.push('void init() {');
        for (const s of setup) out.push('    ' + s);
        out.push('}', '', 'void run() {');
        for (const s of loop) out.push('    ' + s);
        out.push('}');
        return out.join('\n');
    };

    // File-level description: the first multi-line `//` block near the top.
    let fileDesc = '';
    {
        const lines = headerText.split(/\r?\n/);
        const block = [];
        for (const ln of lines) {
            const m = ln.match(/^\s*\/\/\s?(.*)$/);
            if (m) { block.push(m[1].replace(/[─-]{3,}.*$/, '').trim()); }
            else if (block.length >= 2) break;        // keep the first real block
            else if (block.length) block.length = 0;  // a 1-line stray; keep looking
        }
        fileDesc = block.join(' ').replace(/\s+/g, ' ').trim();
    }

    p(`# ${libName} — Library Reference`, '');
    p(`> Auto-generated from \`${libName}.h\` when the library was installed. Lists the functions this library makes available.`, '');
    if (fileDesc) p(fileDesc, '');

    const example = renderExample();
    if (example) {
        p('## Usage Example', '');
        p(`A complete sketch — this is the same starter code \`picpio lib add ${libName}\` drops into \`main.c\`:`, '');
        p('```c', example, '```', '');
    }

    // Walk the header, tracking brace depth so struct members are skipped.
    const lines = headerText.split(/\r?\n/);
    let depth = 0;
    let pending = [];                                  // preceding // comment lines
    const protoRe = /^\s*(?:extern\s+)?((?:const\s+|unsigned\s+|signed\s+|struct\s+)?[A-Za-z_]\w*(?:\s*\*+)?)\s+([A-Za-z_]\w*)\s*\(([^;{]*)\)\s*;/;
    const fns = [];
    for (let raw of lines) {
        const line = raw.replace(/\t/g, ' ');
        const commentOnly = line.match(/^\s*\/\/\s?(.*)$/);
        if (commentOnly && depth === 0) {
            const t = commentOnly[1];
            if (/^[─=-]{3,}/.test(t.trim())) { continue; }   // skip rule-only lines
            pending.push(t.trim());
            continue;
        }

        // Try to match a top-level prototype BEFORE counting this line's braces.
        let matched = false;
        if (depth === 0) {
            const m = line.match(protoRe);
            if (m && !/^\s*typedef\b/.test(line) && !/\(\s*\*/.test(line) &&
                !/^\s*#/.test(line) && m[2] !== 'if' && m[2] !== 'while' && m[2] !== 'for') {
                const ret  = m[1].replace(/\s+/g, ' ').trim();
                const fn   = m[2];
                const args = m[3].replace(/\s+/g, ' ').trim();
                const trail = (line.match(/;\s*\/\/\s?(.*)$/) || [])[1];
                let desc = pending.filter(Boolean).join(' ').trim();
                if (!desc && trail) desc = trail.trim();
                fns.push({ sig: `${ret} ${fn}(${args || 'void'})`, fn, desc });
                matched = true;
            }
        }

        // Update brace depth (after the prototype test, so a `typedef struct {`
        // opener correctly starts skipping its members on the next line).
        for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') depth = Math.max(0, depth - 1); }
        if (!matched) pending = [];
    }

    if (fns.length) {
        p('## Functions', '');
        for (const f of fns) {
            p('```c', f.sig + ';', '```');
            if (f.desc) p(f.desc.replace(/\s+/g, ' ').trim(), '');
            else p('');
        }
    } else {
        p('_No public C functions were detected in this header (it may be a macro-only or struct-only library)._', '');
    }

    p('---', `_Generated by PICPIO from the installed copy of ${libName}. Re-created each time the library is added._`);
    return L.join('\n');
}

// Write <LibName>_reference.md into the project root from the library's header.
// Picks <DirName>.h if present, otherwise the first .h in the folder.
function writeLibraryReference(dirEntry, libSrcDir) {
    try {
        const files = fs.readdirSync(libSrcDir).filter(f => /\.h$/i.test(f));
        if (!files.length) return;
        const header = files.find(f => f.toLowerCase() === dirEntry.toLowerCase() + '.h') || files[0];
        const text = fs.readFileSync(path.join(libSrcDir, header), 'utf8');
        const snippet = LIB_SNIPPETS[dirEntry]
            || LIB_SNIPPETS[Object.keys(LIB_SNIPPETS).find(k => k.toLowerCase() === dirEntry.toLowerCase())];
        const cfg = readIni(path.join(process.cwd(), 'picpio.ini'));
        const nat = makeNativeTranslator(cfg && cfg.mcu);
        const outName = `${dirEntry}_reference.md`;
        fs.writeFileSync(path.join(process.cwd(), outName), buildLibraryReferenceMd(dirEntry, text, snippet, nat));
        console.log(`[PICPIO] Wrote ${outName}`);
    } catch (e) {
        // Non-fatal: the library still installed fine without its reference doc.
    }
}

// Small standalone file (sits next to REFERENCE.md/README in the project root,
// visible in the file explorer) linking to the MCU's Microchip product page —
// datasheet, errata, and programming specs.
function buildDatasheetMd(meta) {
    const { mcu } = meta;
    return [
        `# ${mcu} — Datasheet & Resources`, '',
        `Microchip product page (datasheet, errata, programming specs):`, '',
        `<!-- Ctrl+Click (Cmd+Click on Mac) the link below to open it in your browser -->`,
        `[Open ${mcu} product page on microchip.com](https://www.microchip.com/en-us/product/${mcu})`,
        '',
    ].join('\n');
}

function buildReferenceMd(meta) {
    const { name, mcu, family, clock, framework } = meta;
    const isXC16 = /^(PIC24|DSPIC)/i.test(family) || /DSPIC30F/i.test(mcu);
    // PIC32 (MIPS/XC32) has no PICPIO HAL yet; halVariantFor would otherwise fall
    // through to the unrelated PIC18 K40 header and emit a bogus map.
    const noHal = /^PIC32/i.test(mcu) || /^PIC32/i.test(family);
    const halDir = noHal ? null : resolveHalDir(mcu);
    const L = [];
    const p = (...s) => L.push(...s);

    p(`# ${name} — PICPIO Reference`, '');
    p(`> Auto-generated for **${mcu}** (${family} family). Re-create any time with \`picpio reference\`.`, '');
    p('| Property | Value |', '|---|---|');
    p(`| MCU | ${mcu} |`);
    p(`| Family | ${family} |`);
    p(`| Clock | ${clock} Hz |`);
    p(`| Framework | ${framework} |`);
    p(`| Toolchain | ${isXC16 ? 'XC16 (16-bit)' : 'XC8 (8-bit)'} |`, '');

    if (!halDir) {
        p('> ⚠️ No PICPIO HAL exists for this MCU yet, so the pin map and',
          '> API helpers below are unavailable. You can still build bare-metal projects against',
          '> `<xc.h>` directly (`framework = bare-metal` in `picpio.ini`).', '');
        return L.join('\n');
    }

    const h = parseHalHeader(halDir, mcu);
    const nat = makeNativeTranslator(mcu);   // Dn -> native pin name for examples

    // A representative native pin name for examples (the built-in LED's pin).
    const ledNative = (h.ledVal != null && h.nativeByVal[h.ledVal]) || nat('D13');

    // ── Pin map ──
    p('## Pin Map', '');
    p('PICPIO uses the chip\'s **native port-pin names** (`RC2`, `RB0`, `RA0`, …) — the same labels',
      'as the datasheet. The `Dn` pin number and (for analog pins) the `A0` name also work and are',
      `interchangeable in \`gpio_mode\` / \`gpio_write\` / \`gpio_read\`. This chip exposes **${h.dPins.length} digital pins** and **${h.aPins.length} analog channels**.`, '');
    p('| Pin # | Native pin | Analog | Notes |', '|---|---|---|---|');
    // One row per distinct pin value: prefer the D-name; include analog-only pins
    // (e.g. A0..A5 with no D alias on 28-pin parts) so the ADC channels are listed too.
    const dVals = new Set(h.dPins.map(d => h.resolve(d)));
    const rows = h.dPins.map(d => ({ v: h.resolve(d), pin: d }));
    for (const a of h.aPins) { const v = h.resolve(a); if (!dVals.has(v)) rows.push({ v, pin: a }); }
    rows.sort((x, y) => x.v - y.v);
    for (const r of rows) {
        const notes = (h.ledVal != null && r.v === h.ledVal) ? 'LED_BUILTIN' : '';
        const nat = h.nativeByVal[r.v] ? '`' + h.nativeByVal[r.v] + '`' : '';
        const ana = h.analogByVal[r.v] ? '`' + h.analogByVal[r.v] + '`' : '';
        p(`| \`${r.pin}\` | ${nat} | ${ana} | ${notes} |`);
    }
    p('');

    // ── Peripherals ──
    p('## On-Chip Peripherals', '');
    p('| Peripheral | Object / call | Pins |', '|---|---|---|');
    const prow = (label, obj, info) => { if (info.present) p(`| ${label} | \`${obj}\` | ${info.note || '—'} |`); };
    prow('UART-1', 'uart1', h.serial);
    prow('UART-2', 'uart2', h.serial2);
    prow('I2C-1', 'i2c1', h.wire);
    prow('I2C-2', 'i2c2', h.wire2);
    prow('SPI-1', 'spi1', h.spi);
    prow('SPI-2', 'spi2', h.spi2);
    if (h.hasADC) p(`| ADC | \`analogRead(pin)\` | ${h.analogReadNote || ('A0..A' + (h.aPins.length - 1))} |`);
    p(`| PWM | \`analogWrite(pin, duty)\` | ${h.analogWriteNote || 'CCP/OC output pins'} |`, '');

    // ── Peripheral pin map ──
    // Lets the user see which physical pin (and pin number) each peripheral
    // signal lands on. Parsed from "SIG=Rxx" tokens in the peripheral notes
    // (e.g. `extern TwoWire_t Wire; // SCL=RC3, SDA=RC4`). Peripherals whose
    // note carries no such tokens are simply skipped.
    const dNameByVal = {};
    for (const d of h.dPins) { const v = h.resolve(d); if (dNameByVal[v] == null) dNameByVal[v] = d; }
    const periphList = [
        ['UART-1', h.serial], ['UART-2', h.serial2],
        ['I2C-1', h.wire], ['I2C-2', h.wire2],
        ['SPI-1', h.spi], ['SPI-2', h.spi2],
    ];
    const pinRows = [];
    for (const [label, info] of periphList) {
        if (!info || !info.present || !info.note) continue;
        for (const m of info.note.matchAll(/([A-Za-z][\w/]*)\s*=\s*(R[A-Z]\d+)/g)) {
            const pin = m[2], v = h.resolve(pin);
            const ard = (v != null && dNameByVal[v]) ? dNameByVal[v] : (v != null && h.analogByVal[v]) || '';
            pinRows.push({ label, sig: m[1], pin, ard });
        }
    }
    if (pinRows.length) {
        p('## Peripheral Pins', '');
        p('Which physical pin — and its pin number — each peripheral signal uses on this chip:', '');
        p('| Peripheral | Signal | Pin | Pin # |', '|---|---|---|---|');
        for (const r of pinRows) p(`| ${r.label} | ${r.sig} | \`${r.pin}\` | ${r.ard ? '`' + r.ard + '`' : ''} |`);
        // dsPIC30F (and the multi-device PIC16 HAL) share one peripheral-pin note
        // across many parts whose pins differ; flag that the Pin Map above is the
        // authoritative per-MCU source.
        if (/DSPIC30F/i.test(mcu) || halVariantFor(mcu) === 'picpio_compat_pic16') {
            p('', '_This HAL serves several devices whose peripheral pins differ; the table shows the family\'s reference part. The Pin Map above is authoritative for your exact MCU._');
        }
        p('');
    }

    // ── API + usage ──
    p('## API & Usage', '');
    p('Everything below is available after `#include <Picpio.h>`. The names use PICPIO\'s',
      'subsystem prefixes (`gpio_`, `adc_`, `pwm_`, `sys_`, `uart1`/`i2c1`/`spi1`). A sketch',
      'defines `init()` (runs once at boot) and `run()` (runs forever):', '');
    p('```c', '#include <Picpio.h>', '',
      'void init() {', '    gpio_mode(BUILTIN_LED, GPIO_OUT);', '}', '',
      'void run() {', '    gpio_write(BUILTIN_LED, GPIO_HIGH);', '    sys_delay(500);',
      '    gpio_write(BUILTIN_LED, GPIO_LOW);', '    sys_delay(500);', '}', '```', '');
    p('> The classic Arduino names remain available as aliases, so existing sketches still',
      '> compile unchanged: `setup`/`loop`, `digitalWrite`, `Serial`, `HIGH`, `delay`, …', '');

    p('### Digital I/O', '');
    p('```c',
      nat('gpio_mode(D5, GPIO_OUT);')  + '      // GPIO_OUT | GPIO_IN | GPIO_PULLUP',
      nat('gpio_write(D5, GPIO_HIGH);') + '    // GPIO_HIGH | GPIO_LOW',
      nat('int s = gpio_read(D6);')     + '        // 0 or 1',
      '```',
      '> Pins use the chip\'s native names (`' + ledNative + '`-style), shown in the Pin Map above. The',
      '> `Dn` pin numbers work too (`gpio_write(D5, …)` ≡ `gpio_write(' + nat('D5') + ', …)`). For raw',
      '> register-bit writes like `' + ledNative + ' = 1;`, add `#define PICPIO_NO_PIN_ALIASES` before the include.', '');

    if (h.hasADC) {
        p('### Analog Input (ADC)', '');
        p('```c',
          nat('int v = adc_read(A0);') + '         // 10-bit, 0..1023',
          '```', '');
    }
    p('### PWM Output', '');
    p('```c',
      'pwm_write(BUILTIN_LED, 128);  // 8-bit duty 0..255 — pin must be PWM-capable',
      '                              // (see the PWM row in On-Chip Peripherals)',
      '```', '');

    p('### Timing', '');
    p('```c',
      'sys_delay(500);               // block ms',
      'sys_delay_us(50);             // block us',
      'uint32_t t  = sys_millis();   // ms since boot',
      'uint32_t us = sys_micros();   // us since boot',
      '```', '');

    if (h.hasInterrupt) {
        p('### Pin-Change Interrupts', '');
        p('Run a function the instant a pin changes, without polling it in `run()`. Uses the',
          'chip\'s interrupt-on-change (IOC) hardware — available on PORTA/B/C pins.', '');
        p('```c',
          'void onButton(void) {         // keep it SHORT — this runs inside the ISR',
          nat('    gpio_write(D5, GPIO_HIGH);'),
          '}',
          '',
          'void init() {',
          nat('    gpio_mode(D8, GPIO_PULLUP);'),
          nat('    attachInterrupt(D8, onButton, FALLING);') + '  // FALLING | RISING | CHANGE',
          '}',
          '```',
          '> `detachInterrupt(pin)` stops it. `noInterrupts()` / `interrupts()` (aliases',
          '> `sys_irq_off()` / `sys_irq_on()`) globally disable/enable all interrupts —',
          '> useful around timing-critical bit-banged code.', '');
    }

    if (h.hasTone) {
        p('### Tone (square-wave output)', '');
        p('```c',
          nat('tone(D9, 440, 500);')   + '     // ' + nat('D9') + ' square wave, 440 Hz for 500 ms (0 = until noTone)',
          nat('noTone(D9);')           + '             // stop early',
          '```', '');
    }

    if (h.hasEEPROM) {
        p('### On-Chip EEPROM (non-volatile)', '');
        p('Storage built into the PIC that survives power-off. Each byte write takes ~4 ms',
          '(blocking).', '');
        p('```c',
          'EEPROM_write(0, 42);          // store a byte at address 0',
          'uint8_t v = EEPROM_read(0);   // read it back',
          'EEPROM_update(0, 42);         // write only if the value changed (saves wear)',
          'uint16_t n = EEPROM_length(); // total size in bytes',
          '',
          'int32_t cfg = 1234;           // store/recall any struct or variable:',
          'EEPROM_put(4, &cfg, sizeof cfg);',
          'EEPROM_get(4, &cfg, sizeof cfg);',
          '```', '');
    }

    const serialUsage = (obj) => {
        p('```c',
          `${obj}.begin(9600);`,
          `${obj}.println("hello");      // string`,
          `${obj}.print("count = ");`,
          `${obj}.println_i(42);         // int32`,
          `${obj}.println_f(3.14f, 2);   // float, 2 decimals`,
          `if (${obj}.available()) {`,
          `    int c = ${obj}.read();`,
          `}`,
          '```', '',
          `> Use the typed \`${obj}.print_i\` / \`print_f\` / \`print_s\` (and \`println_*\`) methods for`,
          `> numbers. Avoid the type-generic \`${obj}_print(x)\` / \`${obj}_println(x)\` \`_Generic\` macros —`,
          `> they do not compile reliably on this toolchain.`, '');
    };
    if (h.serial.present) { p('### UART-1 (`uart1`)' + (h.serial.note ? ' — ' + h.serial.note : ''), ''); serialUsage('uart1'); }
    if (h.serial2.present) { p('### UART-2 (`uart2`)' + (h.serial2.note ? ' — ' + h.serial2.note : ''), ''); serialUsage('uart2'); }

    const wireUsage = (obj) => {
        p('```c',
          `${obj}.begin();`,
          `${obj}.beginTransmission(0x48);`,
          `${obj}.write(0x01);`,
          `${obj}.endTransmission();`,
          `${obj}.requestFrom(0x48, 2);`,
          `while (${obj}.available()) { int b = ${obj}.read(); }`,
          '```', '');
    };
    if (h.wire.present)  { p('### I2C-1 (`i2c1`)' + (h.wire.note ? ' — ' + h.wire.note : ''), ''); wireUsage('i2c1'); }
    if (h.wire2.present) { p('### I2C-2 (`i2c2`)' + (h.wire2.note ? ' — ' + h.wire2.note : ''), ''); wireUsage('i2c2'); }
    const spiUsage = (obj) => {
        p('```c',
          `${obj}.begin();`,
          `${obj}.setBitOrder(SPI_MSB);    // SPI_MSB | SPI_LSB`,
          `${obj}.setDataMode(SPI_MODE0);  // SPI_MODE0..3`,
          `${obj}.setClockDivider(SPI_CLOCK_DIV4);`,
          `uint8_t in = ${obj}.transfer(0xA5);`,
          '```', '');
    };
    if (h.spi.present)  { p('### SPI-1 (`spi1`)' + (h.spi.note ? ' — ' + h.spi.note : ''), ''); spiUsage('spi1'); }
    if (h.spi2.present) { p('### SPI-2 (`spi2`)' + (h.spi2.note ? ' — ' + h.spi2.note : ''), ''); spiUsage('spi2'); }

    p('### Names & helpers', '');
    p('Constants: `GPIO_IN` `GPIO_OUT` `GPIO_PULLUP` `GPIO_HIGH` `GPIO_LOW` `BUILTIN_LED`,',
      '`SPI_MSB` `SPI_LSB` `SPI_MODE0..3` `SPI_CLOCK_DIV*`. Bit/byte helpers: `bit_read` `bit_set`',
      '`bit_clr` `bit_write` `byte_lo` `byte_hi`. The Arduino equivalents (`HIGH`, `bitRead`, `min`,',
      '`max`, …) are kept as aliases for compatibility.', '');
    p('Math / conversion macros: `map(x,inLo,inHi,outLo,outHi)` `constrain(x,lo,hi)` `min` `max`',
      '`abs` `sq(x)` `round(x)` and the constants `PI` `TWO_PI` `HALF_PI` `DEG_TO_RAD` `RAD_TO_DEG`.', '');

    p('---', `_Generated by PICPIO. Pin/peripheral data parsed from \`${halVariantFor(mcu)}/Picpio.h\`._`);
    return L.join('\n');
}

function cmdReference() {
    const cfg = requireConfig();
    const meta = {
        name:      cfg.name || path.basename(process.cwd()),
        mcu:       cfg.mcu || 'PIC18F27K40',
        family:    cfg.family || 'PIC18',
        clock:     cfg.clock_hz || cfg.clock || '64000000',
        framework: cfg.framework || 'bare-metal',
    };
    fs.writeFileSync(path.join(process.cwd(), 'REFERENCE.md'), buildReferenceMd(meta));
    fs.writeFileSync(path.join(process.cwd(), 'DATASHEET.md'), buildDatasheetMd(meta));
    console.log(`[PICPIO] Wrote REFERENCE.md and DATASHEET.md for ${meta.mcu}`);
}

function cmdInit(args) {
    const params = parseFlags(args);
    const name   = params['name'] || path.basename(process.cwd());
    const mcu    = params['mcu']  || 'PIC18F27K40';
    const family = params['family'] || familyFromMcu(mcu);
    const clock  = params['clock'] || '64000000';
    const prog   = params['programmer'] || 'PICKit4';
    const fw     = params['framework'] || 'bare-metal';
    const outDir = params['output'] || path.join(process.cwd(), name);

    fs.mkdirSync(path.join(outDir, 'src'),     { recursive: true });
    fs.mkdirSync(path.join(outDir, 'lib'),     { recursive: true });
    fs.mkdirSync(path.join(outDir, '.vscode'), { recursive: true });

    fs.writeFileSync(path.join(outDir, 'picpio.ini'), [
        '[project]',
        `name       = ${name}`,
        `mcu        = ${mcu}`,
        `family     = ${family}`,
        `clock_hz   = ${clock}`,
        `framework  = ${isPicpioFw(fw) ? 'picpio' : fw}`,
        '',
        '[build]',
        `src_dir    = src`,
        `build_dir  = .picpio`,
        `opt_level  = 2`,
        '',
        '[upload]',
        `programmer = ${prog}`,
        '# power_voltage = 5.0  -- uncomment to power the target board from the',
        '#                         programmer (needed if your board has no own supply)',
        '',
        '[libraries]',
        `installed  =`,
    ].join('\n'));

    const mainFile = isPicpioFw(fw)
        ? path.join(outDir, 'src', 'main.c')
        : path.join(outDir, 'src', 'main.c');

    const mainContent = isPicpioFw(fw) ? [
        '#include <Picpio.h>',
        '',
        'void init() {                 // runs once at boot',
        '    uart1.begin(115200);',
        '    gpio_mode(BUILTIN_LED, GPIO_OUT);',
        '}',
        '',
        'void run() {                  // runs forever',
        '    gpio_write(BUILTIN_LED, GPIO_HIGH);',
        '    sys_delay(500);',
        '    gpio_write(BUILTIN_LED, GPIO_LOW);',
        '    sys_delay(500);',
        '}',
    ].join('\n') : [
        `// ${name} - PIC ${mcu}`,
        '#include <xc.h>',
        `#pragma config FEXTOSC=OFF, RSTOSC=HFINTOSC_64MHZ`,
        `#pragma config WDTE=OFF, LVP=OFF`,
        '',
        'void main(void) {',
        '    TRISCbits.TRISC0 = 0;',
        '    while (1) {',
        '        LATCbits.LATC0 ^= 1;',
        '        __delay_ms(500);',
        '    }',
        '}',
    ].join('\n');

    fs.writeFileSync(mainFile, mainContent);

    // REFERENCE.md / DATASHEET.md — per-chip pin map + API cheat-sheet and a
    // link to the MCU's Microchip product page (datasheet, errata, etc.)
    try {
        const meta = { name, mcu, family, clock, framework: fw };
        fs.writeFileSync(path.join(outDir, 'REFERENCE.md'), buildReferenceMd(meta));
        fs.writeFileSync(path.join(outDir, 'DATASHEET.md'), buildDatasheetMd(meta));
    } catch (e) {
        console.error(`[PICPIO] (REFERENCE.md/DATASHEET.md skipped: ${e.message})`);
    }

    // .vscode/tasks.json
    fs.writeFileSync(path.join(outDir, '.vscode', 'tasks.json'), JSON.stringify({
        version: '2.0.0',
        tasks: [
            { label:'PICPIO: Build',  type:'shell', command:'picpio build',  group:{ kind:'build', isDefault:true }, problemMatcher:['$xc8','$xc8-2'] },
            { label:'PICPIO: Upload', type:'shell', command:'picpio upload', group:'test', problemMatcher:[] },
            { label:'PICPIO: Clean',  type:'shell', command:'picpio clean',  group:'none', problemMatcher:[] },
        ]
    }, null, 2));

    console.log(`[PICPIO] Project '${name}' created at ${outDir}`);
    console.log(`[PICPIO] MCU: ${mcu} | Family: ${family} | Framework: ${fw}`);
}

// ─── VSCODE CONFIG ───────────────────────────────────────────────────────────
function cmdVscode(opts = {}) {
    const cfg    = requireConfig();
    const mcu    = cfg.mcu || 'PIC18F27K40';
    const family = (cfg.family || 'PIC18').toUpperCase();
    const isXC16 = family.startsWith('PIC24') || family.startsWith('DSPIC') || /DSPIC30F/.test(mcu.toUpperCase());

    // Find XC8 include dirs (v3.x has separate include and include/c99) and the
    // compiler exe (compilerPath lets the VS Code C/C++ extension auto-locate the
    // toolchain's system headers — without it, it reports "cannot open xc.h").
    const base = 'C:\\Program Files\\Microchip\\xc8';
    let xc8Inc  = 'C:/Program Files/Microchip/xc8/v3.10/pic/include';
    let xc8Inc2 = 'C:/Program Files/Microchip/xc8/v3.10/pic/include/c99';
    let compilerPath = '';
    if (fs.existsSync(base)) {
        const vers = fs.readdirSync(base).filter(d => d.startsWith('v')).sort().reverse();
        if (vers[0]) {
            xc8Inc  = `C:/Program Files/Microchip/xc8/${vers[0]}/pic/include`;
            xc8Inc2 = `C:/Program Files/Microchip/xc8/${vers[0]}/pic/include/c99`;
            compilerPath = `C:/Program Files/Microchip/xc8/${vers[0]}/bin/xc8-cc.exe`;
        }
    }

    // XC16 (PIC24/dsPIC) bundles device headers under <install>/support/<family>/h
    let xc16Includes = [];
    let buildProblemMatcher = ['$xc8', '$xc8-2'];
    if (isXC16) {
        const xc16Gcc = findXC16();
        if (xc16Gcc) {
            compilerPath = xc16Gcc.replace(/\\/g, '/');
            const root = path.join(path.dirname(xc16Gcc), '..');
            xc16Includes = [
                path.join(root, 'include').replace(/\\/g, '/'),
                path.join(root, 'support', 'dsPIC30F', 'h').replace(/\\/g, '/'),
                path.join(root, 'support', 'PIC24F', 'h').replace(/\\/g, '/'),
                path.join(root, 'support', 'dsPIC33E', 'h').replace(/\\/g, '/'),
            ];
        }
        buildProblemMatcher = ['$gcc'];
    }

    // Family-specific DFP (e.g. PIC18F-K_DFP, PIC16Fxxx_DFP) and HAL ("picpio_compat*") dirs
    const scriptDir = path.dirname(process.argv[1]);
    const acName = halVariantFor(mcu);
    const acDir = [
        path.join(scriptDir, acName),
        path.join(scriptDir, '..', acName),
    ].find(d => fs.existsSync(d)) || path.join(process.cwd(), acName);

    const dfpPath = findDFP(mcu);
    const dfpIncludes = dfpPath ? [
        path.join(dfpPath, 'pic', 'include').replace(/\\/g, '/'),
        path.join(dfpPath, 'pic', 'include', 'proc').replace(/\\/g, '/'),
    ] : [];

    const vsDir = path.join(process.cwd(), '.vscode');
    fs.mkdirSync(vsDir, { recursive: true });

    fs.writeFileSync(path.join(vsDir, 'tasks.json'), JSON.stringify({
        version: '2.0.0',
        tasks: [
            { label:'PICPIO: Build',  type:'shell', command:'picpio build',  group:{ kind:'build', isDefault:true }, problemMatcher: buildProblemMatcher },
            { label:'PICPIO: Upload', type:'shell', command:'picpio upload', group:'test', problemMatcher:[] },
            { label:'PICPIO: Clean',  type:'shell', command:'picpio clean',  group:'none', problemMatcher:[] },
        ]
    }, null, 2));

    const extraInclude = (cfg.lib_extra_dirs || '').split(',').map(s => s.trim()).filter(Boolean);

    const includePath = [
        '${workspaceFolder}/src',
        '${workspaceFolder}/include',
        '${workspaceFolder}/lib/**',
        ...(isXC16 ? xc16Includes : [xc8Inc, xc8Inc2, xc8Inc.replace('/include', '/include/proc')]),
        ...dfpIncludes,
        acDir.replace(/\\/g, '/'),
        ...extraInclude
    ];

    fs.writeFileSync(path.join(vsDir, 'c_cpp_properties.json'), JSON.stringify({
        configurations: [{
            name: mcu,
            includePath,
            defines: [`__${mcu}__`, `_XTAL_FREQ=${cfg.clock_hz || '64000000'}`],
            ...(compilerPath ? { compilerPath } : {}),
            cStandard: 'c99',
            intelliSenseMode: 'gcc-x86',
            // Persist the symbol database to disk so the tag parser doesn't
            // re-index the (huge) XC header tree from scratch on every reload —
            // this is what stops Ctrl+Click sticking on "Loading...".
            browse: {
                path: includePath,
                limitSymbolsToIncludedHeaders: false,
                databaseFilename: '${workspaceFolder}/.vscode/.browse.vc.db'
            }
        }],
        version: 4
    }, null, 2));

    // settings.json: keep a generous on-disk IntelliSense cache (default is too
    // small for the XC chip headers, so the parse is thrown away and re-run).
    const settingsPath = path.join(vsDir, 'settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
        try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { settings = {}; }
    }
    settings['C_Cpp.intelliSenseCacheSize'] = 2048;        // MB of parsed-header cache
    settings['C_Cpp.intelliSenseCachePath'] = '${workspaceFolder}/.vscode/.ipch';
    settings['C_Cpp.intelliSenseEngine'] = 'default';
    settings['files.associations'] = Object.assign({ '*.c': 'c', '*.h': 'c' }, settings['files.associations'] || {});
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    // Keep the (potentially large) IntelliSense cache + symbol DB out of git.
    fs.writeFileSync(path.join(vsDir, '.gitignore'), '.ipch/\n.browse.vc.db\n*.vc.db\n');

    if (opts.quiet) {
        // Rewriting c_cpp_properties.json bumps its mtime, which makes the VS Code
        // C/C++ extension reload the config, re-glob lib/** and re-index — this is
        // what clears the stale "cannot open source file" squiggle after lib add/remove.
        console.log('[PICPIO] Refreshed IntelliSense config (.vscode/c_cpp_properties.json)');
    } else {
        console.log('[PICPIO] Generated .vscode/tasks.json');
        console.log('[PICPIO] Generated .vscode/c_cpp_properties.json');
        console.log('[PICPIO] Generated .vscode/settings.json');
    }
}

// After a library is added/removed, regenerate the IntelliSense config so the
// C/C++ extension re-scans for new/removed headers (only if the project is
// already set up for VS Code — don't force .vscode on CLI-only users).
function refreshVscodeConfig() {
    if (fs.existsSync(path.join(process.cwd(), '.vscode', 'c_cpp_properties.json'))) {
        try { cmdVscode({ quiet: true }); } catch { /* non-fatal */ }
    }
}

// ─── INSTALL DFP ─────────────────────────────────────────────────────────────
// Works for ANY Microchip device or DFP pack name by resolving against the
// official pack index (see resolvePack). Examples:
//   picpio install-dfp                 (uses [project] mcu from picpio.ini)
//   picpio install-dfp PIC16F877A      (resolve by device part number)
//   picpio install-dfp PIC16Fxxx_DFP   (resolve by exact pack name)
function cmdInstallDFP(arg) {
    let mcu = null;
    let target = arg;

    if (!target) {
        const cfg = readIni(path.join(process.cwd(), 'picpio.ini'));
        if (!cfg || !cfg.mcu) {
            console.error('[PICPIO] No device specified and no picpio.ini with [project] mcu found.');
            console.error('         Usage: picpio install-dfp <device or DFP name>  (e.g. PIC16F877A)');
            process.exit(1);
        }
        mcu = cfg.mcu;
        target = cfg.mcu;
    } else if (!/_DFP$/i.test(target)) {
        mcu = target;
    }

    console.log(`[PICPIO] Resolving DFP for ${target}...`);
    const pack = resolvePack(target);
    if (!pack) {
        console.error(`[PICPIO] Could not find a Device Family Pack for "${target}" in the Microchip pack index.`);
        console.error('         Check the device/pack name, or install MPLAB X and use Tools > Packs.');
        process.exit(1);
    }

    const destDir = path.join(PACKS_DIR, pack.name);
    if (fs.existsSync(destDir) && fs.readdirSync(destDir).length > 0) {
        console.log(`[PICPIO] DFP already installed: ${destDir} (${pack.name} v${pack.version})`);
    } else {
        const dir = downloadPack(pack.name, pack.version);
        if (!dir) {
            console.error(`[PICPIO] Could not download ${pack.name} v${pack.version}.`);
            console.error('         Install MPLAB X and use Tools > Packs to install the DFP,');
            console.error('         then set dfp_path in picpio.ini [build] section:');
            console.error(`         dfp_path = C:\\path\\to\\${pack.name}\\${pack.version}`);
            process.exit(1);
        }
        console.log(`[PICPIO] DFP installed: ${dir} (${pack.name} v${pack.version})`);
    }

    if (mcu) {
        const manifest = loadDFPManifest();
        manifest[mcu.toUpperCase()] = pack.name;
        saveDFPManifest(manifest);
    }
    console.log('[PICPIO] Run "picpio build" again.');
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function parseFlags(args) {
    const out = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            out[key]  = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
        }
    }
    return out;
}
