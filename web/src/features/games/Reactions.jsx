import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../../session/SessionContext.jsx';

// 牌桌表情 + 快捷嘲讽（清单和服务器 worker/games/reactions.js 一致）：
// 登录了就能用，不用坐下。选一个表情/一句话，拖到（或点选后再点）某个
// 在座的人身上 — 气泡冒在对方座位旁，带着发送者的名字，全桌都看得见，
// 停留约 4 秒。只在游戏页里出现、只发给当前这张桌。
export const REACTION_EMOJIS = ['😏', '🤣', '😂', '🙄', '🥱', '😴', '😤', '🐢', '💩', '🤡', '👎', '👍', '🔥', '💣', '⏰', '😱', '😭', '🤑', '🐶', '👻'];
export const REACTION_PHRASES = [
  '给阿姨倒一杯卡布奇诺 ☕',
  '快点吧，我等到花儿都谢了',
  '就这？就这？',
  '你这牌打得也太好了吧',
  '我要报警了',
  '感谢老板，老板大气',
  '这把我稳了',
  '不服来战',
  '溜了溜了',
  '再来一把！',
];
const isPhrase = v => v && v.length > 2;

// 某个座位收到的表情（服务器发来的 reactions 数组按 to 过滤）
export const reactionsFor = (reactions, key) => (Array.isArray(reactions) && key ? reactions.filter(r => r.to === key) : []);

// 一个气泡：谁发的（小名牌）+ 表情本体。内层 span 用 at 做 key —— 同一
// 座位连收表情时元素必须换新，CSS 动画才会重新播；不换的话动画停在最
// 后一帧（透明），后面的表情全都看不见（"按几次就不行了"的元凶）。
export function ReactBubble({ value }) {
  if (!value) return null;
  const { v, at, byName } = value;
  return (
    <span className="gt-react">
      {byName && <i className="gt-react-by">{byName}</i>}
      {isPhrase(v)
        ? <span key={at} className="gt-react-text">{v}</span>
        : <span key={at} className="gt-react-emoji">{v}</span>}
    </span>
  );
}

// 座位角上的一摞气泡（最多显示最近 3 个）
export function ReactBubbles({ list }) {
  if (!list || !list.length) return null;
  return (
    <span className="gt-react-stack">
      {list.slice(-3).map(r => <ReactBubble key={r.at + ':' + r.by} value={r} />)}
    </span>
  );
}

// 找手指/鼠标底下那个座位（座位根元素带 data-react-to=玩家 key）
const seatAt = (x, y) => {
  const el = document.elementFromPoint(x, y);
  const seat = el && el.closest ? el.closest('[data-react-to]') : null;
  return seat ? { el: seat, key: seat.getAttribute('data-react-to') } : null;
};

// 右下角的表情钮 + 面板。登录了就显示，不用坐下。选完一个表情有两种
// 放法：按住拖到座位上松手，或者点一下选中（面板收起、钮旁挂个小牌），
// 再点座位放下。
export function ReactionBar({ send }) {
  const { name, token } = useSession();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(null); // 选好了、等点座位的值
  const [ghost, setGhost] = useState(null); // 拖动中的 { v, x, y }
  const drag = useRef(null); // { v, x0, y0, moved, seatEl }
  const armedRef = useRef(null);
  armedRef.current = armed;

  const clearHover = () => {
    if (drag.current?.seatEl) drag.current.seatEl.classList.remove('gt-drop-on');
    if (drag.current) drag.current.seatEl = null;
  };
  const fire = (v, to) => { send({ type: 'react', value: v, target: to }); setArmed(null); setOpen(false); };

  // 选中状态下：点到座位就放下，点到别处就取消（小牌自己的按钮除外）
  useEffect(() => {
    if (!armed) return;
    const onDown = e => {
      const seat = e.target && e.target.closest ? e.target.closest('[data-react-to]') : null;
      if (seat) { fire(armedRef.current, seat.getAttribute('data-react-to')); return; }
      if (e.target.closest && e.target.closest('[data-armed-chip]')) return;
      setArmed(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [armed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { // 卸载时把拖动态清干净
    if (drag.current?.seatEl) drag.current.seatEl.classList.remove('gt-drop-on');
    drag.current = null;
  }, []);

  const startDrag = (e, v) => {
    if (e.button != null && e.button !== 0) return;
    drag.current = { v, x0: e.clientX, y0: e.clientY, moved: false, seatEl: null };
    const move = ev => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 9) return;
      d.moved = true;
      setGhost({ v: d.v, x: ev.clientX, y: ev.clientY });
      const hit = seatAt(ev.clientX, ev.clientY);
      if (hit?.el !== d.seatEl) { clearHover(); if (hit) { hit.el.classList.add('gt-drop-on'); d.seatEl = hit.el; } }
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const d = drag.current;
      drag.current = null;
      setGhost(null);
      if (!d) return;
      const hit = d.moved ? seatAt(ev.clientX, ev.clientY) : null;
      clearHover();
      if (hit) fire(d.v, hit.key);
      else setArmed(d.v); // 没拖动（点选）或没落在座位上：挂成待放下，再点座位
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  if (!name || !token) return null; // 没登录发不了（服务器也要验身份）
  // 挂到 body 上：牌桌全屏时桌面是 portal 出去的浮层（z-60），按钮留在
  // 页面树里会被祖先的层叠上下文压在浮层下面（桌面端全屏时就看不见）。
  return createPortal(
    <div className="fixed right-3 z-[65] flex flex-col items-end gap-2" style={{ bottom: 'calc(6.5rem + env(safe-area-inset-bottom))' }}>
      {ghost && <div className={'gt-ghost' + (isPhrase(ghost.v) ? ' phrase' : '')} style={{ left: ghost.x, top: ghost.y }}>{ghost.v}</div>}
      {armed && !ghost && (
        <div data-armed-chip className="glass-sheet rounded-full pl-3 pr-1.5 py-1.5 flex items-center gap-2 max-w-[86vw]">
          <span className={isPhrase(armed) ? 'text-sm font-bold text-slate-700 truncate' : 'text-[20px] leading-none'}>{armed}</span>
          <span className="text-xs text-slate-500 whitespace-nowrap">拖到或点一个座位放下</span>
          <button onClick={() => setArmed(null)} aria-label="取消" className="w-6 h-6 rounded-full bg-slate-900/10 text-slate-500 grid place-items-center text-xs active:scale-90 transition">✕</button>
        </div>
      )}
      {open && (
        <div className="glass-sheet rounded-3xl p-3 w-[19rem] max-w-[86vw]">
          <div className="text-xs text-slate-500 px-1 pb-2">选一个，拖到（或点座位放到）某个人身上</div>
          <div className="grid grid-cols-5 gap-1">
            {REACTION_EMOJIS.map(e => (
              <button key={e} onPointerDown={ev => startDrag(ev, e)} className="touch-none text-[26px] leading-none py-1.5 rounded-xl hover:bg-white/70 active:scale-90 transition">{e}</button>
            ))}
          </div>
          <div className="border-t border-slate-900/10 mt-2 pt-2 flex flex-col">
            {REACTION_PHRASES.map(p => (
              <button key={p} onPointerDown={ev => startDrag(ev, p)} className="touch-none text-left text-sm font-medium text-slate-700 px-2 py-1.5 rounded-lg hover:bg-white/70 active:scale-[.98] transition">{p}</button>
            ))}
          </div>
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} aria-label="发表情"
        className="glass-sheet w-12 h-12 rounded-full text-[22px] grid place-items-center active:scale-90 transition">
        😆
      </button>
    </div>, document.body);
}
