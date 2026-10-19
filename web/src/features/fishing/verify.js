import { newGame, step, MAX_TICKS } from './sim.js';

// Checking a run, and watching it again. The same seed and inputs always play
// out the same way (sim.js), so the server replays what the browser recorded
// and its own result is the score; a saved best run plays back the same way.

export const MAX_EVENTS = 20000;
export const SHOP_SLOTS = 5;

// Format check of a recorded input list: an error code, or null when fine.
export function badEvents(events) {
  if (!Array.isArray(events) || events.length > MAX_EVENTS) return 'events';
  let last = 0;
  for (const e of events) {
    if (!Array.isArray(e)) return 'event';
    const [t, type, a] = e;
    if (!Number.isInteger(t) || t < last || t > MAX_TICKS) return 'tick';
    last = t;
    if (type === 2) {
      if (e.length !== 3 || !Number.isInteger(a) || a < 0 || a >= SHOP_SLOTS) return 'buy';
    } else if (type === 0 || type === 1 || type === 3 || type === 4) {
      if (e.length !== 2) return 'event';
    } else return 'type';
  }
  return null;
}

// Replays a run: { money, level, cleared, end, ticks, caught: { kind: count } }.
// Inputs after the run ended are ignored. Waiting in the shop with nothing
// more to press would just run out the clock, so that's skipped to the end.
export function replay(seed, events) {
  const g = newGame(seed);
  let i = 0;
  while (!g.over) {
    if (g.phase === 'shop' && i >= events.length) { g.tick = MAX_TICKS; g.over = true; g.phase = 'over'; g.end = 'time'; break; }
    const ev = [];
    while (i < events.length && events[i][0] <= g.tick) { if (events[i][0] === g.tick) ev.push(events[i]); i++; }
    step(g, ev);
  }
  return { money: g.money, level: g.level, cleared: g.cleared, end: g.end, ticks: g.tick, caught: g.caught };
}
