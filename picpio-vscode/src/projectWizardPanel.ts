import * as vscode from 'vscode';
import * as path   from 'path';
import * as os     from 'os';
import { MCU_LIST, FRAMEWORK_LIST, PROGRAMMER_LIST, createProject } from './newProject';

export class ProjectWizardPanel {
    static current: ProjectWizardPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    static createOrShow(): void {
        const col = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        if (ProjectWizardPanel.current) {
            ProjectWizardPanel.current._panel.reveal(col);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'picpioNewProject', 'PICPIO: New Project', col,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        ProjectWizardPanel.current = new ProjectWizardPanel(panel);
    }

    private constructor(panel: vscode.WebviewPanel) {
        this._panel = panel;
        this._panel.webview.html = this._html();
        // Hide sidebar/panel and maximize the editor area so the centered
        // card sits in the middle of the whole VS Code window.
        vscode.commands.executeCommand('workbench.action.maximizeEditorHideSidebar');
        this._panel.onDidDispose(() => this._dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(m => this._handle(m), null, this._disposables);
    }

    private _dispose(): void {
        ProjectWizardPanel.current = undefined;
        // Restore the sidebar/panel layout
        vscode.commands.executeCommand('workbench.action.maximizeEditorHideSidebar');
        this._disposables.forEach(d => d.dispose());
    }

    private async _handle(msg: any): Promise<void> {
        switch (msg.command) {
            case 'cancel':
                this._panel.dispose();
                break;

            case 'browse': {
                const uri = await vscode.window.showOpenDialog({
                    canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
                    title: 'Choose parent folder for the new project',
                });
                if (uri?.[0]) {
                    this._panel.webview.postMessage({ command: 'locationPicked', path: uri[0].fsPath });
                }
                break;
            }

            case 'create': {
                const name = String(msg.name || '').trim();
                if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
                    this._panel.webview.postMessage({ command: 'error', message: 'Project name may only contain letters, numbers, _ and -' });
                    return;
                }

                const parentDir = msg.useDefault
                    ? path.join(os.homedir(), 'Documents', 'PICPIO', 'Projects')
                    : String(msg.location || '');
                if (!parentDir) {
                    this._panel.webview.postMessage({ command: 'error', message: 'Please choose a location' });
                    return;
                }

                const projectDir = path.join(parentDir, name);
                const result = await createProject({
                    name,
                    mcu:        msg.mcu,
                    framework:  msg.framework,
                    programmer: msg.programmer,
                    projectDir,
                });

                if (!result.ok) {
                    this._panel.webview.postMessage({ command: 'error', message: result.error });
                    return;
                }

                this._panel.dispose();
                vscode.window.showInformationMessage(`Project '${name}' created at ${projectDir}`);
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectDir), false);
                break;
            }
        }
    }

    private _html(): string {
        const defaultLocation = path.join(os.homedir(), 'Documents', 'PICPIO', 'Projects');

        const mcuListJson = JSON.stringify(MCU_LIST.map(m => ({ label: m.label, description: m.description })));

        const fwOptions = FRAMEWORK_LIST.map(f =>
            `<option value="${f.label}">${f.label}</option>`
        ).join('');

        const progOptions = PROGRAMMER_LIST.map(p => `<option value="${p}">${p}</option>`).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PICPIO: New Project</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{ --radius:4px; --accent:#f27f0c; --accent-hover:#ff9933; }
html,body{height:100%}
body{
  background:var(--vscode-editor-background);
  color:var(--vscode-foreground);
  font:var(--vscode-font-size,13px)/1.5 var(--vscode-font-family,'Segoe UI',sans-serif);
  display:flex;align-items:center;justify-content:center;
  min-height:100vh;
}
.card{
  width:560px;max-width:94vw;
  background:var(--vscode-editorWidget-background);
  border:1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, transparent));
  border-top:3px solid var(--accent);
  border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,.4);
}
.card-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:18px 22px;border-bottom:1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, transparent));
}
.card-header h2{font-size:18px;font-weight:600;color:var(--accent)}
.close-btn{
  background:none;border:none;color:var(--vscode-foreground);opacity:.7;font-size:18px;cursor:pointer;
  width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:4px;
}
.close-btn:hover{background:var(--vscode-toolbar-hoverBackground);opacity:1}
.card-body{padding:20px 22px}
.desc{color:var(--vscode-descriptionForeground);font-size:13px;margin-bottom:20px;line-height:1.6}
.desc b{color:var(--vscode-foreground)}
.field{display:flex;align-items:center;gap:16px;margin-bottom:16px}
.field label{width:90px;text-align:right;flex-shrink:0;color:var(--vscode-foreground)}
.field-control{flex:1}
input[type=text]{
  width:100%;padding:8px 10px;
  background:var(--vscode-input-background);
  border:1px solid var(--vscode-input-border, transparent);
  border-radius:var(--radius);color:var(--vscode-input-foreground);font-size:13px;font-family:inherit;
}
select{
  width:100%;padding:8px 10px;
  background:var(--vscode-dropdown-background);
  border:1px solid var(--vscode-dropdown-border, transparent);
  border-radius:var(--radius);color:var(--vscode-dropdown-foreground);font-size:13px;font-family:inherit;
  cursor:pointer;
}
input[type=text]:focus, select:focus{outline:1px solid var(--accent)}
.combo{position:relative}
.combo-dropdown{
  display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;
  max-height:240px;overflow-y:auto;z-index:50;
  background:var(--vscode-dropdown-background);
  border:1px solid var(--vscode-focusBorder, var(--vscode-dropdown-border, #555));
  border-radius:var(--radius);
  box-shadow:0 4px 16px rgba(0,0,0,.35);
}
.combo-dropdown.show{display:block}
.combo-item{padding:6px 10px;cursor:pointer;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.combo-item:hover,.combo-item.active{background:var(--vscode-list-hoverBackground, rgba(255,255,255,.08))}
.combo-empty{padding:6px 10px;color:var(--vscode-descriptionForeground);font-size:12px}
.loc-row{display:flex;align-items:center;gap:8px}
.loc-row input[type=checkbox]{width:16px;height:16px;cursor:pointer;accent-color:var(--accent)}
.loc-row label{width:auto;text-align:left;cursor:pointer}
.loc-path-row{display:flex;gap:8px;margin-top:10px}
.loc-path-row input{flex:1}
.browse-btn{
  padding:8px 14px;
  background:var(--vscode-button-secondaryBackground);
  border:1px solid var(--vscode-button-border, transparent);
  border-radius:var(--radius);
  color:var(--vscode-button-secondaryForeground);cursor:pointer;white-space:nowrap;
}
.browse-btn:hover{background:var(--vscode-button-secondaryHoverBackground)}
.error-msg{
  display:none;
  background:var(--vscode-inputValidation-errorBackground);
  border:1px solid var(--vscode-inputValidation-errorBorder);
  color:var(--vscode-foreground);
  padding:8px 12px;border-radius:var(--radius);margin-bottom:14px;font-size:12px;
}
.error-msg.show{display:block}
.card-footer{
  display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;
  border-top:1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, transparent));
}
.btn{
  padding:8px 18px;border-radius:var(--radius);border:1px solid var(--vscode-button-border, transparent);
  background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);
  cursor:pointer;font-size:13px;font-weight:500;
}
.btn:hover{background:var(--vscode-button-secondaryHoverBackground)}
.btn.primary{background:var(--accent);color:#fff}
.btn.primary:hover{background:var(--accent-hover)}
</style>
</head>
<body>
<div class="card">
  <div class="card-header">
    <h2>Project Wizard</h2>
    <button class="close-btn" onclick="send('cancel')">&#10005;</button>
  </div>
  <div class="card-body">
    <div class="desc">
      This wizard allows you to <b>create a new</b> PICPIO project for a PIC microcontroller.
      Choose a name, board, framework, programmer, and a location for the project.
    </div>

    <div class="error-msg" id="errMsg"></div>

    <div class="field">
      <label for="name">Name</label>
      <div class="field-control">
        <input type="text" id="name" placeholder="Project name" autofocus>
      </div>
    </div>

    <div class="field">
      <label for="mcu">Board</label>
      <div class="field-control">
        <div class="combo" id="mcuCombo">
          <input type="text" id="mcu" autocomplete="off" placeholder="Type to search boards...">
          <div class="combo-dropdown" id="mcuDropdown"></div>
        </div>
      </div>
    </div>

    <div class="field">
      <label for="framework">Framework</label>
      <div class="field-control">
        <select id="framework">${fwOptions}</select>
      </div>
    </div>

    <div class="field">
      <label for="programmer">Programmer</label>
      <div class="field-control">
        <select id="programmer">${progOptions}</select>
      </div>
    </div>

    <div class="field">
      <label></label>
      <div class="field-control">
        <div class="loc-row">
          <input type="checkbox" id="useDefault" checked onchange="toggleLocation()">
          <label for="useDefault">Use default location</label>
        </div>
        <div class="loc-path-row" id="locRow" style="display:none">
          <input type="text" id="location" value="${defaultLocation.replace(/\\/g, '\\\\')}">
          <button class="browse-btn" onclick="send('browse')">Browse...</button>
        </div>
      </div>
    </div>
  </div>
  <div class="card-footer">
    <button class="btn" onclick="send('cancel')">Cancel</button>
    <button class="btn primary" onclick="finish()">Finish</button>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();

function send(command) { vscode.postMessage({ command }); }

// --- Board combobox: type-to-search, like MPLAB's Family/Device pickers ---
const MCU_LIST = ${mcuListJson};
const mcuInput    = document.getElementById('mcu');
const mcuDropdown = document.getElementById('mcuDropdown');
const mcuCombo    = document.getElementById('mcuCombo');
let selectedMcu   = MCU_LIST[0].label;
let mcuFiltered   = MCU_LIST;
let mcuActiveIndex = -1;
mcuInput.value = selectedMcu;

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function renderMcuDropdown(filter) {
  const f = (filter || '').trim().toLowerCase();
  mcuFiltered = f ? MCU_LIST.filter(m => (m.label + ' ' + m.description).toLowerCase().includes(f)) : MCU_LIST;
  mcuActiveIndex = -1;
  mcuDropdown.innerHTML = mcuFiltered.length
    ? mcuFiltered.map((m, i) => \`<div class="combo-item" data-index="\${i}">\${escHtml(m.label)} — \${escHtml(m.description)}</div>\`).join('')
    : '<div class="combo-empty">No matching boards</div>';
}

function highlightMcu(i) {
  const items = mcuDropdown.querySelectorAll('.combo-item');
  items.forEach(el => el.classList.remove('active'));
  if (items[i]) { items[i].classList.add('active'); items[i].scrollIntoView({ block: 'nearest' }); }
  mcuActiveIndex = i;
}

function selectMcu(label) {
  selectedMcu = label;
  mcuInput.value = label;
  mcuDropdown.classList.remove('show');
}

mcuInput.addEventListener('focus', () => {
  renderMcuDropdown('');
  mcuDropdown.classList.add('show');
  mcuInput.select();
});

mcuInput.addEventListener('input', () => {
  renderMcuDropdown(mcuInput.value);
  mcuDropdown.classList.add('show');
});

mcuInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!mcuDropdown.classList.contains('show')) { renderMcuDropdown(mcuInput.value); mcuDropdown.classList.add('show'); }
    highlightMcu(Math.min(mcuActiveIndex + 1, mcuFiltered.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlightMcu(Math.max(mcuActiveIndex - 1, 0));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (mcuActiveIndex >= 0 && mcuFiltered[mcuActiveIndex]) {
      selectMcu(mcuFiltered[mcuActiveIndex].label);
    } else {
      const match = MCU_LIST.find(m => m.label.toLowerCase() === mcuInput.value.trim().toLowerCase());
      if (match) selectMcu(match.label);
    }
  } else if (e.key === 'Escape') {
    mcuDropdown.classList.remove('show');
  }
});

mcuDropdown.addEventListener('mousedown', e => {
  const item = e.target.closest('.combo-item');
  if (!item) return;
  e.preventDefault();
  selectMcu(mcuFiltered[Number(item.dataset.index)].label);
});

document.addEventListener('click', e => {
  if (mcuCombo.contains(e.target)) return;
  mcuDropdown.classList.remove('show');
  const match = MCU_LIST.find(m => m.label.toLowerCase() === mcuInput.value.trim().toLowerCase());
  selectMcu(match ? match.label : selectedMcu);
});

function toggleLocation() {
  const useDefault = document.getElementById('useDefault').checked;
  document.getElementById('locRow').style.display = useDefault ? 'none' : 'flex';
}

function showError(message) {
  const el = document.getElementById('errMsg');
  el.textContent = message;
  el.classList.add('show');
}

function finish() {
  document.getElementById('errMsg').classList.remove('show');
  vscode.postMessage({
    command:    'create',
    name:       document.getElementById('name').value,
    mcu:        selectedMcu,
    framework:  document.getElementById('framework').value,
    programmer: document.getElementById('programmer').value,
    useDefault: document.getElementById('useDefault').checked,
    location:   document.getElementById('location').value,
  });
}

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.command === 'error') showError(msg.message);
  if (msg.command === 'locationPicked') document.getElementById('location').value = msg.path;
});
</script>
</body>
</html>`;
    }
}
