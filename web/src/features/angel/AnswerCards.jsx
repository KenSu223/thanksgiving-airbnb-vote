import { useState } from 'react';
import { QUESTIONS, MAX_ANSWER } from './questions.js';

// 答好的五张卡片摊开：一眼看到自己答了什么，点「改」可以就地改一句（不能改成空的）。
export default function AnswerCards({ answers, onChange }) {
  const [editing, setEditing] = useState(null); // { id, text }
  const shown = QUESTIONS.filter(q => answers[q.id]);
  const save = () => {
    const t = editing.text.replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER);
    if (t && t !== answers[editing.id]) onChange({ ...answers, [editing.id]: t });
    setEditing(null);
  };
  return (
    <ul className="angel-minis">
      {shown.map(q => (
        <li key={q.id} className="angel-mini" style={{ background: `linear-gradient(135deg, ${q.from}, ${q.to})` }}>
          <div className="flex items-start gap-2">
            <span className="text-2xl leading-none">{q.emoji}</span>
            <span className="angel-mini-q">{q.text}</span>
            {editing?.id !== q.id && <button onClick={() => setEditing({ id: q.id, text: answers[q.id] })} className="angel-mini-edit" aria-label={'改「' + q.text + '」的答案'}>改</button>}
          </div>
          {editing?.id === q.id
            ? <input autoFocus value={editing.text} maxLength={MAX_ANSWER} onChange={e => setEditing({ ...editing, text: e.target.value })}
                onBlur={save} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) save(); if (e.key === 'Escape') setEditing(null); }}
                className="angel-card-input mt-2" aria-label={q.text} />
            : <div className="angel-mini-a">{answers[q.id]}</div>}
        </li>
      ))}
    </ul>
  );
}
