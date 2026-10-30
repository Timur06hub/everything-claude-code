'use strict';
// Parse script/script.md into scenes (split on lines starting '## '), estimate narration timing.
const fs = require('fs');
const path = require('path');

const DEFAULT_WPM = 150;

function stripMarkdown(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/`{3}[\s\S]*?`{3}/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#+|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]/g, '');
}

function countWords(text) {
  const m = stripMarkdown(text).match(/[\p{L}\p{N}]+(?:['’\-.,][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene';
}

function parseScenes(markdown) {
  const scenes = [];
  let cur = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      cur = { title: line.slice(3).trim(), lines: [] };
      scenes.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  return scenes.map((s, i) => ({
    id: `${String(i + 1).padStart(2, '0')}-${slug(s.title)}`,
    title: s.title,
    text: s.lines.join('\n').trim(),
  }));
}

function computeTimings(markdown, { wpm = DEFAULT_WPM, gap = 0 } = {}) {
  if (!(wpm > 0)) throw new Error('wpm must be > 0');
  let t = 0;
  const scenes = parseScenes(markdown).map((s) => {
    const words = countWords(s.text);
    const duration = Math.round((words / wpm) * 60 * 1000) / 1000;
    const out = { id: s.id, title: s.title, words, start: Math.round(t * 1000) / 1000, duration };
    t += duration + gap;
    out.end = Math.round((out.start + duration) * 1000) / 1000;
    return out;
  });
  const totalWords = scenes.reduce((a, s) => a + s.words, 0);
  const totalSeconds = scenes.length ? scenes[scenes.length - 1].end : 0;
  return { wpm, scenes, totalWords, totalSeconds };
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  return `${m}:${(sec - m * 60).toFixed(1).padStart(4, '0')}`;
}

function report(r) {
  const lines = [`Runtime report @ ${r.wpm} wpm`, ''];
  for (const s of r.scenes) {
    lines.push(`${s.id.padEnd(28)} ${String(s.words).padStart(5)} words  ${fmt(s.duration)}  [${fmt(s.start)} - ${fmt(s.end)}]`);
  }
  lines.push('', `TOTAL ${r.scenes.length} scenes, ${r.totalWords} words, ${fmt(r.totalSeconds)} (${r.totalSeconds.toFixed(1)}s)`);
  return lines.join('\n');
}

function main(argv) {
  const args = { script: 'script/script.md', out: 'audio/timings.json', wpm: DEFAULT_WPM, gap: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--wpm') args.wpm = Number(argv[++i]);
    else if (argv[i] === '--gap') args.gap = Number(argv[++i]);
    else args.script = argv[i];
  }
  const r = computeTimings(fs.readFileSync(args.script, 'utf8'), args);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(r, null, 2) + '\n');
  console.log(report(r));
  console.log(`\nWrote ${args.out}`);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error('[narration] ' + e.message); process.exit(1); }
}

module.exports = { parseScenes, countWords, computeTimings, report, DEFAULT_WPM };
