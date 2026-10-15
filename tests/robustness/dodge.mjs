// Dodge autopilot grants (worker/dodge/board.js): PM hands the bot
// to specific accounts. Nobody else can grant, the list is visible
// only to PM, and a grant takes effect on the grantee's next check.
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/dodge.mjs
const B = process.env.TEST_BASE || 'http://localhost:8791';
const J = async (m, p, o) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: o === undefined ? undefined : JSON.stringify(o) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return j;
};
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
const tag = Date.now().toString(36);
const mk = async n => { const r = await J('POST', '/api/login', { name: n + tag, token: 'dev-' + n + '-' + tag }); return { name: r.user?.name, token: r.user?.token }; };
const grantsOf = u => J('GET', `/api/dodge/grants?name=${encodeURIComponent(u.name)}&token=${encodeURIComponent(u.token)}`);

// PM must be the actual PM account (the admin check is by account, not
// by name prefix) — log in as exactly "PM", like users.mjs does.
const pmLogin = await J('POST', '/api/login', { name: 'PM', token: 'pm-device-' + tag });
const pm = { name: pmLogin.user?.name, token: pmLogin.user?.token };
const pal = await mk('GrantPal');
ck('test users created', !!(pm.token && pal.token));

const pmView = await grantsOf(pm);
ck('PM is admin and can always use the bot', pmView.isAdmin === true && pmView.canBot === true, JSON.stringify(pmView));
const palView = await grantsOf(pal);
ck('ungranted account: no bot, no admin, no list', palView.canBot === false && palView.isAdmin === false && (palView.grants || []).length === 0, JSON.stringify(palView));

const selfGrant = await J('POST', '/api/dodge/grants', { name: pal.name, token: pal.token, target: pal.name, on: true });
ck('granting by a non-admin rejected', selfGrant.ok === false, JSON.stringify(selfGrant));
const bogus = await J('POST', '/api/dodge/grants', { name: pm.name, token: pm.token, target: 'NoSuchPerson' + tag, on: true });
ck('granting a missing person rejected', bogus.ok === false, JSON.stringify(bogus));

const granted = await J('POST', '/api/dodge/grants', { name: pm.name, token: pm.token, target: pal.name, on: true });
ck('PM grants the pal', granted.ok === true && granted.grants.some(n => n.toLowerCase() === pal.name.toLowerCase()), JSON.stringify(granted));
ck('pal can now use the bot', (await grantsOf(pal)).canBot === true);

const revoked = await J('POST', '/api/dodge/grants', { name: pm.name, token: pm.token, target: pal.name, on: false });
ck('PM revokes the pal', revoked.ok === true && !revoked.grants.some(n => n.toLowerCase() === pal.name.toLowerCase()), JSON.stringify(revoked));
ck('pal loses the bot', (await grantsOf(pal)).canBot === false);

const anon = await J('GET', '/api/dodge/grants');
ck('anonymous check is harmless', anon.ok === true && anon.canBot === false && anon.isAdmin === false, JSON.stringify(anon));

console.log(`\ndodge suite: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
