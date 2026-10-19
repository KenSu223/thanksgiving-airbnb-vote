import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { newGame, step, HZ, W, H, WATER, GOODS, KINDS, target } from './sim.js';
import { draw, POP_AT, surfaceX } from './draw.js';
import * as sfx from './sfx.js';

// One run of 小小钓鱼. The simulation steps 60 times a second; inputs between
// steps are queued for the next one and every input is recorded: the server
// replays them to check the score (verify.js), and a best run can be watched
// again. With `replay` (a recorded input list) it plays those back instead of
// taking input, at 1×, 2× or 4×. Each level opens with a short card (第 N 关 ·
// 目标) while the clock waits.
// Tap / click the water, ↓ or space: cast. ✂️ or ↑: cut loose what's on the line.
const ASPECT = W / H;
const PAD = 8, GAP = 8, BAR_H = 48; // around the field, and the button bar under it (fishing.css)
const SPEEDS = [1, 2, 4];
const CARD_MS = 1400;
const coins = n => '🪙 ' + n.toLocaleString('en-US');
// what the buttons and the shop need; React only hears when it changes
function viewOf(g) {
  const carrying = g.phase === 'play' && g.hook.state === 'back' && g.hook.item ? g.hook.item.kind : null;
  const v = { phase: g.phase, level: g.level, money: g.money, target: g.target, scissors: g.scissors, carrying,
    canNext: g.phase === 'play' && g.money >= g.target, shop: g.shop };
  v.key = [v.phase, v.level, v.money, v.scissors, carrying, v.canNext, (g.shop || []).map(o => +o.bought).join('')].join('|');
  return v;
}
const GOOD = Object.fromEntries(GOODS.map(x => [x.key, x]));

