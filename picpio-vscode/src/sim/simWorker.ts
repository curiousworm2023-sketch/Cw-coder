// Runs transpiled sketch code (see transpile.ts) inside a vm sandbox that
// mimics the PICPIO API surface, emitting JSON events for pin
// changes, PWM, Serial and I2C/SPI traffic. Runs setup() once, then loop()
// repeatedly on a real-time interval. delay()/delayMicroseconds() advance a
// virtual clock AND really pause (1:1 with real time, matching hardware) so
// pin changes either side of a delay are streamed to the webview with
// visibly distinct timing.
import { parentPort, workerData } from 'worker_threads';
import * as vm from 'vm';

const code: string = workerData.code;
// Safety nets against a runaway loop() if the user never clicks Stop —
// generous enough that a normal "live" session won't hit them.
const MAX_ITERS = 100000;
const MAX_RUN_REAL_MS = 10 * 60 * 1000; // 10 minutes
const LOOP_INTERVAL_MS = 120;
// Caps a single setup()/loop() call, including any delay() inside it. Because
// delay() runs in real time, a loop() that plays a long animation sequence
// (e.g. several NeoPixel patterns back-to-back) can legitimately take tens of
// seconds — so this is generous. It's only a last-resort guard against a tight
// infinite loop; Stop/Restart/close kill the worker instantly via terminate().
const RUN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
// 1 virtual ms of delay() == this many real ms of pause (1:1 — matches
// real hardware timing).
const DELAY_SCALE = 1;

let stopped = false;
const realStart = Date.now();

function emit(ev: Record<string, unknown>): void {
    parentPort?.postMessage(ev);
}

// Native port-pin names — must match the RAx/RBx/RCx aliases defined in
// picpio_compat's Picpio.h (D0-D7=RC0-RC7, D8-D13=RB0-RB5, A0-A5=RA0-RA5).
function pinLabel(pin: number): string {
    const i = Math.trunc(Number(pin));
    if (i >= 0 && i <= 7)  return 'RC' + i;
    if (i >= 8 && i <= 13) return 'RB' + (i - 8);
    if (i >= 14 && i <= 19) return 'RA' + (i - 14);
    return 'P' + i;
}

const pinState: Record<string, { mode: string; value: number }> = {};

function pinMode(pin: number, mode: number): void {
    const label = pinLabel(pin);
    const m = mode === 1 ? 'OUTPUT' : mode === 2 ? 'INPUT_PULLUP' : 'INPUT';
    // INPUT_PULLUP idles HIGH (pulled up) until something drives it LOW —
    // e.g. a button wired to GND that hasn't been "pressed" in the panel yet.
    const def = m === 'INPUT_PULLUP' ? 1 : 0;
    pinState[label] = pinState[label] ?? { mode: m, value: def };
    pinState[label].mode = m;
    emit({ t: 'pinMode', pin: label, mode: m, value: pinState[label].value });
}

function digitalWrite(pin: number, val: number): void {
    const label = pinLabel(pin);
    const v = val ? 1 : 0;
    pinState[label] = pinState[label] ?? { mode: 'OUTPUT', value: 0 };
    pinState[label].value = v;
    emit({ t: 'digital', pin: label, value: v });
}

function digitalRead(pin: number): number {
    return pinState[pinLabel(pin)]?.value ?? 0;
}

function analogWrite(pin: number, val: number): void {
    const label = pinLabel(pin);
    const v = Math.max(0, Math.min(255, Math.round(Number(val))));
    emit({ t: 'pwm', pin: label, duty: v });
}

// User-set analog input values (e.g. dragging a potentiometer slider in the
// panel) override the simulated sine-wave reading for that pin.
const analogOverride: Record<string, number> = {};

// Throttle/dedupe analog samples streamed to the scope: emit identical values
// at most every 200ms (a heartbeat so the trace keeps extending), and changing
// values at most every 15ms.
const lastAnalogEmit: Record<string, { t: number; v: number }> = {};
function emitAnalog(label: string, v: number): void {
    const now = Date.now();
    const le = lastAnalogEmit[label];
    if (le && v === le.v && now - le.t < 200) return;
    if (le && now - le.t < 15) return;
    lastAnalogEmit[label] = { t: now, v };
    emit({ t: 'analog', pin: label, value: v });
}

function analogRead(pin: number): number {
    const label = pinLabel(pin);
    let v: number;
    if (label in analogOverride) {
        v = analogOverride[label];
    } else {
        const seed = label.charCodeAt(label.length - 1);
        v = Math.max(0, Math.min(1023, Math.floor(512 + 511 * Math.sin(millis() / 400 + seed))));
    }
    emitAnalog(label, v);
    return v;
}

