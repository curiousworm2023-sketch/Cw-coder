// Runs transpiled sketch code (see transpile.ts) inside a vm sandbox that
// mimics the Arduino-compat API surface, emitting JSON events for pin
// changes, PWM, Serial and I2C/SPI traffic. Runs setup() once, then loop()
// repeatedly on a real-time interval. delay()/delayMicroseconds() advance a
// virtual clock AND really pause (scaled down) so pin changes either side of
// a delay are streamed to the webview with visibly distinct timing.
import { parentPort, workerData } from 'worker_threads';
import * as vm from 'vm';

const code: string = workerData.code;
const MAX_ITERS = 200;
const MAX_RUN_REAL_MS = 20000;
const LOOP_INTERVAL_MS = 120;
const RUN_TIMEOUT_MS = 5000;
// 1 virtual ms of delay() == this many real ms of pause (10x speedup).
const DELAY_SCALE = 0.1;

let stopped = false;
const realStart = Date.now();

function emit(ev: Record<string, unknown>): void {
    parentPort?.postMessage(ev);
}

function pinLabel(pin: number): string {
    const i = Math.trunc(Number(pin));
    if (i >= 0 && i <= 13) return 'D' + i;
    if (i >= 14 && i <= 19) return 'A' + (i - 14);
    return 'P' + i;
}

const pinState: Record<string, { mode: string; value: number }> = {};

function pinMode(pin: number, mode: number): void {
    const label = pinLabel(pin);
    const m = mode === 1 ? 'OUTPUT' : mode === 2 ? 'INPUT_PULLUP' : 'INPUT';
    pinState[label] = pinState[label] ?? { mode: m, value: 0 };
    pinState[label].mode = m;
    emit({ t: 'pinMode', pin: label, mode: m });
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

function analogRead(pin: number): number {
    const seed = pinLabel(pin).charCodeAt(pinLabel(pin).length - 1);
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

// millis()/micros() track real elapsed wall-clock time scaled by 1/DELAY_SCALE
// (10x), so sketches that poll millis() for non-blocking timing (instead of
// calling delay()) still see the clock advance between loop() iterations.
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
    // arduino_compat's typed Serial.print_*/println_* members (used directly,
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
    map, constrain, random,
    min: Math.min, max: Math.max, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt,
};
for (let i = 0; i <= 13; i++) baseGlobals['D' + i] = i;
for (let i = 0; i <= 5; i++) baseGlobals['A' + i] = 14 + i;

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
        vm.runInContext('if (typeof setup === "function") setup();', ctx, { timeout: RUN_TIMEOUT_MS, displayErrors: true });
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
                'if (typeof loop === "function") loop(); else throw new Error("loop() is not defined");',
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
    }
});
