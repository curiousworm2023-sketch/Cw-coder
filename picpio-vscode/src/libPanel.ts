import * as vscode from 'vscode';
import * as cp     from 'child_process';
import { listInstalledLibs } from './iniParser';

interface LibEntry {
    name: string;
    desc: string;
    tags: string[];
    source: string;
}

// Descriptions/tags for known bundled libraries. This is metadata ONLY — the
// list of libraries actually shown is discovered at runtime from `picpio lib
// search` (which scans the real picpio_tool/libraries/<Name>/ folders), so the
// Library Manager never advertises a library that isn't really there. Entries
// here that have no backing folder simply go unused; libraries with a folder
// but no entry here fall back to a generic description.
const REGISTRY: LibEntry[] = [
    { name:'SSD1306',       desc:'128×64/128×32 OLED display over I2C',           tags:['display','i2c'],     source:'bundled' },
    { name:'LiquidCrystal_I2C', desc:'Character LCD over PCF8574 I2C backpack',   tags:['display','i2c'],     source:'bundled' },
    { name:'LCD_HC595',     desc:'Character LCD via 74HC595 shift register',      tags:['display'],           source:'bundled' },
    { name:'ILI9341',       desc:'240×320 TFT LCD over SPI',                      tags:['display','spi'],     source:'bundled' },
    { name:'XPT2046',       desc:'Resistive touchscreen controller (SPI)',        tags:['input','spi'],       source:'bundled' },
    { name:'DWIN',          desc:'DWIN DGUS smart serial display',                tags:['display','uart'],    source:'bundled' },
    { name:'LVGL',          desc:'LVGL embedded graphics library',                tags:['display','gui'],     source:'bundled' },
    { name:'PID',           desc:'PID controller with anti-windup',               tags:['control'],           source:'bundled' },
    { name:'PIDTune',       desc:'Serial auto-tuning handler for the Auto PID Tuning panel', tags:['control'], source:'bundled' },
    { name:'BME280',        desc:'Temperature, pressure & humidity sensor (I2C)', tags:['sensor','i2c'],      source:'bundled' },
    { name:'SHT31',         desc:'Temperature & humidity sensor (I2C)',           tags:['sensor','i2c'],      source:'bundled' },
    { name:'DS3231',        desc:'High-accuracy I2C real-time clock',             tags:['rtc','i2c'],         source:'bundled' },
    { name:'ADS1115',       desc:'16-bit 4-channel I2C ADC',                      tags:['sensor','i2c'],      source:'bundled' },
    { name:'ADS1219',       desc:'24-bit 4-channel I2C ADC',                      tags:['sensor','i2c'],      source:'bundled' },
    { name:'MCP4725',       desc:'12-bit I2C DAC',                                tags:['dac','i2c'],         source:'bundled' },
    { name:'MCP23017',      desc:'16-channel I2C GPIO expander',                  tags:['io','i2c'],          source:'bundled' },
    { name:'MCP23008',      desc:'8-channel I2C GPIO expander',                   tags:['io','i2c'],          source:'bundled' },
    { name:'PCF8575',       desc:'16-channel I2C GPIO expander',                  tags:['io','i2c'],          source:'bundled' },
    { name:'PCF8591',       desc:'8-bit I2C ADC (4ch) + DAC',                     tags:['adc','dac','i2c'],   source:'bundled' },
    { name:'TCA9548A',      desc:'1-to-8 I2C multiplexer',                        tags:['io','i2c'],          source:'bundled' },
    { name:'BMP280',        desc:'Barometric pressure & temperature (I2C)',       tags:['sensor','i2c'],      source:'bundled' },
    { name:'AHT20',         desc:'Temperature & humidity sensor (I2C)',           tags:['sensor','i2c'],      source:'bundled' },
    { name:'HTU21DF',       desc:'Temperature & humidity sensor (I2C)',           tags:['sensor','i2c'],      source:'bundled' },
    { name:'MPU6050',       desc:'6-axis IMU — accel + gyro (I2C)',               tags:['sensor','imu','i2c'],source:'bundled' },
    { name:'INA219',        desc:'High-side current / power monitor (I2C)',       tags:['sensor','power','i2c'],source:'bundled' },
    { name:'TMP117',        desc:'High-accuracy temperature sensor (I2C)',        tags:['sensor','i2c'],      source:'bundled' },
    { name:'MCP9808',       desc:'±0.25°C temperature sensor (I2C)',              tags:['sensor','i2c'],      source:'bundled' },
    { name:'VEML7700',      desc:'Ambient light sensor (I2C)',                    tags:['sensor','light','i2c'],source:'bundled' },
    { name:'DS1307',        desc:'I2C real-time clock',                           tags:['rtc','i2c'],         source:'bundled' },
];

const REGISTRY_BY_NAME = new Map(REGISTRY.map(e => [e.name.toLowerCase(), e]));

