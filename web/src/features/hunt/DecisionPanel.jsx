import { useState } from 'react';
import { api } from '../../lib/api.js';
import { statsLine } from '../../lib/format.js';
import { useSession } from '../../session/SessionContext.jsx';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import { deadlineText, perPerson } from './deadline.js';
import { liveOf } from './price.js';

const airbnbLink = (l, T) => 'https://www.airbnb.com/rooms/' + l.roomId + '?adults=' + T.people + '&check_in=' + T.checkIn + '&check_out=' + T.checkOut;

// 投票截止之后：大家选定的房子、后面几名、谁去订、订好了没有。
// 截止后谁都可以改选（会写明是谁改的）；订房只有负责的那个人能标记、取消
export default function DecisionPanel({ trip, T, vote, listings, onVote }) {
  const { name, ensureName } = useSession();
  const confirm = useConfirm();
  const [form, setForm] = useState({ confirmation: '', total: '' });
  const [msg, setMsg] = useState('');
  const byId = new Map(listings.map(l => [l.id, l]));
  const pick = byId.get(vote.chosenId);
  const b = vote.booking;
  const mine = b && String(b.by).toLowerCase() === String(name).toLowerCase();

  const post = (path, body) => ensureName(async me => {
    setMsg('');
    const r = await api(path, 'POST', { trip, name: me.name, token: me.token, ...body });
    if (r.ok) onVote(r.vote); else setMsg(r.error || '没成功');
  });

  if (!pick) return (
    <section className="glass-card rounded-2xl p-5 mb-5">
      <h2 className="font-black text-lg">🔒 投票已截止（{deadlineText(vote.voteEndsAt)}）</h2>
      <p className="text-sm text-slate-500 mt-1">没有能订的房子拿到票。可以在下面的卡片上点「改选这间」直接定一间（谁都可以，会写明是谁定的）。</p>
    </section>
  );

  const v = liveOf(pick, T);
  const total = (v && v.available && v.total) || (b && b.totalUSD) || null;
  const pp = perPerson(b && b.totalUSD ? b.totalUSD : total, T);
  const pic = (pick.images && pick.images[0]) || pick.image;
  const runnersUp = vote.ranking.filter(id => id !== pick.id).map(id => byId.get(id)).filter(Boolean).slice(0, 3);

  return (
    <section className="glass-card rounded-2xl mb-5 overflow-hidden">
      <div className="bg-gradient-to-r from-amber-400 to-orange-500 text-white px-5 py-3 flex flex-wrap items-center gap-2">
        <span className="text-lg font-black">🏆 {T.date} 我们住这间</span>
        <span className="text-xs opacity-90">投票已于 {deadlineText(vote.voteEndsAt)} 截止{vote.override ? ' · ' + vote.override.by + ' 改选的' : ' · 票数最高'}</span>
        {vote.override && <button onClick={async () => { if (await confirm({ title: '改回投票结果？', message: '不用 ' + vote.override.by + ' 改选的这间，改回票数最高的那间？', confirmText: '改回去' })) post('/api/decision', { listingId: null }); }} className="ml-auto text-xs underline">改回投票结果</button>}
      </div>
      <div className="grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {pic ? <img src={pic} alt="" className="w-full h-full object-cover aspect-[16/10] md:aspect-auto" /> : <div className="bg-slate-100 aspect-[16/10]" />}
        <div className="p-5">
          <h3 className="font-black text-xl leading-snug">{pick.title}</h3>
          <p className="text-sm text-slate-500 mt-1">{statsLine(pick)}{pick.area ? ' · ' + pick.area : ''}</p>
          <p className="text-sm mt-2">❤️ {pick.votes.length} 票：{pick.votes.map(x => x.name).join('、')}</p>
          {total && <p className="mt-2"><b className="text-2xl">${total.toLocaleString()}</b> <span className="text-sm text-slate-500">/ {T.nights} 晚总价{pp ? ' · 每人约 $' + pp.each.toLocaleString() + '（每晚 $' + pp.perNight + '）' : ''}</span></p>}
          <a href={airbnbLink(pick, T)} target="_blank" rel="noopener" className="inline-block mt-3 text-sm font-bold text-indigo-600 underline">在 Airbnb 打开（{T.date} · {T.people} 人）↗</a>

          {/* 订房：认领 → 订好 */}
          <div className="mt-4 rounded-xl border-2 border-dashed border-slate-200 p-3 text-sm">
            {!b && <div className="flex flex-wrap items-center gap-2"><span>📋 还没人负责订</span>
              <button onClick={() => post('/api/booking', { action: 'claim' })} className="btn-primary font-bold rounded-lg px-3 py-1">我来订</button></div>}
            {b && b.status === 'claimed' && (
              <div>
                <div className="flex flex-wrap items-center gap-2">📋 <b>{b.by}</b> 负责订
                  {mine && <button onClick={() => post('/api/booking', { action: 'release' })} className="text-xs text-slate-400 underline">不订了</button>}</div>
                {mine && (
                  <form className="flex flex-wrap gap-2 mt-2" onSubmit={e => { e.preventDefault(); post('/api/booking', { action: 'booked', confirmation: form.confirmation, totalUSD: form.total }); }}>
                    <input value={form.confirmation} onChange={e => setForm({ ...form, confirmation: e.target.value })} placeholder="确认号（可选）" className="border rounded-lg px-2 py-1 w-36" maxLength={40} />
                    <input value={form.total} onChange={e => setForm({ ...form, total: e.target.value })} type="number" placeholder="实付总价 USD" className="border rounded-lg px-2 py-1 w-36" />
                    <button className="bg-emerald-600 text-white font-bold rounded-lg px-3 py-1">✅ 订好了</button>
                  </form>
                )}
              </div>
            )}
            {b && b.status === 'booked' && (
              <div className="text-emerald-700">✅ <b>{b.by}</b> 已经订好了{b.confirmation ? ' · 确认号 ' + b.confirmation : ''}{b.totalUSD ? ' · 实付 $' + b.totalUSD.toLocaleString() : ''}
                {mine && <button onClick={() => post('/api/booking', { action: 'release' })} className="ml-2 text-xs text-slate-400 underline">撤销</button>}</div>
            )}
            {msg && <p className="text-rose-600 mt-1">{msg}</p>}
          </div>
        </div>
      </div>
      {runnersUp.length > 0 && (
        <div className="px-5 py-3 border-t text-sm text-slate-600">
          备选（万一订不到）：{runnersUp.map((l, i) => <span key={l.id}>{i ? '、' : ''}{l.title}（{l.votes.length} 票）</span>)}
        </div>
      )}
    </section>
  );
}
