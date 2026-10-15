// User administration: account deletion, restricted to the PM account
// (USER_ADMIN in users.js). Kept in its own module because it reaches
// into every feature's data, while the features themselves only depend
// on users.js.
//
// Authorization: the caller's token must belong to the PM account.
// PM is email-bound, so that token is not in the public user list and
// the permission can't be borrowed by picking a name from it.
//
// Deletion is thorough: the account goes, and so does everything
// recorded under that person — listing/food/activity votes, saved
// flights, split expenses and shares, car seats and luggage, to-do assignments, Secret Angel
// prefs and draw seat (each feature's scrubUserFrom* does its own part), plus the
// game records inside the game Durable Objects (table-game 豆子,
// blackjack chips, the dodge leaderboard), reached
// through their bindings below. Cards and restaurants they added
// stay (others may have voted on them).
import { j } from '../lib/http.js';
import { cleanName, getUsers, updateUsers, publicUsers, sameName, USER_ADMIN } from './users.js';
import { scrubUserFromTrips } from '../listings/state.js';
import { scrubUserFromFood } from '../food/store.js';
import { scrubUserFromActivities } from '../activities/store.js';
import { scrubUserFromFlights } from '../flights/routes.js';
import { scrubUserFromSplit } from '../split/store.js';
import { scrubUserFromAngel } from '../angel/routes.js';
import { scrubUserFromPolls } from '../polls/routes.js';
import { scrubUserFromCars } from '../cars/routes.js';
import { scrubUserFromTodos } from '../todos/routes.js';

async function handleUserDelete(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const targetName = cleanName(body.name);
  if (!targetName) return j({ ok: false, error: '先选要删的人' });
  const users = await getUsers(env);
  const presented = String(body.token || '');
  const caller = presented ? users.find(u => u.token === presented) : null;
  if (!caller || !sameName(caller.name, USER_ADMIN)) return j({ ok: false, error: '只有 PM 能删用户' });
  if (sameName(targetName, USER_ADMIN)) return j({ ok: false, error: '不能删 PM 自己' });
  const target = users.find(u => sameName(u.name, targetName));
  if (!target) return j({ ok: false, error: '没这个用户' });

  await updateUsers(env, list => {
    const i = list.findIndex(u => sameName(u.name, target.name));
    if (i >= 0) list.splice(i, 1);
    return list;
  });
  const scrubbed = {
    listingVotes: await scrubUserFromTrips(env, target),
    foodVotes: await scrubUserFromFood(env, target),
    activityVotes: await scrubUserFromActivities(env, target),
    splitExpenses: await scrubUserFromSplit(env, target),
    pollVotes: await scrubUserFromPolls(env, target),
  };
  await scrubUserFromFlights(env, target);
  await scrubUserFromAngel(env, target);
  await scrubUserFromCars(env, target);
  await scrubUserFromTodos(env, target);
  // The games keep their records in their own Durable Objects; ask
  // each one to drop this person. A game object being unreachable
  // must not fail the deletion — the account is already gone.
  const scrubGame = async (ns, idName, url) => {
    try {
      const r = await ns.get(ns.idFromName(idName)).fetch(new Request(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: target.name, byName: caller.name, byToken: presented }),
      }));
      const jj = await r.json().catch(() => null);
      return jj && jj.ok ? (jj.removed || 0) : 0;
    } catch (e) { return 0; }
  };
  scrubbed.gameRecords = (await Promise.all([
    scrubGame(env.DDZ_HALL, 'hall', 'https://internal/scrub-user'),
    scrubGame(env.GD_HALL, 'hall', 'https://internal/scrub-user'),
    scrubGame(env.MJ_HALL, 'hall', 'https://internal/scrub-user'),
    scrubGame(env.BJ_TABLE, 'main', 'https://internal/scrub-user'),
    scrubGame(env.DODGE, 'board', 'https://internal/api/dodge/scrub-user'),
  ])).reduce((a, b) => a + b, 0);
  return j({ ok: true, users: publicUsers(await getUsers(env)), scrubbed });
}

export const routes = {
  'POST /api/users/delete': handleUserDelete,
};
