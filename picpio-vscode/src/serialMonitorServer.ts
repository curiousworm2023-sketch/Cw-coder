import * as vscode from 'vscode';
import * as cp     from 'child_process';
import * as fs     from 'fs';
import * as os     from 'os';
import * as http   from 'http';
import * as path   from 'path';
import { readConfig } from './iniParser';

const BAUD_RATES = ['300','1200','2400','4800','9600','19200','38400','57600','115200','230400'];

function getAvailablePorts(): string[] {
    try {
        const out = cp.execSync(
            'powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object"',
            { timeout: 5000 }
        ).toString().trim();
        return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } catch {
        return [];
    }
}

// Bridges the browser page to a real serial port. Runs as a long-lived
// PowerShell process: it opens the port, streams incoming bytes back to
// stdout (base64-framed so binary/encoding never gets mangled), and accepts
// "PICPIO_SEND:<base64>" lines on stdin to write bytes to the port.
const MONITOR_SCRIPT = `
param(
    [string]\$Port,
    [int]\$Baud = 9600
)

\$ErrorActionPreference = 'Stop'

try {
    \$sp = New-Object System.IO.Ports.SerialPort \$Port, \$Baud, ([System.IO.Ports.Parity]::None), 8, ([System.IO.Ports.StopBits]::One)
    \$sp.Open()
} catch {
    [Console]::Out.WriteLine("PICPIO_ERROR:\$($_.Exception.Message)")
    [Console]::Out.Flush()
    exit 1
}

[Console]::Out.WriteLine("PICPIO_CONNECTED:\$Port@\$Baud")
[Console]::Out.Flush()

# Reader runs on its own runspace (real OS thread) so it can poll the port
# while the main thread blocks on stdin -- Register-ObjectEvent's -Action
# doesn't reliably forward Write-Output to the process's real stdout, so a
# plain polling loop with [Console]::Out is used instead.
\$reader = [PowerShell]::Create()
\$reader.AddScript({
    param(\$sp)
    while (\$sp.IsOpen) {
        try {
            \$data = \$sp.ReadExisting()
            if (\$data) {
                \$bytes = [System.Text.Encoding]::UTF8.GetBytes(\$data)
                \$b64 = [Convert]::ToBase64String(\$bytes)
                [Console]::Out.WriteLine("PICPIO_DATA:\$b64")
                [Console]::Out.Flush()
            } else {
                Start-Sleep -Milliseconds 30
            }
        } catch { Start-Sleep -Milliseconds 100 }
    }
}).AddArgument(\$sp) | Out-Null
\$readerHandle = \$reader.BeginInvoke()

while (\$true) {
    \$line = [Console]::In.ReadLine()
    if (\$null -eq \$line) { break }
    if (\$line -eq 'PICPIO_EXIT') { break }
    if (\$line.StartsWith('PICPIO_SEND:')) {
        \$b64 = \$line.Substring(12)
        try {
            \$bytes = [Convert]::FromBase64String(\$b64)
            \$sp.Write(\$bytes, 0, \$bytes.Length)
        } catch {}
    }
    if (\$line -eq 'PICPIO_RESET') {
        # Pulse DTR -- many USB-serial adapters wire DTR to MCLR/RESET so a
        # transition restarts the MCU and re-triggers its boot-time output.
        try {
            \$sp.DtrEnable = \$true
            Start-Sleep -Milliseconds 100
            \$sp.DtrEnable = \$false
        } catch {}
    }
}

try { \$sp.Close() } catch {}
try { \$reader.Stop(); \$reader.Dispose() } catch {}
`;

let server: http.Server | undefined;
let serverPort = 0;
let scriptPath: string | undefined;
let proc: cp.ChildProcess | undefined;
const sseClients: http.ServerResponse[] = [];

function broadcast(msg: any): void {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of sseClients) {
        try { res.write(data); } catch { /* ignore */ }
    }
}

function ensureScript(): string {
    if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
    scriptPath = path.join(os.tmpdir(), `picpio-serial-monitor-${process.pid}.ps1`);
    fs.writeFileSync(scriptPath, MONITOR_SCRIPT, 'utf8');
    return scriptPath;
}

