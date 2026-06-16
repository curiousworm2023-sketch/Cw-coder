import * as vscode from 'vscode';
import * as path   from 'path';
import { listInstalledLibs } from './iniParser';

interface LibEntry {
    name: string;
    desc: string;
    tags: string[];
    source: string;
}

const REGISTRY: LibEntry[] = [
    { name:'DHT22',         desc:'Humidity & temperature sensor (AM2302)',        tags:['sensor','i2c'],      source:'bundled' },
    { name:'DS18B20',       desc:'Dallas 1-Wire temperature sensor',               tags:['sensor','1wire'],    source:'bundled' },
    { name:'SSD1306',       desc:'128×64/128×32 OLED display over I2C',           tags:['display','i2c'],     source:'bundled' },
    { name:'LiquidCrystal_I2C', desc:'Character LCD over PCF8574 I2C backpack',   tags:['display','i2c'],     source:'bundled' },
    { name:'Servo',         desc:'RC servo motor via Timer1 (0.5µs resolution)',  tags:['motor','pwm'],       source:'bundled' },
    { name:'Encoder',       desc:'Quadrature encoder with 4× decode',             tags:['input','ioc'],       source:'bundled' },
    { name:'Wire',          desc:'I2C master with streaming for bulk transfer',   tags:['comms','i2c'],       source:'bundled' },
    { name:'SPI',           desc:'SPI master library',                            tags:['comms','spi'],       source:'bundled' },
    { name:'HardwareSerial',desc:'UART with interrupt-driven RX ring buffer',     tags:['comms','uart'],      source:'bundled' },
    { name:'AT24C256',      desc:'32KB I2C EEPROM with page write & polling',     tags:['storage','i2c'],     source:'bundled' },
    { name:'Keypad',        desc:'Matrix keypad driver (4×4, 3×4)',               tags:['input'],             source:'bundled' },
    { name:'PID',           desc:'PID controller with anti-windup',               tags:['control'],           source:'bundled' },
    { name:'MPU6050',       desc:'6-axis IMU (accel+gyro) over I2C',              tags:['sensor','i2c'],      source:'bundled' },
    { name:'BMP280',        desc:'Barometric pressure and temperature',           tags:['sensor','i2c','spi'],source:'bundled' },
    { name:'ADS1115',       desc:'16-bit 4-channel I2C ADC',                      tags:['sensor','i2c'],      source:'bundled' },
    { name:'ADS1219',       desc:'24-bit 4-channel I2C ADC',                      tags:['sensor','i2c'],      source:'bundled' },
    { name:'PCF8575',       desc:'16-channel I2C GPIO expander',                  tags:['io','i2c'],          source:'bundled' },
    { name:'LCD_HC595',     desc:'Character LCD via 74HC595 shift register',      tags:['display'],           source:'bundled' },
];

