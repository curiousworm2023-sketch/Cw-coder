// Best-effort static analysis of an Arduino-flavoured sketch: looks at
// pinMode/digitalRead/digitalWrite/analogRead calls and #include'd display
// libraries to figure out what hardware the sketch is driving, so the
// simulator can auto-place and auto-wire matching circuit parts.

export interface AutoWire { pin: string; term: string; }
export interface AutoPart { type: string; wires: AutoWire[]; }

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
    LED_BUILTIN: 13,
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
        return null;
    };

    const outputPins = new Set<string>();
    const inputPins  = new Set<string>();
    const analogPins = new Set<string>();

    for (const m of s.matchAll(/pinMode\s*\(\s*(\w+)\s*,\s*(OUTPUT|INPUT_PULLUP|INPUT)\s*\)/g)) {
        const label = resolvePin(m[1]);
        if (!label) continue;
        if (m[2] === 'OUTPUT') outputPins.add(label);
        else inputPins.add(label);
    }
    // digitalWrite/analogWrite without an explicit pinMode still implies an output.
    for (const m of s.matchAll(/(?:digitalWrite|analogWrite)\s*\(\s*(\w+)\s*,/g)) {
        const label = resolvePin(m[1]);
        if (label && !inputPins.has(label)) outputPins.add(label);
    }
    for (const m of s.matchAll(/analogRead\s*\(\s*(\w+)\s*\)/g)) {
        const label = resolvePin(m[1]);
        if (label) analogPins.add(label);
    }

    const parts: AutoPart[] = [];
    for (const pin of outputPins) parts.push({ type: 'led', wires: [{ pin, term: '' }] });
    for (const pin of inputPins)  parts.push({ type: 'button', wires: [{ pin, term: '' }] });
    for (const pin of analogPins) {
        if (outputPins.has(pin) || inputPins.has(pin)) continue;
        parts.push({ type: 'pot', wires: [{ pin, term: '' }] });
    }

    // Display libraries — wired to the fixed I2C pins (RA4=SDA, RA5=SCL) or
    // the fixed hardware-SPI pins (RB3=MOSI/SDA, RB5=SCK).
    const has = (needle: string): boolean => s.includes(needle);

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
    } else if (has('LiquidCrystal_I2C')) {
        const is2004 = /LiquidCrystal_I2C[^;]*\(\s*\w+\s*,\s*20\s*,\s*4\s*\)/.test(s);
        parts.push({ type: is2004 ? 'lcd2004' : 'lcd1602', wires: [
            { pin: 'RA4', term: 'SDA' },
            { pin: 'RA5', term: 'SCL' },
        ]});
    } else if (/SSD1306|U8g2|U8X8/.test(s)) {
        parts.push({ type: 'oled', wires: [
            { pin: 'RA4', term: 'SDA' },
            { pin: 'RA5', term: 'SCL' },
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
    Wire2:   [['RB0', 'SCL'],  ['RB1', 'SDA']],
    SPI:     [['RC3', 'SCK'],  ['RC5', 'MOSI'], ['RC4', 'MISO']],
    SPI2:    [['RB2', 'SCK'],  ['RB3', 'MOSI'], ['RB4', 'MISO']],
    Serial:  [['RC6', 'TX'],   ['RC7', 'RX']],
    Serial2: [['RC0', 'TX'],   ['RC1', 'RX']],
};

// Instance number suffixed onto each role below to form a datasheet-style
// alternate-function name (e.g. role "SCL" on Wire2 -> "SCL2").
const PERIPHERAL_INSTANCE: Record<string, string> = {
    Wire: '1', Wire2: '2',
    SPI: '1', SPI2: '2',
    Serial: '1', Serial2: '2',
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
