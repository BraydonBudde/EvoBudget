// Local preview of the site, served the way nginx serves it in production:
// extensionless URLs (/ultimate-budget, /budgetplanner?trial=sbp), .html
// requests redirected to them, and / opening home. Nothing is cached, so a
// refresh always shows the files as they are on disk.
//
//   node deploy/local-preview.js          then open http://localhost:5500
//   PORT=8080 node deploy/local-preview.js
//
// Data you enter here lives in this browser's storage for localhost only,
// separate from the live site.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 5500;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml'
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  if (/\.html$/.test(p)) {
    res.writeHead(301, { Location: p.replace(/\.html$/, '') + url.search });
    return res.end();
  }
  const tries = p === '/' ? [path.join(ROOT, 'home.html')] : [path.join(ROOT, p), path.join(ROOT, p + '.html')];
  for (const fp of tries) {
    // Never serve anything outside the project folder.
    if (!fp.startsWith(ROOT)) break;
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      return fs.createReadStream(fp).pipe(res);
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}).listen(PORT, () => console.log(`Preview running at http://localhost:${PORT}`));
