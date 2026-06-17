import * as vscode from 'vscode';
import * as cp     from 'child_process';
import * as fs     from 'fs';
import * as path   from 'path';
import { BAUD_RATES, getAvailablePorts, ensureMonitorScript } from './serialMonitorServer';
import { readConfig } from './iniParser';
import { runTracked } from './terminal';

// Result of scanning the project's main.cpp for the PID setup, so the panel
// can pre-fill the setpoint/input variable names, starting gains, and tell
// whether the PIDTune firmware handler is wired in.
interface PidInfo {
    found:        boolean;
    inputVar?:    string;
    outputVar?:   string;
    setpointVar?: string;
    kp?:          string;
    ki?:          string;
    kd?:          string;
    hasPidTune:   boolean;
    setpointInit?: string;
    vars:         string[];   // candidate numeric globals the user can pick as setpoint/PV
}

// Collect global numeric variable names (double/float/int/...) declared in the
// source so the user can pick a setpoint / process variable even when no
// PID_init(...) is present to auto-detect them.
function collectNumericVars(text: string): string[] {
    const out: string[] = [];
    const declRe = /\b(?:double|float|int|long|short|uint8_t|uint16_t|uint32_t|int8_t|int16_t|int32_t)\s+([^;{}()]+);/g;
    let m: RegExpExecArray | null;
    while ((m = declRe.exec(text)) !== null) {
        for (let part of m[1].split(',')) {
            part = part.replace(/=.*$/, '').replace(/[*&\[\]]/g, '').trim();
            const name = part.split(/\s+/).pop() || '';
            if (/^[A-Za-z_]\w*$/.test(name) && out.indexOf(name) < 0) out.push(name);
        }
    }
    return out;
}

function findMainCpp(): string | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return undefined;
    const cfg = readConfig();
    const srcDir = (cfg as any)?.src_dir || 'src';
    const candidate = path.join(root, srcDir, 'main.cpp');
    if (fs.existsSync(candidate)) return candidate;
    const alt = path.join(root, 'src', 'main.cpp');
    return fs.existsSync(alt) ? alt : undefined;
}

// Parse `PID_init(&pid, &input, &output, &setpoint, Kp, Ki, Kd, DIR);` and the
// initial `double ... setpoint = NNN;` so the UI can offer real values.
function parsePidInfo(): PidInfo {
    const file = findMainCpp();
    const info: PidInfo = { found: false, hasPidTune: false, vars: [] };
    if (!file) return info;

    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return info; }

    info.vars = collectNumericVars(text);
    info.hasPidTune = /PIDTune_service\s*\(/.test(text) || /#include\s*"PIDTune\.h"/.test(text);

    const m = text.match(
        /PID_init\s*\(\s*&\s*(\w+)\s*,\s*&\s*(\w+)\s*,\s*&\s*(\w+)\s*,\s*&\s*(\w+)\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)/
    );
    if (m) {
        info.found       = true;
        info.inputVar    = m[2];
        info.outputVar   = m[3];
        info.setpointVar = m[4];
        info.kp = m[5];
        info.ki = m[6];
        info.kd = m[7];

        // Initial setpoint value, if declared like `double ..., pidSetpoint = 100;`
        const spRe = new RegExp(info.setpointVar + '\\s*=\\s*([\\d.eE+-]+)');
        const sm = text.match(spRe);
        if (sm) info.setpointInit = sm[1];
    }
    return info;
}

// Rewrite the Kp/Ki/Kd arguments of the PID_init(...) call in main.cpp with
// the tuned values. Returns true on success.
function applyGainsToMainCpp(kp: number, ki: number, kd: number): boolean {
    const file = findMainCpp();
    if (!file) return false;
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }

    const re = /(PID_init\s*\(\s*&\s*\w+\s*,\s*&\s*\w+\s*,\s*&\s*\w+\s*,\s*&\s*\w+\s*,\s*)([\d.eE+-]+)(\s*,\s*)([\d.eE+-]+)(\s*,\s*)([\d.eE+-]+)/;
    if (!re.test(text)) return false;
    const f = (n: number) => n.toFixed(4);
    text = text.replace(re, `$1${f(kp)}$3${f(ki)}$5${f(kd)}`);
    try { fs.writeFileSync(file, text); } catch { return false; }
    return true;
}

export class PidTunePanel {
    static current: PidTunePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _proc: cp.ChildProcess | undefined;
    private _rxbuf = '';

