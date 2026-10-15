import { useState } from 'react';
import { PHASES } from './phases.js';
import PeoplePicker from './PeoplePicker.jsx';

// 加一条 / 改一条：要做什么、哪个阶段、哪天之前、备注、指派给谁（改的时候不在这里指派，卡片上有单独的「指派」）
export default function TodoForm({ initial, people, me, busy, onSubmit, onCancel, phase }) {
  const editing = !!initial;
  const [f, setF] = useState(() => initial
    ? { title: initial.title, note: initial.note, phase: initial.phase, due: initial.due }
    : { title: '', note: '', phase: phase || 'pre', due: '' });
  const [who, setWho] = useState([]);
  const [more, setMore] = useState(editing && !!(initial.note || initial.due));
  const set = k => e => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    if (!f.title.trim()) return;
    const ok = await onSubmit(editing ? f : { ...f, assignees: who });
    if (ok && !editing) { setF({ title: '', note: '', phase: f.phase, due: '' }); setWho([]); setMore(false); }
  }
  return (
    <form onSubmit={submit} className={editing ? 'space-y-3' : 'glass-card rounded-2xl p-4 space-y-3'}>
      <div className="flex gap-2">
        <input value={f.title} onChange={set('title')} maxLength={120} autoFocus={editing}
          placeholder={editing ? '' : '要做什么？比如：买 Costco 早餐、订雪具、带充电宝…'} aria-label="要做什么"
          className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white/80 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        <button disabled={busy || !f.title.trim()} className="td-primary">{editing ? '保存' : '添加'}</button>
        {editing && <button type="button" onClick={onCancel} className="text-sm text-slate-500 px-2">取消</button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="td-seg" role="group" aria-label="阶段">
          {PHASES.map(p => (
            <button key={p.id} type="button" onClick={() => setF({ ...f, phase: p.id })} aria-pressed={f.phase === p.id} className={f.phase === p.id ? 'on' : ''}>{p.name}</button>
          ))}
        </div>
        {!more && <button type="button" onClick={() => setMore(true)} className="text-sm text-indigo-600 hover:underline">+ 截止日期 / 备注</button>}
      </div>
      {more && (
        <div className="flex flex-wrap gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-500">哪天之前
            <input type="date" value={f.due} onChange={set('due')} className="rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-slate-700" />
          </label>
          <input value={f.note} onChange={set('note')} maxLength={500} placeholder="备注（链接、数量、注意事项…）" aria-label="备注"
            className="flex-1 min-w-[12rem] rounded-lg border border-slate-200 bg-white/80 px-3 py-1.5 text-sm" />
        </div>
      )}
      {!editing && (
        <div>
          <div className="text-xs text-slate-500 mb-1.5">指派给谁（可以不选，等大家自己认领）</div>
          <PeoplePicker people={people} value={who} onChange={setWho} me={me} />
        </div>
      )}
    </form>
  );
}
