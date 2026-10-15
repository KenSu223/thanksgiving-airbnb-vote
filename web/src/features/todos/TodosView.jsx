import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useSession } from '../../session/SessionContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import TodoForm from './TodoForm.jsx';
import TodoItem from './TodoItem.jsx';
import { PHASES, todayStr } from './phases.js';
import './todos.css';

const POLL_MS = 8000; // 别人刚认领、刚打勾的能很快看到
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
// 排序：没做完的在前；有截止日期的按日期，越早越前；再按添加时间新的在前
const order = (a, b) => (a.done - b.done) || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0) || (b.at - a.at);

// ✅ 待办：出发前 / 旅途中 / 回来后，谁都能加、能指派、能自己认领
export default function TodosView({ active }) {
  const { name, users, ensureName } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const isAdmin = String(name).toLowerCase() === 'aster';
  const people = users.map(u => u.name);

  const load = useCallback(async () => {
    try { const r = await api('/api/todos'); if (r.ok) setItems(r.items); } catch (e) {}
  }, []);
  useEffect(() => {
    if (!active) return;
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [active, load]);

  // 所有改动走这里：没登录先登录；opts.confirm 是要删的标题（先确认）
  function act(path, payload, opts = {}) {
    return new Promise(resolve => {
      ensureName(async me => {
        if (opts.confirm && !await confirm({ title: '删掉这条待办？', message: '「' + opts.confirm + '」删掉后大家都看不到了。', confirmText: '删除', danger: true })) return resolve(false);
        setBusy(true);
        try {
          const r = await api(path, 'POST', { name: me.name, token: me.token, ...payload });
          if (r.items) setItems(r.items);
          if (!r.ok) toast(r.error || '没成功，再试一次');
          resolve(!!r.ok);
        } catch (e) { toast('网络不太好，再试一次'); resolve(false); }
        finally { setBusy(false); }
      });
    });
  }

  const today = todayStr();
  const counts = useMemo(() => {
    const list = items || [];
    return {
      all: list.filter(t => !t.done).length,
      mine: list.filter(t => !t.done && t.assignees.some(n => same(n, name))).length,
      open: list.filter(t => !t.done && !t.assignees.length).length,
      done: list.filter(t => t.done).length,
    };
  }, [items, name]);
  const shown = (items || []).filter(t => filter === 'all' ? true
    : filter === 'mine' ? t.assignees.some(n => same(n, name))
      : filter === 'open' ? !t.done && !t.assignees.length
        : t.done).sort(order);

  const FILTERS = [['all', '全部', counts.all], ['mine', '我的', counts.mine], ['open', '没人认领', counts.open], ['done', '做完了', counts.done]];
  return (
    <div className="space-y-5">
      <TodoForm people={people} me={name} busy={busy} onSubmit={f => act('/api/todos', f).then(ok => { if (ok) toast('加好了'); return ok; })} />

      <nav className="td-filters" aria-label="筛选">
        {FILTERS.map(([k, label, n]) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={filter === k ? 'on' : ''}>
            {label}<span>{n}</span>
          </button>
        ))}
      </nav>

      {items == null ? <p className="text-slate-400 px-1">加载中…</p>
        : !shown.length ? <p className="td-empty">{filter === 'mine' ? (name ? '你手上没有待办 · 去「没人认领」里挑一个？' : '登录后能看到指派给你的') : filter === 'open' ? '每一条都有人认领了 🎉' : filter === 'done' ? '还没有做完的' : '还没有待办，上面加第一条吧'}</p>
          : PHASES.map(p => {
            const list = shown.filter(t => t.phase === p.id);
            if (!list.length) return null;
            return (
              <section key={p.id}>
                <h2 className="td-phase">{p.name}<span className="td-phase-n">{list.filter(t => !t.done).length || ''}</span><span className="td-phase-hint">{p.hint}</span></h2>
                <ul className="td-list glass-card rounded-2xl">
                  {list.map(t => <TodoItem key={t.id + (t.at || '')} t={t} me={name} isAdmin={isAdmin} people={people} today={today} busy={busy} act={act} />)}
                </ul>
              </section>
            );
          })}
    </div>
  );
}
