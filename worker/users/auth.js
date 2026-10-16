// Email binding + code login for user accounts (see users.js for the
// account list itself), plus the lighter-weight alternative: a 4-digit
// PIN the user picks. Either one "protects" the account the same way —
// the token stops travelling with the public list, and a device that
// doesn't hold it must prove itself (email code, or the PIN).
//
// Flow: an account may bind an email (verified by a 6-digit code). After
// that, logging in as that account from a device that doesn't already
// hold its token requires a code sent to the bound email; devices with
// the token cached are never interrupted (see handleLogin in users.js).
// A PIN works the same, minus the mailbox: set it while holding the
// token (which also rotates the token, like binding does), then a new
// device just types the 4 digits. Only 10,000 combinations exist, so
// guessing is throttled hard: 5 wrong tries lock PIN login for the
// account for 10 minutes (the tries live in KV under pintry:v1:*).
//
// Codes are throwaway: they live in KV under authcode:v1:* with a 10
// minute TTL, are stored only as a salted hash, allow 5 guesses, and can
// be re-sent at most once a minute.
//
// Sending uses Resend (https://resend.com): set the RESEND_API_KEY
// worker secret (EMAIL_FROM optional, must be a Resend-verified sender).
// Until the secret exists the feature stays dormant: send-code answers
// a clear "not configured" error and nothing else changes. For local
// development only, EMAIL_DEV_MODE=1 skips sending and returns the code
// in the API response so the whole flow can be exercised end to end —
// never set it in production.
import { j, uid } from '../lib/http.js';
import { getUsers, updateUsers, publicUsers, sameName, cleanName, cleanEmail, validEmail, maskEmail, migrateDeviceVotes } from './users.js';

const CODE_TTL_S = 600;        // codes live 10 minutes (also the KV TTL)
const RESEND_COOLDOWN_S = 60;  // one send per minute per account+purpose
const MAX_TRIES = 5;

const codeKey = (purpose, userKey) => `authcode:v1:${purpose}:${userKey}`;

