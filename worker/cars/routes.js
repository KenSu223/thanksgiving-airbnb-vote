// Rental cars: the group's cars, each a model from the catalog
// (web/src/features/cars/models.js — common US rental cars with their seat
// layout and trunk size) or "其他车型" (a name, a seat count, a trunk size).
// It starts as three BMW X5s. People claim a seat first come, first served
// (one seat per person; claiming another seat moves you), and say which
// luggage they bring from a few presets, so each car's trunk can be checked
// against what its passengers carry. Everyone has the same rights: you pick
// your own seat and your own luggage; anyone can give a car a nickname,
// change its model, add a car or take one away — the page asks first, and
// those three are logged with who did them.
//
// Stored in the store (worker/store) under cars:v1:
//   { fleet: [{ id, model, v?, custom? }], labels: { [carId]: string },
//     seats: { [carId]: { [seatId]: userKey } }, bags: { [userKey]: { [bagId]: count } },
//     log: [{ at, by, what }] }
// v: 1 = the model's other seat layout (7 / 8 seats); custom: { name, seats, trunk }.
// A doc from before models has no fleet: it is the three X5s (a, b, c), and
// the seats people took in them stay. userKey is the lowercased account name.
// Writes are version-checked (lib/store.js), so two people tapping the same
// seat in the same second get one winner and one "taken" error — never both.
import { j } from '../lib/http.js';
import { readDoc, transact } from '../lib/store.js';
import { cleanName, getUsers, sameName } from '../users/users.js';
import { TRUNKS, MIN_SEATS, MAX_SEATS, modelById, layoutOf, seatIds, seatName, modelName, modelTitle } from '../../web/src/features/cars/models.js';

const KEY = 'cars:v1';
export const BAGS = ['backpack', 'carryon', 'medium', 'large', 'duffel', 'skis'];
const MAX_BAG = 6; // per kind, per person
const MAX_CARS = 8, LOG_KEEP = 30;
const IDS = 'abcdefghijklmnop';

const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const normalize = d => {
  d = obj(d);
  if (!Array.isArray(d.fleet)) d.fleet = ['a', 'b', 'c'].map(id => ({ id, model: 'x5' }));
  d.labels = obj(d.labels);
  d.seats = obj(d.seats);
  for (const c of d.fleet) d.seats[c.id] = obj(d.seats[c.id]);
  d.bags = obj(d.bags);
  d.log = Array.isArray(d.log) ? d.log : [];
  return d;
};
const getDoc = async env => normalize((await readDoc(env, KEY)).doc);
async function update(env, fn) {
  return transact(env, KEY, async doc => {
    const d = normalize(doc);
    const result = await fn(d);
    return result && result.error ? { result } : { doc: d, result: result || {} };
  });
}

// The caller, if name and token match the user list; the list either way.
async function caller(env, name, token) {
  const users = await getUsers(env);
  const user = users.find(u => sameName(u.name, cleanName(name)));
  return user && token && user.token === token ? { users, key: user.name.toLowerCase(), me: user.name } : { users };
}
// Who a change is for: only ever yourself (an old page may still name you as `who`).
function target(users, me, who) {
  if (!who) return me;
  const u = users.find(x => sameName(x.name, cleanName(who)));
  return u && u.name.toLowerCase() === me ? me : null;
}

// Where someone sits: { car, seat } or null.
export function seatOf(d, key) {
  for (const c of d.fleet) for (const s of seatIds(layoutOf(c))) if (d.seats[c.id][s] === key) return { car: c.id, seat: s };
  return null;
}
const carNo = (d, id) => d.fleet.findIndex(c => c.id === id) + 1;
const carTitle = (d, id) => d.labels[id] || modelName(d.fleet.find(c => c.id === id)) + ' · ' + carNo(d, id);

// A model choice from the page: { model, v } from the catalog, or { model: 'custom', custom }.
function readChoice(b) {
  if (b.model === 'custom') {
    const c = obj(b.custom);
    const name = String(c.name || '').trim().slice(0, 30);
    const seats = Math.round(Number(c.seats));
    if (!name) return { error: '写一下是什么车' };
    if (!(seats >= MIN_SEATS && seats <= MAX_SEATS)) return { error: '座位数要在 ' + MIN_SEATS + '–' + MAX_SEATS + ' 之间' };
    const trunk = TRUNKS.some(t => t.id === c.trunk) ? c.trunk : 'M';
    return { model: 'custom', custom: { name, seats, trunk } };
  }
  const m = modelById(b.model);
  if (!m) return { error: '没有这个车型' };
  return { model: m.id, ...(b.v === 1 && m.alt ? { v: 1 } : {}) };
}

