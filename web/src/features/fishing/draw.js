import { W, H, WATER, SEABED, PIVOT, HZ, ROPE0, KINDS, tipOf } from './sim.js';

// Drawing one frame of 小小钓鱼: sky and a little boat on top, the sea below
// with everything in it, the line and hook, and the effects (coins popping
// up, splashes). Only reads the game, never changes it, and its own random
// numbers (for the seabed and the bubbles) are separate from the game's, so
// drawing can't change how a run plays out. paintKind draws one kind on its
// own too, for the 图鉴 cards.
const TAU = Math.PI * 2;
function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function rnd(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; return hash(s); }; }
const ell = (ctx, x, y, rx, ry, rot = 0) => { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); };
const dot = (ctx, x, y, r, color) => { ctx.fillStyle = color; ell(ctx, x, y, r, r); ctx.fill(); };
function eye(ctx, x, y, r) { dot(ctx, x, y, r, '#fff'); dot(ctx, x + r * 0.25, y, r * 0.6, '#1b1b2a'); dot(ctx, x + r * 0.05, y - r * 0.3, r * 0.25, '#fff'); }
function tail(ctx, x, r, color, spread = 0.8, wag = 0) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x + r * 0.15, 0); ctx.quadraticCurveTo(x - r * 0.4, -r * 0.2 + wag, x - r * 0.75, -r * spread + wag);
  ctx.quadraticCurveTo(x - r * 0.55, wag * 0.5, x - r * 0.75, r * spread + wag); ctx.quadraticCurveTo(x - r * 0.4, r * 0.2 + wag, x + r * 0.15, 0); ctx.fill();
}
function grad(ctx, y0, y1, a, b) { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; }

