import * as vscode from 'vscode';

const DIGITAL_PINS = Array.from({ length: 14 }, (_, i) => `D${i}`);
const ANALOG_PINS  = Array.from({ length: 6 },  (_, i) => `A${i}`);

function pinCell(label: string): string {
    return `
      <div class="pin-cell" id="pin-${label}">
        <div class="pin-led" id="led-${label}"></div>
        <div class="pin-name">${label}</div>
        <div class="pin-mode" id="mode-${label}">--</div>
      </div>`;
}

// Analog input pins get a slider so the user can simulate a potentiometer
// or sensor: dragging it overrides analogRead() for that pin.
function analogPinCell(label: string): string {
    return `
      <div class="pin-cell analog" id="pin-${label}">
        <div class="pin-name">${label}</div>
        <input type="range" class="pin-slider" id="slider-${label}" min="0" max="1023" value="512">
        <div class="pin-mode" id="mode-${label}">auto</div>
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
    readonly onStop        = this._onStop.event;
    readonly onRestart     = this._onRestart.event;
    readonly onPinInput    = this._onPinInput.event;
    readonly onAnalogInput = this._onAnalogInput.event;

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
        this._panel.webview.html = this._html();
        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(m => {
            if (m.command === 'stop')      this._onStop.fire();
            if (m.command === 'restart')   this._onRestart.fire();
            if (m.command === 'setPin')    this._onPinInput.fire({ pin: m.pin, value: m.value });
            if (m.command === 'setAnalog') this._onAnalogInput.fire({ pin: m.pin, value: m.value });
        }, null, this._disposables);
    }

    /** Reset the UI for a fresh run (e.g. on restart). */
    reset(): void {
        if (this._disposed) return;
        this._panel.webview.postMessage({ t: '_reset' });
    }

    /** Forward a JSON event emitted by the simulation worker to the webview. */
    post(ev: Record<string, unknown>): void {
        if (this._disposed) return;
        this._panel.webview.postMessage(ev);
    }

    setStatus(status: 'running' | 'stopped' | 'error', message?: string): void {
        if (this._disposed) return;
        this._panel.webview.postMessage({ t: '_status', status, message });
    }

    private _dispose(): void {
        this._disposed = true;
        SimulatorPanel.current = undefined;
        this._onStop.fire();
        while (this._disposables.length) this._disposables.pop()?.dispose();
        this._panel.dispose();
    }

    private _html(): string {
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
.pin-cell.analog{width:110px}
.pin-slider{width:100%;margin:8px 0 4px;accent-color:#3794ff}
.pin-led{width:18px;height:18px;border-radius:50%;background:#333;border:1px solid var(--border);margin:0 auto 6px;transition:background .1s,box-shadow .15s,opacity .15s}
.pin-led.on{background:#4ec9b0;box-shadow:0 0 8px #4ec9b0}
.pin-led.input-on{background:#3794ff;box-shadow:0 0 8px #3794ff}
.pin-led.pwm{background:var(--accent)}
.pin-name{font-weight:600;font-size:12px}
.pin-mode{color:var(--sub);font-size:9px;margin-top:2px;line-height:1.2;word-break:break-all;overflow-wrap:anywhere}
.circuit-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.circuit-toolbar .hint{color:var(--sub);font-size:11px}
.circuit-wrap{position:relative;border:1px solid var(--border);border-radius:var(--radius);background:#161616;height:280px;overflow:hidden}
.circuit-parts{position:absolute;top:0;left:0;right:0;bottom:34px}
.circuit-pinrow{position:absolute;left:0;right:0;bottom:0;height:34px;display:flex;align-items:center;gap:10px;background:var(--card);border-top:1px solid var(--border);overflow-x:auto;padding:0 8px}
.circuit-pin{display:flex;flex-direction:column;align-items:center;font-size:9px;color:var(--sub);flex:none}
.wire-layer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.wire-layer line{stroke:var(--accent);stroke-width:2;cursor:pointer;pointer-events:stroke}
.term{width:10px;height:10px;border-radius:50%;background:#555;border:1px solid var(--border);cursor:pointer;margin:0 auto 2px}
.term.selected{background:var(--accent);box-shadow:0 0 6px var(--accent)}
.term.wired{background:#4ec9b0}
.circuit-part{position:absolute;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:6px;text-align:center;cursor:move;-webkit-user-select:none;user-select:none;min-width:56px}
.circuit-part .term{margin-top:6px}
.circuit-part .remove{position:absolute;top:1px;right:4px;color:var(--sub);cursor:pointer;font-size:12px;line-height:1}
.circuit-part .remove:hover{color:#f48771}
.circuit-part .part-label{font-size:10px;margin-top:4px;color:var(--sub)}
.part-led{width:18px;height:18px;border-radius:50%;background:#333;border:1px solid var(--border);margin:0 auto;transition:opacity .15s,box-shadow .15s,background .1s}
.part-btn{width:32px;height:32px;border-radius:6px;background:#444;border:2px solid var(--border);margin:0 auto;cursor:pointer}
.part-btn.pressed{background:#3794ff;border-color:#5dabff}
.circuit-part .part-pot{width:64px}
.part-passive{width:36px;height:18px;background:#2d2d2d;border:1px solid var(--sub);border-radius:2px;margin:0 auto;font-size:8px;line-height:18px;color:var(--sub);overflow:hidden}
.part-toggle{font-size:9px;color:var(--text);display:flex;align-items:center;justify-content:center}
.oled-screen{background:#000;border:2px solid #333;border-radius:6px;padding:10px;font-family:'Cascadia Code',Consolas,monospace;font-size:12px;line-height:1.5;color:#7fffd4;white-space:pre;overflow:hidden;text-shadow:0 0 4px rgba(127,255,212,.6);letter-spacing:1px}
.log-box{background:#161616;border:1px solid var(--border);border-radius:var(--radius);padding:10px;height:160px;overflow-y:auto;font-family:'Cascadia Code',Consolas,monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}
.log-line{margin:0 0 2px}
.log-tx{color:#4ec9b0}
.log-i2c{color:#9cdcfe}
.log-spi{color:#dcdcaa}
.log-pwm{color:var(--accent)}
.log-err{color:#f48771}
.log-info{color:var(--sub)}
.empty{color:var(--sub);font-style:italic}
</style>
</head>
<body>
  <div class="header">
    <div class="title">&#9889; PICPIO Simulator</div>
    <div class="status stopped" id="status">stopped</div>
    <div class="spacer"></div>
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

  <div class="section-title">OLED Display (SSD1306)</div>
  <div class="oled-screen" id="oledScreen">${Array.from({ length: 8 }, () => ' '.repeat(21)).join('\n')}</div>

  <div class="section-title">Circuit (beta)</div>
  <div class="circuit-toolbar">
    <select id="partType">
      <optgroup label="LEDs &amp; Indicators">
        <option value="led_red">LED (Red)</option>
        <option value="led_green">LED (Green)</option>
        <option value="led_yellow">LED (Yellow)</option>
        <option value="led_blue">LED (Blue)</option>
        <option value="buzzer">Buzzer</option>
        <option value="relay">Relay Module</option>
        <option value="vibration">Vibration Motor</option>
      </optgroup>
      <optgroup label="Buttons &amp; Switches">
        <option value="button">Push Button</option>
        <option value="toggle">Toggle Switch</option>
        <option value="reed">Reed Switch</option>
        <option value="tilt">Tilt Switch</option>
        <option value="pir">PIR Motion Sensor</option>
        <option value="ir">IR Receiver</option>
      </optgroup>
      <optgroup label="Analog Sensors">
        <option value="pot">Potentiometer</option>
        <option value="ldr">Photoresistor (LDR)</option>
        <option value="thermistor">Thermistor</option>
        <option value="soil">Soil Moisture Sensor</option>
        <option value="flex">Flex Sensor</option>
        <option value="photodiode">Photodiode</option>
      </optgroup>
      <optgroup label="Passive (visual only)">
        <option value="resistor">Resistor</option>
        <option value="capacitor">Capacitor</option>
      </optgroup>
    </select>
    <button id="addPartBtn">+ Add</button>
    <span class="hint">Drag parts to position them. Click a pin terminal below, then a part's terminal, to wire them. Click a wire to remove it.</span>
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
const vscode = acquireVsCodeApi();
document.getElementById('stopBtn').addEventListener('click', () => vscode.postMessage({ command: 'stop' }));
document.getElementById('restartBtn').addEventListener('click', () => vscode.postMessage({ command: 'restart' }));

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
      vscode.postMessage({ command: 'setPin', pin, value: newVal });
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
    setInputClickable(p, false);
  });
  ANALOG_PINS_JS.forEach(p => {
    setMode(p, 'auto');
    const slider = document.getElementById('slider-' + p);
    if (slider) slider.value = 512;
  });
  Object.keys(lastDigital).forEach(p => delete lastDigital[p]);
  Object.keys(lastPwm).forEach(p => delete lastPwm[p]);
  Object.values(parts).forEach(part => updatePartLed(part.id, false, false));
  document.getElementById('oledScreen').textContent = Array.from({ length: 8 }, () => ' '.repeat(21)).join('\n');
}

const DIGITAL_PINS_JS = ${JSON.stringify(DIGITAL_PINS)};
const ANALOG_PINS_JS  = ${JSON.stringify(ANALOG_PINS)};

// Dragging an analog pin's slider simulates a potentiometer/sensor: it
// overrides analogRead() for that pin until the simulation is restarted.
ANALOG_PINS_JS.forEach(p => {
  const slider = document.getElementById('slider-' + p);
  if (!slider) return;
  slider.addEventListener('input', () => {
    setMode(p, slider.value);
    vscode.postMessage({ command: 'setAnalog', pin: p, value: Number(slider.value) });
  });
});

// ---- Circuit canvas: drag out LED/Button/Potentiometer parts and wire
// each one to an MCU pin terminal. Each part has a single terminal; the
// wire links it 1:1 to a pin and the part mirrors/drives that pin using
// the same digital/pwm/setPin/setAnalog events as the Pins grid above.
const circuitParts = document.getElementById('circuitParts');
const circuitWrap  = document.getElementById('circuitWrap');
const wireLayer    = document.getElementById('wireLayer');

const parts = {};       // partId -> { id, type, el }
const pinToPart = {};   // mcuPin -> partId
const partToPin = {};   // partId -> mcuPin
const lastDigital = {}; // mcuPin -> 0/1 (most recent digital event)
const lastPwm = {};     // mcuPin -> duty (most recent pwm event)
let wires = [];
let wireCounter = 0;
let partCounter = 0;
let selectedTerminal = null;

function termCenter(el) {
  const wrapRect = circuitWrap.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - wrapRect.left, y: r.top + r.height / 2 - wrapRect.top };
}

function redrawWire(w) {
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

function removeWire(w) {
  wires = wires.filter(x => x !== w);
  w.lineEl.remove();
  w.mcuEl.classList.remove('wired');
  w.partEl.classList.remove('wired');
  delete pinToPart[w.mcuPin];
  delete partToPin[w.partId];
}

function updatePartLed(partId, on, pwm, duty) {
  const ledEl = document.getElementById(partId + '-led');
  if (!ledEl) return;
  const color = (parts[partId] && parts[partId].color) || '#4ec9b0';
  ledEl.style.opacity = '';
  ledEl.style.boxShadow = '';
  if (pwm) {
    const frac = Math.max(0, Math.min(1, (typeof duty === 'number' ? duty : 255) / 255));
    ledEl.style.background = color;
    ledEl.style.opacity = (0.12 + 0.88 * frac).toFixed(2);
    ledEl.style.boxShadow = frac > 0 ? '0 0 ' + Math.round(2 + 10 * frac) + 'px ' + color : 'none';
  } else if (on) {
    ledEl.style.background = color;
    ledEl.style.boxShadow = '0 0 8px ' + color;
  } else {
    ledEl.style.background = '#333';
    ledEl.style.boxShadow = 'none';
  }
}

function syncPartFromPinState(partId, pin) {
  if (pin in lastPwm) updatePartLed(partId, lastPwm[pin] > 0, true, lastPwm[pin]);
  else updatePartLed(partId, !!lastDigital[pin], false);
}

function connect(mcuPin, mcuEl, partId, partEl) {
  const existingMcu = wires.find(x => x.mcuPin === mcuPin);
  if (existingMcu) removeWire(existingMcu);
  const existingPart = wires.find(x => x.partId === partId);
  if (existingPart) removeWire(existingPart);

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  wireLayer.appendChild(line);
  const w = { id: 'w' + (++wireCounter), mcuPin, partId, mcuEl, partEl, lineEl: line };
  line.addEventListener('click', () => removeWire(w));
  wires.push(w);
  mcuEl.classList.add('wired');
  partEl.classList.add('wired');
  pinToPart[mcuPin] = partId;
  partToPin[partId] = mcuPin;
  redrawWire(w);
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
  connect(mcuSide.data, mcuSide.el, partSide.data, partSide.el);
}

[...DIGITAL_PINS_JS, ...ANALOG_PINS_JS].forEach(p => {
  const el = document.getElementById('term-' + p);
  if (el) el.addEventListener('click', () => onTerminalClick('mcu', el, p));
});

// Each part type maps onto one of a handful of behaviours, all driven
// through the same single-terminal wiring mechanism: 'led' lights up from
// digital/pwm output, 'momentary' and 'toggle' drive a digital input,
// 'analog' drives an analog input via a slider, and 'passive' is a
// visual-only placeholder (resistor/capacitor) for drawing a fuller circuit.
const PART_DEFS = {
  led_red:    { label: 'LED (Red)',          kind: 'led', color: '#ff5555' },
  led_green:  { label: 'LED (Green)',        kind: 'led', color: '#4ec9b0' },
  led_yellow: { label: 'LED (Yellow)',       kind: 'led', color: '#ffd23f' },
  led_blue:   { label: 'LED (Blue)',         kind: 'led', color: '#3794ff' },
  buzzer:     { label: 'Buzzer',             kind: 'led', color: '#dcdcaa' },
  relay:      { label: 'Relay Module',       kind: 'led', color: '#f27f0c' },
  vibration:  { label: 'Vibration Motor',    kind: 'led', color: '#9cdcfe' },
  button:     { label: 'Push Button',        kind: 'momentary' },
  pir:        { label: 'PIR Motion Sensor',  kind: 'momentary' },
  ir:         { label: 'IR Receiver',        kind: 'momentary' },
  toggle:     { label: 'Toggle Switch',      kind: 'toggle' },
  reed:       { label: 'Reed Switch',        kind: 'toggle' },
  tilt:       { label: 'Tilt Switch',        kind: 'toggle' },
  pot:        { label: 'Potentiometer',      kind: 'analog' },
  ldr:        { label: 'Photoresistor (LDR)', kind: 'analog' },
  thermistor: { label: 'Thermistor',         kind: 'analog' },
  soil:       { label: 'Soil Moisture',      kind: 'analog' },
  flex:       { label: 'Flex Sensor',        kind: 'analog' },
  photodiode: { label: 'Photodiode',         kind: 'analog' },
  resistor:   { label: 'Resistor',           kind: 'passive' },
  capacitor:  { label: 'Capacitor',          kind: 'passive' },
};

function addPart(type) {
  const def = PART_DEFS[type];
  if (!def) return;
  const id = 'part' + (++partCounter);
  const el = document.createElement('div');
  el.className = 'circuit-part';
  el.style.left = (8 + (partCounter % 4) * 80) + 'px';
  el.style.top  = (8 + Math.floor(partCounter / 4) * 80) + 'px';

  let inner = '';
  if (def.kind === 'led')       inner = '<div class="part-led" id="' + id + '-led"></div>';
  if (def.kind === 'momentary') inner = '<div class="part-btn" id="' + id + '-btn"></div>';
  if (def.kind === 'toggle')    inner = '<div class="part-btn part-toggle" id="' + id + '-btn">OFF</div>';
  if (def.kind === 'analog')    inner = '<input type="range" class="part-pot" id="' + id + '-range" min="0" max="1023" value="512">';
  if (def.kind === 'passive')   inner = '<div class="part-passive" id="' + id + '-box">' + def.label + '</div>';

  el.innerHTML = '<span class="remove" title="Remove">&times;</span>' + inner +
    '<div class="part-label">' + def.label + '</div><div class="term" id="' + id + '-term"></div>';
  circuitParts.appendChild(el);
  parts[id] = { id, type, kind: def.kind, color: def.color, el };

  const termEl = el.querySelector('#' + id + '-term');
  termEl.addEventListener('click', e => { e.stopPropagation(); onTerminalClick('part', termEl, id); });

  el.querySelector('.remove').addEventListener('click', e => {
    e.stopPropagation();
    if (selectedTerminal && selectedTerminal.el === termEl) clearSelection();
    const w = wires.find(x => x.partId === id);
    if (w) removeWire(w);
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
    const x = Math.max(0, Math.min(e.clientX - offX, bounds.width - el.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - offY, bounds.height - el.offsetHeight));
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    redrawAllWires();
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  if (def.kind === 'momentary') {
    const btnEl = el.querySelector('#' + id + '-btn');
    const press = () => {
      btnEl.classList.add('pressed');
      const pin = partToPin[id];
      if (pin) vscode.postMessage({ command: 'setPin', pin, value: 0 });
    };
    const release = () => {
      if (!btnEl.classList.contains('pressed')) return;
      btnEl.classList.remove('pressed');
      const pin = partToPin[id];
      if (pin) vscode.postMessage({ command: 'setPin', pin, value: 1 });
    };
    btnEl.addEventListener('mousedown', e => { e.stopPropagation(); press(); });
    btnEl.addEventListener('mouseup',   e => { e.stopPropagation(); release(); });
    btnEl.addEventListener('mouseleave', release);
  }

  if (def.kind === 'toggle') {
    const btnEl = el.querySelector('#' + id + '-btn');
    let on = false;
    btnEl.addEventListener('click', e => {
      e.stopPropagation();
      on = !on;
      btnEl.classList.toggle('pressed', on);
      btnEl.textContent = on ? 'ON' : 'OFF';
      const pin = partToPin[id];
      if (pin) vscode.postMessage({ command: 'setPin', pin, value: on ? 0 : 1 });
    });
  }

  if (def.kind === 'analog') {
    const rangeEl = el.querySelector('#' + id + '-range');
    rangeEl.addEventListener('mousedown', e => e.stopPropagation());
    rangeEl.addEventListener('input', () => {
      const pin = partToPin[id];
      if (pin) vscode.postMessage({ command: 'setAnalog', pin, value: Number(rangeEl.value) });
    });
  }
}

document.getElementById('addPartBtn').addEventListener('click', () => {
  const sel = document.getElementById('partType');
  addPart(sel.value);
});
window.addEventListener('resize', redrawAllWires);

window.addEventListener('message', e => {
  const m = e.data;
  switch (m.t) {
    case '_reset':
      reset();
      break;
    case '_status':
      setStatus(m.status, m.message);
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
      if (pinToPart[m.pin]) updatePartLed(pinToPart[m.pin], !!m.value, false);
      break;
    case 'pwm':
      setMode(m.pin, 'PWM ' + Math.round(m.duty / 255 * 100) + '%');
      setLed(m.pin, m.duty > 0, true, m.duty);
      appendProto('PWM  ' + m.pin + '  duty=' + m.duty + ' (' + Math.round(m.duty/255*100) + '%)', 'log-pwm');
      lastPwm[m.pin] = m.duty;
      if (pinToPart[m.pin]) updatePartLed(pinToPart[m.pin], m.duty > 0, true, m.duty);
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
      document.getElementById('oledScreen').textContent = m.lines.join('\n');
      break;
    case 'error':
      appendProto('ERROR (' + m.phase + '): ' + m.message, 'log-err');
      setStatus('error', m.phase);
      break;
    case 'done':
      setStatus('stopped');
      break;
  }
});
</script>
</body>
</html>`;
    }
}
