import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useSession } from '../../session/SessionContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import { answersError, cleanAnswers } from './questions.js';
import Questions from './Questions.jsx';
import People from './People.jsx';
import RevealCard from './RevealCard.jsx';
import './angel.css';

// Secret Angel：大家可能互相不熟，所以每人从十道题里挑五道答（「不能送的」必答，questions.js），
// 天使拿着答案挑礼物；然后谁都可以抽签（没有管理员，大家一样；抽签、重抽、排除谁都会记下是谁做的），
// 每个人只看得到自己要送给谁。不用等人齐：谁交了谁进池，没交的人这轮不参加；重抽按当前已交的人重新
// 分配，不清任何人的答案。（以前是选礼物分类；那时交过的人照样在池子里，答了题天使就能看到。）
export default function AngelView({ active }) {
  const { name, token, users, openLogin } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');

  const apply = useCallback(r => {
    if (!r.ok) { setMsg(r.error || '出错了'); return false; }
    setData(r); setMsg('');
    return true;
  }, []);
  const load = useCallback(async () => {
    try { apply(await api('/api/angel?name=' + encodeURIComponent(name) + '&token=' + encodeURIComponent(token))); } catch (e) {}
  }, [name, token, apply]);
  useEffect(() => { if (active) load(); }, [active, load, users.length]);

  // 服务器上的答案载入表单（以前选礼物分类的人这里是空的）
  const mine = data?.mine;
  const answered = !!mine?.answers;
  useEffect(() => {
    if (!data || dirty) return;
    setAnswers(mine?.answers || {});
  }, [data, mine, dirty]);

  const post = async (path, body) => {
    try { return apply(await api(path, 'POST', { name, token, ...body })); } catch (e) { setMsg('网络有点问题，稍后再试'); return false; }
  };
  async function submit() {
    if (await post('/api/angel/prefs', { answers: cleanAnswers(answers) })) { setDirty(false); toast(answered ? '答案更新好了 ✨' : '答好了，等抽签吧 😇'); }
  }
  async function draw() {
    const ok = data.drawn
      ? await confirm({ title: '重新抽签？', message: '已经抽过了。重新抽的话大家的结果都会变（答案不会清掉，只是按现在已交的人重新分配），会记下是你重抽的。确定吗？', confirmText: '重新抽' })
      : await confirm({ title: '开始抽签？', message: '按现在已经交了答案的人分配，每个人马上就能看到自己要送给谁。会记下是你抽的。', confirmText: '抽签' });
    if (!ok) return;
    if (await post('/api/angel/draw', {})) toast('🎲 抽好了！大家去拆信封吧');
  }
  // 排除 / 加回来：谁都可以，先确认一下
  async function exclude(target, excluded) {
    if (!await confirm({ title: excluded ? '排除 ' + target + '？' : '把 ' + target + ' 加回来？', message: excluded ? 'TA 不参加这次 Secret Angel（比如来不了）。已经抽过的话，TA 的位置会从圈里拿掉，其他人不受影响。会记下是你排除的。' : 'TA 重新参加；要进抽签结果，得有人重新 Shuffle 一次。', confirmText: excluded ? '排除' : '加回来' })) return;
    post('/api/angel/exclude', { target, excluded });
  }

  if (!name) return (
    <section className="glass-card rounded-2xl p-8 text-center">
      <div className="text-5xl mb-3">😇</div>
      <p className="text-slate-600 mb-4">先登录，才知道你是谁的天使</p>
      <button onClick={() => openLogin()} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-6 py-2">登录</button>
    </section>
  );
  if (!data) return <p className="text-slate-400 text-center py-10">加载中…</p>;

  const people = data.people.filter(p => !p.excluded);
  // 抽签池：交过的人（以前选礼物分类的也算）；没交过的这轮不参加
  const waiting = people.filter(p => !p.inPool);
  const filled = people.filter(p => p.inPool);
  const wrong = answersError(answers);
  const count = Object.keys(cleanAnswers(answers)).length;
  return (
    <div className="space-y-5">
      {data.drawn && (data.master
        ? <RevealCard master={data.master} drawnAt={data.drawnAt} me={name} />
        : <section className="glass-card rounded-2xl p-5 text-sm text-slate-600">已经抽过签了，但这次没有你（你是抽签之后才加入的）。答好题之后，谁都可以在下面点「重新 Shuffle」把你加进来。</section>)}

      <section className="glass-card rounded-2xl p-5">
        <div className="mb-4">
          <h2 className="font-bold text-lg">🎁 让天使认识你</h2>
          <p className="text-sm text-slate-500">十道题挑五道答，每道一句话就行；「不能送的」必答。抽到你的天使会看到这些答案{answered ? '，随时可以改' : ''}。</p>
          {mine && !answered && <p className="angel-notice">礼物分类改成了问答：答好五道，你的天使才看得到你想要什么。</p>}
        </div>
        <Questions answers={answers} onChange={a => { setDirty(true); setAnswers(a); }} />
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button onClick={submit} disabled={!!wrong || (answered && !dirty)} className="bg-gradient-to-r from-indigo-600 to-pink-500 disabled:opacity-40 text-white font-bold rounded-xl px-6 py-2 shadow">
            {answered ? (dirty ? '保存修改' : '已保存 ✓') : '交答案 😇'}
          </button>
          <span className="text-sm text-slate-500">{wrong || '已答 ' + count + ' 道 ✓'}</span>
          <span className="text-sm text-rose-600">{msg}</span>
        </div>
      </section>

      <People people={data.people} onExclude={exclude} />

      <section className="rounded-2xl shadow p-5 text-white bg-gradient-to-br from-indigo-700 via-purple-700 to-pink-600">
        <h2 className="font-bold text-lg mb-1">🎲 抽签</h2>
        <p className="text-sm text-indigo-100 mb-4">
          {filled.length < 2 ? '现在只有 ' + filled.length + ' 人交了答案，至少要 2 个人才能抽。'
            : data.drawn ? '已经抽过了（' + (data.drawnBy ? data.drawnBy + ' 抽的，' : '') + new Date(data.drawnAt).toLocaleString('zh-CN') + '）。重新抽签按现在已交的人重新分配，谁的答案都不会清掉' + (waiting.length ? '；还没交的：' + waiting.map(p => p.name).join('、') + '，交了再重抽就能进来' : '') + '。结果连你也看不到别人的。'
            : waiting.length ? '已交 ' + filled.length + '/' + people.length + ' 人，可以先抽！还没交的（' + waiting.map(p => p.name).join('、') + '）这轮不参加，交了再重抽就能进来；不参加的人也可以在上面点 ✕ 排除。'
            : '大家都交了，可以抽了！每个人会被分到一个要偷偷送礼物的人，不会抽到自己，也不会两个人互送。'}
        </p>
        <button onClick={draw} disabled={filled.length < 2}
          className="bg-white text-indigo-700 font-black rounded-xl px-6 py-2 shadow-lg disabled:opacity-40">{data.drawn ? '🎲 重新 Shuffle（保留答案）' : '🎲 开始抽签'}</button>
        <p className="text-xs text-indigo-100/90 mt-2">谁都可以点，点之前会再确认一次；下面记着是谁做的。</p>
        {data.log?.length > 0 && (
          <ul className="mt-3 pt-3 border-t border-white/25 space-y-0.5 text-xs text-indigo-100">
            {data.log.slice().reverse().map(l => <li key={l.at + l.what}>{new Date(l.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · <b className="text-white">{l.by}</b> {l.what}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
