'use strict';
// Process counting (execve) and side-effect audit (write-intent syscalls, network) via strace.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { BASE, SB, ROOT, setup, buildCases, spawnArgs } = require('./cases');

setup();
const cases = buildCases();
const REPEAT = Number(process.env.TRACE_REPEAT || 3);
const tmpf = BASE + '/strace.tmp';

function strace(c, syscalls) {
  const [bin, args] = spawnArgs(c);
  try { fs.unlinkSync(tmpf); } catch (_) { /* best-effort cleanup */ }
  const r = cp.spawnSync('strace', ['-f', '-qq', '-s', '160', '-e', 'trace=' + syscalls, '-o', tmpf, '--', bin, ...args],
    { input: c.payload, env: c.env, cwd: SB.proj, encoding: 'utf8', timeout: 60000 });
  const text = fs.existsSync(tmpf) ? fs.readFileSync(tmpf, 'utf8') : '';
  return { r, lines: text.split('\n').filter(Boolean) };
}

function execs(lines) {
  const res = [];
  for (const l of lines) {
    const m = l.match(/^(\d+)\s+execve\("([^"]+)", \[(.*?)\], .*\)\s+=\s+(-?\d+)/);
    if (!m || m[4] !== '0') continue;
    const base = path.basename(m[2]);
    const argv = m[3];
    let label = base;
    if (base === 'node') {
      const a = argv.match(/"((?:[^"\\]|\\.)*)"/g) || [];
      const rest = a.slice(1).map(s => s.slice(1, -1));
      label = rest[0] === '-e' ? 'node -e <inline resolver+bootstrap>' : 'node ' + rest.map(s => s.replace(ROOT + '/', '')).join(' ').slice(0, 110);
    } else if (base === 'sh' || base === 'dash' || base === 'bash') {
      label = base + ' (wrapper)';
    }
    res.push({ pid: m[1], base, label });
  }
  return res;
}

const rows = [];
for (const c of cases) {
  const counts = [];
  let sample = null;
  for (let i = 0; i < REPEAT; i++) {
    const { lines } = strace(c, 'execve');
    const e = execs(lines);
    counts.push({ all: e.length, node: e.filter(x => x.base === 'node').length, other: e.filter(x => !/^(node|sh|dash|bash)$/.test(x.base)).length });
    if (!sample) sample = e;
  }
  const stable = counts.every(x => x.node === counts[0].node && x.all === counts[0].all);
  rows.push({ name: c.name, group: c.group, nodeProcs: counts.map(x => x.node), allExecs: counts.map(x => x.all), stable, chain: sample.map(x => x.label) });
}
fs.writeFileSync(BASE + '/results-procs.json', JSON.stringify(rows, null, 2));
console.log('=== Node process counts (execve, successful) — ' + REPEAT + ' traced runs per case ===');
for (const r of rows) console.log(r.name.padEnd(58), 'node=' + r.nodeProcs.join('/'), ' all-execs=' + r.allExecs.join('/'), r.stable ? '' : '  (UNSTABLE)');

// ---- Safety audit: write-intent syscalls and network, one traced run per case ----
const SYS = 'openat,open,creat,mkdir,mkdirat,unlink,unlinkat,rename,renameat,renameat2,rmdir,symlink,symlinkat,link,linkat,truncate,chmod,fchmodat,connect';
const WRITE_FLAGS = /O_WRONLY|O_RDWR|O_CREAT|O_TRUNC|O_APPEND/;
const ALLOW = [/^\/dev\/(null|tty|zero|urandom)$/];
const writes = new Map();
const outside = [];
const nets = [];
for (const c of cases) {
  const { lines } = strace(c, SYS);
  for (const l of lines) {
    if (/ = -1 /.test(l)) continue; // failed syscalls change nothing
    let m;
    if ((m = l.match(/(?:openat|open)\((?:AT_FDCWD, )?"([^"]+)", ([^)]*)\)/)) && WRITE_FLAGS.test(m[2])) writes.set(m[1], (writes.get(m[1]) || 0) + 1);
    else if ((m = l.match(/(?:mkdirat|mkdir|unlinkat|unlink|rmdir|creat|truncate|chmod|fchmodat)\((?:AT_FDCWD, )?"([^"]+)"/))) writes.set(m[1], (writes.get(m[1]) || 0) + 1);
    else if ((m = l.match(/(?:renameat2|renameat|rename|symlinkat|symlink|linkat|link)\((.*)\)/))) { for (const p of (m[1].match(/"([^"]+)"/g) || [])) writes.set(p.slice(1, -1), (writes.get(p.slice(1, -1)) || 0) + 1); }
    else if (/connect\(/.test(l) && !/AF_UNIX/.test(l)) nets.push(c.name + ' :: ' + l.slice(0, 160));
  }
}
const inside = [];
for (const p of writes.keys()) {
  const abs = path.isAbsolute(p) ? p : path.join(SB.proj, p);
  if (abs.startsWith(BASE + '/') || ALLOW.some(rx => rx.test(abs))) inside.push(abs);
  else outside.push(abs);
}
console.log('\n=== Safety audit (successful write-intent syscalls across all ' + cases.length + ' cases) ===');
console.log('distinct paths written inside sandbox:', inside.length);
console.log('distinct paths written OUTSIDE sandbox:', outside.length, outside.slice(0, 20));
console.log('non-UNIX network connect() calls:', nets.length, nets.slice(0, 5));
fs.writeFileSync(BASE + '/results-safety.json', JSON.stringify({ inside, outside, nets }, null, 2));
try { fs.unlinkSync(tmpf); } catch (_) { /* best-effort cleanup */ }
