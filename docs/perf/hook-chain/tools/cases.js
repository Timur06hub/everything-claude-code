'use strict';
// Shared definitions for the ECC hook-chain benchmark.
// Sandbox and results go to HOOKBENCH_DIR (default: <tmpdir>/ecc-hookbench), never into the repo.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const os = require('os');
const ROOT = process.env.ECC_ROOT || path.resolve(__dirname, '../../../..');
const BASE = process.env.HOOKBENCH_DIR || path.join(os.tmpdir(), 'ecc-hookbench');
const SB = {
  home: path.join(BASE, 'sandbox/home'),
  proj: path.join(BASE, 'sandbox/proj'),
  tmp: path.join(BASE, 'sandbox/tmp'),
};

function setup() {
  for (const d of [SB.home, SB.tmp, SB.proj + '/src']) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(SB.proj + '/.git')) {
    cp.execFileSync('git', ['init', '-q'], { cwd: SB.proj, env: { PATH: process.env.PATH, HOME: SB.home } });
  }
}

function baseEnv(extra) {
  return Object.assign({
    PATH: process.env.PATH,
    HOME: SB.home,
    TMPDIR: SB.tmp,
    LANG: 'C.UTF-8',
    CLAUDE_PLUGIN_ROOT: ROOT,
    CLAUDE_PROJECT_DIR: SB.proj,
    CLAUDE_CODE_ENTRYPOINT: 'cli',
  }, extra || {});
}

const common = (event, extra) => JSON.stringify(Object.assign({
  session_id: 'bench-session',
  transcript_path: SB.tmp + '/transcript.jsonl',
  cwd: SB.proj,
  hook_event_name: event,
}, extra));

