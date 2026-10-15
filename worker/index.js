// Cloudflare Worker entry: routes /api/* to each feature's route table and
// serves the built frontend (./dist, via [assets]) for everything else.
// Each feature owns its routes in its own folder, so adding an endpoint only
// touches that feature's routes file.
import { routes as listingRoutes } from './listings/routes.js';
import { routes as userRoutes } from './users/users.js';
import { routes as authRoutes } from './users/auth.js';
import { routes as adminRoutes } from './users/admin.js';
import { routes as splitRoutes } from './split/routes.js';
import { routes as foodRoutes } from './food/routes.js';
import { routes as angelRoutes } from './angel/routes.js';
import { routes as weatherRoutes } from './weather/routes.js';
import { routes as flightRoutes } from './flights/routes.js';
import { routes as activityRoutes } from './activities/routes.js';
import { routes as pollRoutes } from './polls/routes.js';
import { routes as carRoutes } from './cars/routes.js';
import { routes as todoRoutes } from './todos/routes.js';

// The Durable Object classes must be exported from the entry module.
export { BlackjackTable } from './blackjack/table.js';
export { DdzHall } from './ddz/hall.js';
export { GuandanHall } from './guandan/hall.js';
export { MahjongHall } from './mahjong/hall.js';
export { StoreDO } from './store/store.js';
export { DodgeBoard } from './dodge/board.js';
export { Board2048 } from './g2048/board.js';

const ROUTES = { ...listingRoutes, ...userRoutes, ...authRoutes, ...adminRoutes, ...splitRoutes, ...foodRoutes, ...angelRoutes, ...weatherRoutes, ...activityRoutes, ...flightRoutes, ...pollRoutes, ...carRoutes, ...todoRoutes };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Blackjack is one WebSocket endpoint handled by the table itself.
    if (url.pathname === '/api/bj') return env.BJ_TABLE.get(env.BJ_TABLE.idFromName('main')).fetch(request);
    // 斗地主 / 掼蛋 / 川麻: one WebSocket endpoint per game for all its tables, handled by its hall.
    if (url.pathname === '/api/ddz') return env.DDZ_HALL.get(env.DDZ_HALL.idFromName('hall')).fetch(request);
    if (url.pathname === '/api/guandan') return env.GD_HALL.get(env.GD_HALL.idFromName('hall')).fetch(request);
    if (url.pathname === '/api/mahjong') return env.MJ_HALL.get(env.MJ_HALL.idFromName('hall')).fetch(request);
    // 鲁班七号躲技能: one leaderboard object checks and keeps everyone's best run.
    if (url.pathname.startsWith('/api/dodge/')) return env.DODGE.get(env.DODGE.idFromName('board')).fetch(request);
    // 2048: one WebSocket endpoint; the object keeps everyone's board.
    if (url.pathname === '/api/2048') return env.G2048.get(env.G2048.idFromName('board')).fetch(request);
    const handler = ROUTES[request.method + ' ' + url.pathname];
    if (handler) return handler(request, env, url);
    return env.ASSETS.fetch(request);
  }
};