// ---- each kind, facing right (+x), centred at 0, 0; t in seconds ----
const PAINT = {
  minnow(ctx, r, t) {
    const wag = Math.sin(t * 14) * r * 0.12;
    tail(ctx, -r * 0.9, r, '#e9b200', 0.65, wag);
    ctx.fillStyle = grad(ctx, -r * 0.7, r * 0.7, '#ffe680', '#f2b705'); ell(ctx, 0, 0, r * 1.25, r * 0.62); ctx.fill();
    ctx.fillStyle = '#fff4c2'; ell(ctx, r * 0.1, r * 0.28, r * 0.8, r * 0.25); ctx.fill();
    ctx.fillStyle = '#e0a400'; ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.55); ctx.quadraticCurveTo(0, -r * 1.05, r * 0.35, -r * 0.55); ctx.fill();
    eye(ctx, r * 0.68, -r * 0.12, r * 0.2);
  },
  clown(ctx, r, t) {
    const wag = Math.sin(t * 12) * r * 0.12;
    tail(ctx, -r * 0.95, r, '#f26b1d', 0.7, wag);
    ctx.fillStyle = '#ff7a1f'; ell(ctx, 0, 0, r * 1.2, r * 0.72); ctx.fill();
    ctx.save(); ell(ctx, 0, 0, r * 1.2, r * 0.72); ctx.clip();
    for (const x of [r * 0.55, -r * 0.1, -r * 0.75]) { ctx.fillStyle = '#1d1d1d'; ctx.fillRect(x - r * 0.2, -r, r * 0.4, r * 2); ctx.fillStyle = '#fff'; ctx.fillRect(x - r * 0.14, -r, r * 0.28, r * 2); }
    ctx.restore();
    ctx.fillStyle = '#ff8f3d'; ctx.beginPath(); ctx.moveTo(-r * 0.4, -r * 0.6); ctx.quadraticCurveTo(0, -r * 1.15, r * 0.4, -r * 0.62); ctx.fill();
    eye(ctx, r * 0.8, -r * 0.15, r * 0.18);
  },
  angel(ctx, r, t) {
    const wag = Math.sin(t * 8) * r * 0.1;
    ctx.fillStyle = '#c9d8e8';
    ctx.beginPath(); ctx.moveTo(-r * 0.2, -r * 0.7); ctx.quadraticCurveTo(-r * 0.6, -r * 1.6 + wag, -r * 1.1, -r * 1.7 + wag); ctx.quadraticCurveTo(-r * 0.5, -r * 0.6, -r * 0.6, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-r * 0.2, r * 0.7); ctx.quadraticCurveTo(-r * 0.6, r * 1.6 - wag, -r * 1.1, r * 1.7 - wag); ctx.quadraticCurveTo(-r * 0.5, r * 0.6, -r * 0.6, 0); ctx.fill();
    tail(ctx, -r * 0.75, r * 0.8, '#b8cadf', 0.7, wag);
    ctx.fillStyle = grad(ctx, -r, r, '#f4f8fc', '#9fb5cc');
    ctx.beginPath(); ctx.moveTo(r, 0); ctx.quadraticCurveTo(r * 0.3, -r * 1.05, -r * 0.6, -r * 0.2); ctx.lineTo(-r * 0.6, r * 0.2); ctx.quadraticCurveTo(r * 0.3, r * 1.05, r, 0); ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(40,50,70,.75)';
    for (const x of [r * 0.45, -r * 0.05, -r * 0.45]) ctx.fillRect(x - r * 0.07, -r * 1.2, r * 0.14, r * 2.4);
    ctx.restore();
    eye(ctx, r * 0.55, -r * 0.1, r * 0.15);
  },
  puffer(ctx, r, t) {
    const puff = 1 + Math.sin(t * 3) * 0.04;
    ctx.save(); ctx.scale(puff, puff);
    ctx.fillStyle = '#d9b44a';
    for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a - 0.12) * r * 0.9, Math.sin(a - 0.12) * r * 0.9); ctx.lineTo(Math.cos(a) * r * 1.22, Math.sin(a) * r * 1.22); ctx.lineTo(Math.cos(a + 0.12) * r * 0.9, Math.sin(a + 0.12) * r * 0.9); ctx.fill(); }
    tail(ctx, -r * 0.85, r * 0.7, '#e0bf5a', 0.6, Math.sin(t * 10) * r * 0.08);
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#fff3b8'); g.addColorStop(0.6, '#f0cf63'); g.addColorStop(1, '#c79a2e');
    ctx.fillStyle = g; ell(ctx, 0, 0, r, r * 0.95); ctx.fill();
    ctx.fillStyle = '#fffbe8'; ell(ctx, r * 0.1, r * 0.45, r * 0.7, r * 0.4); ctx.fill();
    for (const [x, y] of [[-0.4, -0.35], [0, -0.55], [-0.15, -0.1], [-0.55, 0.1]]) dot(ctx, x * r, y * r, r * 0.09, '#8a6a20');
    eye(ctx, r * 0.5, -r * 0.25, r * 0.24);
    ctx.strokeStyle = '#8a4b20'; ctx.lineWidth = r * 0.08; ctx.beginPath(); ctx.arc(r * 0.92, r * 0.1, r * 0.1, -1.2, 1.2); ctx.stroke();
    ctx.restore();
  },
  octopus(ctx, r, t) {
    ctx.strokeStyle = '#d2559b'; ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const x0 = -r * 0.6 + k * r * 0.24, ph = t * 4 + k;
      ctx.lineWidth = r * 0.2;
      ctx.beginPath(); ctx.moveTo(x0, r * 0.2);
      ctx.bezierCurveTo(x0 + Math.sin(ph) * r * 0.4, r * 0.7, x0 - Math.sin(ph + 1) * r * 0.4, r * 1.0, x0 + Math.sin(ph + 2) * r * 0.3, r * 1.35);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    const g = ctx.createRadialGradient(-r * 0.25, -r * 0.5, r * 0.1, 0, -r * 0.2, r * 1.1);
    g.addColorStop(0, '#ffb3d9'); g.addColorStop(1, '#c2408a');
    ctx.fillStyle = g; ell(ctx, 0, -r * 0.2, r * 0.85, r * 0.75); ctx.fill();
    ctx.fillRect(-r * 0.75, -r * 0.2, r * 1.5, r * 0.45);
    for (const [x, y] of [[-0.35, -0.6], [0.2, -0.75], [0.45, -0.35]]) dot(ctx, x * r, y * r, r * 0.08, 'rgba(255,255,255,.45)');
    eye(ctx, r * 0.25, -r * 0.05, r * 0.17); eye(ctx, -r * 0.25, -r * 0.05, r * 0.17);
  },
  turtle(ctx, r, t) {
    const pad = Math.sin(t * 3);
    ctx.fillStyle = '#7cb36b';
    for (const [x, y, s] of [[r * 0.5, -r * 0.55, 1], [r * 0.5, r * 0.55, -1], [-r * 0.55, -r * 0.45, 1], [-r * 0.55, r * 0.45, -1]]) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(s * (0.5 + pad * 0.35)); ell(ctx, 0, -s * r * 0.25, r * 0.22, r * 0.42); ctx.fill(); ctx.restore();
    }
    ell(ctx, r * 1.05, 0, r * 0.3, r * 0.24); ctx.fill();
    eye(ctx, r * 1.15, -r * 0.06, r * 0.08);
    const g = ctx.createRadialGradient(-r * 0.2, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#9fcf76'); g.addColorStop(1, '#3f7a3a');
    ctx.fillStyle = g; ell(ctx, 0, 0, r * 0.95, r * 0.72); ctx.fill();
    ctx.strokeStyle = 'rgba(30,70,30,.55)'; ctx.lineWidth = r * 0.05;
    for (const [x, y] of [[0, 0], [-0.45, -0.3], [-0.45, 0.3], [0.45, -0.3], [0.45, 0.3]]) {
      ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; ctx.lineTo(x * r + Math.cos(a) * r * 0.25, y * r + Math.sin(a) * r * 0.22); } ctx.closePath(); ctx.stroke();
    }
  },
  shark(ctx, r, t) {
    const wag = Math.sin(t * 6) * r * 0.08;
    tail(ctx, -r * 1.25, r * 1.1, '#6d7f92', 0.75, wag);
    ctx.fillStyle = '#6d7f92';
    ctx.beginPath(); ctx.moveTo(-r * 0.1, -r * 0.42); ctx.lineTo(-r * 0.35, -r * 1.0); ctx.lineTo(r * 0.3, -r * 0.42); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * 0.2, r * 0.3); ctx.lineTo(-r * 0.15, r * 0.75); ctx.lineTo(r * 0.5, r * 0.32); ctx.fill();
    ctx.fillStyle = grad(ctx, -r * 0.5, r * 0.5, '#8a9cb0', '#56677a');
    ctx.beginPath(); ctx.moveTo(r * 1.4, 0); ctx.quadraticCurveTo(r * 0.9, -r * 0.55, -r * 0.3, -r * 0.45); ctx.quadraticCurveTo(-r * 1.1, -r * 0.3, -r * 1.3, 0);
    ctx.quadraticCurveTo(-r * 1.1, r * 0.3, -r * 0.3, r * 0.42); ctx.quadraticCurveTo(r * 0.9, r * 0.5, r * 1.4, 0); ctx.fill();
    ctx.fillStyle = '#eef3f7'; ctx.beginPath(); ctx.moveTo(r * 1.3, r * 0.05); ctx.quadraticCurveTo(r * 0.6, r * 0.45, -r * 0.6, r * 0.3); ctx.quadraticCurveTo(r * 0.4, r * 0.15, r * 1.3, r * 0.05); ctx.fill();
    ctx.strokeStyle = 'rgba(40,50,60,.5)'; ctx.lineWidth = r * 0.04;
    for (const x of [0.45, 0.35, 0.25]) { ctx.beginPath(); ctx.moveTo(x * r, -r * 0.18); ctx.lineTo(x * r - r * 0.04, r * 0.14); ctx.stroke(); }
    dot(ctx, r * 0.95, -r * 0.12, r * 0.07, '#111');
    ctx.strokeStyle = '#3c4652'; ctx.lineWidth = r * 0.04; ctx.beginPath(); ctx.moveTo(r * 1.15, r * 0.14); ctx.quadraticCurveTo(r * 0.95, r * 0.24, r * 0.75, r * 0.16); ctx.stroke();
  },
  dragon(ctx, r, t) {
    const wag = Math.sin(t * 9) * r * 0.1;
    // long flowing fins
    ctx.fillStyle = 'rgba(230,80,40,.8)';
    ctx.beginPath(); ctx.moveTo(-r * 0.2, -r * 0.4); ctx.quadraticCurveTo(-r * 1.2, -r * 0.9 + wag, -r * 1.7, -r * 0.3 + wag); ctx.lineTo(-r * 1.0, -r * 0.1); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-r * 0.2, r * 0.4); ctx.quadraticCurveTo(-r * 1.2, r * 0.9 - wag, -r * 1.7, r * 0.3 - wag); ctx.lineTo(-r * 1.0, r * 0.1); ctx.fill();
    tail(ctx, -r * 1.5, r * 1.05, '#e0552d', 0.8, wag);
    const g = ctx.createLinearGradient(0, -r * 0.5, 0, r * 0.5);
    g.addColorStop(0, '#fff2b0'); g.addColorStop(0.4, '#ffc93c'); g.addColorStop(1, '#e8762a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(r * 1.6, -r * 0.05); ctx.quadraticCurveTo(r * 0.8, -r * 0.6, -r * 1.4, -r * 0.25); ctx.lineTo(-r * 1.4, r * 0.25); ctx.quadraticCurveTo(r * 0.8, r * 0.6, r * 1.6, -r * 0.05); ctx.fill();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = 'rgba(160,70,10,.45)'; ctx.lineWidth = r * 0.05;
    for (let x = -r * 1.2; x < r * 1.1; x += r * 0.32) for (const y of [-r * 0.22, r * 0.1]) { ctx.beginPath(); ctx.arc(x, y, r * 0.18, -1.2, 1.2); ctx.stroke(); }
    ctx.restore();
    // whiskers and a shimmer
    ctx.strokeStyle = '#f9d77a'; ctx.lineWidth = r * 0.05;
    ctx.beginPath(); ctx.moveTo(r * 1.5, r * 0.05); ctx.quadraticCurveTo(r * 1.9, r * 0.3, r * 1.8, r * 0.55 + wag); ctx.stroke();
    dot(ctx, r * 1.15, -r * 0.12, r * 0.1, '#2a1a0a'); dot(ctx, r * 1.17, -r * 0.15, r * 0.035, '#fff');
    const s = (Math.sin(t * 5) + 1) / 2;
    star(ctx, -r * 0.3 + s * r, -r * 0.2, r * 0.25 * s, 'rgba(255,255,255,.9)');
  },
  jelly(ctx, r, t) {
    const pulse = 1 + Math.sin(t * 3) * 0.08;
    ctx.strokeStyle = 'rgba(255,160,210,.6)'; ctx.lineWidth = r * 0.08;
    for (let k = 0; k < 5; k++) {
      const x0 = -r * 0.6 + k * r * 0.3;
      ctx.beginPath(); ctx.moveTo(x0, 0);
      ctx.quadraticCurveTo(x0 + Math.sin(t * 3 + k) * r * 0.3, r * 0.9, x0 + Math.sin(t * 3 + k + 1) * r * 0.25, r * 1.6); ctx.stroke();
    }
    const g = ctx.createRadialGradient(0, -r * 0.4, r * 0.1, 0, -r * 0.1, r);
    g.addColorStop(0, 'rgba(255,230,245,.95)'); g.addColorStop(1, 'rgba(255,120,190,.55)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, r * pulse, r * 0.85 / pulse, 0, Math.PI, 0);
    for (let k = 0; k <= 6; k++) ctx.lineTo(r * pulse - (k / 6) * 2 * r * pulse, k % 2 ? r * 0.18 : 0);
    ctx.fill();
    dot(ctx, -r * 0.3, -r * 0.45, r * 0.12, 'rgba(255,255,255,.7)');
  },
  pearl(ctx, r, t) {
    ctx.fillStyle = grad(ctx, -r, r, '#f6d7e6', '#c98fae');
    ctx.beginPath(); ctx.moveTo(-r * 1.2, r * 0.2);
    for (let k = 0; k <= 6; k++) { const a = Math.PI + (k / 6) * Math.PI; ctx.lineTo(Math.cos(a) * r * 1.2, r * 0.2 + Math.sin(a) * r * 1.05 - (k % 2 ? r * 0.12 : 0)); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(150,80,110,.5)'; ctx.lineWidth = r * 0.06;
    for (let k = 1; k < 5; k++) { const a = Math.PI + (k / 5) * Math.PI; ctx.beginPath(); ctx.moveTo(0, r * 0.2); ctx.lineTo(Math.cos(a) * r * 1.1, r * 0.2 + Math.sin(a) * r * 0.95); ctx.stroke(); }
    ctx.fillStyle = grad(ctx, r * 0.2, r * 0.9, '#e9b8cf', '#b77a98'); ell(ctx, 0, r * 0.45, r * 1.2, r * 0.42); ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.15, r * 0.05, r * 0.05, 0, r * 0.2, r * 0.5);
    g.addColorStop(0, '#fff'); g.addColorStop(0.6, '#f3f0ff'); g.addColorStop(1, '#c9c2e6');
    ctx.fillStyle = g; ell(ctx, 0, r * 0.2, r * 0.45, r * 0.45); ctx.fill();
    const s = (Math.sin(t * 4) + 1) / 2;
    star(ctx, r * 0.15, 0, r * 0.35 * s, 'rgba(255,255,255,.95)');
  },
  chest(ctx, r, t) {
    ctx.fillStyle = '#8a5524'; ctx.fillRect(-r * 1.1, -r * 0.3, r * 2.2, r * 1.0);
    ctx.fillStyle = '#a8692e'; ctx.beginPath(); ctx.moveTo(-r * 1.1, -r * 0.3); ctx.quadraticCurveTo(0, -r * 1.15, r * 1.1, -r * 0.3); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#5a3412'; ctx.lineWidth = r * 0.06; ctx.strokeRect(-r * 1.1, -r * 0.3, r * 2.2, r * 1.0);
    ctx.fillStyle = '#f2c94c';
    for (const x of [-r * 0.75, r * 0.65]) { ctx.fillRect(x, -r * 0.85, r * 0.12, r * 1.55); }
    ctx.fillRect(-r * 1.1, -r * 0.36, r * 2.2, r * 0.12);
    ctx.fillRect(-r * 0.18, -r * 0.45, r * 0.36, r * 0.42);
    dot(ctx, 0, -r * 0.2, r * 0.07, '#5a3412');
    const s = (Math.sin(t * 2.5) + 1) / 2;
    star(ctx, r * 0.6, -r * 0.6, r * 0.3 * s, 'rgba(255,240,170,.95)');
  },
  boot(ctx, r) {
    ctx.fillStyle = '#7a4b2a';
    ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 1.0); ctx.lineTo(r * 0.15, -r * 1.0); ctx.lineTo(r * 0.2, r * 0.1); ctx.quadraticCurveTo(r * 1.1, r * 0.15, r * 1.1, r * 0.6);
    ctx.lineTo(-r * 0.6, r * 0.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3b2412'; ctx.fillRect(-r * 0.62, r * 0.5, r * 1.75, r * 0.2);
    ctx.strokeStyle = '#d8c7a8'; ctx.lineWidth = r * 0.07;
    for (const y of [-0.7, -0.45, -0.2]) { ctx.beginPath(); ctx.moveTo(-r * 0.15, y * r); ctx.lineTo(r * 0.12, y * r + r * 0.1); ctx.stroke(); }
    ctx.fillStyle = 'rgba(80,140,60,.6)'; ell(ctx, -r * 0.3, -r * 0.95, r * 0.25, r * 0.08); ctx.fill();
  },
  can(ctx, r) {
    ctx.rotate(-0.5);
    ctx.fillStyle = grad(ctx, -r, r, '#d63a3a', '#8e1f1f'); ctx.fillRect(-r * 0.6, -r, r * 1.2, r * 2);
    ctx.fillStyle = '#e8e8ee'; ctx.fillRect(-r * 0.6, -r * 0.25, r * 1.2, r * 0.5);
    ctx.fillStyle = '#c5c8d0'; ell(ctx, 0, -r, r * 0.6, r * 0.2); ctx.fill(); ell(ctx, 0, r, r * 0.6, r * 0.2); ctx.fill();
  },
  rock(ctx, r, t, seed = 1) {
    const R = rnd(seed * 7919), n = 9, pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; const rr = r * (0.8 + R() * 0.25); pts.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.75]); }
    const p = new Path2D(), mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], m0 = mid(pts[n - 1], pts[0]);
    p.moveTo(m0[0], m0[1]); for (let i = 0; i < n; i++) { const q = pts[i], m = mid(q, pts[(i + 1) % n]); p.quadraticCurveTo(q[0], q[1], m[0], m[1]); }
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r * 1.1);
    g.addColorStop(0, '#a9b4bd'); g.addColorStop(1, '#4f5b66');
    ctx.fillStyle = g; ctx.fill(p);
    ctx.fillStyle = 'rgba(90,150,90,.55)'; ell(ctx, -r * 0.2, -r * 0.55, r * 0.45, r * 0.12); ctx.fill();
    for (const [x, y] of [[0.3, -0.1], [-0.4, 0.15], [0.1, 0.3]]) dot(ctx, x * r, y * r, r * 0.08, 'rgba(235,235,225,.7)');
  },
};
function star(ctx, x, y, s, color) {
  if (s <= 0.2) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, rr = k % 2 ? s * 0.25 : s; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill();
}
// One kind on its own, centred at 0, 0, facing right (the 图鉴 cards, and the game).
export function paintKind(ctx, kind, r, t = 0, seed = 1) {
  PAINT[kind](ctx, r, t, seed);
}

