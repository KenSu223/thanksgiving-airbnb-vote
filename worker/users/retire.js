// Retired accounts: accounts that come off the member list, with everything
// recorded under them. Nobody can delete accounts from the app
// (everyone has the same rights); a name goes on RETIRED here instead, and
// the next time anyone loads the member list (GET /api/users — every page
// load does) the account is removed thoroughly: listing/food/activity votes,
// saved flights, split expenses and shares, car seats and luggage, to-do
// assignments and comments, Secret Angel prefs and draw seat (each feature's
// scrubUserFrom* does its own part), plus the game records and chat messages
// inside the Durable Objects, reached through their bindings below. Cards and
// restaurants they added stay (others may have voted on them).
//
// A plain name on RETIRED retires the name for good: any account of that
// name, even one made later, is removed. { name, createdBefore } removes only
// the account that existed before that moment — once; a new account of that
// name made afterwards is kept, so the name stays free.
//
// RETIRE (comma-separated names) adds to the list — only the robustness
// suite's local server sets it, to check the removal end to end.
import { j } from '../lib/http.js';
import { getUsers, updateUsers, publicUsers, sameName } from './users.js';
import { scrubUserFromTrips } from '../listings/state.js';
import { scrubUserFromFood } from '../food/store.js';
import { scrubUserFromActivities } from '../activities/store.js';
import { scrubUserFromFlights } from '../flights/routes.js';
import { scrubUserFromSplit } from '../split/store.js';
import { scrubUserFromAngel } from '../angel/routes.js';
import { scrubUserFromPolls } from '../polls/routes.js';
import { scrubUserFromCars } from '../cars/routes.js';
import { scrubUserFromTodos } from '../todos/routes.js';

// 2026-10-17: the test account "PM Test" goes (asked for in chat) — once
// only. (2026-10-15 → 2026-10-16 a plain "PM Test" entry sat here, and every
// new account of that name was created by login and scrubbed again by the
// next member-list load; PM wanted the name back, so it stays free.)
// 2026-10-19: the "🤖" account goes too (asked for in chat) — once only, so
// the name stays free.
const RETIRED = [
  { name: 'PM Test', createdBefore: Date.parse('2026-10-17T04:00:00Z') },
  { name: '🤖', createdBefore: Date.parse('2026-10-19T20:05:00Z') },
];
export const retiredList = env => [...RETIRED, ...String(env.RETIRE || '').split(',').map(s => s.trim()).filter(Boolean)]
  .map(r => (typeof r === 'string' ? { name: r } : r));
// An account made before the cutoff (or with no creation time) counts as made before it.
export const isRetired = (u, list) => list.some(r => sameName(u.name, r.name) && !(r.createdBefore && (u.createdAt || 0) >= r.createdBefore));

// Remove one account and everything recorded under it.
export async function removeUser(env, target) {
  await updateUsers(env, list => {
    const i = list.findIndex(u => sameName(u.name, target.name));
    if (i >= 0) list.splice(i, 1);
    return list;
  });
  await scrubUserFromTrips(env, target);
  await scrubUserFromFood(env, target);
  await scrubUserFromActivities(env, target);
  await scrubUserFromSplit(env, target);
  await scrubUserFromPolls(env, target);
  await scrubUserFromFlights(env, target);
  await scrubUserFromAngel(env, target);
  await scrubUserFromCars(env, target);
  await scrubUserFromTodos(env, target);
  // The games keep their records in their own Durable Objects; ask each one
  // to drop this person. The path is internal: the public worker never
  // routes /scrub-user to a game object, so the objects can trust it. A game
  // object being unreachable must not stop the rest.
  const scrubGame = async (ns, idName) => {
    try {
      await ns.get(ns.idFromName(idName)).fetch(new Request('https://internal/scrub-user', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: target.name }),
      }));
    } catch (e) { /* skip that game */ }
  };
  await Promise.all([
    scrubGame(env.DDZ_HALL, 'hall'), scrubGame(env.GD_HALL, 'hall'), scrubGame(env.MJ_HALL, 'hall'),
    scrubGame(env.BJ_TABLE, 'main'), scrubGame(env.DODGE, 'board'), scrubGame(env.G2048, 'board'),
    scrubGame(env.UC_HALL, 'hall'), scrubGame(env.AV_HALL, 'hall'), scrubGame(env.WW_HALL, 'hall'),
    scrubGame(env.GM_HALL, 'hall'), scrubGame(env.CHAT, 'room'), scrubGame(env.FISH, 'board'), scrubGame(env.DOOM, 'board'),
  ]);
}

// The member list, after taking any retired account off it.
async function handleList(req, env) {
  let users = await getUsers(env);
  const list = retiredList(env);
  const gone = users.filter(u => isRetired(u, list));
  if (gone.length) {
    for (const u of gone) await removeUser(env, u);
    users = await getUsers(env);
  }
  return j({ ok: true, users: publicUsers(users) });
}

// Admin-only endpoints that no longer exist (everyone has the same rights). A page
// still open from before may call them: read the request and say so plainly.
const gone = async req => {
  await req.text().catch(() => '');
  return j({ ok: false, error: '这个功能已经去掉了（现在大家权限一样），刷新一下页面' }, 410);
};

export const routes = {
  'GET /api/users': handleList,
  'POST /api/users/delete': gone,
  'POST /api/angel/admin': gone,
  'POST /api/cars/clear': gone,
};
