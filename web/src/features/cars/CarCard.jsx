import { useState } from 'react';
import { BAGS, carLoad, carName, seatName, seatShort } from './bags.js';
import { modelName, rowsText, seatCount, seatIds, trunkOf } from './models.js';
import BagIcon from './BagIcon.jsx';

// 俯视图的尺寸：车头朝上，左舵（主驾在左前）。第一排在 y=148，往后每排隔 rowGap；最后一排后面
// 留 133 给后窗和车尾（两排的车正好是原来 200×360 的图）。排数多（面包车）排得紧一点。
const FIRST_ROW = 148, TAIL = 133;
const rowGap = n => (n >= 4 ? 70 : 79);
// 每排几个座 → 从左到右的横向位置（%）
const XS = { 1: [50], 2: [30, 70], 3: [27, 50, 73], 4: [22, 40.7, 59.3, 78] };
const FRONT_XS = { 1: [31], 2: [31, 69], 3: [27, 50, 73] };
const initials = n => (/^[A-Za-z0-9]/.test(n) ? n.slice(0, 2) : n.slice(-2)).toUpperCase(); // 英文名取头两个字母，中文名取最后两个字

// 座位 id → 在俯视图上的位置
function spots(rows) {
  const H = FIRST_ROW + (rows.length - 1) * rowGap(rows.length) + TAIL;
  const ids = seatIds(rows), out = {};
  let k = 0;
  rows.forEach((n, r) => {
    const xs = (r === 0 ? FRONT_XS : XS)[n] || XS[3];
    for (let i = 0; i < n; i++) out[ids[k++]] = { left: xs[i] + '%', top: ((FIRST_ROW + r * rowGap(rows.length)) / H * 100).toFixed(2) + '%' };
  });
  return { H, out };
}

// 一辆车：车型、俯视的车身、座位按钮、后备箱装了多少
export default function CarCard({ car, index, me, actingFor, bags, busy, canRemove, onSeat, onLabel, onModel, onRemove }) {
  const rows = car.rows;
  const ids = seatIds(rows);
  const total = seatCount(rows);
  const { H, out: SPOT } = spots(rows);
  const trunk = trunkOf(car);
  const load = carLoad(car, bags);
  const pct = Math.round((load.liters / trunk) * 100);
  const filled = Object.values(car.seats).filter(Boolean).length;
  const tone = pct > 100 ? 'over' : pct > 80 ? 'tight' : 'ok';
  const skis = load.counts.skis || 0;
  // 最后一排是三个座、中间有人时，雪具包没法从中间穿过去
  const last = rows[rows.length - 1], lastMiddle = last === 3 ? ids[ids.length - 2] : null;
  const skiBlocked = skis > 0 && lastMiddle && car.seats[lastMiddle];
  const [editing, setEditing] = useState(null); // 改车名时的草稿（谁登录了都能改）
  const saveLabel = () => { onLabel(car, editing.trim()); setEditing(null); };
  return (
    <article className="car-card glass-card rounded-3xl p-5 flex flex-col">
      <header className="flex items-baseline gap-2 mb-1">
        {editing == null
          ? <h3 className="text-lg font-bold tracking-tight">{carName(car, index)}</h3>
          : <input autoFocus value={editing} onChange={e => setEditing(e.target.value)} onBlur={saveLabel}
              onKeyDown={e => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') setEditing(null); }}
              placeholder={carName({ ...car, label: '' }, index)} maxLength={40} aria-label="车名" className="text-lg font-bold border-b border-indigo-300 bg-transparent outline-none min-w-0 flex-1" />}
        {me && editing == null && <button onClick={() => setEditing(car.label || '')} className="text-xs text-slate-400 hover:text-indigo-600">改名</button>}
        <span className="ml-auto text-sm text-slate-500 tabular-nums">{filled} / {total}</span>
      </header>
      <p className="text-xs text-slate-400 mb-3 flex flex-wrap items-baseline gap-x-2">
        <span>{modelName(car)} · {total} 座{rows.length > 2 ? '（' + rowsText(rows) + '）' : ''} · 或同级车型</span>
        {me && <button onClick={() => onModel(car)} className="font-semibold text-indigo-500 hover:text-indigo-700">换车型</button>}
        {me && canRemove && <button onClick={() => onRemove(car)} className="text-slate-400 hover:text-rose-600">去掉这辆</button>}
      </p>

      <div className={'car-top' + (rows.some(n => n >= 4) ? ' dense' : '')} style={{ aspectRatio: '200 / ' + H }}>
        <svg viewBox={'0 0 200 ' + H} className="car-body" aria-hidden="true">
          <defs>
            <linearGradient id={'paint' + car.id} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#e7ebf3" /><stop offset=".5" stopColor="#ffffff" /><stop offset="1" stopColor="#e7ebf3" />
            </linearGradient>
          </defs>
          <path d={`M100 6C142 6 166 18 170 52L174 110V${H - 60}C174 ${H - 24} 156 ${H - 8} 100 ${H - 6}C44 ${H - 8} 26 ${H - 24} 26 ${H - 60}V110L30 52C34 18 58 6 100 6Z`} fill={'url(#paint' + car.id + ')'} stroke="#cdd5e3" strokeWidth="2" />
          <path d="M44 104C70 92 130 92 156 104L150 128C120 120 80 120 50 128Z" fill="#c9d3e6" />
          <path d={`M52 ${H - 70}C80 ${H - 62} 120 ${H - 62} 148 ${H - 70}L154 ${H - 48}C120 ${H - 38} 80 ${H - 38} 46 ${H - 48}Z`} fill="#c9d3e6" />
          <path d="M26 118 14 122M174 118 186 122" stroke="#cdd5e3" strokeWidth="5" strokeLinecap="round" />
          <path d="M68 22h64" stroke="#d8dfeb" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {ids.map(id => {
          const who = car.seats[id];
          const mine = !!who && who === actingFor;
          const label = who ? (mine ? (actingFor === me ? '你' : who) : who) : seatShort(id, car);
          return (
            <button key={id} style={SPOT[id]} disabled={busy}
              className={'seat' + (who ? ' taken' : '') + (mine ? ' mine' : '') + (id === 'driver' ? ' driver' : '')}
              onClick={() => onSeat(car, id, who)}
              title={(id === 'driver' ? '主驾（司机）' : seatName(id, car)) + (who ? ' · ' + who : ' · 空着，点一下坐这里')}
              aria-label={carName(car, index) + ' ' + seatName(id, car) + (who ? '，' + who : '，空位')}>
              <span className="seat-dot">{who ? initials(who) : id === 'driver' ? <Wheel /> : '+'}</span>
              <span className="seat-name">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm mb-1.5">
          <span className="font-medium text-slate-600">后备箱 <span className="text-xs font-normal text-slate-400">约 {trunk} 升</span></span>
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
        {(pct > 100 || skiBlocked) && (
          <p className="text-xs text-amber-700 mt-2">
            {pct > 100 ? '行李可能装不下，考虑挪几件到别的车。' : ''}
            {skiBlocked ? (rows.length === 2 ? '后排' : '最后一排') + '中间有人时雪具包没法从中间穿过去，得放车顶。' : ''}
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
