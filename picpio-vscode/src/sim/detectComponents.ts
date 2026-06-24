// Best-effort static analysis of an PICPIO sketch: looks at
// pinMode/digitalRead/digitalWrite/analogRead calls and #include'd display
// libraries to figure out what hardware the sketch is driving, so the
// simulator can auto-place and auto-wire matching circuit parts.

export interface AutoWire { pin: string; term: string; }
export interface AutoPart { type: string; wires: AutoWire[]; addr?: string; iface?: 'i2c' | 'gpio'; dev?: string; name?: string; count?: number; }

// Normalize a captured address literal ("0x27" or "39") to a "0xNN" hex string.
function formatAddr(raw: string): string {
    const n = raw.toLowerCase().startsWith('0x') ? parseInt(raw, 16) : parseInt(raw, 10);
    return '0x' + n.toString(16).toUpperCase().padStart(2, '0');
}

// Native port-pin names — must match pinLabel() in sim/simWorker.ts
// (D0-D7=RC0-RC7, D8-D13=RB0-RB5, A0-A5=RA0-RA5).
function pinLabel(n: number): string | null {
    if (n >= 0  && n <= 7)  return 'RC' + n;
    if (n >= 8  && n <= 13) return 'RB' + (n - 8);
    if (n >= 14 && n <= 19) return 'RA' + (n - 14);
    return null;
}

// Picpio.h pin-name macros (see picpio_compat).
const PIN_MACROS: Record<string, number> = {
    D0: 0, D1: 1, D2: 2, D3: 3, D4: 4, D5: 5, D6: 6, D7: 7,
    D8: 8, D9: 9, D10: 10, D11: 11, D12: 12, D13: 13,
    A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19,
    LED_BUILTIN: 13, BUILTIN_LED: 13,
};

