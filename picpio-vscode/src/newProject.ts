import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import * as cp     from 'child_process';
import { runRaw }  from './terminal';

export interface McuChoice {
    label:       string;
    description: string;
    family:      string;
    clock:       string;
}

export const MCU_LIST: McuChoice[] = [
    { label:'PIC18F27K40',      description:'128KB / 64MHz / 28-pin — recommended',     family:'PIC18', clock:'64000000'  },
    { label:'PIC18F24K40',      description:'16KB / 64MHz / 28-pin',                    family:'PIC18', clock:'64000000'  },
    { label:'PIC18F25K40',      description:'32KB / 64MHz / 28-pin',                    family:'PIC18', clock:'64000000'  },
    { label:'PIC18F26K40',      description:'64KB / 64MHz / 28-pin',                    family:'PIC18', clock:'64000000'  },
    { label:'PIC18F45K40',      description:'32KB / 64MHz / 40-pin, +PORTD/E',          family:'PIC18', clock:'64000000'  },
    { label:'PIC18F46K40',      description:'64KB / 64MHz / 40-pin, +PORTD/E',          family:'PIC18', clock:'64000000'  },
    { label:'PIC18F47K40',      description:'128KB / 64MHz / 40-pin, +PORTD/E',         family:'PIC18', clock:'64000000'  },
    { label:'PIC18F27Q10',      description:'128KB / 64MHz / 28-pin',                   family:'PIC18', clock:'64000000'  },
    { label:'PIC18F26Q10',      description:'64KB / 64MHz / 28-pin',                    family:'PIC18', clock:'64000000'  },
    { label:'PIC18F25Q10',      description:'32KB / 64MHz / 28-pin',                    family:'PIC18', clock:'64000000'  },
    { label:'PIC18F24Q10',      description:'16KB / 64MHz / 28-pin',                    family:'PIC18', clock:'64000000'  },
    { label:'PIC18F47Q10',      description:'128KB / 64MHz / 40-pin, +PORTD/E',         family:'PIC18', clock:'64000000'  },
    { label:'PIC18F46Q10',      description:'64KB / 64MHz / 40-pin, +PORTD/E',          family:'PIC18', clock:'64000000'  },
    { label:'PIC18F45Q10',      description:'32KB / 64MHz / 40-pin, +PORTD/E',          family:'PIC18', clock:'64000000'  },
    { label:'PIC18F4550',     description:'32KB / 48MHz / USB 2.0',                   family:'PIC18', clock:'48000000'  },
    { label:'PIC18F452',        description:'32KB / 40MHz / SPI + I2C',                 family:'PIC18', clock:'40000000'  },
    { label:'PIC18F2550',       description:'32KB / 48MHz / USB + ADC',                 family:'PIC18', clock:'48000000'  },
    { label:'PIC16F877A',       description:'14KB / 20MHz / 40-pin, +PORTD/E',          family:'PIC16', clock:'20000000'  },
    { label:'PIC16F874A',       description:'7KB / 20MHz / 40-pin, +PORTD/E',           family:'PIC16', clock:'20000000'  },
    { label:'PIC16F876A',       description:'14KB / 20MHz / 28-pin classic PIC16',      family:'PIC16', clock:'20000000'  },
    { label:'PIC16F873A',       description:'7KB / 20MHz / 28-pin classic PIC16',       family:'PIC16', clock:'20000000'  },
    { label:'PIC16F628A',       description:'2KB / 20MHz / tiny PIC16',                 family:'PIC16', clock:'20000000'  },
    { label:'PIC16F1829',       description:'7KB / 32MHz / MSSP + CCP',                 family:'PIC16', clock:'32000000'  },
    { label:'PIC16F1827',       description:'7KB / 32MHz / MSSP + CCP, 18-pin',         family:'PIC16', clock:'32000000'  },
    { label:'PIC16F1826',       description:'3.5KB / 32MHz / MSSP + CCP, 18-pin',       family:'PIC16', clock:'32000000'  },
    { label:'PIC16F1825',       description:'7KB / 32MHz / MSSP + CCP, 14-pin, 1KB RAM',family:'PIC16', clock:'32000000'  },
    { label:'PIC16F1824',       description:'7KB / 32MHz / MSSP + CCP, 14-pin',         family:'PIC16', clock:'32000000'  },
    { label:'PIC16F1823',       description:'3.5KB / 32MHz / MSSP + CCP, 14-pin',       family:'PIC16', clock:'32000000'  },
    { label:'PIC24FJ128GA010',  description:'128KB / 16-bit PIC24, UART x2 + SPI + I2C + 5xPWM, 7.3728MHz XT', family:'PIC24', clock:'7372800'  },
    { label:'dsPIC30F4011',     description:'28KB / 30MIPS / 16-bit dsPIC, UART+SPI+I2C+PWM', family:'dsPIC', clock:'7372800' },
    { label:'dsPIC30F2010',     description:'12KB / 30MIPS / 16-bit dsPIC, 28-pin, UART+SPI+I2C+2xPWM', family:'dsPIC', clock:'7372800' },
    { label:'dsPIC33EP512MU810',description:'512KB / 140MHz / DSP + FPU',               family:'dsPIC', clock:'140000000' },
    { label:'PIC32MX360F512L',  description:'512KB / 80MHz / 32-bit MIPS',              family:'PIC32', clock:'80000000'  },
    { label:'PIC32MZ2048EFH144',description:'2MB / 200MHz / MIPS M-Class + FPU',        family:'PIC32', clock:'200000000' },
];

