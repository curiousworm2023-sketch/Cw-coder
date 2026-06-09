import * as vscode from 'vscode';
import { HomePanel }        from './homePanel';
import { createStatusBar }  from './statusBar';
import { TaskTreeProvider, QuickAccessProvider } from './taskTree';
import { ProjectProvider, LibrariesProvider }    from './projectTree';
import { picpio, getTerminal }  from './terminal';
import { newProjectWizard }     from './newProject';
import { openSerialMonitor }    from './serialMonitor';

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
        const pick = await vscode.window.showQuickPick(tasks, {
            title:       'PICPIO — Run Task',
            placeHolder: 'Select a task to run…',
        });
        if (pick) pick.action();
    });
    reg('picpio.newProject',    () => newProjectWizard());
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

    // ── Auto-open Home on project load ────────────────────────────────────────
    const fsm  = require('fs')   as typeof import('fs');
    const pm   = require('path') as typeof import('path');
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (root && fsm.existsSync(pm.join(root, 'picpio.ini'))) {
        HomePanel.createOrShow(context);
    }

    vscode.commands.executeCommand('setContext', 'picpio.isActive', true);
    vscode.window.setStatusBarMessage('$(chip) PICPIO ready', 3000);
}

export function deactivate(): void {}