function note(d, by, what) {
  d.log.push({ at: Date.now(), by, what });
  if (d.log.length > LOG_KEEP) d.log.splice(0, d.log.length - LOG_KEEP);
}

export function view(d, users) {
  const nameOf = k => (users.find(u => u.name.toLowerCase() === k) || { name: k }).name;
  return {
    ok: true,
    cars: d.fleet.map(c => {
      const rows = layoutOf(c);
      return {
        id: c.id, label: d.labels[c.id] || '', model: c.model, v: c.v || 0, ...(c.custom ? { custom: c.custom } : {}), rows,
        seats: Object.fromEntries(seatIds(rows).map(s => [s, d.seats[c.id][s] ? nameOf(d.seats[c.id][s]) : null])),
      };
    }),
    bags: Object.fromEntries(Object.entries(d.bags).filter(([, b]) => Object.values(b).some(n => n > 0)).map(([k, b]) => [nameOf(k), b])),
    people: users.map(u => u.name),
    log: d.log.slice(-10).reverse(),
  };
}

async function body(req) { try { return await req.json() || {}; } catch (e) { return {}; } }

async function handleGet(req, env) {
  const users = await getUsers(env);
  return j(view(await getDoc(env), users));
}

// Take a seat (moving out of any other one), or give it up (seat: null).
async function handleSeat(req, env) {
  const b = await body(req);
  const { users, key } = await caller(env, b.name, b.token);
  if (!key) return j({ ok: false, error: '先登录再选座' });
  const who = target(users, key, b.who);
  if (!who) return j({ ok: false, error: '只能给自己选座' });
  const nameOf = k => (users.find(u => u.name.toLowerCase() === k) || { name: k }).name;
  const out = await update(env, d => {
    let car = null, seat = null;
    if (b.seat != null) {
      car = d.fleet.find(c => c.id === b.car);
      if (!car || !seatIds(layoutOf(car)).includes(b.seat)) return { error: '没有这个座位（车型可能刚换了，刷新看看）' };
      seat = b.seat;
      const holder = d.seats[car.id][seat];
      if (holder === who) return {};
      if (holder) return { error: '晚了一步，' + nameOf(holder) + ' 已经坐在这里了' };
    }
    const was = seatOf(d, who);
    if (was) delete d.seats[was.car][was.seat];
    if (car) d.seats[car.id][seat] = who;
    return {};
  });
  if (out.error) return j({ ...view(await getDoc(env), users), ok: false, error: out.error });
  return j(view(await getDoc(env), users));
}

// How many of each preset bag someone brings: { bags: { carryon: 1, … } }.
async function handleBags(req, env) {
  const b = await body(req);
  const { users, key } = await caller(env, b.name, b.token);
  if (!key) return j({ ok: false, error: '先登录再填行李' });
  const who = target(users, key, b.who);
  if (!who) return j({ ok: false, error: '只能填自己的行李' });
  const bags = {};
  for (const id of BAGS) {
    const n = Math.round(Number((b.bags || {})[id]) || 0);
    if (n > 0) bags[id] = Math.min(n, MAX_BAG);
  }
  await update(env, d => { if (Object.keys(bags).length) d.bags[who] = bags; else delete d.bags[who]; return {}; });
  return j(view(await getDoc(env), users));
}

