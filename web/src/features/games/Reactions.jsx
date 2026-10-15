import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../../session/SessionContext.jsx';

// 牌桌表情 + 快捷嘲讽（清单和服务器 worker/games/reactions.js 一致）：
// 登录了就能用，不用坐下。先在面板里选一个（钮变成选中的样子），再
// 按住钮拖到某个在座的人身上 — 气泡冒在对方座位旁，带着发送者的
// 名字，全桌都看得见，停留约 4 秒。只在游戏页里出现、只发给当前这张桌。
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

// 找手指/鼠标底下那个座位（座位根元素带 data-react-to=玩家 key）。
// 直接命中最好；没命中时就近认领：出牌摆在座位框外面（掼蛋/斗地主的
// Said 区），用户往"这个人"身上拖、落在他的牌上也应算 — 取 120px 内
// 离得最近的座位。隐藏面板里的座位是 0 尺寸矩形，跳过。
const seatAt = (x, y) => {
  const el = document.elementFromPoint(x, y);
  const seat = el && el.closest ? el.closest('[data-react-to]') : null;
  if (seat) return { el: seat, key: seat.getAttribute('data-react-to') };
  let best = null, bestD = 120;
  document.querySelectorAll('[data-react-to]').forEach(s => {
    const r = s.getBoundingClientRect();
    if (!r.width) return;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = s; }
  });
  return best ? { el: best, key: best.getAttribute('data-react-to') } : null;
};

// 文字太长，塞进小圆钮里只放前三个字（全文本在面板里和气泡里都是全的）
const abbr = v => v.replace(/\s*[^\p{L}\p{N}？?！!。]+$/u, '').slice(0, 3);

// 右下角的表情钮 + 面板。登录了就显示，不用坐下。流程：点开钮 → 在
// 面板里点一个，面板收起，钮就变成选中的那个（emoji 直接显示，文字
// 缩成小字塞进圆钮）→ 按住钮拖到某个在座的人身上松手，气泡冒在对方
// 座位旁、带着发送者名字。选中不消耗，想再发直接再拖。
export function ReactionBar({ send, active }) {
  const { name, token } = useSession();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(REACTION_EMOJIS[0]); // 当前选中的表情/文字
  const [ghost, setGhost] = useState(null); // 拖动中的 { v, x, y }
  const drag = useRef(null); // { x0, y0, moved, seatEl }

  const clearHover = () => {
    if (drag.current?.seatEl) drag.current.seatEl.classList.remove('gt-drop-on');
    if (drag.current) drag.current.seatEl = null;
  };

  useEffect(() => () => { // 卸载时把拖动态清干净
    if (drag.current?.seatEl) drag.current.seatEl.classList.remove('gt-drop-on');
    drag.current = null;
  }, []);

  // 切到别的标签页/别的游戏就藏起来（钮是 portal 到 body 的，不跟着
  // 面板一起被 hidden 藏掉），顺手把面板和拖动态收掉
  useEffect(() => {
    if (active) return;
    setOpen(false);
    setGhost(null);
    if (drag.current?.seatEl) drag.current.seatEl.classList.remove('gt-drop-on');
  }, [active]);

  // 钮本身就是拖的把手：轻点开/收面板，拖动则把选中值放给座位上的人
  const startDrag = e => {
    if (e.button != null && e.button !== 0) return;
    drag.current = { x0: e.clientX, y0: e.clientY, moved: false, seatEl: null };
    const move = ev => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 9) return;
      d.moved = true;
      setGhost({ v: sel, x: ev.clientX, y: ev.clientY });
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
      if (hit) send({ type: 'react', value: sel, target: hit.key });
      else if (!d.moved) setOpen(o => !o); // 没拖动 = 点了一下：开/收面板
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const pick = v => { setSel(v); setOpen(false); };

  if (!name || !token || !active) return null; // 没登录发不了（服务器也要验身份）；不在当前游戏里就不出现
  // 挂到 body 上：牌桌全屏时桌面是 portal 出去的浮层（z-60），按钮留在
  // 页面树里会被祖先的层叠上下文压在浮层下面（桌面端全屏时就看不见）。
  return createPortal(
    <div className="fixed right-3 z-[65] flex flex-col items-end gap-2" style={{ bottom: 'calc(6.5rem + env(safe-area-inset-bottom))' }}>
      {ghost && <div className={'gt-ghost' + (isPhrase(ghost.v) ? ' phrase' : '')} style={{ left: ghost.x, top: ghost.y }}>{ghost.v}</div>}
      {open && (
        <div className="glass-sheet rounded-3xl p-3 w-[19rem] max-w-[86vw]">
          <div className="text-xs text-slate-500 px-1 pb-2">点一个选好，再按住下面的圆钮拖到某个人身上</div>
          <div className="grid grid-cols-5 gap-1">
            {REACTION_EMOJIS.map(e => (
              <button key={e} onClick={() => pick(e)} className={'text-[26px] leading-none py-1.5 rounded-xl hover:bg-white/70 active:scale-90 transition' + (e === sel ? ' bg-amber-200/80 ring-2 ring-amber-400' : '')}>{e}</button>
            ))}
          </div>
          <div className="border-t border-slate-900/10 mt-2 pt-2 flex flex-col">
            {REACTION_PHRASES.map(p => (
              <button key={p} onClick={() => pick(p)} className={'text-left text-sm font-medium text-slate-700 px-2 py-1.5 rounded-lg hover:bg-white/70 active:scale-[.98] transition' + (p === sel ? ' bg-amber-200/80 ring-2 ring-amber-400' : '')}>{p}</button>
            ))}
          </div>
        </div>
      )}
      <button onPointerDown={startDrag} aria-label="发表情：点开选择，按住拖到座位上发送"
        className="glass-sheet touch-none w-12 h-12 rounded-full grid place-items-center active:scale-90 transition select-none">
        {isPhrase(sel)
          ? <span className="text-[11px] font-bold leading-tight text-center text-slate-700 px-0.5">{abbr(sel)}</span>
          : <span className="text-[22px] leading-none">{sel}</span>}
      </button>
    </div>, document.body);
}