// Really pauses this worker thread for `ms` real milliseconds, so events
// emitted before/after a delay() reach the webview with a perceptible gap.
function sleepReal(ms: number): void {
    const real = Math.round(ms);
    if (real <= 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, real);
}

// millis()/micros() track real elapsed wall-clock time (scaled by
// 1/DELAY_SCALE, currently 1:1), so sketches that poll millis() for
// non-blocking timing (instead of calling delay()) still see the clock
// advance between loop() iterations.
function millis(): number { return Math.floor((Date.now() - realStart) / DELAY_SCALE); }
function micros(): number { return millis() * 1000; }

function delay(ms: number): void {
    const m = Number(ms) || 0;
    emit({ t: 'delay', ms: m, millis: millis() + m });
    sleepReal(m * DELAY_SCALE);
}

function delayMicroseconds(us: number): void {
    sleepReal(((Number(us) || 0) / 1000) * DELAY_SCALE);
}

const Serial = {
    begin(baud: number) { emit({ t: 'serialBegin', baud: Number(baud) }); },
    end() { /* no-op */ },
    print(x: unknown) { emit({ t: 'serial', dir: 'tx', data: String(x) }); },
    println(x?: unknown) { emit({ t: 'serial', dir: 'tx', data: (x === undefined ? '' : String(x)) + '\n' }); },
    // picpio_compat's typed Serial.print_*/println_* members (used directly,
    // or via the Serial_print()/Serial_println() _Generic macros)
    print_s(x: unknown) { this.print(x); },
    print_i(x: unknown) { this.print(x); },
    print_f(f: number, decimals?: number) { this.print(Number(f).toFixed(decimals === undefined ? 2 : Number(decimals))); },
    println_s(x: unknown) { this.println(x); },
    println_i(x: unknown) { this.println(x); },
    println_f(f: number, decimals?: number) { this.println(Number(f).toFixed(decimals === undefined ? 2 : Number(decimals))); },
    write(x: unknown) { emit({ t: 'serial', dir: 'tx', data: typeof x === 'number' ? String.fromCharCode(x) : String(x) }); },
    available() { return 0; },
    read() { return -1; },
    peek() { return -1; },
    flush() { /* no-op */ },
};

function Serial_print(x: unknown): void { Serial.print(x); }
function Serial_println(x: unknown): void { Serial.println(x); }

const Wire = {
    _addr: 0,
    _txBuf: [] as number[],
    _rxBuf: [] as number[],
    _rxPos: 0,
    begin() { emit({ t: 'i2cBegin' }); },
    beginTransmission(addr: number) { this._addr = Number(addr); this._txBuf = []; },
    write(b: number) { this._txBuf.push(Number(b) & 0xFF); return 1; },
    endTransmission() {
        emit({ t: 'i2c', op: 'write', addr: this._addr, bytes: this._txBuf.slice() });
        return 0;
    },
    requestFrom(addr: number, n: number) {
        this._addr = Number(addr);
        this._rxBuf = new Array(Number(n)).fill(0);
        this._rxPos = 0;
        emit({ t: 'i2c', op: 'read', addr: this._addr, count: Number(n) });
        return Number(n);
    },
    available() { return this._rxBuf.length - this._rxPos; },
    read() { return this._rxPos < this._rxBuf.length ? this._rxBuf[this._rxPos++] : 0; },
};

const SPI = {
    begin() { emit({ t: 'spiBegin' }); },
    end() { /* no-op */ },
    setDataMode(_m: number) { /* no-op */ },
    setClockDivider(_d: number) { /* no-op */ },
    setBitOrder(_o: number) { /* no-op */ },
    transfer(b: number) {
        const tx = Number(b) & 0xFF;
        // No real slave attached in simulation: assume a MISO/MOSI loopback
        // so transfer() echoes the byte back, like a wired-loopback test rig.
        const rx = tx;
        emit({ t: 'spi', tx, rx });
        return rx;
    },
};

// SSD1306-style OLED emulation: a 21-col x 8-row character grid, mirroring
// the common picpio_compat ssd1306_* helper API. Each call re-emits the
// full grid as `{t:'oled', lines: string[]}` so the panel can redraw it.
const OLED_COLS = 21;
const OLED_ROWS = 8;
let oledBuf: string[] = Array.from({ length: OLED_ROWS }, () => ' '.repeat(OLED_COLS));
let oledCol = 0;
let oledRow = 0;

function emitOled(): void {
    emit({ t: 'oled', lines: oledBuf.slice() });
}

function ssd1306_init(): void {
    oledBuf = Array.from({ length: OLED_ROWS }, () => ' '.repeat(OLED_COLS));
    oledCol = 0;
    oledRow = 0;
    emitOled();
}

