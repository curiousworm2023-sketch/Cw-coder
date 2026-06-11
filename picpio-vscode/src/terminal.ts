import * as vscode from 'vscode';
import * as cp     from 'child_process';

let _terminal: vscode.Terminal | undefined;
let _spinner: vscode.WebviewPanel | undefined;

export function getTerminal(): vscode.Terminal {
    if (!_terminal || _terminal.exitStatus !== undefined) {
        _terminal = vscode.window.createTerminal({
            name: 'PICPIO',
            iconPath: new vscode.ThemeIcon('circuit-board'),
        });
    }
    return _terminal;
}

export function picpio(args: string): void {
    const exe = vscode.workspace.getConfiguration('picpio').get<string>('executablePath', 'picpio');
    const t   = getTerminal();
    t.show(true);
    t.sendText(`${exe} ${args}`, true);
}

export function runRaw(cmd: string): void {
    const t = getTerminal();
    t.show(true);
    t.sendText(cmd, true);
}

export function workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// The extension host's process.env.PATH is a snapshot taken when VS Code
// started, so it can miss directories (nodejs, the picpio CLI, etc.) added
// to the user's PATH afterwards. Read the registry-persisted PATH once and
// merge in anything missing for spawned processes.
let cachedRegistryPath: string | undefined;

function getRegistryPath(): string {
    if (cachedRegistryPath !== undefined) return cachedRegistryPath;
    cachedRegistryPath = '';
    if (process.platform === 'win32') {
        try {
            cachedRegistryPath = cp.execFileSync('powershell.exe', [
                '-NoProfile', '-Command',
                "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
            ], { encoding: 'utf8' }).trim();
        } catch { /* best-effort */ }
    }
    return cachedRegistryPath;
}

function spawnEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '1' };
    const current = new Set((env.PATH ?? '').split(';').map(p => p.toLowerCase()));
    const extra = getRegistryPath().split(';').map(p => p.trim()).filter(p => p && !current.has(p.toLowerCase()));
    if (extra.length) env.PATH = [env.PATH, ...extra].filter(Boolean).join(';');
    return env;
}

function showSpinner(title: string): void {
    _spinner = vscode.window.createWebviewPanel(
        'picpioSpinner', 'PICPIO', { viewColumn: vscode.ViewColumn.Active, preserveFocus: true }, {}
    );
    _spinner.webview.html = `<!DOCTYPE html><html><body>
<style>
  body { display:flex; flex-direction:column; align-items:center; justify-content:center;
         height:100vh; margin:0; font-family:var(--vscode-font-family);
         background:var(--vscode-editor-background); color:var(--vscode-editor-foreground); }
  .spinner { width:60px; height:60px; border:6px solid rgba(242,127,12,0.25);
             border-top-color:#F27F0C; border-radius:50%; animation:spin 1s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .label { margin-top:16px; font-size:14px; }
</style>
<div class="spinner"></div>
<div class="label">${title}…</div>
</body></html>`;
    _spinner.onDidDispose(() => { _spinner = undefined; });
}

function hideSpinner(): void {
    _spinner?.dispose();
    _spinner = undefined;
}

// Runs a picpio command directly (not via the interactive terminal) so the
// extension knows when it starts/finishes -- shows an orange spinner while it
// runs, with live output in a terminal (via a Pseudoterminal) so ANSI colors
// render the same as a normal shell.
export function runTracked(args: string, title: string): Promise<number> {
    const exe = vscode.workspace.getConfiguration('picpio').get<string>('executablePath', 'picpio');
    const cwd = workspaceRoot();
    showSpinner(title);

    return new Promise<number>(resolve => {
        const writeEmitter = new vscode.EventEmitter<string>();
        const pty: vscode.Pseudoterminal = {
            onDidWrite: writeEmitter.event,
            // No onDidClose is fired -- the terminal stays open after the
            // process finishes so the user can review its output. Only the
            // spinner goes away.
            onDidClose: new vscode.EventEmitter<number>().event,
            open: () => {
                writeEmitter.fire(`> ${exe} ${args}\r\n`);
                const proc = cp.spawn(`${exe} ${args}`, {
                    cwd, shell: true, windowsHide: true,
                    env: spawnEnv(),
                });
                const onData = (d: Buffer) => writeEmitter.fire(d.toString().replace(/\r?\n/g, '\r\n'));
                proc.stdout?.on('data', onData);
                proc.stderr?.on('data', onData);
                proc.on('close', (code: number | null) => {
                    hideSpinner();
                    resolve(code ?? -1);
                });
                proc.on('error', (err: Error) => {
                    writeEmitter.fire(`\r\n[PICPIO] Failed to run: ${err.message}\r\n`);
                    hideSpinner();
                    resolve(-1);
                });
            },
            close: () => { /* process is detached from the pty lifecycle */ },
        };
        const t = vscode.window.createTerminal({
            name: 'PICPIO',
            iconPath: new vscode.ThemeIcon('circuit-board'),
            pty,
        });
        t.show(true);
    });
}