// ---- the background: sky, sea, seabed, drawn once per level and size ----
let bgCache = { key: '', canvas: null };
function background(g, scale) {
  const key = g.seed + ':' + g.level + ':' + scale;
  if (bgCache.key === key) return bgCache.canvas;
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const ctx = c.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const R = rnd(g.seed ^ (g.level * 7919));
  // sky, sun, clouds, an island far off
  ctx.fillStyle = grad(ctx, 0, WATER, '#8fd6f5', '#e6f7ff'); ctx.fillRect(0, 0, W, WATER);
  const sun = ctx.createRadialGradient(300, 30, 2, 300, 30, 34);
  sun.addColorStop(0, '#fffbe6'); sun.addColorStop(0.35, '#ffe9a3'); sun.addColorStop(1, 'rgba(255,233,163,0)');
  ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(300, 30, 34, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  for (const [x, y, s] of [[40 + R() * 40, 24 + R() * 10, 1], [230 + R() * 30, 40 + R() * 10, 0.75]]) {
    for (const [dx, dy, r] of [[0, 0, 9], [10, -5, 11], [22, 0, 9], [11, 3, 9]]) { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, TAU); ctx.fill(); }
  }
  ctx.fillStyle = '#7fbf8e';
  ctx.beginPath(); ctx.moveTo(14, WATER); ctx.quadraticCurveTo(40, WATER - 22, 70, WATER - 12); ctx.quadraticCurveTo(90, WATER - 18, 110, WATER); ctx.fill();
  ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(52, WATER - 16); ctx.quadraticCurveTo(54, WATER - 30, 50, WATER - 38); ctx.stroke();
  ctx.fillStyle = '#4f9a5a';
  for (const a of [-2.6, -2.0, -1.2, -0.5]) { ctx.beginPath(); ctx.ellipse(50 + Math.cos(a) * 8, WATER - 38 + Math.sin(a) * 4, 9, 2.6, a, 0, TAU); ctx.fill(); }
  // the sea, darker deeper down, with light coming down from the surface
  const sea = ctx.createLinearGradient(0, WATER, 0, H);
  sea.addColorStop(0, '#5cc8ec'); sea.addColorStop(0.35, '#2b93c9'); sea.addColorStop(0.75, '#16609a'); sea.addColorStop(1, '#0d3f6e');
  ctx.fillStyle = sea; ctx.fillRect(0, WATER, W, H - WATER);
  for (let i = 0; i < 6; i++) {
    const x = R() * W, w = 14 + R() * 26;
    const ray = ctx.createLinearGradient(0, WATER, 0, WATER + 260);
    ray.addColorStop(0, 'rgba(255,255,255,.16)'); ray.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = ray;
    ctx.beginPath(); ctx.moveTo(x, WATER); ctx.lineTo(x + w, WATER); ctx.lineTo(x + w + 70, WATER + 260); ctx.lineTo(x + 40, WATER + 260); ctx.closePath(); ctx.fill();
  }
  // the seabed: sand with ripples, corals and pebbles
  ctx.fillStyle = grad(ctx, SEABED - 6, H, '#e9d39b', '#c9a865');
  ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 12) ctx.lineTo(x, SEABED + 4 * Math.sin(x / 37 + g.level) + 3 * Math.sin(x / 13));
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(160,120,60,.35)'; ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) { const x = R() * W, y = SEABED + 10 + R() * 22; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 8, y - 3, x + 16, y); ctx.stroke(); }
  for (let i = 0; i < 4; i++) {
    const x = 20 + R() * (W - 40), base = SEABED + 6, col = ['#ff7f7f', '#ff9ed1', '#ffb36b', '#c38bff'][i % 4];
    ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.lineWidth = 3.2;
    const branch = (x0, y0, a, len, d) => { if (d > 3) return; const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); branch(x1, y1, a - 0.5, len * 0.7, d + 1); branch(x1, y1, a + 0.45, len * 0.7, d + 1); };
    branch(x, base, -Math.PI / 2 + (R() - 0.5) * 0.3, 9 + R() * 5, 0);
    ctx.lineCap = 'butt';
  }
  for (let i = 0; i < 30; i++) dot(ctx, R() * W, SEABED + 8 + R() * 26, 0.8 + R() * 1.6, R() < 0.5 ? 'rgba(120,90,50,.35)' : 'rgba(255,250,230,.4)');
  bgCache = { key, canvas: c };
  return c;
}

