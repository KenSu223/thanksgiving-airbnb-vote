// Test helpers for the party games: a fake clock (timers run when you advance it),
// a seeded rand, and a table with n people seated. Used by the *.test.js files.
export function fakeHooks(seed = 1) {
  let now = 1_000_000, id = 0, s = seed;
  const timers = new Map(), saved = [];
  const hooks = {
    now: () => now,
    rand: () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; },
    schedule: (fn, ms) => { const t = ++id; timers.set(t, { at: now + ms, fn }); return t; },
    cancel: t => timers.delete(t),
    save: seat => saved.push({ ...seat }),
  };
  // run every timer due within ms, in order
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].fn();
    }
    now = end;
  };
  return { hooks, advance, saved, timers };
}
export function seated(Game, n, seed = 1) {
  const k = fakeHooks(seed), t = new Game(k.hooks);
  const keys = Array.from({ length: n }, (_, i) => 'p' + (i + 1));
  keys.forEach((key, i) => t.sit(key, 'P' + (i + 1), null, { seat: i }));
  return { t, keys, ...k };
}
