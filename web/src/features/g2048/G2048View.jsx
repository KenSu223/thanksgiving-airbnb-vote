import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../../session/SessionContext.jsx';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { useG2048 } from './useG2048.js';
import { GOAL, SIZE, move } from './logic.js';
import './g2048.css';

// 2048：盘面在服务器上（新砖是服务器出的），离开、刷新、换设备都接着玩。
// 按方向键（或滑一下）时先在这里把砖滑过去，服务器回了新砖再补上；
// 服务器的盘面和这里猜的对不上（比如另一个标签页先走了），就照服务器的摆。
// 一次只有一步在路上；手快按的下一步排着，回来了再走。
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
const SWIPE = 24; // 滑动超过这么多像素才算

const gridOf = tiles => {
  const g = new Array(SIZE * SIZE).fill(0);
  for (const t of tiles) if (!t.gone) g[t.i] = t.v;
  return g;
};
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

export default function G2048View({ active }) {
  const { name, ensureName } = useSession();
  const [tiles, setTiles] = useState([]);
  const [game, setGame] = useState(null); // 服务器的这局：{ grid, score, moves, over, won, keep }
  const [best, setBest] = useState(null);
  const [board, setBoard] = useState([]);
  const [msg, setMsg] = useState('');
  const nextId = useRef(1), tilesRef = useRef([]), gameRef = useRef(null);
  const inflight = useRef(null), queue = useRef([]), sweepTimer = useRef(null);
  tilesRef.current = tiles; gameRef.current = game;

  const build = useCallback(grid => grid.flatMap((v, i) => (v ? [{ id: nextId.current++, v, i, kind: '' }] : [])), []);
  const put = useCallback(next => {
    tilesRef.current = next; setTiles(next);
    // 合掉的那两块滑到位以后就拿掉
    clearTimeout(sweepTimer.current);
    if (next.some(t => t.gone)) sweepTimer.current = setTimeout(() => put(tilesRef.current.filter(t => !t.gone)), 140);
  }, []);
  // 砖按 steps 滑过去：合成的两块滑到同一格后消失，那格冒出一块两倍的
  const slide = useCallback((list, steps) => {
    const at = new Map(list.filter(t => !t.gone).map(t => [t.i, t]));
    const out = [], landed = new Map();
    for (const s of steps) {
      const t = at.get(s.from);
      if (!t) return null;
      if (s.merge) {
        const base = landed.get(s.to);
        if (!base) return null;
        base.gone = true;
        out.push({ ...t, i: s.to, kind: '', gone: true });
        out.push({ id: nextId.current++, v: t.v * 2, i: s.to, kind: 'merged' });
      } else {
        const moved = { ...t, i: s.to, kind: '' };
        out.push(moved); landed.set(s.to, moved);
      }
    }
    return out;
  }, []);

  const go = useRef(null);
  const onState = useCallback(m => {
    if (m.board) setBoard(m.board);
    if (m.best) setBest(m.best);
    if (m.error) { setMsg(m.error); setTimeout(() => setMsg(''), 3000); }
    if (!m.game) return;
    const g = m.game, f = inflight.current;
    let next = null;
    if (m.spawn && m.dir) {
      // 一步走完了：先看是不是这里猜的那步，不是就（另一个标签页走的）照着滑一遍
      const after = g.grid.slice(); after[m.spawn.at] = 0;
      let list = tilesRef.current.filter(t => !t.gone);
      if (f && f.n + 1 === g.moves) list = tilesRef.current;
      else {
        const r = move(gridOf(list), m.dir);
        list = r.moved ? slide(list, r.steps) : null;
      }
      if (list && same(gridOf(list), after)) next = [...list, { id: nextId.current++, v: m.spawn.v, i: m.spawn.at, kind: 'new' }];
    }
    if (!next && !same(gridOf(tilesRef.current), g.grid)) next = build(g.grid);
    if (next) put(next);
    if (f) { inflight.current = null; if (m.stale || m.still) queue.current = []; }
    setGame(g); gameRef.current = g;
    if (f && !f.wonBefore && g.won && !reduceMotion) confetti({ particleCount: 160, spread: 100, origin: { y: 0.4 }, colors: CONFETTI_COLORS }); // 这一步拼出了 2048
    if (queue.current.length && !inflight.current) setTimeout(() => go.current(queue.current.shift()), 0);
  }, [build, put, slide]);

  const { live, send } = useG2048(active, onState); // 没登录也连：排行榜照样看

  // 走一步：先滑过去，再告诉服务器
  go.current = dir => {
    const g = gameRef.current;
    if (!g || g.over || (g.won && !g.keep)) return;
    if (inflight.current) { if (queue.current.length < 2) queue.current.push(dir); return; }
    const r = move(gridOf(tilesRef.current), dir);
    if (!r.moved) return;
    const list = slide(tilesRef.current, r.steps);
    if (!list) { put(build(g.grid)); return; }
    if (!send({ type: 'move', dir, n: g.moves })) return;
    inflight.current = { n: g.moves, dir, wonBefore: g.won };
    put(list);
    setGame({ ...g, score: g.score + r.gained }); // 分先加上，服务器回来会再对一遍
    // 网断了没回音：别一直卡着
    setTimeout(() => { if (inflight.current?.n === g.moves) { inflight.current = null; queue.current = []; } }, 5000);
  };

  // 方向键 / WASD（打字的时候不算）
  useEffect(() => {
    if (!active) return;
    const onKey = e => {
      const dir = KEYS[e.key];
      if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      go.current(dir);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // 滑动（手指或鼠标拖）
  const start = useRef(null);
  const onDown = e => {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } // 滑出盘面再松手也算
  };
  const onUp = e => {
    const s = start.current; start.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return;
    go.current(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  };

  const newGame = () => {
    const g = gameRef.current;
    if (g && g.moves > 0 && !g.over && !window.confirm('放弃这局，重新开始？')) return;
    inflight.current = null; queue.current = [];
    send({ type: 'new' });
  };
  const keep = () => send({ type: 'keep' });

  const mine = board.find(r => name && r.name.toLowerCase() === name.toLowerCase());
  const ready = !!name && !!game;
  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <section className="lg:col-span-2 g48-card rounded-2xl shadow-xl p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <h2 className="g48-title">2048</h2>
          <div className="g48-stat"><span>分数</span><b className="tabular-nums">{(game?.score ?? 0).toLocaleString()}</b></div>
          <div className="g48-stat"><span>最好</span><b className="tabular-nums">{best ? best.tile.toLocaleString() : '—'}</b></div>
          <button onClick={name ? newGame : () => ensureName(() => {})} className="g48-btn ml-auto">{name ? '新游戏' : '登录开始'}</button>
        </div>
        <div className="g48-board" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { start.current = null; }}
          role="application" aria-label="2048 盘面：用方向键或者滑动来移动">
          {Array.from({ length: SIZE * SIZE }, (_, i) => <div key={'c' + i} className="g48-cell" style={{ '--r': Math.floor(i / SIZE), '--c': i % SIZE }} />)}
          {tiles.map(t => (
            <div key={t.id} className={'g48-tile g48-v' + Math.min(t.v, 4096) + (t.v >= 1024 ? ' g48-wide' : t.v >= 128 ? ' g48-mid' : '') + (t.kind ? ' g48-' + t.kind : '') + (t.gone ? ' g48-gone' : '')}
              style={{ '--r': Math.floor(t.i / SIZE), '--c': t.i % SIZE }}>{t.v}</div>
          ))}
          {!name && <div className="g48-over"><p className="font-bold text-lg">登录就能玩</p><button className="g48-btn mt-2" onClick={() => ensureName(() => {})}>登录开始</button></div>}
          {name && !game && <div className="g48-over"><p className="text-sm">{live ? '正在拿你的那局…' : '连接中…'}</p></div>}
          {ready && game.over && (
            <div className="g48-over">
              <p className="text-2xl font-extrabold">没地方走了</p>
              <p className="text-sm mt-1">这局 {game.score.toLocaleString()} 分 · 最大 {Math.max(...game.grid)}</p>
              <button className="g48-btn mt-3" onClick={newGame}>再来一局</button>
            </div>
          )}
          {ready && !game.over && game.won && !game.keep && (
            <div className="g48-over g48-win">
              <p className="text-2xl font-extrabold">🎉 拼出 {GOAL} 了！</p>
              <div className="flex gap-2 mt-3"><button className="g48-btn" onClick={keep}>继续玩</button><button className="g48-btn g48-btn-ghost" onClick={newGame}>新游戏</button></div>
            </div>
          )}
        </div>
        <p className="g48-help">⌨️ 方向键 / WASD，📱 在盘面上滑。两块一样的撞到一起合成一块，拼出 {GOAL}！离开、刷新、换手机都不会丢，回来接着玩。</p>
        {(msg || (name && game && !live)) && <p className="text-sm text-amber-700 mt-1">{msg || '连接断了，正在重连…'}</p>}
      </section>
      <aside className="glass-card rounded-2xl p-5 self-start">
        <h2 className="font-bold text-lg mb-1">🏆 2048 排行榜</h2>
        <p className="text-xs text-slate-500 mb-3">每人拼出过的最大一块 · 一样大比最高分 · 新砖是服务器出的，改不了</p>
        {board.length ? board.map((r, i) => (
          <div key={r.name} className={'flex items-center justify-between gap-2 border-b py-1.5 text-sm' + (mine && r.name === mine.name ? ' font-bold text-indigo-700' : '')}>
            <span className="truncate">{i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1) + '.'} {r.name}</span>
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className={'g48-chip g48-v' + Math.min(r.tile, 4096)}>{r.tile}</span>
              <span className="text-xs font-normal text-slate-400 tabular-nums">{r.score.toLocaleString()} 分 · {r.games} 局</span>
            </span>
          </div>
        )) : <p className="text-sm text-slate-400">还没人玩过，来当第一</p>}
      </aside>
    </div>
  );
}
