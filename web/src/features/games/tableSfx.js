import { useEffect, useRef, useState } from 'react';
import { load, save } from '../../lib/storage.js';
import { speak, canSpeak, unlockVoice } from '../party/voice.js';

// Sounds for the card tables (斗地主, 掼蛋, 川麻, 21 点) and the boards (五子棋, 2048), made on the spot with Web Audio (no audio
// files): cards and tiles landing, bombs, 碰杠胡, winning and losing. On top of that the calls are
// spoken (「对三」「炸弹」「三万」「碰」) with the browser's own Chinese voice (party/voice.js).
// Two switches, each remembered on this device: 🔊 音效 (tableSound) and 🗣 报牌 (tableVoice).
// Browsers only start audio after a tap, so the tables call unlock() on any tap.
//
// What to play comes from the table's `fx` list (worker/games/fx.js): the last few things that
// happened, numbered. useTableFx hands each new one to the game's own handler exactly once.
let ctx = null, bus = null;
let soundOn = load('tableSound') !== 'off', voiceOn = load('tableVoice') !== 'off';
const subs = new Set();
const tell = () => subs.forEach(f => f());
export function setSound(on) { soundOn = on; save('tableSound', on ? 'on' : 'off'); if (on) { unlock(); play('card'); } tell(); }
export function setVoice(on) { voiceOn = on; save('tableVoice', on ? 'on' : 'off'); if (on) speak('报牌开了', { rate: 1.15, cut: true }); else if (canSpeak()) window.speechSynthesis.cancel(); tell(); }
// the switches as React state, in step across every table on the page
export function useSoundSettings() {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump(n => n + 1); subs.add(f); return () => subs.delete(f); }, []);
  return { sound: soundOn, voice: voiceOn && canSpeak(), canVoice: canSpeak() };
}

export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      bus = ctx.createGain(); bus.gain.value = 0.5;
      bus.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { /* no sound here */ }
  if (voiceOn) unlockVoice();
}