async function hashCode(userKey, email, code) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userKey}|${email}|${code}`));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Sends through Resend; the handler checks configuration before calling.
async function sendCodeMail(env, to, code) {
  const from = env.EMAIL_FROM || 'Denver Thanksgiving <onboarding@resend.dev>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to,
        subject: `登录验证码 ${code}｜Denver Thanksgiving`,
        text: `你的验证码是 ${code}，10 分钟内有效。\n不是你本人操作的话忽略这封邮件就行。`,
      }),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

// POST /api/auth/send-code { name, token?, email?, purpose: 'bind'|'login' }
// bind: attach a NEW email — caller must hold the account's current token
//       (for an unbound account that token is still public, by design; for
//       a bound one it's the real credential). verify completes the bind.
// login: code goes to the already-bound email.
async function handleSendCode(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const name = cleanName(body.name);
  const purpose = body.purpose === 'bind' ? 'bind' : 'login';
  const users = await getUsers(env);
  const user = users.find(u => sameName(u.name, name));
  if (!user) return j({ ok: false, error: '先选好你的名字' });
  let email;
  if (purpose === 'login') {
    if (!user.email) return j({ ok: false, error: '这个账号还没绑邮箱' });
    email = user.email;
  } else {
    if (String(body.token || '') !== user.token) return j({ ok: false, error: '先登录再绑邮箱' });
    email = cleanEmail(body.email);
    if (!validEmail(email)) return j({ ok: false, error: '邮箱格式不太对，检查一下' });
    if (user.email === email) return j({ ok: false, error: '已经绑的就是这个邮箱' });
    if (users.some(u => u !== user && u.email === email)) return j({ ok: false, error: '这个邮箱已经绑给别人了' });
  }
  // One code per minute: a live record younger than the cooldown blocks.
  const key = codeKey(purpose, user.name.toLowerCase());
  const prevRaw = await env.VOTES_KV.get(key);
  if (prevRaw) {
    const prev = JSON.parse(prevRaw);
    const waitS = RESEND_COOLDOWN_S - Math.floor((Date.now() - prev.sentAt) / 1000);
    if (waitS > 0) return j({ ok: false, error: `刚发过，等 ${waitS} 秒再发` });
  }
  const dev = env.EMAIL_DEV_MODE === '1';
  if (!dev && !env.RESEND_API_KEY) return j({ ok: false, error: '邮件服务还没配置（需要 Ken 加 RESEND_API_KEY），暂时绑不了' });
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  // Send first, store after: a stored code always matches an email that
  // actually went out (in dev mode nothing is sent and the code comes
  // back in the response instead).
  if (!dev && !await sendCodeMail(env, email, code)) return j({ ok: false, error: '邮件没发出去，稍后再试' });
  const record = { email, hash: await hashCode(user.name.toLowerCase(), email, code), sentAt: Date.now(), tries: 0 };
  await env.VOTES_KV.put(key, JSON.stringify(record), { expirationTtl: CODE_TTL_S });
  return j({ ok: true, sent: true, emailHint: maskEmail(email), ...(dev ? { devCode: code } : {}) });
}

// POST /api/auth/verify { name, code, purpose, deviceToken? }
// login success → the account's token (plus device vote migration).
// bind success → email attached AND the token rotated: the old token was
// public until now; rotating is what makes the binding mean anything.
// Other devices holding the old token fall into the code flow next login.
async function handleVerify(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const name = cleanName(body.name);
  const purpose = body.purpose === 'bind' ? 'bind' : 'login';
  const users = await getUsers(env);
  const user = users.find(u => sameName(u.name, name));
  if (!user) return j({ ok: false, error: '先选好你的名字' });
  const key = codeKey(purpose, user.name.toLowerCase());
  const raw = await env.VOTES_KV.get(key);
  if (!raw) return j({ ok: false, error: '验证码过期了，重新发一个' });
  const record = JSON.parse(raw);
  if (record.tries >= MAX_TRIES) {
    await env.VOTES_KV.delete(key);
    return j({ ok: false, error: '试太多次了，重新发一个' });
  }
  const hash = await hashCode(user.name.toLowerCase(), record.email, String(body.code || '').trim());
  if (hash !== record.hash) {
    record.tries += 1;
    const left = Math.max(0, Math.floor((record.sentAt + CODE_TTL_S * 1000 - Date.now()) / 1000));
    await env.VOTES_KV.put(key, JSON.stringify(record), { expirationTtl: Math.max(1, left) });
    return j({ ok: false, error: '验证码不对' });
  }
  await env.VOTES_KV.delete(key);
  if (purpose === 'login') {
    await migrateDeviceVotes(env, user, String(body.deviceToken || ''));
    return j({ ok: true, user: { name: user.name, token: user.token }, users: publicUsers(users) });
  }
  const out = await updateUsers(env, list => {
    const me = list.find(u => sameName(u.name, user.name));
    if (list.some(u => u !== me && u.email === record.email)) return { error: '这个邮箱刚刚被别人绑走了' };
    me.email = record.email;
    me.token = uid();
    return { user: me, users: list };
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j({ ok: true, user: { name: out.user.name, token: out.user.token }, email: record.email, users: publicUsers(out.users) });
}

// ---- PIN protection ----

const PIN_TRIES_KEY = userKey => `pintry:v1:${userKey}`;
const PIN_MAX_TRIES = 5;
const PIN_LOCK_MS = 10 * 60 * 1000;   // after 5 wrong tries
const PIN_TRY_TTL_S = 15 * 60;        // the counting window

async function hashPin(salt, pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${pin}`));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const validPin = pin => /^\d{4}$/.test(String(pin || ''));

