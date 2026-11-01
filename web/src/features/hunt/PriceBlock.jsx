import { useState } from 'react';
import { ago } from '../../lib/format.js';
import { hotelTotal, liveOf, rateForTrip, roomsFor, UNAVAILABLE } from './price.js';
import { perPerson } from './deadline.js';

// 酒店的价格：每间每晚（Google 按行程日期查的均价，或有人手填的），加上按间数（两人一间）和晚数算的整趟总价。
// 之前加的酒店存的是 Google 自己挑的某一晚，后端补查到行程日期的价格之前照旧标出来。
function HotelPrice({ l, T, closed, onSetRate }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const r = l.rate;
  const total = hotelTotal(l, T);
  async function save() {
    if (await onSetRate(l, val.trim())) setEditing(false);
  }
  const edit = !closed && onSetRate && (editing
    ? <span className="inline-flex items-center gap-1 mt-1">
        <span className="text-sm text-slate-500">$</span>
        <input autoFocus type="number" min="1" value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()}
          placeholder="每间每晚" className="w-24 border rounded-lg px-2 py-0.5 text-sm" aria-label="每间每晚的价格（美元）" />
        <button onClick={save} className="text-xs font-bold text-indigo-600 px-1">保存</button>
        <button onClick={() => setEditing(false)} className="text-xs text-slate-400 px-1">取消</button>
      </span>
    : <button onClick={() => { setVal(r ? String(r.nightly) : ''); setEditing(true); }} className="text-xs text-indigo-600 hover:underline mt-0.5">✏️ {r ? '改价格' : '填价格'}</button>);
  if (r && r.nightly) {
    const pp = perPerson(total, T);
    return (
      <>
        <div className="text-lg font-bold text-slate-800">${r.nightly.toLocaleString()} <span className="text-xs font-normal text-slate-500">/ 间 / 晚</span></div>
        <div className="text-sm font-bold text-indigo-700 mt-0.5">
          {roomsFor(T)} 间 × {T.nights} 晚 ≈ ${total.toLocaleString()} · 每人约 ${pp.each.toLocaleString()}
          <span className="font-normal text-xs text-slate-500">（{T.people} 人，两人一间）</span>
        </div>
        <div className={'text-xs mt-0.5 ' + (r.source === 'google' && !rateForTrip(r, T) ? 'text-amber-700' : 'text-sky-700')}>
          {r.source !== 'google' ? `🏨 ${r.by ? r.by + ' ' : ''}手填的价格 · ${ago(r.at)}`
            : rateForTrip(r, T) ? (r.provider
              ? `✓ Google 最低含税价 · ${r.provider}（共 ${r.offers} 家报价）· ${r.dates} · ${ago(r.at)}`
              : `✓ Google 价 · ${r.dates} 每晚均价（不含税）· ${ago(r.at)}`)
              : `⚠️ Google 参考价是 ${r.dates} 那晚的，不是行程日期（行程日期的价还没查到）`}
        </div>
        {edit}
      </>
    );
  }
  // 之前从 Booking.com 拉过价格的酒店：存的是整趟总价
  if (l.priceUSD && l.priceNights) {
    const pp = perPerson(l.priceUSD, T);
    return (
      <>
        <div className="text-lg font-bold text-slate-800">${Number(l.priceUSD).toLocaleString()} <span className="text-xs font-normal text-slate-500">/ {l.priceNights}晚总价</span></div>
        <div className="text-sm font-bold text-indigo-700 mt-0.5">每人约 ${pp.each.toLocaleString()} <span className="font-normal text-xs text-slate-500">（{T.people} 人分）</span></div>
        <div className="text-xs text-sky-700 mt-0.5">🏨 之前从 Booking.com 拉的价格{l.priceAt ? ' · ' + ago(l.priceAt) : ''}</div>
        {edit}
      </>
    );
  }
  return <><div className="text-sm text-slate-500">🏨 还没有价格（Google 上没查到）</div>{edit}</>;
}

export default function PriceBlock({ l, T, closed, chosen, onSetRate }) {
  if (l.kind === 'hotel') return <HotelPrice l={l} T={T} closed={closed} onSetRate={onSetRate} />;
  const v = liveOf(l, T);
  // 我们选定的那间被订走了，多半就是我们自己订的
  if (v && !v.available && chosen && v.reason === 'DATE') return (
    <div className="inline-flex items-center gap-1 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">🏠 这几天我们订下了</div>
  );
  if (v && !v.available) return (
    <>
      <div className="inline-flex items-center gap-1 text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1">❌ {UNAVAILABLE[v.reason] || '这几天订不了'}</div>
      <div className="text-xs text-slate-400 mt-1">Airbnb 实时查询 · {ago(v.at)}</div>
    </>
  );
  if (v && v.total) return (
    <>
      <div className="text-lg font-bold text-slate-800">
        ${v.total.toLocaleString()}
        {v.original > v.total && <> <s className="text-sm font-normal text-slate-400">${v.original.toLocaleString()}</s></>}
        {' '}<span className="text-xs font-normal text-slate-500">/ {v.nights}晚总价</span>
      </div>
      {(() => { const pp = perPerson(v.total, T); return <div className="text-sm font-bold text-indigo-700 mt-0.5">每人约 ${pp.each.toLocaleString()} <span className="font-normal text-xs text-slate-500">（{T.people} 人分 · 每人每晚 ${pp.perNight}）</span></div>; })()}
      <div className="text-xs text-emerald-700 mt-0.5">✓ Airbnb 实时价{v.guests < T.people ? ' · 按 ' + v.guests + ' 人计' : ''} · {ago(v.at)}</div>
    </>
  );
  // 还没查到实时价：手动添加时填过价格的先显示那个
  if (l.priceUSD && l.priceNights) return (
    <>
      <div className="text-lg font-bold text-slate-500">约 ${Number(l.priceUSD).toLocaleString()} <span className="text-xs font-normal">/ {l.priceNights}晚</span></div>
      <div className="text-xs text-slate-400 mt-0.5">手动填的价格 · 实时价查询中…</div>
    </>
  );
  return <div className="text-sm text-slate-500">实时价查询中…</div>;
}