function tone(t, { f0, f1 = f0, dur, type = 'sine', vol = 0.3, attack = 0.005 }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.02);
}
function noise(t, { dur, vol = 0.3, f0 = 1200, f1 = f0, type = 'lowpass', q = 1 }) {
  const len = Math.ceil(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(bus); s.start(t);
}
// a card slapped on the felt; a mahjong tile knocked on the table (harder, higher, with a wooden tok)
const card = (t, vol = 0.28) => { noise(t, { dur: 0.06, vol, f0: 2600, f1: 900, type: 'bandpass', q: 0.8 }); tone(t, { f0: 180, f1: 90, dur: 0.05, vol: vol * 0.5 }); };
const tile = (t, vol = 0.4) => { noise(t, { dur: 0.03, vol, f0: 4200, f1: 2400, type: 'bandpass', q: 1.5 }); tone(t, { f0: 1500, f1: 700, dur: 0.04, type: 'triangle', vol: vol * 0.7, attack: 0.002 }); tone(t, { f0: 240, f1: 120, dur: 0.07, vol: vol * 0.6 }); };
const boom = (t, vol = 0.5) => { noise(t, { dur: 0.7, vol, f0: 1400, f1: 50 }); tone(t, { f0: 120, f1: 32, dur: 0.6, vol }); };
const notes = (t, list, { gap = 0.09, dur = 0.24, type = 'triangle', vol = 0.22 } = {}) => list.forEach((f, i) => tone(t + i * gap, { f0: f, dur, type, vol }));

const SOUNDS = {
  // cards
  card: t => card(t),
  cards: t => { card(t); card(t + 0.07, 0.2); card(t + 0.13, 0.16); },
  deal: t => { for (let i = 0; i < 12; i++) card(t + i * 0.055, 0.12 + (i % 3) * 0.02); },
  pass: t => tone(t, { f0: 330, f1: 220, dur: 0.14, vol: 0.16 }),
  bid: t => { tone(t, { f0: 880, dur: 0.09, type: 'triangle', vol: 0.22 }); tone(t + 0.08, { f0: 1175, dur: 0.14, type: 'triangle', vol: 0.2 }); },
  no: t => tone(t, { f0: 392, f1: 294, dur: 0.16, type: 'triangle', vol: 0.16 }),
  lord: t => notes(t, [523, 659, 784, 1046, 1318], { gap: 0.07, dur: 0.3 }),
  run: t => notes(t, [523, 587, 659, 784, 880], { gap: 0.05, dur: 0.12, vol: 0.18 }),
  plane: t => { noise(t, { dur: 0.75, vol: 0.3, f0: 300, f1: 3200, type: 'bandpass', q: 2 }); tone(t, { f0: 220, f1: 660, dur: 0.7, type: 'sawtooth', vol: 0.06 }); },
  bomb: t => boom(t),
  rocket: t => { tone(t, { f0: 300, f1: 2400, dur: 0.38, type: 'sawtooth', vol: 0.1 }); noise(t, { dur: 0.38, vol: 0.15, f0: 800, f1: 5000, type: 'bandpass', q: 2 }); boom(t + 0.38, 0.6); notes(t + 0.5, [1568, 2093, 2637], { gap: 0.05, dur: 0.3, vol: 0.1 }); },
  warn: t => { for (let i = 0; i < 2; i++) { tone(t + i * 0.26, { f0: 988, dur: 0.11, type: 'square', vol: 0.1 }); tone(t + i * 0.26 + 0.12, { f0: 740, dur: 0.11, type: 'square', vol: 0.1 }); } },
  out: t => notes(t, [784, 988, 1175, 1568], { gap: 0.08, dur: 0.3 }),
  // mahjong
  tile: t => tile(t),
  shuffle: t => { for (let i = 0; i < 22; i++) tile(t + i * 0.045 + Math.random() * 0.03, 0.08 + Math.random() * 0.12); },
  swap: t => { for (let i = 0; i < 3; i++) tile(t + i * 0.09, 0.22); noise(t + 0.3, { dur: 0.25, vol: 0.12, f0: 900, f1: 2600, type: 'bandpass' }); },
  pong: t => { tile(t, 0.5); tile(t + 0.11, 0.5); tone(t, { f0: 660, dur: 0.16, type: 'triangle', vol: 0.18 }); },
  kong: t => { tile(t, 0.5); tile(t + 0.09, 0.5); tile(t + 0.18, 0.55); noise(t + 0.2, { dur: 0.6, vol: 0.2, f0: 500, f1: 3000, type: 'bandpass', q: 1.2 }); tone(t, { f0: 523, f1: 784, dur: 0.3, type: 'triangle', vol: 0.18 }); },
  hu: t => { tone(t, { f0: 196, dur: 1.3, vol: 0.3 }); tone(t, { f0: 294, dur: 1.1, vol: 0.18 }); noise(t, { dur: 0.5, vol: 0.18, f0: 3000, f1: 600 }); notes(t + 0.12, [784, 988, 1175, 1568, 1976], { gap: 0.07, dur: 0.35, vol: 0.2 }); },
  // 五子棋: a stone set down on the board; 2048: tiles sliding, two becoming one
  stone: t => { noise(t, { dur: 0.025, vol: 0.22, f0: 3200, f1: 1600, type: 'bandpass', q: 1.2 }); tone(t, { f0: 900, f1: 480, dur: 0.05, type: 'triangle', vol: 0.3, attack: 0.002 }); tone(t, { f0: 170, f1: 105, dur: 0.09, vol: 0.28 }); },
  slide: t => noise(t, { dur: 0.09, vol: 0.09, f0: 500, f1: 1700, type: 'bandpass', q: 0.8 }),
  merge: t => { noise(t, { dur: 0.06, vol: 0.07, f0: 600, f1: 1500, type: 'bandpass' }); tone(t + 0.03, { f0: 523, f1: 784, dur: 0.13, type: 'triangle', vol: 0.2 }); },
  bigmerge: t => { noise(t, { dur: 0.06, vol: 0.07, f0: 600, f1: 1500, type: 'bandpass' }); notes(t + 0.03, [659, 880, 1175], { gap: 0.06, dur: 0.2, vol: 0.2 }); },
  // 21 点
  chip: t => { tone(t, { f0: 2100, dur: 0.05, type: 'triangle', vol: 0.16, attack: 0.002 }); tone(t + 0.04, { f0: 2600, dur: 0.07, type: 'triangle', vol: 0.14, attack: 0.002 }); },
  bust: t => tone(t, { f0: 260, f1: 90, dur: 0.4, type: 'sawtooth', vol: 0.14 }),
  // the hand is over
  win: t => { notes(t, [523, 659, 784, 1046], { gap: 0.1, dur: 0.3, vol: 0.24 }); notes(t + 0.45, [1318, 1568, 2093], { gap: 0.06, dur: 0.4, vol: 0.14 }); },
  lose: t => notes(t, [392, 330, 262, 196], { gap: 0.17, dur: 0.34, vol: 0.2 }),
  draw: t => notes(t, [440, 440], { gap: 0.2, dur: 0.25, vol: 0.16 }),
};
// after: seconds from now (events that arrive together are spread out a little)
export function play(name, after = 0) {
  if (!soundOn || !ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
  try { SOUNDS[name](ctx.currentTime + 0.01 + after); } catch (e) { /* fine */ }
}
export function say(text, after = 0) {
  if (!voiceOn || !text) return;
  if (after > 0) setTimeout(() => { if (voiceOn) speak(text, { rate: 1.2, cut: true }); }, after * 1000);
  else speak(text, { rate: 1.2, cut: true });
}

// fx: the table's event list ([{ n, k, … }], oldest first). handler(e, after) is called once for
// each event that's new since the last state — not for what was already there when the page opened,
// when you look at another table (tableKey changes), or while `on` is false (the game isn't on
// screen) or the page is in the background (nothing piles up to blurt out when you come back).
// `after` staggers events that came in the same message.
export function useTableFx(fx, tableKey, on, handler) {
  const seen = useRef(null), key = useRef(tableKey), cb = useRef(handler);
  cb.current = handler;
  useEffect(() => {
    if (!fx) return;
    const top = fx.length ? fx[fx.length - 1].n : 0;
    const away = typeof document !== 'undefined' && document.hidden; // the tab is in the background, the phone is locked
    if (seen.current == null || key.current !== tableKey || top < seen.current || !on || away) { seen.current = top; key.current = tableKey; return; }
    const fresh = fx.filter(e => e.n > seen.current);
    seen.current = top;
    fresh.slice(-4).forEach((e, i) => cb.current(e, i * 0.28));
  }, [fx, tableKey, on]);
}

// ---- what each game says ----
// 斗地主: the rank of a single or a pair, the name of anything bigger
const DDZ_RANK = { 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '二', 16: '小王', 17: '大王' };
const DDZ_TYPE = { triple1: '三带一', triple2: '三带一对', straight: '顺子', pairs: '连对', plane: '飞机', plane1: '飞机', plane2: '飞机', four2: '四带二', four22: '四带两对', bomb: '炸弹', rocket: '王炸' };
export function ddzLine(e) {
  if (e.type === 'single') return DDZ_RANK[e.main];
  if (e.type === 'pair') return '对' + DDZ_RANK[e.main];
  if (e.type === 'triple') return '三个' + DDZ_RANK[e.main];
  return DDZ_TYPE[e.type] || '';
}
// 掼蛋: ranks move with the level, so only the shapes are named
const GD_TYPE = { triple: '三张', full: '三带二', straight: '顺子', sflush: '同花顺', tube: '三连对', plate: '钢板', jokers: '天王炸' };
export const gdLine = e => (e.type === 'bomb' ? (e.count > 4 ? e.count + '张炸弹' : '炸弹') : GD_TYPE[e.type] || '');
// the sound of a play, for both: a bomb booms, a run runs, a plane flies, the rest is cards landing
export function playSound(e) {
  if (e.type === 'rocket' || e.type === 'jokers') return 'rocket';
  if (e.type === 'bomb' || e.type === 'sflush') return 'bomb';
  if (e.type === 'plane' || e.type === 'plane1' || e.type === 'plane2' || e.type === 'plate') return 'plane';
  if (e.type === 'straight' || e.type === 'pairs' || e.type === 'tube') return 'run';
  return e.count > 1 ? 'cards' : 'card';
}
// 川麻: 一万 … 九筒, with 幺鸡 for the one of bamboo, the way it's called at a Sichuan table
const CN = '一二三四五六七八九';
export const tileName = k => (k === 's1' ? '幺鸡' : CN[Number(k[1]) - 1] + { m: '万', s: '条', p: '筒' }[k[0]]);
