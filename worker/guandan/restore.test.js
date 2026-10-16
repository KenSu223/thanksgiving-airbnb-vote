// The one-time 掼蛋 restore (worker/guandan/hall.js RESTORE_ONCE): 🐘's five
// lost wins land on their record exactly once, and the next match they start
// alone with bots picks up at Q vs 2 with 进贡. Run: node --test worker/guandan/restore.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { GuandanHall } from './hall.js';

// A Durable Object's storage, in memory (shared between "deploys" of the same object).
function storage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix))),
    get: async k => m.get(k),
    put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, b); else m.set(k, v); },
    delete: async k => { for (const x of [].concat(k)) m.delete(x); },
  };
}
const before = { name: '🐘', points: 1030, refills: 0, games: 1, wins: 1, updatedAt: 1 };
const stop = hall => hall.tables.forEach(t => t.clearTimer());

test('both corrections land on the record once, and stay once across deploys', async () => {
  const s = storage({ 'p:🐘': before });
  const a = new GuandanHall({ storage: s }, {});
  await a.load();
  assert.deepEqual([a.board.get('🐘').points, a.board.get('🐘').games, a.board.get('🐘').wins], [1030 + 100 + 320, 6, 6]);
  assert.equal(s.m.get('p:🐘').points, 1450);
  const b = new GuandanHall({ storage: s }, {}); // the next deploy: same storage, fresh object
  await b.load();
  assert.equal(b.board.get('🐘').points, 1450);
  assert.equal(b.board.get('🐘').games, 6);
});

test('live: the first one already landed, so only the 320 goes on (950 → 1270), and no match is set up', async () => {
  const s = storage({
    'p:🐘': { name: '🐘', points: 950, refills: 0, games: 14, wins: 11, updatedAt: 1 },
    'restore:🐘:2026-10-16:record': 1, 'restore:🐘:2026-10-16:match': 1,
  });
  const h = new GuandanHall({ storage: s }, {});
  await h.load();
  assert.deepEqual([h.board.get('🐘').points, h.board.get('🐘').games, h.board.get('🐘').wins], [1270, 14, 11]);
  assert.equal(h.resumes.length, 0);
  const t = h.tables[0];
  t.sit('🐘', '🐘', h.board.get('🐘'));
  h.actions.start(t, '🐘');
  assert.equal(t.level, 2, 'a plain new match');
  stop(h);
});

test('no record yet: starts from 1000 and adds both', async () => {
  const h = new GuandanHall({ storage: storage() }, {});
  await h.load();
  assert.deepEqual(h.board.get('🐘'), { ...h.board.get('🐘'), name: '🐘', points: 1420, games: 5, wins: 5 });
});

test('the next match alone with bots: their team plays Q, the other team 2, and the last opponent pays 进贡', async () => {
  const s = storage({ 'p:🐘': before });
  const h = new GuandanHall({ storage: s }, {});
  await h.load();
  const t = h.tables[0];
  t.sit('🐘', '🐘', h.board.get('🐘'));
  const i = t.seatOf('🐘');
  assert.equal(h.actions.start(t, '🐘'), null);
  assert.equal(t.level, 12);
  assert.equal(t.banker, i % 2);
  assert.deepEqual([t.levels[i % 2], t.levels[1 - (i % 2)]], [12, 2]);
  assert.equal(t.phase === 'tribute' || !!t.tribute?.resist, true, 'a 进贡 (or 抗贡) opens the hand');
  assert.ok(s.m.get('restore:🐘:2026-10-16:match'));
  stop(h);
  // the next deploy doesn't do it again
  const h2 = new GuandanHall({ storage: s }, {});
  await h2.load();
  const t2 = h2.tables[0];
  t2.sit('🐘', '🐘', h2.board.get('🐘'));
  h2.actions.start(t2, '🐘');
  assert.equal(t2.level, 2);
  stop(h2);
});

test('not with other people at the table, and nobody else gets it', async () => {
  const h = new GuandanHall({ storage: storage({ 'p:🐘': before }) }, {});
  await h.load();
  const t = h.tables[0];
  t.sit('🐘', '🐘', h.board.get('🐘'));
  t.sit('nan', 'Nan', null);
  h.actions.start(t, 'nan');
  assert.equal(t.level, 2);
  stop(h);
  const u = h.tables[1];
  u.sit('ken', 'Ken', null);
  h.actions.start(u, 'ken');
  assert.equal(u.level, 2);
  stop(h);
  assert.equal(h.resumes.length, 1, 'still waiting for 🐘 to start a table alone');
});
