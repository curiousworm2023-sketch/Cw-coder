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

export class SimulatorPanel {
    static current: SimulatorPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _disposed = false;
    private _onStop = new vscode.EventEmitter<void>();
    private _onRestart = new vscode.EventEmitter<void>();
    readonly onStop    = this._onStop.event;
    readonly onRestart = this._onRestart.event;

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
            if (m.command === 'stop')    this._onStop.fire();
            if (m.command === 'restart') this._onRestart.fire();
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
.pin-led{width:18px;height:18px;border-radius:50%;background:#333;border:1px solid var(--border);margin:0 auto 6px;transition:background .1s,box-shadow .1s}
.pin-led.on{background:#4ec9b0;box-shadow:0 0 8px #4ec9b0}
.pin-led.pwm{background:var(--accent);box-shadow:0 0 8px var(--accent)}
.pin-name{font-weight:600;font-size:12px}
.pin-mode{color:var(--sub);font-size:10px;margin-top:2px}
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
    ${ANALOG_PINS.map(pinCell).join('')}
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

function setLed(pin, on, pwm) {
  const led = document.getElementById('led-' + pin);
  if (!led) return;
  led.classList.toggle('on', !!on && !pwm);
  led.classList.toggle('pwm', !!pwm);
}

function setMode(pin, text) {
  const el = document.getElementById('mode-' + pin);
  if (el) el.textContent = text;
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
  [...DIGITAL_PINS_JS, ...ANALOG_PINS_JS].forEach(p => { setLed(p, false, false); setMode(p, '--'); });
}

const DIGITAL_PINS_JS = ${JSON.stringify(DIGITAL_PINS)};
const ANALOG_PINS_JS  = ${JSON.stringify(ANALOG_PINS)};

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
      setMode(m.pin, m.mode);
      if (m.mode === 'OUTPUT') setLed(m.pin, false, false);
      break;
    case 'digital':
      setLed(m.pin, !!m.value, false);
      break;
    case 'pwm':
      setMode(m.pin, 'PWM ' + Math.round(m.duty / 255 * 100) + '%');
      setLed(m.pin, m.duty > 0, m.duty > 0);
      appendProto('PWM  ' + m.pin + '  duty=' + m.duty + ' (' + Math.round(m.duty/255*100) + '%)', 'log-pwm');
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
