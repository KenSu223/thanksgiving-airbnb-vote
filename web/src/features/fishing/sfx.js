import { load, save } from '../../lib/storage.js';

// 小小钓鱼's sounds, made on the spot with Web Audio (no audio files).
// Browsers only start audio from a tap or key press, so unlock() is called
// from those. 🔊 / M mutes, remembered in localStorage (fishSound).
let ctx = null, bus = null, muted = load('fishSound') === 'off';
export const isMuted = () => muted;
export function setMuted(m) { muted = m; save('fishSound', m ? 'off' : 'on'); }
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      bus = ctx.createGain(); bus.gain.value = 0.5;
      const comp = ctx.createDynamicsCompressor();
      bus.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { /* no sound here */ }
}
function tone(t, { f0, f1 = f0, dur, type = 'sine', vol = 0.3, attack = 0.005 }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(t, { dur, vol = 0.3, f0 = 1200, f1 = 200, type = 'lowpass' }) {
  const len = Math.ceil(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = type;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(bus);
  s.start(t);
}
const SOUNDS = {
  cast: t => { noise(t, { dur: 0.16, vol: 0.14, f0: 2600, f1: 700, type: 'bandpass' }); noise(t + 0.18, { dur: 0.22, vol: 0.22, f0: 1400, f1: 300 }); },
  hook: t => { tone(t, { f0: 420, f1: 900, dur: 0.12, type: 'sine', vol: 0.3 }); tone(t + 0.05, { f0: 300, f1: 160, dur: 0.12, type: 'triangle', vol: 0.2 }); },
  miss: t => tone(t, { f0: 300, f1: 200, dur: 0.12, type: 'triangle', vol: 0.15 }),
  coin: t => { tone(t, { f0: 1318, dur: 0.18, vol: 0.22 }); tone(t + 0.07, { f0: 1760, dur: 0.3, vol: 0.22 }); },
  big: t => { tone(t, { f0: 1046, dur: 0.16, vol: 0.22 }); tone(t + 0.07, { f0: 1318, dur: 0.18, vol: 0.22 }); tone(t + 0.14, { f0: 2093, dur: 0.4, vol: 0.24 }); },
  junk: t => tone(t, { f0: 140, f1: 70, dur: 0.22, type: 'square', vol: 0.12 }),
  cut: t => { noise(t, { dur: 0.05, vol: 0.3, f0: 6000, f1: 3000, type: 'highpass' }); noise(t + 0.07, { dur: 0.05, vol: 0.3, f0: 6000, f1: 3000, type: 'highpass' }); },
  tick: t => tone(t, { f0: 1000, dur: 0.05, type: 'square', vol: 0.08 }),
  pass: t => [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.09, { f0: f, dur: 0.25, type: 'triangle', vol: 0.25 })),
  fail: t => [392, 330, 262].forEach((f, i) => tone(t + i * 0.16, { f0: f, dur: 0.3, type: 'triangle', vol: 0.25 })),
  buy: t => { tone(t, { f0: 988, dur: 0.1, vol: 0.2 }); tone(t + 0.06, { f0: 1318, dur: 0.2, vol: 0.2 }); },
};
export function play(name) {
  if (muted || !ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
  try { SOUNDS[name](ctx.currentTime + 0.01); } catch (e) { /* fine */ }
}
