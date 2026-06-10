import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import * as cp     from 'child_process';
import { runRaw }  from './terminal';

interface McuChoice {
    label:       string;
    description: string;
    family:      string;
    clock:       string;
}

const MCU_LIST: McuChoice[] = [
    { label:'PIC18F27K40',      description:'128KB / 64MHz / 3.7KB SRAM — recommended', family:'PIC18', clock:'64000000'  },
    { label:'PIC18F4550',       description:'32KB / 48MHz / USB 2.0',                   family:'PIC18', clock:'48000000'  },
    { label:'PIC18F452',        description:'32KB / 40MHz / SPI + I2C',                 family:'PIC18', clock:'40000000'  },
    { label:'PIC18F2550',       description:'32KB / 48MHz / USB + ADC',                 family:'PIC18', clock:'48000000'  },
    { label:'PIC16F877A',       description:'14KB / 20MHz / classic PIC16',             family:'PIC16', clock:'20000000'  },
    { label:'PIC16F628A',       description:'2KB / 20MHz / tiny PIC16',                 family:'PIC16', clock:'20000000'  },
    { label:'PIC16F1829',       description:'7KB / 32MHz / MSSP + CCP',                 family:'PIC16', clock:'32000000'  },
    { label:'PIC24FJ128GA010',  description:'128KB / 32MHz / 16-bit PIC24',             family:'PIC24', clock:'32000000'  },
    { label:'dsPIC33EP512MU810',description:'512KB / 140MHz / DSP + FPU',               family:'dsPIC', clock:'140000000' },
    { label:'PIC32MX360F512L',  description:'512KB / 80MHz / 32-bit MIPS',              family:'PIC32', clock:'80000000'  },
    { label:'PIC32MZ2048EFH144',description:'2MB / 200MHz / MIPS M-Class + FPU',        family:'PIC32', clock:'200000000' },
];

const PROGRAMMER_LIST = ['PICKit4', 'PICKit5', 'PICKit3', 'ICD4', 'ICD5', 'Snap', 'PKoB'];
const FRAMEWORK_LIST  = [
    { label:'arduino',    description:'Arduino-style API — setup()/loop(), digitalWrite(), Wire, Serial' },
    { label:'bare-metal', description:'Direct XC8/XC16/XC32 register access' },
];

// Returns true if picpio.exe can be found
function isPicpioInstalled(): boolean {
    const exe = vscode.workspace.getConfiguration('picpio').get<string>('executablePath', 'picpio');
    try {
        cp.execSync(`${exe} --version`, { timeout: 3000, stdio: 'ignore' });
        return true;
    } catch {
        // also check common install paths
        const fallbacks = [
            'C:\\Program Files\\PICPIO\\picpio.exe',
            'C:\\PICPIO\\picpio.exe',
        ];
        for (const p of fallbacks) {
            if (fs.existsSync(p)) return true;
        }
        return false;
    }
}

