import * as vscode from 'vscode';
import { readConfig, listInstalledLibs, formatClock, isPicpioFramework } from './iniParser';
import { SNIPPETS } from './peripheralInsert';
import * as fs   from 'fs';
import * as path from 'path';
import * as cp   from 'child_process';

// ─── Data ────────────────────────────────────────────────────────────────────
interface RecentProject { path: string; name: string; mcu: string; lastOpened: number; hidden?: boolean; }

// Descriptions/tags for known bundled libraries. METADATA ONLY -- the list of
// libraries actually shown is discovered at runtime from `picpio lib search`
// (which scans the real picpio_tool/libraries/<Name>/ folders), so the Home
// panel always reflects what's truly installable. Libraries without an entry
// here get a generic description.
const REGISTRY = [
    { name:'SSD1306',       desc:'128x64/128x32 OLED display over I2C',          tags:['display','i2c']     },
    { name:'LiquidCrystal_I2C', desc:'Character LCD over PCF8574 I2C backpack',  tags:['display','i2c']     },
    { name:'LCD_HC595',     desc:'Character LCD via 74HC595 shift register',     tags:['display']           },
    { name:'ILI9341',       desc:'240x320 TFT LCD over SPI',                     tags:['display','spi']     },
    { name:'XPT2046',       desc:'Resistive touchscreen controller (SPI)',       tags:['input','spi']       },
    { name:'DWIN',          desc:'DWIN DGUS smart serial display',               tags:['display','uart']    },
    { name:'LVGL',          desc:'LVGL embedded graphics library',               tags:['display','gui']     },
    { name:'PID',           desc:'PID controller with anti-windup',              tags:['control']           },
    { name:'PIDTune',       desc:'Serial auto-tuning handler for the Auto PID Tuning panel', tags:['control'] },
    { name:'BME280',        desc:'Temperature, pressure & humidity (I2C)',       tags:['sensor','i2c']      },
    { name:'BMP280',        desc:'Barometric pressure & temperature (I2C)',      tags:['sensor','i2c']      },
    { name:'AHT10',         desc:'Temperature & humidity sensor (I2C)',          tags:['sensor','i2c']      },
    { name:'AHT20',         desc:'Temperature & humidity sensor (I2C)',          tags:['sensor','i2c']      },
    { name:'HTU21DF',       desc:'Temperature & humidity sensor (I2C)',          tags:['sensor','i2c']      },
    { name:'SI7021',        desc:'Temperature & humidity sensor (I2C)',          tags:['sensor','i2c']      },
    { name:'SHT31',         desc:'Temperature & humidity sensor (I2C)',          tags:['sensor','i2c']      },
    { name:'SHT4x',         desc:'Temperature & humidity sensor (I2C)',          tags:['sensor','i2c']      },
    { name:'HDC1000',       desc:'Temperature & humidity sensor (I2C)',          tags:['sensor','i2c']      },
    { name:'TMP117',        desc:'High-accuracy temperature sensor (I2C)',       tags:['sensor','i2c']      },
    { name:'MCP9808',       desc:'+/-0.25C temperature sensor (I2C)',            tags:['sensor','i2c']      },
    { name:'LPS22',         desc:'Barometric pressure sensor (I2C)',             tags:['sensor','i2c']      },
    { name:'VEML7700',      desc:'Ambient light sensor (I2C)',                   tags:['sensor','light','i2c']},
    { name:'TSL2591',       desc:'High-dynamic-range light sensor (I2C)',        tags:['sensor','light','i2c']},
    { name:'TCS34725',      desc:'RGB color sensor (I2C)',                       tags:['sensor','color','i2c']},
    { name:'MPU6050',       desc:'6-axis IMU - accel + gyro (I2C)',              tags:['sensor','imu','i2c']},
    { name:'INA219',        desc:'High-side current / power monitor (I2C)',      tags:['sensor','power','i2c']},
    { name:'INA260',        desc:'Current / power monitor, integrated shunt (I2C)', tags:['sensor','power','i2c']},
    { name:'ADS1115',       desc:'16-bit 4-channel I2C ADC',                     tags:['sensor','i2c']      },
    { name:'ADS1219',       desc:'24-bit 4-channel I2C ADC',                     tags:['sensor','i2c']      },
    { name:'MCP4725',       desc:'12-bit I2C DAC',                               tags:['dac','i2c']         },
    { name:'PCF8591',       desc:'8-bit I2C ADC (4ch) + DAC',                    tags:['adc','dac','i2c']   },
    { name:'PCF8575',       desc:'16-channel I2C GPIO expander',                 tags:['io','i2c']          },
    { name:'MCP23017',      desc:'16-channel I2C GPIO expander',                 tags:['io','i2c']          },
    { name:'MCP23008',      desc:'8-channel I2C GPIO expander',                  tags:['io','i2c']          },
    { name:'TCA9548A',      desc:'1-to-8 I2C multiplexer',                       tags:['io','i2c']          },
    { name:'DS3231',        desc:'High-accuracy I2C real-time clock',            tags:['rtc','i2c']         },
    { name:'DS1307',        desc:'I2C real-time clock',                          tags:['rtc','i2c']         },
];