function ssd1306_clear(): void {
    oledBuf = Array.from({ length: OLED_ROWS }, () => ' '.repeat(OLED_COLS));
    oledCol = 0;
    oledRow = 0;
    emitOled();
}

function ssd1306_set_cursor(col: number, row: number): void {
    oledCol = Math.max(0, Math.min(OLED_COLS, Math.trunc(Number(col)) || 0));
    oledRow = Math.max(0, Math.min(OLED_ROWS - 1, Math.trunc(Number(row)) || 0));
}

function oledPutChar(ch: string): void {
    if (ch === '\n') {
        oledCol = 0;
        oledRow = (oledRow + 1) % OLED_ROWS;
        return;
    }
    if (oledCol >= OLED_COLS) {
        oledCol = 0;
        oledRow = (oledRow + 1) % OLED_ROWS;
    }
    const line = oledBuf[oledRow];
    oledBuf[oledRow] = line.slice(0, oledCol) + ch + line.slice(oledCol + 1);
    oledCol++;
}

// Mirrors C-string semantics for char arrays: numbers are treated as char
// codes (the digit-to-ASCII idiom), stopping at a 0/'\0' terminator.
function oledStringify(x: unknown): string {
    if (Array.isArray(x)) {
        let out = '';
        for (const v of x) {
            const code = typeof v === 'number' ? v : (typeof v === 'string' ? v.charCodeAt(0) : NaN);
            if (!code) break;
            out += String.fromCharCode(code);
        }
        return out;
    }
    return String(x);
}

function ssd1306_print(x: unknown): void {
    for (const ch of oledStringify(x)) oledPutChar(ch);
    emitOled();
}

function ssd1306_println(x?: unknown): void {
    if (x !== undefined) for (const ch of oledStringify(x)) oledPutChar(ch);
    oledPutChar('\n');
    emitOled();
}

function ssd1306_display(): void {
    emitOled();
}

// SSD1306_t struct-based API (picpio_tool/libraries/SSD1306) -- after
// transpilation "SSD1306_init(&oled, ...)" becomes "SSD1306_init(oled,
// ...)", where `oled` is a plain {} object standing in for the struct
// pointer. The device handle itself is ignored: the simulator only renders
// a single OLED via the shared character grid above.
const SSD1306_ADDRESS = 0x3C;
function SSD1306_BUFFER_SIZE(w: number, h: number): number {
    return Math.ceil((Number(w) * Number(h)) / 8);
}
function SSD1306_init(..._args: unknown[]): void {
    ssd1306_init();
}
function SSD1306_begin(..._args: unknown[]): boolean {
    return true;
}
function SSD1306_clearDisplay(..._dev: unknown[]): void {
    ssd1306_clear();
}
function SSD1306_setCursor(_dev: unknown, x: number, y: number): void {
    // Real SSD1306_setCursor takes pixel coordinates; approximate onto the
    // 21x8 character grid (6x8px glyphs) used by the text-mode emulation.
    ssd1306_set_cursor(Math.floor(Number(x) / 6), Math.floor(Number(y) / 8));
}
function SSD1306_print(_dev: unknown, x: unknown): void {
    ssd1306_print(x);
}
function SSD1306_println(_dev: unknown, x?: unknown): void {
    ssd1306_println(x);
}
function SSD1306_display(..._dev: unknown[]): void {
    ssd1306_display();
}

// HD44780 character-LCD emulation. A sketch can drive more than one LCD (e.g.
// one over a 74HC595 shift register, one over I2C), so each device gets its
// own buffer, keyed by `dev` ('hc595' / 'i2c'), and re-emits as
// {t:'lcd', dev, lines} so the panel can route it to the matching part.
function makeCharLcd(dev: string) {
    let cols = 16, rows = 2;
    let buf: string[] = Array.from({ length: rows }, () => ' '.repeat(cols));
    let col = 0, row = 0;
    const emitL = (): void => { emit({ t: 'lcd', dev, lines: buf.slice(), cols, rows }); };
    const reset = (c?: number, r?: number): void => {
        if (c) cols = Math.max(1, Math.trunc(Number(c)));
        if (r) rows = Math.max(1, Math.trunc(Number(r)));
        buf = Array.from({ length: rows }, () => ' '.repeat(cols));
        col = 0; row = 0;
    };
    const setCursor = (rr: number, cc: number): void => {
        row = Math.max(0, Math.min(rows - 1, Math.trunc(Number(rr)) || 0));
        col = Math.max(0, Math.min(cols - 1, Math.trunc(Number(cc)) || 0));
    };
    const put = (ch: string): void => {
        if (ch === '\n') { col = 0; row = (row + 1) % rows; return; }
        if (col >= cols) { col = 0; row = (row + 1) % rows; }
        buf[row] = buf[row].slice(0, col) + ch + buf[row].slice(col + 1);
        col++;
    };
    const print = (x: unknown): void => { for (const ch of oledStringify(x)) put(ch); emitL(); };
    const centerText = (rr: number, x: unknown): void => {
        const t = oledStringify(x);
        setCursor(rr, Math.max(0, Math.floor((cols - t.length) / 2)));
        print(t);
    };
    return { reset, emitL, setCursor, put, print, centerText };
}

