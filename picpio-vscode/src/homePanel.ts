import * as vscode from 'vscode';
import { readConfig, listInstalledLibs, formatClock } from './iniParser';
import * as fs   from 'fs';
import * as path from 'path';

const REGISTRY = [
    { name:'DHT22',         desc:'Humidity & temperature sensor (AM2302)',       tags:['sensor','1-wire']  },
    { name:'DS18B20',       desc:'Dallas 1-Wire temperature sensor',             tags:['sensor','1-wire']  },
    { name:'SSD1306',       desc:'128×64 OLED display over I2C',                tags:['display','i2c']    },
    { name:'LiquidCrystal', desc:'Character LCD 4-bit parallel mode',           tags:['display']          },
    { name:'Servo',         desc:'RC servo motor via Timer1 (0.5 µs res.)',     tags:['motor','pwm']      },
    { name:'Encoder',       desc:'Quadrature encoder with 4× decode via IOC',   tags:['input']            },
    { name:'Wire',          desc:'I2C master with streaming bulk transfer',     tags:['comms','i2c']      },
    { name:'SPI',           desc:'SPI master library',                          tags:['comms','spi']      },
    { name:'HardwareSerial',desc:'UART with interrupt-driven RX ring buffer',   tags:['comms','uart']     },
    { name:'AT24C256',      desc:'32KB I2C EEPROM with page write & polling',   tags:['storage','i2c']    },
    { name:'Keypad',        desc:'Matrix keypad driver (4×4 and 3×4)',          tags:['input']            },
    { name:'PID',           desc:'PID controller with anti-windup',             tags:['control']          },
    { name:'MPU6050',       desc:'6-axis IMU accelerometer+gyro over I2C',      tags:['sensor','i2c']     },
    { name:'BMP280',        desc:'Barometric pressure and temperature sensor',  tags:['sensor','i2c','spi']},
];

const BOARDS = [
    { mcu:'PIC18F27K40',      family:'PIC18', flash:'128KB', ram:'3.7KB', speed:'64MHz',  notes:'PPS • ADCC • Recommended for Arduino HAL' },
    { mcu:'PIC18F4550',       family:'PIC18', flash:'32KB',  ram:'2KB',   speed:'48MHz',  notes:'USB 2.0 Full Speed • DIP-40' },
    { mcu:'PIC18F452',        family:'PIC18', flash:'32KB',  ram:'1.5KB', speed:'40MHz',  notes:'SPI + I2C + ADC • DIP-40' },
    { mcu:'PIC18F2550',       family:'PIC18', flash:'32KB',  ram:'2KB',   speed:'48MHz',  notes:'USB 2.0 • DIP-28' },
    { mcu:'PIC16F877A',       family:'PIC16', flash:'14KB',  ram:'368B',  speed:'20MHz',  notes:'Classic PIC16 • ADC • DIP-40' },
    { mcu:'PIC16F628A',       family:'PIC16', flash:'2KB',   ram:'224B',  speed:'20MHz',  notes:'Tiny PIC16 • DIP-18' },
    { mcu:'PIC16F1829',       family:'PIC16', flash:'7KB',   ram:'512B',  speed:'32MHz',  notes:'MSSP + CCP + EUSART' },
    { mcu:'PIC24FJ128GA010',  family:'PIC24', flash:'128KB', ram:'8KB',   speed:'32MHz',  notes:'16-bit • USB OTG + DMA' },
    { mcu:'dsPIC33EP512MU810',family:'dsPIC', flash:'512KB', ram:'52KB',  speed:'140MHz', notes:'DSP + FPU • UART×6 • CAN' },
    { mcu:'PIC32MX360F512L',  family:'PIC32', flash:'512KB', ram:'32KB',  speed:'80MHz',  notes:'MIPS32 M4K • USB • CAN' },
    { mcu:'PIC32MZ2048EFH144',family:'PIC32', flash:'2MB',   ram:'512KB', speed:'200MHz', notes:'MIPS M-Class + FPU • Ethernet' },
];

