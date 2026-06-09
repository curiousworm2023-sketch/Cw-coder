import * as vscode from 'vscode';
import * as fs     from 'path';
import * as fssync from 'fs';
import { readConfig, formatClock, listInstalledLibs, libDir } from './iniParser';
import * as path from 'path';

// ── Tree items ────────────────────────────────────────────────────────────────
export class InfoItem extends vscode.TreeItem {
    constructor(label: string, desc: string, icon: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = desc;
        this.iconPath    = new vscode.ThemeIcon(icon);
    }
}

export class LibItem extends vscode.TreeItem {
    constructor(
        public readonly libName: string,
        desc: string,
        collapsed: boolean
    ) {
        super(libName, collapsed
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'installedLib';
        this.description  = desc;
        this.iconPath     = new vscode.ThemeIcon('package');
    }
}

export class FileItem extends vscode.TreeItem {
    constructor(name: string, ext: string) {
        super(name, vscode.TreeItemCollapsibleState.None);
        this.description = ext;
        this.iconPath    = new vscode.ThemeIcon(
            ext === '.h' ? 'symbol-interface' : 'symbol-method'
        );
    }
}

type Node = InfoItem | LibItem | FileItem | vscode.TreeItem;

// ── Project info provider ─────────────────────────────────────────────────────
export class ProjectProvider implements vscode.TreeDataProvider<Node> {
    private _onChange = new vscode.EventEmitter<Node | undefined>();
    readonly onDidChangeTreeData = this._onChange.event;

    refresh(): void { this._onChange.fire(undefined); }
    getTreeItem(el: Node) { return el; }

    getChildren(el?: Node): Node[] {
        if (el) return [];
        const cfg = readConfig();
        if (!cfg) {
            const warn = new vscode.TreeItem('No picpio.ini found');
            warn.iconPath    = new vscode.ThemeIcon('warning');
            warn.description = 'Open a PICPIO project folder';
            return [warn];
        }
        return [
            new InfoItem('MCU',        cfg.mcu,               'chip'),
            new InfoItem('Family',     cfg.family,            'symbol-class'),
            new InfoItem('Clock',      formatClock(cfg.clock_hz), 'dashboard'),
            new InfoItem('Programmer', cfg.programmer,        'plug'),
            new InfoItem('Framework',  cfg.framework,         'symbol-namespace'),
            new InfoItem('Build dir',  cfg.build_dir,         'folder'),
        ];
    }
}

// ── Libraries provider ────────────────────────────────────────────────────────
export class LibrariesProvider implements vscode.TreeDataProvider<Node> {
    private _onChange = new vscode.EventEmitter<Node | undefined>();
    readonly onDidChangeTreeData = this._onChange.event;

    refresh(): void { this._onChange.fire(undefined); }
    getTreeItem(el: Node) { return el; }

    getChildren(el?: Node): Node[] {
        if (el instanceof LibItem) return this._libFiles(el.libName);
        if (el) return [];

        const libs = listInstalledLibs();
        if (!libs.length) {
            const info = new vscode.TreeItem('No libraries installed');
            info.iconPath    = new vscode.ThemeIcon('info');
            info.description = 'Click + to add a library';
            return [info];
        }
        return libs.map(name => {
            const dir   = path.join(libDir()!, name);
            const files = fssync.readdirSync(dir).length;
            return new LibItem(name, `${files} files`, true);
        });
    }

    private _libFiles(name: string): Node[] {
        const dir = path.join(libDir()!, name);
        if (!fssync.existsSync(dir)) return [];
        return fssync.readdirSync(dir).map(f => {
            return new FileItem(f, path.extname(f));
        });
    }
}
