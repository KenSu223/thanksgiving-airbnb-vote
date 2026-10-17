// Secret Angel: everyone answers a few questions about themselves (five of
// the ten in web/src/features/angel/questions.js, "what can't I be given"
// always among them) so a stranger can pick them a gift; then anyone draws who
// gives a gift to whom (everyone has the same rights — there's no admin;
// the draw, a reshuffle and leaving someone out are logged with who did it). Each person is only ever sent their
// own match. Stored in the store (worker/store) under angel:v1 — its old
// KV key, imported on first read — keyed by lower-cased user name.
import { j } from '../lib/http.js';
import { readDoc, transact } from '../lib/store.js';
import { cleanName, getUsers, sameName } from '../users/users.js';
import { drawCycle } from './draw.js';
import { cleanAnswers, answersError } from '../../web/src/features/angel/questions.js';

const ANGEL_KEY = 'angel:v1';
const KEEP_LOG = 20;

const emptyAngel = () => ({ prefs: {}, excluded: [], draw: null });
const normalizeAngel = a => {
  if (!a || typeof a !== 'object') a = emptyAngel();
  if (!a.prefs) a.prefs = {};
  if (!Array.isArray(a.excluded)) a.excluded = [];
  if (!('draw' in a)) a.draw = null;
  if (!Array.isArray(a.log)) a.log = [];
  delete a.admin; // the old admin role (gone: everyone can draw)
  return a;
};

async function getAngel(env) {
  const { doc } = await readDoc(env, ANGEL_KEY);
  return normalizeAngel(doc);
}

// fn(a) mutates the freshest angel document and returns the handler's
// result; the commit is version-checked (see lib/store.js), so two
// people saving wishes in the same second can't erase each other.
async function updateAngel(env, fn) {
  return transact(env, ANGEL_KEY, async doc => {
    const a = normalizeAngel(doc);
    const result = await fn(a);
    return { doc: a, result };
  });
}

// The caller, if their name and token match the user list (same check as
// sitting down at Blackjack).
async function caller(env, name, token) {
  const users = await getUsers(env);
  const user = users.find(u => sameName(u.name, cleanName(name)));
  return user && token && user.token === token ? { users, user, key: user.name.toLowerCase() } : { users };
}

// Who did what, newest last (shown under the draw).
const note = (a, by, what) => { a.log.push({ by, what, at: Date.now() }); if (a.log.length > KEEP_LOG) a.log.splice(0, a.log.length - KEEP_LOG); };

// Who's in: every user nobody has left out.
const roster = (users, a) => users
  .map(u => ({ key: u.name.toLowerCase(), name: u.name }))
  .filter(u => !a.excluded.includes(u.key))
  .sort((x, y) => x.name.localeCompare(y.name, 'zh-CN'));

// What the page gets of someone's saved wishes: their answers. Wishes saved
// before the questions (gift categories, picks) show only their note, until
// that person answers the questions.
const shownPrefs = p => (p ? { answers: p.answers || null, note: p.answers ? '' : p.note || '', updatedAt: p.updatedAt || 0 } : null);

function view(users, a, me) {
  // submitted: answered the questions. inPool: has saved anything (old category
  // wishes too), so a reshuffle never drops someone who joined before the questions.
  const people = users.map(u => {
    const key = u.name.toLowerCase();
    return { name: u.name, submitted: !!a.prefs[key]?.answers, inPool: !!a.prefs[key], excluded: a.excluded.includes(key) };
  }).sort((x, y) => x.name.localeCompare(y.name, 'zh-CN'));
  const masterKey = me && a.draw ? a.draw.pairs[me] : null;
  const master = masterKey ? users.find(u => u.name.toLowerCase() === masterKey) : null;
  return {
    ok: true,
    people,
    drawn: !!a.draw, drawnAt: a.draw ? a.draw.at : null, drawnBy: a.draw?.by || null,
    log: a.log.slice(-8),
    inDraw: !!(me && a.draw && a.draw.pairs[me]),
    mine: me ? shownPrefs(a.prefs[me]) : null,
    master: master ? { name: master.name, prefs: shownPrefs(a.prefs[masterKey]) } : null,
  };
}

