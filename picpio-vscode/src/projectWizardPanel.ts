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

        const boardOptions = MCU_LIST.map(m =>
            `<option value="${m.label}">${m.label} — ${m.description}</option>`
        ).join('');

        const fwOptions = FRAMEWORK_LIST.map(f =>
            `<option value="${f.label}">${f.label} — ${f.description}</option>`
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
        <select id="mcu">${boardOptions}</select>
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
    mcu:        document.getElementById('mcu').value,
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
