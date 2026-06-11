import * as vscode from 'vscode';
import * as fs   from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { readConfig } from './iniParser';
import { transpileSketch } from './sim/transpile';
import { detectComponents } from './sim/detectComponents';
import { SimulatorPanel, renderSimulatorHtml } from './simulatorPanel';
import { SimulatorServer } from './sim/simulatorServer';

let activeWorker: Worker | undefined;
let activeDisposables: vscode.Disposable[] = [];
let server: SimulatorServer | undefined;

/** Stops the simulation worker and the "Open in Browser" server, if running. */
export function disposeSimulator(): void {
    stopWorker();
    server?.stop();
    server = undefined;
}

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
    if (!server) server = new SimulatorServer(renderSimulatorHtml);
    panel.setServer(server);

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

        panel.autoCircuit(detectComponents(src));
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
    activeDisposables.push(panel.onPinInput(({ pin, value }) => {
        activeWorker?.postMessage({ cmd: 'setPin', pin, value });
    }));
    activeDisposables.push(panel.onAnalogInput(({ pin, value }) => {
        activeWorker?.postMessage({ cmd: 'setAnalog', pin, value });
    }));
    activeDisposables.push(panel.onOpenBrowser(() => {
        server?.start().then(port => {
            vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${port}/`));
        }).catch(e => {
            vscode.window.showErrorMessage(`Could not start browser server: ${e instanceof Error ? e.message : String(e)}`);
        });
    }));

    start();
}
