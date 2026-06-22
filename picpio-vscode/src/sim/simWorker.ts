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
// Caps a single setup()/loop() call, including any delay() inside it — must
// comfortably exceed the total delay() time a typical sketch uses per loop()
// now that delay() is 1:1 with real time.
const RUN_TIMEOUT_MS = 15000;
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

function analogRead(pin: number): number {
    const label = pinLabel(pin);
    if (label in analogOverride) return analogOverride[label];
    const seed = label.charCodeAt(label.length - 1);
    const v = Math.floor(512 + 511 * Math.sin(millis() / 400 + seed));
    return Math.max(0, Math.min(1023, v));
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