// seaweed swaying, bubbles rising: drawn every frame, from the clock only
function sea(ctx, g, t) {
  const R = rnd(g.seed ^ 0xBEEF);
  for (let i = 0; i < 7; i++) {
    const x = 10 + R() * (W - 20), h = 40 + R() * 50, col = R() < 0.5 ? '#2f8f5b' : '#3fa86a', ph = R() * 6;
    ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, SEABED + 8);
    for (let k = 1; k <= 6; k++) { const y = SEABED + 8 - (h * k) / 6; ctx.lineTo(x + Math.sin(t * 1.4 + ph + k * 0.6) * k * 1.4, y); }
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.8;
  for (let i = 0; i < 14; i++) {
    const x0 = hash(i * 31 + 7) * W, speed = 14 + hash(i * 17 + 3) * 18, span = H - WATER - 20;
    const y = H - 10 - ((t * speed + hash(i * 13) * span) % span), x = x0 + Math.sin(t * 2 + i) * 3, r = 1 + hash(i * 5) * 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  }
  // the surface: a little wave
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.beginPath(); ctx.moveTo(0, WATER - 1);
  for (let x = 0; x <= W; x += 8) ctx.lineTo(x, WATER - 1 + Math.sin(x / 18 + t * 2) * 1.6);
  ctx.lineTo(W, WATER + 3); ctx.lineTo(0, WATER + 3); ctx.closePath(); ctx.fill();
}

