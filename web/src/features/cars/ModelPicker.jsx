import { useState } from 'react';
import { CLASSES, MODELS, TRUNKS, MIN_SEATS, MAX_SEATS, seatCount, rowsText, rowsForSeats, modelById, modelSearchText } from './models.js';
import { BAGS, LARGE_LITERS } from './bags.js';

const CARRYON_LITERS = BAGS.find(b => b.id === 'carryon').liters;
// 放得下几个箱子：放得下 28 寸大箱就按大箱算，跑车那种小后备箱按登机箱算；皮卡是车斗
function roomText(m) {
  const where = m.bed ? '车斗' : '后备箱';
  return m.liters >= LARGE_LITERS ? where + '能放约 ' + Math.round(m.liters / LARGE_LITERS) + ' 个 28 寸大箱'
    : where + '只放得下约 ' + Math.max(1, Math.round(m.liters / CARRYON_LITERS)) + ' 个登机箱';
}
// 每个级别里按品牌、车型名排
const byName = (a, b) => a.make.localeCompare(b.make) || a.name.localeCompare(b.name, undefined, { numeric: true });

// 挑车型：美国市场的车按级别分组（7 座 / 8 座两种排法都能挑），上面一排按级别筛，也能搜
// （中文品牌名也行），找不到就写「其他车型」。打开时先显示现在这辆车的级别。
// 选好了 onPick({ model, v }) 或 onPick({ model: 'custom', custom: { name, seats, trunk } })。
export default function ModelPicker({ title, current, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [cls, setCls] = useState(() => modelById(current?.model)?.cls || 'all');
  const [custom, setCustom] = useState(() => (current?.model === 'custom' && current.custom) || { name: '', seats: 7, trunk: 'M' });
  const s = q.trim().toLowerCase();
  const hit = m => !s || modelSearchText(m).includes(s);
  const isCur = (m, v) => current && current.model === m.id && (current.v || 0) === v;
  const found = MODELS.some(hit);
  return (
    <div className="login-fade fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-[3px]"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="login-pop glass-sheet flex max-h-[88vh] w-full max-w-lg flex-col rounded-[28px] px-5 py-5" role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xl font-extrabold">{title}</h3>
          <button onClick={onClose} aria-label="关闭" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/60 text-lg text-slate-500 transition hover:bg-white">✕</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">租车订的是级别，到店给的是「这款或同级车型」，挑最接近的就行。座位和后备箱会跟着变。</p>
        <input value={q} onChange={e => { setQ(e.target.value); if (e.target.value.trim()) setCls('all'); }} placeholder="搜车型或品牌，比如 Suburban、Corvette、丰田" aria-label="搜车型"
          className="mt-3 w-full rounded-xl border border-slate-300/70 bg-white/75 px-3.5 py-2.5 text-[15px] outline-none focus:border-indigo-400 focus:bg-white" />
        <div className="mp-chips" role="tablist" aria-label="级别">
          {[{ id: 'all', short: '全部' }, ...CLASSES].map(c => (
            <button key={c.id} role="tab" aria-selected={cls === c.id} className={'mp-chip' + (cls === c.id ? ' on' : '')} onClick={() => setCls(c.id)}>{c.short}</button>
          ))}
        </div>
        <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {CLASSES.filter(c => cls === 'all' || c.id === cls).map(c => {
            const list = MODELS.filter(m => m.cls === c.id && hit(m)).sort(byName);
            if (!list.length) return null;
            return (
              <section key={c.id}>
                <h4 className="mp-cls">{c.name}</h4>
                {list.map(m => (
                  <div key={m.id} className="mp-row">
                    <div className="min-w-0">
                      <div className="font-semibold">{m.make} {m.name}</div>
                      <div className="text-xs text-slate-500">{roomText(m)}</div>
                    </div>
                    <div className="mp-opts">
                      {[m.rows, m.alt].filter(Boolean).map((rows, v) => (
                        <button key={v} className={'mp-opt' + (isCur(m, v) ? ' on' : '')} onClick={() => onPick({ model: m.id, v })}
                          aria-label={m.make + ' ' + m.name + ' ' + seatCount(rows) + ' 座'}>
                          {seatCount(rows)} 座<small>{rowsText(rows)}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
          {!found && <p className="text-sm text-slate-500">没找到「{q.trim()}」，用下面的「其他车型」写上就行。</p>}
          {found && cls !== 'all' && !MODELS.some(m => m.cls === cls && hit(m)) && <p className="text-sm text-slate-500">这个级别里没有，点「全部」看看。</p>}
          <section>
            <h4 className="mp-cls">其他车型</h4>
            <div className="mp-custom">
              <input value={custom.name} maxLength={30} placeholder="车名，比如 Toyota Sequoia" aria-label="车名"
                onChange={e => setCustom(x => ({ ...x, name: e.target.value }))}
                className="w-full rounded-xl border border-slate-300/70 bg-white/80 px-3 py-2 text-[15px] outline-none focus:border-indigo-400" />
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <span className="text-slate-600">几个座</span>
                <div className="stepper">
                  <button onClick={() => setCustom(x => ({ ...x, seats: Math.max(MIN_SEATS, x.seats - 1) }))} disabled={custom.seats <= MIN_SEATS} aria-label="少一个座">−</button>
                  <span className="tabular-nums">{custom.seats}</span>
                  <button onClick={() => setCustom(x => ({ ...x, seats: Math.min(MAX_SEATS, x.seats + 1) }))} disabled={custom.seats >= MAX_SEATS} aria-label="多一个座">+</button>
                </div>
                <span className="text-xs text-slate-400">排法 {rowsText(rowsForSeats(custom.seats))}</span>
              </div>
              <div className="mt-2.5 text-sm text-slate-600">后备箱</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {TRUNKS.map(t => (
                  <button key={t.id} onClick={() => setCustom(x => ({ ...x, trunk: t.id }))}
                    className={'mp-opt' + (custom.trunk === t.id ? ' on' : '')}>{t.name}</button>
                ))}
              </div>
              <button disabled={!custom.name.trim()} onClick={() => onPick({ model: 'custom', custom: { ...custom, name: custom.name.trim() } })}
                className="btn-primary mt-3 w-full rounded-xl px-4 py-2.5 font-bold disabled:opacity-40">用这个</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
