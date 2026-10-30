#!/usr/bin/env node
'use strict';
/**
 * Deterministic frame capture for scene HTML files.
 * Usage: node capture.js <scene.html> <duration> <fps> <outDir> [--scale 0.25] [--frames-limit N]
 * The page must expose window.__setTime(seconds) (may be async).
 * Output: <outDir>/frame_000001.png ...  Viewport is 1920x1080 CSS px;
 * --scale sets deviceScaleFactor (e.g. 0.25 -> 480x270 PNGs).
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const W = 1920;
const H = 1080;

function parseArgs(argv) {
  const pos = [];
  const opt = { scale: 1, framesLimit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scale') opt.scale = Number(argv[++i]);
    else if (a.startsWith('--scale=')) opt.scale = Number(a.slice(8));
    else if (a === '--frames-limit') opt.framesLimit = Number(argv[++i]);
    else if (a.startsWith('--frames-limit=')) opt.framesLimit = Number(a.slice(15));
    else pos.push(a);
  }
  if (pos.length < 4) throw new Error('usage: capture.js <scene.html> <duration> <fps> <outDir> [--scale N] [--frames-limit N]');
  opt.scene = path.resolve(pos[0]);
  opt.duration = Number(pos[1]);
  opt.fps = Number(pos[2]);
  opt.outDir = path.resolve(pos[3]);
  for (const k of ['duration', 'fps', 'scale', 'framesLimit']) {
    if (!(opt[k] > 0)) throw new Error(`invalid ${k}: ${opt[k]}`);
  }
  if (!fs.existsSync(opt.scene)) throw new Error(`scene not found: ${opt.scene}`);
  return opt;
}

async function capture(opt) {
  const { chromium } = require('playwright');
  fs.mkdirSync(opt.outDir, { recursive: true });
  const total = Math.min(Math.round(opt.duration * opt.fps), opt.framesLimit);
  const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
  try {
    const ctx = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: opt.scale,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[capture] page error:', e.message));
    await page.goto(pathToFileURL(opt.scene).href, { waitUntil: 'load' });
    await page.evaluate(() => (document.fonts && document.fonts.ready) || null);
    const has = await page.evaluate(() => typeof window.__setTime === 'function');
    if (!has) throw new Error('scene does not expose window.__setTime(seconds)');
    for (let i = 0; i < total; i++) {
      const t = i / opt.fps;
      await page.evaluate(async (s) => {
        await window.__setTime(s);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, t);
      const file = path.join(opt.outDir, `frame_${String(i + 1).padStart(6, '0')}.png`);
      await page.screenshot({ path: file, type: 'png', animations: 'disabled', caret: 'hide' });
      if ((i + 1) % 30 === 0 || i + 1 === total) console.log(`[capture] ${i + 1}/${total}`);
    }
    return total;
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  let opt;
  try { opt = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  capture(opt).then((n) => console.log(`[capture] done: ${n} frames -> ${opt.outDir}`))
    .catch((e) => { console.error('[capture] failed:', e.message); process.exit(1); });
}

module.exports = { parseArgs, capture };
