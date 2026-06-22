// Tiny static file server for previewing the PICPIO site locally.
//   node website/preview-server.js   ->   http://localhost:8777
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, 'public');
const PORT = process.env.PORT || 8777;
const TYPES = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
                '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json' };
http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url.endsWith('/')) url += 'index.html';
  let file = path.join(ROOT, url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // cleanUrls: try "<path>.html" before 404 (mirrors Firebase hosting)
      fs.readFile(file + '.html', (e2, d2) => {
        if (e2) { res.writeHead(404); return res.end('404'); }
        res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(d2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`PICPIO site preview: http://localhost:${PORT}`));
