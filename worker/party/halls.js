// The party-game rooms: one Durable Object per game (WebSocket /api/undercover …),
// two tables each. Sockets, seats, rejoining and the wins board live in the
// shared TableHall; the game is in its own file.
import { TableHall } from '../games/hall.js';
import { UndercoverGame } from './undercover.js';
import { AvalonGame } from './avalon.js';
import { WerewolfGame } from './werewolf.js';

export const ROOMS = 2;

// what everyone at a party table can send (each game adds its own)
const COMMON = {
  start: (t, key) => t.start(key),
  settings: (t, key, m) => t.setSettings(key, m.settings),
  seat: (t, key, m) => t.moveSeat(key, Number(m.seat)),
  kick: (t, key, m) => t.kick(key, Number(m.seat)),
  ready: (t, key) => t.ready(key),
  done: (t, key) => t.done(key),
  vote: (t, key, m) => t.vote(key, m.target),
  stop: (t, key) => t.stop(key),
};
// most wins, then the better win rate, then more games
export const byWins = (a, b) => (b.wins || 0) - (a.wins || 0)
  || (b.wins || 0) / Math.max(1, b.games || 0) - (a.wins || 0) / Math.max(1, a.games || 0) || (b.games || 0) - (a.games || 0);
const party = (Game, actions = {}) => ({ Game, rooms: ROOMS, actions: { ...COMMON, ...actions }, idleNotice: '太久没动，帮你站起来了', rejoin: true, boardSort: byWins });

export class UndercoverHall extends TableHall {
  constructor(state, env) { super(state, env, party(UndercoverGame)); }
}
export class AvalonHall extends TableHall {
  constructor(state, env) {
    super(state, env, party(AvalonGame, {
      pick: (t, key, m) => t.pick(key, m.seat),
      propose: (t, key) => t.propose(key),
      lady: (t, key, m) => t.useLady(key, m.seat),
      assassinate: (t, key, m) => t.assassinate(key, m.seat),
    }));
  }
}
export class WerewolfHall extends TableHall {
  constructor(state, env) {
    super(state, env, party(WerewolfGame, {
      guard: (t, key, m) => t.guard(key, m.seat),
      kill: (t, key, m) => t.wolfPick(key, m.seat),
      witch: (t, key, m) => t.witch(key, m.use, m.seat),
      check: (t, key, m) => t.check(key, m.seat),
      signup: (t, key, m) => t.signup(key, !!m.yes),
      withdraw: (t, key) => t.withdraw(key),
      order: (t, key, m) => t.order(key, m.dir),
      shoot: (t, key, m) => t.shoot(key, m.seat),
      badge: (t, key, m) => t.badge(key, m.seat),
      boom: (t, key) => t.boom(key),
    }));
  }
}
