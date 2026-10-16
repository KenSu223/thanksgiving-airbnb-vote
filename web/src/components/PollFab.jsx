import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../session/SessionContext.jsx';
import { useToast } from './Toast.jsx';
import { useConfirm } from './ConfirmDialog.jsx';
import { api } from '../lib/api.js';
import { load as loadKey, save as saveKey } from '../lib/storage.js';
import { useSeated } from '../lib/seated.js';

// 快速投票：独立于所有 tab 的悬浮球 + 投票中心（挂在 App 顶层）。
// 别人发起投票时，本机每 20 秒对一次列表，发现"没投过的新投票"就
// 弹出卡片；点选项即投票，卡片收回悬浮球。每支投票在这台设备上最多
// 弹一次（弹过的记在 localStorage pollSeen:名字，打开 app 不会再弹），
// 投过的、自己发起的不弹；没投的悬浮球上留红点，进中心随时能投。
// 已登录才显示；数据口径和后端 worker/polls 对齐（单选、可改票、
// 发起人可提前结束、到点自动结束）。
const DURATIONS = [
  { key: '10', label: '10 分钟', min: 10 },
  { key: '60', label: '1 小时', min: 60 },
  { key: 'manual', label: '手动结束', min: 0 },
];
const inputCls = 'w-full rounded-xl border border-slate-300/70 bg-white/75 px-3.5 py-2.5 text-[15px] outline-none transition focus:border-indigo-400 focus:bg-white placeholder:text-slate-400';

function statusLine(p) {
  if (p.status === 'closed') return '发起人已结束';
  if (p.status === 'ended') return '已结束';
  if (!p.endsAt) return '进行中 · 手动结束';
  const mins = Math.max(1, Math.ceil((p.endsAt - Date.now()) / 60000));
  return `进行中 · 还剩约 ${mins} 分钟`;
}

