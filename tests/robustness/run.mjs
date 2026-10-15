// Orchestrator for the robustness suite: start the worker locally on a
// throwaway state directory, wait until it answers, run the fuzz battery
// and the concurrency storms against it, then tear everything down.
//
//   npm run test:robustness
//
// Exit code is 0 only if both suites pass. The worker runs fully local
// (wrangler dev --local): local KV + local Durable Objects, no Cloudflare
// account needed, and the throwaway persist dir means CI always exercises
// the first-run seeding paths too.
//
// The --compatibility-date override mirrors the repo's own `dev:api`
// script: wrangler.toml asks for a newer date than the pinned wrangler's
// workerd supports, so local dev (and these tests) pin a supported one.
// Production deploys don't use this flag and are unaffected.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.TEST_PORT || '8791';
const BASE = `http://localhost:${PORT}`;
const persist = mkdtempSync(join(tmpdir(), 'robustness-state-'));

// EMAIL_DEV_MODE=1 makes the email-code endpoints return codes in their
// responses instead of sending mail (worker/users/auth.js) so the email
// suite can run end to end. Local test instance only — never production.
const server = spawn('npx', ['wrangler', 'dev', '--port', PORT, '--local', '--compatibility-date', '2026-05-03', '--persist-to', persist, '--var', 'EMAIL_DEV_MODE:1'], {
  detached: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

function stopServer() {
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
}
process.on('exit', stopServer);

async function waitReady(timeoutMs = 240000) {
  // wrangler dev rebuilds once shortly after startup (its [build] step
  // rewrites dist/, which the watcher notices) and 503s requests during
  // that restart — so require two healthy answers 3s apart before
  // declaring the server settled.
  const t0 = Date.now();
  let healthyOnce = false;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(BASE + '/api/users');
      if (r.ok) {
        if (healthyOnce) return true;
        healthyOnce = true;
        await new Promise(s => setTimeout(s, 3000));
        continue;
      }
    } catch { /* not up yet */ }
    healthyOnce = false;
    if (server.exitCode !== null) return false;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

function runSuite(file) {
  return new Promise(resolve => {
    const child = spawn('node', [new URL(file, import.meta.url).pathname], {
      env: { ...process.env, TEST_BASE: BASE }, stdio: 'inherit',
    });
    child.on('exit', code => resolve(code === 0));
  });
}

let ok = false;
try {
  if (!await waitReady()) {
    console.error('worker did not come up; wrangler output tail:\n' + serverLog.slice(-2000));
  } else {
    const fuzz = await runSuite('fuzz.mjs');
    // The email-flow suite ships with the email-binding feature; run it
    // when present so this runner works before and after that lands.
    const emailPath = new URL('email.mjs', import.meta.url).pathname;
    const email = existsSync(emailPath) ? await runSuite('email.mjs') : true;
    // Same for the user-management suite (PM-only deletion).
    const usersPath = new URL('users.mjs', import.meta.url).pathname;
    const users = existsSync(usersPath) ? await runSuite('users.mjs') : true;
    // And the quick-polls suite.
    const pollsPath = new URL('polls.mjs', import.meta.url).pathname;
    const polls = existsSync(pollsPath) ? await runSuite('polls.mjs') : true;
    // And the dodge autopilot-grants suite.
    const dodgePath = new URL('dodge.mjs', import.meta.url).pathname;
    const dodge = existsSync(dodgePath) ? await runSuite('dodge.mjs') : true;
    const storms = await runSuite('storms.mjs');
    ok = fuzz && email && users && polls && dodge && storms;
  }
} finally {
  stopServer();
  await new Promise(r => setTimeout(r, 1000));
  try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already gone */ }
  rmSync(persist, { recursive: true, force: true });
}
console.log(ok ? 'ROBUSTNESS SUITE: PASSED' : 'ROBUSTNESS SUITE: FAILED');
process.exit(ok ? 0 : 1);
