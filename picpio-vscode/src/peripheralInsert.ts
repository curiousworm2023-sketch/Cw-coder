import * as vscode from 'vscode';
import * as fs     from 'fs';
import * as path   from 'path';
import { readConfig, isPicpioFramework } from './iniParser';

interface PinOption {
    label:      string;
    extraLines: string[];   // extra PPS remap lines appended after begin(), empty = default pins
}

interface PeripheralSnippet {
    label:      string;
    marker:     string;
    beginLines: string[];
    loopLines:  string[];
    pinOptions?: PinOption[];
}

export const SNIPPETS: Record<string, PeripheralSnippet> = {
    usart: {
        label:  'USART',
        marker: '// --- USART (Serial) ---',
        beginLines: ['Serial.begin(9600);'],
        loopLines: [
            '// --- USART (Serial) ---',
            'Serial.println("Hello from PIC!");',
            'delay(1000);',
        ],
        pinOptions: [
            { label: 'RC6 / RC7 (default)', extraLines: [] },
            { label: 'RB7 / RB5',           extraLines: [
                '// Remap USART to TX=RB7, RX=RB5',
                'TRISBbits.TRISB7 = 0;  // TX output',
                'RB7PPS = 0x09;         // TX1 -> RB7',
                'TRISBbits.TRISB5 = 1;  // RX input',
                'RXPPS = 0x0D;          // RB5 -> RX1',
            ] },
            { label: 'RA0 / RA1',           extraLines: [
                '// Remap USART to TX=RA0, RX=RA1',
                'TRISAbits.TRISA0 = 0;  // TX output',
                'RA0PPS = 0x09;         // TX1 -> RA0',
                'TRISAbits.TRISA1 = 1;  // RX input',
                'RXPPS = 0x01;          // RA1 -> RX1',
            ] },
        ],
    },
    i2c: {
        label:  'I2C',
        marker: '// --- I2C (Wire) ---',
        beginLines: ['Wire.begin();'],
        loopLines: [
            '// --- I2C (Wire) ---',
            'Wire.beginTransmission(0x68);',
            'Wire.write(0x00);',
            'Wire.endTransmission();',
            'Wire.requestFrom(0x68, 6);',
            'while (Wire.available()) {',
            '    byte b = Wire.read();',
            '}',
        ],
        pinOptions: [
            { label: 'RC3 / RC4 (default)', extraLines: [] },
            { label: 'RB1 / RB2',           extraLines: [
                '// Remap I2C to SCL=RB1, SDA=RB2',
                'TRISBbits.TRISB1 = 1;  // SCL (open-drain, input)',
                'TRISBbits.TRISB2 = 1;  // SDA (open-drain, input)',
                'RB1PPS = 0x0F;         // SCL1 -> RB1',
                'RB2PPS = 0x10;         // SDA1 -> RB2',
                'SSP1CLKPPS = 0x09;     // RB1 -> SSP1 clock input',
                'SSP1DATPPS = 0x0A;     // RB2 -> SSP1 data input',
            ] },
        ],
    },
    spi: {
        label:  'SPI',
        marker: '// --- SPI ---',
        beginLines: ['SPI.begin();', 'SPI.setDataMode(SPI_MODE0);'],
        loopLines: [
            '// --- SPI ---',
            'uint8_t spiResp = SPI.transfer(0xAA);',
        ],
        pinOptions: [
            { label: 'RC3/RC4/RC5 (default)', extraLines: [] },
            { label: 'RB1/RB2/RB3',            extraLines: [
                '// Remap SPI to SCK=RB1, SDI=RB2, SDO=RB3',
                'TRISBbits.TRISB1 = 0;  // SCK output',
                'TRISBbits.TRISB3 = 0;  // SDO output',
                'TRISBbits.TRISB2 = 1;  // SDI input',
                'RB1PPS = 0x0F;         // SCK1 -> RB1',
                'RB3PPS = 0x10;         // SDO1 -> RB3',
                'SSP1DATPPS = 0x0A;     // RB2 -> SDI1 input',
            ] },
        ],
    },
    pwm: {
        label:  'PWM',
        marker: '// --- PWM ---',
        beginLines: ['pinMode(D5, OUTPUT);'],
        loopLines: [
            '// --- PWM ---',
            'analogWrite(D5, 128);  // 50% duty cycle',
        ],
    },
};

function insertAfterFunctionOpen(text: string, fnName: string, block: string): string {
    const re = new RegExp(`(void\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{\\s*\\n)`);
    const m = text.match(re);
    if (!m || m.index === undefined) return text;
    const idx = m.index + m[0].length;
    return text.slice(0, idx) + block + text.slice(idx);
}

export async function insertPeripheralSnippet(kind: string, pinIndex?: number): Promise<void> {
    const snip = SNIPPETS[kind];
    if (!snip) return;

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        vscode.window.showErrorMessage('No project folder open.');
        return;
    }

    const cfg = readConfig();
    if (cfg && !isPicpioFramework(cfg.framework)) {
        vscode.window.showWarningMessage(`${snip.label} snippets require framework = picpio in picpio.ini`);
        return;
    }

    const srcDir   = cfg?.src_dir ?? 'src';
    const mainPath = path.join(root, srcDir, 'main.cpp');
    if (!fs.existsSync(mainPath)) {
        vscode.window.showErrorMessage(`${path.join(srcDir, 'main.cpp')} not found.`);
        return;
    }

    let text = fs.readFileSync(mainPath, 'utf8');

    if (text.includes(snip.marker)) {
        const doc = await vscode.workspace.openTextDocument(mainPath);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`${snip.label} snippet is already in main.cpp`);
        return;
    }

    if (!/void\s+setup\s*\([^)]*\)\s*\{/.test(text) || !/void\s+loop\s*\([^)]*\)\s*\{/.test(text)) {
        vscode.window.showErrorMessage('main.cpp must contain setup() and loop() functions.');
        return;
    }

    const indent  = '    ';
    const pinOpt  = snip.pinOptions && pinIndex !== undefined ? snip.pinOptions[pinIndex] : undefined;

    const setupLines = [snip.marker, ...snip.beginLines, ...(pinOpt?.extraLines ?? [])];
    const setupBlock = setupLines.map(l => indent + l).join('\n') + '\n';
    const loopBlock  = snip.loopLines.map(l => indent + l).join('\n') + '\n';

    text = insertAfterFunctionOpen(text, 'setup', setupBlock);
    text = insertAfterFunctionOpen(text, 'loop',  loopBlock);

    fs.writeFileSync(mainPath, text);

    const doc      = await vscode.workspace.openTextDocument(mainPath);
    const editor   = await vscode.window.showTextDocument(doc);
    const lineNo   = doc.getText().split('\n').findIndex(l => l.includes(snip.marker));
    if (lineNo >= 0) {
        const pos = new vscode.Position(lineNo, 0);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(pos, pos);
    }

    const pinNote = pinOpt && pinIndex! > 0 ? ` (pins: ${pinOpt.label})` : '';
    vscode.window.showInformationMessage(`${snip.label} snippet inserted into main.cpp${pinNote}`);
}