    static createOrShow(context: vscode.ExtensionContext): void {
        const col = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        if (PidTunePanel.current) {
            PidTunePanel.current._panel.reveal(col);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'picpioPidTune',
            'PICPIO Auto PID Tuning',
            col,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        PidTunePanel.current = new PidTunePanel(panel, context);
    }

    private constructor(panel: vscode.WebviewPanel, private _ctx: vscode.ExtensionContext) {
        this._panel = panel;
        this._panel.webview.html = this._html();
        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(msg => this._handle(msg), null, this._disposables);
    }

    private _post(msg: any): void {
        this._panel.webview.postMessage(msg);
    }

    private async _handle(msg: any): Promise<void> {
        switch (msg.command) {
            case 'ready': {
                const cfg = readConfig();
                this._post({
                    command: 'init',
                    ports:   getAvailablePorts(),
                    bauds:   BAUD_RATES,
                    defaultPort: (cfg as any)?.monitor_port ?? 'COM3',
                    defaultBaud: (cfg as any)?.monitor_baud ?? '9600',
                    pid:     parsePidInfo(),
                });
                break;
            }
            case 'refreshPorts':
                this._post({ command: 'ports', ports: getAvailablePorts() });
                break;
            case 'rescanPid':
                this._post({ command: 'pid', pid: parsePidInfo() });
                break;
            case 'connect':
                this._connect(String(msg.port), String(msg.baud));
                break;
            case 'disconnect':
                this._disconnect();
                break;
            case 'send':
                this._send(String(msg.line));
                break;
            case 'apply': {
                const ok = applyGainsToMainCpp(Number(msg.kp), Number(msg.ki), Number(msg.kd));
                if (ok) {
                    vscode.window.showInformationMessage(
                        `PID gains written to main.cpp: Kp=${(+msg.kp).toFixed(3)} Ki=${(+msg.ki).toFixed(3)} Kd=${(+msg.kd).toFixed(3)}`
                    );
                } else {
                    vscode.window.showErrorMessage('Could not find a PID_init(...) call in main.cpp to update.');
                }
                this._post({ command: 'applied', ok });
                break;
            }
            case 'addPidTune':
                // Hand off to the picpio CLI to scaffold the firmware handler.
                vscode.commands.executeCommand('picpio.runTask', 'lib add PIDTune');
                vscode.window.showInformationMessage(
                    'Added PIDTune library — rebuild & upload, then reconnect to tune.'
                );
                break;
            case 'flash': {
                // Build + upload the current project, then auto-connect to the
                // chosen serial port so the user goes straight into tuning.
                this._disconnect();
                this._post({ command: 'flashState', state: 'running' });
                const code = await runTracked('build -u', 'Flashing');
                if (code === 0) {
                    this._post({ command: 'flashState', state: 'done' });
                    // Re-scan main.cpp (gains/vars may have changed) before reconnecting.
                    this._post({ command: 'pid', pid: parsePidInfo() });
                    if (msg.port) this._connect(String(msg.port), String(msg.baud || '9600'));
                } else {
                    this._post({ command: 'flashState', state: 'failed' });
                    vscode.window.showErrorMessage('Flash failed — see the PICPIO terminal for details.');
                }
                break;
            }
        }
    }

    private _connect(port: string, baud: string): void {
        this._disconnect();
        let p: cp.ChildProcess;
        try {
            p = cp.spawn('powershell', [
                '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ensureMonitorScript(),
                '-Port', port, '-Baud', String(baud),
            ], { windowsHide: true });
        } catch (e: any) {
            this._post({ command: 'status', connected: false, error: e.message });
            return;
        }
        this._proc = p;
        this._rxbuf = '';

        let buf = '';
        p.stdout?.on('data', (chunk: Buffer) => {
            buf += chunk.toString('utf8');
            let idx: number;
            while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx).replace(/\r$/, '');
                buf = buf.slice(idx + 1);
                this._onBridgeLine(line, port, baud);
            }
        });
        p.on('exit', () => {
            if (this._proc === p) this._proc = undefined;
            this._post({ command: 'status', connected: false });
        });
        this._post({ command: 'status', connecting: true, port, baud });
    }

    // Lines from the PowerShell bridge: control frames plus base64 serial data.
    private _onBridgeLine(line: string, port: string, baud: string): void {
        if (line.startsWith('PICPIO_CONNECTED:')) {
            this._post({ command: 'status', connected: true, port, baud });
        } else if (line.startsWith('PICPIO_ERROR:')) {
            this._post({ command: 'status', connected: false, error: line.slice('PICPIO_ERROR:'.length) });
            this._proc = undefined;
        } else if (line.startsWith('PICPIO_DATA:')) {
            try {
                const text = Buffer.from(line.slice('PICPIO_DATA:'.length), 'base64').toString('utf8');
                this._feedSerial(text);
            } catch { /* ignore malformed frame */ }
        }
    }

    // Reassemble decoded serial bytes into whole lines and forward each to the
    // webview, where the tuning state machine parses "PIDT:" telemetry.
    private _feedSerial(text: string): void {
        this._rxbuf += text;
        let idx: number;
        while ((idx = this._rxbuf.indexOf('\n')) >= 0) {
            const line = this._rxbuf.slice(0, idx).replace(/\r$/, '');
            this._rxbuf = this._rxbuf.slice(idx + 1);
            if (line.length) this._post({ command: 'serial', line });
        }
    }

    private _send(line: string): void {
        if (!this._proc?.stdin) return;
        const b64 = Buffer.from(line + '\n', 'utf8').toString('base64');
        try { this._proc.stdin.write(`PICPIO_SEND:${b64}\n`); } catch { /* ignore */ }
    }

    private _disconnect(): void {
        const p = this._proc;
        if (!p) return;
        this._proc = undefined;
        try { p.stdin?.write('PICPIO_EXIT\n'); } catch { /* ignore */ }
        setTimeout(() => { try { p.kill(); } catch { /* ignore */ } }, 400);
        this._post({ command: 'status', connected: false });
    }

    private _dispose(): void {
        this._disconnect();
        PidTunePanel.current = undefined;
        this._panel.dispose();
        for (const d of this._disposables) d.dispose();
    }

    private _html(): string {
        const baudOptions = BAUD_RATES.map(b => `<option value="${b}">${b}</option>`).join('');
        return PIDTUNE_HTML.replace('<!--BAUDS-->', baudOptions);
    }
}

