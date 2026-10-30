'use strict';
// Generate a silent placeholder WAV per scene from a timings JSON (see narration.js).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function silentWav(file, seconds, rate = 44100) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${rate}:cl=mono`,
    '-t', String(seconds), '-c:a', 'pcm_s16le', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + (r.stderr || r.error));
  return file;
}

function generateVoiceovers(timings, outDir) {
  return timings.scenes.map((s) => silentWav(path.join(outDir, `${s.id}.wav`), Math.max(s.duration, 0.1)));
}

if (require.main === module) {
  const [timingsFile = 'audio/timings.json', outDir = 'audio/vo'] = process.argv.slice(2);
  try {
    const files = generateVoiceovers(JSON.parse(fs.readFileSync(timingsFile, 'utf8')), outDir);
    console.log(files.join('\n'));
  } catch (e) { console.error('[placeholder-vo] ' + e.message); process.exit(1); }
}

module.exports = { silentWav, generateVoiceovers };
