'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { capture, parseArgs } = require('../../src/render/capture.js');

const scene = path.join(__dirname, 'dummy-scene.html');
const hash = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
  try {
    const run = async (name, extra = []) => {
      const o = parseArgs([scene, '1', '30', path.join(base, name), '--scale', '0.2', ...extra]);
      await capture(o);
      return fs.readdirSync(o.outDir).sort().map((f) => path.join(o.outDir, f));
    };
    const a = await run('a');
    const b = await run('b');
    assert.strictEqual(a.length, 30);
    assert.deepStrictEqual(a.map(hash), b.map(hash), 'frames must be deterministic');
    assert.notStrictEqual(hash(a[0]), hash(a[15]), 'frames must differ over time');
    const png = fs.readFileSync(a[0]);
    assert.strictEqual(png.readUInt32BE(16), 384);
    assert.strictEqual(png.readUInt32BE(20), 216);
    assert.strictEqual((await run('c', ['--frames-limit', '5'])).length, 5);
    console.log('capture tests passed');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
