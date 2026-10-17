import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useSession } from '../../session/SessionContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import { QUESTIONS, answersError, cleanAnswers } from './questions.js';
import QuestionPicker from './QuestionPicker.jsx';
import QuestionDeck from './QuestionDeck.jsx';
import AnswerCards from './AnswerCards.jsx';
import People from './People.jsx';
import RevealCard from './RevealCard.jsx';
import './angel.css';

// Secret Angel：大家可能互相不熟，所以每人先从十张问题卡片里挑五张（QuestionPicker，「不能送的」必答，
// questions.js），再一张一张回答（QuestionDeck），最后看答好的五张（AnswerCards）；天使拿着答案挑礼物；然后谁都可以抽签（没有管理员，大家一样；抽签、重抽、排除谁都会记下是谁做的），
// 每个人只看得到自己要送给谁。抽签把所有注册的人（排除的除外，答没答题都算）随机排成一个圈（worker/angel/draw.js），
// 抽签之后才来的人等下一次 Shuffle；重抽不清任何人的答案。
export default function AngelView({ active }) {
  const { name, token, users, openLogin } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [dirty, setDirty] = useState(false);
  // 三步：'pick' 挑五张题 → 'answer' 一张一张回答 → 看答好的五张（stage 为 null 时：有答案就看答案，没有就挑题）
  const [stage, setStage] = useState(null);
  const [selected, setSelected] = useState(['nogo']); // 挑中的题；「不能送的」一开始就选好
  const [deckRound, setDeckRound] = useState(0); // 每次进回答都从第一张开始
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
    if (await post('/api/angel/prefs', { answers: cleanAnswers(answers) })) { setDirty(false); setStage(null); toast(answered ? '答案更新好了 ✨' : '答好了，等抽签吧 😇'); }
  }
  async function draw() {
    const ok = data.drawn
      ? await confirm({ title: '重新抽签？', message: '已经抽过了。重新抽会把所有人（排除的除外）重新随机排一圈，每个人的结果都会变；答案不会清掉。会记下是你重抽的。确定吗？', confirmText: '重新抽' })
      : await confirm({ title: '开始抽签？', message: '所有注册的人（排除的除外）随机排成一个圈，每人送下一个人，大家马上就能看到自己要送给谁。还没答题的人也在里面。会记下是你抽的。', confirmText: '抽签' });
    if (!ok) return;
    if (await post('/api/angel/draw', {})) toast('🎲 抽好了！大家去拆信封吧');
  }
  // 排除 / 加回来：谁都可以，先确认一下
  async function exclude(target, excluded) {
    if (!await confirm({ title: excluded ? '排除 ' + target + '？' : '把 ' + target + ' 加回来？', message: excluded ? 'TA 不参加这次 Secret Angel（比如来不了）。已经抽过的话，TA 会从圈里拿掉：原来送 TA 的人改送 TA 要送的人，其他人不变（剩不到 3 个人的话，抽签结果会清掉，要重新抽）。会记下是你排除的。' : 'TA 重新参加；已经抽过的话，要有人重新 Shuffle 一次 TA 才进圈。', confirmText: excluded ? '排除' : '加回来' })) return;
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

  // 抽签池：所有注册的人，排除的除外（答没答题都算）；抽签之后才来的人要等下一次 Shuffle
  const people = data.people.filter(p => !p.excluded);
  const notIn = data.drawn ? people.filter(p => !p.inDraw) : [];
  const unanswered = people.filter(p => !p.submitted);
  const wrong = answersError(answers);
  const answeredIds = Object.keys(cleanAnswers(answers));
  const view = stage || (answeredIds.length ? 'review' : 'pick');
  const deckIds = QUESTIONS.filter(q => selected.includes(q.id)).map(q => q.id); // 「不能送的」排第一
  const startAnswering = () => {
    setAnswers(a => Object.fromEntries(Object.entries(a).filter(([k]) => selected.includes(k)))); // 换掉的题不留答案
    setDeckRound(n => n + 1); setStage('answer');
  };
  return (
    <div className="space-y-5">
      {data.drawn && (data.master
        ? <RevealCard master={data.master} drawnAt={data.drawnAt} me={name} />
        : <section className="glass-card rounded-2xl p-5 text-sm text-slate-600">已经抽过签了，但这次没有你（你是抽签之后才来的，或者被排除了又加回来）。谁都可以在下面点「重新 Shuffle」把你加进来。</section>)}

      <section className="glass-card rounded-2xl p-5">
        <div className="mb-4">
          <h2 className="font-bold text-lg">🎁 让天使认识你</h2>
          <p className="text-sm text-slate-500">
            {view === 'pick' ? '先从十张问题卡片里挑 5 张你想回答的（「不能送的」必答，已经帮你选好），再一张一张回答。抽到你的天使会看到你的答案。'
              : view === 'answer' ? '一张一张回答，每张一句话就行。'
              : answered && !dirty ? '你的五张卡片，抽到你的天使会看到。点「改」能改一句，也可以换题。'
              : '五张都答好了，看一眼就交吧。'}
          </p>
          {mine && !answered && <p className="angel-notice">礼物分类改成了问答卡片：挑五张答好，你的天使才看得到你想要什么。</p>}
        </div>
        {view === 'pick' && <QuestionPicker selected={selected} onChange={setSelected} onNext={startAnswering} />}
        {view === 'answer' && (
          <QuestionDeck key={deckRound} ids={deckIds} answers={answers}
            onDone={next => { setAnswers(next); setDirty(true); setStage(null); }}
            onBack={kept => { setAnswers(kept); setStage('pick'); }} />
        )}
        {view === 'review' && (
          <>
            <AnswerCards answers={answers} onChange={a => { setDirty(true); setAnswers(a); }} />
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <button onClick={submit} disabled={!!wrong || (answered && !dirty)} className="bg-gradient-to-r from-indigo-600 to-pink-500 disabled:opacity-40 text-white font-bold rounded-xl px-6 py-2 shadow">
                {answered ? (dirty ? '保存修改' : '已保存 ✓') : '交答案 😇'}
              </button>
              <button onClick={() => { setSelected(answeredIds.includes('nogo') ? answeredIds : ['nogo', ...answeredIds]); setStage('pick'); }}
                className="text-sm border-2 border-slate-200 hover:border-indigo-400 rounded-full px-4 py-1.5">🔁 换题</button>
              <span className="text-sm text-rose-600">{wrong || msg}</span>
            </div>
          </>
        )}
      </section>

      <People people={data.people} drawn={data.drawn} onExclude={exclude} />

      <section className="rounded-2xl shadow p-5 text-white bg-gradient-to-br from-indigo-700 via-purple-700 to-pink-600">
        <h2 className="font-bold text-lg mb-1">🎲 抽签</h2>
        <p className="text-sm text-indigo-100 mb-4">
          {people.length < 3 ? '现在只有 ' + people.length + ' 个人，至少要 3 个人才能抽（两个人只能互送）。'
            : data.drawn ? '已经抽过了（' + (data.drawnBy ? data.drawnBy + ' 抽的，' : '') + new Date(data.drawnAt).toLocaleString('zh-CN') + '）。'
              + (notIn.length ? '还不在圈里的：' + notIn.map(p => p.name).join('、') + '（抽签之后才来的），重新 Shuffle 就会把所有人一起排进去。' : '所有人都在圈里。')
              + '重抽会让每个人的结果都变，答案不会清掉。结果连你也看不到别人的。'
            : '所有注册的人（' + people.length + ' 人，排除的除外）都会进圈：随机排成一个圈，每人送下一个人——不会抽到自己，每人只收一份，也不会两个人互送。'
              + (unanswered.length ? '还没答题的（' + unanswered.map(p => p.name).join('、') + '）也在里面，TA 的天使先看到「还没答题」，答了马上能看到。' : '')
              + '来不了的人可以在上面点 ✕ 排除。'}
        </p>
        <button onClick={draw} disabled={people.length < 3}
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