export default function FishGame({ seed, paused, onPause, onResume, onDone, onLeave, replay, replayName, touch, children }) {
  const wrap = useRef(null), canvas = useRef(null);
  const g = useRef(null), pending = useRef([]), log = useRef([]), cursor = useRef(0), fx = useRef([]);
  const speedRef = useRef(1), cardUntil = useRef(0), doneRef = useRef(false), overAt = useRef(null), lastBeep = useRef(null);
  const callbacks = useRef({ onDone, onPause });
  callbacks.current = { onDone, onPause };
  if (!g.current) g.current = newGame(seed);
  const [view, setView] = useState(() => viewOf(g.current));
  const [card, setCard] = useState(1); // the level whose card is showing, or 0
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [soundOff, setSoundOff] = useState(sfx.isMuted);
  const toggleSound = () => { const m = !sfx.isMuted(); sfx.setMuted(m); setSoundOff(m); };
  const [speed, setSpeed] = useState(1);
  speedRef.current = speed;
  const hold = paused;
  const live = !replay && !hold;
  // the loop reads these without restarting
  const holdRef = useRef(hold), cardRef = useRef(card), viewKey = useRef(view.key);
  holdRef.current = hold; cardRef.current = card; viewKey.current = view.key;

  // fit the 3:4 field and the bar under it into whatever space there is, together in the middle
  useLayoutEffect(() => {
    const el = wrap.current;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.width - 2 * PAD, (r.height - 2 * PAD - GAP - BAR_H) * ASPECT));
      setSize({ w: Math.floor(w), h: Math.floor(w / ASPECT) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the level card: on for a moment, then the clock starts
  useEffect(() => {
    if (!card || hold) return;
    cardUntil.current = performance.now() + CARD_MS / speedRef.current;
    const id = setTimeout(() => setCard(0), CARD_MS / speedRef.current);
    return () => clearTimeout(id);
  }, [card, hold]);

  // the loop: fixed 60 ticks a second, drawing every frame
  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    const scale = (size.w * dpr) / W;
    let raf = 0, last = performance.now(), acc = 0;
    const pop = (text, color, now, big, dy = 0) => fx.current.push({ kind: 'pop', text, color, x: POP_AT.x, y: POP_AT.y + dy, at: now, big });
    const happened = (sim, now) => {
      for (const h of sim.happened) {
        if (h.type === 'cast') { sfx.play('cast'); fx.current.push({ kind: 'ring', x: surfaceX(sim.hook.a), y: WATER, at: now + 180 }); }
        else if (h.type === 'hook') sfx.play('hook');
        else if (h.type === 'miss') sfx.play('miss');
        else if (h.type === 'cut') { sfx.play('cut'); fx.current.push({ kind: 'ring', x: h.x, y: h.y, at: now }); pop('✂️', '#fff', now, false); }
        else if (h.type === 'buy') sfx.play('buy');
        else if (h.type === 'pass') sfx.play('pass');
        else if (h.type === 'land') {
          const text = h.what === 'scissors' ? '✂️ +1' : h.what === 'strong' ? '💪 大力！' : '+' + h.v.toLocaleString('en-US');
          const color = h.what ? '#fff' : h.v >= 300 ? '#9ef0ff' : h.v >= 40 ? '#ffe25c' : '#d6e6f2';
          pop(text, color, now, h.v >= 300);
          if (h.first) pop('新！' + KINDS[h.kind].label, '#b8ffcf', now + 250, false, 20);
          sfx.play(h.v >= 300 ? 'big' : h.v >= 40 || h.what ? 'coin' : 'junk');
        }
      }
      if (sim.over && sim.end === 'fail') sfx.play('fail');
    };
    const frame = now => {
      const sim = g.current;
      const running = !holdRef.current && !cardRef.current && now >= cardUntil.current;
      if (running && !sim.over) {
        const sp = replay ? speedRef.current : 1;
        acc += Math.min(now - last, 250) * sp;
        let n = 0;
        while (acc >= 1000 / HZ && !sim.over && n++ < 8 * sp) {
          let ev;
          if (replay) { // play the recorded inputs back on their ticks
            ev = [];
            while (cursor.current < replay.length && replay[cursor.current][0] <= sim.tick) {
              const e = replay[cursor.current++];
              if (e[0] === sim.tick) ev.push(e);
            }
          } else {
            ev = pending.current.map(e => [sim.tick, ...e]);
            pending.current = [];
            log.current.push(...ev);
          }
          const level = sim.level;
          step(sim, ev);
          happened(sim, now);
          acc -= 1000 / HZ;
          // the last ten seconds tick
          if (sim.phase === 'play' && sim.left <= 10 * HZ && sim.left % HZ === 0 && lastBeep.current !== sim.left) { lastBeep.current = sim.left; sfx.play('tick'); }
          if (sim.level !== level) { cardRef.current = sim.level; setCard(sim.level); acc = 0; break; }
        }
      } else acc = 0;
      last = now;
      fx.current = fx.current.filter(e => now - e.at < 1600);
      draw(ctx, sim, scale, fx.current, now);
      const v = viewOf(sim);
      if (v.key !== viewKey.current) { viewKey.current = v.key; setView(v); }
      if (sim.over && overAt.current === null) overAt.current = now;
      // let the last catch land before the result covers the water
      if (sim.over && now - overAt.current > 700 && !doneRef.current) { doneRef.current = true; callbacks.current.onDone(sim, log.current); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]); // eslint-disable-line react-hooks/exhaustive-deps -- replay never changes for one run; the rest is read through refs

  // ---- inputs (queued for the next tick; only when they'd do something) ----
  const queue = e => { if (!pending.current.some(p => p[0] === e[0])) pending.current.push(e); };
  const cast = () => { const s = g.current; if (live && !card && s.phase === 'play' && s.hook.state === 'swing') queue([0]); };
  const cut = () => { const s = g.current; if (live && s.phase === 'play' && s.hook.state === 'back' && s.hook.item && s.scissors > 0) queue([1]); };
  const buy = i => { if (live && g.current.phase === 'shop') queue([2, i]); };
  const next = () => { if (live) queue([3]); };
  const end = () => { if (!replay && !g.current.over) queue([4]); };
  useEffect(() => {
    const key = e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable) return;
      if (/^m$/i.test(e.key) && !e.repeat) { toggleSound(); return; }
      if (replay || e.repeat) return;
      sfx.unlock();
      if (e.key === 'Escape') { callbacks.current.onPause(); return; }
      if (e.key === 'ArrowDown' || e.key === ' ' || /^s$/i.test(e.key)) { e.preventDefault(); cast(); }
      else if (e.key === 'ArrowUp' || /^w$/i.test(e.key)) { e.preventDefault(); cut(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }); // every render: cast / cut see the latest card and hold

  const onField = e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    sfx.unlock();
    cast();
  };
  const nextTarget = target(view.level + 1);
  const junk = view.carrying && KINDS[view.carrying].group === 'junk';

  return (
    <div ref={wrap} className="fh-stage" onPointerDownCapture={sfx.unlock}>
      <div className="fh-field" style={{ width: size.w, height: size.h }}>
        <canvas ref={canvas} className="fh-canvas" style={{ width: size.w, height: size.h }}
          aria-label="小小钓鱼：点一下放线" onPointerDown={onField} onContextMenu={e => e.preventDefault()} />
        {replay && <div className="fh-replay-tag">回放 · {replayName}</div>}
        <div className="fh-tools">
          {!replay && view.phase !== 'over' && <button className="fh-tool" onClick={onPause} aria-label="暂停">⏸</button>}
          <button className="fh-tool" onClick={toggleSound} aria-pressed={!soundOff} aria-label={(soundOff ? '打开音效' : '关闭音效') + (touch ? '' : '（M）')}>{soundOff ? '🔇' : '🔊'}</button>
          {replay && <button className="fh-tool" onClick={onLeave} aria-label="退出回放">✕</button>}
          {replay && <button className="fh-tool" onClick={() => setSpeed(s => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} aria-label={`回放速度 ${speed} 倍，点一下换`}>{speed}×</button>}
        </div>
        {card > 0 && view.phase === 'play' && (
          <div className="fh-card" aria-live="polite">
            <small>第 {card} 关</small>
            <strong>目标 {coins(view.target)}</strong>
            <span>{card === 1 ? '60 秒内钓到这么多金币' : `还差 ${coins(Math.max(0, view.target - view.money))}`}</span>
          </div>
        )}
        {view.phase === 'shop' && (
          <div className="fh-shop">
            <div className="fh-shop-head">
              <div className="text-xl font-extrabold">🎉 第 {view.level} 关过了！</div>
              <div className="text-sm text-sky-100/90">现在 {coins(view.money)} · 下一关目标 {coins(nextTarget)}</div>
            </div>
            <div className="fh-goods">
              {view.shop.map((o, i) => {
                const good = GOOD[o.key];
                return (
                  <button key={o.key} className="fh-good" onClick={() => buy(i)} disabled={!!replay || o.bought || view.money < o.price}>
                    <span className="fh-good-icon" aria-hidden="true">{good.emoji}</span>
                    <span className="fh-good-text"><b>{good.label}</b><small>{good.tip}</small></span>
                    <span className="fh-price">{o.bought ? '已买' : coins(o.price)}</span>
                  </button>
                );
              })}
            </div>
            <p className="fh-shop-note">买东西会花金币，成绩是最后剩下的金币。现在有 ✂️ ×{view.scissors}</p>
            {!replay && <div className="flex gap-2 justify-center">
              <button className="fh-btn fh-btn-sun" onClick={next}>下一关 →</button>
              <button className="fh-btn fh-btn-dim" onClick={end}>到这里结算</button>
            </div>}
          </div>
        )}
        {hold && view.phase !== 'over' && (
          <div className="fh-over">
            <div className="text-lg font-bold">暂停了</div>
            <button onClick={onResume} className="fh-btn fh-btn-sun mt-3">继续</button>
            <button onClick={() => { end(); onResume(); }} className="fh-btn fh-btn-dim mt-2">到这里结算（{coins(view.money)}）</button>
          </div>
        )}
        {children}
      </div>
      <div className="fh-bar" style={{ width: Math.max(size.w, 280) }}>
        <button className={'fh-cut' + (junk && view.scissors ? ' ready' : '')} onClick={cut} disabled={!!replay || !view.scissors || view.phase !== 'play'}
          aria-label={`剪刀：剪断线放走钩上的东西，还有 ${view.scissors} 把${touch ? '' : '（↑）'}`}>✂️<b>×{view.scissors}</b>{!touch && <small>↑</small>}</button>
        <span className="fh-hint">{view.phase === 'over' ? '' : replay ? '回放：操作和原来那局一模一样' : view.phase === 'shop' ? '商店：买完点「下一关」' : touch ? '点水面放线' : '点画面 / ↓ / 空格 放线'}</span>
        {view.canNext && !card
          ? <button className="fh-next" onClick={next} disabled={!!replay}>够了，下一关 →</button>
          : <span className="fh-next-space" aria-hidden="true" />}
      </div>
    </div>
  );
}