const REGISTRY_BY_NAME = new Map(REGISTRY.map(e => [e.name.toLowerCase(), e]));

interface HomeLibCompat { ok: boolean; reasons: string[]; note: string; }

function homeExe(): string {
    return vscode.workspace.getConfiguration('picpio').get<string>('executablePath', 'picpio');
}
function homeCwd(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Real, installable libraries (scanned by the CLI). Falls back to the known
// names if the CLI can't be run, so the panel is never empty.
function homeAvailableLibs(): string[] {
    try {
        const out = cp.execSync(`${homeExe()} lib search`, { encoding: 'utf8', timeout: 5000, cwd: homeCwd() });
        const names = out.split('\n')
            .filter(l => /^\s+\S/.test(l) && !l.includes('[PICPIO]'))
            .map(l => l.trim()).filter(Boolean);
        if (names.length) return names;
    } catch { /* fall through */ }
    return REGISTRY.map(e => e.name);
}

function homeLibMeta(name: string): { name: string; desc: string; tags: string[] } {
    return REGISTRY_BY_NAME.get(name.toLowerCase())
        ?? { name, desc: 'Bundled PICPIO library', tags: ['bundled'] };
}

// Per-library MCU compatibility for the current project (one CLI call).
function homeCompatMap(): Map<string, HomeLibCompat> {
    const m = new Map<string, HomeLibCompat>();
    try {
        const out = cp.execSync(`${homeExe()} lib check --json`, { encoding: 'utf8', timeout: 5000, cwd: homeCwd() });
        const json = out.slice(out.indexOf('['), out.lastIndexOf(']') + 1);
        for (const e of JSON.parse(json) as Array<HomeLibCompat & { name: string }>) {
            m.set(e.name.toLowerCase(), { ok: e.ok, reasons: e.reasons || [], note: e.note || '' });
        }
    } catch { /* no compat info */ }
    return m;
}

const BOARDS = [
    { mcu:'PIC18F27K40',       family:'PIC18', flash:'128KB', ram:'3.7KB', speed:'64MHz',  notes:'PPS | ADCC | Recommended' },
    { mcu:'PIC18F4550',        family:'PIC18', flash:'32KB',  ram:'2KB',   speed:'48MHz',  notes:'USB 2.0 Full Speed | DIP-40' },
    { mcu:'PIC18F452',         family:'PIC18', flash:'32KB',  ram:'1.5KB', speed:'40MHz',  notes:'SPI + I2C + ADC | DIP-40' },
    { mcu:'PIC18F2550',        family:'PIC18', flash:'32KB',  ram:'2KB',   speed:'48MHz',  notes:'USB 2.0 | DIP-28' },
    { mcu:'PIC16F877A',        family:'PIC16', flash:'14KB',  ram:'368B',  speed:'20MHz',  notes:'Classic PIC16 | DIP-40' },
    { mcu:'PIC16F628A',        family:'PIC16', flash:'2KB',   ram:'224B',  speed:'20MHz',  notes:'Tiny PIC16 | DIP-18' },
    { mcu:'PIC16F1829',        family:'PIC16', flash:'7KB',   ram:'512B',  speed:'32MHz',  notes:'MSSP + CCP + EUSART' },
    { mcu:'PIC24FJ128GA010',   family:'PIC24', flash:'128KB', ram:'8KB',   speed:'32MHz',  notes:'16-bit | USB OTG + DMA' },
    { mcu:'dsPIC33EP512MU810', family:'dsPIC', flash:'512KB', ram:'52KB',  speed:'140MHz', notes:'DSP + FPU | UART x6 | CAN' },
    { mcu:'PIC32MX360F512L',   family:'PIC32', flash:'512KB', ram:'32KB',  speed:'80MHz',  notes:'MIPS32 M4K | USB | CAN' },
    { mcu:'PIC32MZ2048EFH144', family:'PIC32', flash:'2MB',   ram:'512KB', speed:'200MHz', notes:'MIPS M-Class + FPU | Ethernet' },
];

function peripheralControl(kind: string, btnLabel: string): string {
    const snip = SNIPPETS[kind];
    const select = snip.pinOptions
        ? `<select class="pin-select" id="pin-${kind}">${
            snip.pinOptions.map((p, i) => `<option value="${i}">${p.label}</option>`).join('')
          }</select>`
        : '';
    return `
        <div class="periph-item">
          <button class="pbtn outline" onclick="sendPeriph('${kind}')">${btnLabel}</button>
          ${select}
        </div>`;
}

function relativeTime(ms: number): string {
    const diff = Date.now() - ms;
    const min  = Math.floor(diff / 60000);
    const hr   = Math.floor(diff / 3600000);
    const day  = Math.floor(diff / 86400000);
    if (min < 2)   return 'just now';
    if (min < 60)  return `${min} minutes ago`;
    if (hr  < 24)  return `${hr} hours ago`;
    if (day < 30)  return `${day} days ago`;
    return `${Math.floor(day / 30)} months ago`;
}

// ─── Panel ───────────────────────────────────────────────────────────────────
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
            'picpioHome', 'PICPIO Home', col,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        HomePanel.current = new HomePanel(panel, context);
    }

    private constructor(panel: vscode.WebviewPanel, private _ctx: vscode.ExtensionContext) {
        this._panel = panel;
        this._trackCurrentProject();
        this._update();
        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
        this._panel.onDidChangeViewState(() => { if (this._panel.visible) this._update(); }, null, this._disposables);
        this._panel.webview.onDidReceiveMessage(m => this._handle(m), null, this._disposables);
    }

    private _trackCurrentProject(): void {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) return;
        const iniPath = path.join(root, 'picpio.ini');
        if (!fs.existsSync(iniPath)) return;
        const cfg = readConfig();
        if (!cfg) return;

        const projects = this._ctx.globalState.get<RecentProject[]>('recentProjects', []);
        const idx = projects.findIndex(p => p.path === root);
        const entry: RecentProject = { path: root, name: cfg.name, mcu: cfg.mcu, lastOpened: Date.now() };
        if (idx >= 0) projects[idx] = { ...projects[idx], ...entry };
        else projects.unshift(entry);
        // keep max 20
        this._ctx.globalState.update('recentProjects', projects.slice(0, 20));
    }

    private _handle(msg: any): void {
        switch (msg.command) {
            case 'build':        vscode.commands.executeCommand('picpio.build');         break;
            case 'upload':       vscode.commands.executeCommand('picpio.upload');        break;
            case 'clean':        vscode.commands.executeCommand('picpio.clean');         break;
            case 'monitor':      vscode.commands.executeCommand('picpio.serialMonitor'); break;
            case 'simulate':     vscode.commands.executeCommand('picpio.simulate');      break;
            case 'newProject':   vscode.commands.executeCommand('picpio.newProject');    break;
            case 'openProject':  vscode.commands.executeCommand('picpio.openProject');  break;
            case 'cli':          vscode.commands.executeCommand('picpio.openCli');       break;
            case 'install':
                if (msg.name) {
                    if (msg.force) {
                        vscode.window.showWarningMessage(
                            `${msg.name} may not be compatible with this MCU. Install anyway?`,
                            { modal: true }, 'Install anyway',
                        ).then(pick => {
                            if (pick !== 'Install anyway') return;
                            vscode.commands.executeCommand('picpio.runTask', `lib add ${msg.name} --force`);
                            setTimeout(() => this._update(), 3000);
                        });
                    } else {
                        vscode.commands.executeCommand('picpio.runTask', `lib add ${msg.name}`);
                        setTimeout(() => this._update(), 3000);
                    }
                }
                break;
            case 'remove':
                if (msg.name) {
                    vscode.commands.executeCommand('picpio.runTask', `lib remove ${msg.name}`);
                    setTimeout(() => this._update(), 1500);
                }
                break;
            case 'addCustom': vscode.commands.executeCommand('picpio.libAdd'); break;
            case 'insertPeripheral':
                if (msg.name) vscode.commands.executeCommand('picpio.insertPeripheral', msg.name, msg.pin !== undefined ? Number(msg.pin) : undefined);
                break;
            case 'openPath':
                if (msg.path) {
                    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(msg.path), false);
                }
                break;
            case 'hideProject':
                if (msg.path) {
                    const list = this._ctx.globalState.get<RecentProject[]>('recentProjects', []);
                    const updated = list.map(p => p.path === msg.path ? { ...p, hidden: true } : p);
                    this._ctx.globalState.update('recentProjects', updated);
                    this._update();
                }
                break;
        }
    }

    private _update(): void { this._panel.webview.html = this._html(); }

    private _html(): string {
        const cfg       = readConfig();
        const installed = new Set(listInstalledLibs().map(n => n.toLowerCase()));
        const logoUri   = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._ctx.extensionUri, 'resources', 'icons', 'pic.svg')
        );

        const allProjects = this._ctx.globalState.get<RecentProject[]>('recentProjects', []);
        const projects    = allProjects.filter(p => !p.hidden);

        // ── Project rows (PlatformIO-style table) ─────────────────────────────
        const projRows = projects.length
            ? projects.map(p => `
            <tr>
              <td>
                <span class="proj-expand">+</span>
                <span class="proj-name-lnk" onclick="send('openPath','${p.path.replace(/\\/g, '\\\\')}')">${p.name}</span>
                <div class="proj-sub-path">${p.path}</div>
              </td>
              <td><span class="board-chip">${p.mcu}</span></td>
              <td class="col-mod">${relativeTime(p.lastOpened)}</td>
              <td class="col-act">
                <a class="act-link" onclick="send('hideProject','${p.path.replace(/\\/g, '\\\\')}')">Hide</a>
                <span class="act-sep">|</span>
                <a class="act-link act-open" onclick="send('openPath','${p.path.replace(/\\/g, '\\\\')}')">Open</a>
              </td>
            </tr>`).join('')
            : `<tr><td colspan="4" class="empty-row">No recent projects. <a onclick="send('newProject')">Create your first project</a>.</td></tr>`;

        // ── Current project card ──────────────────────────────────────────────
        const projCard = cfg ? `
        <div class="env-card">
          <div class="env-card-header">
            <span class="env-icon">&#9632;</span>
            <div>
              <div class="env-name">${cfg.name}</div>
              <div class="env-meta">${cfg.mcu} &bull; ${cfg.family} &bull; ${formatClock(cfg.clock_hz)} &bull; ${cfg.programmer} &bull; ${cfg.framework}</div>
            </div>
          </div>
          <div class="btn-row">
            <button class="pbtn green"  onclick="send('build')">&#10003; Build</button>
            <button class="pbtn blue"   onclick="send('upload')">&#8594; Upload</button>
            <button class="pbtn orange" onclick="send('monitor')">&#128268; Monitor</button>
            <button class="pbtn gray"   onclick="send('clean')">&#128465; Clean</button>
          </div>
          ${isPicpioFramework(cfg.framework) ? `
          <div class="periph-row">
            ${peripheralControl('spi',   '+ SPI')}
            ${peripheralControl('usart', '+ USART')}
            ${peripheralControl('i2c',   '+ I2C')}
            ${peripheralControl('pwm',   '+ PWM')}
            <button class="pbtn orange" onclick="send('simulate')">&#9889; Simulate</button>
          </div>` : ''}
        </div>` : `
        <div class="empty-env">
          No project open &mdash; open a folder containing <code>picpio.ini</code>
          <br><button class="pbtn orange" onclick="send('newProject')" style="margin-top:12px">+ New Project</button>
        </div>`;

        // ── Library rows ──────────────────────────────────────────────────────
        // The list is the real installable set (scanned by the CLI); REGISTRY is
        // only used for descriptions/tags.
        const homeCompat = homeCompatMap();
        const libRows = homeAvailableLibs().map(homeLibMeta).map(lib => {
            const on  = installed.has(lib.name.toLowerCase());
            const c   = homeCompat.get(lib.name.toLowerCase());
            const bad = !on && c && !c.ok;
            const btn = on
                ? `<button class="lib-action red"   onclick="send('remove','${lib.name}')">Remove</button>`
                : bad
                ? `<button class="lib-action amber" onclick="send('install','${lib.name}',true)" title="May not run on this MCU">&#9888; Install anyway</button>`
                : `<button class="lib-action green" onclick="send('install','${lib.name}')">Install</button>`;
            const warn = bad
                ? `<div class="lib-incompat">&#9888; ${[...c!.reasons, c!.note].filter(Boolean).join(' - ')}</div>`
                : '';
            return `
            <tr class="${on ? 'installed' : ''}">
              <td><span class="lib-name">${lib.name}</span>${on ? ' <span class="badge">INSTALLED</span>' : bad ? ' <span class="badge" style="background:#3a2a12;border-color:#e2b340;color:#e2b340">N/A</span>' : ''}</td>
              <td>${lib.desc}${warn}</td>
              <td>${lib.tags.map(t => `<span class="tag">${t}</span>`).join('')}</td>
              <td>${btn}</td>
            </tr>`;
        }).join('');

        // ── Board rows ────────────────────────────────────────────────────────
        const boardRows = BOARDS.map(b => `
        <tr>
          <td class="b-mcu">${b.mcu}</td>
          <td><span class="family-badge fam-${b.family.toLowerCase()}">${b.family}</span></td>
          <td>${b.flash}</td><td>${b.ram}</td><td>${b.speed}</td>
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
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#1e1e1e;--sidebar:#252526;--card:#2d2d2d;--border:#3e3e42;
  --text:#cccccc;--sub:#888;--accent:#f27f0c;
  --green:#4ec9b0;--blue:#569cd6;--red:#f44747;--yellow:#dcdcaa;
  --radius:4px;
}
body{background:var(--bg);color:var(--text);font:13px/1.5 'Segoe UI',-apple-system,sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}

/* NAV */
.navbar{background:#252526;border-bottom:1px solid var(--border);display:flex;align-items:stretch;height:40px;flex-shrink:0}
.nav-brand{display:flex;align-items:center;gap:8px;padding:0 20px 0 16px;border-right:1px solid var(--border);color:var(--accent);font-weight:700;font-size:14px;letter-spacing:1px;white-space:nowrap}
.nav-tabs{display:flex}
.nav-tab{display:flex;align-items:center;gap:6px;padding:0 16px;font-size:13px;color:var(--sub);cursor:pointer;border-bottom:2px solid transparent;transition:color .15s,border-color .15s;user-select:none;white-space:nowrap}
.nav-tab:hover{color:var(--text)}
.nav-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.nav-right{margin-left:auto;display:flex;align-items:center;gap:8px;padding:0 16px}

/* CONTENT */
.content{flex:1;overflow-y:auto}
.tab-pane{display:none;padding:0}
.tab-pane.active{display:block}

/* ── HOME WELCOME ── */
.welcome-wrap{display:flex;gap:0;border-bottom:1px solid var(--border)}
.welcome-left{width:340px;flex-shrink:0;padding:40px 36px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-right:1px solid var(--border);background:#252526}
.logo-circle{width:120px;height:120px;border-radius:50%;border:3px solid var(--accent);display:flex;align-items:center;justify-content:center;font-size:56px;color:var(--accent);margin-bottom:24px;background:#1a1a1a}
.welcome-title{font-size:20px;font-weight:300;color:var(--text);margin-bottom:4px;text-align:center}
.welcome-title b{color:var(--accent);font-weight:700}
.welcome-ver{font-size:11px;color:var(--sub);display:flex;gap:8px;justify-content:center;margin-top:10px}
.ver-chip{background:#2a2a2a;border:1px solid var(--border);border-radius:10px;padding:2px 10px;font-size:11px}

.welcome-right{flex:1;padding:36px 40px}
.qa-title{font-size:16px;font-weight:600;color:var(--text);margin-bottom:20px}
.qa-btn{display:flex;align-items:center;gap:14px;padding:13px 18px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:10px;cursor:pointer;transition:border-color .15s,background .15s;width:100%}
.qa-btn:hover{border-color:var(--accent);background:#333}
.qa-icon{font-size:20px;width:28px;text-align:center;flex-shrink:0;color:var(--accent)}
.qa-text{flex:1}
.qa-label{font-size:13px;font-weight:600;color:var(--text)}
.qa-desc{font-size:11px;color:var(--sub);margin-top:1px}
.qa-arrow{color:var(--sub);font-size:16px}

.home-body{padding:24px 28px}
.section-hdr{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;color:var(--sub);border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:16px;margin-top:24px}
.section-hdr:first-child{margin-top:0}

/* ── PROJECTS TABLE ── */
.proj-toolbar{display:flex;gap:10px;align-items:center;padding:16px 28px;border-bottom:1px solid var(--border)}
.search-box{flex:1;padding:7px 12px;background:var(--card);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:13px;outline:none}
.search-box:focus{border-color:var(--accent)}
.proj-table{width:100%;border-collapse:collapse}
.proj-table th{text-align:left;padding:8px 16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;color:var(--sub);border-bottom:1px solid var(--border);background:#252526;position:sticky;top:0}
.proj-table td{padding:10px 16px;border-bottom:1px solid #2a2a2a;vertical-align:top}
.proj-table tr:hover td{background:rgba(242,127,12,.04)}
.proj-expand{color:var(--sub);margin-right:8px;font-size:11px;cursor:pointer;user-select:none}
.proj-name-lnk{font-weight:600;color:var(--accent);cursor:pointer;font-size:13px}
.proj-name-lnk:hover{text-decoration:underline}
.proj-sub-path{font-size:11px;color:var(--sub);margin-top:2px;word-break:break-all}
.board-chip{display:inline-block;background:#1a2f4a;border:1px solid #2a4a6a;color:var(--blue);border-radius:10px;padding:2px 10px;font-size:11px;font-weight:600}
.col-mod{color:var(--sub);font-size:12px;white-space:nowrap}
.col-act{white-space:nowrap}
.act-link{color:var(--blue);cursor:pointer;font-size:12px;text-decoration:none}
.act-link:hover{text-decoration:underline}
.act-open{color:var(--accent)}
.act-sep{color:var(--sub);margin:0 6px}
.empty-row{text-align:center;padding:32px!important;color:var(--sub)}
.empty-row a{color:var(--accent);cursor:pointer;text-decoration:underline}

/* ENV CARD */
.env-card{background:var(--card);border:1px solid var(--accent);border-radius:var(--radius);padding:16px;margin-bottom:16px}
.env-card-header{display:flex;align-items:center;gap:14px;margin-bottom:14px}
.env-icon{font-size:28px;color:var(--accent)}
.env-name{font-size:15px;font-weight:700;color:var(--yellow)}
.env-meta{font-size:11px;color:var(--sub);margin-top:3px}
.empty-env{background:var(--card);border:1px dashed var(--border);border-radius:var(--radius);padding:28px;text-align:center;color:var(--sub)}
.empty-env code{background:#333;padding:2px 6px;border-radius:3px}

/* BUTTONS */
.btn-row{display:flex;gap:8px;flex-wrap:wrap}
.pbtn{padding:6px 16px;border:none;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;transition:filter .15s}
.pbtn:hover{filter:brightness(1.15)}
.pbtn.green{background:var(--green);color:#000}
.pbtn.blue{background:var(--blue);color:#000}
.pbtn.orange{background:var(--accent);color:#fff}
.pbtn.gray{background:#3e3e42;color:var(--text)}
.pbtn.outline{background:transparent;border:1px solid var(--border);color:var(--text)}
.pbtn.outline:hover{border-color:var(--accent);color:var(--accent)}

/* PERIPHERALS */
.periph-row{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px}
.periph-item{display:flex;align-items:center;gap:6px}
.pin-select{background:#2a2a2a;border:1px solid var(--border);color:var(--sub);border-radius:4px;padding:5px 8px;font-size:11px;cursor:pointer}
.pin-select:focus{border-color:var(--accent);color:var(--text)}

/* LIBS */
.lib-toolbar{display:flex;gap:10px;align-items:center;padding:16px 28px;border-bottom:1px solid var(--border)}
.lib-table{width:100%;border-collapse:collapse}
.lib-table th{text-align:left;padding:8px 16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;color:var(--sub);border-bottom:1px solid var(--border);background:#252526;position:sticky;top:0}
.lib-table td{padding:9px 16px;border-bottom:1px solid #2a2a2a;font-size:12px;vertical-align:middle}
.lib-table tr:hover td{background:rgba(242,127,12,.04)}
.lib-table tr.installed td{background:rgba(78,201,176,.04)}
.lib-name{font-weight:600;color:var(--yellow)}
.badge{margin-left:6px;background:#1e3a2f;border:1px solid var(--green);color:var(--green);border-radius:3px;padding:1px 6px;font-size:10px;font-weight:700;vertical-align:middle}
.tag{display:inline-block;background:#2a2a2a;border-radius:3px;padding:2px 7px;font-size:10px;color:#777;margin:1px}
.lib-action{padding:3px 12px;border:none;border-radius:3px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
.lib-action.green{background:var(--green);color:#000}
.lib-action.blue{background:var(--blue);color:#000}
.lib-action.red{background:transparent;border:1px solid var(--red);color:var(--red)}
.lib-action.amber{background:#4a3a12;border:1px solid #e2b340;color:#e2b340}
.lib-action:hover{filter:brightness(1.2)}
.lib-incompat{margin-top:4px;font-size:11px;color:#e2b340}

/* BOARDS */
.boards-wrap{padding:0}
.boards-table{width:100%;border-collapse:collapse}
.boards-table th{text-align:left;padding:8px 16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.8px;color:var(--sub);border-bottom:1px solid var(--border);background:#252526;position:sticky;top:0}
.boards-table td{padding:9px 16px;border-bottom:1px solid #2a2a2a;font-size:12px}
.boards-table tr:hover td{background:rgba(242,127,12,.04)}
.b-mcu{font-weight:700;color:var(--yellow)}
.b-notes{color:var(--sub);font-size:11px}
.family-badge{display:inline-block;border-radius:3px;padding:2px 8px;font-size:10px;font-weight:700}
.fam-pic18{background:#1a2f4a;color:#569cd6}
.fam-pic16{background:#2a2a1a;color:#dcdcaa}
.fam-pic24{background:#1a2a1a;color:#4ec9b0}
.fam-dspic{background:#2d1a2a;color:#c586c0}
.fam-pic32{background:#2a1a1a;color:#f44747}

/* DEVICES */
.devices-wrap{padding:24px 28px}

/* TOAST */
#toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;border-radius:4px;padding:7px 20px;font-size:12px;font-weight:600;pointer-events:none;opacity:0;transition:opacity .25s;z-index:999}
</style>
</head>
<body>

<nav class="navbar">
  <div class="nav-brand">&#9632; PICPIO</div>
  <div class="nav-tabs">
    <div class="nav-tab active" id="tab-home"      onclick="show('home')">&#127968; Home</div>
    <div class="nav-tab" id="tab-projects"         onclick="show('projects')">&#128193; Projects</div>
    <div class="nav-tab" id="tab-libraries"        onclick="show('libraries')">&#128218; Libraries</div>
    <div class="nav-tab" id="tab-boards"           onclick="show('boards')">&#9632; Boards</div>
    <div class="nav-tab" id="tab-devices"          onclick="show('devices')">&#128268; Devices</div>
  </div>
  <div class="nav-right">
    <button class="pbtn orange" onclick="send('newProject')">+ New Project</button>
    <button class="pbtn outline" onclick="send('openProject')">Open Project</button>
  </div>
</nav>

<div class="content">

<!-- ══ HOME ══ -->
<div class="tab-pane active" id="pane-home">
  <div class="welcome-wrap">
    <div class="welcome-left">
      <div class="logo-circle"><img src="${logoUri}" alt="PICPIO" width="64" height="64"></div>
      <div class="welcome-title">Welcome to <b>PICPIO</b></div>
      <div class="welcome-ver">
        <span class="ver-chip">Core 1.0.0</span>
        <span class="ver-chip">Home 1.0.0</span>
      </div>
    </div>
    <div class="welcome-right">
      <div class="qa-title">Quick Access</div>
      <div class="qa-btn" onclick="send('newProject')">
        <span class="qa-icon">+</span>
        <div class="qa-text">
          <div class="qa-label">New Project</div>
          <div class="qa-desc">Create a new PIC microcontroller project</div>
        </div>
        <span class="qa-arrow">&#8250;</span>
      </div>
      <div class="qa-btn" onclick="send('openProject')">
        <span class="qa-icon">&#128193;</span>
        <div class="qa-text">
          <div class="qa-label">Open Project</div>
          <div class="qa-desc">Open an existing PICPIO project folder</div>
        </div>
        <span class="qa-arrow">&#8250;</span>
      </div>
      <div class="qa-btn" onclick="show('boards')">
        <span class="qa-icon">&#9632;</span>
        <div class="qa-text">
          <div class="qa-label">Boards &amp; MCUs</div>
          <div class="qa-desc">Browse supported PIC microcontrollers</div>
        </div>
        <span class="qa-arrow">&#8250;</span>
      </div>
      <div class="qa-btn" onclick="show('libraries')">
        <span class="qa-icon">&#128218;</span>
        <div class="qa-text">
          <div class="qa-label">Library Manager</div>
          <div class="qa-desc">Install and manage project libraries</div>
        </div>
        <span class="qa-arrow">&#8250;</span>
      </div>
    </div>
  </div>

  <div class="home-body">
    <div class="section-hdr">Current Project</div>
    ${projCard}

    <div class="section-hdr" style="margin-top:24px">Keyboard Shortcuts</div>
    <table style="width:100%;max-width:400px;border-collapse:collapse;font-size:12px">
      ${[['Build','Ctrl+Alt+B'],['Upload','Ctrl+Alt+U'],['Clean Build','Ctrl+Alt+R'],['Serial Monitor','Ctrl+Alt+S']].map(([k,v])=>`
      <tr style="border-bottom:1px solid #2a2a2a">
        <td style="padding:7px 0;color:#888">${k}</td>
        <td style="padding:7px 0;text-align:right"><code style="background:#333;border:1px solid #555;border-radius:3px;padding:2px 7px;font-size:11px">${v}</code></td>
      </tr>`).join('')}
    </table>
  </div>
</div>

<!-- ══ PROJECTS ══ -->
<div class="tab-pane" id="pane-projects">
  <div class="proj-toolbar">
    <input class="search-box" id="projSearch" placeholder="Search project..." oninput="filterProj(this.value)">
    <button class="pbtn orange" onclick="send('newProject')">+ New Project</button>
    <button class="pbtn outline" onclick="send('openProject')">Open Project</button>
  </div>
  <table class="proj-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Board / MCU</th>
        <th>Modified</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody id="projBody">${projRows}</tbody>
  </table>
</div>

<!-- ══ LIBRARIES ══ -->
<div class="tab-pane" id="pane-libraries">
  <div class="lib-toolbar">
    <input class="search-box" id="libSearch" placeholder="Search by name, description, or tag..." oninput="filterLibs(this.value)">
    <button class="pbtn orange" onclick="send('addCustom')">+ GitHub / URL</button>
  </div>
  <table class="lib-table">
    <thead><tr><th style="width:160px">Name</th><th>Description</th><th style="width:160px">Tags</th><th style="width:90px"></th></tr></thead>
    <tbody id="libBody">${libRows}</tbody>
  </table>
</div>

<!-- ══ BOARDS ══ -->
<div class="tab-pane" id="pane-boards">
  <div class="boards-wrap">
    <table class="boards-table">
      <thead><tr><th>MCU</th><th>Family</th><th>Flash</th><th>RAM</th><th>Speed</th><th>Notes</th><th></th></tr></thead>
      <tbody>${boardRows}</tbody>
    </table>
  </div>
</div>

<!-- ══ DEVICES ══ -->
<div class="tab-pane" id="pane-devices">
  <div class="devices-wrap">
    <div class="section-hdr">Serial Monitor</div>
    <div class="empty-env" style="text-align:left;margin-bottom:24px">
      <p style="margin-bottom:12px">Connect your PIC device and open the Serial Monitor.</p>
      <button class="pbtn orange" onclick="send('monitor')">&#128268; Open Serial Monitor</button>
    </div>
    <div class="section-hdr">Programmers</div>
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
</div>

</div>
<div id="toast"></div>

<script>
const vscode = acquireVsCodeApi();
function send(cmd, arg, force) { vscode.postMessage({ command: cmd, name: arg, path: arg, force: !!force }); }

function sendPeriph(kind) {
  const sel = document.getElementById('pin-' + kind);
  vscode.postMessage({ command: 'insertPeripheral', name: kind, pin: sel ? sel.value : undefined });
}

function show(id) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  document.getElementById('pane-' + id).classList.add('active');
}

function filterProj(q) {
  q = q.toLowerCase();
  document.querySelectorAll('#projBody tr').forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
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
  setTimeout(() => t.style.opacity = '0', 2000);
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
