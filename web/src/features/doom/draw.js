import { W, H, ROAD, SQUAD_Y, spanOf } from './sim.js';

// Drawing one frame of 末日小队: a wrecked city road scrolling past, the
// squad at the bottom, the zombies, the gates, the bullets and the effects.
// Only reads the game, never changes it; its own random numbers (for the
// scenery) are separate from the game's. All drawn here, no images.
const TAU = Math.PI * 2;
function hash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
const ell = (ctx, x, y, rx, ry) => { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU); };
const dot = (ctx, x, y, r, c) => { ctx.fillStyle = c; ell(ctx, x, y, r, r); ctx.fill(); };

// ---- the road (scrolls with the game's clock) ----
function road(ctx, g) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#2b2337'); sky.addColorStop(0.35, '#3a3440'); sky.addColorStop(1, '#2a2a2e');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  const off = (g.tick * 1.5) % 80;
  // sidewalks with cracked slabs and rubble
  for (const [x0, x1] of [[0, ROAD[0]], [ROAD[1], W]]) {
    ctx.fillStyle = '#4b4650'; ctx.fillRect(x0, 0, x1 - x0, H);
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1;
    for (let y = -80 + off; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
  }
  for (let i = 0; i < 14; i++) {
    const y = ((hash(i * 7 + 3) * 900 + g.tick * 1.5) % 900) - 150, left = hash(i * 13) < 0.5;
    const x = left ? 4 + hash(i * 5) * (ROAD[0] - 8) : ROAD[1] + 4 + hash(i * 5) * (W - ROAD[1] - 8);
    dot(ctx, x, y, 2 + hash(i * 11) * 4, ['#6b6470', '#5a5560', '#7a6a5a'][i % 3]);
  }
  // asphalt with lane dashes, potholes and old stains
  const asphalt = ctx.createLinearGradient(ROAD[0], 0, ROAD[1], 0);
  asphalt.addColorStop(0, '#34343a'); asphalt.addColorStop(0.5, '#3d3d44'); asphalt.addColorStop(1, '#34343a');
  ctx.fillStyle = asphalt; ctx.fillRect(ROAD[0], 0, ROAD[1] - ROAD[0], H);
  ctx.fillStyle = 'rgba(240,220,120,.55)';
  for (let y = -80 + off; y < H; y += 80) ctx.fillRect(W / 2 - 2, y, 4, 40);
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.fillRect(ROAD[0] + 4, 0, 2, H); ctx.fillRect(ROAD[1] - 6, 0, 2, H);
  for (let i = 0; i < 6; i++) {
    const y = ((hash(i * 17 + 1) * 700 + g.tick * 1.5) % 700) - 50;
    const x = ROAD[0] + 30 + hash(i * 19) * (ROAD[1] - ROAD[0] - 60);
    ctx.fillStyle = i % 2 ? 'rgba(20,20,24,.45)' : 'rgba(110,40,40,.18)';
    ell(ctx, x, y, 10 + hash(i) * 14, 5 + hash(i * 3) * 6); ctx.fill();
  }
  // fog at the far end
  const fog = ctx.createLinearGradient(0, 0, 0, 120);
  fog.addColorStop(0, 'rgba(60,50,70,.9)'); fog.addColorStop(1, 'rgba(60,50,70,0)');
  ctx.fillStyle = fog; ctx.fillRect(0, 0, W, 120);
}