export const PROGRAMMER_LIST = ['PICKit3', 'PICKit4', 'PICKit5', 'ICD4', 'ICD5', 'Snap', 'PKoB'];
export const FRAMEWORK_LIST  = [
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

// Mirrors picpio.js's dfpFamilyFor() for the MCUs in MCU_LIST.
export function dfpFamilyFor(mcu: string): string {
    const u = mcu.toUpperCase();
    if (/DSPIC30F/.test(u)) return ''; // XC16 v2.10 bundles dsPIC30F headers/linker scripts -- no DFP needed
    if (/PIC24FJ/.test(u)) return ''; // XC16 v2.10 bundles PIC24F headers/linker scripts -- no DFP needed
    if (/PIC18F\d+K/.test(u)) return 'PIC18F-K_DFP';
    if (/PIC18F\d+Q10/.test(u)) return 'PIC18F-Q_DFP';
    if (/PIC16F1/.test(u))    return 'PIC12-16F1xxx_DFP';
    if (/PIC16/.test(u))      return 'PIC16Fxxx_DFP';
    return 'PIC18F-K_DFP';
}

// Mirrors picpio.js's halVariantFor() for the MCUs in MCU_LIST.
export function halVariantFor(mcu: string): string {
    const u = mcu.toUpperCase();
    if (/PIC16F1/.test(u)) return 'picpio_compat_pic16f1';
    if (/PIC16/.test(u))   return 'picpio_compat_pic16';
    if (/PIC18F(4550|452|2550)/.test(u)) return 'picpio_compat_pic18_classic';
    if (/DSPIC30F/.test(u)) return 'picpio_compat_pic30f';
    if (/PIC24FJ/.test(u)) return 'picpio_compat_pic24';
    return 'picpio_compat';
}

// Mirrors picpio.js's findXC16() but returns the install root (not the gcc exe path).
function findXC16Root(): string | null {
    const base = 'C:\\Program Files\\Microchip\\xc16';
    if (!fs.existsSync(base)) return null;
    const vers = fs.readdirSync(base)
        .filter(d => d.startsWith('v') && fs.existsSync(path.join(base, d, 'bin', 'xc16-gcc.exe')))
        .sort((a, b) => parseFloat(b.slice(1)) - parseFloat(a.slice(1)));
    return vers.length ? path.join(base, vers[0]) : null;
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
            '#include <Picpio.h>',
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

    // dsPIC/PIC24 use the XC16 toolchain (gcc-based) instead of XC8
    const isXC16 = /^(PIC24|DSPIC)/.test(family.toUpperCase());

    // .vscode/tasks.json
    fs.writeFileSync(path.join(projectDir, '.vscode', 'tasks.json'), JSON.stringify({
        version: '2.0.0',
        tasks: [
            {
                label: 'PICPIO: Build',
                type: 'shell',
                command: 'picpio build',
                group: { kind: 'build', isDefault: true },
                problemMatcher: isXC16 ? ['$gcc'] : ['$xc8', '$xc8-2'],
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
    const dfpFamily = dfpFamilyFor(mcu);
    const acName    = halVariantFor(mcu);
    const dfpIncludes = dfpFamily === 'PIC18F-K_DFP' ? [
        'C:/picpio/packs/PIC18F-K_DFP/xc8/pic/include',
        'C:/picpio/packs/PIC18F-K_DFP/xc8/pic/include/proc',
    ] : dfpFamily === 'PIC18F-Q_DFP' ? [
        'C:/picpio/packs/PIC18F-Q_DFP/xc8/pic/include',
        'C:/picpio/packs/PIC18F-Q_DFP/xc8/pic/include/proc',
    ] : [];

    // XC16 (PIC24/dsPIC) bundles device headers under <install>/support/<family>/h
    const xc16Root = findXC16Root();
    const xc16Includes = xc16Root ? [
        path.join(xc16Root, 'include').replace(/\\/g, '/'),
        path.join(xc16Root, 'support', 'dsPIC30F', 'h').replace(/\\/g, '/'),
        path.join(xc16Root, 'support', 'PIC24F', 'h').replace(/\\/g, '/'),
    ] : [];

    fs.writeFileSync(path.join(projectDir, '.vscode', 'c_cpp_properties.json'), JSON.stringify({
        configurations: [{
            name: 'PIC',
            includePath: [
                '${workspaceFolder}/src',
                '${workspaceFolder}/include',
                '${workspaceFolder}/lib/**',
                ...(isXC16 ? xc16Includes : [
                    'C:/Program Files/Microchip/xc8/v3.10/pic/include',
                    'C:/Program Files/Microchip/xc8/v3.10/pic/include/c99',
                    'C:/Program Files/Microchip/xc8/v3.10/pic/include/proc',
                ]),
                ...dfpIncludes,
                `C:/picpio/${acName}`
            ],
            defines: [`__${mcu}__`, `_XTAL_FREQ=${clock}`],
            cStandard:   'c99',
            intelliSenseMode: 'gcc-x86'
        }],
        version: 4
    }, null, 2));
}

export interface CreateProjectOptions {
    name:       string;
    mcu:        string;
    framework:  string;
    programmer: string;
    projectDir: string;
}

export interface CreateProjectResult {
    ok:         boolean;
    error?:     string;
    projectDir: string;
}

// Creates a project from wizard input, returns ok/error instead of showing UI
export async function createProject(opts: CreateProjectOptions): Promise<CreateProjectResult> {
    const { name, mcu, framework, programmer, projectDir } = opts;

    const mcuData = MCU_LIST.find(m => m.label === mcu);
    if (!mcuData) return { ok: false, error: `Unknown MCU '${mcu}'`, projectDir };

    if (fs.existsSync(projectDir)) {
        return { ok: false, error: `Folder already exists: ${projectDir}`, projectDir };
    }

    if (isPicpioInstalled()) {
        // picpio.exe is available — let it scaffold the project
        const fwFlag = framework === 'arduino' ? '--framework arduino' : '';
        runRaw(
            `picpio init --name ${name} --mcu ${mcu} --family ${mcuData.family} ` +
            `--programmer ${programmer} --clock ${mcuData.clock} ${fwFlag} --output "${projectDir}"`
        );

        // Poll until folder appears (max 10s)
        await waitForFolder(projectDir, 10000);
    } else {
        // picpio.exe not found — scaffold directly from the extension
        scaffoldProject({
            projectDir,
            name,
            mcu,
            family:     mcuData.family,
            clock:      mcuData.clock,
            programmer,
            framework,
        });
    }

    if (!fs.existsSync(projectDir)) {
        return {
            ok: false,
            error: `Could not create project at '${projectDir}'. Check that picpio.exe is installed.`,
            projectDir,
        };
    }

    return { ok: true, projectDir };
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