const P = {
  bash: common('PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'echo hello' } }),
  write: common('PreToolUse', { tool_name: 'Write', tool_use_id: 't2', tool_input: { file_path: SB.proj + '/NOTES.md', content: 'x' } }),
  edit: common('PreToolUse', { tool_name: 'Edit', tool_use_id: 't3', tool_input: { file_path: SB.proj + '/src/a.js', old_string: 'a', new_string: 'b' } }),
  read: common('PreToolUse', { tool_name: 'Read', tool_use_id: 't4', tool_input: { file_path: SB.proj + '/src/a.js' } }),
  postRead: common('PostToolUse', { tool_name: 'Read', tool_use_id: 't5', tool_input: { file_path: SB.proj + '/src/a.js' }, tool_response: { content: 'x' } }),
  stop: common('Stop', {}),
};

const hooksJson = require(ROOT + '/hooks/hooks.json').hooks;
function findCmd(pred) {
  for (const [ev, arr] of Object.entries(hooksJson)) {
    for (const e of arr) for (const k of e.hooks) if (pred(k.command.trim())) return { cmd: k.command, ev, matcher: e.matcher, async: !!k.async };
  }
  throw new Error('hook command not found');
}

// type A: node -e -> plugin-hook-bootstrap -> run-with-flags -> hook
// type B: node -e -> plugin-hook-bootstrap -> dispatcher (no run-with-flags)
// type C: node -e -> posttooluse-dispatcher.cli() (single process, no bootstrap)
// type D: node -e -> lifecycle-hook-bootstrap.cli()
const HOOKS = [
  { key: 'pre-bash-dispatcher', type: 'B', id: 'pre:bash:dispatcher', payload: P.bash, find: c => c.endsWith(' node scripts/hooks/pre-bash-dispatcher.js'), layers: { script: 'scripts/hooks/pre-bash-dispatcher.js' } },
  { key: 'doc-file-warning', type: 'A', id: 'pre:write:doc-file-warning', payload: P.write, find: c => c.includes(' pre:write:doc-file-warning '), layers: { rwf: ['pre:write:doc-file-warning', 'scripts/hooks/doc-file-warning.js', 'standard,strict'] } },
  { key: 'gateguard-edit', type: 'A', id: 'pre:edit-write:gateguard-fact-force', payload: P.edit, find: c => c.includes(' pre:edit-write:gateguard-fact-force '), layers: { rwf: ['pre:edit-write:gateguard-fact-force', 'scripts/hooks/gateguard-fact-force.js', 'standard,strict'] } },
  { key: 'hookify-runtime-pre', type: 'A', id: 'pre:hookify-runtime', payload: P.bash, find: c => c.includes(' pre:hookify-runtime ') },
  { key: 'observe-pre (async)', type: 'A', id: 'pre:observe', payload: P.read, find: c => c.includes(' pre:observe ') },
  { key: 'posttooluse-dispatcher', type: 'C', disableEnv: { ECC_HOOKS_ENABLED: 'false' }, payload: P.postRead, find: c => c.includes('posttooluse-dispatcher.js') && c.endsWith('.cli()" sync') },
  { key: 'stop-check-console-log', type: 'D', id: 'stop:check-console-log', payload: P.stop, find: c => c.includes(' stop:check-console-log ') },
];

function buildCases() {
  const cases = [];
  cases.push({ name: 'bare node (direct, no shell)', group: 'baseline', mode: 'direct', cmd: process.execPath, args: ['-e', '0'], payload: '', env: baseEnv() });
  cases.push({ name: 'bare node (via sh -c)', group: 'baseline', mode: 'sh', cmd: 'node -e 0', payload: '', env: baseEnv() });
  for (const h of HOOKS) {
    const f = findCmd(h.find);
    const dis = h.disableEnv || { ECC_DISABLED_HOOKS: h.id };
    cases.push({ name: `${h.key} | FULL enabled`, group: 'full', hook: h.key, type: h.type, state: 'enabled', mode: 'sh', cmd: f.cmd, payload: h.payload, env: baseEnv() });
    cases.push({ name: `${h.key} | FULL disabled`, group: 'full', hook: h.key, type: h.type, state: 'disabled', mode: 'sh', cmd: f.cmd, payload: h.payload, env: baseEnv(dis) });
    if (h.layers && h.layers.rwf) {
      const a = h.layers.rwf;
      const rwf = `node ${ROOT}/scripts/hooks/run-with-flags.js ${a.join(' ')}`;
      const boot = `node ${ROOT}/scripts/hooks/plugin-hook-bootstrap.js node scripts/hooks/run-with-flags.js ${a.join(' ')}`;
      cases.push({ name: `${h.key} | L3 bootstrap->rwf enabled`, group: 'layer', hook: h.key, state: 'enabled', mode: 'sh', cmd: boot, payload: h.payload, env: baseEnv() });
      cases.push({ name: `${h.key} | L3 bootstrap->rwf disabled`, group: 'layer', hook: h.key, state: 'disabled', mode: 'sh', cmd: boot, payload: h.payload, env: baseEnv(dis) });
      cases.push({ name: `${h.key} | L2 run-with-flags enabled`, group: 'layer', hook: h.key, state: 'enabled', mode: 'sh', cmd: rwf, payload: h.payload, env: baseEnv() });
      cases.push({ name: `${h.key} | L2 run-with-flags disabled`, group: 'layer', hook: h.key, state: 'disabled', mode: 'sh', cmd: rwf, payload: h.payload, env: baseEnv(dis) });
    }
    if (h.layers && h.layers.script) {
      const boot = `node ${ROOT}/scripts/hooks/plugin-hook-bootstrap.js node ${h.layers.script}`;
      const direct = `node ${ROOT}/${h.layers.script}`;
      cases.push({ name: `${h.key} | L3 bootstrap->script enabled`, group: 'layer', hook: h.key, state: 'enabled', mode: 'sh', cmd: boot, payload: h.payload, env: baseEnv() });
      cases.push({ name: `${h.key} | L3 bootstrap->script disabled`, group: 'layer', hook: h.key, state: 'disabled', mode: 'sh', cmd: boot, payload: h.payload, env: baseEnv(dis) });
      cases.push({ name: `${h.key} | L1 script direct enabled`, group: 'layer', hook: h.key, state: 'enabled', mode: 'sh', cmd: direct, payload: h.payload, env: baseEnv() });
      cases.push({ name: `${h.key} | L1 script direct disabled`, group: 'layer', hook: h.key, state: 'disabled', mode: 'sh', cmd: direct, payload: h.payload, env: baseEnv(dis) });
    }
  }
  return cases;
}

function spawnArgs(c) {
  return c.mode === 'direct' ? [c.cmd, c.args] : ['/bin/sh', ['-c', c.cmd]];
}

module.exports = { ROOT, BASE, SB, setup, baseEnv, buildCases, spawnArgs };
