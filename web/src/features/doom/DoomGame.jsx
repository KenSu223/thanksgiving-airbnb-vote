import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { newGame, step, HZ, W, H, ROAD, PERK, ZOMBIES, WEAPONS, STAGES, BOSS_SECONDS, firepower, bossHp, levelOf, stageOf } from './sim.js';
import { draw, gateText } from './draw.js';
import * as sfx from './sfx.js';

// One run of 末日小队. The simulation steps 60 times a second; inputs between
// steps are queued for the next one and every input is recorded: the server
// replays them to check the score (verify.js), and a best run can be watched
// again. With `replay` (a recorded input list) it plays those back instead of
// taking input, at 1×, 2× or 4×.
// Steering: drag on the road (phone), move the mouse over it (computer), or ← / →.
// Between waves, the three upgrades are cards to tap (or 1 / 2 / 3): small ones
// after a 小关, big ones (weapons) after a 大关; the pick before a 大关 shows
// the 尸王's DPS check next to the squad's firepower.
const ASPECT = W / H;
const PAD = 6;
const SPEEDS = [1, 2, 4];
const fmt = n => Math.round(n).toLocaleString('en-US');
function viewOf(g) {
  const v = { phase: g.phase, wave: g.wave, offers: g.offers, size: g.offerSize, count: g.squad.count, score: g.score,
    weapon: g.stats.weapon, power: g.phase === 'pick' ? firepower(g) : 0 };
  v.key = [v.phase, v.wave, (v.offers || []).join(',')].join('|');
  return v;
}
// the shot sound for each weapon
const SHOT = { rifle: 'shot', shotgun: 'shotgun', rocket: 'rocket', laser: 'laser', sniper: 'sniper' };

