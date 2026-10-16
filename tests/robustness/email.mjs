// Email binding + code-login flow, end to end, plus the PIN alternative
// (set / verify / lockout / remove; the two are parallel — with both
// set, login offers both and either one proves it's you).
// Requires the server to
// run with EMAIL_DEV_MODE=1 (codes come back in API responses instead of
// being emailed — see worker/users/auth.js). run.mjs sets that variable
// for the local test instance; production never has it.
//
// Standalone use: start `wrangler dev --var EMAIL_DEV_MODE:1`, then
//   TEST_BASE=http://localhost:8791 node tests/robustness/email.mjs
const B = process.env.TEST_BASE || 'http://localhost:8791';
const J = async (m, p, o) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: o === undefined ? undefined : JSON.stringify(o) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return j;
};
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
const tag = Date.now().toString(36);
const NAME = 'Bind' + tag, OTHER = 'Other' + tag;
const EMAIL = `tester+${tag}@example.com`; // unique per run: rerunnable on a dirty state dir

const login = await J('POST', '/api/login', { name: NAME, token: 'device-tok-1' });
const tok1 = login.user.token;
ck('create user returns token', !!tok1);
const users1 = await J('GET', '/api/users');
ck('unbound token visible in list', users1.users.find(u => u.name === NAME)?.token === tok1);

const badMail = await J('POST', '/api/auth/send-code', { name: NAME, token: tok1, email: 'not-an-email', purpose: 'bind' });
ck('bad email format rejected', badMail.ok === false, JSON.stringify(badMail));
const noTok = await J('POST', '/api/auth/send-code', { name: NAME, token: 'wrong-token', email: EMAIL, purpose: 'bind' });
ck('bind without the account token rejected', noTok.ok === false, JSON.stringify(noTok));

const send1 = await J('POST', '/api/auth/send-code', { name: NAME, token: tok1, email: `Tester+${tag}@Example.com`, purpose: 'bind' });
ck('bind send-code ok + devCode', send1.ok && /^\d{6}$/.test(send1.devCode || ''), JSON.stringify(send1));
ck('email stored normalized (hint masked)', send1.emailHint === 't•••@example.com', send1.emailHint);

const sendFast = await J('POST', '/api/auth/send-code', { name: NAME, token: tok1, email: EMAIL, purpose: 'bind' });
ck('resend within 60s blocked', sendFast.ok === false && /等 \d+ 秒/.test(sendFast.error || ''), JSON.stringify(sendFast));

const wrong = await J('POST', '/api/auth/verify', { name: NAME, code: send1.devCode === '000000' ? '111111' : '000000', purpose: 'bind' });
ck('wrong code rejected', wrong.ok === false, JSON.stringify(wrong));
const ver = await J('POST', '/api/auth/verify', { name: NAME, code: send1.devCode, purpose: 'bind' });
ck('bind verify ok', ver.ok && ver.email === EMAIL, JSON.stringify(ver));
ck('bind rotated the token', ver.user.token && ver.user.token !== tok1);

const users2 = await J('GET', '/api/users');
const listed = users2.users.find(u => u.name === NAME);
ck('bound user token hidden in list', listed && !('token' in listed) && listed.emailBound === true, JSON.stringify(listed));

const need = await J('POST', '/api/login', { name: NAME, token: tok1 });
ck('login with stale token -> needCode', need.ok && need.needCode === true, JSON.stringify(need));
const need2 = await J('POST', '/api/login', { name: NAME, token: 'fresh-device' });
ck('login from new device -> needCode', need2.needCode === true);
const direct = await J('POST', '/api/login', { name: NAME, token: ver.user.token });
ck('login with real token -> no code needed', direct.ok && direct.user?.token === ver.user.token, JSON.stringify(direct));

const send2 = await J('POST', '/api/auth/send-code', { name: NAME, purpose: 'login' });
ck('login send-code ok', send2.ok && /^\d{6}$/.test(send2.devCode || ''), JSON.stringify(send2));
const ver2 = await J('POST', '/api/auth/verify', { name: NAME, code: send2.devCode, purpose: 'login', deviceToken: 'fresh-device' });
ck('login verify returns the token', ver2.ok && ver2.user.token === ver.user.token, JSON.stringify(ver2));
const reuse = await J('POST', '/api/auth/verify', { name: NAME, code: send2.devCode, purpose: 'login' });
ck('code cannot be reused', reuse.ok === false, JSON.stringify(reuse));

