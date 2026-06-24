import * as vscode from 'vscode';
import { SimulatorServer } from './sim/simulatorServer';
import { AutoPart } from './sim/detectComponents';

// Native port-pin names — must match pinLabel() in sim/simWorker.ts
// (D0-D7=RC0-RC7, D8-D13=RB0-RB5, A0-A5=RA0-RA5).
const DIGITAL_PINS = [
    ...Array.from({ length: 8 }, (_, i) => `RC${i}`),
    ...Array.from({ length: 6 }, (_, i) => `RB${i}`),
];
const ANALOG_PINS = Array.from({ length: 6 }, (_, i) => `RA${i}`);

function pinCell(label: string): string {
    return `
      <div class="pin-cell" id="pin-${label}">
        <div class="pin-led" id="led-${label}"></div>
        <div class="pin-name">${label}</div>
        <div class="pin-mode" id="mode-${label}">--</div>
        <div class="pin-periph" id="periph-${label}"></div>
      </div>`;
}

// RAx pins are dual-purpose: pinMode/digitalWrite/digitalRead work on them
// just like digital pins (LED + INPUT/OUTPUT/PULLUP mode label), but they
// also accept analogRead(). Tapping the cell reveals a slider so the user can
// simulate a potentiometer or sensor — dragging it overrides analogRead() for
// that pin. Tapping outside the cell hides the slider again.
function analogPinCell(label: string): string {
    return `
      <div class="pin-cell analog" id="pin-${label}" title="Click to show analog input slider">
        <div class="pin-led" id="led-${label}"></div>
        <div class="pin-name">${label}</div>
        <div class="pin-mode" id="mode-${label}">auto</div>
        <div class="pin-periph" id="periph-${label}"></div>
        <input type="range" class="pin-slider" id="slider-${label}" min="0" max="1023" value="512">
      </div>`;
}

export class SimulatorPanel {
    static current: SimulatorPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _disposed = false;
    private _onStop = new vscode.EventEmitter<void>();
    private _onRestart = new vscode.EventEmitter<void>();
    private _onPinInput = new vscode.EventEmitter<{ pin: string; value: number }>();
    private _onAnalogInput = new vscode.EventEmitter<{ pin: string; value: number }>();
    private _onOpenBrowser = new vscode.EventEmitter<void>();
    readonly onStop        = this._onStop.event;
    readonly onRestart     = this._onRestart.event;
    readonly onPinInput    = this._onPinInput.event;
    readonly onAnalogInput = this._onAnalogInput.event;
    readonly onOpenBrowser = this._onOpenBrowser.event;
    private _server: SimulatorServer | undefined;

    static createOrShow(): SimulatorPanel {
        const col = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;
        if (SimulatorPanel.current) {
            SimulatorPanel.current._panel.reveal(col);
            return SimulatorPanel.current;
        }
        const panel = vscode.window.createWebviewPanel(
            'picpioSimulator', 'PICPIO Simulator', col,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        SimulatorPanel.current = new SimulatorPanel(panel);
        return SimulatorPanel.current;
    }

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;
        this._panel.webview.html = renderSimulatorHtml();
        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(m => this._handleMessage(m), null, this._disposables);
    }

    /** Wire up the local "Open in Browser" server: forwards its commands the
     * same way as webview messages, and receives broadcast events. */
    setServer(server: SimulatorServer): void {
        this._server = server;
        this._disposables.push(server.onCommand(m => this._handleMessage(m)));
    }

    private _handleMessage(m: { command?: string; pin?: string; value?: number }): void {
        if (m.command === 'stop')        this._onStop.fire();
        if (m.command === 'restart')     this._onRestart.fire();
        if (m.command === 'setPin')      this._onPinInput.fire({ pin: m.pin!, value: m.value! });
        if (m.command === 'setAnalog')   this._onAnalogInput.fire({ pin: m.pin!, value: m.value! });
        if (m.command === 'openBrowser') this._onOpenBrowser.fire();
    }

    /** Reset the UI for a fresh run (e.g. on restart). */
    reset(): void {
        if (this._disposed) return;
        this._panel.webview.postMessage({ t: '_reset' });
        this._server?.broadcast({ t: '_reset' });
    }

    /** Auto-place and auto-wire circuit parts detected from the sketch's
     * source. The webview ignores this if the canvas is already populated
     * (e.g. the user has added/wired their own parts). */
    autoCircuit(parts: AutoPart[]): void {
        if (this._disposed || parts.length === 0) return;
        this._panel.webview.postMessage({ t: '_autoCircuit', parts });
        this._server?.broadcast({ t: '_autoCircuit', parts });
    }

    /** Label MCU pins that are wired to a fixed-pin peripheral (Wire/SPI/
     * Serial2 etc.) with their datasheet-style alternate-function name(s)
     * (e.g. "SCL2/SCK2"), since the simulator never runs that library's
     * pinMode() calls to report it itself. */
    setPeripheralPins(pins: Record<string, string>): void {
        if (this._disposed || Object.keys(pins).length === 0) return;
        this._panel.webview.postMessage({ t: '_peripheralPins', pins });
        this._server?.broadcast({ t: '_peripheralPins', pins });
    }

    /** Forward a JSON event emitted by the simulation worker to the webview. */
    post(ev: Record<string, unknown>): void {
        if (this._disposed) return;
        this._panel.webview.postMessage(ev);
        this._server?.broadcast(ev);
    }

    setStatus(status: 'running' | 'stopped' | 'error', message?: string): void {
        if (this._disposed) return;
        this._panel.webview.postMessage({ t: '_status', status, message });
        this._server?.broadcast({ t: '_status', status, message });
    }

    private _dispose(): void {
        this._disposed = true;
        SimulatorPanel.current = undefined;
        this._onStop.fire();
        while (this._disposables.length) this._disposables.pop()?.dispose();
        this._panel.dispose();
    }
}

