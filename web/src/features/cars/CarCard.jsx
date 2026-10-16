import { useState } from 'react';
import { BAGS, SEATS, TRUNK_LITERS, carLoad, carName } from './bags.js';
import BagIcon from './BagIcon.jsx';

// 座位在俯视图上的位置（车头朝上，左舵：主驾在左前）
const SPOT = {
  driver: { left: '31%', top: '41%' }, front: { left: '69%', top: '41%' },
  rearLeft: { left: '27%', top: '63%' }, rearMiddle: { left: '50%', top: '63%' }, rearRight: { left: '73%', top: '63%' },
};
const initials = n => (/^[A-Za-z0-9]/.test(n) ? n.slice(0, 2) : n.slice(-2)).toUpperCase(); // 英文名取头两个字母，中文名取最后两个字

// 一辆车：俯视的车身、五个座位按钮、后备箱装了多少
export default function CarCard({ car, index, me, actingFor, bags, busy, onSeat, onLabel }) {
  const load = carLoad(car, bags);
  const pct = Math.round((load.liters / TRUNK_LITERS) * 100);
  const filled = Object.values(car.seats).filter(Boolean).length;
  const tone = pct > 100 ? 'over' : pct > 80 ? 'tight' : 'ok';
  const skis = load.counts.skis || 0;
  const [editing, setEditing] = useState(null); // 改车名时的草稿（谁登录了都能改）
  const saveLabel = () => { onLabel(car, editing.trim()); setEditing(null); };
  return (
    <article className="car-card glass-card rounded-3xl p-5 flex flex-col">
      <header className="flex items-baseline gap-2 mb-1">
        {editing == null
          ? <h3 className="text-lg font-bold tracking-tight">{carName(car, index)}</h3>
          : <input autoFocus value={editing} onChange={e => setEditing(e.target.value)} onBlur={saveLabel}
              onKeyDown={e => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') setEditing(null); }}
              placeholder={'X5 · ' + (index + 1)} maxLength={40} aria-label="车名" className="text-lg font-bold border-b border-indigo-300 bg-transparent outline-none min-w-0 flex-1" />}
        {me && editing == null && <button onClick={() => setEditing(car.label || '')} className="text-xs text-slate-400 hover:text-indigo-600">改名</button>}
        <span className="ml-auto text-sm text-slate-500 tabular-nums">{filled} / 5</span>
      </header>
      <p className="text-xs text-slate-400 mb-3">2026 BMW X5 M60 · 5 座</p>

      <div className="car-top">
        <svg viewBox="0 0 200 360" className="car-body" aria-hidden="true">
          <defs>
            <linearGradient id={'paint' + car.id} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#e7ebf3" /><stop offset=".5" stopColor="#ffffff" /><stop offset="1" stopColor="#e7ebf3" />
            </linearGradient>
          </defs>
          <path d="M100 6C142 6 166 18 170 52L174 110V300C174 336 156 352 100 354C44 352 26 336 26 300V110L30 52C34 18 58 6 100 6Z" fill={'url(#paint' + car.id + ')'} stroke="#cdd5e3" strokeWidth="2" />
          <path d="M44 104C70 92 130 92 156 104L150 128C120 120 80 120 50 128Z" fill="#c9d3e6" />
          <path d="M52 290C80 298 120 298 148 290L154 312C120 322 80 322 46 312Z" fill="#c9d3e6" />
          <path d="M26 118 14 122M174 118 186 122" stroke="#cdd5e3" strokeWidth="5" strokeLinecap="round" />
          <path d="M68 22h64" stroke="#d8dfeb" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {SEATS.map(s => {
          const who = car.seats[s.id];
          const mine = !!who && who === actingFor;
          const label = who ? (mine ? (actingFor === me ? '你' : who) : who) : s.short;
          return (
            <button key={s.id} style={SPOT[s.id]} disabled={busy}
              className={'seat' + (who ? ' taken' : '') + (mine ? ' mine' : '') + (s.id === 'driver' ? ' driver' : '')}
              onClick={() => onSeat(car, s.id, who)}
              title={(s.id === 'driver' ? '主驾（司机）' : s.name) + (who ? ' · ' + who : ' · 空着，点一下坐这里')}
              aria-label={carName(car, index) + ' ' + s.name + (who ? '，' + who : '，空位')}>
              <span className="seat-dot">{who ? initials(who) : s.id === 'driver' ? <Wheel /> : '+'}</span>
              <span className="seat-name">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm mb-1.5">
          <span className="font-medium text-slate-600">后备箱</span>
          <span className={'tabular-nums trunk-' + tone}>{load.pieces ? load.pieces + ' 件 · 约 ' + pct + '%' : '还没人填行李'}</span>
        </div>
        <div className="trunk-bar"><span className={'trunk-fill trunk-' + tone} style={{ width: Math.min(pct, 100) + '%' }} /></div>
        {load.pieces > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2.5 text-slate-500">
            {BAGS.filter(b => load.counts[b.id]).map(b => (
              <span key={b.id} className="inline-flex items-center gap-1 text-xs" title={b.name}><BagIcon id={b.id} size={16} />×{load.counts[b.id]}</span>
            ))}
          </div>
        )}
        {(pct > 100 || (skis > 0 && car.seats.rearMiddle)) && (
          <p className="text-xs text-amber-700 mt-2">
            {pct > 100 ? '行李可能装不下，考虑挪几件到别的车。' : ''}
            {skis > 0 && car.seats.rearMiddle ? '后排中间有人时雪具包没法从中间穿过去，得放车顶。' : ''}
          </p>
        )}
      </div>
    </article>
  );
}

function Wheel() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2" /><path d="M3.8 10.5 10 12M20.2 10.5 14 12M12 14v6.3" />
    </svg>
  );
}
