// Flights: everyone's arrival and departure flight. Members type the flight
// number, date, the other airport and the two local times; the server checks
// the airports against the airport list, works out UTC times and duration
// across time zones, and sends back airport details for the map.
// Stored in the store (worker/store) under flights:v1 — its old KV key,
// imported on first read — keyed by lower-cased user name.
import { j } from '../lib/http.js';
import { readDoc, transact } from '../lib/store.js';
import { cleanName, getUsers, sameName } from '../users/users.js';
import { AIRPORTS } from './airports.js';
import { localToUtc, utcToLocalDate } from './time.js';

const KEY = 'flights:v1';
const byIata = new Map(AIRPORTS.map(a => [a[0], a]));
const airport = code => {
  const a = byIata.get(String(code || '').toUpperCase());
  return a && { iata: a[0], name: a[1], city: a[2], country: a[3], lat: a[4], lng: a[5], tz: a[6] };
};

async function getFlights(env) {
  const { doc } = await readDoc(env, KEY);
  return doc || {};
}

// fn(all) mutates the freshest flights document and returns the
// handler's result; the commit is version-checked (see lib/store.js).
async function updateFlights(env, fn) {
  return transact(env, KEY, async doc => {
    const all = doc || {};
    const result = await fn(all);
    return { doc: all, result };
  });
}

// The caller, if their name and token match the user list.
async function caller(env, name, token) {
  const users = await getUsers(env);
  const user = users.find(u => sameName(u.name, cleanName(name)));
  return { users, user: user && token && user.token === token ? user : null };
}

// Validate one flight from the form. Returns { error } or { flight }.
function readFlight(f, label) {
  if (!f) return { flight: null };
  const flight = String(f.flight || '').toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(flight)) return { error: label + '：航班号格式不对（比如 UA1234）' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) return { error: label + '：请填起飞日期' };
  if (!/^\d{2}:\d{2}$/.test(f.dep || '') || !/^\d{2}:\d{2}$/.test(f.arr || '')) return { error: label + '：请填起飞和到达时间' };
  const from = airport(f.from), to = airport(f.to);
  if (!from || !to) return { error: label + '：机场代码不认识' };
  if (from.iata === to.iata) return { error: label + '：出发和到达机场一样' };
  return { flight: { flight, date: f.date, from: from.iata, to: to.iata, dep: f.dep, arr: f.arr } };
}

// What the page needs for one stored flight: airports, UTC times, duration.
// The arrival time is on the arrival airport's clock; if that comes out before
// takeoff (red-eyes, long hauls), it's the next day.
function expand(f) {
  if (!f) return null;
  const from = airport(f.from), to = airport(f.to);
  if (!from || !to) return null;
  const depUtc = localToUtc(f.date, f.dep, from.tz);
  let arrUtc = localToUtc(f.date, f.arr, to.tz);
  for (let i = 0; i < 2 && arrUtc <= depUtc; i++) arrUtc += 86400000;
  return { ...f, from, to, depUtc, arrUtc, arrDate: utcToLocalDate(arrUtc, to.tz), minutes: Math.round((arrUtc - depUtc) / 60000),
    international: from.country !== to.country };
}

function view(users, all) {
  const people = users.map(u => {
    const r = all[u.name.toLowerCase()] || {};
    return { name: u.name, noFlight: !!r.noFlight, arrival: expand(r.arrival), departure: expand(r.departure),
      pickupBy: r.pickupBy || '', updatedAt: r.updatedAt || null };
  }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return { ok: true, people };
}

async function handleGet(req, env) {
  return j(view(await getUsers(env), await getFlights(env)));
}

// Save someone's flights (your own, or a friend's who isn't using the app).
async function handleSave(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const { users, user } = await caller(env, body.name, body.token);
  if (!user) return j({ ok: false, error: '先登录' });
  const target = users.find(u => sameName(u.name, cleanName(body.for || user.name)));
  if (!target) return j({ ok: false, error: '没有这个人' });
  const a = readFlight(body.arrival, '到达航班'), d = readFlight(body.departure, '离开航班');
  if (a.error || d.error) return j({ ok: false, error: a.error || d.error });
  const key = target.name.toLowerCase();
  const all = await updateFlights(env, all => {
    all[key] = { ...all[key], arrival: a.flight, departure: d.flight, noFlight: !!body.noFlight, updatedAt: Date.now(), updatedBy: user.name };
    return all;
  });
  return j(view(users, all));
}

// "I'll pick them up": claim (or release) airport pickups for some arrivals.
async function handlePickup(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const { users, user } = await caller(env, body.name, body.token);
  if (!user) return j({ ok: false, error: '先登录' });
  const all = await updateFlights(env, all => {
    for (const who of Array.isArray(body.who) ? body.who.slice(0, 30) : []) {
      const key = cleanName(who).toLowerCase();
      if (!all[key]?.arrival) continue;
      all[key].pickupBy = body.claim ? user.name : '';
    }
    return all;
  });
  return j(view(users, all));
}

// Airport search for the form: exact code first, then code / city / name prefix, then contains.
function handleAirports(req, env, url) {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  if (!q) return j({ ok: true, airports: [] });
  const score = a => {
    const [iata, name, city] = a.map(x => String(x).toLowerCase());
    if (iata === q) return 0;
    if (iata.startsWith(q) || city.startsWith(q)) return 1;
    if (name.startsWith(q)) return 2;
    if (city.includes(q) || name.includes(q)) return 3;
    return 9;
  };
  const hits = [];
  for (const a of AIRPORTS) { const s = score(a); if (s < 9) hits.push([s, a]); }
  hits.sort((x, y) => x[0] - y[0] || x[1][2].localeCompare(y[1][2]));
  return j({ ok: true, airports: hits.slice(0, 8).map(([, a]) => airport(a[0])) });
}

// Remove one person's saved flights entirely (thorough user deletion,
// users/retire.js), and clear their name from anyone's pickup claim.
export async function scrubUserFromFlights(env, user) {
  const key = user.name.toLowerCase();
  await updateFlights(env, all => {
    delete all[key];
    for (const r of Object.values(all)) {
      if (r && String(r.pickupBy || '').toLowerCase() === key) r.pickupBy = '';
    }
    return all;
  });
}

export const routes = {
  'GET /api/flights': handleGet,
  'POST /api/flights': handleSave,
  'POST /api/flights/pickup': handlePickup,
  'GET /api/airports': handleAirports,
};
