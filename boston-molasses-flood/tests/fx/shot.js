const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  const reqs = [];
  p.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) reqs.push(r.url()); });
  await p.goto('file://' + path.resolve(__dirname, '../../src/shared/fx/demo.html') + '?t=5.3');
  await p.screenshot({ path: path.join(__dirname, 'still.png') });
  console.log('external requests:', reqs.length);
  await b.close();
})();
