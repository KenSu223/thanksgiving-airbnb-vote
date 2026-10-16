// To-dos: anything the group needs done — before the trip, during it, or
// after. Anyone signed in can add one and assign people to it; anyone can
// pick up a task themselves (我来) or drop out of one, and tick it done.
// Editing, assigning and deleting is for whoever added it (everyone has the same rights).
//
// Stored in the store (worker/store) under todos:v1:
//   { items: [{ id, title, note, phase, due, assignees: [userKey], byKey, at,
//               doneAt, doneByKey }] }
// userKey is the lowercased account name. Writes are version-checked
// (lib/store.js), so two people picking up the same task at once both land.
import { j, uid } from '../lib/http.js';
import { readDoc, transact } from '../lib/store.js';
import { cleanName, getUsers, sameName } from '../users/users.js';

const KEY = 'todos:v1';
export const PHASES = ['pre', 'during', 'post'];
const MAX_ITEMS = 300;

const normalize = d => {
  if (!d || typeof d !== 'object') d = {};
  if (!Array.isArray(d.items)) d.items = [];
  return d;
};
const getDoc = async env => normalize((await readDoc(env, KEY)).doc);
async function update(env, fn) {
  return transact(env, KEY, async doc => {
    const d = normalize(doc);
    const result = (await fn(d)) || {};
    return result.error ? { result } : { doc: d, result };
  });
}

async function caller(env, name, token) {
  const users = await getUsers(env);
  const user = users.find(u => sameName(u.name, cleanName(name)));
  return user && token && user.token === token ? { users, key: user.name.toLowerCase() } : { users };
}
const keyOf = (users, name) => { const u = users.find(x => sameName(x.name, cleanName(name))); return u ? u.name.toLowerCase() : null; };

export function view(d, users) {
  const nameOf = k => (users.find(u => u.name.toLowerCase() === k) || { name: k }).name;
  return {
    ok: true,
    items: d.items.map(t => ({
      id: t.id, title: t.title, note: t.note || '', phase: t.phase, due: t.due || '',
      assignees: (t.assignees || []).map(nameOf), by: nameOf(t.byKey), at: t.at,
      done: !!t.doneAt, doneAt: t.doneAt || null, doneBy: t.doneByKey ? nameOf(t.doneByKey) : '',
    })),
  };
}

// Title / note / phase / due from a request, validated. { error } or { fields }.
function readFields(b, partial) {
  const f = {};
  if (!partial || 'title' in b) {
    f.title = String(b.title || '').trim().slice(0, 120);
    if (!f.title) return { error: '写一下要做什么' };
  }
  if (!partial || 'note' in b) f.note = String(b.note || '').trim().slice(0, 500);
  if (!partial || 'phase' in b) {
    f.phase = PHASES.includes(b.phase) ? b.phase : 'pre';
  }
  if (!partial || 'due' in b) {
    const due = String(b.due || '');
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { error: '日期格式不对' };
    f.due = due;
  }
  return { fields: f };
}
// Names -> known user keys (unknown names are dropped), no repeats.
const readAssignees = (users, list) => [...new Set((Array.isArray(list) ? list : []).map(n => keyOf(users, n)).filter(Boolean))].slice(0, 20);

async function body(req) { try { return await req.json() || {}; } catch (e) { return {}; } }
const reply = async (env, users, out) => (out && out.error
  ? j({ ...view(await getDoc(env), users), ok: false, error: out.error })
  : j(view(await getDoc(env), users)));

async function handleGet(req, env) {
  return j(view(await getDoc(env), await getUsers(env)));
}

async function handleAdd(req, env) {
  const b = await body(req);
  const { users, key } = await caller(env, b.name, b.token);
  if (!key) return j({ ok: false, error: '先登录再加待办' });
  const r = readFields(b, false);
  if (r.error) return j({ ok: false, error: r.error });
  const item = { id: uid(), ...r.fields, assignees: readAssignees(users, b.assignees), byKey: key, at: Date.now(), doneAt: null, doneByKey: null };
  const out = await update(env, d => {
    if (d.items.length >= MAX_ITEMS) return { error: '待办太多了，先清掉一些做完的' };
    d.items.unshift(item);
    return { id: item.id };
  });
  return reply(env, users, out);
}

// One task, changed by someone signed in. fn(item, key) returns { error } or nothing.
async function onItem(req, env, fn) {
  const b = await body(req);
  const { users, key } = await caller(env, b.name, b.token);
  if (!key) return j({ ok: false, error: '先登录' });
  const out = await update(env, d => {
    const t = d.items.find(x => x.id === b.id);
    if (!t) return { error: '这条待办不在了' };
    return fn(t, key, b, users, d);
  });
  return reply(env, users, out);
}
const canEdit = (t, key) => key === t.byKey;

// Pick up a task (我来) or drop out of it.
const handleClaim = (req, env) => onItem(req, env, (t, key, b) => {
  const set = new Set(t.assignees || []);
  if (b.claim === false) set.delete(key); else set.add(key);
  t.assignees = [...set];
});

// Set who's on it (whoever added it).
const handleAssign = (req, env) => onItem(req, env, (t, key, b, users) => {
  if (!canEdit(t, key)) return { error: '只有加这条的人能指派' };
  t.assignees = readAssignees(users, b.assignees);
});

// Tick done / not done — anyone (it's the group's list).
const handleDone = (req, env) => onItem(req, env, (t, key, b) => {
  if (b.done === false) { t.doneAt = null; t.doneByKey = null; return; }
  t.doneAt = Date.now(); t.doneByKey = key;
});

const handleEdit = (req, env) => onItem(req, env, (t, key, b) => {
  if (!canEdit(t, key)) return { error: '只有加这条的人能改' };
  const r = readFields(b, true);
  if (r.error) return r;
  Object.assign(t, r.fields);
});

const handleDelete = (req, env) => onItem(req, env, (t, key, b, users, d) => {
  if (!canEdit(t, key)) return { error: '只有加这条的人能删' };
  d.items = d.items.filter(x => x.id !== t.id);
});

// A retired account (users/retire.js): off every task; tasks they added stay.
export async function scrubUserFromTodos(env, user) {
  const key = user.name.toLowerCase();
  await update(env, d => {
    for (const t of d.items) {
      t.assignees = (t.assignees || []).filter(k => k !== key);
      if (t.doneByKey === key) t.doneByKey = null;
    }
  });
}

export const routes = {
  'GET /api/todos': handleGet,
  'POST /api/todos': handleAdd,
  'POST /api/todos/claim': handleClaim,
  'POST /api/todos/assign': handleAssign,
  'POST /api/todos/done': handleDone,
  'POST /api/todos/edit': handleEdit,
  'POST /api/todos/delete': handleDelete,
};