async function handleGet(req, env, url) {
  const { users, key } = await caller(env, url.searchParams.get('name'), url.searchParams.get('token'));
  return j(view(users, await getAngel(env), key));
}

async function handlePrefs(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const { users, key } = await caller(env, body.name, body.token);
  if (!key) return j({ ok: false, error: '先登录' });
  const answers = cleanAnswers(body.answers);
  const wrong = answersError(answers);
  if (wrong) return j({ ok: false, error: wrong });
  const a = await updateAngel(env, a => {
    a.prefs[key] = { answers, updatedAt: Date.now() }; // replaces any old category wishes
    return a;
  });
  return j(view(users, a, key));
}

// Anyone: leave someone out (or back in), e.g. a name on the list who isn't coming.
async function handleExclude(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const { users, user, key } = await caller(env, body.name, body.token);
  const target = cleanName(body.target).toLowerCase();
  const out = await updateAngel(env, a => {
    if (!key) return { error: '先登录' };
    const t = users.find(u => u.name.toLowerCase() === target);
    if (!t) return { error: '没有这个人' };
    a.excluded = a.excluded.filter(k => k !== target);
    if (body.excluded) a.excluded.push(target);
    note(a, user.name, (body.excluded ? '把 ' + t.name + ' 排除了' : '把 ' + t.name + ' 加回来了'));
    return { a };
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j(view(users, out.a, key));
}

// Anyone: draw (or redraw / reshuffle). The pool is whoever is in AND
// has saved preferences — no need to wait for stragglers: anyone who
// hasn't filled theirs in yet sits this round out, and a redraw after
// they submit pools them in. A redraw only replaces the pairings;
// saved preferences are never touched here.
async function handleDraw(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const { users, user, key } = await caller(env, body.name, body.token);
  const out = await updateAngel(env, a => {
    if (!key) return { error: '先登录再抽签' };
    const pool = roster(users, a).filter(p => a.prefs[p.key]);
    if (pool.length < 2) return { error: '至少要有两个人答好题才能抽（现在 ' + pool.length + ' 人）' };
    const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const pairs = drawCycle(pool.map(p => p.key), rand);
    if (!pairs) return { error: '至少要两个人才能抽' };
    note(a, user.name, a.draw ? '重新 Shuffle 了（' + pool.length + ' 人）' : '抽了签（' + pool.length + ' 人）');
    a.draw = { at: Date.now(), pairs, by: user.name };
    return { a };
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j(view(users, out.a, key));
}

// Remove one person from Secret Angel entirely (a retired account,
// users/retire.js): their saved prefs and any exclusion entry. If a draw exists, their seat is spliced out of the cycle —
// whoever was giving to them now gives to their person — so the rest
// of the circle stays intact; with fewer than two left, the draw goes.
export async function scrubUserFromAngel(env, user) {
  const key = user.name.toLowerCase();
  await updateAngel(env, a => {
    delete a.prefs[key];
    a.excluded = a.excluded.filter(k => k !== key);
    if (a.draw && a.draw.pairs && key in a.draw.pairs) {
      const pairs = a.draw.pairs;
      const next = pairs[key];
      const pred = Object.keys(pairs).find(k => pairs[k] === key);
      delete pairs[key];
      if (Object.keys(pairs).length < 2) a.draw = null;
      else if (pred) pairs[pred] = next;
    }
    return a;
  });
}

export const routes = {
  'GET /api/angel': handleGet,
  'POST /api/angel/prefs': handlePrefs,
  'POST /api/angel/exclude': handleExclude,
  'POST /api/angel/draw': handleDraw,
};
