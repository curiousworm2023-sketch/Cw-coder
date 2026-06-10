import * as vscode from 'vscode';
import * as fs   from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { readConfig } from './iniParser';
import { transpileSketch } from './sim/transpile';
import { SimulatorPanel } from './simulatorPanel';

let activeWorker: Worker | undefined;
let activeDisposables: vscode.Disposable[] = [];

function stopWorker(): void {
    if (activeWorker) {
        try { activeWorker.postMessage('stop'); } catch { /* already exiting */ }
        activeWorker.terminate();
        activeWorker = undefined;
    }
}

export function runSimulation(context: vscode.ExtensionContext): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        vscode.window.showErrorMessage('No project folder open.');
        return;
    }

    const cfg = readConfig();
    if (cfg && cfg.framework !== 'arduino') {
        vscode.window.showWarningMessage('PICPIO Simulator currently supports framework = arduino projects only.');
        return;
    }

    const srcDir   = cfg?.src_dir ?? 'src';
    const mainPath = path.join(root, srcDir, 'main.cpp');
    if (!fs.existsSync(mainPath)) {
        vscode.window.showErrorMessage(`${path.join(srcDir, 'main.cpp')} not found.`);
        return;
    }

    // Tear down any previous simulation session before starting a new one.
    stopWorker();
    while (activeDisposables.length) activeDisposables.pop()?.dispose();

    const panel = SimulatorPanel.createOrShow();

    const start = (): void => {
        panel.reset();

        let src: string;
        try {
            src = fs.readFileSync(mainPath, 'utf8');
        } catch (e) {
            panel.post({ t: 'error', phase: 'read', message: e instanceof Error ? e.message : String(e) });
            panel.setStatus('error', 'could not read main.cpp');
            return;
        }

        const { code, warnings } = transpileSketch(src);
        for (const w of warnings) panel.post({ t: 'error', phase: 'transpile', message: w });

        panel.setStatus('running');

        const workerPath = path.join(context.extensionPath, 'out', 'sim', 'simWorker.js');
        const worker = new Worker(workerPath, { workerData: { code } });
        activeWorker = worker;

        worker.on('message', (ev: Record<string, unknown>) => panel.post(ev));
        worker.on('error', (err: Error) => {
            panel.post({ t: 'error', phase: 'worker', message: err.message });
            panel.setStatus('error', 'worker crashed');
        });
        worker.on('exit', () => {
            if (activeWorker === worker) activeWorker = undefined;
        });
    };

    activeDisposables.push(panel.onStop(() => {
        stopWorker();
        panel.setStatus('stopped');
    }));
    activeDisposables.push(panel.onRestart(() => {
        stopWorker();
        start();
    }));

    start();
}
