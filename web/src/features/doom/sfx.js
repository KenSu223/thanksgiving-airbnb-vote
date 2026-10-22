import { load, save } from '../../lib/storage.js';

// 末日小队's sounds, made on the spot with Web Audio (no audio files). Browsers
// only start audio from a tap or key press, so unlock() is called from those.
// 🔊 / M mutes, remembered in localStorage (doomSound). Gunfire is thinned out
// (one tick sound every 70 ms at most) so a big squad doesn't roar.
let ctx = null, bus = null, muted = load('doomSound') === 'off';
const last = {};
export const isMuted = () => muted;
export function setMuted(m) { muted = m; save('doomSound', m ? 'off' : 'on'); }
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      bus = ctx.createGain(); bus.gain.value = 0.45;
      bus.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { /* no sound here */ }
}
function tone(t, { f0, f1 = f0, dur, type = 'sine', vol = 0.3 }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.02);
}
function noise(t, { dur, vol = 0.3, f0 = 1200, f1 = 200, type = 'lowpass' }) {
  const len = Math.ceil(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(bus); s.start(t);
}
const SOUNDS = {
  shot: [70, t => noise(t, { dur: 0.05, vol: 0.12, f0: 3000, f1: 900, type: 'bandpass' })],
  shotgun: [120, t => noise(t, { dur: 0.12, vol: 0.22, f0: 2200, f1: 300 })],
  rocket: [150, t => noise(t, { dur: 0.25, vol: 0.16, f0: 900, f1: 2400, type: 'bandpass' })],
  laser: [80, t => tone(t, { f0: 1800, f1: 900, dur: 0.06, type: 'square', vol: 0.05 })],
  sniper: [0, t => { noise(t, { dur: 0.18, vol: 0.3, f0: 4000, f1: 400 }); tone(t, { f0: 160, f1: 60, dur: 0.15, vol: 0.2 }); }],
  blast: [90, t => { noise(t, { dur: 0.3, vol: 0.28, f0: 800, f1: 80 }); tone(t, { f0: 110, f1: 50, dur: 0.22, vol: 0.2 }); }],
  kill: [60, t => noise(t, { dur: 0.12, vol: 0.18, f0: 700, f1: 120 })],
  good: [0, t => { tone(t, { f0: 784, dur: 0.12, vol: 0.2 }); tone(t + 0.07, { f0: 1175, dur: 0.22, vol: 0.2 }); }],
  bad: [0, t => tone(t, { f0: 300, f1: 140, dur: 0.3, type: 'sawtooth', vol: 0.12 })],
  bite: [120, t => { tone(t, { f0: 220, f1: 90, dur: 0.18, type: 'square', vol: 0.15 }); noise(t, { dur: 0.1, vol: 0.2, f0: 500, f1: 100 }); }],
  boom: [0, t => { noise(t, { dur: 0.45, vol: 0.4, f0: 900, f1: 60 }); tone(t, { f0: 90, f1: 40, dur: 0.35, vol: 0.35 }); }],
  boss: [0, t => { tone(t, { f0: 110, f1: 55, dur: 0.9, type: 'sawtooth', vol: 0.2 }); noise(t, { dur: 0.8, vol: 0.15, f0: 400, f1: 80 }); }],
  wave: [0, t => [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.08, { f0: f, dur: 0.22, type: 'triangle', vol: 0.22 }))],
  perk: [0, t => { tone(t, { f0: 988, dur: 0.1, vol: 0.2 }); tone(t + 0.06, { f0: 1480, dur: 0.25, vol: 0.2 }); }],
  dead: [0, t => [392, 330, 262, 196].forEach((f, i) => tone(t + i * 0.16, { f0: f, dur: 0.3, type: 'triangle', vol: 0.25 }))],
};
export function play(name) {
  if (muted || !ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
  const [gap, fn] = SOUNDS[name], now = performance.now();
  if (gap && now - (last[name] || 0) < gap) return;
  last[name] = now;
  try { fn(ctx.currentTime + 0.01); } catch (e) { /* fine */ }
}