export function renderSimulatorHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
:root{
  --bg:#1e1e1e;--card:#2d2d2d;--border:#3e3e42;
  --text:#cccccc;--sub:#888;--accent:#f27f0c;--radius:4px;
}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--text);font:13px/1.5 'Segoe UI',-apple-system,sans-serif;margin:0;padding:16px;height:100vh;overflow:auto}
.header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.title{font-size:16px;font-weight:700;color:var(--accent)}
.status{font-size:11px;font-weight:600;padding:3px 10px;border-radius:10px;border:1px solid var(--border);text-transform:uppercase;letter-spacing:.5px}
.status.running{color:#4ec9b0;border-color:#4ec9b0}
.status.stopped{color:var(--sub)}
.status.error{color:#f48771;border-color:#f48771}
.spacer{flex:1}
button{background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:6px 14px;font-size:12px;cursor:pointer}
button:hover{border-color:var(--accent);color:var(--accent)}
button.primary{background:var(--accent);border-color:var(--accent);color:#1e1e1e;font-weight:600}
button.primary:hover{background:#ff9933;color:#1e1e1e}
.section-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;color:var(--sub);border-bottom:1px solid var(--border);padding-bottom:6px;margin:18px 0 10px}
.pin-grid{display:flex;flex-wrap:wrap;gap:8px}
.pin-cell{width:64px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:8px 4px;text-align:center}
.pin-cell.input{cursor:pointer;border-color:#3794ff}
.pin-cell.input:hover{border-color:#5dabff}
.pin-cell.analog{cursor:pointer;width:90px}
.pin-slider{display:none;width:100%;margin:8px 0 4px;accent-color:#3794ff}
.pin-cell.analog.expanded .pin-slider{display:block}
.pin-led{width:18px;height:18px;border-radius:50%;background:#333;border:1px solid var(--border);margin:0 auto 6px;transition:background .1s,box-shadow .15s,opacity .15s}
.pin-led.on{background:#4ec9b0;box-shadow:0 0 8px #4ec9b0}
.pin-led.input-on{background:#3794ff;box-shadow:0 0 8px #3794ff}
.pin-led.pwm{background:var(--accent)}
.pin-name{font-weight:600;font-size:12px}
.pin-mode{color:var(--sub);font-size:9px;margin-top:2px;line-height:1.2;word-break:break-all;overflow-wrap:anywhere}
.pin-periph{color:var(--accent);font-size:9px;margin-top:2px;line-height:1.2;font-weight:600;word-break:break-all;overflow-wrap:anywhere}
.pin-periph:empty{display:none}
.circuit-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.circuit-toolbar .hint{color:var(--sub);font-size:11px}
.circuit-wrap{position:relative;border:1px solid var(--border);border-radius:var(--radius);background:#161616;height:420px;min-height:200px;max-height:85vh;overflow:auto;resize:vertical}
.circuit-parts{position:absolute;top:0;left:0;right:0;bottom:34px}
.circuit-pinrow{position:absolute;left:0;right:0;bottom:0;height:34px;display:flex;align-items:center;gap:10px;background:var(--card);border-top:1px solid var(--border);overflow-x:auto;padding:0 8px}
.circuit-pin{display:flex;flex-direction:column;align-items:center;font-size:9px;color:var(--sub);flex:none}
.wire-layer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.wire-layer line{stroke:#ffd700;stroke-width:2;cursor:pointer;pointer-events:stroke}
.term{width:10px;height:10px;border-radius:50%;background:#555;border:1px solid var(--border);cursor:pointer;margin:0 auto 2px}
.term.selected{background:var(--accent);box-shadow:0 0 6px var(--accent)}
.term.wired{background:#4ec9b0}
.circuit-part{position:absolute;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:6px;text-align:center;cursor:move;-webkit-user-select:none;user-select:none;min-width:56px}
.circuit-part .term{margin-top:6px}
.circuit-part .remove{position:absolute;top:1px;right:4px;color:var(--sub);cursor:pointer;font-size:12px;line-height:1}
.circuit-part .remove:hover{color:#f48771}
.circuit-part.selected{outline:2px solid var(--accent)}
.circuit-part .part-i2c{font-size:9px;color:var(--sub);margin-top:2px}
.circuit-part .part-label{font-size:10px;margin-top:4px;color:var(--sub)}
.part-led{width:18px;height:18px;border-radius:50%;background:#333;border:1px solid var(--border);margin:0 auto;transition:opacity .15s,box-shadow .15s,background .1s}
.part-btn{width:32px;height:32px;border-radius:6px;background:#444;border:2px solid var(--border);margin:0 auto;cursor:pointer}
.part-btn.pressed{background:#3794ff;border-color:#5dabff}
.circuit-part .part-pot{width:64px}
.circuit-toolbar select{background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:5px 8px;font-size:12px}
.circuit-toolbar select:hover{border-color:var(--accent)}
/* Realistic HD44780 character LCD: black bezel around a blue backlit panel,
   rendered as a true fixed character-cell matrix (one .lcd-cell per column),
   so text is snapped to its grid like real hardware. */
.part-lcd{
  display:grid; gap:1px; padding:5px; margin:6px auto 0; width:max-content;
  border-radius:5px; border:3px solid #0b1830;
  background:#16329a;   /* darker backlight shows through the 1px cell gaps */
  box-shadow:inset 0 0 7px rgba(0,0,0,.5), 0 2px 5px rgba(0,0,0,.55);
}
.lcd-cell{
  width:8px; height:13px; display:flex; align-items:center; justify-content:center;
  font-family:'Cascadia Code',Consolas,monospace; font-size:9px; line-height:1;
  color:#f3f8ff; background:#2f5be8; text-shadow:0 0 2px rgba(255,255,255,.55);
}
.part-lcd1602,.part-lcd2004{ /* size comes from the cell grid */ }
/* OLED / SPI glass: dark panel, metal bezel, cyan glow. */
.part-oled{
  color:#9efbff;font-family:'Cascadia Code',Consolas,monospace;font-size:8px;line-height:1.35;
  white-space:pre;text-align:left;margin:6px auto 0;padding:5px;width:132px;height:66px;border-radius:6px;
  border:3px solid #15181c;
  background:radial-gradient(130% 150% at 50% 0%, #0c1114 0%, #000 75%);
  box-shadow:inset 0 0 10px rgba(0,180,200,.16), 0 0 7px rgba(0,255,255,.12);
  text-shadow:0 0 3px rgba(90,255,255,.7);
}
/* ILI9488 colour TFT: a real 480x320 canvas scaled down inside a black bezel. */
.part-tft{
  display:block; width:200px; height:133px; margin:6px auto 0; border-radius:6px;
  border:3px solid #141414; background:#000;
  box-shadow:inset 0 0 8px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.5);
  image-rendering:auto;
}
.part-terms{display:flex;justify-content:center;gap:7px;margin-top:5px;flex-wrap:wrap}
.part-term{display:flex;flex-direction:column;align-items:center}
.part-term .term{margin:0}
.term-label{font-size:8px;color:var(--sub);margin-top:2px;line-height:1}
.term-pin{display:block;color:var(--accent);font-weight:700;font-size:8px;margin-top:1px;line-height:1.2}
.log-box{background:#161616;border:1px solid var(--border);border-radius:var(--radius);padding:10px;height:160px;overflow-y:auto;font-family:'Cascadia Code',Consolas,monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}
.log-line{margin:0 0 2px}
.log-tx{color:#4ec9b0}
.log-i2c{color:#9cdcfe}
.log-spi{color:#dcdcaa}
.log-pwm{color:var(--accent)}
.log-err{color:#f48771}
.log-info{color:var(--sub)}
.empty{color:var(--sub);font-style:italic}
.scope-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}
.scope-toolbar button{background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:5px 10px;font-size:12px;cursor:pointer}
.scope-toolbar button:hover{border-color:var(--accent)}
.scope-toolbar select{background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:var(--radius);padding:5px 8px;font-size:12px}
.scope-toolbar .hint{color:var(--sub);font-size:11px}
#scopeCanvas{width:100%;height:200px;background:#0b0b0b;border:1px solid var(--border);border-radius:var(--radius);display:block}
.part-neo{display:grid;gap:2px;padding:5px;margin:6px auto 0;justify-content:center;background:#0c0c0c;border:2px solid #1a1a1a;border-radius:5px}
.neo-led{width:8px;height:8px;border-radius:2px;background:#222;display:block}
.neo-ctl{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:4px}
.neo-ctl button{width:18px;height:16px;padding:0;line-height:1;background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:3px;cursor:pointer;font-size:11px}
.neo-ctl button:hover{border-color:var(--accent)}
.neo-ctl span{font-size:9px;color:var(--sub);min-width:36px;text-align:center}
.part-seg{display:flex;gap:3px;align-items:center;justify-content:center;padding:8px 10px;margin:6px auto 0;background:#1a0707;border:2px solid #2a0a0a;border-radius:6px}
.seg-digit{width:30px;height:52px;display:block}
.sseg{fill:#3a1212;transition:fill .04s}
.sseg.on{fill:#ff4136;filter:drop-shadow(0 0 2px #ff4136)}
.seg-colon{display:flex;flex-direction:column;justify-content:center;gap:14px;height:52px;padding:0 2px}
.seg-colon i{width:5px;height:5px;border-radius:50%;background:#3a1212;display:block}
.seg-colon.on i{background:#ff4136;box-shadow:0 0 2px #ff4136}
</style>
</head>
<body>
  <div class="header">
    <div class="title">&#9889; PICPIO Simulator</div>
    <div class="status stopped" id="status">stopped</div>
    <div class="spacer"></div>
    <button id="openBrowserBtn">&#8599; Open in Browser</button>
    <button class="primary" id="restartBtn">&#8635; Restart</button>
    <button id="stopBtn">&#9632; Stop</button>
  </div>

  <div class="section-title">Pins</div>
  <div class="pin-grid">
    ${DIGITAL_PINS.map(pinCell).join('')}
  </div>
  <div class="pin-grid" style="margin-top:8px">
    ${ANALOG_PINS.map(analogPinCell).join('')}
  </div>

  <div class="section-title">Signal Scope (DSO)</div>
  <div class="scope-toolbar">
    <button id="scopePauseBtn">&#10074;&#10074; Pause</button>
    <button id="scopeClearBtn">&#9851; Clear</button>
    <label class="hint">Window
      <select id="scopeWindow">
        <option value="2000">2 s</option>
        <option value="5000" selected>5 s</option>
        <option value="10000">10 s</option>
        <option value="20000">20 s</option>
      </select>
    </label>
    <span class="hint">Auto-traces every digital pin, PWM output and analog (ADC) read &mdash; vs time.</span>
  </div>
  <canvas id="scopeCanvas"></canvas>

  <div class="section-title">Circuit (beta)</div>
  <div class="circuit-toolbar">
    <select id="partType">
      <option value="led">LED</option>
      <option value="button">Push Button</option>
      <option value="pot">Potentiometer</option>
      <option value="lcd1602">LCD 16x2</option>
      <option value="lcd2004">LCD 20x4</option>
      <option value="oled">SSD1306</option>
      <option value="spi_display">SPI Display</option>
      <option value="tft">TFT 3.5" ILI9488</option>
      <option value="neopixel">NeoPixel strip</option>
      <option value="sevenseg">7-segment</option>
    </select>
    <button id="addPartBtn">+ Add</button>
    <span class="hint">Drag parts to position them. Click a pin terminal below, then a part's terminal, to connect them &mdash; the connected MCU pin is shown on the device.</span>
  </div>
  <div class="circuit-wrap" id="circuitWrap">
    <div class="circuit-parts" id="circuitParts"></div>
    <div class="circuit-pinrow" id="circuitPinRow">
      ${[...DIGITAL_PINS, ...ANALOG_PINS].map(p => `<div class="circuit-pin"><div class="term" id="term-${p}"></div>${p}</div>`).join('')}
    </div>
    <svg class="wire-layer" id="wireLayer"></svg>
  </div>

  <div class="section-title">Serial Monitor</div>
  <div class="log-box" id="serial"><span class="empty">Waiting for output…</span></div>

  <div class="section-title">Protocol Log (I2C / SPI / PWM)</div>
  <div class="log-box" id="protocol"><span class="empty">Waiting for activity…</span></div>

<script>
// Runs both inside the VS Code webview (acquireVsCodeApi available) and as a
// plain page served by SimulatorServer for "Open in Browser" (no VS Code
// API; commands go via POST /cmd and events arrive over Server-Sent Events).
const vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : null;

function sendMessage(msg) {
  if (vscode) {
    vscode.postMessage(msg);
  } else {
    fetch('/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) });
  }
}

document.getElementById('stopBtn').addEventListener('click', () => sendMessage({ command: 'stop' }));
document.getElementById('restartBtn').addEventListener('click', () => sendMessage({ command: 'restart' }));

const openBrowserBtn = document.getElementById('openBrowserBtn');
if (vscode) {
  openBrowserBtn.addEventListener('click', () => sendMessage({ command: 'openBrowser' }));
} else {
  openBrowserBtn.style.display = 'none';
}

let serialBuf = '';
let serialEl  = document.getElementById('serial');
let protoEl   = document.getElementById('protocol');
let protoEmpty = true;

function setStatus(status, message) {
  const el = document.getElementById('status');
  el.className = 'status ' + status;
  el.textContent = message ? (status + ': ' + message) : status;
}

const pinIsInput = new Set();

function setLed(pin, on, pwm, duty) {
  const led = document.getElementById('led-' + pin);
  if (!led) return;
  led.classList.remove('on', 'input-on', 'pwm');
  led.style.opacity = '';
  led.style.boxShadow = '';
  if (pwm) {
    led.classList.add('pwm');
    // Scale brightness/glow with duty cycle so a fade is visibly a fade,
    // not just an on/off flicker at the same intensity.
    const frac = Math.max(0, Math.min(1, (typeof duty === 'number' ? duty : 255) / 255));
    led.style.opacity = (0.12 + 0.88 * frac).toFixed(2);
    led.style.boxShadow = frac > 0 ? '0 0 ' + Math.round(2 + 10 * frac) + 'px var(--accent)' : 'none';
  } else if (on) {
    led.classList.add(pinIsInput.has(pin) ? 'input-on' : 'on');
  }
}

function setMode(pin, text) {
  const el = document.getElementById('mode-' + pin);
  if (el) el.textContent = text;
}

function setPeriph(pin, label) {
  const el = document.getElementById('periph-' + pin);
  if (el) el.textContent = label || '';
}

function setInputClickable(pin, clickable) {
  const cell = document.getElementById('pin-' + pin);
  if (!cell) return;
  cell.classList.toggle('input', clickable);
  if (clickable) {
    cell.title = 'Click to toggle input level (simulate button/sensor)';
    cell.onclick = () => {
      const led = document.getElementById('led-' + pin);
      const newVal = led && led.classList.contains('input-on') ? 0 : 1;
      setLed(pin, !!newVal, false);
      sendMessage({ command: 'setPin', pin, value: newVal });
    };
  } else {
    cell.title = '';
    cell.onclick = null;
  }
}

function appendProto(line, cls) {
  if (protoEmpty) { protoEl.innerHTML = ''; protoEmpty = false; }
  const div = document.createElement('div');
  div.className = 'log-line' + (cls ? ' ' + cls : '');
  div.textContent = line;
  protoEl.appendChild(div);
  protoEl.scrollTop = protoEl.scrollHeight;
}

function reset() {
  serialBuf = '';
  serialEl.innerHTML = '<span class="empty">Waiting for output…</span>';
  protoEl.innerHTML  = '<span class="empty">Waiting for activity…</span>';
  protoEmpty = true;
  pinIsInput.clear();
  DIGITAL_PINS_JS.forEach(p => {
    setLed(p, false, false);
    setMode(p, '--');
    setPeriph(p, '');
    setInputClickable(p, false);
  });
  ANALOG_PINS_JS.forEach(p => {
    setLed(p, false, false);
    setMode(p, 'auto');
    setPeriph(p, '');
    setInputClickable(p, false);
    const cell = document.getElementById('pin-' + p);
    if (cell) cell.classList.remove('expanded');
    const slider = document.getElementById('slider-' + p);
    if (slider) slider.value = 512;
  });
  Object.keys(lastDigital).forEach(p => delete lastDigital[p]);
  Object.keys(lastPwm).forEach(p => delete lastPwm[p]);
  Object.values(parts).forEach(part => updatePartLed(part.id, false, false));
  document.querySelectorAll('.part-oled').forEach(el => { el.textContent = ''; });
  document.querySelectorAll('.lcd-cell').forEach(c => { c.innerHTML = '&nbsp;'; });
  document.querySelectorAll('.part-tft').forEach(cv => { const x = cv.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, cv.height); });
  document.querySelectorAll('.neo-led').forEach(l => { l.style.background = '#222'; l.style.boxShadow = 'none'; });
  scopeReset();
}

const DIGITAL_PINS_JS = ${JSON.stringify(DIGITAL_PINS)};
const ANALOG_PINS_JS  = ${JSON.stringify(ANALOG_PINS)};

// Tapping an analog pin cell reveals its slider; tapping anywhere outside
// the cell hides it again. Dragging the slider simulates a potentiometer/
// sensor, overriding analogRead() for that pin until the simulation is
// restarted. If the sketch has put the pin in digital INPUT/INPUT_PULLUP
// mode, the cell instead acts like a digital input (see setInputClickable)
// and the slider toggle is suppressed.
ANALOG_PINS_JS.forEach(p => {
  const cell = document.getElementById('pin-' + p);
  const slider = document.getElementById('slider-' + p);
  if (!cell || !slider) return;
  cell.addEventListener('click', e => {
    if (e.target === slider || pinIsInput.has(p)) return;
    cell.classList.toggle('expanded');
  });
  slider.addEventListener('click', e => e.stopPropagation());
  slider.addEventListener('input', () => {
    setMode(p, slider.value);
    sendMessage({ command: 'setAnalog', pin: p, value: Number(slider.value) });
  });
});

document.addEventListener('click', e => {
  ANALOG_PINS_JS.forEach(p => {
    const cell = document.getElementById('pin-' + p);
    if (cell && cell.classList.contains('expanded') && !cell.contains(e.target)) {
      cell.classList.remove('expanded');
    }
  });
});

// ---- Circuit canvas: drag out LED/Button/Potentiometer parts and wire
// each one to an MCU pin terminal. Each part has a single terminal; the
// wire links it 1:1 to a pin and the part mirrors/drives that pin using
// the same digital/pwm/setPin/setAnalog events as the Pins grid above.
const circuitParts = document.getElementById('circuitParts');
const circuitWrap  = document.getElementById('circuitWrap');
const wireLayer    = document.getElementById('wireLayer');

// Terminal names per part type. A single '' entry means "one unnamed
// terminal" (rendered as the original plain dot, no label).
const TERMINALS = {
  led: [''], button: [''], pot: [''],
  lcd1602: ['SDA', 'SCL'], lcd2004: ['SDA', 'SCL'],
  oled: ['SDA', 'SCL'],
  spi_display: ['CS', 'DC', 'SDA', 'SCK', 'RST'],
  tft: ['CS', 'DC', 'RST', 'SDI', 'SCK'],
  neopixel: ['DIN'],
  sevenseg: [''],
};

function termKey(partId, term) { return partId + '|' + term; }

const parts = {};       // partId -> { id, type, el }
const pinToPart = {};   // mcuPin -> { partId, term }
const partToPin = {};   // 'partId|term' -> mcuPin
const lastDigital = {}; // mcuPin -> 0/1 (most recent digital event)
const lastPwm = {};     // mcuPin -> duty (most recent pwm event)
let wires = [];
let wireCounter = 0;
let partCounter = 0;
let selectedTerminal = null;
let selectedPart = null;

function termCenter(el) {
  const wrapRect = circuitWrap.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - wrapRect.left, y: r.top + r.height / 2 - wrapRect.top };
}

function redrawWire(w) {
  if (!w.lineEl) return;   // connections are shown as labels, not drawn lines
  const a = termCenter(w.mcuEl);
  const b = termCenter(w.partEl);
  w.lineEl.setAttribute('x1', a.x);
  w.lineEl.setAttribute('y1', a.y);
  w.lineEl.setAttribute('x2', b.x);
  w.lineEl.setAttribute('y2', b.y);
}

function redrawAllWires() {
  wires.forEach(redrawWire);
}

// Show/clear the connected MCU pin on the device terminal (e.g. SCL -> RC3),
// instead of drawing a wire. Labeled terminals get a pin tag under the term
// name; single-terminal parts (LED/Button/Pot) get it on the part label.
function setTermConnLabel(partId, term, mcuPin) {
  const part = parts[partId];
  if (!part) return;
  let lab;
  if (term) {
    const dot = document.getElementById(partId + '-term-' + term);
    lab = dot && dot.parentElement.querySelector('.term-label');
  } else {
    lab = part.el.querySelector('.part-label');
  }
  if (!lab) return;
  if (lab.dataset.base == null) lab.dataset.base = lab.textContent;
  lab.innerHTML = lab.dataset.base + '<span class="term-pin">' + mcuPin + '</span>';
}

function clearTermConnLabel(partId, term) {
  const part = parts[partId];
  if (!part) return;
  let lab;
  if (term) {
    const dot = document.getElementById(partId + '-term-' + term);
    lab = dot && dot.parentElement.querySelector('.term-label');
  } else {
    lab = part.el.querySelector('.part-label');
  }
  if (lab && lab.dataset.base != null) lab.textContent = lab.dataset.base;
}

function removeWire(w) {
  wires = wires.filter(x => x !== w);
  if (w.lineEl) w.lineEl.remove();
  w.partEl.classList.remove('wired');
  delete partToPin[termKey(w.partId, w.term)];
  clearTermConnLabel(w.partId, w.term);
  // An MCU pin can feed several devices (e.g. a shared I2C bus). Only clear
  // the pin's wired state once nothing else is connected to it.
  const others = wires.filter(x => x.mcuPin === w.mcuPin);
  if (others.length) pinToPart[w.mcuPin] = { partId: others[0].partId, term: others[0].term };
  else { w.mcuEl.classList.remove('wired'); delete pinToPart[w.mcuPin]; }
}

function updatePartLed(partId, on, pwm, duty) {
  const ledEl = document.getElementById(partId + '-led');
  if (!ledEl) return;
  ledEl.style.opacity = '';
  ledEl.style.boxShadow = '';
  if (pwm) {
    const frac = Math.max(0, Math.min(1, (typeof duty === 'number' ? duty : 255) / 255));
    ledEl.style.background = 'var(--accent)';
    ledEl.style.opacity = (0.12 + 0.88 * frac).toFixed(2);
    ledEl.style.boxShadow = frac > 0 ? '0 0 ' + Math.round(2 + 10 * frac) + 'px var(--accent)' : 'none';
  } else if (on) {
    ledEl.style.background = '#4ec9b0';
    ledEl.style.boxShadow = '0 0 8px #4ec9b0';
  } else {
    ledEl.style.background = '#333';
  }
}

function syncPartFromPinState(partId, pin) {
  if (pin in lastPwm) updatePartLed(partId, lastPwm[pin] > 0, true, lastPwm[pin]);
  else updatePartLed(partId, !!lastDigital[pin], false);
}

function connect(mcuPin, mcuEl, partId, term, partEl) {
  // A device terminal connects to exactly one pin, but a pin may drive several
  // device terminals (shared bus like I2C SDA/SCL) — so only drop a prior wire
  // on this same terminal, not every wire sharing the pin.
  const existingPart = wires.find(x => x.partId === partId && x.term === term);
  if (existingPart) removeWire(existingPart);

  const w = { id: 'w' + (++wireCounter), mcuPin, partId, term, mcuEl, partEl, lineEl: null };
  wires.push(w);
  mcuEl.classList.add('wired');
  partEl.classList.add('wired');
  pinToPart[mcuPin] = { partId, term };
  partToPin[termKey(partId, term)] = mcuPin;
  setTermConnLabel(partId, term, mcuPin);
  syncPartFromPinState(partId, mcuPin);
}

function clearSelection() {
  if (selectedTerminal) selectedTerminal.el.classList.remove('selected');
  selectedTerminal = null;
}

function onTerminalClick(kind, el, data) {
  if (selectedTerminal && selectedTerminal.el === el) { clearSelection(); return; }
  if (!selectedTerminal || selectedTerminal.kind === kind) {
    clearSelection();
    selectedTerminal = { kind, el, data };
    el.classList.add('selected');
    return;
  }
  const mcuSide  = selectedTerminal.kind === 'mcu'  ? selectedTerminal : { el, data };
  const partSide = selectedTerminal.kind === 'part' ? selectedTerminal : { el, data };
  clearSelection();
  connect(mcuSide.data, mcuSide.el, partSide.data.partId, partSide.data.term, partSide.el);
}

[...DIGITAL_PINS_JS, ...ANALOG_PINS_JS].forEach(p => {
  const el = document.getElementById('term-' + p);
  if (el) el.addEventListener('click', () => onTerminalClick('mcu', el, p));
});

const I2C_ADDR_DEFAULT = { lcd1602: '0x27', lcd2004: '0x27', oled: '0x3C' };

function applyPartTransform(id) {
  const p = parts[id];
  if (!p) return;
  const t = [];
  if (p.rotation) t.push('rotate(' + p.rotation + 'deg)');
  if (p.zoom !== 1) t.push('scale(' + p.zoom.toFixed(2) + ')');
  p.el.style.transform = t.join(' ');
  p.el.style.zIndex = (p.zoom > 1) ? '20' : '';
  redrawAllWires();
}

function selectPart(id) {
  if (selectedPart === id) return;
  if (selectedPart && parts[selectedPart]) parts[selectedPart].el.classList.remove('selected');
  selectedPart = id;
  if (id && parts[id]) parts[id].el.classList.add('selected');
}

// Size a TFT canvas: drawing buffer = panel pixels, and the on-screen box keeps
// its *longest* side at a fixed length so rotating portrait<->landscape turns
// the module (keeps its physical size) instead of shrinking it.
function sizeTftCanvas(cv, w, h) {
  cv.width = w; cv.height = h;
  const LONG = 210;
  if (w >= h) { cv.style.width = LONG + 'px'; cv.style.height = Math.round(LONG * h / w) + 'px'; }
  else        { cv.style.height = LONG + 'px'; cv.style.width  = Math.round(LONG * w / h) + 'px'; }
}

// Rotate the drawing coordinate system on the fixed glass (gw x gh) so the
// CONTENT turns with setRotation() while the module's on-screen shape stays
// the same. Returns the logical [width, height] for that rotation.
function applyTftRotation(cx, r, gw, gh) {
  r = r & 3;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  if (r === 1)      { cx.translate(gw, 0);  cx.rotate(Math.PI / 2);  return [gh, gw]; }
  else if (r === 2) { cx.translate(gw, gh); cx.rotate(Math.PI);      return [gw, gh]; }
  else if (r === 3) { cx.translate(0, gh);  cx.rotate(-Math.PI / 2); return [gh, gw]; }
  return [gw, gh];
}

// Execute one ILI9341/ILI9488 TFT draw op on a part canvas. The canvas buffer
// is the fixed physical glass (begin() dims); setRotation() rotates the drawing
// transform, not the box.
function drawTft(cx, m) {
  const cv = cx.canvas;
  switch (m.op) {
    case 'init':
      cv.dataset.gw = m.w; cv.dataset.gh = m.h; cv.dataset.lw = m.w; cv.dataset.lh = m.h;
      sizeTftCanvas(cv, m.w, m.h);             // fixed glass buffer + on-screen box
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.fillStyle = '#000';
      cx.fillRect(0, 0, m.w, m.h);
      break;
    case 'rotation': {
      // Rotate the content on the same fixed glass — shape unchanged.
      const gw = Number(cv.dataset.gw) || cv.width;
      const gh = Number(cv.dataset.gh) || cv.height;
      const [lw, lh] = applyTftRotation(cx, m.r, gw, gh);
      cv.dataset.lw = lw; cv.dataset.lh = lh;
      break;
    }
    case 'fill':
      cx.fillStyle = m.color;
      cx.fillRect(0, 0, Number(cv.dataset.lw) || cv.width, Number(cv.dataset.lh) || cv.height);
      break;
    case 'rect':
      if (m.fill) { cx.fillStyle = m.color; cx.fillRect(m.x, m.y, m.w, m.h); }
      else { cx.strokeStyle = m.color; cx.lineWidth = 1; cx.strokeRect(m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1); }
      break;
    case 'line':
      cx.strokeStyle = m.color; cx.lineWidth = 1;
      cx.beginPath(); cx.moveTo(m.x0 + 0.5, m.y0 + 0.5); cx.lineTo(m.x1 + 0.5, m.y1 + 0.5); cx.stroke();
      break;
    case 'circle':
      cx.beginPath(); cx.arc(m.x, m.y, m.r, 0, 2 * Math.PI);
      if (m.fill) { cx.fillStyle = m.color; cx.fill(); } else { cx.strokeStyle = m.color; cx.lineWidth = 1; cx.stroke(); }
      break;
    case 'text':
      cx.fillStyle = m.color; cx.textBaseline = 'top';
      cx.font = (8 * (m.size || 1)) + 'px Consolas, monospace';
      cx.fillText(m.str, m.x, m.y);
      break;
  }
}

// Render an LCD as a fixed cols x rows matrix of character cells, so each
// glyph snaps to its own dot-matrix window like real HD44780 hardware.
function renderLcd(el, lines, cols, rows) {
  if (!el) return;
  el.style.gridTemplateColumns = 'repeat(' + cols + ', 8px)';
  el.style.gridAutoRows = '13px';
  let html = '';
  for (let r = 0; r < rows; r++) {
    const line = (lines && lines[r] != null) ? String(lines[r]) : '';
    for (let c = 0; c < cols; c++) {
      const ch = (line[c] != null) ? line[c] : ' ';
      const t = ch === ' ' ? '&nbsp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch;
      html += '<span class="lcd-cell">' + t + '</span>';
    }
  }
  el.innerHTML = html;
}

// One 7-segment digit as an SVG (segments a..g + dp), each polygon tagged
// data-s so the 'seg' message can light them from a segment byte.
function sevenSegDigitSVG() {
  return '<svg class="seg-digit" viewBox="0 0 46 80">'
    + '<polygon class="sseg" data-s="a" points="8,2 38,2 32,8 14,8"/>'
    + '<polygon class="sseg" data-s="b" points="40,4 40,36 34,30 34,10"/>'
    + '<polygon class="sseg" data-s="c" points="40,44 40,76 34,70 34,50"/>'
    + '<polygon class="sseg" data-s="d" points="8,78 38,78 32,72 14,72"/>'
    + '<polygon class="sseg" data-s="e" points="6,44 6,76 12,70 12,50"/>'
    + '<polygon class="sseg" data-s="f" points="6,4 6,36 12,30 12,10"/>'
    + '<polygon class="sseg" data-s="g" points="8,40 14,37 32,37 38,40 32,43 14,43"/>'
    + '<circle class="sseg" data-s="dp" cx="43" cy="76" r="2.6"/>'
    + '</svg>';
}

function addPart(type, addr, opts) {
  const id = 'part' + (++partCounter);
  const el = document.createElement('div');
  el.className = 'circuit-part';
  el.style.left = (8 + (partCounter % 4) * 80) + 'px';
  el.style.top  = (8 + Math.floor(partCounter / 4) * 80) + 'px';

  let inner = '';
  let label = '';
  if (type === 'led')    { inner = '<div class="part-led" id="' + id + '-led"></div>'; label = 'LED'; }
  if (type === 'button') { inner = '<div class="part-btn" id="' + id + '-btn"></div>'; label = 'Push Button'; }
  if (type === 'pot')    { inner = '<input type="range" class="part-pot" id="' + id + '-range" min="0" max="1023" value="512">'; label = 'Pot'; }
  if (type === 'lcd1602') { inner = '<div class="part-lcd part-lcd1602" id="' + id + '-lcd"></div>'; label = 'LCD 16x2'; }
  if (type === 'lcd2004') { inner = '<div class="part-lcd part-lcd2004" id="' + id + '-lcd"></div>'; label = 'LCD 20x4'; }
  if (type === 'oled')    { inner = '<div class="part-oled" id="' + id + '-oled"></div>'; label = 'SSD1306'; }
  if (type === 'spi_display') { inner = '<div class="part-oled" id="' + id + '-oled"></div>'; label = 'SPI Display'; }
  if (type === 'tft')     { inner = '<canvas class="part-tft" id="' + id + '-tft" width="480" height="320"></canvas>'; label = 'TFT 3.5" ILI9488'; }
  if (type === 'neopixel') {
    const cnt = (opts && opts.count) || 16;
    let leds = '';
    for (let k = 0; k < cnt; k++) leds += '<i class="neo-led"></i>';
    inner = '<div class="part-neo" id="' + id + '-neo">' + leds + '</div>'
          + '<div class="neo-ctl"><button data-d="-1" title="Fewer columns">&minus;</button>'
          + '<span id="' + id + '-neodim"></span>'
          + '<button data-d="1" title="More columns">+</button></div>';
    label = 'NeoPixel x' + cnt;
  }
  if (type === 'sevenseg') {
    const cnt = (opts && opts.count) || 4;
    let digs = '';
    for (let k = 0; k < cnt; k++) {
      digs += sevenSegDigitSVG();
      // Clock-style colon only on TM1637 modules (which have a physical colon);
      // raw SevenSeg / MAX7219 displays don't.
      if ((opts && opts.dev === 'tm1637') && k === 1 && cnt === 4) digs += '<div class="seg-colon"><i></i><i></i></div>';
    }
    inner = '<div class="part-seg" id="' + id + '-seg">' + digs + '</div>';
    label = (opts && opts.label) || (cnt + '-digit 7-seg');
  }
  if (opts && opts.label) label = opts.label;

  // Auto-detected parts can supply their own terminals (e.g. an HC595 LCD's
  // DATA/CLK/LATCH GPIO lines instead of the default I2C SDA/SCL).
  const terms = (opts && opts.terms && opts.terms.length) ? opts.terms : (TERMINALS[type] || ['']);
  const termsHtml = (terms.length === 1 && terms[0] === '')
    ? '<div class="term" id="' + id + '-term"></div>'
    : '<div class="part-terms">' + terms.map(t =>
        '<div class="part-term"><div class="term" id="' + id + '-term-' + t + '"></div><div class="term-label">' + t + '</div></div>'
      ).join('') + '</div>';

  const zoomable = type === 'lcd1602' || type === 'lcd2004' || type === 'oled' || type === 'spi_display' || type === 'tft' || type === 'neopixel' || type === 'sevenseg';
  // I2C address badge: shown for I2C displays, but suppressed when the part is
  // explicitly on another bus (opts.i2c === false), e.g. an HC595-driven LCD.
  const showI2C = (opts && opts.i2c !== undefined)
    ? opts.i2c
    : (type === 'lcd1602' || type === 'lcd2004' || type === 'oled');
  const i2cAddr = showI2C ? (addr || I2C_ADDR_DEFAULT[type]) : null;
  const i2cHtml = i2cAddr ? '<div class="part-i2c">I2C ' + i2cAddr + '</div>' : '';
  el.innerHTML = '<span class="remove" title="Remove">&times;</span>' + inner +
    '<div class="part-label">' + label + '</div>' + i2cHtml + termsHtml;
  circuitParts.appendChild(el);
  if (type === 'lcd1602') renderLcd(document.getElementById(id + '-lcd'), [], 16, 2);
  if (type === 'lcd2004') renderLcd(document.getElementById(id + '-lcd'), [], 20, 4);
  if (type === 'tft') { const cv = document.getElementById(id + '-tft'); const cx = cv.getContext('2d'); cx.fillStyle = '#000'; cx.fillRect(0, 0, cv.width, cv.height); }
  if (type === 'neopixel') {
    const cnt = (opts && opts.count) || 16;
    let cols = cnt <= 16 ? cnt : Math.ceil(Math.sqrt(cnt));   // strip if small, else square-ish matrix
    const neoEl = document.getElementById(id + '-neo');
    const dimEl = document.getElementById(id + '-neodim');
    const updateDim = () => {
      neoEl.style.gridTemplateColumns = 'repeat(' + cols + ', 8px)';
      dimEl.textContent = cols + '×' + Math.ceil(cnt / cols);
    };
    updateDim();
    el.querySelectorAll('.neo-ctl button').forEach(btn => {
      btn.addEventListener('mousedown', e => e.stopPropagation());   // don't drag the part
      btn.addEventListener('click', e => {
        e.stopPropagation();
        cols = Math.max(1, Math.min(cnt, cols + Number(btn.dataset.d)));
        updateDim();
        redrawAllWires();
      });
    });
  }
  parts[id] = { id, type, el, dev: (opts && opts.dev) || null, rotation: 0, zoom: 1 };

  el.title = 'Click to select, then press Space to rotate' + (zoomable ? '. Scroll to zoom.' : '');
  el.addEventListener('click', () => selectPart(id));

  if (zoomable) {
    el.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      const p = parts[id];
      p.zoom = Math.max(0.5, Math.min(3, p.zoom + (e.deltaY < 0 ? 0.1 : -0.1)));
      applyPartTransform(id);
    }, { passive: false });
  }

  terms.forEach(t => {
    const termId = id + '-term' + (t ? '-' + t : '');
    const termEl = el.querySelector('#' + termId);
    termEl.addEventListener('click', e => { e.stopPropagation(); onTerminalClick('part', termEl, { partId: id, term: t }); });
  });

  el.querySelector('.remove').addEventListener('click', e => {
    e.stopPropagation();
    if (selectedTerminal && selectedTerminal.kind === 'part' && selectedTerminal.data.partId === id) clearSelection();
    if (selectedPart === id) selectedPart = null;
    wires.filter(x => x.partId === id).forEach(w => removeWire(w));
    delete parts[id];
    el.remove();
  });

  // Drag the part body to reposition it; connected wires follow.
  let dragging = false, offX = 0, offY = 0;
  el.addEventListener('mousedown', e => {
    if (e.target.closest('.term') || e.target.closest('.remove') || e.target.tagName === 'INPUT') return;
    dragging = true;
    offX = e.clientX - el.offsetLeft;
    offY = e.clientY - el.offsetTop;
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const bounds = circuitParts.getBoundingClientRect();
    // Rotation/zoom (transform) can make the rendered box differ from the
    // unrotated layout box (offsetLeft/offsetWidth) -- clamp using the
    // rendered box's offset from the layout position, which stays constant
    // as the part is translated.
    const rect = el.getBoundingClientRect();
    const dxRect = (rect.left - bounds.left) - el.offsetLeft;
    const dyRect = (rect.top  - bounds.top)  - el.offsetTop;
    const x = Math.max(-dxRect, Math.min(e.clientX - offX, bounds.width  - rect.width  - dxRect));
    const y = Math.max(-dyRect, Math.min(e.clientY - offY, bounds.height - rect.height - dyRect));
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    redrawAllWires();
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  if (type === 'button') {
    const btnEl = el.querySelector('#' + id + '-btn');
    const press = () => {
      btnEl.classList.add('pressed');
      const pin = partToPin[termKey(id, '')];
      if (pin) sendMessage({ command: 'setPin', pin, value: 0 });
    };
    const release = () => {
      if (!btnEl.classList.contains('pressed')) return;
      btnEl.classList.remove('pressed');
      const pin = partToPin[termKey(id, '')];
      if (pin) sendMessage({ command: 'setPin', pin, value: 1 });
    };
    btnEl.addEventListener('mousedown', e => { e.stopPropagation(); press(); });
    btnEl.addEventListener('mouseup',   e => { e.stopPropagation(); release(); });
    btnEl.addEventListener('mouseleave', release);
  }

  if (type === 'pot') {
    const rangeEl = el.querySelector('#' + id + '-range');
    rangeEl.addEventListener('mousedown', e => e.stopPropagation());
    rangeEl.addEventListener('input', () => {
      const pin = partToPin[termKey(id, '')];
      if (pin) sendMessage({ command: 'setAnalog', pin, value: Number(rangeEl.value) });
    });
  }

  return id;
}

// Auto-place and auto-wire parts detected from the sketch's source. Skipped
// if the canvas is already populated (manual edits or a previous auto-run).
function applyAutoCircuit(autoParts) {
  if (Object.keys(parts).length > 0) return;
  autoParts.forEach(ap => {
    const opts = {};
    if (ap.dev) opts.dev = ap.dev;
    if (ap.name) opts.label = ap.name;
    if (ap.count) opts.count = ap.count;
    const termList = (ap.wires || []).map(w => w.term).filter(Boolean);
    if (termList.length) opts.terms = termList;
    if (ap.iface === 'gpio') {
      opts.i2c = false;
      if (ap.type === 'lcd1602') opts.label = 'LCD 16x2 (HC595)';
      if (ap.type === 'lcd2004') opts.label = 'LCD 20x4 (HC595)';
    }
    const id = addPart(ap.type, ap.addr, opts);
    (ap.wires || []).forEach(w => {
      const mcuEl = document.getElementById('term-' + w.pin);
      const partEl = document.getElementById(id + '-term' + (w.term ? '-' + w.term : ''));
      if (mcuEl && partEl) connect(w.pin, mcuEl, id, w.term, partEl);
    });
  });
}

document.getElementById('addPartBtn').addEventListener('click', () => {
  const sel = document.getElementById('partType');
  addPart(sel.value);
});
window.addEventListener('resize', redrawAllWires);
new ResizeObserver(redrawAllWires).observe(circuitWrap);

circuitParts.addEventListener('click', e => {
  if (e.target === circuitParts) selectPart(null);
});

window.addEventListener('keydown', e => {
  if (e.code !== 'Space' || !selectedPart) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  e.preventDefault();
  const p = parts[selectedPart];
  if (!p) return;
  p.rotation = (p.rotation + 90) % 360;
  applyPartTransform(selectedPart);
});

// ---- Signal Scope (DSO) ---------------------------------------------------
// Buffers timestamped samples per signal and draws scrolling waveforms:
// digital pins as square waves, PWM as a 0-100% level, analog (ADC) as a
// 0-1023 trace. Samples are time-stamped on arrival (the worker runs delay()
// in real time, so arrival time tracks sketch time).
const scopeCanvas = document.getElementById('scopeCanvas');
const scopeCtx = scopeCanvas.getContext('2d');
const SCOPE_COLORS = ['#4ec9b0','#dcdcaa','#569cd6','#c586c0','#f48771','#9cdcfe','#b5cea8','#ce9178'];
let scopeSignals = {};   // name -> { kind, samples:[{t,v}], color }
let scopeOrder = [];     // signal names, first-seen order
let scopeWindowMs = 5000;
let scopeRunning = true;
let scopeStart = performance.now();
let scopeFrozenNow = null;

function scopeNow() {
  return scopeRunning ? (performance.now() - scopeStart) : (scopeFrozenNow !== null ? scopeFrozenNow : performance.now() - scopeStart);
}

function scopeReset() {
  scopeSignals = {};
  scopeOrder = [];
  scopeStart = performance.now();
  scopeFrozenNow = null;
  scopeRunning = true;
  const b = document.getElementById('scopePauseBtn');
  if (b) b.innerHTML = '&#10074;&#10074; Pause';
}

function scopeAdd(name, kind, v) {
  if (!scopeRunning) return;
  let sig = scopeSignals[name];
  if (!sig) {
    sig = scopeSignals[name] = { kind, samples: [], color: SCOPE_COLORS[scopeOrder.length % SCOPE_COLORS.length] };
    scopeOrder.push(name);
  }
  sig.kind = kind;
  const t = performance.now() - scopeStart;
  const last = sig.samples[sig.samples.length - 1];
  if (last && last.v === v && kind !== 'analog') return;   // dedupe flat digital/pwm
  sig.samples.push({ t: t, v: v });
  const cut = t - scopeWindowMs - 1000;
  while (sig.samples.length > 2 && sig.samples[1].t < cut) sig.samples.shift();
}

function scopeNorm(sig, v) {
  if (sig.kind === 'digital') return v ? 1 : 0;
  if (sig.kind === 'pwm') return Math.max(0, Math.min(1, v / 255));
  return Math.max(0, Math.min(1, v / 1023));   // analog 0-1023
}

function scopeDraw() {
  const dpr = window.devicePixelRatio || 1;
  const lanes = Math.max(1, scopeOrder.length);
  const cssW = scopeCanvas.clientWidth || 600;
  const cssH = Math.max(140, Math.min(48 * lanes, 360));
  if (scopeCanvas.style.height !== cssH + 'px') scopeCanvas.style.height = cssH + 'px';
  const pxW = Math.round(cssW * dpr), pxH = Math.round(cssH * dpr);
  if (scopeCanvas.width !== pxW || scopeCanvas.height !== pxH) { scopeCanvas.width = pxW; scopeCanvas.height = pxH; }
  scopeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scopeCtx.clearRect(0, 0, cssW, cssH);

  const labelW = 52;
  const plotW = cssW - labelW - 6;
  const now = scopeNow();
  const t0 = now - scopeWindowMs;
  const xOf = t => labelW + ((t - t0) / scopeWindowMs) * plotW;

  scopeCtx.font = '9px Consolas, monospace';

  // vertical time gridlines + labels, every 1s
  scopeCtx.strokeStyle = '#1b1b1b';
  scopeCtx.fillStyle = '#555';
  scopeCtx.lineWidth = 1;
  const step = scopeWindowMs <= 5000 ? 1000 : 2000;
  const firstTick = Math.ceil(t0 / step) * step;
  for (let tk = firstTick; tk <= now; tk += step) {
    const x = xOf(tk);
    scopeCtx.beginPath(); scopeCtx.moveTo(x, 0); scopeCtx.lineTo(x, cssH); scopeCtx.stroke();
    scopeCtx.fillText('-' + ((now - tk) / 1000).toFixed(0) + 's', x + 2, cssH - 3);
  }

  if (!scopeOrder.length) {
    scopeCtx.fillStyle = '#666';
    scopeCtx.fillText('No signals yet — run a sketch that toggles pins, drives PWM, or reads an ADC.', labelW, cssH / 2);
    return;
  }

  const laneH = cssH / scopeOrder.length;
  scopeOrder.forEach((name, i) => {
    const sig = scopeSignals[name];
    const top = i * laneH;
    const pad = 7;
    const yLo = top + laneH - pad;
    const yHi = top + pad;
    const yOf = nv => yLo - nv * (yLo - yHi);

    // lane separator
    scopeCtx.strokeStyle = '#222';
    scopeCtx.beginPath(); scopeCtx.moveTo(labelW, top + laneH); scopeCtx.lineTo(cssW, top + laneH); scopeCtx.stroke();

    // labels
    scopeCtx.fillStyle = sig.color;
    scopeCtx.fillText(name, 4, top + laneH / 2 - 1);
    scopeCtx.fillStyle = '#777';
    scopeCtx.fillText(sig.kind, 4, top + laneH / 2 + 10);

    // trace (sample-and-hold)
    scopeCtx.strokeStyle = sig.color;
    scopeCtx.lineWidth = 1.5;
    scopeCtx.beginPath();
    let prevY = null;
    const ss = sig.samples;
    for (let k = 0; k < ss.length; k++) {
      let x = xOf(ss[k].t);
      if (x < labelW) x = labelW;
      const y = yOf(scopeNorm(sig, ss[k].v));
      if (prevY === null) { scopeCtx.moveTo(x, y); }
      else { scopeCtx.lineTo(x, prevY); scopeCtx.lineTo(x, y); }
      prevY = y;
    }
    if (prevY !== null) scopeCtx.lineTo(Math.min(xOf(now), cssW), prevY);
    scopeCtx.stroke();
  });
}

function scopeLoop() { scopeDraw(); requestAnimationFrame(scopeLoop); }
requestAnimationFrame(scopeLoop);

document.getElementById('scopePauseBtn').addEventListener('click', () => {
  const b = document.getElementById('scopePauseBtn');
  if (scopeRunning) {
    scopeFrozenNow = performance.now() - scopeStart;
    scopeRunning = false;
    b.innerHTML = '&#9654; Resume';
  } else {
    scopeStart = performance.now() - scopeFrozenNow;   // continue without a time jump
    scopeFrozenNow = null;
    scopeRunning = true;
    b.innerHTML = '&#10074;&#10074; Pause';
  }
});
document.getElementById('scopeClearBtn').addEventListener('click', scopeReset);
document.getElementById('scopeWindow').addEventListener('change', e => {
  scopeWindowMs = Number(e.target.value) || 5000;
});

function handleSimMessage(m) {
  switch (m.t) {
    case '_reset':
      reset();
      break;
    case '_status':
      setStatus(m.status, m.message);
      break;
    case '_autoCircuit':
      applyAutoCircuit(m.parts);
      break;
    case '_peripheralPins':
      Object.keys(m.pins).forEach(pin => {
        setPeriph(pin, m.pins[pin]);
      });
      break;
    case 'pinMode':
      setMode(m.pin, m.mode === 'INPUT_PULLUP' ? 'PULLUP' : m.mode);
      if (m.mode === 'OUTPUT') {
        pinIsInput.delete(m.pin);
        setInputClickable(m.pin, false);
        setLed(m.pin, false, false);
      } else {
        pinIsInput.add(m.pin);
        setInputClickable(m.pin, true);
        setLed(m.pin, !!m.value, false);
      }
      break;
    case 'digital':
      setLed(m.pin, !!m.value, false);
      appendProto(m.pin + '  -> ' + (m.value ? 'HIGH' : 'LOW'), 'log-info');
      lastDigital[m.pin] = m.value;
      delete lastPwm[m.pin];
      if (pinToPart[m.pin]) updatePartLed(pinToPart[m.pin].partId, !!m.value, false);
      scopeAdd(m.pin, 'digital', m.value ? 1 : 0);
      break;
    case 'pwm':
      setMode(m.pin, 'PWM ' + Math.round(m.duty / 255 * 100) + '%');
      setLed(m.pin, m.duty > 0, true, m.duty);
      appendProto('PWM  ' + m.pin + '  duty=' + m.duty + ' (' + Math.round(m.duty/255*100) + '%)', 'log-pwm');
      lastPwm[m.pin] = m.duty;
      if (pinToPart[m.pin]) updatePartLed(pinToPart[m.pin].partId, m.duty > 0, true, m.duty);
      scopeAdd(m.pin, 'pwm', m.duty);
      break;
    case 'analog':
      scopeAdd(m.pin, 'analog', m.value);
      break;
    case 'serial':
      if (serialBuf === '') serialEl.innerHTML = '';
      serialBuf += m.data;
      serialEl.textContent = serialBuf;
      serialEl.scrollTop = serialEl.scrollHeight;
      break;
    case 'serialBegin':
      appendProto('Serial.begin(' + m.baud + ')', 'log-info');
      break;
    case 'i2cBegin':
      appendProto('Wire.begin()', 'log-info');
      break;
    case 'i2c':
      if (m.op === 'write') {
        appendProto('I2C  write -> 0x' + m.addr.toString(16) + '  [' + m.bytes.map(b => '0x' + b.toString(16).padStart(2,'0')).join(', ') + ']', 'log-i2c');
      } else {
        appendProto('I2C  read  <- 0x' + m.addr.toString(16) + '  (' + m.count + ' bytes)', 'log-i2c');
      }
      break;
    case 'spiBegin':
      appendProto('SPI.begin()', 'log-info');
      break;
    case 'spi':
      appendProto('SPI  transfer  tx=0x' + m.tx.toString(16).padStart(2,'0') + '  rx=0x' + m.rx.toString(16).padStart(2,'0'), 'log-spi');
      break;
    case 'oled':
      document.querySelectorAll('.part-oled').forEach(el => { el.textContent = m.lines.join('\\n'); });
      break;
    case 'lcd': {
      // Route to the LCD part matching this device ('hc595'/'i2c'); fall back
      // to every LCD if none was tagged (e.g. a manually added part).
      const matched = Object.keys(parts)
        .filter(pid => parts[pid].dev && parts[pid].dev === m.dev)
        .map(pid => document.getElementById(pid + '-lcd'));
      const targets = matched.filter(Boolean);
      const els = targets.length ? targets : Array.from(document.querySelectorAll('.part-lcd'));
      els.forEach(el => renderLcd(el, m.lines, m.cols || 16, m.rows || 2));
      break;
    }
    case 'tft': {
      const matched = Object.keys(parts)
        .filter(pid => parts[pid].dev === 'tft')
        .map(pid => document.getElementById(pid + '-tft'));
      const targets = matched.filter(Boolean);
      const els = targets.length ? targets : Array.from(document.querySelectorAll('.part-tft'));
      els.forEach(cv => drawTft(cv.getContext('2d'), m));
      break;
    }
    case 'seg': {
      // Route to 7-seg parts matching this device ('sevenseg'/'tm1637'/'max7219').
      const segMatched = Object.keys(parts)
        .filter(pid => parts[pid].dev && parts[pid].dev === m.dev)
        .map(pid => document.getElementById(pid + '-seg'));
      const segTargets = segMatched.filter(Boolean);
      const segEls = segTargets.length ? segTargets : Array.from(document.querySelectorAll('.part-seg'));
      segEls.forEach(cont => {
        const digits = cont.querySelectorAll('.seg-digit');
        for (let k = 0; k < digits.length; k++) {
          const b = (m.segs && m.segs[k]) || 0;
          digits[k].querySelectorAll('.sseg').forEach(poly => {
            const sname = poly.getAttribute('data-s');
            const on = (sname === 'dp') ? (b & 0x80) : (b & (1 << 'abcdefg'.indexOf(sname)));
            if (on) poly.classList.add('on'); else poly.classList.remove('on');
          });
        }
        const col = cont.querySelector('.seg-colon');
        if (col) { if (m.colon) col.classList.add('on'); else col.classList.remove('on'); }
      });
      break;
    }
    case 'neo':
      document.querySelectorAll('.part-neo').forEach(cont => {
        const leds = cont.children;
        for (let i = 0; i < leds.length; i++) {
          const c = m.pixels[i] || 'rgb(0,0,0)';
          const off = c === 'rgb(0,0,0)';
          leds[i].style.background = off ? '#222' : c;
          leds[i].style.boxShadow = off ? 'none' : '0 0 5px ' + c;
        }
      });
      break;
    case 'error':
      appendProto('ERROR (' + m.phase + '): ' + m.message, 'log-err');
      setStatus('error', m.phase);
      break;
    case 'done':
      setStatus('stopped');
      break;
  }
}

if (vscode) {
  window.addEventListener('message', e => handleSimMessage(e.data));
} else {
  const evtSource = new EventSource('/events');
  evtSource.onmessage = e => handleSimMessage(JSON.parse(e.data));
}
</script>
</body>
</html>`;
}
