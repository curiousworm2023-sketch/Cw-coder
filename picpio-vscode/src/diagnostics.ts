import * as vscode from 'vscode';
import * as path   from 'path';

export class DiagnosticsManager {
    private _collection: vscode.DiagnosticCollection;

    constructor() {
        this._collection = vscode.languages.createDiagnosticCollection('picpio');
    }

    // Parses XC8/XC16/XC32 error output and populates the Problems panel
    parse(output: string, rootDir: string): void {
        this._collection.clear();
        const map = new Map<string, vscode.Diagnostic[]>();

        // Pattern: file.c:12:34: error: message
        const re = /^(.+?):(\d+)(?::(\d+))?:\s+(error|warning|note):\s+(.+)$/gm;
        let m: RegExpExecArray | null;

        while ((m = re.exec(output)) !== null) {
            const [, file, lineStr, colStr, sev, msg] = m;
            const line = Math.max(0, parseInt(lineStr) - 1);
            const col  = colStr ? Math.max(0, parseInt(colStr) - 1) : 0;

            const severity =
                sev === 'error'   ? vscode.DiagnosticSeverity.Error :
                sev === 'warning' ? vscode.DiagnosticSeverity.Warning :
                                    vscode.DiagnosticSeverity.Information;

            const range = new vscode.Range(line, col, line, col + 80);
            const diag  = new vscode.Diagnostic(range, msg, severity);
            diag.source = 'PICPIO';

            const absPath = path.isAbsolute(file) ? file : path.join(rootDir, file);
            const key     = absPath;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(diag);
        }

        for (const [filePath, diags] of map) {
            this._collection.set(vscode.Uri.file(filePath), diags);
        }
    }

    clear(): void { this._collection.clear(); }

    dispose(): void { this._collection.dispose(); }
}