const other = await J('POST', '/api/login', { name: OTHER, token: 'device-tok-2' });
const dup = await J('POST', '/api/auth/send-code', { name: OTHER, token: other.user.token, email: EMAIL, purpose: 'bind' });
ck('email taken by another user rejected', dup.ok === false && /已经绑给别人/.test(dup.error || ''), JSON.stringify(dup));
const noMail = await J('POST', '/api/auth/send-code', { name: OTHER, purpose: 'login' });
ck('login code for unbound user rejected', noMail.ok === false, JSON.stringify(noMail));
const unboundLogin = await J('POST', '/api/login', { name: OTHER, token: 'whatever' });
ck('unbound user login unchanged', unboundLogin.ok && !!unboundLogin.user.token && !unboundLogin.needCode, JSON.stringify(unboundLogin));

// Duplicate-vote regression: a vote belongs to the account, not the token.
// Binding rotates the token; voting again must not stack a second vote,
// and unvoting with the new token (no name sent) must still clear it.
const V = 'Voter' + tag;
const vLogin = await J('POST', '/api/login', { name: V, token: 'voter-tok-a' });
const vTokA = vLogin.user.token;
await J('POST', '/api/add', { url: 'https://www.airbnb.com/rooms/24714506', addedBy: V, token: vTokA, trip: 'nov26' });
const st0 = await J('GET', '/api/state?trip=nov26');
const lid = st0.listings.find(l => String(l.roomId) === '24714506')?.id;
ck('voter listing present', !!lid);
await J('POST', '/api/vote', { id: lid, token: vTokA, name: V, trip: 'nov26' });
const acts = await J('GET', '/api/activities');
const aid = acts.activities?.[0]?.id;
await J('POST', '/api/activity-vote', { id: aid, token: vTokA, name: V });
const vSend = await J('POST', '/api/auth/send-code', { name: V, token: vTokA, email: `voter+${tag}@example.com`, purpose: 'bind' });
const vVer = await J('POST', '/api/auth/verify', { name: V, code: vSend.devCode, purpose: 'bind' });
const vTokB = vVer.user.token;
ck('voter bind rotated token', !!vTokB && vTokB !== vTokA);
const reVote = await J('POST', '/api/vote', { id: lid, token: vTokB, name: V, trip: 'nov26' });
const mine = (reVote.votes || []).filter(v => v.name === V);
ck('re-vote after rotation stays one vote', mine.length === 1 && mine[0].token === vTokB, JSON.stringify(reVote.votes));
const reAct = await J('POST', '/api/activity-vote', { id: aid, token: vTokB, name: V });
ck('activity re-vote after rotation stays one vote', (reAct.votes || []).filter(v => v.name === V).length === 1, JSON.stringify(reAct.votes));
const un = await J('POST', '/api/vote', { id: lid, token: vTokB, trip: 'nov26' });
ck('unvote with rotated token clears the vote', (un.votes || []).filter(v => v.name === V).length === 0, JSON.stringify(un.votes));

