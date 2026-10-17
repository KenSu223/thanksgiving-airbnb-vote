// Account protection, end to end: the 4-digit PIN (set / verify / lockout /
// remove, worker/users/auth.js). Email binding was removed — its endpoints
// are gone and nothing asks for a code any more.
//
// Standalone use: start `wrangler dev`, then
//   TEST_BASE=http://localhost:8791 node tests/robustness/pin.mjs
const B = process.env.TEST_BASE || 'http://localhost:8791';
const J = async (m, p, o) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: o === undefined ? undefined : JSON.stringify(o) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return j;
};
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
const tag = Date.now().toString(36);
const NAME = 'Bind' + tag;

const login = await J('POST', '/api/login', { name: NAME, token: 'device-tok-1' });
const tok1 = login.user.token;
ck('create user returns token', !!tok1);
const users1 = await J('GET', '/api/users');
ck('unbound token visible in list', users1.users.find(u => u.name === NAME)?.token === tok1);

// The email endpoints are gone, and a plain login never asks for a code.
const sendCode = await J('POST', '/api/auth/send-code', { name: NAME, token: tok1, email: `tester+${tag}@example.com`, purpose: 'bind' });
ck('no email binding: send-code is gone', !sendCode?.ok, JSON.stringify(sendCode));
const verifyCode = await J('POST', '/api/auth/verify', { name: NAME, code: '123456', purpose: 'login' });
ck('no email binding: verify is gone', !verifyCode?.ok, JSON.stringify(verifyCode));
const plain = await J('POST', '/api/login', { name: NAME, token: 'another-device' });
ck('an account without a PIN logs in anywhere, no code asked', plain.ok && plain.user?.token === tok1 && !plain.needCode && !plain.needPin, JSON.stringify(plain));
ck('the member list carries no email fields', (await J('GET', '/api/users')).users.every(u => !('emailBound' in u) && !('emailHint' in u)));

// Duplicate-vote regression: a vote belongs to the account, not the token.
// Setting a PIN rotates the token; voting again must not stack a second vote,
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
const vPin = await J('POST', '/api/auth/pin/set', { name: V, token: vTokA, pin: '4321' });
const vTokB = vPin.user?.token;
ck('voter PIN rotated token', !!vTokB && vTokB !== vTokA);
const reVote = await J('POST', '/api/vote', { id: lid, token: vTokB, name: V, trip: 'nov26' });
const mine = (reVote.votes || []).filter(v => v.name === V);
ck('re-vote after rotation stays one vote', mine.length === 1 && mine[0].token === vTokB, JSON.stringify(reVote.votes));
const reAct = await J('POST', '/api/activity-vote', { id: aid, token: vTokB, name: V });
ck('activity re-vote after rotation stays one vote', (reAct.votes || []).filter(v => v.name === V).length === 1, JSON.stringify(reAct.votes));
const un = await J('POST', '/api/vote', { id: lid, token: vTokB, trip: 'nov26' });
ck('unvote with rotated token clears the vote', (un.votes || []).filter(v => v.name === V).length === 0, JSON.stringify(un.votes));

// ---- PIN protection ----
// Setting a PIN hides the token from the public list and rotates it; a new
// device then proves itself with the PIN. Guessing is capped: 5 wrong
// tries lock PIN login for 10 minutes.
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
ck('login from a new device -> needPin', pNeed.ok && pNeed.needPin === true && !pNeed.needCode, JSON.stringify(pNeed));
const pDirect = await J('POST', '/api/login', { name: P, token: pinSet.user.token });
ck('login with the real token -> no PIN needed', pDirect.ok && pDirect.user?.token === pinSet.user.token, JSON.stringify(pDirect));
const pWrong = await J('POST', '/api/auth/pin/verify', { name: P, pin: '9999' });
ck('wrong PIN rejected', pWrong.ok === false, JSON.stringify(pWrong));
const pVer = await J('POST', '/api/auth/pin/verify', { name: P, pin: '2468', deviceToken: 'fresh-device' });
ck('right PIN returns the token', pVer.ok && pVer.user.token === pinSet.user.token, JSON.stringify(pVer));
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

console.log(`PIN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