// ---- zombies (chibi: big round heads, arms out) ----
const SKIN = { walker: '#8fbf6a', runner: '#a6c95c', tank: '#7aa560', boss: '#6f8f4f' };
const SHIRT = { walker: '#6a5a8a', runner: '#c56a3a', tank: '#4a6a8a', boss: '#7a2a2a' };
function zombie(ctx, g, z) {
  const r = z.r, t = g.tick / 6 + z.id;
  const walk = Math.sin(t * (z.kind === 'runner' ? 1.8 : 1)) * r * 0.08;
  ctx.save(); ctx.translate(z.x, z.y); ctx.scale(1.15, 1.15);
  dot(ctx, 0, r * 0.9, r * 0.8, 'rgba(0,0,0,.25)');
  // legs
  ctx.fillStyle = '#3b3346';
  ctx.fillRect(-r * 0.4, r * 0.25 + walk, r * 0.3, r * 0.55); ctx.fillRect(r * 0.1, r * 0.25 - walk, r * 0.3, r * 0.55);
  // body
  ctx.fillStyle = SHIRT[z.kind];
  ctx.beginPath(); ctx.roundRect(-r * (z.kind === 'tank' ? 0.85 : 0.55), -r * 0.2, r * (z.kind === 'tank' ? 1.7 : 1.1), r * 0.65, r * 0.25); ctx.fill();
  // arms reaching forward (down the screen, toward the squad)
  ctx.strokeStyle = SKIN[z.kind]; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-r * 0.5, 0); ctx.lineTo(-r * 0.6, r * 0.55 + walk); ctx.moveTo(r * 0.5, 0); ctx.lineTo(r * 0.6, r * 0.55 - walk); ctx.stroke();
  ctx.lineCap = 'butt';
  // head
  const hr = r * (z.kind === 'tank' ? 0.55 : 0.62), hy = -r * 0.55;
  ctx.fillStyle = SKIN[z.kind]; ell(ctx, 0, hy, hr, hr * 0.95); ctx.fill();
  ctx.strokeStyle = 'rgba(40,60,30,.5)'; ctx.lineWidth = 1; ctx.stroke();
  // eyes (red on the boss), a stitched mouth
  const eye = z.kind === 'boss' ? '#ff3b30' : '#f8f4d8';
  dot(ctx, -hr * 0.38, hy - hr * 0.05, hr * 0.2, eye); dot(ctx, hr * 0.38, hy - hr * 0.05, hr * 0.2, eye);
  dot(ctx, -hr * 0.38, hy, hr * 0.09, '#222'); dot(ctx, hr * 0.38, hy, hr * 0.09, '#222');
  ctx.strokeStyle = '#2d3a22'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-hr * 0.35, hy + hr * 0.45); ctx.lineTo(hr * 0.35, hy + hr * 0.45); ctx.stroke();
  for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(k * hr * 0.2, hy + hr * 0.35); ctx.lineTo(k * hr * 0.2, hy + hr * 0.55); ctx.stroke(); }
  if (z.kind === 'boss') {
    ctx.fillStyle = '#f2c94c';
    ctx.beginPath(); ctx.moveTo(-hr * 0.6, hy - hr * 0.75);
    for (const [x, y] of [[-hr * 0.45, hy - hr * 1.25], [-hr * 0.15, hy - hr * 0.85], [0, hy - hr * 1.35], [hr * 0.15, hy - hr * 0.85], [hr * 0.45, hy - hr * 1.25], [hr * 0.6, hy - hr * 0.75]]) ctx.lineTo(x, y);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // a health bar once it's hurt (always for the big ones)
  if (z.hp < z.max || z.kind === 'tank' || z.kind === 'boss') {
    const w = Math.max(18, r * 1.8), x = z.x - w / 2, y = z.y - r * 1.45 - (z.kind === 'boss' ? r * 0.4 : 0);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = z.kind === 'boss' ? '#ff5a4a' : '#7ee070'; ctx.fillRect(x, y, w * Math.max(0, z.hp / z.max), 3);
  }
}