// Creates the project folder and picpio.ini manually (no picpio.exe needed)
function scaffoldProject(opts: {
    projectDir: string;
    name:       string;
    mcu:        string;
    family:     string;
    clock:      string;
    programmer: string;
    framework:  string;
}): void {
    const { projectDir, name, mcu, family, clock, programmer, framework } = opts;

    fs.mkdirSync(projectDir,                           { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'src'),         { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'include'),     { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'lib'),         { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'test'),        { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.vscode'),     { recursive: true });

    fs.writeFileSync(path.join(projectDir, 'include', 'README'),
        'This directory is intended for project header files.\n');
    fs.writeFileSync(path.join(projectDir, 'test', 'README'),
        'This directory is intended for project tests.\n');
    fs.writeFileSync(path.join(projectDir, '.gitignore'),
        '.picpio/\n*.hex\n*.elf\n*.map\n*.lst\n');

    // picpio.ini
    fs.writeFileSync(path.join(projectDir, 'picpio.ini'), [
        '[project]',
        `name       = ${name}`,
        `mcu        = ${mcu}`,
        `family     = ${family}`,
        `clock_hz   = ${clock}`,
        `framework  = ${framework}`,
        '',
        '[build]',
        `src_dir    = src`,
        `build_dir  = .picpio`,
        `opt_level  = 2`,
        '',
        '[upload]',
        `programmer = ${programmer}`,
        '',
        '[env]',
        `monitor_port = COM3`,
        `monitor_baud = 9600`,
        '',
        '[libraries]',
        `installed      =`,
        `lib_extra_dirs =`,
    ].join('\n'));

    // Starter main file
    if (framework === 'arduino') {
        fs.writeFileSync(path.join(projectDir, 'src', 'main.cpp'), [
            '#include <Arduino.h>',
            '',
            'void setup() {',
            '    Serial.begin(115200);',
            `    pinMode(13, OUTPUT);  // LED`,
            '}',
            '',
            'void loop() {',
            '    digitalWrite(13, HIGH);',
            '    delay(500);',
            '    digitalWrite(13, LOW);',
            '    delay(500);',
            '}',
        ].join('\n'));
    } else {
        fs.writeFileSync(path.join(projectDir, 'src', 'main.c'), [
            `#include <xc.h>`,
            '',
            'void main(void) {',
            '    TRISCbits.TRISC0 = 0;  // RC0 as output (LED)',
            '    while(1) {',
            '        LATCbits.LATC0 ^= 1;',
            '        __delay_ms(500);',
            '    }',
            '}',
        ].join('\n'));
    }

    // .vscode/tasks.json
    fs.writeFileSync(path.join(projectDir, '.vscode', 'tasks.json'), JSON.stringify({
        version: '2.0.0',
        tasks: [
            {
                label: 'PICPIO: Build',
                type: 'shell',
                command: 'picpio build',
                group: { kind: 'build', isDefault: true },
                problemMatcher: ['$xc8', '$xc8-2'],
                presentation: { reveal: 'always', panel: 'dedicated' }
            },
            {
                label: 'PICPIO: Upload',
                type: 'shell',
                command: 'picpio upload',
                group: 'test',
                problemMatcher: [],
                presentation: { reveal: 'always', panel: 'dedicated' }
            },
            {
                label: 'PICPIO: Clean',
                type: 'shell',
                command: 'picpio clean',
                group: 'none',
                problemMatcher: []
            }
        ]
    }, null, 2));

    // .vscode/c_cpp_properties.json
    fs.writeFileSync(path.join(projectDir, '.vscode', 'c_cpp_properties.json'), JSON.stringify({
        configurations: [{
            name: 'PIC',
            includePath: [
                '${workspaceFolder}/src',
                '${workspaceFolder}/include',
                '${workspaceFolder}/lib/**',
                'C:/Program Files/Microchip/xc8/v3.10/pic/include',
                'C:/Program Files/Microchip/xc8/v3.10/pic/include/c99',
                'C:/Program Files/Microchip/xc8/v3.10/pic/include/proc',
                'C:/picpio/packs/PIC18F-K_DFP/xc8/pic/include',
                'C:/picpio/packs/PIC18F-K_DFP/xc8/pic/include/proc',
                'C:/picpio/arduino_compat'
            ],
            defines: [`__${mcu}__`, `_XTAL_FREQ=${clock}`],
            cStandard:   'c99',
            intelliSenseMode: 'gcc-x86'
        }],
        version: 4
    }, null, 2));
}

export async function newProjectWizard(): Promise<void> {
    // Step 1: Project name
    const name = await vscode.window.showInputBox({
        title:         'PICPIO: New Project (1/4) — Project Name',
        prompt:        'Enter a name for your project',
        placeHolder:   'my_project',
        validateInput: v => /^[a-zA-Z0-9_-]+$/.test(v) ? null : 'Only letters, numbers, _ and - allowed',
    });
    if (!name) return;

    // Step 2: MCU
    const mcu = await vscode.window.showQuickPick(
        MCU_LIST.map(m => ({ label: m.label, description: m.description, detail: `Family: ${m.family}`, _data: m })),
        { title: 'PICPIO: New Project (2/4) — Select MCU', matchOnDescription: true, matchOnDetail: true }
    );
    if (!mcu) return;

    // Step 3: Framework
    const fw = await vscode.window.showQuickPick(
        FRAMEWORK_LIST.map(f => ({ label: f.label, description: f.description })),
        { title: 'PICPIO: New Project (3/4) — Framework' }
    );
    if (!fw) return;

    // Step 4: Programmer
    const prog = await vscode.window.showQuickPick(PROGRAMMER_LIST, {
        title: 'PICPIO: New Project (4/4) — Programmer'
    });
    if (!prog) return;

    // Choose location
    const uri = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
        title:            'Choose parent folder for the new project',
    });
    if (!uri?.[0]) return;

    const projectDir = path.join(uri[0].fsPath, name);
    const mcuData    = mcu._data;

    if (isPicpioInstalled()) {
        // picpio.exe is available — let it scaffold the project
        const fwFlag = fw.label === 'arduino' ? '--framework arduino' : '';
        runRaw(
            `picpio init --name ${name} --mcu ${mcu.label} --family ${mcuData.family} ` +
            `--programmer ${prog} --clock ${mcuData.clock} ${fwFlag} --output "${projectDir}"`
        );

        // Poll until folder appears (max 10s)
        await waitForFolder(projectDir, 10000);
    } else {
        // picpio.exe not found — scaffold directly from the extension
        vscode.window.showWarningMessage(
            `picpio.exe not found in PATH — creating project structure directly. ` +
            `Build commands won't work until picpio.exe is installed and added to PATH.`,
            'OK'
        );
        scaffoldProject({
            projectDir,
            name,
            mcu:        mcu.label,
            family:     mcuData.family,
            clock:      mcuData.clock,
            programmer: prog,
            framework:  fw.label,
        });
    }

    if (!fs.existsSync(projectDir)) {
        vscode.window.showErrorMessage(
            `Could not create project at '${projectDir}'. ` +
            `Check that picpio.exe is installed: https://github.com/picpio/picpio`
        );
        return;
    }

    vscode.window.showInformationMessage(`Project '${name}' created at ${projectDir}`);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectDir), false);
}

function waitForFolder(dir: string, timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
        const start    = Date.now();
        const interval = setInterval(() => {
            if (fs.existsSync(dir) || Date.now() - start > timeoutMs) {
                clearInterval(interval);
                resolve();
            }
        }, 300);
    });
}
