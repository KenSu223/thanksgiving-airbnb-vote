// Account protection (see users.js for the account list itself): a 4-digit
// PIN the user picks. It "protects" the account — the token stops
// travelling with the public list, and a device that doesn't hold it
// must prove itself with the PIN.
//
// Flow: set the PIN while holding the token (which also rotates the
// token, so the old public one stops working); after that, logging in as
// that account from a device that doesn't already hold its token asks for
// the PIN, and devices with the token cached are never interrupted (see
// handleLogin in users.js). Only 10,000 combinations exist, so guessing is
// throttled hard: 5 wrong tries lock PIN login for the account for 10
// minutes (the tries live in KV under pintry:v1:*).
//
// (There used to be a second protection, an email bound with a code; it
// was removed — the PIN is enough. users.js drops any stored emails.)
import { j, uid } from '../lib/http.js';
import { getUsers, updateUsers, publicUsers, sameName, cleanName, migrateDeviceVotes } from './users.js';

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
// account that token is still public, by design). Setting a PIN rotates
// the token: until now the token was public, and rotating is what makes
// the PIN mean anything. Changing the PIN rotates again, so a token that
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
// Logging in on a new device: success hands over the account's token
// (plus device vote migration). Wrong guesses are counted per account;
// the 5th locks PIN login for 10 minutes.
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
    return j({ ok: false, error: `试太多次了，${Math.ceil((rec.lockedUntil - Date.now()) / 60000)} 分钟后再试` });
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
  'POST /api/auth/pin/set': handlePinSet,
  'POST /api/auth/pin/verify': handlePinVerify,
  'POST /api/auth/pin/remove': handlePinRemove,
};