// ---- everything in the water ----
function item(ctx, g, it, t, held) {
  ctx.save();
  ctx.translate(it.x, it.y);
  const k = KINDS[it.kind];
  if (held) {
    // hanging off the hook: head up, wriggling (fish), or just swaying
    ctx.rotate(-g.hook.a);
    if (k.group === 'fish' && it.kind !== 'jelly' && it.kind !== 'octopus') ctx.rotate(-Math.PI / 2 + Math.sin(t * 14) * 0.25);
  } else if (it.vx < 0) ctx.scale(-1, 1);
  paintKind(ctx, it.kind, it.r, t + it.id * 0.37, it.id + g.level * 101);
  ctx.restore();
}

// ---- the boat, the cat and the rod ----
// The cat is いらすとや's grey tabby with a white belly and white paws
// (web/public/fishing/SOURCES.md), standing on the boat; until it has loaded,
// the boat is just empty for a moment.
const CAT = typeof Image === 'undefined' ? null : Object.assign(new Image(), { src: '/fishing/cat.webp' });
const CAT_H = 60, CAT_W = CAT_H * 272 / 300;
export const BOAT = { x: PIVOT.x + 42, y: WATER - 4 };
function boat(ctx, g, t) {
  const bob = Math.sin(t * 1.6) * 1.2, bx = BOAT.x, by = BOAT.y + bob;
  const heavy = g.hook.state === 'back' && g.hook.item && (g.hook.item.w ?? KINDS[g.hook.item.kind].w) >= 1.5;
  // the cat, standing on the deck (leaning back a little when the catch is heavy)
  const cx = bx - CAT_W / 2 + 5, cy = by - 7 - CAT_H;
  if (CAT?.complete && CAT.naturalWidth) {
    ctx.save();
    ctx.translate(cx + CAT_W / 2, by - 7); ctx.rotate(heavy ? 0.07 + Math.sin(t * 18) * 0.02 : Math.sin(t * 1.3) * 0.015);
    ctx.drawImage(CAT, -CAT_W / 2, -CAT_H, CAT_W, CAT_H);
    ctx.restore();
  }
  // the hull
  ctx.fillStyle = '#b5652d';
  ctx.beginPath(); ctx.moveTo(bx - 30, by - 8); ctx.lineTo(bx + 30, by - 8); ctx.quadraticCurveTo(bx + 26, by + 8, bx + 14, by + 9); ctx.lineTo(bx - 16, by + 9); ctx.quadraticCurveTo(bx - 28, by + 6, bx - 30, by - 8); ctx.fill();
  ctx.fillStyle = '#8a4520'; ctx.fillRect(bx - 30, by - 9, 60, 3);
  ctx.strokeStyle = 'rgba(80,35,10,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx - 26, by - 1); ctx.lineTo(bx + 26, by - 1); ctx.stroke();
  // the rod, from the cat's front paws to the tip, and the reel spinning with the line
  const hx = cx + CAT_W * 0.3, hy = cy + CAT_H * 0.74;
  ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(hx + 4, hy + 3); ctx.quadraticCurveTo((hx + PIVOT.x) / 2, PIVOT.y + 2, PIVOT.x, PIVOT.y); ctx.stroke();
  ctx.lineCap = 'butt';
  const rx = hx - 3, ry = hy - 1, spin = (g.hook.len - ROPE0) / 5;
  ctx.fillStyle = '#9aa4ae'; ctx.beginPath(); ctx.arc(rx, ry, 3.8, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#4a525a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + Math.cos(spin) * 4, ry + Math.sin(spin) * 4); ctx.stroke();
}

// ---- line, float and hook ----
// The float sits on the surface where the line goes in; the hook swings under
// the water at the end of the line.
function hook(ctx, g, t) {
  const h = g.hook, [tx, ty] = tipOf(h);
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PIVOT.x, PIVOT.y); ctx.lineTo(tx, ty); ctx.stroke();
  if (ty > WATER) {
    const fx = surfaceX(h.a), fy = WATER + Math.sin(t * 3) * 0.8;
    ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.ellipse(fx, fy - 1, 3.4, 4.2, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(fx, fy - 1, 3.4, 3, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#333'; ctx.fillRect(fx - 0.5, fy - 8, 1, 3.5);
  }
  ctx.save(); ctx.translate(tx, ty); ctx.rotate(-h.a);
  // down the line is +y here: a little weight, then the hook (open while it's empty)
  ctx.fillStyle = '#5b6470'; ctx.beginPath(); ctx.ellipse(0, -3, 1.8, 2.6, 0, 0, TAU); ctx.fill();
  if (!h.item) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(20,40,60,.55)'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(0, 7); ctx.arc(-4, 7, 4, 0, Math.PI * 0.95); ctx.stroke();
    ctx.strokeStyle = '#e6edf3'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(0, 7); ctx.arc(-4, 7, 4, 0, Math.PI * 0.95); ctx.stroke();
    ctx.lineCap = 'butt';
  }
  ctx.restore();
}

// ---- effects: coins popping up, splashes, a cut line ----
// fx: [{ kind: 'pop', text, color, x, y, at, big } | { kind: 'ring', x, y, at }
//      | { kind: 'fly', what, r, x, y, at }  (a catch flying from the hook into the boat)], at in ms
function effects(ctx, fx, now) {
  for (const e of fx) {
    const age = (now - e.at) / 1000;
    if (e.kind === 'fly') {
      if (age < 0 || age > 0.55) continue;
      const k = age / 0.55, tx = BOAT.x - 8, ty = BOAT.y - 14;
      const x = e.x + (tx - e.x) * k, y = e.y + (ty - e.y) * k - Math.sin(k * Math.PI) * 40;
      ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 2 + k * 6); ctx.globalAlpha = k < 0.8 ? 1 : (1 - k) / 0.2;
      paintKind(ctx, e.what, e.r * (1 - 0.45 * k), now / 1000, 1);
      ctx.restore(); ctx.globalAlpha = 1;
    } else if (e.kind === 'ring') {
      if (age > 0.6) continue;
      const k = age / 0.6;
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`; ctx.lineWidth = 1.5;
      ell(ctx, e.x, e.y, 4 + 18 * k, 1.5 + 5 * k); ctx.stroke();
      ell(ctx, e.x, e.y, 2 + 9 * k, 1 + 2.5 * k); ctx.stroke();
    } else {
      if (age > 1.3) continue;
      const k = age / 1.3;
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      ctx.font = `900 ${e.big ? 21 : 16}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(10,40,70,.75)'; ctx.lineJoin = 'round';
      const y = e.y - 26 * Math.min(1, k * 2);
      ctx.strokeText(e.text, e.x, y); ctx.fillStyle = e.color; ctx.fillText(e.text, e.x, y);
      ctx.globalAlpha = 1;
    }
  }
}