export class HomePanel {
    static current: HomePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    static createOrShow(context: vscode.ExtensionContext): void {
        const col = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        if (HomePanel.current) {
            HomePanel.current._panel.reveal(col);
            HomePanel.current._update();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'picpioHome', 'PlatformIO Home', col,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        HomePanel.current = new HomePanel(panel, context);
    }

    private constructor(panel: vscode.WebviewPanel, private _ctx: vscode.ExtensionContext) {
        this._panel = panel;
        this._update();
        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
        this._panel.onDidChangeViewState(() => { if (this._panel.visible) this._update(); }, null, this._disposables);
        this._panel.webview.onDidReceiveMessage(m => this._handle(m), null, this._disposables);
    }

    private _handle(msg: { command: string; name?: string }): void {
        switch (msg.command) {
            case 'build':       vscode.commands.executeCommand('picpio.build');         break;
            case 'upload':      vscode.commands.executeCommand('picpio.upload');        break;
            case 'clean':       vscode.commands.executeCommand('picpio.clean');         break;
            case 'monitor':     vscode.commands.executeCommand('picpio.serialMonitor'); break;
            case 'newProject':  vscode.commands.executeCommand('picpio.newProject');    break;
            case 'openProject': vscode.commands.executeCommand('picpio.openProject');  break;
            case 'cli':         vscode.commands.executeCommand('picpio.openCli');       break;
            case 'install':
                if (msg.name) {
                    vscode.commands.executeCommand('picpio.runTask', `lib add ${msg.name}`);
                    setTimeout(() => this._update(), 3000);
                }
                break;
            case 'remove':
                if (msg.name) {
                    vscode.commands.executeCommand('picpio.runTask', `lib remove ${msg.name}`);
                    setTimeout(() => this._update(), 1500);
                }
                break;
            case 'addCustom': vscode.commands.executeCommand('picpio.libAdd'); break;
        }
    }

    private _update(): void { this._panel.webview.html = this._html(); }

    private _html(): string {
        const cfg       = readConfig();
        const installed = new Set(listInstalledLibs().map(n => n.toLowerCase()));

        // ── Recent projects (read from workspace state / recent folders) ─────
        const recentRaw: string[] = [];
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (root) recentRaw.push(root);

        const recentCards = recentRaw.length
            ? recentRaw.map(p => {
                const ini = path.join(p, 'picpio.ini');
                const name = path.basename(p);
                const hasCfg = fs.existsSync(ini);
                return `
                <div class="proj-card" onclick="send('openProject')">
                  <div class="proj-icon">&#128193;</div>
                  <div class="proj-info">
                    <div class="proj-name">${name}</div>
                    <div class="proj-path">${p}</div>
                    ${hasCfg ? '<div class="proj-badge">picpio.ini</div>' : ''}
                  </div>
                  <div class="proj-open">&#8594;</div>
                </div>`;
            }).join('')
            : `<div class="empty-state">No recent projects. <a onclick="send('newProject')">Create your first project</a>.</div>`;

        // ── Current project card ─────────────────────────────────────────────
        const projCard = cfg ? `
        <div class="env-card">
          <div class="env-card-header">
            <span class="env-icon">&#9632;</span>
            <div>
              <div class="env-name">${cfg.name}</div>
              <div class="env-meta">${cfg.mcu} &nbsp;&bull;&nbsp; ${cfg.family} &nbsp;&bull;&nbsp; ${formatClock(cfg.clock_hz)} &nbsp;&bull;&nbsp; ${cfg.programmer} &nbsp;&bull;&nbsp; ${cfg.framework}</div>
            </div>
          </div>
          <div class="btn-row">
            <button class="pbtn green"  onclick="send('build')">&#10003; Build</button>
            <button class="pbtn blue"   onclick="send('upload')">&#8594; Upload</button>
            <button class="pbtn orange" onclick="send('monitor')">&#128268; Monitor</button>
            <button class="pbtn gray"   onclick="send('clean')">&#128465; Clean</button>
          </div>
        </div>` : `
        <div class="empty-env">
          <div>No project open &mdash; open a folder containing <code>picpio.ini</code></div>
          <button class="pbtn orange" onclick="send('newProject')" style="margin-top:12px">+ New Project</button>
        </div>`;

        // ── Library rows ─────────────────────────────────────────────────────
        const libRows = REGISTRY.map(lib => {
            const on  = installed.has(lib.name.toLowerCase());
            const btn = on
                ? `<button class="lib-action red"   onclick="send('remove','${lib.name}')">Remove</button>`
                : `<button class="lib-action green" onclick="send('install','${lib.name}')">Install</button>`;
            return `
            <tr class="${on ? 'installed' : ''}">
              <td><span class="lib-name">${lib.name}</span>${on ? ' <span class="badge">INSTALLED</span>' : ''}</td>
              <td>${lib.desc}</td>
              <td>${lib.tags.map(t => `<span class="tag">${t}</span>`).join('')}</td>
              <td>${btn}</td>
            </tr>`;
        }).join('');

        // ── Board rows ───────────────────────────────────────────────────────
        const boardRows = BOARDS.map(b => `
        <tr>
          <td class="b-mcu">${b.mcu}</td>
          <td><span class="family-badge fam-${b.family.toLowerCase()}">${b.family}</span></td>
          <td>${b.flash}</td>
          <td>${b.ram}</td>
          <td>${b.speed}</td>
          <td class="b-notes">${b.notes}</td>
          <td><button class="lib-action blue" onclick="copyText('${b.mcu}')">Copy</button></td>
        </tr>`).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PICPIO Home</title>
<style>
/* ═══════════════════════ BASE ═══════════════════════ */
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg:      #1e1e1e;
  --sidebar: #252526;
  --card:    #2d2d2d;
  --border:  #3e3e42;
  --text:    #cccccc;
  --sub:     #888;
  --accent:  #f27f0c;      /* PlatformIO orange */
  --green:   #4ec9b0;
  --blue:    #569cd6;
  --red:     #f44747;
  --yellow:  #dcdcaa;
  --radius:  6px;
}
body {
  background: var(--bg);
  color: var(--text);
  font: 13px/1.5 'Segoe UI', -apple-system, sans-serif;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ═══════════════════════ NAV BAR ═══════════════════════ */
.navbar {
  background: #252526;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: stretch;
  height: 40px;
  flex-shrink: 0;
}
.nav-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px 0 16px;
  border-right: 1px solid var(--border);
  color: var(--accent);
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 1px;
}
.nav-brand .logo { font-size: 20px; }
.nav-tabs { display: flex; }
.nav-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
  font-size: 13px;
  color: var(--sub);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color .15s, border-color .15s;
  user-select: none;
  white-space: nowrap;
}
.nav-tab:hover { color: var(--text); }
.nav-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.nav-tab .icon { font-size: 14px; }
.nav-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
}

