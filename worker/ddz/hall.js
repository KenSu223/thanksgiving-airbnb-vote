// The 斗地主 room: one Durable Object (/api/ddz) holding three tables. Sockets,
// seats, saving 豆子 and the leaderboard live in the shared TableHall; this
// only says which game it runs and which messages a seated player can send.
import { TableHall } from '../games/hall.js';
import { DdzGame } from './game.js';

export const ROOMS = 3;

const ACTIONS = {
  start: (t, key) => t.start(key),
  bid: (t, key, m) => t.bidAction(key, m.yes),
  play: (t, key, m) => t.play(key, m.cards),
  pass: (t, key) => t.pass(key),
  hint: (t, key) => ({ reply: { hint: t.hint(key) || [] } }),
  auto: (t, key, m) => { t.setAuto(key, m.on); },
  end: (t, key) => t.endMatch(key), // 不打这把了 (a parked hand)
};

export class DdzHall extends TableHall {
  constructor(state, env) {
    super(state, env, { Game: DdzGame, rooms: ROOMS, actions: ACTIONS, idleNotice: '太久没动，帮你站起来了，豆子已保存' });
  }
}
