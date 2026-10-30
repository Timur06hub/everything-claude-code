// One low-res still + determinism check. Run: node tests/camera/still.js
const path = require('path');
const { createRequire } = require('module');
const { chromium } = createRequire(require('child_process').execSync('npm root -g').toString().trim() + '/')('playwright');
const Camera = require('../../src/shared/camera/camera.js');
(async () => {
  const a = JSON.stringify(Camera.apply([{ depth: 0.2 }, { depth: 0.9 }], 3.3, { type: 'drift', drift: { seed: 7 } }));
  const b = JSON.stringify(Camera.apply([{ depth: 0.2 }, { depth: 0.9 }], 3.3, { type: 'drift', drift: { seed: 7 } }));
  if (a !== b) throw new Error('non-deterministic');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  await page.addInitScript(() => {});
  await page.goto('file://' + path.resolve(__dirname, '../../src/scenes/05-the-wave.html'));
  await page.evaluate(() => { const s = document.getElementById('stage'); s.style.transform = 'scale(0.25)'; });
  const ok = await page.evaluate(() => { window.__setTime(6); return typeof window.__setTime === 'function' && document.getElementById('mid').style.transform; });
  await page.screenshot({ path: path.resolve(__dirname, 'still-05.png') });
  await browser.close();
  console.log('ok', ok);
})().catch(e => { console.error(e); process.exit(1); });
