import * as vscode from 'vscode';
import { readConfig } from './iniParser';

// Exact PlatformIO status bar layout:
// 🏠  ✓ Build  → Upload  🗑 Clean  🔌 Monitor  >_ CLI  |  env:PIC18F27K40
export function createStatusBar(context: vscode.ExtensionContext): void {

    function btn(
        cmd:      string,
        text:     string,
        tip:      string,
        priority: number,
        color?:   string
    ): vscode.StatusBarItem {
        const b   = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
        b.command = cmd;
        b.text    = text;
        b.tooltip = tip;
        if (color) b.color = color;
        b.show();
        context.subscriptions.push(b);
        return b;
    }

    btn('picpio.home',          '$(home)',             'PICPIO Home',              110);
    btn('picpio.build',         '$(check)',            'Build (Ctrl+Alt+B)',       109, '#4EC9B0');
    btn('picpio.upload',        '$(arrow-right)',      'Upload (Ctrl+Alt+U)',      108, '#569CD6');
    btn('picpio.clean',         '$(trash)',            'Clean',                    107);
    btn('picpio.cleanBuild',    '$(debug-restart)',    'Clean Build (Ctrl+Alt+R)', 106, '#C586C0');
    btn('picpio.serialMonitor', '$(plug)',             'Serial Monitor (Ctrl+Alt+S)', 105, '#CE9178');
    btn('picpio.openCli',       '$(terminal)',         'Open CLI Terminal',        104);

    // Environment switcher — shows current MCU name (like "env: uno")
    const envBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 104);
    envBtn.command = 'picpio.home';
    envBtn.show();
    context.subscriptions.push(envBtn);

    function updateEnv() {
        const cfg = readConfig();
        if (cfg) {
            envBtn.text    = `$(circuit-board) env: ${cfg.mcu}`;
            envBtn.tooltip = `${cfg.name} | ${cfg.family} | ${cfg.framework} | ${cfg.programmer}`;
            envBtn.color   = '#DCDCAA';
        } else {
            envBtn.text    = '$(circuit-board) No project';
            envBtn.tooltip = 'Open a PICPIO project folder';
            envBtn.color   = '#666666';
        }
    }

    updateEnv();

    const w = vscode.workspace.createFileSystemWatcher('**/picpio.ini');
    w.onDidChange(updateEnv);
    w.onDidCreate(updateEnv);
    context.subscriptions.push(w);
}