// POST /api/auth/pin/set { name, token, pin }
// Caller must hold the account's current token (for an unprotected
// account that token is still public, by design — same rule as binding
// an email). Setting a PIN rotates the token, exactly like binding
// does: until now the token was public, and rotating is what makes the
// PIN mean anything. Changing the PIN rotates again, so a token that
// leaked anywhere stops working the moment the PIN changes.
async function handlePinSet(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const name = cleanName(body.name);
  const users = await getUsers(env);
  const user = users.find(u => sameName(u.name, name));
  if (!user) return j({ ok: false, error: '先选好你的名字' });
  if (String(body.token || '') !== user.token) return j({ ok: false, error: '先登录再设 PIN' });
  if (!validPin(body.pin)) return j({ ok: false, error: 'PIN 要是 4 位数字' });
  const salt = uid() + uid();
  const pinHash = await hashPin(salt, String(body.pin));
  const out = await updateUsers(env, list => {
    const me = list.find(u => sameName(u.name, user.name));
    me.pinSalt = salt;
    me.pinHash = pinHash;
    me.token = uid();
    return { user: me, users: list };
  });
  await env.VOTES_KV.delete(PIN_TRIES_KEY(user.name.toLowerCase())).catch(() => {});
  return j({ ok: true, user: { name: out.user.name, token: out.user.token }, users: publicUsers(out.users) });
}

// POST /api/auth/pin/verify { name, pin, deviceToken? }
// The PIN counterpart of the email code at login: success hands over
// the account's token (plus device vote migration). Wrong guesses are
// counted per account; the 5th locks PIN login for 10 minutes.
async function handlePinVerify(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const name = cleanName(body.name);
  const users = await getUsers(env);
  const user = users.find(u => sameName(u.name, name));
  if (!user) return j({ ok: false, error: '先选好你的名字' });
  if (!user.pinHash) return j({ ok: false, error: '这个账号还没设 PIN' });
  const key = PIN_TRIES_KEY(user.name.toLowerCase());
  const raw = await env.VOTES_KV.get(key);
  const rec = raw ? JSON.parse(raw) : { tries: 0, lockedUntil: 0 };
  if (rec.lockedUntil > Date.now()) {
    return j({ ok: false, error: `试太多次了，等 ${Math.ceil((rec.lockedUntil - Date.now()) / 60000)} 分钟再试${user.email ? '（也可以用邮箱验证码登录）' : ''}` });
  }
  const hash = await hashPin(user.pinSalt, String(body.pin || ''));
  if (hash !== user.pinHash) {
    rec.tries += 1;
    if (rec.tries >= PIN_MAX_TRIES) rec.lockedUntil = Date.now() + PIN_LOCK_MS;
    await env.VOTES_KV.put(key, JSON.stringify(rec), { expirationTtl: PIN_TRY_TTL_S });
    return j({ ok: false, error: rec.lockedUntil ? '试太多次了，PIN 登录先锁 10 分钟' : 'PIN 不对' });
  }
  await env.VOTES_KV.delete(key);
  await migrateDeviceVotes(env, user, String(body.deviceToken || ''));
  return j({ ok: true, user: { name: user.name, token: user.token }, users: publicUsers(users) });
}

// POST /api/auth/pin/remove { name, token }
// Back to an unprotected account — only with the account's token, so a
// borrowed device can't strip someone else's PIN.
async function handlePinRemove(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const name = cleanName(body.name);
  const users = await getUsers(env);
  const user = users.find(u => sameName(u.name, name));
  if (!user) return j({ ok: false, error: '先选好你的名字' });
  if (String(body.token || '') !== user.token) return j({ ok: false, error: '先登录再去掉 PIN' });
  const out = await updateUsers(env, list => {
    const me = list.find(u => sameName(u.name, user.name));
    delete me.pinSalt;
    delete me.pinHash;
    return { users: list };
  });
  return j({ ok: true, users: publicUsers(out.users) });
}

export const routes = {
  'POST /api/auth/send-code': handleSendCode,
  'POST /api/auth/verify': handleVerify,
  'POST /api/auth/pin/set': handlePinSet,
  'POST /api/auth/pin/verify': handlePinVerify,
  'POST /api/auth/pin/remove': handlePinRemove,
};