// ---- what's on top: coins, target, level, time ----
const coins = n => n.toLocaleString('en-US');
function coin(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
  g.addColorStop(0, '#fff6b0'); g.addColorStop(0.6, '#f7c63b'); g.addColorStop(1, '#c78d0c');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#a06a00'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r * 0.65, 0, TAU); ctx.stroke();
}
function hud(ctx, g, now) {
  ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
  const text = (s, x, y, size, color, align = 'left') => {
    ctx.font = `900 ${size}px system-ui, sans-serif`; ctx.textAlign = align;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,40,70,.55)'; ctx.strokeText(s, x, y);
    ctx.fillStyle = color; ctx.fillText(s, x, y);
  };
  coin(ctx, 18, 19, 8);
  text(coins(g.money), 31, 26, 20, '#ffe25c');
  const done = g.money >= g.target;
  text((done ? '✓ ' : '目标 ') + coins(g.target), 11, 45, 12.5, done ? '#c8ffb0' : '#fff');
  text('第 ' + g.level + ' 关', W - 10, 24, 15, '#fff', 'right');
  if (g.phase === 'play') {
    const secs = Math.ceil(g.left / HZ), low = secs <= 10;
    const pulse = low ? 1 + 0.12 * Math.max(0, Math.sin(now / 90)) : 1;
    text('⏱ ' + secs, W - 10, 46, 15 * pulse, low ? '#ff8a7a' : '#fff', 'right');
  }
  const boosts = [g.boost.strong && '💪', g.boost.bait && '🪱', g.boost.clover && '🍀', g.boost.recycle && '♻️'].filter(Boolean).join(' ');
  if (boosts) { ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(boosts, W - 10, 64); }
}