// ---- the squad: chibi soldiers in a loose block (a ×N badge past 30 drawn) ----
// drawn a bit bigger than life, so a phone shows faces and helmets
function soldier(ctx, x0, y0, t, flash) {
  ctx.save(); ctx.translate(x0, y0); ctx.scale(1.35, 1.35);
  const x = 0, y = 0;
  dot(ctx, x, y + 6, 5, 'rgba(0,0,0,.28)');
  ctx.fillStyle = '#c9a66b'; ctx.beginPath(); ctx.roundRect(x - 4, y - 2, 8, 8, 2); ctx.fill();          // body
  ctx.fillStyle = '#5a4630'; ctx.fillRect(x - 3.5, y + 5 + Math.sin(t) * 0.8, 2.5, 3); ctx.fillRect(x + 1, y + 5 - Math.sin(t) * 0.8, 2.5, 3);
  dot(ctx, x, y - 5, 4.2, '#f2c9a0');                                                                    // face
  ctx.fillStyle = '#4e6b3a'; ctx.beginPath(); ctx.arc(x, y - 6, 4.8, Math.PI, 0); ctx.fill(); ctx.fillRect(x - 5.5, y - 6.5, 11, 1.6); // helmet
  ctx.fillStyle = '#2f2f33'; ctx.fillRect(x + 1.5, y - 10, 2, 9);                                        // rifle, pointing up the road
  if (flash) { ctx.fillStyle = 'rgba(255,220,120,.95)'; ell(ctx, x + 2.5, y - 12, 2.2, 3.5); ctx.fill(); }
  ctx.restore();
}
function squad(ctx, g, flash) {
  const sq = g.squad, n = Math.min(sq.count, 30), span = spanOf(sq.count);
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * 2.2)))), rows = Math.ceil(n / cols);
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols), inRow = r === rows - 1 ? n - r * cols : cols;
    const x = sq.x + (inRow > 1 ? ((c - (inRow - 1) / 2) / Math.max(1, cols - 1)) * span : 0) + (r % 2 ? 3 : 0);
    const y = SQUAD_Y - 4 + r * 13 - (rows - 1) * 6.5;
    soldier(ctx, x, y, g.tick / 5 + i, flash && i % 2 === g.tick % 2);
  }
  // the head count, and the shield
  const label = '🪖 ' + sq.count + (sq.shield ? '  🛡️' + sq.shield : '');
  ctx.font = '900 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(label).width + 14, y = SQUAD_Y + 34 + Math.min(rows, 6) * 3;
  ctx.fillStyle = 'rgba(20,24,30,.75)'; ctx.beginPath(); ctx.roundRect(sq.x - w / 2, y - 10, w, 20, 10); ctx.fill();
  ctx.fillStyle = '#ffe28a'; ctx.fillText(label, sq.x, y + 1);
}

