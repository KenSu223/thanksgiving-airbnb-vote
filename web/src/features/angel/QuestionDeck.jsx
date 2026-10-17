import { useState } from 'react';
import { reduceMotion } from '../../lib/motion.js';
import { QUESTIONS, ANSWERS, MAX_ANSWER } from './questions.js';

// 一叠问题卡片，一次一张：写一句话点「下一张」就算答了，不想答点「跳过」。答满五张就停
// （不会全答），第一张「不能送的」不能跳；剩下的卡片刚好够凑满五张时，也不能再跳了。
// 答完调用 onDone(answers)；onCancel 有的话（已经交过答案的人在换题）显示「不换了」。
export default function QuestionDeck({ onDone, onCancel }) {
  const [answers, setAnswers] = useState({});
  const [queue, setQueue] = useState(() => QUESTIONS.map(q => q.id)); // 「不能送的」排在第一
  const [draft, setDraft] = useState('');
  const [fly, setFly] = useState(null); // 正在飞走的那张：'answer'（往上）或 'skip'（往左）
  const done = Object.keys(answers).length, need = ANSWERS - done;
  const q = QUESTIONS.find(x => x.id === queue[0]);
  const canSkip = !!q && !q.required && queue.length - 1 >= need;
  const text = draft.replace(/\s+/g, ' ').trim();

  function go(kind) {
    if (!q || fly || (kind === 'answer' ? !text : !canSkip)) return;
    setFly(kind);
    setTimeout(() => {
      const next = kind === 'answer' ? { ...answers, [q.id]: text.slice(0, MAX_ANSWER) } : answers;
      setAnswers(next); setQueue(qs => qs.slice(1)); setDraft(''); setFly(null);
      if (Object.keys(next).length >= ANSWERS) onDone(next);
    }, reduceMotion ? 0 : 260);
  }

  if (!q) return null;
  const under = queue.slice(1, 3).map(id => QUESTIONS.find(x => x.id === id));
  const tip = q.required ? '这张必答，帮天使避开雷区'
    : !canSkip ? '剩下的卡片刚好够凑满五张，都要答啦'
    : '不想答就跳过，答满五张就好';
  return (
    <div className="flex flex-col items-center">
      <div className="angel-dots" role="img" aria-label={'已答 ' + done + ' / ' + ANSWERS + ' 张'}>
        {Array.from({ length: ANSWERS }, (_, k) => <span key={k} className={k < done ? 'on' : ''} />)}
      </div>
      <div className="text-sm text-slate-500 mb-3">已答 {done} / {ANSWERS} 张 · 还剩 {queue.length} 张卡片</div>
      <div className="angel-deck">
        {under.slice().reverse().map((c, k, arr) => (
          <div key={c.id} className="angel-card under" aria-hidden="true"
            style={{ background: `linear-gradient(135deg, ${c.from}, ${c.to})`, transform: `translateY(${(arr.length - k) * 10}px) scale(${1 - (arr.length - k) * 0.05})` }} />
        ))}
        <div key={q.id} className={'angel-card top' + (fly ? ' fly-' + fly : '')} style={{ background: `linear-gradient(135deg, ${q.from}, ${q.to})` }}>
          {q.required && <span className="angel-must">必答</span>}
          <div className="text-5xl mb-3 select-none">{q.emoji}</div>
          <label htmlFor="angel-answer" className="angel-card-q">{q.text}</label>
          <input id="angel-answer" value={draft} maxLength={MAX_ANSWER} placeholder={q.hint} autoComplete="off"
            onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) go('answer'); }}
            className="angel-card-input" />
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-4">{tip}</p>
      <div className="flex items-center gap-3 mt-3">
        <button onClick={() => go('skip')} disabled={!canSkip} className="angel-btn ghost">跳过 →</button>
        <button onClick={() => go('answer')} disabled={!text} className="angel-btn solid">{need === 1 ? '答完了 ✓' : '下一张 ✓'}</button>
      </div>
      {onCancel && <button onClick={onCancel} className="mt-3 text-sm text-slate-400 hover:text-slate-600">← 不换了，用原来的答案</button>}
    </div>
  );
}