const hc595 = makeCharLcd('hc595');   // LCD_HC595 library (LCD595_*)
const i2cLcd = makeCharLcd('i2c');    // LiquidCrystal_I2C library (LCD_*)

// LCD_HC595 public API — device handle ignored. setCursor/printAt take (row, col).
function LCD595_init(..._a: unknown[]): void { hc595.reset(); hc595.emitL(); }
function LCD595_begin(_d: unknown, cols: number, rows: number): void { hc595.reset(cols, rows); hc595.emitL(); }
function LCD595_clear(..._d: unknown[]): void { hc595.reset(); hc595.emitL(); }
function LCD595_home(..._d: unknown[]): void { hc595.setCursor(0, 0); }
function LCD595_setCursor(_d: unknown, row: number, col: number): void { hc595.setCursor(row, col); }
function LCD595_print(_d: unknown, str: unknown): void { hc595.print(str); }
function LCD595_printAt(_d: unknown, row: number, col: number, str: unknown): void { hc595.setCursor(row, col); hc595.print(str); }
function LCD595_write(_d: unknown, v: unknown): void { hc595.put(typeof v === 'number' ? String.fromCharCode(Number(v)) : String(v)); hc595.emitL(); }
function LCD595_centerText(_d: unknown, row: number, text: unknown): void { hc595.centerText(row, text); }

// LiquidCrystal_I2C public API — device handle ignored. setCursor takes (col, row).
function LCD_init(_l: unknown, _addr: number, cols: number, rows: number): void { i2cLcd.reset(cols, rows); i2cLcd.emitL(); }
function LCD_begin(_l: unknown, cols: number, rows: number, _cs?: number): void { i2cLcd.reset(cols, rows); i2cLcd.emitL(); }
function LCD_clear(..._l: unknown[]): void { i2cLcd.reset(); i2cLcd.emitL(); }
function LCD_home(..._l: unknown[]): void { i2cLcd.setCursor(0, 0); }
function LCD_setCursor(_l: unknown, col: number, row: number): void { i2cLcd.setCursor(row, col); }
function LCD_print(_l: unknown, str: unknown): void { i2cLcd.print(str); }
function LCD_writeChar(_l: unknown, v: unknown): void { i2cLcd.put(typeof v === 'number' ? String.fromCharCode(Number(v)) : String(v)); i2cLcd.emitL(); }

// ILI9488 480x320 TFT emulation. The library's draw calls aren't transpiled,
// so they're provided here as stubs that emit {t:'tft', op, ...} draw ops for
// the panel to execute on a color canvas. RGB565 colors -> CSS rgb().
function c565(c: number): string {
    const v = Number(c) & 0xFFFF;
    const r = Math.round(((v >> 11) & 0x1F) * 255 / 31);
    const g = Math.round(((v >> 5) & 0x3F) * 255 / 63);
    const b = Math.round((v & 0x1F) * 255 / 31);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
}
function tftEmit(op: Record<string, unknown>): void { emit(Object.assign({ t: 'tft' }, op)); }
function rgb565(r: number, g: number, b: number): number {
    return ((Number(r) & 0xF8) << 8) | ((Number(g) & 0xFC) << 3) | (Number(b) >> 3);
}
const tftText = { color: 0xFFFF, size: 1, x: 0, y: 0 };