// Discover the libraries that actually exist by asking the CLI (which scans the
// real library folders). Falls back to the known REGISTRY names if the CLI
// can't be run (e.g. picpio not installed), so the panel is never empty.
function availableLibs(): string[] {
    const exe = vscode.workspace.getConfiguration('picpio').get<string>('executablePath', 'picpio');
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    try {
        const out = cp.execSync(`${exe} lib search`, { encoding: 'utf8', timeout: 5000, cwd });
        const names = out.split('\n')
            .filter(l => /^\s+\S/.test(l) && !l.includes('[PICPIO]'))
            .map(l => l.trim())
            .filter(Boolean);
        if (names.length) return names;
    } catch { /* CLI unavailable — fall back below */ }
    return REGISTRY.map(e => e.name);
}

function libMeta(name: string): LibEntry {
    return REGISTRY_BY_NAME.get(name.toLowerCase())
        ?? { name, desc: 'Bundled PICPIO library', tags: ['bundled'], source: 'bundled' };
}

interface Compat { ok: boolean; reasons: string[]; note: string; }

// Ask the CLI which bundled libraries are compatible with the project's MCU.
// One call returns the verdict for every library; failures degrade to "all ok".
function compatMap(): Map<string, Compat> {
    const m = new Map<string, Compat>();
    const exe = vscode.workspace.getConfiguration('picpio').get<string>('executablePath', 'picpio');
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    try {
        const out = cp.execSync(`${exe} lib check --json`, { encoding: 'utf8', timeout: 5000, cwd });
        const json = out.slice(out.indexOf('['), out.lastIndexOf(']') + 1);
        for (const e of JSON.parse(json) as Array<Compat & { name: string }>) {
            m.set(e.name.toLowerCase(), { ok: e.ok, reasons: e.reasons || [], note: e.note || '' });
        }
    } catch { /* CLI unavailable — treat everything as compatible */ }
    return m;
}

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

    private async _handle(msg: { command: string; name?: string; query?: string; force?: boolean }): Promise<void> {
        if (msg.command === 'install' && msg.name) {
            // Installing a library flagged incompatible — confirm before forcing.
            if (msg.force) {
                const pick = await vscode.window.showWarningMessage(
                    `${msg.name} may not be compatible with this MCU. Install anyway?`,
                    { modal: true }, 'Install anyway');
                if (pick !== 'Install anyway') return;
            }
            let cmd = `lib add ${msg.name}${msg.force ? ' --force' : ''}`;
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
        const compat = compatMap();

        const rows = availableLibs().map(libMeta).map(lib => {
            const isInstalled = installed.has(lib.name.toLowerCase());
            const c = compat.get(lib.name.toLowerCase());
            const incompatible = !isInstalled && c && !c.ok;

            let btn: string;
            if (isInstalled) {
                btn = `<button class="btn-sm btn-red" onclick="send('remove','${lib.name}')">&#128465; Remove</button>`;
            } else if (incompatible) {
                // Still allow it, but force the user to acknowledge the warning.
                btn = `<button class="btn-sm btn-warn" onclick="send('install','${lib.name}',true)">&#9888; Install anyway</button>`;
            } else {
                btn = `<button class="btn-sm btn-green" onclick="send('install','${lib.name}')">+ Install</button>`;
            }

            const tags = lib.tags.map(t => `<span class="tag">${t}</span>`).join('');
            const badge = isInstalled ? '<span class="badge-installed">Installed</span>'
                        : incompatible ? '<span class="badge-incompat">Not compatible</span>' : '';
            const warn = incompatible
                ? `<div class="incompat-why">&#9888; ${[...c!.reasons, c!.note].filter(Boolean).join(' — ')}</div>`
                : '';
            return `
                <tr class="${isInstalled ? 'row-installed' : ''}${incompatible ? ' row-incompat' : ''}">
                    <td><span class="lib-name">${lib.name}</span>${badge}</td>
                    <td class="lib-desc">${lib.desc}${warn}</td>
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
  .badge-incompat  { margin-left:6px; background:#3a2a12; border:1px solid #e2b340; color:#e2b340; border-radius:3px; padding:1px 6px; font-size:10px; font-weight:600; }
  .row-incompat { background:rgba(226,179,64,0.05); }
  .incompat-why { margin-top:4px; font-size:11px; color:#e2b340; }

  .btn-sm { padding:4px 12px; border-radius:3px; border:none; font-size:11px; font-weight:600; cursor:pointer; }
  .btn-green { background:var(--green); color:#000; }
  .btn-red   { background:#5a1d1d; color:var(--red); border:1px solid var(--red); }
  .btn-warn  { background:#4a3a12; color:#e2b340; border:1px solid #e2b340; }
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
    function send(cmd, name, force) { vscode.postMessage({ command: cmd, name: name, force: !!force }); }

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
