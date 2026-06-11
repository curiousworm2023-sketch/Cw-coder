import * as vscode from 'vscode';

let _terminal: vscode.Terminal | undefined;

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
