// 谁答了题（✓）、谁还没答（…）；抽过签之后才来、还不在圈里的标「未进圈」。谁都可以把不参加的人排除掉（或者加回来），点之前会确认。
export default function People({ people, drawn, onExclude }) {
  const inPeople = people.filter(p => !p.excluded);
  const done = inPeople.filter(p => p.submitted).length;
  return (
    <section className="glass-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold text-lg">👼 大家的进度</h2>
        <span className="text-sm font-bold text-indigo-600">{done} / {inPeople.length}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-4">
        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-pink-500 transition-all duration-500" style={{ width: (inPeople.length ? done / inPeople.length * 100 : 0) + '%' }} />
      </div>
      <div className="flex flex-wrap gap-2">
        {people.map(p => (
          <span key={p.name} className={'inline-flex items-center gap-1.5 rounded-full pl-1 pr-3 py-1 text-sm ' + (p.excluded ? 'bg-slate-100 text-slate-400 line-through' : p.submitted ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
            <span className="avatar w-6 h-6 text-[11px]">{Array.from(p.name)[0].toUpperCase()}</span>
            {p.name} {p.excluded ? '' : p.submitted ? '✓' : '…'}{!p.excluded && drawn && !p.inDraw && <span className="text-xs opacity-70">未进圈</span>}
            {onExclude && (
              <button onClick={() => onExclude(p.name, !p.excluded)} title={p.excluded ? '加回来' : '不参加'}
                className="ml-1 text-xs text-slate-400 hover:text-rose-600 no-underline">{p.excluded ? '↺' : '✕'}</button>
            )}
          </span>
        ))}
      </div>
    </section>
  );
}
