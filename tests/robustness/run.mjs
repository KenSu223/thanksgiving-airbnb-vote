// Runs the robustness suite: start the worker locally on a throwaway state
// directory, wait until it answers, run every suite in this folder against it,
// then tear it down.
//
//   npm run test:robustness                     every suite
//   npm run test:robustness -- chat gomoku      only these
//   TEST_BASE=http://localhost:8787 npm run test:robustness   against a worker you already run
//
// A suite is any *.mjs in this folder (shared helpers live in lib/). Each one
// runs as its own process with TEST_BASE set, prints its checks, and fails by
// exiting non-zero; a new suite is picked up without touching this file. They
// all share one worker, so a few run in a fixed order: FIRST in that order,
// then the rest alphabetically, then LAST. Every suite runs even when an
// earlier one fails; the exit code is 0 only if they all pass.
//
// The worker runs fully local (wrangler dev --local: local KV and Durable
// Objects, no Cloudflare account), and the throwaway state means CI always
// exercises the first-run seeding too. --compatibility-date mirrors the
// `dev:api` script: wrangler.toml asks for a newer date than the pinned
// wrangler's workerd supports. Test-only vars (the deployed worker sets none):
//   PARTY_SPEED=20   party-game clocks 20x faster, so whole games fit (worker/games/hall.js)
//   RETIRE=Retiree   a retired test account, for users.mjs (worker/users/retire.js)
//   VOTE_OPEN=nov26  nov26's voting stays open whatever the date, so the vote
//                    tests don't depend on the calendar; nov25 stays closed for
//                    the after-the-vote ones (worker/config/trips.js)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fuzz: on the fresh state. users before leaderboards (its retiree's dodge run
// has to be in the top 3 when it looks). storms: the concurrency storms, last.
const FIRST = ['fuzz', 'pin', 'users', 'leaderboards'];
const LAST = ['storms'];
const VARS = { PARTY_SPEED: '20', RETIRE: 'Retiree', VOTE_OPEN: 'nov26' };

const dir = fileURLToPath(new URL('.', import.meta.url));
const found = readdirSync(dir).filter(f => f.endsWith('.mjs') && f !== 'run.mjs').map(f => f.slice(0, -4));
const ordered = [...FIRST, ...found.filter(s => !FIRST.includes(s) && !LAST.includes(s)).sort(), ...LAST].filter(s => found.includes(s));
const wanted = process.argv.slice(2);
const unknown = wanted.filter(s => !found.includes(s));
if (unknown.length) { console.error('no such suite: ' + unknown.join(', ') + ' (have: ' + found.join(', ') + ')'); process.exit(1); }
const suites = wanted.length ? ordered.filter(s => wanted.includes(s)) : ordered;

// ---- the worker ----
const BASE = process.env.TEST_BASE || `http://localhost:${process.env.TEST_PORT || '8791'}`;
let server = null, persist = null, serverLog = '';
if (!process.env.TEST_BASE) {
  persist = mkdtempSync(join(tmpdir(), 'robustness-state-'));
  const vars = Object.entries(VARS).flatMap(([k, v]) => ['--var', `${k}:${v}`]);
  server = spawn('npx', ['wrangler', 'dev', '--port', new URL(BASE).port, '--local', '--compatibility-date', '2026-05-03', '--persist-to', persist, ...vars], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });
  process.on('exit', () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ } });
}

// wrangler dev rebuilds once shortly after startup (its [build] step rewrites
// dist/, which the watcher notices) and 503s during that restart, so it takes
// two healthy answers 3 s apart to call it settled.
async function waitReady(timeoutMs = 240000) {
  const t0 = Date.now();
  let healthyOnce = false;
  while (Date.now() - t0 < timeoutMs) {
    try {
      if ((await fetch(BASE + '/api/users')).ok) {
        if (healthyOnce || !server) return true;
        healthyOnce = true;
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
    } catch { /* not up yet */ }
    healthyOnce = false;
    if (server && server.exitCode !== null) return false;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

function runSuite(name) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [join(dir, name + '.mjs')], { env: { ...process.env, TEST_BASE: BASE }, stdio: 'inherit' });
    child.on('exit', code => resolve({ name, ok: code === 0, secs: (Date.now() - t0) / 1000 }));
  });
}

const results = [];
try {
  if (!await waitReady()) {
    console.error('worker did not come up at ' + BASE + (server ? '; wrangler output tail:\n' + serverLog.slice(-2000) : ''));
  } else {
    for (const s of suites) {
      console.log(`\n=== ${s} ===`);
      results.push(await runSuite(s));
    }
  }
} finally {
  if (server) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
    await new Promise(r => setTimeout(r, 1000));
    try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already gone */ }
    rmSync(persist, { recursive: true, force: true });
  }
}

const failed = results.filter(r => !r.ok).map(r => r.name);
const ok = results.length === suites.length && !failed.length;
console.log('\n' + results.map(r => `${r.ok ? 'pass' : 'FAIL'}  ${r.name.padEnd(14)} ${r.secs.toFixed(1)}s`).join('\n'));
console.log(ok ? `ROBUSTNESS SUITE: PASSED (${results.length} suites)` : `ROBUSTNESS SUITE: FAILED${failed.length ? ' (' + failed.join(', ') + ')' : ''}`);
process.exit(ok ? 0 : 1);
