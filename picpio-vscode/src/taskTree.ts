import * as vscode from 'vscode';
import { readConfig, isPicpioFramework } from './iniParser';

// ── Node types ────────────────────────────────────────────────────────────────
export class EnvNode extends vscode.TreeItem {
    constructor(label: string, fw: string) {
        super(`env: ${label}`, vscode.TreeItemCollapsibleState.Expanded);
        this.description  = fw;
        this.iconPath     = new vscode.ThemeIcon('chip');
        this.contextValue = 'env';
        this.tooltip      = `Environment: ${label}`;
    }
}

export class GroupNode extends vscode.TreeItem {
    constructor(label: string, public children: (TaskNode | PeripheralNode)[]) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'group';
        this.iconPath     = new vscode.ThemeIcon('folder');
    }
}

export class TaskNode extends vscode.TreeItem {
    constructor(
        label:     string,
        public cmd: string,
        icon:      string,
        desc?:     string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'task';
        this.iconPath     = new vscode.ThemeIcon(icon);
        if (desc) this.description = desc;
        this.command = { command: 'picpio.runTask', title: label, arguments: [cmd] };
    }
}

export class PeripheralNode extends vscode.TreeItem {
    constructor(label: string, kind: string, icon: string, desc?: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'peripheral';
        this.iconPath     = new vscode.ThemeIcon(icon);
        if (desc) this.description = desc;
        this.command = { command: 'picpio.insertPeripheral', title: label, arguments: [kind, 0] };
    }
}

type Node = EnvNode | GroupNode | TaskNode | PeripheralNode;

// ── Provider ──────────────────────────────────────────────────────────────────
export class TaskTreeProvider implements vscode.TreeDataProvider<Node> {
    private _onChange = new vscode.EventEmitter<Node | undefined>();
    readonly onDidChangeTreeData = this._onChange.event;

    refresh(): void { this._onChange.fire(undefined); }
    getTreeItem(el: Node) { return el; }

    getChildren(el?: Node): Node[] {
        const cfg = readConfig();
        const mcu = cfg?.mcu ?? '?';
        const fw  = cfg?.framework ?? 'bare-metal';

        // Top level → one environment node (like PlatformIO's "env: uno")
        if (!el) {
            return [new EnvNode(mcu, fw)];
        }

        // Inside the environment node → tasks + Advanced group + Miscellaneous group
        if (el instanceof EnvNode) {
            const advanced = new GroupNode('Advanced', [
                new TaskNode('Verbose Build',  'build -v',     'list-tree'),
                new TaskNode('Verbose Upload', 'upload -v',    'list-tree'),
                new TaskNode('Size Report',    'build --size', 'graph'),
                new TaskNode('Erase Flash',    'erase',        'warning'),
                new TaskNode('Check Programmer', 'devices',    'plug'),
            ]);

            const misc = new GroupNode('Miscellaneous', [
                new TaskNode('PICPIO Core CLI', '_cli', 'terminal'),
                new TaskNode('Generate VSCode Config', 'vscode', 'gear'),
            ]);

            const children: Node[] = [
                new TaskNode('Build',              'build',    'check',       'Ctrl+Alt+B'),
                new TaskNode('Upload',             'upload',   'arrow-right', 'Ctrl+Alt+U'),
                new TaskNode('Upload and Monitor', 'build -u', 'arrow-up'),
                new TaskNode('Monitor',            'monitor',  'plug',        'Ctrl+Alt+S'),
                new TaskNode('Clean',              'clean',    'trash'),
            ];

            if (isPicpioFramework(fw)) {
                children.push(new GroupNode('Peripherals', [
                    new PeripheralNode('+ SPI',   'spi',   'circuit-board'),
                    new PeripheralNode('+ USART', 'usart', 'radio-tower'),
                    new PeripheralNode('+ I2C',   'i2c',   'sync'),
                    new PeripheralNode('+ PWM',   'pwm',   'zap'),
                ]));
                children.push(new TaskNode('Simulate', '_simulate', 'pulse'));
            }

            children.push(advanced, misc);
            return children;
        }

        // Inside a group → its children
        if (el instanceof GroupNode) return el.children;

        return [];
    }
}

// ── Quick Access provider (separate panel, like PlatformIO) ───────────────────
export class QuickAccessProvider implements vscode.TreeDataProvider<TaskNode | PeripheralNode | GroupNode> {
    getTreeItem(el: TaskNode | PeripheralNode | GroupNode) { return el; }

    getChildren(el?: TaskNode | PeripheralNode | GroupNode): (TaskNode | PeripheralNode | GroupNode)[] {
        if (el instanceof GroupNode) return el.children;
        if (el) return [];

        const misc = new GroupNode('Miscellaneous', [
            new TaskNode('PICPIO Core CLI', '_cli', 'terminal'),
            new TaskNode('Check Programmer', 'devices', 'plug'),
        ]);

        return [
            new TaskNode('PICPIO Home',    '_home',    'home'),
            new TaskNode('New Project',    '_new',     'new-folder'),
            new TaskNode('Open Project',   '_open',    'folder-opened'),
            new TaskNode('Library Manager','_libs',    'library'),
            misc,
        ];
    }
}