// Anyone: give a car a nickname (rental company, colour, plate…).
async function handleLabel(req, env) {
  const b = await body(req);
  const { users, key } = await caller(env, b.name, b.token);
  if (!key) return j({ ok: false, error: '先登录再改车名' });
  const label = String(b.label || '').trim().slice(0, 40);
  const out = await update(env, d => {
    if (!d.fleet.some(c => c.id === b.car)) return { error: '没有这辆车' };
    if (label) d.labels[b.car] = label; else delete d.labels[b.car];
    return {};
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j(view(await getDoc(env), users));
}

// Anyone: change a car's model. Someone in a seat the new model doesn't have
// moves to an empty seat in the same car (a back seat first; never the
// driver's), or — if there's none — gets up and picks again; the answer and
// the log say who.
async function handleModel(req, env) {
  const b = await body(req);
  const { users, key, me } = await caller(env, b.name, b.token);
  if (!key) return j({ ok: false, error: '先登录再换车型' });
  const choice = readChoice(b);
  if (choice.error) return j({ ok: false, error: choice.error });
  const nameOf = k => (users.find(u => u.name.toLowerCase() === k) || { name: k }).name;
  const out = await update(env, d => {
    const car = d.fleet.find(c => c.id === b.car);
    if (!car) return { error: '没有这辆车' };
    const before = carTitle(d, car.id), oldRows = layoutOf(car);
    const next = { id: car.id, ...choice };
    if (JSON.stringify({ ...car, id: 0 }) === JSON.stringify({ ...next, id: 0 })) return { error: '已经是这个车型了' };
    const ids = seatIds(layoutOf(next));
    const seats = d.seats[car.id], kept = {}, bumped = [];
    for (const s of seatIds(oldRows)) {
      if (!seats[s]) continue;
      if (ids.includes(s)) kept[s] = seats[s]; else bumped.push(seats[s]);
    }
    const moved = [], unseated = [];
    const front = s => s === 'front' || s === 'frontMiddle';
    const order = ids.filter(s => s !== 'driver' && !front(s)).concat(ids.filter(front)); // back seats first, never the driver's
    for (const who of bumped) {
      const free = order.find(s => !kept[s]);
      if (free) { kept[free] = who; moved.push(nameOf(who) + ' → ' + seatName(free, layoutOf(next))); }
      else unseated.push(nameOf(who));
    }
    Object.assign(car, next);
    if (!next.v) delete car.v;
    if (!next.custom) delete car.custom;
    d.seats[car.id] = kept;
    note(d, me, '把 ' + before + ' 换成了 ' + modelTitle(car)
      + (moved.length ? '，挪了座：' + moved.join('、') : '') + (unseated.length ? '，' + unseated.join('、') + ' 要重新选座' : ''));
    return { moved, unseated };
  });
  if (out.error) return j({ ...view(await getDoc(env), users), ok: false, error: out.error });
  return j({ ...view(await getDoc(env), users), moved: out.moved, unseated: out.unseated });
}

// Anyone: add a car (up to 8).
async function handleAdd(req, env) {
  const b = await body(req);
  const { users, key, me } = await caller(env, b.name, b.token);
  if (!key) return j({ ok: false, error: '先登录再加车' });
  const choice = readChoice(b);
  if (choice.error) return j({ ok: false, error: choice.error });
  const out = await update(env, d => {
    if (d.fleet.length >= MAX_CARS) return { error: '最多 ' + MAX_CARS + ' 辆车' };
    const id = [...IDS].find(x => !d.fleet.some(c => c.id === x));
    const car = { id, ...choice };
    d.fleet.push(car);
    d.seats[id] = {};
    delete d.labels[id];
    note(d, me, '加了一辆 ' + modelTitle(car));
    return { id };
  });
  if (out.error) return j({ ...view(await getDoc(env), users), ok: false, error: out.error });
  return j({ ...view(await getDoc(env), users), added: out.id });
}

// Anyone: take a car away (at least one stays). People in it get up and pick again.
async function handleRemove(req, env) {
  const b = await body(req);
  const { users, key, me } = await caller(env, b.name, b.token);
  if (!key) return j({ ok: false, error: '先登录再去掉车' });
  const nameOf = k => (users.find(u => u.name.toLowerCase() === k) || { name: k }).name;
  const out = await update(env, d => {
    const i = d.fleet.findIndex(c => c.id === b.car);
    if (i < 0) return { error: '没有这辆车' };
    if (d.fleet.length <= 1) return { error: '至少留一辆车' };
    const title = carTitle(d, b.car);
    const unseated = Object.values(d.seats[b.car] || {}).filter(Boolean).map(nameOf);
    d.fleet.splice(i, 1);
    delete d.seats[b.car];
    delete d.labels[b.car];
    note(d, me, '去掉了 ' + title + (unseated.length ? '，' + unseated.join('、') + ' 要重新选座' : ''));
    return { unseated };
  });
  if (out.error) return j({ ...view(await getDoc(env), users), ok: false, error: out.error });
  return j({ ...view(await getDoc(env), users), unseated: out.unseated });
}

// A retired account (users/retire.js): free their seat and drop their luggage.
export async function scrubUserFromCars(env, user) {
  const key = user.name.toLowerCase();
  await update(env, d => {
    const was = seatOf(d, key);
    if (was) delete d.seats[was.car][was.seat];
    delete d.bags[key];
    return {};
  });
}

export const routes = {
  'GET /api/cars': handleGet,
  'POST /api/cars/seat': handleSeat,
  'POST /api/cars/bags': handleBags,
  'POST /api/cars/label': handleLabel,
  'POST /api/cars/model': handleModel,
  'POST /api/cars/add': handleAdd,
  'POST /api/cars/remove': handleRemove,
};
