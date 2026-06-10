import * as vscode from 'vscode';
import * as fs   from 'fs';
import * as path from 'path';
import { HomePanel }        from './homePanel';
import { createStatusBar }  from './statusBar';
import { TaskTreeProvider, QuickAccessProvider } from './taskTree';
import { ProjectProvider, LibrariesProvider }    from './projectTree';
import { picpio, getTerminal }  from './terminal';
import { ProjectWizardPanel }   from './projectWizardPanel';
import { openSerialMonitor }    from './serialMonitor';
import { insertPeripheralSnippet, SNIPPETS } from './peripheralInsert';
import { readConfig } from './iniParser';

/** Find the highest installed XC8 version under C:/Program Files/Microchip/xc8/ */
function findXC8Version(): string {
    const base = 'C:/Program Files/Microchip/xc8';
    try {
        if (!fs.existsSync(base)) return 'v3.10';
        const versions = fs.readdirSync(base)
            .filter(d => /^v\d/.test(d))
            .sort()
            .reverse();
        return versions[0] ?? 'v3.10';
    } catch { return 'v3.10'; }
}

/** Parse picpio.ini from projectDir and return raw key-value map */
function parseIniRaw(projectDir: string): Record<string, string> {
    const iniPath = path.join(projectDir, 'picpio.ini');
    if (!fs.existsSync(iniPath)) return {};
    const text = fs.readFileSync(iniPath, 'utf8');
    const result: Record<string, string> = {};
    for (const line of text.split('\n')) {
        const m = line.match(/^\s*(\w+)\s*=\s*(.+)/);
        if (m) result[m[1].trim()] = m[2].trim();
    }
    return result;
}

/** Write .vscode/c_cpp_properties.json synchronously so Ctrl+Click works immediately */
function ensureCppProperties(projectDir: string): void {
    const vscodedir = path.join(projectDir, '.vscode');
    const outFile   = path.join(vscodedir, 'c_cpp_properties.json');
    if (fs.existsSync(outFile)) return;  // already present — don't overwrite

    const ini      = parseIniRaw(projectDir);
    const mcu      = ini['mcu']      ?? 'PIC18F27K40';
    const clock    = ini['clock_hz'] ?? '64000000';
    const extras   = (ini['lib_extra_dirs'] ?? '').split(',').map(s => s.trim()).filter(Boolean);

    const xc8ver   = findXC8Version();
    const xc8base  = `C:/Program Files/Microchip/xc8/${xc8ver}`;

    const includePath = [
        '${workspaceFolder}/src',
        '${workspaceFolder}/include',
        '${workspaceFolder}/lib/**',
        `${xc8base}/pic/include`,
        `${xc8base}/pic/include/c99`,
        `${xc8base}/pic/include/proc`,
        'C:/picpio/packs/PIC18F-K_DFP/xc8/pic/include',
        'C:/picpio/packs/PIC18F-K_DFP/xc8/pic/include/proc',
        'C:/picpio/arduino_compat',
        ...extras,
    ];

    const content = {
        configurations: [{
            name:             'PIC',
            includePath,
            defines:          [`__${mcu}__`, `_XTAL_FREQ=${clock}`],
            cStandard:        'c99',
            intelliSenseMode: 'gcc-x86',
        }],
        version: 4,
    };

    try {
        fs.mkdirSync(vscodedir, { recursive: true });
        fs.writeFileSync(outFile, JSON.stringify(content, null, 2));
    } catch { /* non-fatal */ }
}

/** Show a pin-pair QuickPick (if the peripheral has alternates) then insert the snippet */
async function insertPeripheralWithPins(kind: string): Promise<void> {
    const snip = SNIPPETS[kind];
    if (!snip.pinOptions || snip.pinOptions.length <= 1) {
        await insertPeripheralSnippet(kind, 0);
        return;
    }
    const pick = await vscode.window.showQuickPick(
        snip.pinOptions.map((p, i) => ({ label: p.label, idx: i })),
        { title: `${snip.label} — Select pins`, placeHolder: 'Choose pin assignment' }
    );
    if (pick) await insertPeripheralSnippet(kind, pick.idx);
}

