import * as vscode from 'vscode';
import * as cp     from 'child_process';

let _terminal: vscode.Terminal | undefined;
let _channel: vscode.OutputChannel | undefined;

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

function getOutputChannel(): vscode.OutputChannel {
    if (!_channel) _channel = vscode.window.createOutputChannel('PICPIO');
    return _channel;
}

// Runs a picpio command directly (not via the interactive terminal) so the
// extension knows when it starts/finishes -- shows a status-bar spinner +
// progress notification while it runs, with live output in the PICPIO
// output channel. Resolves with the process exit code.
export function runTracked(args: string, title: string): Promise<number> {
    const exe = vscode.workspace.getConfiguration('picpio').get<string>('executablePath', 'picpio');
    const cwd = workspaceRoot();
    const channel = getOutputChannel();
    channel.show(true);
    channel.appendLine(`> ${exe} ${args}`);

    return Promise.resolve(vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `PICPIO: ${title}`,
        cancellable: false,
    }, () => new Promise<number>(resolve => {
        const proc = cp.spawn(`${exe} ${args}`, {
            cwd, shell: true, windowsHide: true,
            env: { ...process.env, FORCE_COLOR: '1' },
        });
        proc.stdout?.on('data', (d: Buffer) => channel.append(d.toString()));
        proc.stderr?.on('data', (d: Buffer) => channel.append(d.toString()));
        proc.on('close', (code: number | null) => {
            channel.appendLine('');
            resolve(code ?? -1);
        });
        proc.on('error', (err: Error) => {
            channel.appendLine(`\n[PICPIO] Failed to run: ${err.message}`);
            resolve(-1);
        });
    })));
}