/* ═══════════════════════ CONTENT ═══════════════════════ */
.content {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}
.tab-pane { display: none; padding: 24px 28px; }
.tab-pane.active { display: block; }

/* ═══════════════════════ SECTION HEADER ═══════════════════════ */
.section-hdr {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: var(--sub);
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
  margin-bottom: 16px;
  margin-top: 24px;
}
.section-hdr:first-child { margin-top: 0; }

/* ═══════════════════════ HOME PAGE ═══════════════════════ */
.home-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 720px) { .home-cols { grid-template-columns: 1fr; } }

/* Quick action cards */
.quick-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
.q-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  cursor: pointer;
  text-align: center;
  transition: border-color .15s, background .15s;
}
.q-card:hover { border-color: var(--accent); background: #333; }
.q-card .qi { font-size: 26px; margin-bottom: 8px; }
.q-card .qt { font-size: 12px; font-weight: 600; margin-bottom: 3px; }
.q-card .qs { font-size: 11px; color: var(--sub); }

/* Env card */
.env-card {
  background: var(--card);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  padding: 16px;
}
.env-card-header { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.env-icon { font-size: 28px; color: var(--accent); }
.env-name { font-size: 15px; font-weight: 700; color: var(--yellow); }
.env-meta { font-size: 11px; color: var(--sub); margin-top: 3px; }
.empty-env {
  background: var(--card);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  padding: 28px;
  text-align: center;
  color: var(--sub);
}
.empty-env code { background: #333; padding: 2px 6px; border-radius: 3px; }

/* Project cards */
.proj-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color .15s;
}
.proj-card:hover { border-color: var(--accent); }
.proj-icon { font-size: 24px; color: var(--accent); flex-shrink: 0; }
.proj-info { flex: 1; min-width: 0; }
.proj-name { font-weight: 600; }
.proj-path { font-size: 11px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.proj-badge { display: inline-block; background: #1e3a2f; border: 1px solid var(--green); color: var(--green); border-radius: 3px; padding: 1px 6px; font-size: 10px; margin-top: 4px; }
.proj-open { font-size: 18px; color: var(--sub); }

.empty-state { color: var(--sub); font-size: 12px; padding: 12px 0; }
.empty-state a { color: var(--accent); cursor: pointer; text-decoration: underline; }

/* ═══════════════════════ BUTTONS ═══════════════════════ */
.btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
.pbtn {
  padding: 6px 16px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: filter .15s;
}
.pbtn:hover { filter: brightness(1.15); }
.pbtn.green  { background: var(--green);  color: #000; }
.pbtn.blue   { background: var(--blue);   color: #000; }
.pbtn.orange { background: var(--accent); color: #fff; }
.pbtn.gray   { background: #3e3e42;       color: var(--text); }
.pbtn.outline {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
}
.pbtn.outline:hover { border-color: var(--accent); color: var(--accent); }

/* ═══════════════════════ LIBRARIES ═══════════════════════ */
.lib-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 16px;
}
.search-box {
  flex: 1;
  padding: 7px 12px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 13px;
  outline: none;
}
.search-box:focus { border-color: var(--accent); }
.lib-table { width: 100%; border-collapse: collapse; }
.lib-table th {
  text-align: left;
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .8px;
  color: var(--sub);
  border-bottom: 1px solid var(--border);
}
.lib-table td { padding: 9px 10px; border-bottom: 1px solid #2a2a2a; font-size: 12px; vertical-align: middle; }
.lib-table tr:hover td { background: rgba(242,127,12,.04); }
.lib-table tr.installed td { background: rgba(78,201,176,.04); }
.lib-name { font-weight: 600; color: var(--yellow); }
.lib-table td:nth-child(2) { color: #aaa; max-width: 280px; }
.badge {
  margin-left: 6px;
  background: #1e3a2f;
  border: 1px solid var(--green);
  color: var(--green);
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 700;
  vertical-align: middle;
}
.tag {
  display: inline-block;
  background: #2a2a2a;
  border-radius: 3px;
  padding: 2px 7px;
  font-size: 10px;
  color: #777;
  margin: 1px;
}
.lib-action {
  padding: 3px 12px;
  border: none;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.lib-action.green { background: var(--green); color: #000; }
.lib-action.blue  { background: var(--blue);  color: #000; }
.lib-action.red   { background: transparent; border: 1px solid var(--red); color: var(--red); }
.lib-action:hover { filter: brightness(1.2); }

/* ═══════════════════════ BOARDS ═══════════════════════ */
.boards-table { width: 100%; border-collapse: collapse; }
.boards-table th {
  text-align: left;
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .8px;
  color: var(--sub);
  border-bottom: 1px solid var(--border);
}
.boards-table td { padding: 9px 10px; border-bottom: 1px solid #2a2a2a; font-size: 12px; }
.boards-table tr:hover td { background: rgba(242,127,12,.04); }
.b-mcu { font-weight: 700; color: var(--yellow); }
.b-notes { color: var(--sub); font-size: 11px; }
.family-badge {
  display: inline-block;
  border-radius: 3px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
}
.fam-pic18 { background: #1a2f4a; color: #569cd6; }
.fam-pic16 { background: #2a2a1a; color: #dcdcaa; }
.fam-pic24 { background: #1a2a1a; color: #4ec9b0; }
.fam-dspic { background: #2d1a2a; color: #c586c0; }
.fam-pic32 { background: #2a1a1a; color: #f44747; }

/* ═══════════════════════ TOAST ═══════════════════════ */
#toast {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--accent);
  color: #fff;
  border-radius: 4px;
  padding: 7px 20px;
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
  opacity: 0;
  transition: opacity .25s;
  z-index: 999;
}
</style>
</head>
<body>

<!-- ══ Navigation bar (identical to PlatformIO Home) ══ -->
<nav class="navbar">
  <div class="nav-brand">
    <span class="logo">&#9632;</span>
    PICPIO
  </div>
  <div class="nav-tabs">
    <div class="nav-tab active" id="tab-home"      onclick="show('home')">
      <span class="icon">&#127968;</span> Home
    </div>
    <div class="nav-tab" id="tab-projects"  onclick="show('projects')">
      <span class="icon">&#128193;</span> Projects
    </div>
    <div class="nav-tab" id="tab-libraries" onclick="show('libraries')">
      <span class="icon">&#128218;</span> Libraries
    </div>
    <div class="nav-tab" id="tab-boards"    onclick="show('boards')">
      <span class="icon">&#9632;</span> Boards
    </div>
    <div class="nav-tab" id="tab-devices"   onclick="show('devices')">
      <span class="icon">&#128268;</span> Devices
    </div>
  </div>
  <div class="nav-right">
    <button class="pbtn orange" onclick="send('newProject')">+ New Project</button>
    <button class="pbtn outline" onclick="send('openProject')">Open Project</button>
  </div>
</nav>

<div class="content">

<!-- ══ HOME ══ -->
<div class="tab-pane active" id="pane-home">
  <div class="section-hdr">Quick Access</div>
  <div class="quick-grid">
    <div class="q-card" onclick="send('newProject')">
      <div class="qi">&#128196;</div>
      <div class="qt">New Project</div>
      <div class="qs">Create a new PIC project</div>
    </div>
    <div class="q-card" onclick="send('openProject')">
      <div class="qi">&#128193;</div>
      <div class="qt">Open Project</div>
      <div class="qs">Open existing project folder</div>
    </div>
    <div class="q-card" onclick="send('cli')">
      <div class="qi">&#62;_</div>
      <div class="qt">PICPIO Core CLI</div>
      <div class="qs">Open terminal</div>
    </div>
  </div>

  <div class="home-cols">
    <div>
      <div class="section-hdr">Current Project</div>
      ${projCard}
    </div>
    <div>
      <div class="section-hdr">Recent Projects</div>
      ${recentCards}
      <div style="margin-top:16px">
        <div class="section-hdr">Keyboard Shortcuts</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <tr style="border-bottom:1px solid #2a2a2a">
            <td style="padding:7px 0;color:#888">Build</td>
            <td style="padding:7px 0;text-align:right">
              <code style="background:#333;border:1px solid #555;border-radius:3px;padding:2px 7px;font-size:11px">Ctrl+Alt+B</code>
            </td>
          </tr>
          <tr style="border-bottom:1px solid #2a2a2a">
            <td style="padding:7px 0;color:#888">Upload</td>
            <td style="padding:7px 0;text-align:right">
              <code style="background:#333;border:1px solid #555;border-radius:3px;padding:2px 7px;font-size:11px">Ctrl+Alt+U</code>
            </td>
          </tr>
          <tr style="border-bottom:1px solid #2a2a2a">
            <td style="padding:7px 0;color:#888">Serial Monitor</td>
            <td style="padding:7px 0;text-align:right">
              <code style="background:#333;border:1px solid #555;border-radius:3px;padding:2px 7px;font-size:11px">Ctrl+Alt+S</code>
            </td>
          </tr>
          <tr>
            <td style="padding:7px 0;color:#888">Command Palette</td>
            <td style="padding:7px 0;text-align:right">
              <code style="background:#333;border:1px solid #555;border-radius:3px;padding:2px 7px;font-size:11px">Ctrl+Shift+P</code>
            </td>
          </tr>
        </table>
      </div>
    </div>
  </div>
</div>

<!-- ══ PROJECTS ══ -->
<div class="tab-pane" id="pane-projects">
  <div class="section-hdr">Project Actions</div>
  <div class="btn-row" style="margin-bottom:24px">
    <button class="pbtn orange" onclick="send('newProject')">+ New Project</button>
    <button class="pbtn outline" onclick="send('openProject')">Open Project</button>
  </div>
  <div class="section-hdr">Current Project</div>
  ${projCard}
</div>

<!-- ══ LIBRARIES ══ -->
<div class="tab-pane" id="pane-libraries">
  <div class="lib-toolbar">
    <input class="search-box" id="libSearch" placeholder="Search by name, description, or tag…" oninput="filterLibs(this.value)">
    <button class="pbtn orange" onclick="send('addCustom')">+ GitHub / URL</button>
  </div>
  <table class="lib-table">
    <thead>
      <tr>
        <th style="width:160px">Name</th>
        <th>Description</th>
        <th style="width:160px">Tags</th>
        <th style="width:90px"></th>
      </tr>
    </thead>
    <tbody id="libBody">${libRows}</tbody>
  </table>
</div>

<!-- ══ BOARDS ══ -->
<div class="tab-pane" id="pane-boards">
  <div class="section-hdr">Supported Microcontrollers</div>
  <table class="boards-table">
    <thead>
      <tr>
        <th>MCU</th><th>Family</th><th>Flash</th><th>RAM</th><th>Speed</th><th>Notes</th><th></th>
      </tr>
    </thead>
    <tbody>${boardRows}</tbody>
  </table>
</div>

<!-- ══ DEVICES ══ -->
<div class="tab-pane" id="pane-devices">
  <div class="section-hdr">Serial Devices</div>
  <div class="empty-env" style="text-align:left">
    <p style="margin-bottom:12px">Open the Serial Monitor to connect to your device.</p>
    <button class="pbtn orange" onclick="send('monitor')">&#128268; Open Serial Monitor</button>
  </div>
  <div class="section-hdr" style="margin-top:24px">Programmers</div>
  <table class="boards-table">
    <thead><tr><th>Programmer</th><th>Interface</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td class="b-mcu">PICKit4</td><td>USB</td><td>Recommended — MPLAB X compatible</td></tr>
      <tr><td class="b-mcu">PICKit5</td><td>USB</td><td>Latest generation</td></tr>
      <tr><td class="b-mcu">PICKit3</td><td>USB</td><td>Legacy — widely available</td></tr>
      <tr><td class="b-mcu">ICD4</td><td>USB</td><td>In-circuit debugger</td></tr>
      <tr><td class="b-mcu">ICD5</td><td>USB</td><td>Latest ICD</td></tr>
      <tr><td class="b-mcu">Snap</td><td>USB</td><td>Low-cost programmer/debugger</td></tr>
    </tbody>
  </table>
</div>

</div><!-- /content -->

<div id="toast"></div>

<script>
const vscode = acquireVsCodeApi();
function send(cmd, name) { vscode.postMessage({ command: cmd, name: name }); }

function show(id) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  document.getElementById('pane-' + id).classList.add('active');
}

function filterLibs(q) {
  q = q.toLowerCase();
  document.querySelectorAll('#libBody tr').forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {});
  const t = document.getElementById('toast');
  t.textContent = 'Copied: ' + text;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 2000);
}
</script>
</body>
</html>`;
    }

    private _dispose(): void {
        HomePanel.current = undefined;
        this._panel.dispose();
        for (const d of this._disposables) d.dispose();
    }
}