// The webview is self-contained: it renders the UI, plots the live process
// value, and runs the relay / Ziegler-Nichols state machine in-page. It talks
// to the extension host only to (dis)connect serial, send command lines, and
// write the final gains back to main.cpp.
const PIDTUNE_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:var(--vscode-editor-background,#1e1e1e);--card:#252526;--border:#3e3e42;
  --text:var(--vscode-editor-foreground,#ccc);--sub:#888;--accent:#f27f0c;
  --green:#4ec9b0;--blue:#569cd6;--red:#f44747;--yellow:#dcdcaa;
}
body{background:var(--bg);color:var(--text);font:13px/1.5 'Segoe UI',sans-serif;padding:14px;}
h1{font-size:17px;color:var(--accent);margin-bottom:2px}
.sub{font-size:11px;color:var(--sub);margin-bottom:14px}
.row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px}
.card{background:var(--card);border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:12px}
.card h2{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--sub);margin-bottom:10px}
label{font-size:11px;color:var(--sub);display:flex;flex-direction:column;gap:3px}
select,input,button{background:#2d2d2d;border:1px solid var(--border);color:var(--text);border-radius:4px;padding:5px 9px;font-size:12px}
input[type=number]{width:90px}
select:focus,input:focus{outline:none;border-color:var(--accent)}
button{cursor:pointer}button:hover{border-color:var(--accent)}
button:disabled{opacity:.45;cursor:default}button:disabled:hover{border-color:var(--border)}
button.primary{background:var(--green);color:#000;border-color:var(--green);font-weight:600}
button.danger{background:var(--red);color:#000;border-color:var(--red);font-weight:600}
button.warn{background:var(--yellow);color:#000;border-color:var(--yellow);font-weight:600}
.status{font-size:11px;padding:3px 10px;border-radius:10px;white-space:nowrap}
.status.on{background:#1e3a2f;color:var(--green);border:1px solid var(--green)}
.status.off{background:#3a1e1e;color:var(--red);border:1px solid var(--red)}
.status.wait{background:#2a2a1a;color:var(--yellow);border:1px solid var(--yellow)}
.banner{background:#3a2a1a;border:1px solid var(--accent);color:#f5c98a;padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:12px;display:none}
.banner.show{display:flex;gap:10px;align-items:center;justify-content:space-between}
#chart{width:100%;height:230px;background:#1a1a1a;border:1px solid var(--border);border-radius:6px;display:block}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{text-align:right;padding:5px 8px;border-bottom:1px solid var(--border)}
th:first-child,td:first-child{text-align:left}
th{color:var(--sub);font-size:10px;text-transform:uppercase;letter-spacing:.5px}
tr.best{background:rgba(78,201,176,.14)}
tr.active td{color:var(--yellow)}
.big{font-size:20px;color:var(--green);font-weight:700}
.gain{display:inline-block;min-width:120px}
.gain b{color:var(--green)}
#log{font-family:Consolas,monospace;font-size:11px;color:#9a9a9a;max-height:110px;overflow-y:auto;white-space:pre-wrap}
.legend{font-size:11px;color:var(--sub);display:flex;gap:14px;margin-top:6px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:middle}
.muted{color:var(--sub);font-size:11px}
</style>
</head>
<body>
<h1>&#9881; Auto PID Tuning</h1>
<div class="sub">Relay (Ziegler&ndash;Nichols) auto-tune over live serial &mdash; finds Ku/Pu, then sweeps gains from aggressive to smooth.</div>

<div class="banner" id="needLib">
  <span>&#9888; This project's firmware doesn't include the <b>PIDTune</b> handler the tuner needs (telemetry + live gain control).</span>
  <button class="warn" id="addLibBtn">+ Add PIDTune library</button>
</div>

<div class="card">
  <h2>1 &middot; Connection</h2>
  <div class="row">
    <label>Port<select id="port"></select></label>
    <button id="refresh" title="Refresh ports">&#8635;</button>
    <label>Baud<select id="baud"><!--BAUDS--></select></label>
    <button id="flash" class="warn" title="Build + upload the current project, then connect">&#9889; Flash &amp; Connect</button>
    <button id="connect" class="primary">&#9654; Connect</button>
    <span class="status off" id="status">Disconnected</span>
  </div>
  <div class="muted">Flash builds &amp; uploads this project to the device, then opens the selected serial port automatically.</div>
</div>

<div class="card">
  <h2>2 &middot; Target</h2>
  <div class="row">
    <label>Process min<input id="rangeMin" type="number" step="any" value="0"></label>
    <label>Process max<input id="rangeMax" type="number" step="any" value="200"></label>
    <label>Setpoint value<input id="spVal" type="number" step="any" value="100"></label>
    <label><input type="checkbox" id="autoSp" checked style="margin-right:4px">auto (midpoint)</label>
  </div>
  <div class="row">
    <label>Setpoint variable<input id="spVar" type="text" list="varList" placeholder="pick or type…" style="width:160px"></label>
    <label>Process variable<input id="pvVar" type="text" list="varList" placeholder="pick or type…" style="width:160px"></label>
    <button id="rescan" title="Re-read main.cpp">&#8635; Rescan main.cpp</button>
  </div>
  <datalist id="varList"></datalist>
  <div class="muted" id="curGains">Current gains in main.cpp: &mdash;</div>
</div>

<div class="card">
  <h2>3 &middot; Relay test settings</h2>
  <div class="row">
    <label>Output high<input id="relayHigh" type="number" step="any" value="255"></label>
    <label>Output low<input id="relayLow" type="number" step="any" value="0"></label>
    <label>Hysteresis<input id="hyst" type="number" step="any" value="0"></label>
    <label>Sample ms<input id="dt" type="number" step="1" value="50"></label>
    <label title="How many Kp/Ki/Kd value-sets to try between aggressive and smooth">Kp/Ki/Kd values to try<select id="stages"></select></label>
  </div>
  <div class="row">
    <button id="start" class="primary" disabled>&#9655; Start Auto-Tune</button>
    <button id="stop" class="danger" disabled>&#9632; Stop</button>
    <span class="muted" id="phase">Idle</span>
  </div>
</div>

<div class="card">
  <h2>Live response</h2>
  <canvas id="chart" width="900" height="230"></canvas>
  <div class="legend">
    <span><span class="dot" style="background:#f27f0c"></span>Process value</span>
    <span><span class="dot" style="background:#888"></span>Setpoint</span>
    <span><span class="dot" style="background:#569cd6"></span>Output</span>
  </div>
</div>

<div class="card">
  <h2>Refine stages</h2>
  <table id="stageTable">
    <thead><tr><th>#</th><th>Kp&middot;factor</th><th>Kp</th><th>Ki</th><th>Kd</th><th>Overshoot</th><th>Settle (s)</th><th>Score</th></tr></thead>
    <tbody></tbody>
  </table>
</div>

<div class="card">
  <h2>Result</h2>
  <div class="row">
    <div>Ku <b id="ku" class="gain">&mdash;</b></div>
    <div>Pu <b id="pu" class="gain">&mdash;</b> s</div>
  </div>
  <div class="row" style="align-items:flex-end">
    <div>Recommended:&nbsp; <span class="big" id="result">&mdash;</span></div>
    <button id="apply" class="primary" disabled>&#10003; Apply to main.cpp</button>
  </div>
</div>

<div class="card">
  <h2>Log</h2>
  <div id="log"></div>
</div>

<script>
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const PI = Math.PI;

let connected = false;
let tuning = false;
let pidInfo = { found:false, hasPidTune:false };

// ---- live sample buffer (timestamps in ms relative to first sample) -------
let samples = [];            // {t, pv, sp, out}
const MAX_SAMPLES = 1200;

function log(s){
  const el = $('log');
  el.textContent += s + '\n';
  el.scrollTop = el.scrollHeight;
}

// ---------- messaging ----------
function send(line){ vscode.postMessage({ command:'send', line:line }); }

// Build the 1..100 "values to try" dropdown (default 1).
(function initStages(){
  const sel = $('stages');
  for (let i = 1; i <= 100; i++){
    const o = document.createElement('option'); o.value = i; o.textContent = i; sel.appendChild(o);
  }
  sel.value = '1';
})();

// Setpoint auto-follows the midpoint of the process range while "auto" is on.
function updateAutoSetpoint(){
  if (!$('autoSp').checked) return;
  const lo = parseFloat($('rangeMin').value) || 0;
  const hi = parseFloat($('rangeMax').value) || 0;
  $('spVal').value = (lo + (hi - lo) / 2);
}
$('rangeMin').addEventListener('input', updateAutoSetpoint);
$('rangeMax').addEventListener('input', updateAutoSetpoint);
$('autoSp').addEventListener('change', updateAutoSetpoint);
$('spVal').addEventListener('input', () => { $('autoSp').checked = false; });

vscode.postMessage({ command:'ready' });

window.addEventListener('message', ev => {
  const m = ev.data;
  if (m.command === 'init'){
    fillSelect($('port'), m.ports, m.defaultPort);
    if ($('baud').options.length) $('baud').value = m.defaultBaud;
    applyPid(m.pid);
    updateAutoSetpoint();
  } else if (m.command === 'ports'){
    fillSelect($('port'), m.ports, $('port').value);
  } else if (m.command === 'pid'){
    applyPid(m.pid);
  } else if (m.command === 'status'){
    setStatus(m);
  } else if (m.command === 'serial'){
    onSerial(m.line);
  } else if (m.command === 'applied'){
    if (m.ok) log('Wrote gains to main.cpp.');
  } else if (m.command === 'flashState'){
    onFlashState(m.state);
  }
});

function onFlashState(state){
  const b = $('flash');
  if (state === 'running'){ b.disabled = true; b.textContent = '⏳ Flashing…'; log('Flashing (build + upload)…'); }
  else { b.disabled = false; b.innerHTML = '⚡ Flash &amp; Connect';
         if (state === 'done')   log('Flash done — connecting…');
         if (state === 'failed') log('Flash failed.'); }
}

function fillSelect(sel, items, want){
  sel.innerHTML = '';
  if (!items || !items.length){
    const o = document.createElement('option');
    o.value = ''; o.textContent = '(no ports — plug in & refresh)'; o.disabled = true;
    sel.appendChild(o);
  } else {
    items.forEach(p => {
      const o = document.createElement('option'); o.value = p; o.textContent = p; sel.appendChild(o);
    });
  }
  if (want && items && items.indexOf(want) >= 0) sel.value = want;
  refreshButtons();
}

function applyPid(pid){
  pidInfo = pid || { found:false, hasPidTune:false, vars:[] };
  // populate the variable picker with numeric globals found in main.cpp
  const dl = $('varList'); dl.innerHTML = '';
  (pidInfo.vars||[]).forEach(v => { const o=document.createElement('option'); o.value=v; dl.appendChild(o); });
  // only overwrite the fields if auto-detected (don't clobber a manual pick)
  if (pidInfo.setpointVar) $('spVar').value = pidInfo.setpointVar;
  if (pidInfo.inputVar)    $('pvVar').value = pidInfo.inputVar;
  if (pidInfo.setpointInit) $('spVal').value = pidInfo.setpointInit;
  if (pidInfo.found){
    $('curGains').textContent = 'Current gains in main.cpp: Kp=' + pidInfo.kp + '  Ki=' + pidInfo.ki + '  Kd=' + pidInfo.kd;
  } else if ((pidInfo.vars||[]).length){
    $('curGains').textContent = 'No PID_init(...) found — pick your setpoint/process variable from the ' + pidInfo.vars.length + ' detected. (Tuning still needs the PID + PIDTune libraries.)';
  } else {
    $('curGains').textContent = 'No PID_init(...) found in main.cpp — add the PID library first.';
  }
  $('needLib').classList.toggle('show', pidInfo.found && !pidInfo.hasPidTune);
  refreshButtons();
}

function setStatus(m){
  if (m.connecting){ $('status').className='status wait'; $('status').textContent='Connecting…'; return; }
  connected = !!m.connected;
  $('status').className = 'status ' + (connected ? 'on':'off');
  $('status').textContent = connected ? ('Connected ' + (m.port||'')) : 'Disconnected';
  $('connect').textContent = connected ? '⏹ Disconnect' : '▶ Connect';
  $('connect').className = connected ? 'danger' : 'primary';
  if (m.error) log('ERROR: ' + m.error);
  if (!connected && tuning) stopTuning('disconnected');
  refreshButtons();
}

function refreshButtons(){
  const havePort = !!$('port').value;
  $('connect').disabled = !connected && !havePort;
  $('start').disabled = !(connected && pidInfo.found && pidInfo.hasPidTune && !tuning);
  $('stop').disabled  = !tuning;
}

// ---------- serial in ----------
let t0 = 0;
function onSerial(line){
  if (line.indexOf('PIDT:') === 0){
    const parts = line.slice(5).split(',');
    if (parts.length >= 3){
      const now = performance.now();
      if (!t0) t0 = now;
      const s = { t:(now-t0)/1000, pv:parseFloat(parts[0]), sp:parseFloat(parts[1]), out:parseFloat(parts[2]) };
      if (isFinite(s.pv)){
        samples.push(s);
        if (samples.length > MAX_SAMPLES) samples.shift();
        if (tuning) tuneTick(s);
        drawChart();
      }
    }
  } else if (line.indexOf('PIDT_') === 0){
    log(line);
  }
}

// ================= TUNING STATE MACHINE =================
let phase = 'idle';   // idle | relay | settle | step | done
let relayD = 0, target = 0;
let crossings = [];   // {t, dir}  zero-crossings of (pv - sp)
let peaks = [], troughs = [];
let lastSign = 0, segMax = -1e9, segMin = 1e9;
let Ku = 0, Pu = 0;

let ladder = [];      // {factor, kp, ki, kd, overshoot, settle, score}
let stageIdx = -1;
let stagePhaseEnd = 0, stageStart = 0;
let stageMaxPv = -1e9, stageSettleT = -1;
let best = null;

function setPhase(p, txt){ phase = p; $('phase').textContent = txt; }

$('start').onclick = startTuning;
$('stop').onclick  = () => stopTuning('stopped by user');

function startTuning(){
  if (!connected || !pidInfo.found || !pidInfo.hasPidTune) return;
  tuning = true; refreshButtons();
  samples = []; t0 = 0;
  crossings = []; peaks = []; troughs = [];
  lastSign = 0; segMax = -1e9; segMin = 1e9;
  Ku = 0; Pu = 0; best = null; ladder = []; stageIdx = -1;
  $('stageTable').querySelector('tbody').innerHTML = '';
  $('result').textContent = '—'; $('ku').textContent='—'; $('pu').textContent='—';
  $('apply').disabled = true;

  target   = parseFloat($('spVal').value) || 0;
  const hi = parseFloat($('relayHigh').value);
  const lo = parseFloat($('relayLow').value);
  const hy = parseFloat($('hyst').value) || 0;
  const dt = parseInt($('dt').value) || 50;
  relayD   = (hi - lo) / 2;

  send('SET DT=' + dt);
  send('SET SP=' + target);
  send('SET RH=' + hi);
  send('SET RL=' + lo);
  send('SET HYST=' + hy);
  send('MODE RELAY');
  setPhase('relay', 'Relay test — provoking oscillation…');
  log('Relay test started: SP=' + target + ' output ' + lo + '↔' + hi);
}

function stopTuning(why){
  tuning = false;
  send('MODE MANUAL');
  setPhase('idle', 'Idle');
  refreshButtons();
  if (why) log('Stopped: ' + why);
}

function tuneTick(s){
  if (phase === 'relay') relayTick(s);
  else if (phase === 'step') stepTick(s);
  else if (phase === 'settle') settleTick(s);
}

// ---- relay phase: detect oscillation, estimate Ku & Pu ----
function relayTick(s){
  const e = s.pv - s.sp;
  const sign = e > 0 ? 1 : (e < 0 ? -1 : lastSign);

  // track extrema within the current half-cycle
  if (s.pv > segMax) segMax = s.pv;
  if (s.pv < segMin) segMin = s.pv;

  if (lastSign !== 0 && sign !== 0 && sign !== lastSign){
    crossings.push({ t:s.t, dir:sign });
    // close out the half-cycle that just ended
    if (sign > 0){ troughs.push(segMin); }   // was below, now rising -> recorded a trough
    else         { peaks.push(segMax); }     // was above, now falling -> recorded a peak
    segMax = -1e9; segMin = 1e9;

    const upCross = crossings.filter(c => c.dir > 0);
    log('cross #' + crossings.length + ' @' + s.t.toFixed(2) + 's  peaks=' + peaks.length + ' troughs=' + troughs.length);

    // need a few full periods; use the up-crossings to measure the period
    if (upCross.length >= 6 && peaks.length >= 4 && troughs.length >= 4){
      finishRelay(upCross);
    }
  }
  if (sign !== 0) lastSign = sign;
}

function mean(a){ return a.reduce((x,y)=>x+y,0) / a.length; }

function finishRelay(upCross){
  // drop the first cycle (transient); average the rest
  const usePeaks   = peaks.slice(1);
  const useTroughs = troughs.slice(1);
  const amp = (mean(usePeaks) - mean(useTroughs)) / 2;
  // period from successive up-crossings
  let periods = [];
  for (let i = 1; i < upCross.length; i++) periods.push(upCross[i].t - upCross[i-1].t);
  periods = periods.slice(1); // drop first
  Pu = mean(periods);
  Ku = (4 * Math.abs(relayD)) / (PI * Math.abs(amp));

  $('ku').textContent = Ku.toFixed(3);
  $('pu').textContent = Pu.toFixed(3);
  log('Relay done: amp=' + amp.toFixed(3) + '  Ku=' + Ku.toFixed(3) + '  Pu=' + Pu.toFixed(3) + 's');

  buildLadder();
  send('MODE AUTO');
  stageIdx = -1;
  nextStage();
}

// ---- refine: sweep Kp = factor*Ku (Z-N ratios), aggressive -> smooth ----
// N is the user's "values to try" (1..100). N=1 uses the classic Z-N value.
function buildLadder(){
  const n = Math.max(1, Math.min(100, parseInt($('stages').value) || 1));
  // factors from "shaky/aggressive" down to "smooth/gentle"
  const fHi = 0.9, fLo = 0.18, fMid = 0.6;   // 0.6*Ku = classic Z-N PID
  ladder = [];
  const Ti = 0.5 * Pu;          // classic Ziegler-Nichols PID
  const Td = 0.125 * Pu;
  for (let i = 0; i < n; i++){
    const factor = (n === 1) ? fMid : (fHi - (fHi - fLo) * (i / (n - 1)));
    const kp = factor * Ku;
    const ki = (Ti > 0) ? kp / Ti : 0;
    const kd = kp * Td;
    ladder.push({ factor, kp, ki, kd, overshoot:null, settle:null, score:null });
  }
  renderStages();
}

function renderStages(){
  const tb = $('stageTable').querySelector('tbody');
  tb.innerHTML = '';
  ladder.forEach((c, i) => {
    const tr = document.createElement('tr');
    if (i === stageIdx) tr.className = 'active';
    if (best && best.idx === i) tr.className = 'best';
    tr.innerHTML =
      '<td>' + (i+1) + '</td>' +
      '<td>' + c.factor.toFixed(2) + '</td>' +
      '<td>' + c.kp.toFixed(3) + '</td>' +
      '<td>' + c.ki.toFixed(3) + '</td>' +
      '<td>' + c.kd.toFixed(3) + '</td>' +
      '<td>' + (c.overshoot==null?'—':c.overshoot.toFixed(1)+'%') + '</td>' +
      '<td>' + (c.settle==null?'—':(c.settle<0?'>win':c.settle.toFixed(2))) + '</td>' +
      '<td>' + (c.score==null?'—':c.score.toFixed(1)) + '</td>';
    tb.appendChild(tr);
  });
}

// Each stage: drop SP to a baseline so the plant relaxes, then step to target
// and measure overshoot + settling time over a window of a few Pu.
const SETTLE_BAND = 0.02;   // 2% of target counts as "settled"
function nextStage(){
  stageIdx++;
  if (stageIdx >= ladder.length){ finishTuning(); return; }
  const c = ladder[stageIdx];
  send('SET KP=' + c.kp.toFixed(4));
  send('SET KI=' + c.ki.toFixed(4));
  send('SET KD=' + c.kd.toFixed(4));
  // relax toward a baseline first
  send('SET SP=' + (target * 0.5).toFixed(4));
  setPhase('settle', 'Stage ' + (stageIdx+1) + '/' + ladder.length + ' — relaxing…');
  stagePhaseEnd = performance.now() + Math.max(2500, 3000 * Pu);
  renderStages();
}

function settleTick(s){
  if (performance.now() >= stagePhaseEnd){
    // begin the step
    send('SET SP=' + target.toFixed(4));
    stageStart   = (samples.length ? samples[samples.length-1].t : 0);
    stageMaxPv   = -1e9; stageSettleT = -1;
    stagePhaseEnd = performance.now() + Math.max(4000, 8000 * Pu);
    setPhase('step', 'Stage ' + (stageIdx+1) + '/' + ladder.length + ' — measuring step…');
  }
}

function stepTick(s){
  if (s.pv > stageMaxPv) stageMaxPv = s.pv;
  if (stageSettleT < 0 && Math.abs(s.pv - target) <= Math.abs(target)*SETTLE_BAND){
    stageSettleT = s.t - stageStart;
  }
  if (performance.now() >= stagePhaseEnd){
    const c = ladder[stageIdx];
    c.overshoot = target !== 0 ? Math.max(0, (stageMaxPv - target) / Math.abs(target) * 100) : 0;
    c.settle    = stageSettleT;   // -1 means never settled within window
    const settlePenalty = (stageSettleT < 0) ? 50 : stageSettleT;
    c.score = c.overshoot * 1.0 + settlePenalty * 4.0;
    if (!best || c.score < best.score) best = { idx:stageIdx, kp:c.kp, ki:c.ki, kd:c.kd, score:c.score };
    log('Stage ' + (stageIdx+1) + ': OS=' + c.overshoot.toFixed(1) + '%  settle=' + (stageSettleT<0?'>win':stageSettleT.toFixed(2)+'s') + '  score=' + c.score.toFixed(1));
    renderStages();
    nextStage();
  }
}

function finishTuning(){
  tuning = false; refreshButtons();
  setPhase('done', 'Done');
  if (best){
    send('SET KP=' + best.kp.toFixed(4));
    send('SET KI=' + best.ki.toFixed(4));
    send('SET KD=' + best.kd.toFixed(4));
    send('SET SP=' + target.toFixed(4));
    send('MODE AUTO');
    $('result').textContent = 'Kp ' + best.kp.toFixed(3) + '   Ki ' + best.ki.toFixed(3) + '   Kd ' + best.kd.toFixed(3);
    $('apply').disabled = false;
    $('apply').dataset.kp = best.kp; $('apply').dataset.ki = best.ki; $('apply').dataset.kd = best.kd;
    log('Best = stage ' + (best.idx+1) + ' (score ' + best.score.toFixed(1) + ').');
    renderStages();
  } else {
    log('No valid candidate found.');
  }
}

// ---------- chart ----------
const cv = $('chart'), cx = cv.getContext('2d');
function drawChart(){
  const W = cv.width, H = cv.height;
  cx.clearRect(0,0,W,H);
  if (samples.length < 2) return;
  const view = samples.slice(-300);
  let mn = Infinity, mx = -Infinity;
  view.forEach(s => { mn=Math.min(mn,s.pv,s.sp); mx=Math.max(mx,s.pv,s.sp); });
  if (mn === mx){ mn -= 1; mx += 1; }
  const pad = (mx-mn)*0.1; mn -= pad; mx += pad;
  const t1 = view[0].t, t2 = view[view.length-1].t;
  const X = t => (t2===t1)?0:((t-t1)/(t2-t1))*(W-8)+4;
  const Y = v => H-8 - ((v-mn)/(mx-mn))*(H-16);

  const plot = (key, color, width) => {
    cx.strokeStyle = color; cx.lineWidth = width; cx.beginPath();
    view.forEach((s,i) => { const x=X(s.t), y=Y(s[key]); i?cx.lineTo(x,y):cx.moveTo(x,y); });
    cx.stroke();
  };
  plot('sp', '#888', 1);
  plot('out','#569cd6', 1);
  plot('pv', '#f27f0c', 2);
}

// ---------- UI wiring ----------
$('connect').onclick = () => {
  if (connected){ vscode.postMessage({ command:'disconnect' }); return; }
  const port = $('port').value;
  if (!port){ log('No serial port selected — plug in your device and press ↻.'); return; }
  vscode.postMessage({ command:'connect', port:port, baud:$('baud').value });
};
$('flash').onclick = () => {
  const port = $('port').value;
  if (!port){ log('No serial port selected — plug in your device and press ↻ before flashing.'); return; }
  vscode.postMessage({ command:'flash', port:port, baud:$('baud').value });
};
$('refresh').onclick = () => vscode.postMessage({ command:'refreshPorts' });
$('rescan').onclick  = () => vscode.postMessage({ command:'rescanPid' });
$('addLibBtn').onclick = () => vscode.postMessage({ command:'addPidTune' });
$('apply').onclick = () => {
  const d = $('apply').dataset;
  vscode.postMessage({ command:'apply', kp:d.kp, ki:d.ki, kd:d.kd });
};
</script>
</body>
</html>`;