// 一个选项行：票数条 + 谁投了。进行中就是按钮（投了也能改），结束变纯展示。
function OptionRow({ poll, opt, busy, onVote }) {
  const pct = poll.total ? Math.round((opt.count / poll.total) * 100) : 0;
  const mine = poll.myVote === opt.id;
  const inner = (
    <>
      <span className="absolute inset-y-0 left-0 bg-indigo-400/25 transition-all duration-500" style={{ width: pct + '%' }} />
      <span className="relative flex items-center justify-between gap-2">
        <span className="font-bold">{opt.text}{mine && <span className="ml-1.5 text-indigo-600">✓ 我的票</span>}</span>
        <span className="shrink-0 text-sm font-bold text-slate-500">{opt.count} 票{poll.total ? ` · ${pct}%` : ''}</span>
      </span>
      {opt.voters.length > 0 && <span className="relative mt-0.5 block truncate text-xs text-slate-500">{opt.voters.join('、')}</span>}
    </>
  );
  const cls = 'relative block w-full overflow-hidden rounded-xl border px-4 py-3 text-left '
    + (mine ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-400 ' : 'border-slate-300/70 bg-white/60 ')
    + (poll.status === 'active' ? 'transition hover:border-indigo-400 active:scale-[.99]' : '');
  return poll.status === 'active'
    ? <button className={cls} disabled={busy} onClick={() => onVote(poll, opt.id)}>{inner}</button>
    : <div className={cls}>{inner}</div>;
}

function PollCard({ poll, busy, onVote, onClose, onDelete, myKey }) {
  return (
    <div className="glass-card rounded-3xl p-4">
      {poll.img && <img src={poll.img} alt="" className="mb-3 h-36 w-full rounded-2xl object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />}
      <div className="text-[17px] font-extrabold leading-snug">{poll.q}</div>
      <div className="mt-1 text-xs font-medium text-slate-500">{poll.by} 发起 · {statusLine(poll)}</div>
      <div className="mt-3 flex flex-col gap-2">
        {poll.options.map(o => <OptionRow key={o.id} poll={poll} opt={o} busy={busy} onVote={onVote} />)}
      </div>
      {poll.byKey === myKey && (
        <div className="mt-3 flex items-center gap-4">
          {poll.status === 'active' && (
            <button onClick={() => onClose(poll)} className="text-sm font-bold text-slate-500 transition hover:text-slate-700">结束这个投票</button>
          )}
          <button onClick={() => onDelete(poll)} className="text-sm font-bold text-rose-500 transition hover:text-rose-600">删除投票</button>
        </div>
      )}
    </div>
  );
}

export default function PollFab() {
  const { name, token } = useSession();
  // 坐在游戏桌上：球先收起来，新投票也等站起来再弹（不挡出牌的按钮、不打断这一手）
  const seated = useSeated();
  const toast = useToast();
  const confirm = useConfirm();
  const [polls, setPolls] = useState([]);
  const [centerOpen, setCenterOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [popupId, setPopupId] = useState(null);
  const myKey = name ? name.toLowerCase() : '';
  const seenKey = 'pollSeen:' + myKey;
  const readSeen = () => { try { return new Set(JSON.parse(loadKey(seenKey, '[]'))); } catch (e) { return new Set(); } };
  const [seen, setSeen] = useState(readSeen);
  const markSeen = ids => setSeen(s => {
    if (ids.every(id => s.has(id))) return s;
    const next = new Set([...s, ...ids]);
    saveKey(seenKey, JSON.stringify([...next].slice(-200)));
    return next;
  });
  const [busy, setBusy] = useState(false);
  // 选项默认预填"同意 / 不同意"（最常见的用法），发起人随时改成任何内容
  const [form, setForm] = useState({ q: '', img: '', options: ['同意', '不同意'], dur: '60' });

  const load = useCallback(async () => {
    if (!name) return;
    try {
      const r = await api(`/api/polls?name=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}`);
      if (r.ok) setPolls(r.polls);
    } catch (e) { /* 下个周期再试 */ }
  }, [name, token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!name) return undefined;
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [name, load]);
  // 换账号：提醒状态和打开的浮层都重置，别把上一个人的红点带过来
  useEffect(() => { setSeen(readSeen()); setPopupId(null); setCenterOpen(false); setCreating(false); }, [name]); // eslint-disable-line react-hooks/exhaustive-deps -- readSeen follows name
  useEffect(() => { if (centerOpen) load(); }, [centerOpen, load]);

  const active = polls.filter(p => p.status === 'active');
  const unvoted = active.filter(p => !p.myVote && p.byKey !== myKey);

  // 弹出：最新一支没投过、这台设备没弹过的投票，一次只弹一支；一弹就记下，
  // 之后刷新、重开 app 都不再弹。打开投票中心看过的也算弹过。
  useEffect(() => {
    if (popupId || creating || seated) return;
    if (centerOpen) { if (active.some(p => !seen.has(p.id))) markSeen(active.map(p => p.id)); return; }
    const cand = unvoted.find(p => !seen.has(p.id));
    if (cand) { setPopupId(cand.id); markSeen([cand.id]); }
  }, [unvoted, active, seen, popupId, centerOpen, creating, seated]); // eslint-disable-line react-hooks/exhaustive-deps -- markSeen is stable in effect
  const popup = popupId ? polls.find(p => p.id === popupId) : null;
  useEffect(() => {
    if (popup && (popup.status !== 'active' || popup.myVote)) setPopupId(null);
  }, [popup]);

  if (!name) return null;

  const vote = async (poll, optionId) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api('/api/polls/vote', 'POST', { name, token, pollId: poll.id, optionId });
      if (r.ok) { setPolls(r.polls); if (popupId === poll.id) setPopupId(null); toast('投好啦 🗳️'); }
      else toast(r.error || '没投上，再试试');
    } catch (e) { toast('网络有点问题，稍后再试'); }
    setBusy(false);
  };

  const closePoll = async poll => {
    const ok = await confirm({ title: '结束这个投票？', message: '结束后大家就不能再投了，结果会留在投票中心里。', confirmText: '结束投票', danger: true });
    if (!ok) return;
    try {
      const r = await api('/api/polls/close', 'POST', { name, token, pollId: poll.id });
      if (r.ok) { setPolls(r.polls); toast('投票结束了'); }
      else toast(r.error || '结束失败');
    } catch (e) { toast('网络有点问题，稍后再试'); }
  };

  const deletePoll = async poll => {
    const ok = await confirm({ title: '删除这个投票？', message: '「' + poll.q + '」和它的全部票数都会消失，删了就找不回来了。', confirmText: '删除', danger: true });
    if (!ok) return;
    try {
      const r = await api('/api/polls/delete', 'POST', { name, token, pollId: poll.id });
      if (r.ok) { setPolls(r.polls); toast('投票删掉了'); }
      else toast(r.error || '删除失败');
    } catch (e) { toast('网络有点问题，稍后再试'); }
  };

  const later = () => setPopupId(null);

  const submitCreate = async () => {
    const options = form.options.map(s => s.trim()).filter(Boolean);
    if (!form.q.trim()) return toast('先写个问题');
    if (options.length < 2) return toast('至少要两个选项');
    setBusy(true);
    try {
      const d = DURATIONS.find(x => x.key === form.dur) || DURATIONS[1];
      const r = await api('/api/polls', 'POST', { name, token, q: form.q.trim(), img: form.img.trim(), options, durationMin: d.min });
      if (r.ok) {
        setPolls(r.polls);
        setForm({ q: '', img: '', options: ['同意', '不同意'], dur: '60' });
        setCreating(false);
        toast('投票发起啦 📣');
      } else toast(r.error || '发起失败');
    } catch (e) { toast('网络有点问题，稍后再试'); }
    setBusy(false);
  };

  const setOpt = (i, v) => setForm(f => ({ ...f, options: f.options.map((o, j) => (j === i ? v : o)) }));

  return (
    <>
      {/* 悬浮球：手机在左下（避开底部导航和游戏桌的 😆），桌面在右下；坐在游戏桌上时收起来 */}
      {!seated && <button onClick={() => setCenterOpen(true)} aria-label="投票中心"
        className="glass-pill fixed bottom-[calc(6.25rem+env(safe-area-inset-bottom))] left-3 z-40 flex items-center gap-1.5 rounded-full py-2.5 pl-3.5 pr-4 font-bold shadow-[0_10px_28px_-8px_rgba(30,27,75,.45)] transition hover:scale-[1.04] active:scale-95 md:bottom-6 md:left-auto md:right-4">
        <span className="text-lg leading-none">🗳️</span> 投票
        {active.length > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-indigo-600 px-1 text-[11px] font-extrabold text-white">{active.length}</span>}
        {unvoted.length > 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-rose-500" />}
      </button>}

      {/* 投票中心 */}
      {centerOpen && (
        <div className="login-fade fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-[3px]"
          onClick={e => { if (e.target === e.currentTarget) { setCenterOpen(false); setCreating(false); } }}>
          <div className="login-pop glass-sheet flex max-h-[86vh] w-full max-w-md flex-col rounded-[28px] px-5 py-5" role="dialog" aria-modal="true" aria-label="投票中心">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-extrabold">🗳️ 投票中心</h3>
              <button onClick={() => { setCenterOpen(false); setCreating(false); }} aria-label="关闭" className="grid h-9 w-9 place-items-center rounded-full bg-white/60 text-lg text-slate-500 transition hover:bg-white">✕</button>
            </div>
            {creating ? (
              <div className="mt-4 overflow-y-auto pr-0.5">
                <label className="text-sm font-bold text-slate-600">问题</label>
                <input className={inputCls + ' mt-1'} placeholder="比如：周五晚上吃火锅还是烤肉？" value={form.q} maxLength={120}
                  onChange={e => setForm(f => ({ ...f, q: e.target.value }))} />
                <label className="mt-4 block text-sm font-bold text-slate-600">图片链接（可选）</label>
                <input className={inputCls + ' mt-1'} placeholder="https://…" value={form.img}
                  onChange={e => setForm(f => ({ ...f, img: e.target.value }))} />
                {/^https?:\/\//i.test(form.img.trim()) && (
                  <img src={form.img.trim()} alt="" className="mt-2 h-36 w-full rounded-2xl object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />
                )}
                <label className="mt-4 block text-sm font-bold text-slate-600">选项</label>
                <div className="mt-1.5 flex flex-col gap-2">
                  {form.options.map((o, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input className={inputCls} placeholder={`选项 ${i + 1}`} value={o} maxLength={60} onChange={e => setOpt(i, e.target.value)} />
                      {form.options.length > 2 && (
                        <button onClick={() => setForm(f => ({ ...f, options: f.options.filter((_, j) => j !== i) }))}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/60 text-slate-500 transition hover:bg-white" aria-label="删掉这个选项">✕</button>
                      )}
                    </div>
                  ))}
                </div>
                {form.options.length < 4 && (
                  <button onClick={() => setForm(f => ({ ...f, options: [...f.options, ''] }))} className="mt-2 text-sm font-bold text-indigo-600">+ 加一个选项</button>
                )}
                <label className="mt-4 block text-sm font-bold text-slate-600">截止</label>
                <div className="mt-1.5 flex gap-2">
                  {DURATIONS.map(d => (
                    <button key={d.key} onClick={() => setForm(f => ({ ...f, dur: d.key }))}
                      className={'rounded-full px-4 py-2 text-sm font-bold transition ' + (form.dur === d.key ? 'bg-indigo-600 text-white shadow' : 'bg-white/60 text-slate-600 hover:bg-white')}>
                      {d.label}
                    </button>
                  ))}
                </div>
                <button onClick={submitCreate} disabled={busy} className="btn-primary mt-5 w-full rounded-xl px-5 py-3 font-bold disabled:opacity-60">发起投票 📣</button>
                <button onClick={() => setCreating(false)} className="mt-2.5 w-full text-center text-sm font-medium text-slate-400 transition hover:text-slate-600">取消</button>
              </div>
            ) : (
              <>
                <button onClick={() => setCreating(true)} className="btn-primary mt-4 w-full shrink-0 rounded-xl px-5 py-3 font-bold">发起投票 📣</button>
                <div className="mt-4 flex flex-col gap-3 overflow-y-auto pr-0.5">
                  {polls.length === 0 && <p className="py-6 text-center text-sm text-slate-400">还没有人发起过投票，来发第一个吧</p>}
                  {polls.map(p => <PollCard key={p.id} poll={p} busy={busy} onVote={vote} onClose={closePoll} onDelete={deletePoll} myKey={myKey} />)}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 新投票弹出卡：投了就收回，或者"稍后再说"去中心里投 */}
      {popup && !centerOpen && !seated && (
        <div className="login-fade fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-[3px]"
          onClick={e => { if (e.target === e.currentTarget) later(); }}>
          <div className="login-pop glass-sheet w-full max-w-sm rounded-[28px] px-5 py-5" role="alertdialog" aria-modal="true" aria-label="新投票">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-indigo-600"><span className="text-lg">📣</span>{popup.by} 发起了投票</div>
            <PollCard poll={popup} busy={busy} onVote={vote} onClose={closePoll} onDelete={deletePoll} myKey={myKey} />
            <button onClick={later} className="mt-3 w-full text-center text-sm font-medium text-slate-400 transition hover:text-slate-600">稍后再说（在左下角投票球里找我）</button>
          </div>
        </div>
      )}
    </>
  );
}
