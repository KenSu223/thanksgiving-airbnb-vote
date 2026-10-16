// The 川麻 room: one Durable Object (/api/mahjong) holding three tables of
// four. Sockets, seats, saving 豆子 and the leaderboard live in the shared
// TableHall; this only says which game it runs and which messages a seated
// player can send.
import { TableHall } from '../games/hall.js';
import { MahjongGame } from './game.js';

export const ROOMS = 3;

const ACTIONS = {
  start: (t, key) => t.start(key),
  swap: (t, key, m) => t.swap(key, m.tiles),            // 换三张
  lack: (t, key, m) => t.lack(key, String(m.suit || '')), // 定缺
  discard: (t, key, m) => t.discard(key, String(m.tile || '')),
  hu: (t, key) => t.selfHu(key),                         // 自摸
  kong: (t, key, m) => t.kong(key, String(m.tile || '')), // 暗杠 / 补杠
  claim: (t, key, m) => t.claim(key, String(m.choice || '')), // 胡 / 杠 / 碰 / 过 on someone's discard
  auto: (t, key, m) => { t.setAuto(key, m.on); },
  end: (t, key) => t.endMatch(key), // 不打这把了 (a parked hand)
};

export class MahjongHall extends TableHall {
  constructor(state, env) {
    super(state, env, { Game: MahjongGame, rooms: ROOMS, actions: ACTIONS, idleNotice: '太久没动，帮你站起来了，豆子已保存' });
  }
}
