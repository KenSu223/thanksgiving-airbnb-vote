// Rental cars: three 2026 BMW X5 M60s, five seats each. People claim a seat
// first come, first served (one seat per person; claiming another seat moves
// you), and say which luggage they bring from a few presets, so each car's
// trunk can be checked against what its passengers carry.
//
// Stored in the store (worker/store) under cars:v1:
//   { labels: { [carId]: string }, seats: { [carId]: { [seatId]: userKey } },
//     bags: { [userKey]: { [bagId]: count } } }
// userKey is the lowercased account name. Writes are version-checked
// (lib/store.js), so two people tapping the same seat in the same second get
// one winner and one "taken" error — never both.
import { j } from '../lib/http.js';
import { readDoc, transact } from '../lib/store.js';
import { cleanName, getUsers, sameName } from '../users/users.js';

const KEY = 'cars:v1';
const ADMIN = 'aster';
export const CARS = ['a', 'b', 'c'];
export const SEATS = ['driver', 'front', 'rearLeft', 'rearMiddle', 'rearRight'];
export const BAGS = ['backpack', 'carryon', 'medium', 'large', 'duffel', 'skis'];
const MAX_BAG = 6; // per kind, per person

const normalize = d => {
  if (!d || typeof d !== 'object') d = {};
  d.labels = d.labels && typeof d.labels === 'object' ? d.labels : {};
  d.seats = d.seats && typeof d.seats === 'object' ? d.seats : {};
  for (const c of CARS) if (!d.seats[c] || typeof d.seats[c] !== 'object') d.seats[c] = {};
  d.bags = d.bags && typeof d.bags === 'object' ? d.bags : {};
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
  return user && token && user.token === token ? { users, key: user.name.toLowerCase(), admin: user.name.toLowerCase() === ADMIN } : { users };
}
// Who a change is for: yourself, or (admin only) anyone on the user list.
function target(users, me, admin, who) {
  if (!who) return me;
  const u = users.find(x => sameName(x.name, cleanName(who)));
  if (!u) return null;
  const k = u.name.toLowerCase();
  return k === me || admin ? k : null;
}

// Where someone sits: { car, seat } or null.
export function seatOf(d, key) {
  for (const c of CARS) for (const s of SEATS) if (d.seats[c][s] === key) return { car: c, seat: s };
  return null;
}

export function view(d, users) {
  const nameOf = k => (users.find(u => u.name.toLowerCase() === k) || { name: k }).name;
  return {
    ok: true,
    cars: CARS.map(c => ({
      id: c, label: d.labels[c] || '',
      seats: Object.fromEntries(SEATS.map(s => [s, d.seats[c][s] ? nameOf(d.seats[c][s]) : null])),
    })),
    bags: Object.fromEntries(Object.entries(d.bags).filter(([, b]) => Object.values(b).some(n => n > 0)).map(([k, b]) => [nameOf(k), b])),
    people: users.map(u => u.name),
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
  const { users, key, admin } = await caller(env, b.name, b.token);
  if (!key) return j({ ok: false, error: '先登录再选座' });
  const who = target(users, key, admin, b.who);
  if (!who) return j({ ok: false, error: '只能给自己选座' });
  const car = CARS.includes(b.car) ? b.car : null, seat = SEATS.includes(b.seat) ? b.seat : null;
  if (b.seat != null && (!car || !seat)) return j({ ok: false, error: '没有这个座位' });
  const nameOf = k => (users.find(u => u.name.toLowerCase() === k) || { name: k }).name;
  const out = await update(env, d => {
    if (car && seat) {
      const holder = d.seats[car][seat];
      if (holder === who) return {};
      if (holder) return { error: '晚了一步，' + nameOf(holder) + ' 已经坐在这里了' };
    }
    const was = seatOf(d, who);
    if (was) delete d.seats[was.car][was.seat];
    if (car && seat) d.seats[car][seat] = who;
    return {};
  });
  if (out.error) return j({ ...view(await getDoc(env), users), ok: false, error: out.error });
  return j(view(await getDoc(env), users));
}

// Admin: clear any seat (someone who changed plans).
async function handleClear(req, env) {
  const b = await body(req);
  const { users, admin } = await caller(env, b.name, b.token);
  if (!admin) return j({ ok: false, error: '只有管理员可以清空别人的座位' });
  if (!CARS.includes(b.car) || !SEATS.includes(b.seat)) return j({ ok: false, error: '没有这个座位' });
  await update(env, d => { delete d.seats[b.car][b.seat]; return {}; });
  return j(view(await getDoc(env), users));
}

// How many of each preset bag someone brings: { bags: { carryon: 1, … } }.
async function handleBags(req, env) {
  const b = await body(req);
  const { users, key, admin } = await caller(env, b.name, b.token);
  if (!key) return j({ ok: false, error: '先登录再填行李' });
  const who = target(users, key, admin, b.who);
  if (!who) return j({ ok: false, error: '只能填自己的行李' });
  const bags = {};
  for (const id of BAGS) {
    const n = Math.round(Number((b.bags || {})[id]) || 0);
    if (n > 0) bags[id] = Math.min(n, MAX_BAG);
  }
  await update(env, d => { if (Object.keys(bags).length) d.bags[who] = bags; else delete d.bags[who]; return {}; });
  return j(view(await getDoc(env), users));
}

// Admin: give a car a nickname (rental company, colour, plate…).
async function handleLabel(req, env) {
  const b = await body(req);
  const { users, admin } = await caller(env, b.name, b.token);
  if (!admin) return j({ ok: false, error: '只有管理员可以改车名' });
  if (!CARS.includes(b.car)) return j({ ok: false, error: '没有这辆车' });
  const label = String(b.label || '').trim().slice(0, 40);
  await update(env, d => { if (label) d.labels[b.car] = label; else delete d.labels[b.car]; return {}; });
  return j(view(await getDoc(env), users));
}

// Account deletion (users/admin.js): free their seat and drop their luggage.
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
  'POST /api/cars/clear': handleClear,
  'POST /api/cars/bags': handleBags,
  'POST /api/cars/label': handleLabel,
};
