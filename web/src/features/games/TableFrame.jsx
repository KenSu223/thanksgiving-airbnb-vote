import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BoardRows, place, TOP_NOTE } from './TopBoard.jsx';
import './table.css';

// 牌桌外框（斗地主、掼蛋、川麻）。手机横过来、又坐在桌上时，桌子铺满整个屏幕：
// 手牌不用滚动就在屏幕上，也离开了屏幕底边（那里横着划会被系统当成切换 App）。
// 直接挂到 body 上，免得被页面的转场动画（transform）框住。可以点 ✕ 退出，竖回来再横过去又会铺满。
const LANDSCAPE_PHONE = '(orientation: landscape) and (max-height: 540px)';

export function useFullTable(on) {
  const [land, setLand] = useState(() => typeof window !== 'undefined' && window.matchMedia(LANDSCAPE_PHONE).matches);
  const [off, setOff] = useState(false);
  useEffect(() => {
    const q = window.matchMedia(LANDSCAPE_PHONE);
    const f = () => setLand(q.matches);
    q.addEventListener('change', f);
    return () => q.removeEventListener('change', f);
  }, []);
  useEffect(() => { if (!land || !on) setOff(false); }, [land, on]);
  const full = land && on && !off;
  useEffect(() => {
    if (!full) return;
    document.documentElement.classList.add('gt-lock');
    return () => document.documentElement.classList.remove('gt-lock');
  }, [full]);
  return { full, exit: () => setOff(true), enter: () => setOff(false), canEnter: land && on && off };
}

export default function TableFrame({ full, onExit, className = '', children }) {
  const felt = (
    <section className={'gt-felt ' + className + (full ? ' gt-full' : ' rounded-2xl shadow-xl p-3 md:p-5')}>
      {children}
      {full && <button className="gt-exit" onClick={onExit} aria-label="退出全屏">✕</button>}
    </section>
  );
  return full ? createPortal(felt, document.body) : felt;
}

// 选桌：每张桌坐了谁、几个机器人、打到哪了
export function RoomPicker({ st, room, watch, phases, rooms = 3 }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {(st?.lobby || Array.from({ length: rooms }, (_, i) => ({ room: i + 1, people: [], bots: 0, phase: 'waiting' }))).map(l => (
        <button key={l.room} onClick={() => watch(l.room)}
          className={'rounded-2xl px-4 py-2 text-left border-2 ' + (l.room === room ? 'bg-white border-indigo-500 shadow' : 'bg-white/70 border-transparent hover:border-indigo-200')}>
          <div className="font-bold text-sm">桌 {l.room}{st?.seatedAt === l.room ? ' · 你在这' : ''}</div>
          <div className="text-xs text-slate-500">{l.people.length ? l.people.join('、') : '空着'}{l.bots ? ' + ' + l.bots + ' 🤖' : ''} · {phases[l.phase] || l.phase}{l.watching ? ' · 👀' + l.watching : ''}</div>
        </button>
      ))}
    </div>
  );
}

// 每个游戏自己的豆子榜（saveNote：什么时候存豆子，掼蛋是每手都存）；过 A 的次数（掼蛋）写在胜局后面
export function PointsBoard({ title, rows, me, saveNote = '站起来时才保存豆子', children }) {
  return (
    <aside className="glass-card rounded-2xl p-5 self-start">
      <h2 className="font-bold text-lg mb-1">🏆 {title}</h2>
      <p className="text-xs text-slate-500 mb-3">{saveNote} · 初始 1000，输光了自动补给 · {TOP_NOTE}</p>
      <BoardRows rows={rows} me={me} row={(r, i, isMe) => (
        <div key={isMe ? 'me' : r.name} className={'flex items-center justify-between gap-2 border-b py-1.5 text-sm' + (isMe ? ' font-bold text-indigo-700' : '')}>
          <span className="truncate">{place(i)} {r.name}{r.seated && <span className="text-xs text-emerald-600"> 在桌上</span>}</span>
          <span className="font-bold tabular-nums whitespace-nowrap">{r.points.toLocaleString()}
            <span className="text-xs font-normal text-slate-400"> {r.games ? r.wins + '胜/' + r.games + '局' : ''}{r.aces ? ' 过A×' + r.aces : ''}{r.refills ? ' 补给×' + r.refills : ''}</span>
          </span>
        </div>
      )} />
      <div className="text-xs text-slate-400 mt-4 leading-relaxed">{children}</div>
    </aside>
  );
}
