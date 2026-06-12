// Best-effort static analysis of an Arduino-flavoured sketch: looks at
// pinMode/digitalRead/digitalWrite/analogRead calls and #include'd display
// libraries to figure out what hardware the sketch is driving, so the
// simulator can auto-place and auto-wire matching circuit parts.

export interface AutoWire { pin: string; term: string; }
export interface AutoPart { type: string; wires: AutoWire[]; }

// Per-pin configured role, shown in the simulator's pin grid (e.g. "OUTPUT",
// "INPUT", "PULLUP", "ANALOG", "I2C", "SPI").
export type PinModes = Record<string, string>;

export interface DetectResult { parts: AutoPart[]; pinModes: PinModes; }

// Native port-pin names — must match pinLabel() in sim/simWorker.ts
// (D0-D7=RC0-RC7, D8-D13=RB0-RB5, A0-A5=RA0-RA5).
function pinLabel(n: number): string | null {
    if (n >= 0  && n <= 7)  return 'RC' + n;
    if (n >= 8  && n <= 13) return 'RB' + (n - 8);
    if (n >= 14 && n <= 19) return 'RA' + (n - 14);
    return null;
}

// Arduino.h pin-name macros (see arduino_compat).
const PIN_MACROS: Record<string, number> = {
    D0: 0, D1: 1, D2: 2, D3: 3, D4: 4, D5: 5, D6: 6, D7: 7,
    D8: 8, D9: 9, D10: 10, D11: 11, D12: 12, D13: 13,
    A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19,
    LED_BUILTIN: 13,
};

// Native port-pin names (e.g. "RB0") -- arduino_compat's Arduino.h also
// defines these as aliases for D8/A0/etc., so a sketch that writes
// "pinMode(RB0, ...)" or "#define MODE_PIN0 RB0" refers to a pin already in
// the simulator's own RAx/RBx/RCx label format.
function isNativeLabel(t: string): boolean {
    const m = t.match(/^R([ABC])(\d)$/);
    if (!m) return false;
    const n = parseInt(m[2], 10);
    return m[1] === 'C' ? n <= 7 : n <= 5;
}

export function detectComponents(src: string): DetectResult {
    // Strip comments so they can't confuse the regexes below.
    const s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    // Resolve #define NAME <value> so custom pin aliases (e.g.
    // "#define LED_PIN 5" or "#define MODE_PIN0 RB0") work too.
    const defines: Record<string, string> = {};
    for (const m of s.matchAll(/^[ \t]*#define\s+(\w+)\s+(\S+)\s*$/gm)) {
        defines[m[1]] = m[2];
    }

    const resolvePin = (token: string, depth = 0): string | null => {
        if (depth > 8) return null;
        const t = token.trim();
        if (/^\d+$/.test(t))      return pinLabel(parseInt(t, 10));
        if (isNativeLabel(t))     return t;
        if (t in PIN_MACROS)      return pinLabel(PIN_MACROS[t]);
        if (t in defines)         return resolvePin(defines[t], depth + 1);
        return null;
    };

    const outputPins = new Set<string>();
    const inputModes = new Map<string, string>(); // label -> 'INPUT' | 'INPUT_PULLUP'
    const analogPins = new Set<string>();

    for (const m of s.matchAll(/pinMode\s*\(\s*(\w+)\s*,\s*(OUTPUT|INPUT_PULLUP|INPUT)\s*\)/g)) {
        const label = resolvePin(m[1]);
        if (!label) continue;
        if (m[2] === 'OUTPUT') outputPins.add(label);
        else inputModes.set(label, m[2]);
    }
    // digitalWrite/analogWrite without an explicit pinMode still implies an output.
    for (const m of s.matchAll(/(?:digitalWrite|analogWrite)\s*\(\s*(\w+)\s*,/g)) {
        const label = resolvePin(m[1]);
        if (label && !inputModes.has(label)) outputPins.add(label);
    }
    for (const m of s.matchAll(/analogRead\s*\(\s*(\w+)\s*\)/g)) {
        const label = resolvePin(m[1]);
        if (label) analogPins.add(label);
    }

    const parts: AutoPart[] = [];
    for (const pin of outputPins)      parts.push({ type: 'led', wires: [{ pin, term: '' }] });
    for (const pin of inputModes.keys()) parts.push({ type: 'button', wires: [{ pin, term: '' }] });
    for (const pin of analogPins) {
        if (outputPins.has(pin) || inputModes.has(pin)) continue;
        parts.push({ type: 'pot', wires: [{ pin, term: '' }] });
    }

    // Configured pin roles, shown in the simulator's pin grid.
    const pinModes: PinModes = {};
    for (const pin of outputPins) pinModes[pin] = 'OUTPUT';
    for (const [pin, mode] of inputModes) pinModes[pin] = mode === 'INPUT_PULLUP' ? 'PULLUP' : 'INPUT';
    for (const pin of analogPins) if (!(pin in pinModes)) pinModes[pin] = 'ANALOG';

    // Display libraries — wired to the fixed I2C pins (RA4=SDA, RA5=SCL) or
    // the fixed hardware-SPI pins (RB3=MOSI/SDA, RB5=SCK).
    const has = (needle: string): boolean => s.includes(needle);

    // Any Wire (I2C master) usage, e.g. an I2C sensor driver, claims the
    // fixed I2C pins even without a recognized display library.
    if (/\bWire\.(begin|beginTransmission|requestFrom)\s*\(/.test(s)) {
        pinModes['RA4'] = 'I2C';
        pinModes['RA5'] = 'I2C';
    }

    if (has('SPI.h') && /Adafruit_(ST7735|ST7789|ILI9341)/.test(s)) {
        let cs = 'RB2', dc = 'RB1', rst = 'RB0'; // default to D10/D9/D8
        const ctor = s.match(/Adafruit_(?:ST7735|ST7789|ILI9341)\s+\w+\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)/);
        if (ctor) {
            cs  = resolvePin(ctor[1]) ?? cs;
            dc  = resolvePin(ctor[2]) ?? dc;
            rst = resolvePin(ctor[3]) ?? rst;
        }
        parts.push({ type: 'spi_display', wires: [
            { pin: cs,    term: 'CS'  },
            { pin: dc,    term: 'DC'  },
            { pin: 'RB3', term: 'SDA' },
            { pin: 'RB5', term: 'SCK' },
            { pin: rst,   term: 'RST' },
        ]});
        pinModes['RB3'] = 'SPI';
        pinModes['RB5'] = 'SPI';
        pinModes[cs]    = 'OUTPUT';
        pinModes[dc]    = 'OUTPUT';
        pinModes[rst]   = 'OUTPUT';
    } else if (has('LiquidCrystal_I2C')) {
        const is2004 = /LiquidCrystal_I2C[^;]*\(\s*\w+\s*,\s*20\s*,\s*4\s*\)/.test(s);
        parts.push({ type: is2004 ? 'lcd2004' : 'lcd1602', wires: [
            { pin: 'RA4', term: 'SDA' },
            { pin: 'RA5', term: 'SCL' },
        ]});
        pinModes['RA4'] = 'I2C';
        pinModes['RA5'] = 'I2C';
    } else if (/SSD1306|U8g2|U8X8/.test(s)) {
        parts.push({ type: 'oled', wires: [
            { pin: 'RA4', term: 'SDA' },
            { pin: 'RA5', term: 'SCL' },
        ]});
        pinModes['RA4'] = 'I2C';
        pinModes['RA5'] = 'I2C';
    }

    return { parts, pinModes };
}