function connect(port: string, baud: string): void {
    if (proc) disconnect();

    let p: cp.ChildProcess;
    try {
        p = cp.spawn('powershell', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ensureScript(),
            '-Port', port, '-Baud', String(baud),
        ], { windowsHide: true });
    } catch (e: any) {
        broadcast({ command: 'status', connected: false, error: e.message });
        return;
    }
    proc = p;

    let buf = '';
    p.stdout?.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).replace(/\r$/, '');
            buf = buf.slice(idx + 1);
            handleLine(line, port, baud);
        }
    });

    p.stderr?.on('data', (chunk: Buffer) => {
        broadcast({ command: 'data', text: chunk.toString('utf8') });
    });

    p.on('exit', () => {
        if (proc === p) proc = undefined;
        broadcast({ command: 'status', connected: false });
    });

    broadcast({ command: 'status', connecting: true, port, baud });
}

function handleLine(line: string, port: string, baud: string): void {
    if (line.startsWith('PICPIO_CONNECTED:')) {
        broadcast({ command: 'status', connected: true, port, baud });
    } else if (line.startsWith('PICPIO_ERROR:')) {
        broadcast({ command: 'status', connected: false, error: line.substring('PICPIO_ERROR:'.length) });
        proc = undefined;
    } else if (line.startsWith('PICPIO_DATA:')) {
        const b64 = line.substring('PICPIO_DATA:'.length);
        try {
            const text = Buffer.from(b64, 'base64').toString('utf8');
            broadcast({ command: 'data', text });
        } catch { /* ignore malformed frame */ }
    }
}

function disconnect(): void {
    const p = proc;
    if (!p) return;
    proc = undefined;
    try { p.stdin?.write('PICPIO_EXIT\n'); } catch { /* ignore */ }
    setTimeout(() => { try { p.kill(); } catch { /* ignore */ } }, 500);
    broadcast({ command: 'status', connected: false });
}

function send(text: string, lineEnding: string): void {
    if (!proc?.stdin) return;
    const ending = lineEnding === 'crlf' ? '\r\n'
                 : lineEnding === 'lf'   ? '\n'
                 : lineEnding === 'cr'   ? '\r'
                 : '';
    const b64 = Buffer.from(text + ending, 'utf8').toString('base64');
    try { proc.stdin.write(`PICPIO_SEND:${b64}\n`); } catch { /* ignore */ }
}

function reset(): void {
    if (!proc?.stdin) return;
    try { proc.stdin.write('PICPIO_RESET\n'); } catch { /* ignore */ }
    broadcast({ command: 'data', text: '\n--- Reset (DTR pulse) ---\n' });
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise(resolve => {
        let data = '';
        req.on('data', (c) => { data += c; });
        req.on('end', () => resolve(data));
    });
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';

    if (url === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlPage());
        return;
    }

    if (url === '/events' && req.method === 'GET') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.write('\n');
        sseClients.push(res);
        req.on('close', () => {
            const i = sseClients.indexOf(res);
            if (i >= 0) sseClients.splice(i, 1);
        });
        return;
    }

    if (url === '/api/ports' && req.method === 'GET') {
        const cfg = readConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ports:       getAvailablePorts(),
            defaultPort: cfg?.monitor_port ?? 'COM3',
            defaultBaud: cfg?.monitor_baud ?? '9600',
        }));
        return;
    }

    if (url === '/api/connect' && req.method === 'POST') {
        readBody(req).then(body => {
            try {
                const { port, baud } = JSON.parse(body);
                connect(port, String(baud));
            } catch { /* ignore */ }
            res.writeHead(204);
            res.end();
        });
        return;
    }

    if (url === '/api/disconnect' && req.method === 'POST') {
        disconnect();
        res.writeHead(204);
        res.end();
        return;
    }

    if (url === '/api/send' && req.method === 'POST') {
        readBody(req).then(body => {
            try {
                const { text, lineEnding } = JSON.parse(body);
                send(text, lineEnding);
            } catch { /* ignore */ }
            res.writeHead(204);
            res.end();
        });
        return;
    }

    if (url === '/api/reset' && req.method === 'POST') {
        reset();
        res.writeHead(204);
        res.end();
        return;
    }

    res.writeHead(404);
    res.end();
}

