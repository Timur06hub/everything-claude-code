'use strict';
// Procedural dark-ambient placeholder: low drone + detuned fifth + slow-swelling filtered noise.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function generateMusicBed(file, seconds = 60, { rate = 44100 } = {}) {
  if (!(seconds > 0)) throw new Error('seconds must be > 0');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fade = Math.min(4, seconds / 3);
  const fc = [
    `sine=f=55:r=${rate}[a]`,
    `sine=f=82.7:r=${rate},volume=0.5[b]`,
    `sine=f=27.5:r=${rate},volume=0.8[c]`,
    `anoisesrc=c=brown:r=${rate}:a=0.5,lowpass=f=400,tremolo=f=0.1:d=0.7,volume=0.35[n]`,
    `[a][b][c][n]amix=inputs=4:normalize=0,lowpass=f=600,aecho=0.8:0.6:700|1300:0.3|0.2,` +
      `volume=0.5,afade=t=in:d=${fade},afade=t=out:st=${Math.max(seconds - fade, 0)}:d=${fade},aformat=channel_layouts=stereo`,
  ].join(';');
  // lavfi sources are infinite; bound each with d= and the output with -t.
  const args = ['-y', '-v', 'error'];
  const graph = fc.replace(/sine=f=([\d.]+):r=\d+/g, `sine=f=$1:r=${rate}:d=${seconds}`)
    .replace(/anoisesrc=([^,\[]*)/, `anoisesrc=$1:d=${seconds}`);
  args.push('-filter_complex', graph, '-t', String(seconds), '-c:a', 'pcm_s16le', file);
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + (r.stderr || r.error));
  return file;
}

if (require.main === module) {
  const [out = 'audio/music-bed.wav', secs = '60'] = process.argv.slice(2);
  try { console.log(generateMusicBed(out, Number(secs))); }
  catch (e) { console.error('[music-bed] ' + e.message); process.exit(1); }
}

module.exports = { generateMusicBed };
