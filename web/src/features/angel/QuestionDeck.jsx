import { useState } from 'react';
import { reduceMotion } from '../../lib/motion.js';
import { questionById, MAX_ANSWER } from './questions.js';

// 第二步：回答挑好的五张，一次一张。写一句话点「下一张」，最后一张是「答完了」；「上一张」能回去改，
// 第一张上是「换题」（回到挑题）。answers 是已经有的答案（改答案时带进来），答完调用 onDone(answers)，
// 回去挑题调用 onBack(answers)（写到一半的也带上）。
export default function QuestionDeck({ ids, answers: initial, onDone, onBack }) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState(() => ({ ...initial }));
  const [draft, setDraft] = useState(() => initial[ids[0]] || '');
  const [fly, setFly] = useState(null); // 正在飞走的那张：'next'（往上）或 'back'（往右）
  const q = questionById[ids[i]];
  const text = draft.replace(/\s+/g, ' ').trim();
  const last = i === ids.length - 1;

  function move(dir) {
    if (fly || (dir > 0 && !text)) return;
    const kept = text ? { ...answers, [q.id]: text.slice(0, MAX_ANSWER) } : answers;
    if (dir < 0 && i === 0) { onBack(kept); return; }
    setFly(dir > 0 ? 'next' : 'back');
    setTimeout(() => {
      setAnswers(kept); setFly(null);
      if (dir > 0 && last) { onDone(kept); return; }
      const j = i + dir;
      setI(j); setDraft(kept[ids[j]] || '');
    }, reduceMotion ? 0 : 240);
  }

  const under = ids.slice(i + 1, i + 3).map(id => questionById[id]);
  return (
    <div className="flex flex-col items-center">
      <div className="angel-dots" role="img" aria-label={'第 ' + (i + 1) + ' / ' + ids.length + ' 张'}>
        {ids.map((id, k) => <span key={id} className={k < i || (k === i && text) ? 'on' : k === i ? 'now' : ''} />)}
      </div>
      <div className="text-sm text-slate-500 mb-3">第 {i + 1} / {ids.length} 张</div>
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
            onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) move(1); }}
            className="angel-card-input" />
        </div>
      </div>
      <div className="flex items-center gap-3 mt-5">
        <button onClick={() => move(-1)} className="angel-btn ghost">{i === 0 ? '← 换题' : '← 上一张'}</button>
        <button onClick={() => move(1)} disabled={!text} className="angel-btn solid">{last ? '答完了 ✓' : '下一张 ✓'}</button>
      </div>
    </div>
  );
}