// ---- PIN protection: the 4-digit alternative to the email code ----
// Same deal as binding an email: setting a PIN hides the token from the
// public list and rotates it; a new device then proves itself with the
// PIN instead of a code. Guessing is capped: 5 wrong tries lock PIN
// login for 10 minutes.
const P = 'Pin' + tag;
const pLogin = await J('POST', '/api/login', { name: P, token: 'pin-tok-1' });
const pTok = pLogin.user.token;
ck('pin user created', !!pTok);
const pinBadTok = await J('POST', '/api/auth/pin/set', { name: P, token: 'wrong-token', pin: '2468' });
ck('pin set without the account token rejected', pinBadTok.ok === false, JSON.stringify(pinBadTok));
const pinBadFmt = await J('POST', '/api/auth/pin/set', { name: P, token: pTok, pin: '123' });
ck('pin must be exactly 4 digits', pinBadFmt.ok === false, JSON.stringify(pinBadFmt));
const pinBadFmt2 = await J('POST', '/api/auth/pin/set', { name: P, token: pTok, pin: '12a4' });
ck('pin must be digits only', pinBadFmt2.ok === false, JSON.stringify(pinBadFmt2));
const pinSet = await J('POST', '/api/auth/pin/set', { name: P, token: pTok, pin: '2468' });
ck('pin set ok', pinSet.ok === true, JSON.stringify(pinSet));
ck('pin set rotated the token', !!pinSet.user?.token && pinSet.user.token !== pTok);
const pListed = (await J('GET', '/api/users')).users.find(u => u.name === P);
ck('pin-bound token hidden in list, pinBound shows', pListed && !('token' in pListed) && pListed.pinBound === true, JSON.stringify(pListed));
const pNeed = await J('POST', '/api/login', { name: P, token: 'fresh-device' });
ck('login from a new device -> needPin (not needCode)', pNeed.ok && pNeed.needPin === true && !pNeed.needCode, JSON.stringify(pNeed));
const pDirect = await J('POST', '/api/login', { name: P, token: pinSet.user.token });
ck('login with the real token -> no PIN needed', pDirect.ok && pDirect.user?.token === pinSet.user.token, JSON.stringify(pDirect));
const pWrong = await J('POST', '/api/auth/pin/verify', { name: P, pin: '9999' });
ck('wrong PIN rejected', pWrong.ok === false, JSON.stringify(pWrong));
const pVer = await J('POST', '/api/auth/pin/verify', { name: P, pin: '2468', deviceToken: 'fresh-device' });
ck('right PIN returns the token', pVer.ok && pVer.user.token === pinSet.user.token, JSON.stringify(pVer));
// The two protections are parallel: one is enough, both is fine. With
// both set, login offers both and either one proves it's you.
const bothSet = await J('POST', '/api/auth/pin/set', { name: NAME, token: ver.user.token, pin: '1357' });
ck('PIN can be added to an email-bound account', bothSet.ok === true, JSON.stringify(bothSet));
const bothNeed = await J('POST', '/api/login', { name: NAME, token: 'fresh-device' });
ck('with both set, login offers both proofs', bothNeed.needCode === true && bothNeed.needPin === true, JSON.stringify(bothNeed));
const bothPinVer = await J('POST', '/api/auth/pin/verify', { name: NAME, pin: '1357' });
ck('with both set, the PIN alone also logs you in', bothPinVer.ok && bothPinVer.user.token === bothSet.user.token, JSON.stringify(bothPinVer));
// Lockout, on its own account so nothing above gets locked out.
const L = 'Lock' + tag;
const lLogin = await J('POST', '/api/login', { name: L, token: 'lock-tok-1' });
await J('POST', '/api/auth/pin/set', { name: L, token: lLogin.user.token, pin: '0000' });
for (let i = 0; i < 5; i++) await J('POST', '/api/auth/pin/verify', { name: L, pin: '1111' });
const locked = await J('POST', '/api/auth/pin/verify', { name: L, pin: '0000' });
ck('after 5 wrong tries even the right PIN is locked out', locked.ok === false && /试太多次了/.test(locked.error || ''), JSON.stringify(locked));
// Removing the PIN (with the account's token) unprotects the account.
const pRemove = await J('POST', '/api/auth/pin/remove', { name: P, token: pinSet.user.token });
ck('pin remove ok', pRemove.ok === true, JSON.stringify(pRemove));
const pListed2 = (await J('GET', '/api/users')).users.find(u => u.name === P);
ck('after remove, the token travels with the list again', pListed2?.token === pinSet.user.token && !pListed2.pinBound, JSON.stringify(pListed2));
const pFree = await J('POST', '/api/login', { name: P, token: 'whatever' });
ck('after remove, login needs no PIN', pFree.ok && !pFree.needPin && !!pFree.user?.token, JSON.stringify(pFree));

console.log(`EMAIL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
