'use strict';
// Wall-clock benchmark. Interleaved rounds (rotating start) to spread drift evenly across cases.
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const { BASE, SB, setup, buildCases, spawnArgs } = require('./cases');

const WARM = Number(process.env.BENCH_WARM || 3);
const N = Number(process.env.BENCH_N || 30);

setup();
const cases = buildCases();
const data = cases.map(() => ({ ms: [], status: [], timeouts: 0, sample: null }));

function once(c) {
  const [bin, args] = spawnArgs(c);
  const t0 = process.hrtime.bigint();
  const r = cp.spawnSync(bin, args, { input: c.payload, env: c.env, cwd: SB.proj, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, r };
}

const load0 = os.loadavg();
for (let round = -WARM; round < N; round++) {
  for (let k = 0; k < cases.length; k++) {
    const i = (k + (round + WARM) * 7) % cases.length; // rotate start
    const { ms, r } = once(cases[i]);
    if (round < 0) continue;
    const d = data[i];
    if (r.error && r.error.code === 'ETIMEDOUT') d.timeouts++;
    d.ms.push(ms);
    d.status.push(r.status === null ? 'sig:' + r.signal : r.status);
    if (!d.sample) d.sample = { stdoutBytes: (r.stdout || '').length, stderrHead: (r.stderr || '').slice(0, 160).replace(/\s+/g, ' '), stdoutHead: (r.stdout || '').slice(0, 100).replace(/\s+/g, ' ') };
  }
}
const load1 = os.loadavg();

function stats(a) {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  const mean = s.reduce((x, y) => x + y, 0) / n;
  const med = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const sd = Math.sqrt(s.reduce((x, y) => x + (y - mean) ** 2, 0) / (n - 1));
  return { n, median: med, mean, min: s[0], max: s[n - 1], sd, p90: s[Math.min(n - 1, Math.ceil(n * 0.9) - 1)] };
}

const out = cases.map((c, i) => {
  const st = stats(data[i].ms);
  const codes = {};
  for (const s of data[i].status) codes[s] = (codes[s] || 0) + 1;
  return { name: c.name, group: c.group, hook: c.hook, state: c.state, type: c.type, ...st, exit: codes, timeouts: data[i].timeouts, sample: data[i].sample };
});
fs.writeFileSync(BASE + '/results-timing.json', JSON.stringify({ N, WARM, load0, load1, cpus: os.cpus().length, node: process.version, out }, null, 2));

const f = x => x.toFixed(1).padStart(7);
console.log(`N=${N} measured runs per case (+${WARM} warmup, interleaved). loadavg start ${load0.map(x => x.toFixed(2))} end ${load1.map(x => x.toFixed(2))}`);
console.log('case'.padEnd(58), ' median    mean     min     max      sd  exit');
for (const o of out) console.log(o.name.padEnd(58), f(o.median), f(o.mean), f(o.min), f(o.max), f(o.sd), JSON.stringify(o.exit), o.timeouts ? 'TIMEOUTS=' + o.timeouts : '');
