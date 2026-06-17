import * as vscode from 'vscode';

// Native port-pin names defined by picpio_compat's Picpio.h
// (same mapping for both PIC18F27K40 and PIC16F877A HALs).
const PIN_NAMES: { name: string; detail: string }[] = [
    ...Array.from({ length: 8 }, (_, i) => ({ name: `RC${i}`, detail: `PORTC bit ${i}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ name: `RB${i}`, detail: `PORTB bit ${i}` })),
    ...Array.from({ length: 6 }, (_, i) => ({ name: `RA${i}`, detail: `PORTA bit ${i}` })),
];

// Functions whose first argument is a pin number/name.
const PIN_ARG_FUNCS = /\b(?:pinMode|digitalWrite|digitalRead|analogWrite|analogRead)\s*\(\s*(\w*)$/;

// digitalWrite's second argument is a logic level.
const LEVEL_ARG_FUNC = /\bdigitalWrite\s*\([^,()]*,\s*(\w*)$/;
const LEVEL_NAMES: { name: string; detail: string }[] = [
    { name: 'HIGH', detail: '1' },
    { name: 'LOW',  detail: '0' },
];

// pinMode's second argument is a mode constant.
const MODE_ARG_FUNC = /\bpinMode\s*\([^,()]*,\s*(\w*)$/;
const MODE_NAMES: { name: string; detail: string }[] = [
    { name: 'OUTPUT',       detail: '1' },
    { name: 'INPUT',        detail: '0' },
    { name: 'INPUT_PULLUP', detail: '2' },
];

function items(list: { name: string; detail: string }[]): vscode.CompletionItem[] {
    return list.map(p => {
        const item = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Constant);
        item.detail = p.detail;
        item.sortText = '0' + p.name;
        return item;
    });
}

/** Registers a completion provider for the PICPIO GPIO API:
 * native RAx/RBx/RCx pin names as the first argument of pinMode/digitalWrite/
 * digitalRead/analogRead/analogWrite, HIGH/LOW as digitalWrite's second
 * argument, and OUTPUT/INPUT/INPUT_PULLUP as pinMode's second argument. */
export function registerPinCompletion(context: vscode.ExtensionContext): void {
    const provider = vscode.languages.registerCompletionItemProvider(
        [{ language: 'c' }, { language: 'cpp' }],
        {
            provideCompletionItems(document, position) {
                const line = document.lineAt(position).text.substring(0, position.character);
                if (LEVEL_ARG_FUNC.test(line)) return items(LEVEL_NAMES);
                if (MODE_ARG_FUNC.test(line))  return items(MODE_NAMES);
                if (PIN_ARG_FUNCS.test(line))  return items(PIN_NAMES);
                return undefined;
            },
        },
        '(', ','
    );
    context.subscriptions.push(provider);
}
