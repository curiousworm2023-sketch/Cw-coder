import * as fs   from 'fs';
import * as path  from 'path';
import * as vscode from 'vscode';

export interface ProjectConfig {
    name:         string;
    mcu:          string;
    family:       string;
    clock_hz:     string;
    programmer:   string;
    framework:    string;
    build_dir:    string;
    src_dir:      string;
    monitor_port:   string;
    monitor_baud:   string;
    lib_extra_dirs: string[];
    installed:      string[];
}

export function readConfig(): ProjectConfig | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return undefined;

    const iniPath = path.join(root, 'picpio.ini');
    if (!fs.existsSync(iniPath)) return undefined;

    const text  = fs.readFileSync(iniPath, 'utf8');
    const raw   = parseIni(text);

    const installed = (raw['installed'] ?? '')
        .split(',').map(s => s.trim()).filter(Boolean);

    const lib_extra_dirs = (raw['lib_extra_dirs'] ?? '')
        .split(',').map(s => s.trim()).filter(Boolean);

    return {
        name:           raw['name']         ?? path.basename(root),
        mcu:            raw['mcu']          ?? 'Unknown',
        family:         raw['family']       ?? 'PIC18',
        clock_hz:       raw['clock_hz']     ?? '64000000',
        programmer:     raw['programmer']   ?? 'PICKit4',
        framework:      raw['framework']    ?? 'bare-metal',
        build_dir:      raw['build_dir']    ?? '.build',
        src_dir:        raw['src_dir']      ?? 'src',
        monitor_port:   raw['monitor_port'] ?? 'COM3',
        monitor_baud:   raw['monitor_baud'] ?? '9600',
        lib_extra_dirs,
        installed,
    };
}

function parseIni(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of text.split('\n')) {
        const m = line.match(/^\s*(\w+)\s*=\s*(.+)/);
        if (m) result[m[1].trim()] = m[2].trim();
    }
    return result;
}

// The "picpio" framework selects the PICPIO HAL (vs "bare-metal").
// 'arduino' is accepted as a legacy alias so older picpio.ini files still work.
export function isPicpioFramework(fw: string | undefined): boolean {
    const f = (fw || '').toLowerCase();
    return f === 'picpio' || f === 'arduino';
}

export function formatClock(hz: string): string {
    const n = parseInt(hz || '0');
    if (!n) return '?';
    return n >= 1_000_000 ? `${n / 1_000_000} MHz` : `${n / 1000} kHz`;
}

export function libDir(): string | undefined {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? path.join(root, 'lib') : undefined;
}

export function listInstalledLibs(): string[] {
    const dir = libDir();
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(d => {
        return fs.statSync(path.join(dir, d)).isDirectory();
    });
}