function ILI9488_init(..._a: unknown[]): void { tftEmit({ op: 'init', w: 480, h: 320 }); }
function ILI9488_begin(_d: unknown, w: number, h: number): boolean { tftEmit({ op: 'init', w: Number(w) || 480, h: Number(h) || 320 }); return true; }
function ILI9488_fillScreen(_d: unknown, color: number): void { tftEmit({ op: 'fill', color: c565(color) }); }
function ILI9488_drawPixel(_d: unknown, x: number, y: number, color: number): void { tftEmit({ op: 'rect', x: +x, y: +y, w: 1, h: 1, fill: true, color: c565(color) }); }
function ILI9488_fillRect(_d: unknown, x: number, y: number, w: number, h: number, color: number): void { tftEmit({ op: 'rect', x: +x, y: +y, w: +w, h: +h, fill: true, color: c565(color) }); }
function ILI9488_drawRect(_d: unknown, x: number, y: number, w: number, h: number, color: number): void { tftEmit({ op: 'rect', x: +x, y: +y, w: +w, h: +h, fill: false, color: c565(color) }); }
function ILI9488_drawLine(_d: unknown, x0: number, y0: number, x1: number, y1: number, color: number): void { tftEmit({ op: 'line', x0: +x0, y0: +y0, x1: +x1, y1: +y1, color: c565(color) }); }
function ILI9488_drawCircle(_d: unknown, x: number, y: number, r: number, color: number): void { tftEmit({ op: 'circle', x: +x, y: +y, r: +r, fill: false, color: c565(color) }); }
function ILI9488_fillCircle(_d: unknown, x: number, y: number, r: number, color: number): void { tftEmit({ op: 'circle', x: +x, y: +y, r: +r, fill: true, color: c565(color) }); }
function ILI9488_setTextColor(_d: unknown, color: number): void { tftText.color = Number(color) & 0xFFFF; }
function ILI9488_setTextSize(_d: unknown, size: number): void { tftText.size = Math.max(1, Number(size) || 1); }
function ILI9488_setCursor(_d: unknown, x: number, y: number): void { tftText.x = +x; tftText.y = +y; }
function ILI9488_print(_d: unknown, str: unknown): void {
    const s = oledStringify(str);
    tftEmit({ op: 'text', x: tftText.x, y: tftText.y, str: s, color: c565(tftText.color), size: tftText.size });
    tftText.x += s.length * 6 * tftText.size;
}
function ILI9488_setRotation(_d: unknown, r: number): void { tftEmit({ op: 'rotation', r: Number(r) & 3 }); }

// NeoPixel / WS2812 strip emulation: a buffer of [r,g,b]; show() emits the whole
// strip as CSS colors for the panel to light up.
let neoBuf: number[][] = [];
let neoCount = 0;
function NeoPixel_init(_s: unknown, count: number): void {
    neoCount = Math.max(0, Math.min(1024, Math.trunc(Number(count)) || 0));
    neoBuf = Array.from({ length: neoCount }, () => [0, 0, 0]);
}
function NeoPixel_begin(_s: unknown): number {
    for (let i = 0; i < neoCount; i++) neoBuf[i] = [0, 0, 0];
    return 1;
}
function NeoPixel_setPixelColor(_s: unknown, i: number, r: number, g: number, b: number): void {
    const idx = Math.trunc(Number(i));
    if (idx >= 0 && idx < neoCount) neoBuf[idx] = [Number(r) & 0xFF, Number(g) & 0xFF, Number(b) & 0xFF];
}
function NeoPixel_clear(_s: unknown): void {
    for (let i = 0; i < neoCount; i++) neoBuf[i] = [0, 0, 0];
}
function NeoPixel_show(_s: unknown): void {
    emit({ t: 'neo', pixels: neoBuf.map(c => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')') });
}

// 7-segment displays (TM1637 / MAX7219 / raw SevenSeg). All three reduce to a
// per-digit segment buffer (bit0=a..bit6=g, bit7=dp); show() variants emit
// {t:'seg', dev, segs, colon} for the panel to light. segs[0] is the leftmost
// digit. SEG_FONT maps 0-9 to segment patterns.
const SEG_FONT = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F];

function makeSevenSeg(dev: string) {
    let n = 4;
    let segs: number[] = new Array(n).fill(0);
    let colon = 0;
    let last = 0;
    const emitNow = (): void => { emit({ t: 'seg', dev, segs: segs.slice(0, n), colon }); last = Date.now(); };
    const emitThrottled = (): void => { if (Date.now() - last >= 150) emitNow(); };
    const setCount = (c: number): void => {
        n = Math.max(1, Math.min(8, Math.trunc(Number(c)) || 4));
        segs = new Array(n).fill(0);
    };
    const clear = (): void => { segs = new Array(n).fill(0); emitNow(); };
    const setColon = (on: number): void => { colon = on ? 1 : 0; emitNow(); };
    const digitLeft = (pos: number, value: number, dp: number): void => {
        const p = Math.trunc(Number(pos));
        const v = Math.trunc(Number(value));
        if (p >= 0 && p < n) segs[p] = (v >= 0 && v <= 9 ? SEG_FONT[v] : 0) | (dp ? 0x80 : 0);
        emitNow();
    };
    const digitRight = (pos: number, value: number, dp: number): void => digitLeft(n - 1 - Math.trunc(Number(pos)), value, dp);
    const segByte = (pos: number, b: number): void => {
        const p = Math.trunc(Number(pos));
        if (p >= 0 && p < n) segs[p] = Number(b) & 0xFF;
        emitNow();
    };
    const number = (num: number): void => {
        let v = Math.trunc(Number(num)) || 0;
        const neg = v < 0; if (neg) v = -v;
        for (let i = 0; i < n; i++) segs[i] = 0;
        let p = n - 1;
        segs[p--] = SEG_FONT[v % 10]; v = Math.floor(v / 10);
        while (v > 0 && p >= 0) { segs[p--] = SEG_FONT[v % 10]; v = Math.floor(v / 10); }
        if (neg && p >= 0) segs[p] = 0x40;   // '-'
        emitNow();
    };
    const refresh = (): void => emitThrottled();
    return { setCount, clear, setColon, digitLeft, digitRight, segByte, number, refresh };
}

