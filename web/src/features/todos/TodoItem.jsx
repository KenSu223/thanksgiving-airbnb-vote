import { useState } from 'react';
import PeoplePicker from './PeoplePicker.jsx';
import TodoForm from './TodoForm.jsx';
import TodoComments from './TodoComments.jsx';
import { dueLabel, overdue } from './phases.js';

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// 一条待办：圆圈打勾、标题、备注、截止日期、谁在做；「我来」/「不做了」；加的人可以指派、改、删；
// 💬 打开评论（谁都能评论、回复）
export default function TodoItem({ t, me, people, today, busy, act }) {
  const [mode, setMode] = useState(null); // 'assign' | 'edit'
  const [who, setWho] = useState(t.assignees);
  const [talk, setTalk] = useState(false);
  const talkN = (t.comments || []).filter(c => !c.deleted).length;
  const mine = !!me && t.assignees.some(n => same(n, me));
  const owner = !!me && same(t.by, me);
  const late = overdue(t, today);
  if (mode === 'edit') {
    return (
      <li className="td-item editing">
        <TodoForm initial={t} people={people} me={me} busy={busy} onCancel={() => setMode(null)}
          onSubmit={async f => { const ok = await act('/api/todos/edit', { id: t.id, ...f }); if (ok) setMode(null); return ok; }} />
      </li>
    );
  }
  return (
    <li className={'td-item' + (t.done ? ' done' : '') + (mine ? ' mine' : '')}>
      <button className="td-check" onClick={() => act('/api/todos/done', { id: t.id, done: !t.done })} disabled={busy}
        aria-label={t.done ? '标成没做完' : '标成做完了'} aria-pressed={t.done}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
      </button>
      <div className="min-w-0 flex-1">
        <div className="td-title">{t.title}</div>
        {t.note && <div className="td-note">{t.note}</div>}
        <div className="td-meta">
          {t.due && <span className={'td-due' + (late ? ' late' : '')}>{late ? '已过期 · ' : ''}{dueLabel(t.due)} 前</span>}
          {t.assignees.length
            ? t.assignees.map(n => <span key={n} className={'td-chip' + (same(n, me) ? ' me' : '')}>{same(n, me) ? '我' : n}</span>)
            : !t.done && <span className="td-open">没人认领</span>}
          <span className="td-by">{t.done ? '✓ ' + (t.doneBy || '有人') + ' 做完了' : t.by + ' 加的'}</span>
          <button className={'td-talk' + (talk ? ' on' : '') + (talkN ? ' has' : '')} onClick={() => setTalk(v => !v)} aria-expanded={talk}>💬 {talkN ? talkN + ' 条评论' : '评论'}</button>
        </div>
        {mode === 'assign' && (
          <div className="mt-3 space-y-2">
            <PeoplePicker people={people} value={who} onChange={setWho} me={me} />
            <div className="flex gap-2">
              <button className="td-primary small" disabled={busy} onClick={async () => { if (await act('/api/todos/assign', { id: t.id, assignees: who })) setMode(null); }}>确定</button>
              <button className="text-sm text-slate-500 px-2" onClick={() => { setWho(t.assignees); setMode(null); }}>取消</button>
            </div>
          </div>
        )}
      </div>
      {!t.done && mode !== 'assign' && (
        <div className="td-actions">
          {mine
            ? <button className="td-ghost" disabled={busy} onClick={() => act('/api/todos/claim', { id: t.id, claim: false })}>不做了</button>
            : <button className="td-claim" disabled={busy} onClick={() => act('/api/todos/claim', { id: t.id, claim: true })}>我来</button>}
          {owner && (
            <span className="td-owner">
              <button onClick={() => { setWho(t.assignees); setMode('assign'); }}>指派</button>
              <button onClick={() => setMode('edit')}>改</button>
              <button onClick={() => act('/api/todos/delete', { id: t.id }, { confirm: t.title })}>删</button>
            </span>
          )}
        </div>
      )}
      {t.done && owner && <div className="td-actions"><span className="td-owner"><button onClick={() => act('/api/todos/delete', { id: t.id }, { confirm: t.title })}>删</button></span></div>}
      {talk && <TodoComments t={t} me={me} busy={busy} act={act} />}
    </li>
  );
}