export function detectComponents(src: string): AutoPart[] {
    // Strip comments so they can't confuse the regexes below.
    const s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    // Resolve #define NAME <int> so custom pin aliases (e.g. "#define LED_PIN 5") work too.
    const defines: Record<string, number> = {};
    for (const m of s.matchAll(/^[ \t]*#define\s+(\w+)\s+(\d+)\s*$/gm)) {
        defines[m[1]] = parseInt(m[2], 10);
    }

    const resolvePin = (token: string): string | null => {
        const t = token.trim();
        if (/^\d+$/.test(t))      return pinLabel(parseInt(t, 10));
        if (t in PIN_MACROS)      return pinLabel(PIN_MACROS[t]);
        if (t in defines)         return pinLabel(defines[t]);
        // Follow a string #define alias, e.g. "#define LED_PIN D2" -> D2.
        const am = s.match(new RegExp('#define\\s+' + t + '\\s+(\\w+)'));
        if (am && am[1] !== t)    return resolvePin(am[1]);
        return null;
    };
    // Resolve an integer token (literal or #define'd constant), e.g. LED_COUNT.
    const resolveInt = (token: string, dflt: number): number => {
        const t = token.trim();
        if (/^\d+$/.test(t)) return parseInt(t, 10);
        if (t in defines)    return defines[t];
        return dflt;
    };

    const outputPins = new Set<string>();
    const inputPins  = new Set<string>();
    const analogPins = new Set<string>();

    // Accept both the Arduino-style names (pinMode/OUTPUT) and the canonical
    // PICPIO API (gpio_mode/GPIO_OUT) — see picpio_compat's Picpio.h aliases.
    for (const m of s.matchAll(/(?:pinMode|gpio_mode)\s*\(\s*(\w+)\s*,\s*(OUTPUT|GPIO_OUT|INPUT_PULLUP|GPIO_PULLUP|INPUT|GPIO_IN)\s*\)/g)) {
        const label = resolvePin(m[1]);
        if (!label) continue;
        if (m[2] === 'OUTPUT' || m[2] === 'GPIO_OUT') outputPins.add(label);
        else inputPins.add(label);
    }
    // digitalWrite/analogWrite (gpio_write/pwm_write) without an explicit
    // pinMode still implies an output.
    for (const m of s.matchAll(/(?:digitalWrite|gpio_write|analogWrite|pwm_write)\s*\(\s*(\w+)\s*,/g)) {
        const label = resolvePin(m[1]);
        if (label && !inputPins.has(label)) outputPins.add(label);
    }
    for (const m of s.matchAll(/(?:analogRead|adc_read)\s*\(\s*(\w+)\s*\)/g)) {
        const label = resolvePin(m[1]);
        if (label) analogPins.add(label);
    }

    const parts: AutoPart[] = [];

    // NeoPixel / WS2812 strip: NeoPixel_init(&strip, count, pin). Detected before
    // the plain-LED pass so its data pin isn't also drawn as a single LED.
    let neoPin: string | null = null;
    if (s.includes('NeoPixel') || /\bNeoPixel_init\s*\(/.test(s)) {
        const m = s.match(/NeoPixel_init\s*\(\s*&?\s*\w+\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/);
        const count = m ? resolveInt(m[1], 16) : 16;
        neoPin = (m && resolvePin(m[2])) || 'RC0';
        outputPins.delete(neoPin);   // it's the strip's data line, not an LED
        parts.push({ type: 'neopixel', dev: 'neo', count, name: 'NeoPixel x' + count,
            wires: [{ pin: neoPin, term: 'DIN' }] });
    }

    for (const pin of outputPins) parts.push({ type: 'led', wires: [{ pin, term: '' }] });
    for (const pin of inputPins)  parts.push({ type: 'button', wires: [{ pin, term: '' }] });
    for (const pin of analogPins) {
        if (outputPins.has(pin) || inputPins.has(pin)) continue;
        parts.push({ type: 'pot', wires: [{ pin, term: '' }] });
    }

    // Display libraries — wired to the fixed I2C pins (RA4=SDA, RA5=SCL) or
    // the fixed hardware-SPI pins (RB3=MOSI/SDA, RB5=SCK).
    const has = (needle: string): boolean => s.includes(needle);

    // Displays are detected independently (a sketch can drive more than one,
    // e.g. an I2C LCD and an HC595 LCD at once). Each gets a `dev` key so the
    // simulator can route its text to the matching on-screen part.
    if (has('SPI.h') && /Adafruit_(ST7735|ST7789|ILI9341)/.test(s)) {
        let cs = 'RB2', dc = 'RB1', rst = 'RB0'; // default to D10/D9/D8
        const ctor = s.match(/Adafruit_(?:ST7735|ST7789|ILI9341)\s+\w+\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/);
        if (ctor) {
            cs  = resolvePin(ctor[1]) ?? cs;
            dc  = resolvePin(ctor[2]) ?? dc;
            rst = resolvePin(ctor[3]) ?? rst;
        }
        parts.push({ type: 'spi_display', dev: 'spi', wires: [
            { pin: cs,    term: 'CS'  },
            { pin: dc,    term: 'DC'  },
            { pin: 'RB3', term: 'SDA' },
            { pin: 'RB5', term: 'SCK' },
            { pin: rst,   term: 'RST' },
        ]});
    }

    if (has('LiquidCrystal_I2C') || /\bLCD_init\s*\(/.test(s)) {
        // I2C HD44780 LCD: LCD_init(&lcd, addr, cols, rows).
        const m = s.match(/LCD_init\s*\(\s*&?\s*\w+\s*,\s*(0[xX][0-9A-Fa-f]+|\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
        const addr = formatAddr(m?.[1] ?? '0x27');
        const rows = m ? parseInt(m[3], 10) : 2;
        parts.push({ type: rows >= 4 ? 'lcd2004' : 'lcd1602', addr, dev: 'i2c', iface: 'i2c', wires: [
            { pin: 'RC4', term: 'SDA' },
            { pin: 'RC3', term: 'SCL' },
        ]});
    }

    if (/SSD1306|U8g2|U8X8/.test(s)) {
        // Look for "#define SSD1306_ADDRESS <value>" (the documented way to
        // override the default), then a literal address passed directly as
        // SSD1306_init(&dev, <addr>, ...), then fall back to the default.
        const defineM = s.match(/#define\s+SSD1306_ADDRESS\s+(0[xX][0-9A-Fa-f]+|\d+)/);
        const initM = s.match(/SSD1306_init\s*\(\s*&?\s*\w+\s*,\s*(0[xX][0-9A-Fa-f]+|\d+)/);
        const addr = formatAddr((defineM ?? initM)?.[1] ?? '0x3C');
        parts.push({ type: 'oled', dev: 'oled', addr, wires: [
            { pin: 'RC4', term: 'SDA' },
            { pin: 'RC3', term: 'SCL' },
        ]});
    }

    if (/\bILI9(341|488)_init\s*\(/.test(s) || has('ILI9341') || has('ILI9488')) {
        // SPI TFT (ILI9341 240x320 or ILI9488 480x320): <drv>_init(&tft, cs, dc, rst).
        const m = s.match(/ILI9(341|488)_init\s*\(\s*&?\s*\w+\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/);
        const drv = (m && m[1]) || (/\bILI9488/.test(s) ? '488' : '341');
        const cs  = (m && resolvePin(m[2])) || 'RB2';
        const dc  = (m && resolvePin(m[3])) || 'RB1';
        const rst = (m && resolvePin(m[4])) || 'RB0';
        const name = drv === '488' ? 'ILI9488 3.5" TFT' : 'ILI9341 SPI TFT';
        parts.push({ type: 'tft', dev: 'tft', name, wires: [
            { pin: cs,    term: 'CS'  },
            { pin: dc,    term: 'DC'  },
            { pin: rst,   term: 'RST' },
            { pin: 'RC1', term: 'SDI' },   // hardware SPI MOSI
            { pin: 'RC5', term: 'SCK' },
        ]});
    }

    if (has('LCD_HC595') || /\bLCD595_/.test(s)) {
        // HD44780 character LCD driven through a 74HC595 shift register over
        // 3 GPIO pins: LCD595_init(&dev, dataPin, clockPin, latchPin).
        const initM = s.match(/LCD595_init\s*\(\s*&?\s*\w+\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/);
        const data  = initM ? resolvePin(initM[1]) : null;
        const clk   = initM ? resolvePin(initM[2]) : null;
        const latch = initM ? resolvePin(initM[3]) : null;
        // Geometry from LCD595_begin(&dev, cols, rows) — default 16x2.
        const beginM = s.match(/LCD595_begin\s*\(\s*&?\s*\w+\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
        const rows = beginM ? parseInt(beginM[2], 10) : 2;
        const wires: AutoWire[] = [];
        if (data)  wires.push({ pin: data,  term: 'DATA'  });
        if (clk)   wires.push({ pin: clk,   term: 'CLK'   });
        if (latch) wires.push({ pin: latch, term: 'LATCH' });
        parts.push({ type: rows >= 4 ? 'lcd2004' : 'lcd1602', dev: 'hc595', iface: 'gpio', wires });
    }

    // ── 7-segment displays ──────────────────────────────────────────────────
    // Resolve the pin tokens inside an "uint8_t name[] = {D0, D1, ...};" array.
    const parsePinArray = (name: string): (string | null)[] => {
        const am = s.match(new RegExp('\\b' + name + '\\s*\\[[^\\]]*\\]\\s*=\\s*\\{([^}]*)\\}'));
        if (!am) return [];
        return am[1].split(',').map(t => resolvePin(t.trim()));
    };

    // Raw multiplexed: SevenSeg_init(&ss, segPins, digPins, numDigits, commonAnode)
    if (/\bSevenSeg_init\s*\(/.test(s)) {
        const m = s.match(/SevenSeg_init\s*\(\s*&?\s*\w+\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*,/);
        const digits = m ? resolveInt(m[3], 4) : 4;
        const segLabels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
        const wires: AutoWire[] = [];
        if (m) {
            parsePinArray(m[1]).forEach((pin, i) => {
                if (pin && segLabels[i]) wires.push({ pin, term: segLabels[i] });   // 0xFF (dp unused) -> null, skipped
            });
            parsePinArray(m[2]).slice(0, digits).forEach((pin, i) => {
                if (pin) wires.push({ pin, term: 'd' + (i + 1) });
            });
        }
        parts.push({ type: 'sevenseg', dev: 'sevenseg', count: digits,
            name: digits + '-digit 7-seg', wires });
    }
    // TM1637 (2-wire): TM1637_init(&d, clkPin, dioPin)
    if (/\bTM1637_init\s*\(/.test(s)) {
        const m = s.match(/TM1637_init\s*\(\s*&?\s*\w+\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/);
        const clk = (m && resolvePin(m[1])) || null;
        const dio = (m && resolvePin(m[2])) || null;
        const wires: AutoWire[] = [];
        if (clk) wires.push({ pin: clk, term: 'CLK' });
        if (dio) wires.push({ pin: dio, term: 'DIO' });
        parts.push({ type: 'sevenseg', dev: 'tm1637', count: 4, name: 'TM1637 4-digit', wires });
    }
    // MAX7219 (SPI): MAX7219_init(&d, csPin, numDigits)
    if (/\bMAX7219_init\s*\(/.test(s)) {
        const m = s.match(/MAX7219_init\s*\(\s*&?\s*\w+\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/);
        const cs = (m && resolvePin(m[1])) || 'RC0';
        const digits = m ? resolveInt(m[2], 8) : 8;
        parts.push({ type: 'sevenseg', dev: 'max7219', count: digits,
            name: 'MAX7219 ' + digits + '-digit', wires: [
                { pin: cs,    term: 'CS'  },
                { pin: 'RC1', term: 'DIN' },
                { pin: 'RC5', term: 'CLK' },
            ]});
    }

    return parts;
}

// Fixed hardware pin assignments for picpio_compat's communication
// peripherals (see picpio_compat_pic16/wiring.c). These objects' begin()
// etc. run inside the (un-simulated) library, so the simulator never sees
// their pinMode() calls — label the pins statically instead whenever the
// sketch references the corresponding object.
const PERIPHERAL_PINS: Record<string, [pin: string, role: string][]> = {
    Wire:    [['RC3', 'SCL'],  ['RC4', 'SDA']],
    Wire2:   [['RB2', 'SCL'],  ['RB3', 'SDA']],
    SPI:     [['RC5', 'SCK'],  ['RC1', 'MOSI'], ['RC2', 'MISO']],
    SPI2:    [['RB2', 'SCK'],  ['RB3', 'MOSI'], ['RB4', 'MISO']],
    Serial:  [['RC6', 'TX'],   ['RC7', 'RX']],
    Serial2: [['RB6', 'TX'],   ['RB7', 'RX']],
    uart1:   [['RC6', 'TX'],   ['RC7', 'RX']],
    uart2:   [['RB6', 'TX'],   ['RB7', 'RX']],
};

// Instance number suffixed onto each role below to form a datasheet-style
// alternate-function name (e.g. role "SCL" on Wire2 -> "SCL2").
const PERIPHERAL_INSTANCE: Record<string, string> = {
    Wire: '1', Wire2: '2',
    SPI: '1', SPI2: '2',
    Serial: '1', Serial2: '2',
    uart1: '1', uart2: '2',
};

// Signal-name prefix -> bus type, for recognising a bare signal name like
// "TX2"/"SCL2" when no "<signal> in <BUS> mode" comment is present.
const SIGNAL_BUS: Record<string, string> = {
    SCL: 'I2C', SDA: 'I2C',
    SCK: 'SPI', SDI: 'SPI', SDO: 'SPI', MOSI: 'SPI', MISO: 'SPI', SS: 'SPI',
    TX: 'USART', RX: 'USART',
};
// Normalize chip-datasheet signal names to the MOSI/MISO terms used elsewhere.
const ROLE_ALIAS: Record<string, string> = { SDI: 'MOSI', SDO: 'MISO' };

function splitSignal(sig: string): { prefix: string; digit: string } | null {
    const m = sig.match(/^([A-Za-z]+)(\d)$/);
    return m ? { prefix: m[1].toUpperCase(), digit: m[2] } : null;
}

// Returns, for each MCU pin, a datasheet-style "/"-separated list of
// alternate-function names (e.g. "SCL2/SCK2"), one entry per detected role.
export function detectPeripheralPins(src: string): Record<string, string> {
    const s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    const entries: Record<string, string[]> = {};
    const add = (pin: string, label: string): void => {
        const list = entries[pin] ??= [];
        if (!list.includes(label)) list.push(label);
    };

    for (const name of Object.keys(PERIPHERAL_PINS)) {
        if (!new RegExp(`\\b${name}\\s*\\.`).test(s)) continue;
        for (const [pin, role] of PERIPHERAL_PINS[name]) {
            add(pin, role + PERIPHERAL_INSTANCE[name]);
        }
    }

    // ── Comment-documented secondary/PPS-routed peripherals ──────────────────
    // Best effort: matches a "// RC1 = CLK2 (SCL2 in I2C mode / SCK2 in SPI
    // mode)" style pin-assignment comment, common in PPS-based PIC18 drivers
    // where the simulator can't otherwise see which pins a peripheral uses.
    for (const m of src.matchAll(/\/\/\s*(R[ABC][0-7])\s*=\s*(\w+)\s*\(([^)]*)\)/g)) {
        const [, pin, outerSig, desc] = m;
        const outerDigit = splitSignal(outerSig)?.digit ?? '2';
        let any = false;
        for (const bm of desc.matchAll(/(\w+)\s+in\s+(\w+)\s+mode/gi)) {
            const sp = splitSignal(bm[1]);
            const role = sp ? (ROLE_ALIAS[sp.prefix] ?? sp.prefix) : bm[1].toUpperCase();
            add(pin, role + (sp?.digit ?? outerDigit));
            any = true;
        }
        if (!any) {
            const sp = splitSignal(outerSig);
            const bus = sp && SIGNAL_BUS[sp.prefix];
            if (sp && bus) add(pin, (ROLE_ALIAS[sp.prefix] ?? sp.prefix) + sp.digit);
        }
    }

    const result: Record<string, string> = {};
    for (const pin of Object.keys(entries)) result[pin] = entries[pin].join('/');
    return result;
}