export function draw(ctx, g, scale, fx, now) {
  const t = now / 1000;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(background(g, scale), 0, 0);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  sea(ctx, g, t);
  for (const it of g.items) item(ctx, g, it, t, false);
  boat(ctx, g, t);
  hook(ctx, g, t);
  if (g.hook.item) item(ctx, g, g.hook.item, t, true);
  effects(ctx, fx, now);
  hud(ctx, g, now);
}

// where a popup about coins shows: next to the boat; where the line meets the water
export const POP_AT = { x: PIVOT.x - 38, y: PIVOT.y - 14 };
export const surfaceX = a => PIVOT.x + (Math.sin(a) / Math.cos(a)) * (WATER - PIVOT.y);

// How far each kind's drawing reaches from its centre, in units of r:
// [left, right, top, bottom]. fitKind sizes and centres one in a w × h box.
const EXTENT = {
  minnow: [1.65, 1.25, 0.95, 0.65], clown: [1.7, 1.2, 1.05, 0.75], angel: [1.6, 1.0, 1.75, 1.75], puffer: [1.6, 1.25, 1.25, 1.25],
  octopus: [0.95, 0.95, 1.0, 1.45], turtle: [1.0, 1.35, 1.0, 1.0], shark: [2.1, 1.45, 1.05, 0.85], dragon: [2.3, 1.9, 0.95, 0.95],
  jelly: [1.1, 1.1, 0.9, 1.65], pearl: [1.25, 1.25, 0.95, 0.9], chest: [1.15, 1.15, 0.9, 0.75], boot: [0.65, 1.15, 1.05, 0.75],
  can: [1.0, 1.0, 1.1, 1.1], rock: [1.05, 1.05, 0.85, 0.85],
};
export function fitKind(kind, w, h) {
  const [l, r, t, b] = EXTENT[kind];
  const s = Math.min(w / (l + r), h / (t + b));
  return { r: s, x: w / 2 + (l - r) * s / 2, y: h / 2 + (t - b) * s / 2 };
}