const ss7 = makeSevenSeg('sevenseg');
const tm16 = makeSevenSeg('tm1637');
const mx72 = makeSevenSeg('max7219');

// Raw multiplexed SevenSeg (pos 0 = leftmost).
function SevenSeg_init(_s: unknown, _seg: unknown, _dig: unknown, numDigits: number): void { ss7.setCount(numDigits); }
function SevenSeg_setDigit(_s: unknown, pos: number, value: number, dp: number): void { ss7.digitLeft(pos, value, dp); }
function SevenSeg_setSegments(_s: unknown, pos: number, segbits: number): void { ss7.segByte(pos, segbits); }
function SevenSeg_setNumber(_s: unknown, number: number): void { ss7.number(number); }
function SevenSeg_clear(_s: unknown): void { ss7.clear(); }
function SevenSeg_refresh(_s: unknown): void { ss7.refresh(); }

// TM1637 (4 digits, pos/index 0 = leftmost).
function TM1637_init(_d: unknown, _clk?: unknown, _dio?: unknown): void { tm16.setCount(4); }
function TM1637_setBrightness(): void { /* visual no-op */ }
function TM1637_setColon(_d: unknown, on: number): void { tm16.setColon(on); }
function TM1637_clear(_d: unknown): void { tm16.clear(); }
function TM1637_showNumber(_d: unknown, number: number): void { tm16.number(number); }
function TM1637_showDigits(_d: unknown, value: number[]): void {
    for (let i = 0; i < 4; i++) tm16.digitLeft(i, (value && value[i] !== undefined) ? value[i] : 0xFF, 0);
}
function TM1637_showSegments(_d: unknown, seg: number[]): void {
    for (let i = 0; i < 4; i++) tm16.segByte(i, (seg && seg[i] !== undefined) ? seg[i] : 0);
}

// MAX7219 (pos 0 = rightmost, like the chip's digit registers).
function MAX7219_init(_d: unknown, _cs: unknown, numDigits: number): void { mx72.setCount(numDigits); }
function MAX7219_setBrightness(): void { /* visual no-op */ }
function MAX7219_clear(_d: unknown): void { mx72.clear(); }
function MAX7219_showDigit(_d: unknown, pos: number, value: number, dp: number): void { mx72.digitRight(pos, value, dp); }
function MAX7219_showNumber(_d: unknown, number: number): void { mx72.number(number); }

function map(x: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
    return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}
function constrain(x: number, lo: number, hi: number): number {
    return Math.min(Math.max(x, lo), hi);
}
function random(a: number, b?: number): number {
    if (b === undefined) return Math.floor(Math.random() * a);
    return a + Math.floor(Math.random() * (b - a));
}

