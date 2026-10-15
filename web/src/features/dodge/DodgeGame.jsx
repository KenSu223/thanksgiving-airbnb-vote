import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { newGame, step, HZ, HERO, DIRS, SKILLS } from './sim.js';
import { planBot } from './bot.js';
import { draw } from './draw.js';
import { VIEW, pointInArena } from './viewport.js';
import { soundEvents } from './sound-events.js';
import * as sfx from './sfx.js';

// One run. The simulation steps 60 times a second; inputs between steps are
// queued and applied on the next one, and every input is recorded: the
// server replays them to check the score (verify.js), and a best run can be
// watched again. With `replay` (a recorded input list) it plays those back
// instead of taking input, at 1×, 2× or 4×.
// PC: right-click (or hold it) to move, F / D for 闪现 toward the mouse.
// Phone: joystick on the left, 闪现 button on the right.
const dirOf = (dx, dy) => ((Math.round(Math.atan2(dy, dx) / (2 * Math.PI) * DIRS) % DIRS) + DIRS) % DIRS;
const ASPECT = VIEW.width / VIEW.height;
const SPEEDS = [1, 2, 4];

export default function DodgeGame({ seed, touch, hold, onGo, onDead, onPause, replay, replayName, bot, children }) {
  const wrap = useRef(null), canvas = useRef(null), hud = useRef(null), cdBtn = useRef(null), joyEl = useRef(null);
  const g = useRef(null), pending = useRef({}), mouse = useRef(null), joy = useRef(null);
  const aim = useRef(null), inputEnabled = useRef(false);
  const log = useRef([]), cursor = useRef(0), speedRef = useRef(1);
  const callbacks = useRef({ onDead, onPause });
  callbacks.current = { onDead, onPause };
  const botRef = useRef(false); // 外挂开关（bot.js）：开着时每 tick 由算法接管走位；回放时不介入
  botRef.current = !!bot;
  const [count, setCount] = useState(replay ? 0 : 3); // 3, 2, 1, then go (a replay just starts)
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [soundOff, setSoundOff] = useState(sfx.isMuted);
  const toggleSound = () => { const m = !sfx.isMuted(); sfx.setMuted(m); setSoundOff(m); };
  const [speed, setSpeed] = useState(1);
  speedRef.current = speed;
  const doneRef = useRef(false), deathAt = useRef(null), beeped = useRef(null);
  if (!g.current) g.current = newGame(seed);
  inputEnabled.current = !replay && count <= 0 && !hold && !g.current.over;

  useEffect(() => {
    if (!hold) return;
    pending.current = {};
    joy.current = null; aim.current = null; rightDown.current = false;
    g.current.hero.mode = null;
    if (joyEl.current) joyEl.current.hidden = true;
  }, [hold]);

  // fit a 16:10 arena into whatever space there is
  useLayoutEffect(() => {
    const el = wrap.current;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const w = Math.min(r.width, r.height * ASPECT), h = w / ASPECT;
      setSize({ w: Math.floor(w), h: Math.floor(h) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 3-2-1, then tell the page the run has started
  // (this also re-runs on pause / resume: beep each number only once)
  useEffect(() => {
    if (count <= 0) {
      if (beeped.current !== 0) { beeped.current = 0; if (!replay) sfx.play('go'); }
      onGo?.(); return;
    }
    if (hold) return;
    if (beeped.current !== count) { beeped.current = count; sfx.play('count'); }
    const id = setTimeout(() => setCount(c => c - 1), 600);
    return () => clearTimeout(id);
  }, [count, hold]); // eslint-disable-line react-hooks/exhaustive-deps -- onGo is a fresh arrow each render

  // the loop: fixed 60 ticks a second, drawing every frame
  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    const scale = (size.w * dpr) / VIEW.width;
    let raf = 0, last = performance.now(), acc = 0;
    const running = count <= 0 && !hold;
    const frame = now => {
      const sim = g.current;
      if (running && !sim.over) {
        const sp = speedRef.current;
        acc += Math.min(now - last, 250) * sp;
        let n = 0;
        while (acc >= 1000 / HZ && !sim.over && n++ < 8 * sp) {
          const ev = [];
          if (replay) { // play the recorded inputs back on their ticks
            while (cursor.current < replay.length && replay[cursor.current][0] <= sim.tick) {
              const e = replay[cursor.current++];
              if (e[0] === sim.tick) ev.push(e);
            }
          } else {
            const p = pending.current;
            // whole pixels, so the recorded input is exactly what was played
            if (p.move) ev.push([sim.tick, 0, Math.round(p.move[0]), Math.round(p.move[1])]);
            if (p.dir !== undefined) ev.push([sim.tick, 1, p.dir]);
            if (p.flash !== undefined) ev.push([sim.tick, 2, p.flash]);
            pending.current = {};
            if (botRef.current) {
              // The autopilot's inputs are ordinary inputs: they join
              // the same event list BEFORE it is logged, so a bot run
              // records (and server-verifies) exactly like a hand-played one.
              const c = planBot(sim);
              if (c.flash !== undefined) ev.push([sim.tick, 2, c.flash]);
              else if (c.move) ev.push([sim.tick, 0, Math.round(c.move[0]), Math.round(c.move[1])]);
            }
            log.current.push(...ev);
          }
          const wasOver = sim.over;
          step(sim, ev);
          for (const e of soundEvents(sim, wasOver)) sfx.play(e.sound, e);
          acc -= 1000 / HZ;
        }
      }
      last = now;
      if (sim.over && deathAt.current === null) { deathAt.current = now; inputEnabled.current = false; aim.current = null; }
      const deathAge = deathAt.current === null ? 0 : (now - deathAt.current) * HZ / 1000;
      draw(ctx, sim, scale, aim.current, deathAge);
      if (hud.current) hud.current.textContent = '存活 ' + (sim.tick / HZ).toFixed(1) + ' 秒';
      if (cdBtn.current) {
        const left = sim.hero.cd / HERO.flashCd;
        cdBtn.current.style.setProperty('--p', String(left));
        cdBtn.current.dataset.left = left > 0 ? Math.ceil(sim.hero.cd / HZ) : '';
        cdBtn.current.setAttribute('aria-disabled', String(!running || sim.over || left > 0));
      }
      // Let the hit and fall read before the result panel covers the battlefield.
      // Only presentation is delayed: the submitted survival tick stays frozen.
      if (sim.over && deathAge >= 27 && !doneRef.current) { doneRef.current = true; callbacks.current.onDead(sim, log.current); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, count, hold]);

  // ---- inputs ----
  const toArena = e => {
    const r = canvas.current.getBoundingClientRect();
    return pointInArena(e.clientX, e.clientY, r);
  };
  const flash = k => { if (inputEnabled.current && !g.current.hero.cd) pending.current.flash = k; };
  // PC: right button moves (hold it to keep following the mouse)
  const rightDown = useRef(false);
  const onPointerDown = e => {
    if (!inputEnabled.current || e.pointerType === 'touch') return;
    mouse.current = toArena(e);
    if (e.button === 2) { rightDown.current = true; canvas.current.setPointerCapture(e.pointerId); pending.current.move = mouse.current; }
  };
  const onPointerMove = e => {
    if (!inputEnabled.current || e.pointerType === 'touch') return;
    mouse.current = toArena(e);
    if (rightDown.current) pending.current.move = mouse.current;
  };
  const onPointerUp = e => { if (e.button === 2) rightDown.current = false; };
  useEffect(() => {
    const key = e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
      if (/^m$/i.test(e.key) && !e.repeat) { toggleSound(); return; }
      if (!inputEnabled.current) return;
      sfx.unlock();
      if (e.key === 'Escape') { callbacks.current.onPause(); return; }
      if (e.repeat || !/^[fd]$/i.test(e.key)) return;
      e.preventDefault();
      const h = g.current.hero, m = mouse.current;
      flash(m ? dirOf(m[0] - h.x, m[1] - h.y) : -1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // phone: a floating joystick wherever the left thumb lands
  const joyDown = e => {
    e.preventDefault();
    if (!inputEnabled.current || joy.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    joy.current = { id: e.pointerId, x: e.clientX, y: e.clientY, k: -1 };
    paintJoy(0, 0);
  };
  const joyMove = e => {
    const j = joy.current;
    if (!inputEnabled.current || !j || j.id !== e.pointerId) return;
    let dx = e.clientX - j.x, dy = e.clientY - j.y;
    const d = Math.sqrt(dx * dx + dy * dy), R = 48;
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    const k = d > 10 ? dirOf(dx, dy) : -1;
    if (k !== j.k) { j.k = k; pending.current.dir = k; }
    paintJoy(dx, dy);
  };
  const joyUp = e => {
    const j = joy.current;
    if (!j || j.id !== e.pointerId) return;
    joy.current = null;
    pending.current.dir = -1;
    paintJoy(null);
  };
  function paintJoy(dx, dy) {
    const el = joyEl.current;
    if (!el) return;
    if (dx === null) { el.hidden = true; return; }
    const r = wrap.current.getBoundingClientRect();
    el.hidden = false;
    el.style.left = (joy.current.x - r.left) + 'px';
    el.style.top = (joy.current.y - r.top) + 'px';
    el.style.setProperty('--kx', dx + 'px'); el.style.setProperty('--ky', dy + 'px');
  }
  // Drag independently of the movement thumb; release to cast, drag far to cancel.
  const flashDown = e => {
    e.preventDefault();
    if (!inputEnabled.current || g.current.hero.cd || aim.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    aim.current = { id: e.pointerId, x: e.clientX, y: e.clientY, k: joy.current?.k ?? -1, cancel: false };
  };
  const flashMove = e => {
    const a = aim.current;
    if (!a || a.id !== e.pointerId) return;
    const dx = e.clientX - a.x, dy = e.clientY - a.y, d = Math.hypot(dx, dy);
    if (d > 10) a.k = dirOf(dx, dy);
    a.cancel = d > 140;
  };
  const flashUp = e => {
    const a = aim.current;
    if (!a || a.id !== e.pointerId) return;
    if (!a.cancel) flash(a.k);
    aim.current = null;
  };

  return (
    <div ref={wrap} className="dg-stage" onPointerDownCapture={sfx.unlock}>
      <canvas ref={canvas} className="dg-canvas" style={{ width: size.w, height: size.h }}
        aria-label="鲁班七号躲技能训练场"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => { rightDown.current = false; }} onLostPointerCapture={() => { rightDown.current = false; }} onContextMenu={e => e.preventDefault()} />
      <div className="dg-hud"><span className="dg-hud-title">{replay ? `回放 · ${replayName}` : '峡谷 · 走位训练'}</span><strong ref={hud}>存活 0.0 秒</strong></div>
      <div className="dg-hero-hud" aria-hidden="true"><i className="dg-hero-avatar" /><span>鲁班七号<small>机关造物</small></span></div>
      {!hold && count <= 0 && !g.current.over && <button className="dg-pause" onClick={onPause} aria-label="暂停">⏸</button>}
      <button className="dg-sound" onClick={toggleSound} aria-pressed={!soundOff} aria-label={(soundOff ? '打开音效' : '关闭音效') + (touch ? '' : '（M）')}>{soundOff ? '🔇' : '🔊'}</button>
      {replay && <button className="dg-speed" onClick={() => setSpeed(s => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} aria-label={`回放速度 ${speed} 倍，点一下换`}>{speed}×</button>}
      {touch && !replay && <>
        <div className="dg-joy-rest" aria-hidden="true"><span /></div>
        <div className="dg-joyzone" onPointerDown={joyDown} onPointerMove={joyMove} onPointerUp={joyUp} onPointerCancel={joyUp} onLostPointerCapture={joyUp} />
        <div className="dg-joy" ref={joyEl} hidden><div className="dg-knob" /></div>
      </>}
      <div className="dg-control-hint">{replay ? '回放：操作和原来那局一模一样' : touch ? '左侧移动 · 拖动闪现瞄准 · 拖远取消' : '右键移动 · F / D 闪现 · Esc 暂停 · M 音效'}</div>
      <button ref={cdBtn} className={'dg-flash' + (touch ? ' big' : '')}
        onPointerDown={flashDown} onPointerMove={flashMove} onPointerUp={flashUp}
        onPointerCancel={() => { aim.current = null; }} onLostPointerCapture={() => { aim.current = null; }}
        onClick={e => { if (e.detail === 0) flash(-1); }} aria-label="闪现：拖动瞄准，松手释放，拖远取消">
        <svg className="dg-bolt" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 4.5 13.5h6l-1.5 8.5 10-12.5h-6.5z" /></svg><span>闪现</span>{!touch && <small>F / D</small>}
      </button>
      {count > 0 && !hold && <div className="dg-count"><small>欢迎来到走位训练</small>{count}<span>躲开每一次技能</span></div>}
      {children}
    </div>
  );
}

// "被钟馗的钩子打中了"
export const killedBy = by => (by ? `被${SKILLS[by].who}的${SKILLS[by].what}打中了` : '时间到！');
