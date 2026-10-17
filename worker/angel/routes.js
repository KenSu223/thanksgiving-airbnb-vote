// Secret Angel: everyone answers exactly five of ten question cards about
// themselves (web/src/features/angel/questions.js, "what can't I be given"
// always among them) so a stranger can pick them a gift; then anyone draws who
// gives a gift to whom (everyone has the same rights — there's no admin;
// the draw, a reshuffle and leaving someone out are logged with who did it). Each person is only ever sent their
// own match. Stored in the store (worker/store) under angel:v1 — its old
// KV key, imported on first read — keyed by lower-cased user name.
import { j } from '../lib/http.js';
import { readDoc, transact } from '../lib/store.js';
import { cleanName, getUsers, sameName } from '../users/users.js';
import { drawCycle, removeFromCycle, MIN_DRAW } from './draw.js';
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
  // submitted: answered the questions. inDraw: in the current circle (who gives to
  // whom stays private; only whether someone is in it). Everyone registered and not
  // left out goes into a draw, answered or not.
  const people = users.map(u => {
    const key = u.name.toLowerCase();
    return { name: u.name, submitted: !!a.prefs[key]?.answers, inDraw: !!(a.draw && key in a.draw.pairs), excluded: a.excluded.includes(key) };
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
    // Left out after a draw: out of the circle too. Whoever gave to them now gives to
    // the person they were giving to, nobody else changes; with fewer than three left
    // the draw goes (two could only swap). Coming back doesn't put them in the circle:
    // that takes a reshuffle, like anyone who joins after the draw.
    let cleared = false;
    if (body.excluded && a.draw && target in a.draw.pairs) {
      const pairs = removeFromCycle(a.draw.pairs, target);
      if (pairs) a.draw.pairs = pairs; else { a.draw = null; cleared = true; }
    }
    note(a, user.name, (body.excluded ? '把 ' + t.name + ' 排除了' : '把 ' + t.name + ' 加回来了')
      + (cleared ? '（抽签结果剩不到 ' + MIN_DRAW + ' 人，清掉了，要重新抽）' : ''));
    return { a };
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j(view(users, out.a, key));
}

// Anyone: draw (or redraw / reshuffle). Everyone registered goes into the
// circle except whoever was left out — answered or not: someone who hasn't
// answered yet is still somebody's to give to, and their angel sees their
// answers as soon as they're in. People who register after a draw join at the
// next reshuffle. A redraw only replaces the pairings; answers are never
// touched here.
async function handleDraw(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const { users, user, key } = await caller(env, body.name, body.token);
  const out = await updateAngel(env, a => {
    if (!key) return { error: '先登录再抽签' };
    const pool = roster(users, a);
    if (pool.length < MIN_DRAW) return { error: '至少要 ' + MIN_DRAW + ' 个人才能抽（两个人只能互送；现在 ' + pool.length + ' 人）' };
    const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    const pairs = drawCycle(pool.map(p => p.key), rand);
    if (!pairs) return { error: '至少要 ' + MIN_DRAW + ' 个人才能抽' };
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
// of the circle stays intact; with fewer than three left (two could only swap), the draw goes.
export async function scrubUserFromAngel(env, user) {
  const key = user.name.toLowerCase();
  await updateAngel(env, a => {
    delete a.prefs[key];
    a.excluded = a.excluded.filter(k => k !== key);
    if (a.draw && a.draw.pairs && key in a.draw.pairs) {
      const pairs = removeFromCycle(a.draw.pairs, key); // same as leaving someone out
      if (pairs) a.draw.pairs = pairs; else a.draw = null;
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
