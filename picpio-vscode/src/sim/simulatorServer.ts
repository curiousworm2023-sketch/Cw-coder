// Tiny local HTTP server that mirrors the Simulator webview panel as a plain
// web page, so the circuit can be opened/used in a real browser tab. Talks to
// the page via Server-Sent Events (worker -> browser) and POST /cmd
// (browser -> extension), using the same message shapes as the webview's
// postMessage protocol.
import * as http from 'http';
import * as vscode from 'vscode';

export class SimulatorServer {
    private _server: http.Server | undefined;
    private _clients: http.ServerResponse[] = [];
    private _port = 0;
    private readonly _htmlProvider: () => string;

    private _onCommand = new vscode.EventEmitter<Record<string, unknown>>();
    readonly onCommand = this._onCommand.event;

    constructor(htmlProvider: () => string) {
        this._htmlProvider = htmlProvider;
    }

    /** Starts listening (idempotent) and resolves with the local port. */
    start(): Promise<number> {
        if (this._server) return Promise.resolve(this._port);
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => this._handle(req, res));
            server.on('error', reject);
            server.listen(0, '127.0.0.1', () => {
                const addr = server.address();
                this._port = typeof addr === 'object' && addr ? addr.port : 0;
                this._server = server;
                resolve(this._port);
            });
        });
    }

    stop(): void {
        for (const c of this._clients) { try { c.end(); } catch { /* ignore */ } }
        this._clients = [];
        this._server?.close();
        this._server = undefined;
        this._port = 0;
    }

    /** Push a JSON event to every connected browser tab. */
    broadcast(ev: Record<string, unknown>): void {
        if (!this._clients.length) return;
        const data = `data: ${JSON.stringify(ev)}\n\n`;
        for (const c of this._clients) { try { c.write(data); } catch { /* ignore */ } }
    }

    private _handle(req: http.IncomingMessage, res: http.ServerResponse): void {
        // Match on the pathname only, so a query string (e.g. "/?session=abc")
        // still routes to "/" — browsers append one when opened via openExternal.
        const url = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;

        if (url === '/' && req.method === 'GET') {
            const body = this._htmlProvider();
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(body);
            return;
        }

        if (url === '/events' && req.method === 'GET') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            res.write(': connected\n\n');
            this._clients.push(res);
            req.on('close', () => {
                this._clients = this._clients.filter(c => c !== res);
            });
            return;
        }

        if (url === '/cmd' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const msg = JSON.parse(body || '{}');
                    this._onCommand.fire(msg);
                } catch { /* ignore malformed body */ }
                res.writeHead(204);
                res.end();
            });
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
}