export default function DoomGame({ seed, paused, onPause, onResume, onDone, onLeave, replay, replayName, touch, children }) {
  const wrap = useRef(null), canvas = useRef(null);
  const g = useRef(null), pending = useRef([]), log = useRef([]), cursor = useRef(0), fx = useRef([]);
  const want = useRef(null), sentX = useRef(null), keys = useRef({ left: false, right: false }), flashUntil = useRef(0);
  const dealtLog = useRef([]); // [ms, damage dealt so far]: the squad's DPS over the last second
  const speedRef = useRef(1), doneRef = useRef(false), overAt = useRef(null);
  const callbacks = useRef({ onDone, onPause });
  callbacks.current = { onDone, onPause };
  if (!g.current) g.current = newGame(seed);
  const [view, setView] = useState(() => viewOf(g.current));
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [soundOff, setSoundOff] = useState(sfx.isMuted);
  const toggleSound = () => { const m = !sfx.isMuted(); sfx.setMuted(m); setSoundOff(m); };
  const [speed, setSpeed] = useState(1);
  speedRef.current = speed;
  const hold = paused;
  const live = !replay && !hold;
  const holdRef = useRef(hold), viewKey = useRef(view.key);
  holdRef.current = hold; viewKey.current = view.key;

  // fit the field into whatever space there is
  useLayoutEffect(() => {
    const el = wrap.current;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.width - 2 * PAD, (r.height - 2 * PAD) * ASPECT));
      setSize({ w: Math.floor(w), h: Math.floor(w / ASPECT) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the loop: fixed 60 ticks a second, drawing every frame
  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    const scale = (size.w * dpr) / W;
    let raf = 0, last = performance.now(), acc = 0;
    const pop = (text, color, x, y, now) => fx.current.push({ kind: 'pop', text, color, x, y, at: now });
    const happened = (sim, now) => {
      for (const h of sim.happened) {
        if (h.type === 'shot') { flashUntil.current = now + 60; sfx.play(SHOT[h.weapon] || 'shot'); }
        else if (h.type === 'boom') { fx.current.push({ kind: 'boom', x: h.x, y: h.y, small: true, at: now }); sfx.play('blast'); }
        else if (h.type === 'hit') fx.current.push({ kind: 'spark', x: h.x, y: h.y, crit: h.crit, at: now });
        else if (h.type === 'kill') { fx.current.push({ kind: 'splat', x: h.x, y: h.y, s: ZOMBIES[h.kind].r / 10, at: now }); sfx.play('kill'); }
        else if (h.type === 'bite') { fx.current.push({ kind: 'bite', x: h.x, y: h.y, at: now }); sfx.play('bite'); }
        else if (h.type === 'mortar') { fx.current.push({ kind: 'boom', x: h.x, y: h.y, at: now }); sfx.play('boom'); }
        else if (h.type === 'boss') sfx.play('boss');
        else if (h.type === 'perk') {
          sfx.play('perk');
          const st = stageOf(sim.wave);
          pop(st === STAGES ? '⚠️ 大关：尸王' : '第 ' + levelOf(sim.wave) + ' 关 · 小关 ' + st, st === STAGES ? '#ff9a8a' : '#ffe28a', W / 2, H * 0.42, now + 150);
        }
        else if (h.type === 'wave') sfx.play('wave');
        else if (h.type === 'gate') {
          const good = h.kind !== 'add' || h.v > 0;
          pop(h.kind === 'rate' ? gateText(h) : (h.gain >= 0 ? '+' : '') + h.gain + ' 人', good ? '#9fd6ff' : '#ff8a7a', sim.squad.x, 470, now);
          sfx.play(good ? 'good' : 'bad');
        }
      }
      if (sim.over && sim.end === 'dead') sfx.play('dead');
    };
    const frame = now => {
      const sim = g.current;
      const running = !holdRef.current;
      if (running && !sim.over) {
        const sp = replay ? speedRef.current : 1;
        acc += Math.min(now - last, 250) * sp;
        let n = 0;
        while (acc >= 1000 / HZ && !sim.over && n++ < 8 * sp) {
          let ev;
          if (replay) {
            ev = [];
            while (cursor.current < replay.length && replay[cursor.current][0] <= sim.tick) {
              const e = replay[cursor.current++];
              if (e[0] === sim.tick) ev.push(e);
            }
          } else {
            // steering: the keys nudge where we're heading; a new heading is recorded at most every other tick
            if (sim.phase === 'play') {
              const k = keys.current;
              if (k.left || k.right) want.current = Math.max(ROAD[0] + 16, Math.min(ROAD[1] - 16, (want.current ?? sim.squad.tx) + (k.right ? 7 : 0) - (k.left ? 7 : 0)));
              const x = want.current === null ? null : Math.round(want.current);
              if (x !== null && (sentX.current === null || Math.abs(x - sentX.current) >= 2) && sim.tick % 2 === 0) { pending.current.push([0, x]); sentX.current = x; }
            }
            ev = pending.current.map(e => [sim.tick, ...e]);
            pending.current = [];
            log.current.push(...ev);
          }
          step(sim, ev);
          happened(sim, now);
          acc -= 1000 / HZ;
        }
      } else acc = 0;
      last = now;
      fx.current = fx.current.filter(e => now - e.at < 1200);
      const dl = dealtLog.current;
      dl.push([now, sim.dealt]);
      while (dl.length > 2 && now - dl[1][0] > 1000) dl.shift();
      const dps = dl.length > 1 && now > dl[0][0] ? ((sim.dealt - dl[0][1]) * 1000) / (now - dl[0][0]) / (replay ? speedRef.current : 1) : 0;
      draw(ctx, sim, scale, fx.current, now, now < flashUntil.current, { dps });
      const v = viewOf(sim);
      if (v.key !== viewKey.current) { viewKey.current = v.key; setView(v); }
      if (sim.over && overAt.current === null) overAt.current = now;
      if (sim.over && now - overAt.current > 900 && !doneRef.current) { doneRef.current = true; callbacks.current.onDone(sim, log.current); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]); // eslint-disable-line react-hooks/exhaustive-deps -- replay never changes for one run; the rest is read through refs

  // ---- inputs ----
  const toX = e => { const r = canvas.current.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W; };
  const steer = e => { if (live) want.current = toX(e); };
  const dragging = useRef(false);
  const onDown = e => { sfx.unlock(); if (!live) return; dragging.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } steer(e); };
  const onMove = e => { if (e.pointerType === 'mouse' || dragging.current) steer(e); };
  const onUp = () => { dragging.current = false; };
  const pick = i => { if (live && g.current.phase === 'pick') { sfx.unlock(); pending.current.push([1, i]); } };
  const end = () => { if (!replay && !g.current.over) pending.current.push([2]); };
  useEffect(() => {
    const down = e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
      if (/^m$/i.test(e.key) && !e.repeat) { toggleSound(); return; }
      if (replay) return;
      sfx.unlock();
      if (e.key === 'Escape') { callbacks.current.onPause(); return; }
      if (['1', '2', '3'].includes(e.key) && !e.repeat) { pick(Number(e.key) - 1); return; }
      if (e.key === 'ArrowLeft' || /^a$/i.test(e.key)) { keys.current.left = true; e.preventDefault(); }
      if (e.key === 'ArrowRight' || /^d$/i.test(e.key)) { keys.current.right = true; e.preventDefault(); }
    };
    const up = e => {
      if (e.key === 'ArrowLeft' || /^a$/i.test(e.key)) keys.current.left = false;
      if (e.key === 'ArrowRight' || /^d$/i.test(e.key)) keys.current.right = false;
    };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }); // every render: pick sees the latest hold

  return (
    <div ref={wrap} className="dm-stage" onPointerDownCapture={sfx.unlock}>
      <div className="dm-field" style={{ width: size.w, height: size.h }}>
        <canvas ref={canvas} className="dm-canvas" style={{ width: size.w, height: size.h }}
          aria-label="末日小队：左右拖动指挥小队" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onContextMenu={e => e.preventDefault()} />
        {replay && <div className="dm-replay-tag">回放 · {replayName}</div>}
        <div className="dm-tools">
          {!replay && view.phase !== 'over' && <button className="dm-tool" onClick={onPause} aria-label="暂停">⏸</button>}
          <button className="dm-tool" onClick={toggleSound} aria-pressed={!soundOff} aria-label={(soundOff ? '打开音效' : '关闭音效') + (touch ? '' : '（M）')}>{soundOff ? '🔇' : '🔊'}</button>
          {replay && <button className="dm-tool" onClick={onLeave} aria-label="退出回放">✕</button>}
          {replay && <button className="dm-tool" onClick={() => setSpeed(s => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} aria-label={`回放速度 ${speed} 倍，点一下换`}>{speed}×</button>}
        </div>
        {view.phase === 'pick' && view.offers && (
          <div className="dm-pick">
            <div className="dm-pick-head">
              {view.size === 'big'
                ? <><div className="text-xl font-extrabold">🏆 第 {levelOf(view.wave)} 关 尸王倒了！</div>
                    <div className="text-sm text-amber-200">大关奖励：挑一件大装备（现在用的是 {WEAPONS[view.weapon].emoji} {WEAPONS[view.weapon].label}）{!touch && !replay ? ' · 按 1 / 2 / 3' : ''}</div></>
                : <><div className="text-xl font-extrabold">小关 {stageOf(view.wave)}/{STAGES - 1} 守住了！</div>
                    <div className="text-sm text-slate-300">小奖励：选一个强化（这一局一直有效）{!touch && !replay ? ' · 按 1 / 2 / 3' : ''}</div></>}
              {view.size === 'small' && stageOf(view.wave) === STAGES - 1 && (() => {
                const L = levelOf(view.wave), need = bossHp(L) / BOSS_SECONDS;
                return (
                  <div className={'dm-check' + (view.power >= need ? ' ok' : '')}>
                    ⚠️ 下一关是大关：尸王 {fmt(bossHp(L))} 血，{BOSS_SECONDS} 秒内打掉 → 每秒要 {fmt(need)}
                    <br />你现在的火力约每秒 {fmt(view.power)}{view.power >= need ? '，够了' : '，还不够：挑伤害、射速、援军'}
                  </div>
                );
              })()}
            </div>
            <div className="dm-cards">
              {view.offers.map((k, i) => (
                <button key={k} className={'dm-card' + (PERK[k].size === 'big' ? ' big' : '')} onClick={() => pick(i)} disabled={!!replay}>
                  <span className="dm-card-icon" aria-hidden="true">{PERK[k].emoji}</span>
                  <b>{PERK[k].label}</b>
                  <small>{PERK[k].tip}</small>
                  {!touch && <kbd>{i + 1}</kbd>}
                </button>
              ))}
            </div>
          </div>
        )}
        {hold && view.phase !== 'over' && (
          <div className="dm-over">
            <div className="text-lg font-bold">暂停了</div>
            <button onClick={onResume} className="dm-btn dm-btn-hot mt-3">继续</button>
            <button onClick={() => { end(); onResume(); }} className="dm-btn dm-btn-dim mt-2">到这里结算（💀 {g.current.score.toLocaleString('en-US')}）</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
