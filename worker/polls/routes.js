// Quick polls: anyone can start one (a question, 2-4 options, an
// optional picture); it pops up on everyone's screen, they tap an
// option, and the card folds away into the floating poll button.
// Deliberately NOT a tab — the client side is one App-level component
// (web/src/components/PollFab.jsx) that polls this endpoint.
//
// Stored in the store (worker/store) under polls:v1. Votes live on the
// poll as { voterKey: optionId } — one vote per account, changeable
// while the poll is live, exactly like the app's other votes. Polls
// are public within the group: counts and who picked what are shown.
import { j, uid } from '../lib/http.js';
import { readDoc, transact } from '../lib/store.js';
import { cleanName, getUsers, sameName } from '../users/users.js';

const POLLS_KEY = 'polls:v1';
const KEEP = 50; // finished polls stay readable in the centre, oldest dropped past this
const DURATIONS_MIN = [10, 60]; // anything else means "until the starter ends it"

const emptyDoc = () => ({ polls: [] });
const normalize = d => {
  if (!d || typeof d !== 'object') d = emptyDoc();
  if (!Array.isArray(d.polls)) d.polls = [];
  return d;
};
const getDoc = async env => normalize((await readDoc(env, POLLS_KEY)).doc);

// fn(d) mutates the freshest document and returns the handler's result;
// the commit is version-checked (see lib/store.js), so a roomful of
// people voting in the same second can't erase each other.
async function updatePolls(env, fn) {
  return transact(env, POLLS_KEY, async doc => {
    const d = normalize(doc);
    const result = await fn(d);
    return { doc: d, result };
  });
}

// The caller, if their name and token match the user list (same check
// as Secret Angel / sitting at a game table). GET works without one —
// the list is group-public — it just can't say which vote is yours.
async function caller(env, name, token) {
  const users = await getUsers(env);
  const user = users.find(u => sameName(u.name, cleanName(name)));
  return user && token && user.token === token ? { users, user, key: user.name.toLowerCase() } : { users };
}

const statusOf = (p, now) => p.closedAt ? 'closed' : (p.endsAt && now >= p.endsAt ? 'ended' : 'active');

function view(doc, users, meKey, now) {
  const nameOf = key => { const u = users.find(x => x.name.toLowerCase() === key); return u ? u.name : key; };
  return {
    ok: true,
    polls: doc.polls.map(p => {
      const counts = {}, voters = {};
      for (const o of p.options) { counts[o.id] = 0; voters[o.id] = []; }
      for (const [k, oid] of Object.entries(p.votes || {})) {
        if (counts[oid] !== undefined) { counts[oid]++; voters[oid].push(nameOf(k)); }
      }
      return {
        id: p.id, q: p.q, img: p.img || '', by: nameOf(p.byKey), byKey: p.byKey,
        at: p.at, endsAt: p.endsAt || null, closedAt: p.closedAt || null,
        status: statusOf(p, now),
        options: p.options.map(o => ({ id: o.id, text: o.text, count: counts[o.id], voters: voters[o.id] })),
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        myVote: meKey ? (p.votes[meKey] || null) : null,
      };
    }),
  };
}

async function handleGet(req, env, url) {
  const { users, key } = await caller(env, url.searchParams.get('name'), url.searchParams.get('token'));
  return j(view(await getDoc(env), users, key, Date.now()));
}

async function handleCreate(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const { users, key } = await caller(env, body.name, body.token);
  if (!key) return j({ ok: false, error: '先登录' });
  const q = String(body.q || '').trim().slice(0, 120);
  if (!q) return j({ ok: false, error: '先写个问题' });
  const raw = Array.isArray(body.options) ? body.options : [];
  if (raw.length > 4) return j({ ok: false, error: '最多 4 个选项' });
  const texts = raw.map(s => String(s || '').trim().slice(0, 60)).filter(Boolean);
  if (texts.length < 2) return j({ ok: false, error: '至少要两个选项' });
  if (new Set(texts.map(t => t.toLowerCase())).size !== texts.length) return j({ ok: false, error: '选项不能重复' });
  const img = String(body.img || '').trim().slice(0, 500);
  if (img && !/^https?:\/\//i.test(img)) return j({ ok: false, error: '图片链接要以 http 开头' });
  const now = Date.now();
  const mins = Number(body.durationMin);
  const poll = {
    id: uid(), q, img,
    options: texts.map(text => ({ id: uid(), text })),
    votes: {}, byKey: key, at: now,
    endsAt: DURATIONS_MIN.includes(mins) ? now + mins * 60000 : null,
    closedAt: null,
  };
  const doc = await updatePolls(env, d => { d.polls.unshift(poll); d.polls = d.polls.slice(0, KEEP); return d; });
  return j(view(doc, users, key, now));
}

async function handleVote(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const { users, key } = await caller(env, body.name, body.token);
  if (!key) return j({ ok: false, error: '先登录' });
  const out = await updatePolls(env, d => {
    const p = d.polls.find(x => x.id === body.pollId);
    if (!p) return { error: '投票不存在' };
    if (statusOf(p, Date.now()) !== 'active') return { error: '这个投票已经结束了' };
    if (!p.options.some(o => o.id === body.optionId)) return { error: '没有这个选项' };
    p.votes[key] = body.optionId; // voting again just moves the vote
    return { doc: d };
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j(view(out.doc, users, key, Date.now()));
}

async function handleClose(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const { users, key } = await caller(env, body.name, body.token);
  if (!key) return j({ ok: false, error: '先登录' });
  const out = await updatePolls(env, d => {
    const p = d.polls.find(x => x.id === body.pollId);
    if (!p) return { error: '投票不存在' };
    if (p.byKey !== key) return { error: '只有发起人能结束' };
    if (!p.closedAt) p.closedAt = Date.now();
    return { doc: d };
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j(view(out.doc, users, key, Date.now()));
}

async function handleDelete(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const { users, key } = await caller(env, body.name, body.token);
  if (!key) return j({ ok: false, error: '先登录' });
  const out = await updatePolls(env, d => {
    const i = d.polls.findIndex(x => x.id === body.pollId);
    if (i < 0) return { error: '投票不存在' };
    if (d.polls[i].byKey !== key) return { error: '只有发起人能删除' };
    d.polls.splice(i, 1);
    return { doc: d };
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j(view(out.doc, users, key, Date.now()));
}

// Remove one person's votes everywhere (thorough user deletion,
// users/retire.js). Polls they started stay — others have voted in
// them, same as cards they added stay in the other features.
export async function scrubUserFromPolls(env, user) {
  const key = user.name.toLowerCase();
  let removed = 0;
  await updatePolls(env, d => {
    for (const p of d.polls) if (p.votes && key in p.votes) { delete p.votes[key]; removed++; }
    return d;
  });
  return removed;
}

export const routes = {
  'GET /api/polls': handleGet,
  'POST /api/polls': handleCreate,
  'POST /api/polls/vote': handleVote,
  'POST /api/polls/close': handleClose,
  'POST /api/polls/delete': handleDelete,
};
