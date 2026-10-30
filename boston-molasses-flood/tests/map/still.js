// Renders low-res stills of the demo map with Playwright. Usage: node tests/map/still.js
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../../src/shared/map');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const f = path.join(root, req.url.split('?')[0].replace(/^\//, '') || 'demo.html');
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/plain' }); res.end(b); });
});
(async () => {
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  const out = process.argv[2] || 'map-still.png';
  const theme = process.argv[3] || 'paper';
  await p.goto(`http://localhost:${port}/demo.html?t=5&theme=${theme}`);
  await p.waitForSelector('body[data-ready="1"]');
  await p.screenshot({ path: path.join(__dirname, out) });
  await b.close(); srv.close();
  if (errs.length) { console.error(errs); process.exit(1); }
  console.log('ok', out);
})();