// ---- gates: blue = good, red = bad (shoot it until it turns blue) ----
const gateText = gt => (gt.kind === 'mul' ? '×' + gt.v : gt.kind === 'rate' ? '射速+' + gt.v + '%' : (gt.v > 0 ? '+' : '') + gt.v);
function gates(ctx, g) {
  for (const row of g.gates) {
    if (row.y < -60 || row.y > H + 30) continue;
    for (const gt of row.gates) {
      const bad = gt.kind === 'add' && gt.v <= 0, x0 = gt.x0 + 3, w = gt.x1 - gt.x0 - 6, y = row.y - 16;
      const grad = ctx.createLinearGradient(0, y, 0, y + 32);
      grad.addColorStop(0, bad ? 'rgba(255,90,80,.55)' : 'rgba(80,170,255,.55)');
      grad.addColorStop(1, bad ? 'rgba(160,30,30,.35)' : 'rgba(30,90,180,.35)');
      ctx.fillStyle = row.passed ? 'rgba(200,200,200,.12)' : grad;
      ctx.beginPath(); ctx.roundRect(x0, y, w, 32, 6); ctx.fill();
      ctx.strokeStyle = bad ? '#ff8a7a' : '#9fd6ff'; ctx.lineWidth = 2; ctx.stroke();
      if (row.passed) continue;
      ctx.font = `900 ${gt.kind === 'rate' ? 15 : 20}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineJoin = 'round';
      ctx.strokeText(gateText(gt), x0 + w / 2, row.y + 1); ctx.fillStyle = '#fff'; ctx.fillText(gateText(gt), x0 + w / 2, row.y + 1);
      if (gt.shoot) { ctx.font = '700 9px system-ui, sans-serif'; ctx.fillStyle = '#ffd0c8'; ctx.fillText('打它会变好', x0 + w / 2, row.y + 13); }
    }
  }
}

function bullets(ctx, g) {
  for (const b of g.bullets) {
    ctx.strokeStyle = b.crit ? '#ff9f43' : '#ffe58a'; ctx.lineWidth = b.crit ? 3 : 2;
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx, b.y + 9); ctx.stroke();
  }
}

// fx: [{ kind: 'spark' | 'splat' | 'boom' | 'pop' | 'bite', x, y, at, text?, color? }]
function effects(ctx, fx, now) {
  for (const e of fx) {
    const age = (now - e.at) / 1000;
    if (e.kind === 'spark') {
      if (age > 0.15) continue;
      dot(ctx, e.x, e.y, (e.crit ? 5 : 3) * (1 - age / 0.15) + 0.5, e.crit ? 'rgba(255,160,60,.9)' : 'rgba(255,240,160,.9)');
    } else if (e.kind === 'splat') {
      if (age > 0.5) continue;
      const k = age / 0.5;
      ctx.fillStyle = `rgba(120,190,80,${0.7 * (1 - k)})`;
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + e.x; dot(ctx, e.x + Math.cos(a) * 14 * k * e.s, e.y + Math.sin(a) * 10 * k * e.s, 3 * (1 - k) * e.s + 0.5, ctx.fillStyle); }
    } else if (e.kind === 'boom') {
      if (age > 0.5) continue;
      const k = age / 0.5, r = 12 + 34 * k;
      const gr = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      gr.addColorStop(0, `rgba(255,250,210,${1 - k})`); gr.addColorStop(0.4, `rgba(255,160,40,${0.85 * (1 - k)})`); gr.addColorStop(1, 'rgba(200,60,10,0)');
      ctx.fillStyle = gr; ell(ctx, e.x, e.y, r, r); ctx.fill();
    } else if (e.kind === 'bite') {
      if (age > 0.35) continue;
      ctx.fillStyle = `rgba(255,40,40,${0.35 * (1 - age / 0.35)})`; ctx.fillRect(0, SQUAD_Y - 40, W, 90);
    } else {
      if (age > 1.1) continue;
      const k = age / 1.1;
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.font = '900 17px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineJoin = 'round';
      const y = e.y - 30 * Math.min(1, k * 2);
      ctx.strokeText(e.text, e.x, y); ctx.fillStyle = e.color || '#fff'; ctx.fillText(e.text, e.x, y);
      ctx.globalAlpha = 1;
    }
  }
}

function hud(ctx, g, now) {
  ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
  const text = (s, x, y, size, color, align = 'left') => {
    ctx.font = `900 ${size}px system-ui, sans-serif`; ctx.textAlign = align;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(s, x, y);
    ctx.fillStyle = color; ctx.fillText(s, x, y);
  };
  text('第 ' + g.wave + ' 波', 10, 24, 16, '#fff');
  text('💀 ' + g.score.toLocaleString('en-US'), W - 10, 24, 16, '#ffe28a', 'right');
  if (g.zombies.some(z => z.kind === 'boss')) {
    const pulse = 0.7 + 0.3 * Math.sin(now / 120);
    text('⚠️ 尸王来了', W / 2, 52, 15, `rgba(255,110,90,${pulse})`, 'center');
  }
}

export function draw(ctx, g, scale, fx, now, flash) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  road(ctx, g);
  gates(ctx, g);
  for (const z of [...g.zombies].sort((a, b) => a.y - b.y)) zombie(ctx, g, z);
  bullets(ctx, g);
  squad(ctx, g, flash);
  effects(ctx, fx, now);
  hud(ctx, g, now);
}
export { gateText };