const baseGlobals: Record<string, unknown> = {
    Array, Object, Math, JSON, String, Number, Boolean,
    parseInt, parseFloat, isNaN, isFinite, console,
    HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2,
    LED_BUILTIN: 13,
    SPI_MODE0: 0, SPI_MODE1: 1, SPI_MODE2: 2, SPI_MODE3: 3,
    pinMode, digitalWrite, digitalRead, analogWrite, analogRead,
    delay, delayMicroseconds, millis, micros,
    Serial, Wire, SPI, Serial_print, Serial_println,
    // ── Canonical PICPIO API (gpio_/adc_/pwm_/sys_/uart1) — these are #define
    //    aliases in Picpio.h, which the sim never sees (only main.c is
    //    transpiled), so they must be provided here or they'd resolve to no-op
    //    stubs and the sketch would do nothing.
    gpio_mode: pinMode, gpio_write: digitalWrite, gpio_read: digitalRead,
    adc_read: analogRead, pwm_write: analogWrite,
    sys_delay: delay, sys_delay_us: delayMicroseconds,
    sys_millis: millis, sys_micros: micros,
    sys_init: () => { /* picpio_init: HAL setup, nothing to do in sim */ },
    sys_irq_on: () => { /* interrupts(): no-op in sim */ },
    sys_irq_off: () => { /* noInterrupts(): no-op in sim */ },
    interrupts: () => { /* no-op */ }, noInterrupts: () => { /* no-op */ },
    uart1: Serial, uart1_print: Serial_print, uart1_println: Serial_println,
    GPIO_IN: 0, GPIO_OUT: 1, GPIO_PULLUP: 2, GPIO_HIGH: 1, GPIO_LOW: 0,
    BUILTIN_LED: 13,
    ssd1306_init, ssd1306_clear, ssd1306_set_cursor, ssd1306_setCursor: ssd1306_set_cursor,
    ssd1306_print, ssd1306_println, ssd1306_display,
    SSD1306_ADDRESS, SSD1306_BUFFER_SIZE, SSD1306_init, SSD1306_begin, SSD1306_clearDisplay,
    SSD1306_setCursor, SSD1306_print, SSD1306_println, SSD1306_display,
    // HC595 character LCD (LCD_HC595 library). Unlisted LCD595_*/LCD_* helpers
    // (createChar, progressBar, blink, scroll, …) fall through to the no-op stub.
    LCD595_init, LCD595_begin, LCD595_clear, LCD595_home, LCD595_setCursor,
    LCD595_print, LCD595_printAt, LCD595_write, LCD595_centerText,
    LCD595_backlight: () => { /* visual no-op */ },
    LCD595_display: () => { /* no-op */ }, LCD595_noDisplay: () => { /* no-op */ },
    // I2C character LCD (LiquidCrystal_I2C library).
    LCD_5x8DOTS: 0x00, LCD_5x10DOTS: 0x04,
    LCD_init, LCD_begin, LCD_clear, LCD_home, LCD_setCursor, LCD_print, LCD_writeChar,
    LCD_backlight: () => { /* visual no-op */ }, LCD_noBacklight: () => { /* no-op */ },
    LCD_display: () => { /* no-op */ }, LCD_noDisplay: () => { /* no-op */ },
    // ILI9488 3.5" TFT (RGB565 color constants + draw API).
    ILI9488_BLACK: 0x0000, ILI9488_BLUE: 0x001F, ILI9488_RED: 0xF800, ILI9488_GREEN: 0x07E0,
    ILI9488_CYAN: 0x07FF, ILI9488_MAGENTA: 0xF81F, ILI9488_YELLOW: 0xFFE0, ILI9488_WHITE: 0xFFFF,
    ILI9488_init, ILI9488_begin, ILI9488_fillScreen, ILI9488_drawPixel, ILI9488_fillRect,
    ILI9488_drawRect, ILI9488_drawLine, ILI9488_drawCircle, ILI9488_fillCircle,
    ILI9488_setTextColor, ILI9488_setTextSize, ILI9488_setCursor, ILI9488_print,
    ILI9488_setRotation, ILI9488_rgb565: rgb565,
    // ILI9341 240x320 TFT — same draw model, aliased to the shared TFT emulation.
    ILI9341_BLACK: 0x0000, ILI9341_BLUE: 0x001F, ILI9341_RED: 0xF800, ILI9341_GREEN: 0x07E0,
    ILI9341_CYAN: 0x07FF, ILI9341_MAGENTA: 0xF81F, ILI9341_YELLOW: 0xFFE0, ILI9341_WHITE: 0xFFFF,
    ILI9341_rgb565: rgb565,
    ILI9341_init: ILI9488_init, ILI9341_begin: ILI9488_begin, ILI9341_fillScreen: ILI9488_fillScreen,
    ILI9341_drawPixel: ILI9488_drawPixel, ILI9341_fillRect: ILI9488_fillRect, ILI9341_drawRect: ILI9488_drawRect,
    ILI9341_drawLine: ILI9488_drawLine, ILI9341_drawCircle: ILI9488_drawCircle, ILI9341_fillCircle: ILI9488_fillCircle,
    ILI9341_setTextColor: ILI9488_setTextColor, ILI9341_setTextSize: ILI9488_setTextSize,
    ILI9341_setCursor: ILI9488_setCursor, ILI9341_print: ILI9488_print,
    ILI9341_setRotation: ILI9488_setRotation,
    // NeoPixel / WS2812 strip
    NeoPixel_init, NeoPixel_begin, NeoPixel_setPixelColor, NeoPixel_clear, NeoPixel_show,
    // 7-segment displays (raw SevenSeg / TM1637 / MAX7219)
    SevenSeg_init, SevenSeg_setDigit, SevenSeg_setSegments, SevenSeg_setNumber, SevenSeg_clear, SevenSeg_refresh,
    TM1637_init, TM1637_setBrightness, TM1637_setColon, TM1637_clear, TM1637_showNumber, TM1637_showDigits, TM1637_showSegments,
    MAX7219_init, MAX7219_setBrightness, MAX7219_clear, MAX7219_showDigit, MAX7219_showNumber,
    map, constrain, random,
    min: Math.min, max: Math.max, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt,
};
for (let i = 0; i <= 13; i++) baseGlobals['D' + i] = i;
for (let i = 0; i <= 5; i++) baseGlobals['A' + i] = 14 + i;
// Native port-pin aliases (same indices as D0-D13/A0-A5 — see Picpio.h)
for (let i = 0; i <= 7; i++) baseGlobals['RC' + i] = i;
for (let i = 0; i <= 5; i++) baseGlobals['RB' + i] = 8 + i;
for (let i = 0; i <= 5; i++) baseGlobals['RA' + i] = 14 + i;