export function activate(context: vscode.ExtensionContext): void {

    // ── Tree providers ────────────────────────────────────────────────────────
    const taskProv    = new TaskTreeProvider();
    const quickProv   = new QuickAccessProvider();
    const projectProv = new ProjectProvider();
    const libsProv    = new LibrariesProvider();

    vscode.window.registerTreeDataProvider('picpioTasks',       taskProv);
    vscode.window.registerTreeDataProvider('picpioQuickAccess', quickProv);
    vscode.window.registerTreeDataProvider('picpioProject',     projectProv);
    vscode.window.registerTreeDataProvider('picpioLibraries',   libsProv);

    // ── Status bar ────────────────────────────────────────────────────────────
    createStatusBar(context);

    // ── Helpers ───────────────────────────────────────────────────────────────
    const reg = (id: string, fn: (...args: any[]) => any) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, fn));

    const refreshAll = () => {
        taskProv.refresh();
        projectProv.refresh();
        libsProv.refresh();
        if (HomePanel.current) HomePanel.createOrShow(context);
    };

    // ── Commands ──────────────────────────────────────────────────────────────
    reg('picpio.home',          () => HomePanel.createOrShow(context));
    reg('picpio.build',         () => picpio('build'));
    reg('picpio.upload',        () => picpio('upload'));
    reg('picpio.buildUpload',   () => picpio('build -u'));
    reg('picpio.clean',         () => { picpio('clean'); setTimeout(refreshAll, 800); });
    reg('picpio.cleanBuild',    () => { picpio('clean'); setTimeout(() => picpio('build'), 1200); });
    reg('picpio.serialMonitor', () => openSerialMonitor());
    reg('picpio.libManager',    () => HomePanel.createOrShow(context));

    reg('picpio.taskMenu', async () => {
        type Task = { label: string; description: string; action: () => void };
        const tasks: Task[] = [
            { label: '$(check)          Build',          description: 'Ctrl+Alt+B', action: () => picpio('build') },
            { label: '$(arrow-right)    Upload',         description: 'Ctrl+Alt+U', action: () => picpio('upload') },
            { label: '$(arrow-up)       Upload & Monitor',description: '',          action: () => picpio('build -u') },
            { label: '$(trash)          Clean',          description: '',           action: () => { picpio('clean'); setTimeout(refreshAll, 800); } },
            { label: '$(debug-restart)  Clean Build',    description: 'Ctrl+Alt+R', action: () => { picpio('clean'); setTimeout(() => picpio('build'), 1200); } },
            { label: '$(plug)           Serial Monitor', description: 'Ctrl+Alt+S', action: () => openSerialMonitor() },
            { label: '$(terminal)       Open CLI',       description: '',           action: () => getTerminal().show(false) },
        ];

        if (readConfig()?.framework === 'arduino') {
            tasks.push(
                { label: '$(circuit-board)  + SPI',   description: 'Insert SPI snippet',   action: () => insertPeripheralWithPins('spi') },
                { label: '$(radio-tower)    + USART', description: 'Insert USART snippet', action: () => insertPeripheralWithPins('usart') },
                { label: '$(sync)           + I2C',   description: 'Insert I2C snippet',   action: () => insertPeripheralWithPins('i2c') },
                { label: '$(zap)            + PWM',   description: 'Insert PWM snippet',   action: () => insertPeripheralSnippet('pwm') },
            );
        }

        const pick = await vscode.window.showQuickPick(tasks, {
            title:       'PICPIO — Run Task',
            placeHolder: 'Select a task to run…',
        });
        if (pick) pick.action();
    });
    reg('picpio.newProject',    () => ProjectWizardPanel.createOrShow());
    reg('picpio.insertPeripheral', (kind: string, pinIndex?: number) => insertPeripheralSnippet(kind, pinIndex));
    reg('picpio.refresh',       () => refreshAll());

    // PlatformIO Core CLI — opens a named terminal
    reg('picpio.openCli', () => {
        const t = getTerminal();
        t.show(false);
    });

    reg('picpio.openProject', async () => {
        const uri = await vscode.window.showOpenDialog({
            canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
            title: 'Open PICPIO Project',
        });
        if (uri?.[0]) await vscode.commands.executeCommand('vscode.openFolder', uri[0], false);
    });

    // runTask handles both real picpio commands and special "_xxx" navigation commands
    reg('picpio.runTask', (cmd: string) => {
        if (cmd === '_home')    { HomePanel.createOrShow(context); return; }
        if (cmd === '_new')     { vscode.commands.executeCommand('picpio.newProject'); return; }
        if (cmd === '_open')    { vscode.commands.executeCommand('picpio.openProject'); return; }
        if (cmd === '_libs')    { HomePanel.createOrShow(context); return; }
        if (cmd === '_cli')     { vscode.commands.executeCommand('picpio.openCli'); return; }
        picpio(cmd);
        setTimeout(refreshAll, 1500);
    });

    reg('picpio.libAdd', async () => {
        const name = await vscode.window.showInputBox({
            title:       'PICPIO: Add Library',
            prompt:      'Library name, github:user/repo, or https://url',
            placeHolder: 'e.g.  dht22   or   github:br3ttb/Arduino-PID-Library',
        });
        if (!name) return;
        picpio(`lib add ${name}`);
        setTimeout(refreshAll, 3000);
    });

    reg('picpio.libRemove', async (item: any) => {
        const libName: string = item?.libName ?? item?.label;
        if (!libName) return;
        const ok = await vscode.window.showWarningMessage(
            `Remove library '${libName}'?`, { modal: true }, 'Remove'
        );
        if (ok !== 'Remove') return;
        picpio(`lib remove ${libName}`);
        setTimeout(refreshAll, 1000);
    });

    // ── Watchers ──────────────────────────────────────────────────────────────
    const iniW = vscode.workspace.createFileSystemWatcher('**/picpio.ini');
    iniW.onDidChange(refreshAll); iniW.onDidCreate(refreshAll);
    context.subscriptions.push(iniW);

    const libW = vscode.workspace.createFileSystemWatcher('**/lib/**');
    libW.onDidCreate(refreshAll); libW.onDidDelete(refreshAll);
    context.subscriptions.push(libW);

    // ── Auto-open Home + ensure IntelliSense files on project load ───────────
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (root && fs.existsSync(path.join(root, 'picpio.ini'))) {
        ensureCppProperties(root);
        HomePanel.createOrShow(context);
    }

    vscode.commands.executeCommand('setContext', 'picpio.isActive', true);
    vscode.window.setStatusBarMessage('$(chip) PICPIO ready', 3000);
}

export function deactivate(): void {}
