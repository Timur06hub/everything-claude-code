const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 0.25 });
  const errs = []; p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', e => errs.push(String(e)));
  await p.goto('file://' + path.join(__dirname, 'demo.html') + '?t=2.5');
  await p.evaluate(() => document.fonts.ready);
  // determinism check
  const h1 = await p.evaluate(() => { setTime(2.5); return document.body.innerHTML; });
  await p.evaluate(() => { setTime(0.3); setTime(4); }); const h2 = await p.evaluate(() => { setTime(2.5); return document.body.innerHTML; });
  console.log('deterministic:', h1 === h2, 'errors:', errs);
  await p.screenshot({ path: path.join(__dirname, 'type-still.png') });
  await b.close();
})();