// Stub object: stands in for any unknown identifier (PIC SFRs/PPS registers
// like TRISBbits.TRISB7, RB1PPS, ANSELCbits, etc). Reads/writes are no-ops
// that behave like 0 in numeric context, so register-level code compiles and
// runs harmlessly inside the simulator.
function makeStub(): unknown {
    const target: Record<PropertyKey, unknown> = function picpioStub() { /* callable stub */ } as unknown as Record<PropertyKey, unknown>;
    const handler: ProxyHandler<typeof target> = {
        get(t, prop) {
            if (prop === Symbol.toPrimitive) return (hint: string) => (hint === 'string' ? '' : 0);
            if (prop === 'valueOf') return () => 0;
            if (prop === 'toString') return () => '';
            if (prop in t) return t[prop];
            const child = makeStub();
            t[prop] = child;
            return child;
        },
        set(t, prop, value) { t[prop] = value; return true; },
        apply() { return makeStub(); },
        has() { return true; },
    };
    return new Proxy(target, handler);
}

const globalTarget: Record<string, unknown> = { ...baseGlobals };
const globalHandler: ProxyHandler<typeof globalTarget> = {
    has() { return true; },
    get(t, prop) {
        if (typeof prop === 'symbol') return (t as Record<PropertyKey, unknown>)[prop as unknown as string];
        if (prop in t) return t[prop];
        const stub = makeStub();
        t[prop] = stub;
        return stub;
    },
    set(t, prop, value) {
        (t as Record<PropertyKey, unknown>)[prop as unknown as string] = value;
        return true;
    },
};
const sandbox = new Proxy(globalTarget, globalHandler);
const ctx = vm.createContext(sandbox as unknown as object);

let interval: NodeJS.Timeout | undefined;
let finished = false;

function finish(): void {
    if (finished) return;
    finished = true;
    if (interval) clearInterval(interval);
    emit({ t: 'done' });
    parentPort?.close();
}

function fail(phase: string, e: unknown): void {
    emit({ t: 'error', phase, message: e instanceof Error ? e.message : String(e) });
    finish();
}

try {
    vm.runInContext(code, ctx, { timeout: RUN_TIMEOUT_MS, displayErrors: true });
} catch (e) {
    fail('compile', e);
}

if (!finished) {
    try {
        // Canonical PICPIO entry point is init(); setup() is the legacy alias.
        vm.runInContext('if (typeof init === "function") init(); else if (typeof setup === "function") setup();', ctx, { timeout: RUN_TIMEOUT_MS, displayErrors: true });
    } catch (e) {
        fail('setup', e);
    }
}

if (!finished) {
    let iter = 0;
    const startTime = Date.now();
    interval = setInterval(() => {
        if (stopped || iter >= MAX_ITERS || Date.now() - startTime > MAX_RUN_REAL_MS) {
            finish();
            return;
        }
        iter++;
        try {
            vm.runInContext(
                'if (typeof run === "function") run(); else if (typeof loop === "function") loop(); else throw new Error("run() is not defined");',
                ctx, { timeout: RUN_TIMEOUT_MS, displayErrors: true }
            );
        } catch (e) {
            fail('loop', e);
        }
    }, LOOP_INTERVAL_MS);
}

parentPort?.on('message', (msg) => {
    if (msg === 'stop' || (msg && typeof msg === 'object' && (msg as { cmd?: string }).cmd === 'stop')) {
        stopped = true;
        finish();
        return;
    }
    // User clicked an INPUT/INPUT_PULLUP pin in the panel to simulate a
    // button press/release: update what digitalRead()/digitalWrite() see.
    if (msg && typeof msg === 'object' && (msg as { cmd?: string }).cmd === 'setPin') {
        const { pin, value } = msg as { pin: string; value: number };
        const v = value ? 1 : 0;
        pinState[pin] = pinState[pin] ?? { mode: 'INPUT', value: v };
        pinState[pin].value = v;
        emit({ t: 'digital', pin, value: v });
    }
    // User dragged an analog pin's slider in the panel to simulate a
    // potentiometer/sensor: override what analogRead() returns for that pin.
    if (msg && typeof msg === 'object' && (msg as { cmd?: string }).cmd === 'setAnalog') {
        const { pin, value } = msg as { pin: string; value: number };
        analogOverride[pin] = Math.max(0, Math.min(1023, Math.round(Number(value))));
    }
});