export class LibPanel {
    static current: LibPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    static createOrShow(context: vscode.ExtensionContext): void {
        const col = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        if (LibPanel.current) {
            LibPanel.current._panel.reveal(col);
            LibPanel.current._update();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'picpioLibs',
            'PICPIO Library Manager',
            col,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        LibPanel.current = new LibPanel(panel, context);
    }

    private constructor(panel: vscode.WebviewPanel, private _ctx: vscode.ExtensionContext) {
        this._panel = panel;
        this._update();
        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(msg => this._handle(msg), null, this._disposables);
    }

    private async _handle(msg: { command: string; name?: string; query?: string }): Promise<void> {
        if (msg.command === 'install' && msg.name) {
            let cmd = `lib add ${msg.name}`;
            // Some libraries support scaffolding multiple numbered instances
            // (e.g. several SSD1306 OLEDs at different I2C addresses on one
            // bus) — ask only if the user wants more than the default of 1.
            if (msg.name === 'SSD1306') {
                const count = await vscode.window.showInputBox({
                    title:       'PICPIO: Number of OLED Displays',
                    prompt:      'How many SSD1306 displays do you need on this project? Leave blank for 1.',
                    placeHolder: '1',
                    validateInput: v => (!v || /^[1-9][0-9]?$/.test(v)) ? null : 'Enter a positive number',
                });
                if (count === undefined) return; // cancelled
                const n = parseInt(count, 10);
                if (n > 1) cmd += ` --count ${n}`;
            }
            vscode.commands.executeCommand('picpio.runTask', cmd);
            setTimeout(() => this._update(), 2000);
        }
        if (msg.command === 'remove' && msg.name) {
            vscode.commands.executeCommand('picpio.runTask', `lib remove ${msg.name}`);
            setTimeout(() => this._update(), 2000);
        }
        if (msg.command === 'addCustom') {
            vscode.commands.executeCommand('picpio.libAdd');
            setTimeout(() => this._update(), 3000);
        }
        if (msg.command === 'refresh') {
            this._update();
        }
    }

    private _update(): void {
        this._panel.webview.html = this._html();
    }

    private _html(): string {
        const installed = new Set(listInstalledLibs().map(n => n.toLowerCase()));

        const rows = REGISTRY.map(lib => {
            const isInstalled = installed.has(lib.name.toLowerCase());
            const btn = isInstalled
                ? `<button class="btn-sm btn-red"   onclick="send('remove','${lib.name}')">&#128465; Remove</button>`
                : `<button class="btn-sm btn-green" onclick="send('install','${lib.name}')">+ Install</button>`;
            const tags = lib.tags.map(t => `<span class="tag">${t}</span>`).join('');
            const badge = isInstalled ? '<span class="badge-installed">Installed</span>' : '';
            return `
                <tr class="${isInstalled ? 'row-installed' : ''}">
                    <td><span class="lib-name">${lib.name}</span>${badge}</td>
                    <td class="lib-desc">${lib.desc}</td>
                    <td>${tags}</td>
                    <td><span class="source">${lib.source}</span></td>
                    <td>${btn}</td>
                </tr>`;
        }).join('');

        const installedList = [...installed].map(n =>
            `<span class="installed-chip">${n} <button class="x-btn" onclick="send('remove','${n}')">&#215;</button></span>`
        ).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  :root {
    --bg:    var(--vscode-editor-background);
    --fg:    var(--vscode-editor-foreground);
    --card:  var(--vscode-editorWidget-background, #252526);
    --bdr:   var(--vscode-widget-border, #454545);
    --green: #4ec9b0;
    --blue:  #569cd6;
    --red:   #f44747;
    --gray:  #666;
    --yellow:#dcdcaa;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg); font-family: var(--vscode-font-family,'Segoe UI',sans-serif); font-size: 13px; }

  .header { background: linear-gradient(135deg,#1a1a2e,#0f3460); padding: 20px 32px; display:flex; align-items:center; gap:16px; border-bottom:1px solid var(--bdr); }
  .header h1 { font-size:20px; font-weight:700; color:var(--green); }
  .header p  { font-size:11px; color:#999; margin-top:2px; }
  .header-actions { margin-left:auto; display:flex; gap:10px; }

  .content { padding: 24px 32px; }

  .search-bar { display:flex; gap:10px; margin-bottom:20px; }
  .search-bar input {
    flex:1; padding:8px 12px; background:var(--card); border:1px solid var(--bdr);
    border-radius:4px; color:var(--fg); font-size:13px; outline:none;
  }
  .search-bar input:focus { border-color:var(--green); }

  .installed-section { margin-bottom:20px; }
  .section-label { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:1.5px; color:var(--gray); margin-bottom:10px; }
  .installed-chips { display:flex; flex-wrap:wrap; gap:8px; }
  .installed-chip {
    background:#1e3a2f; border:1px solid var(--green); border-radius:4px;
    padding:3px 10px; font-size:12px; color:var(--green); display:flex; align-items:center; gap:6px;
  }
  .x-btn { background:none; border:none; color:var(--green); cursor:pointer; font-size:14px; padding:0; line-height:1; }

  table { width:100%; border-collapse:collapse; }
  th { text-align:left; padding:8px 10px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:1px; color:var(--gray); border-bottom:2px solid var(--bdr); }
  td { padding:10px 10px; border-bottom:1px solid var(--bdr); vertical-align:middle; font-size:12px; }
  tr:hover { background:rgba(255,255,255,0.03); }
  tr.row-installed { background:rgba(78,201,176,0.05); }

  .lib-name   { font-weight:600; color:var(--yellow); }
  .lib-desc   { color:#bbb; max-width:300px; }
  .source     { font-size:10px; color:var(--gray); }

  .tag { display:inline-block; background:#333; border-radius:3px; padding:2px 7px; font-size:10px; color:#999; margin:1px; }
  .badge-installed { margin-left:6px; background:#1e3a2f; border:1px solid var(--green); color:var(--green); border-radius:3px; padding:1px 6px; font-size:10px; font-weight:600; }

  .btn-sm { padding:4px 12px; border-radius:3px; border:none; font-size:11px; font-weight:600; cursor:pointer; }
  .btn-green { background:var(--green); color:#000; }
  .btn-red   { background:#5a1d1d; color:var(--red); border:1px solid var(--red); }
  .btn-sm:hover { filter:brightness(1.2); }

  .btn-outline { padding:6px 14px; background:transparent; border:1px solid var(--bdr); border-radius:4px; color:var(--fg); font-size:12px; font-weight:600; cursor:pointer; }
  .btn-outline:hover { border-color:var(--green); color:var(--green); }
  .btn-primary { padding:6px 14px; background:var(--green); border:none; border-radius:4px; color:#000; font-size:12px; font-weight:600; cursor:pointer; }
</style>
</head>
<body>

<div class="header">
    <div>
        <h1>&#128218; Library Manager</h1>
        <p>Search, install and manage libraries for your PICPIO project</p>
    </div>
    <div class="header-actions">
        <button class="btn-outline" onclick="send('addCustom')">+ Custom / GitHub</button>
        <button class="btn-outline" onclick="send('refresh')">&#8635; Refresh</button>
    </div>
</div>

<div class="content">
    ${installed.size > 0 ? `
    <div class="installed-section">
        <div class="section-label">Installed (${installed.size})</div>
        <div class="installed-chips">${installedList}</div>
    </div>` : ''}

    <div class="search-bar">
        <input type="text" id="search" placeholder="Search libraries — name, description, or tag (sensor, display, comms…)" oninput="filter(this.value)">
    </div>

    <div class="section-label">Available Libraries</div>
    <table id="libTable">
        <thead>
            <tr>
                <th>Name</th><th>Description</th><th>Tags</th><th>Source</th><th>Action</th>
            </tr>
        </thead>
        <tbody id="tbody">${rows}</tbody>
    </table>
</div>

<script>
    const vscode = acquireVsCodeApi();
    function send(cmd, name) { vscode.postMessage({ command: cmd, name: name }); }

    function filter(q) {
        q = q.toLowerCase();
        document.querySelectorAll('#tbody tr').forEach(tr => {
            const text = tr.textContent.toLowerCase();
            tr.style.display = text.includes(q) ? '' : 'none';
        });
    }
</script>
</body>
</html>`;
    }

    private _dispose(): void {
        LibPanel.current = undefined;
        this._panel.dispose();
        for (const d of this._disposables) d.dispose();
    }
}