function ensureServer(): Promise<number> {
    if (server && serverPort) return Promise.resolve(serverPort);
    return new Promise((resolve, reject) => {
        server = http.createServer(handleRequest);
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server!.address();
            serverPort = typeof addr === 'object' && addr ? addr.port : 0;
            resolve(serverPort);
        });
    });
}

export async function openSerialMonitor(): Promise<void> {
    const port = await ensureServer();
    vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${port}/`));
}

export function disposeSerialMonitorServer(): void {
    disconnect();
    for (const res of sseClients.splice(0)) {
        try { res.end(); } catch { /* ignore */ }
    }
    if (server) {
        try { server.close(); } catch { /* ignore */ }
        server = undefined;
        serverPort = 0;
    }
    if (scriptPath) {
        try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
        scriptPath = undefined;
    }
}

function htmlPage(): string {
    const baudOptions = BAUD_RATES.map(b => `<option value="${b}">${b}</option>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PICPIO Serial Monitor</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#1e1e1e;--card:#2d2d2d;--border:#3e3e42;--text:#ccc;--sub:#888;--accent:#f27f0c;
  --green:#4ec9b0;--blue:#569cd6;--red:#f44747;
}
html,body{height:100%}
body{background:var(--bg);color:var(--text);font:13px/1.5 'Segoe UI',-apple-system,sans-serif;display:flex;flex-direction:column;overflow:hidden}
.toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#252526;border-bottom:1px solid var(--border);flex-wrap:wrap}
select,button,input{background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:5px 10px;font-size:12px}
select:focus,input:focus{outline:none;border-color:var(--accent)}
button{cursor:pointer}
button:hover{border-color:var(--accent)}
button:disabled{opacity:.5;cursor:default}
button:disabled:hover{border-color:var(--border)}
button.primary{background:var(--green);color:#000;border-color:var(--green);font-weight:600}
button.danger{background:var(--red);color:#000;border-color:var(--red);font-weight:600}
.status{font-size:11px;padding:3px 10px;border-radius:10px;margin-left:auto;white-space:nowrap}
.status.connected{background:#1e3a2f;color:var(--green);border:1px solid var(--green)}
.status.disconnected{background:#3a1e1e;color:var(--red);border:1px solid var(--red)}
.status.connecting{background:#2a2a1a;color:#dcdcaa;border:1px solid #dcdcaa}
#output{flex:1;overflow-y:auto;padding:10px 12px;font-family:Consolas,'Courier New',monospace;font-size:13px;white-space:pre-wrap;word-break:break-all}
.echo{color:var(--blue)}
.inputbar{display:flex;gap:8px;padding:8px 12px;background:#252526;border-top:1px solid var(--border)}
#inputText{flex:1;font-family:Consolas,'Courier New',monospace}
label{font-size:11px;color:var(--sub);display:flex;align-items:center;gap:4px;white-space:nowrap}
</style>
</head>
<body>
  <div class="toolbar">
    <label>Port
      <select id="portSelect"></select>
    </label>
    <button id="refreshBtn" title="Refresh ports">&#8635; Refresh</button>
    <label>Baud
      <select id="baudSelect">${baudOptions}</select>
    </label>
    <button id="connectBtn" class="primary">&#9654; Start</button>
    <button id="resetBtn" title="Pulse DTR to reset the device" disabled>&#8635; Reset Device</button>
    <button id="clearBtn">Clear</button>
    <label><input type="checkbox" id="autoscroll" checked> Autoscroll</label>
    <label><input type="checkbox" id="localEcho" checked> Local echo</label>
    <span class="status disconnected" id="statusBadge">Disconnected</span>
  </div>
  <div id="output"></div>
  <div class="inputbar">
    <input id="inputText" placeholder="Type data to send and press Enter..." disabled>
    <select id="lineEnding">
      <option value="none">No line ending</option>
      <option value="lf" selected>Newline (\\n)</option>
      <option value="cr">Carriage return (\\r)</option>
      <option value="crlf">CR+LF (\\r\\n)</option>
    </select>
    <button id="sendBtn" class="primary" disabled>Send</button>
  </div>

<script>
const portSelect   = document.getElementById('portSelect');
const baudSelect   = document.getElementById('baudSelect');
const refreshBtn   = document.getElementById('refreshBtn');
const connectBtn   = document.getElementById('connectBtn');
const resetBtn     = document.getElementById('resetBtn');
const clearBtn     = document.getElementById('clearBtn');
const autoscroll   = document.getElementById('autoscroll');
const localEcho    = document.getElementById('localEcho');
const statusBadge  = document.getElementById('statusBadge');
const output       = document.getElementById('output');
const inputText    = document.getElementById('inputText');
const lineEnding   = document.getElementById('lineEnding');
const sendBtn      = document.getElementById('sendBtn');

let connected = false;

function setConnected(state, label) {
    connected = state;
    statusBadge.className = 'status ' + (state ? 'connected' : 'disconnected');
    statusBadge.textContent = label || (state ? 'Connected' : 'Disconnected');
    connectBtn.textContent = state ? '\\u25A0 Stop' : '\\u25B6 Start';
    connectBtn.className = state ? 'danger' : 'primary';
    portSelect.disabled = state;
    baudSelect.disabled = state;
    inputText.disabled = !state;
    sendBtn.disabled = !state;
    resetBtn.disabled = !state;
}

function appendOutput(text) {
    const atBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 10;
    output.appendChild(document.createTextNode(text));
    if (autoscroll.checked || atBottom) output.scrollTop = output.scrollHeight;
}

function appendEcho(text) {
    const atBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 10;
    const span = document.createElement('span');
    span.className = 'echo';
    span.textContent = text;
    output.appendChild(span);
    output.appendChild(document.createTextNode('\\n'));
    if (autoscroll.checked || atBottom) output.scrollTop = output.scrollHeight;
}

function api(path, body) {
    return fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
    });
}

function loadPorts() {
    fetch('/api/ports').then(r => r.json()).then(msg => {
        const current = portSelect.value;
        portSelect.innerHTML = '';
        const ports = msg.ports.length ? msg.ports.slice() : [];
        if (!ports.includes(msg.defaultPort)) ports.unshift(msg.defaultPort);
        for (const p of ports) {
            const opt = document.createElement('option');
            opt.value = p; opt.textContent = p;
            portSelect.appendChild(opt);
        }
        portSelect.value = ports.includes(current) ? current : msg.defaultPort;
        if (![...baudSelect.options].some(o => o.value === String(msg.defaultBaud))) {
            const opt = document.createElement('option');
            opt.value = String(msg.defaultBaud); opt.textContent = String(msg.defaultBaud);
            baudSelect.appendChild(opt);
        }
        baudSelect.value = String(msg.defaultBaud);
    });
}

refreshBtn.addEventListener('click', loadPorts);

connectBtn.addEventListener('click', () => {
    if (connected) {
        api('/api/disconnect');
    } else {
        const port = portSelect.value;
        const baud = baudSelect.value;
        if (!port) return;
        statusBadge.className = 'status connecting';
        statusBadge.textContent = 'Connecting...';
        api('/api/connect', { port, baud });
    }
});

clearBtn.addEventListener('click', () => { output.textContent = ''; });
resetBtn.addEventListener('click', () => api('/api/reset'));

function send() {
    const text = inputText.value;
    if (!connected || text === '') return;
    api('/api/send', { text, lineEnding: lineEnding.value });
    if (localEcho.checked) appendEcho('> ' + text);
    inputText.value = '';
}
sendBtn.addEventListener('click', send);
inputText.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });

const es = new EventSource('/events');
es.onmessage = e => {
    const msg = JSON.parse(e.data);
    switch (msg.command) {
        case 'status':
            if (msg.connecting) {
                statusBadge.className = 'status connecting';
                statusBadge.textContent = 'Connecting...';
            } else if (msg.connected) {
                setConnected(true, 'Connected: ' + msg.port + ' @ ' + msg.baud);
                appendOutput('--- Connected to ' + msg.port + ' @ ' + msg.baud + ' baud ---\\n');
            } else {
                setConnected(false, msg.error ? ('Error: ' + msg.error) : 'Disconnected');
                if (msg.error) appendOutput('--- Error: ' + msg.error + ' ---\\n');
                else if (msg.port) appendOutput('--- Disconnected ---\\n');
            }
            break;
        case 'data':
            appendOutput(msg.text);
            break;
    }
};

loadPorts();
</script>
</body>
</html>`;
}
