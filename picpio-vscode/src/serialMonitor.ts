import * as vscode from 'vscode';
import * as cp      from 'child_process';
import { runRaw }     from './terminal';
import { readConfig } from './iniParser';

function getAvailablePorts(): string[] {
    try {
        const out = cp.execSync(
            'powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object"',
            { timeout: 5000 }
        ).toString().trim();
        return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } catch {
        return [];
    }
}

export async function openSerialMonitor(): Promise<void> {
    // picpio.ini is the source of truth for defaults
    const iniCfg     = readConfig();
    const defaultPort = iniCfg?.monitor_port ?? 'COM3';
    const defaultBaud = iniCfg?.monitor_baud ?? '9600';

    // Try Microsoft Serial Monitor extension first
    const msSerial = vscode.extensions.getExtension('ms-vscode.vscode-serial-monitor');
    if (msSerial) {
        if (!msSerial.isActive) await msSerial.activate();
        await vscode.commands.executeCommand('serialMonitor.startMonitoring');
        return;
    }

    // Scan real available ports
    const available = getAvailablePorts();
    if (available.length === 0) {
        vscode.window.showErrorMessage(
            'No serial ports found. Connect your device and try again.',
            'Retry'
        ).then(choice => { if (choice === 'Retry') openSerialMonitor(); });
        return;
    }

    // Build QuickPick items — put ini default at top if it exists in the list
    const items: vscode.QuickPickItem[] = available.map(p => ({
        label:       p,
        description: p === defaultPort ? '← picpio.ini default' : '',
        picked:      p === defaultPort,
    }));
    // If ini port isn't in list, add it as a manual option
    if (!available.includes(defaultPort)) {
        items.unshift({ label: defaultPort, description: '← picpio.ini (not detected)', picked: true });
    }

    const portPick = await vscode.window.showQuickPick(items, {
        title:       'Serial Monitor — Select Port',
        placeHolder: `Available ports (default: ${defaultPort})`,
    });
    if (!portPick) return;
    const chosenPort = portPick.label;

    const BAUDS = ['300','1200','2400','4800','9600','19200','38400','57600','115200','230400'];
    const baudItems: vscode.QuickPickItem[] = BAUDS.map(b => ({
        label:   b,
        picked:  b === defaultBaud,
        description: b === defaultBaud ? '← picpio.ini' : '',
    }));

    const baudPick = await vscode.window.showQuickPick(baudItems, {
        title:       'Serial Monitor — Baud Rate',
        placeHolder: `Current: ${defaultBaud}`,
    });
    if (!baudPick) return;
    const chosenBaud = baudPick.label;

    runRaw(
        `$p=new-object System.IO.Ports.SerialPort '${chosenPort}',${chosenBaud},'None',8,'One'; ` +
        `$p.Open(); Write-Host '--- Serial Monitor: ${chosenPort} @ ${chosenBaud} baud (Ctrl+C to exit) ---'; ` +
        `try { while($true){ $line=$p.ReadLine(); Write-Host $line } } finally { $p.Close() }`
    );
}
