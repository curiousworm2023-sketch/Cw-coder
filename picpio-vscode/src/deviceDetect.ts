import { exec } from 'child_process';

// Microchip's USB vendor ID is 04D8. Known product IDs identify which tool
// (PICkit/ICD/Snap) is plugged in; unrecognized 04D8 devices still show up
// so the user knows *something* Microchip-branded is connected.
const MICROCHIP_PID_NAMES: Record<string, string> = {
    '900A': 'PICkit 3',
    '9006': 'PICkit 3 (bootloader mode)',
    '9012': 'PICkit 4',
    '9018': 'PICkit 4 (bootloader mode)',
    '9026': 'PICkit 5',
    '9007': 'MPLAB ICD 3',
    '9011': 'MPLAB ICD 4',
    '9024': 'MPLAB Snap',
};

export interface ProgrammerDevice {
    name: string;
    pid:  string | null;
}

// Queries Windows PnP devices directly via powershell.exe -- avoids depending
// on the picpio CLI being resolvable on PATH from the VS Code process (PATH
// changes made by install.ps1 don't apply to an already-running VS Code).
export function detectProgrammers(): Promise<ProgrammerDevice[]> {
    return new Promise(resolve => {
        const ps = "Get-PnpDevice | Where-Object { $_.InstanceId -match 'VID_04D8' -and $_.Status -eq 'OK' } | Select-Object -Property FriendlyName,InstanceId | ConvertTo-Json -Compress";
        exec(`powershell -NoProfile -Command "${ps}"`, { timeout: 5000 }, (err, stdout) => {
            if (err || !stdout || !stdout.trim()) { resolve([]); return; }

            let raw: any;
            try { raw = JSON.parse(stdout.trim()); } catch { resolve([]); return; }
            const list: any[] = Array.isArray(raw) ? raw : [raw];

            const devices: ProgrammerDevice[] = list.map(d => {
                const m = /PID_([0-9A-Fa-f]{4})/.exec(d.InstanceId || '');
                const pid = m ? m[1].toUpperCase() : null;
                return {
                    name: (pid && MICROCHIP_PID_NAMES[pid]) || d.FriendlyName || 'Unknown Microchip device',
                    pid,
                };
            });

            // A single physical tool often shows up as multiple PnP entries
            // (composite USB device + HID interface) -- dedupe by PID.
            const seen = new Set<string>();
            resolve(devices.filter(d => {
                const key = d.pid || d.name;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }));
        });
    });
}
