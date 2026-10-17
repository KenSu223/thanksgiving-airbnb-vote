// The member list after email binding was removed (worker/users/users.js):
// emails stored from back then are dropped, once, the first time the list is
// read; an account that was protected only by its email is open again (its
// token travels with the public list, like anyone without a PIN); a PIN still
// protects. Run: node --test worker/users/users.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getUsers, updateUsers, publicUsers } from './users.js';

const copy = x => JSON.parse(JSON.stringify(x));
// The storekeeper Durable Object (lib/store.js: /read and versioned /commit), in memory.
function fakeEnv(docs) {
  const m = new Map(Object.entries(docs).map(([k, doc]) => [k, { doc, v: 1 }]));
  let commits = 0;
  const fetch = async (url, init) => {
    const path = new URL(url).pathname, body = JSON.parse(init.body), cur = m.get(body.key);
    if (path === '/read') return Response.json(cur ? { found: true, doc: copy(cur.doc), v: cur.v } : { found: false, v: 0 });
    if ((cur?.v || 0) !== body.base) return Response.json({ ok: false });
    m.set(body.key, { doc: body.doc, v: (cur?.v || 0) + 1 }); commits++;
    return Response.json({ ok: true });
  };
  return { env: { STORE: { idFromName: () => 'main', get: () => ({ fetch }) } }, stored: () => m.get('users:v1').doc, commits: () => commits };
}

const OLD = [
  { name: 'Ken', token: 'tk', email: 'ken@example.com', createdAt: 1 },                          // email only
  { name: 'PM', token: 'tp', email: 'pm@example.com', pinSalt: 's', pinHash: 'h', createdAt: 2 }, // email + PIN
  { name: 'Bo', token: 'tb', createdAt: 3 },                                                     // nothing
];

test('emails stored from before are dropped on the first read, and only then', async () => {
  const f = fakeEnv({ 'users:v1': copy(OLD) });
  const users = await getUsers(f.env);
  assert.ok(users.every(u => !('email' in u)), 'none in what comes back');
  assert.ok(f.stored().every(u => !('email' in u)), 'none stored');
  assert.equal(f.commits(), 1);
  assert.deepEqual(f.stored().find(u => u.name === 'PM'), { name: 'PM', token: 'tp', pinSalt: 's', pinHash: 'h', createdAt: 2 }, 'the rest of the record stays');
  await getUsers(f.env);
  assert.equal(f.commits(), 1, 'a clean list is not written again');
});

test('email-only accounts are open again; a PIN still hides the token', async () => {
  const f = fakeEnv({ 'users:v1': copy(OLD) });
  const pub = publicUsers(await getUsers(f.env));
  assert.deepEqual(pub.find(u => u.name === 'Ken'), { name: 'Ken', token: 'tk' });
  assert.deepEqual(pub.find(u => u.name === 'PM'), { name: 'PM', pinBound: true });
  assert.deepEqual(pub.find(u => u.name === 'Bo'), { name: 'Bo', token: 'tb' });
  assert.ok(pub.every(u => !('emailBound' in u) && !('emailHint' in u)));
});

test('any write to the list drops leftover emails too', async () => {
  const f = fakeEnv({ 'users:v1': copy(OLD) });
  await updateUsers(f.env, list => { list.find(u => u.name === 'Bo').token = 'new'; return null; });
  assert.ok(f.stored().every(u => !('email' in u)));
  assert.equal(f.stored().find(u => u.name === 'Bo').token, 'new');
});
