// The 掼蛋 room: one Durable Object (/api/guandan) holding three tables of
// four. Sockets, seats, saving (豆子, and the tables themselves — 掼蛋 is the
// game that opts in) and the leaderboard live in the shared TableHall; this
// only says which game it runs and which messages a seated player can send.
import { TableHall } from '../games/hall.js';
import { GuandanGame, GD } from './game.js';

export const ROOMS = 3;

const ACTIONS = {
  start: (t, key) => t.start(key),
  play: (t, key, m) => t.play(key, m.cards),
  pass: (t, key) => t.pass(key),
  back: (t, key, m) => t.giveBack(key, String(m.card || '')), // 还贡
  hint: (t, key) => ({ reply: { hint: t.hint(key) || [] } }),
  auto: (t, key, m) => { t.setAuto(key, m.on); },
  end: (t, key) => t.endMatch(key), // 结束比赛
};

// One-time corrections by hand. Each keeps its flags in this object's storage,
// so nothing lands twice, whatever deploys come after.
// 2026-10-16: 🐘 (Scarlett) won five hands in a row with bots and was watching
// the next one when Peter's 00:54 deploy restarted this room; 豆子 are saved on
// standing up, so those five were lost. On request: the record gets them back
// (5 局 5 胜, +20 豆 each — a 2-level win, partner 3rd), and the next match
// they start at a table with only bots carries on from there: their team
// plays Q (2 → 4 → 6 → 8 → 10 → 12), the other team 2, and the opponent who
// came last pays 进贡 as after any win.
// 2026-10-16, again: 🐘 sat back down in the minute and a half between #160's
// merge and its deploy, won 320, and the 01:37 deploy restarted the room before
// it was saved (back to 960). On request: the 320 豆 go back on the record
// (豆子 only; no match to carry on). Deploys keep tables from #161 on.
const RESTORE_ONCE = [
  { flag: 'restore:🐘:2026-10-16', key: '🐘', name: '🐘', add: { points: 100, games: 5, wins: 5 }, level: 12 },
  { flag: 'restore:🐘:2026-10-16b', key: '🐘', name: '🐘', add: { points: 320, games: 0, wins: 0 } },
];

export class GuandanHall extends TableHall {
  constructor(state, env) {
    const actions = { ...ACTIONS };
    super(state, env, { Game: GuandanGame, rooms: ROOMS, actions, idleNotice: '太久没动，帮你站起来了，豆子已保存' });
    actions.start = (t, key) => { this.resumeMatch(t); return t.start(key); };
    this.resumes = []; // RESTORE_ONCE matches not picked up yet
  }
  load() {
    return this.restored ||= super.load().then(() => this.restoreRecords());
  }
  async restoreRecords() {
    for (const r of RESTORE_ONCE) {
      if (!await this.state.storage.get(r.flag + ':record')) {
        const rec = this.board.get(r.key) || { name: r.name, points: GD.startPoints, refills: 0, games: 0, wins: 0 };
        const next = { ...rec, points: rec.points + r.add.points, games: (rec.games || 0) + r.add.games, wins: (rec.wins || 0) + r.add.wins, updatedAt: Date.now() };
        this.board.set(r.key, next);
        await this.state.storage.put({ ['p:' + r.key]: next, [r.flag + ':record']: Date.now() });
      }
      if (r.level && !await this.state.storage.get(r.flag + ':match')) this.resumes.push(r);
    }
  }
  // Right before a deal at a table where that person is the only one seated
  // (the rest bots): set the match up as if their team had just won its 5th hand.
  resumeMatch(t) {
    if (t.phase !== 'waiting' || t.humans().length !== 1) return;
    const r = this.resumes.find(x => t.seatOf(x.key) >= 0);
    if (!r) return;
    const i = t.seatOf(r.key), mine = i % 2;
    t.levels = [2, 2]; t.levels[mine] = r.level; t.banker = mine;
    t.last = [i, (i + 1) % 4, (i + 2) % 4, (i + 3) % 4]; // they went out first, partner 3rd; the last opponent pays 进贡
    this.resumes.splice(this.resumes.indexOf(r), 1);
    this.state.storage.put(r.flag + ':match', Date.now());
  }
}
