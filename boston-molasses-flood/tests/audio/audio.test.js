'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseScenes, computeTimings, countWords } = require('../../src/audio/narration');
const { generateVoiceovers } = require('../../src/audio/placeholder-vo');
const { generateMusicBed } = require('../../src/audio/music-bed');

function probeDuration(f) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  return parseFloat(r.stdout);
}

const md = fs.readFileSync(path.join(__dirname, 'dummy-script.md'), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-test-'));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}

test('parses three scenes split on "## "', () => {
  const s = parseScenes(md);
  assert.strictEqual(s.length, 3);
  assert.strictEqual(s[0].id, '01-scene-one');
});
test('countWords handles markdown', () => {
  assert.strictEqual(countWords('**Hello** _there_, [link](http://x) world'), 4);
});
test('timings use 150 wpm and are contiguous', () => {
  const r = computeTimings(md);
  assert.strictEqual(r.scenes.length, 3);
  r.scenes.forEach((s) => assert.ok(Math.abs(s.duration - (s.words / 150) * 60) < 0.001));
  assert.strictEqual(r.scenes[1].start, r.scenes[0].end);
  assert.strictEqual(r.totalSeconds, r.scenes[2].end);
  assert.strictEqual(r.totalWords, r.scenes.reduce((a, s) => a + s.words, 0));
});
test('silent VO wavs match durations', () => {
  const r = computeTimings(md);
  const files = generateVoiceovers(r, tmp);
  files.forEach((f, i) => assert.ok(Math.abs(probeDuration(f) - r.scenes[i].duration) < 0.1));
});
test('music bed has requested length', () => {
  const f = generateMusicBed(path.join(tmp, 'bed.wav'), 5);
  assert.ok(Math.abs(probeDuration(f) - 5) < 0.2);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${passed} passed`);
