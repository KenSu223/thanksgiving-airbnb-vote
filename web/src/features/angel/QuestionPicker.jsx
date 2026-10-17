import { QUESTIONS, ANSWERS } from './questions.js';

// 第一步：挑题。十张问题卡片摊开（像以前的礼物分类那样），点一下选上、再点取消；「不能送的」
// 已经选好、去不掉（必答）。选满五张，其余的变灰点不了，「下一步：回答」才亮。
export default function QuestionPicker({ selected, onChange, onNext }) {
  const full = selected.length >= ANSWERS;
  const toggle = q => {
    if (q.required) return;
    if (selected.includes(q.id)) onChange(selected.filter(id => id !== q.id));
    else if (!full) onChange([...selected, q.id]);
  };
  return (
    <div>
      <div className="angel-pick-head">
        <span>挑 {ANSWERS} 张你想回答的问题</span>
        <span className="tabular-nums font-bold text-indigo-600">已选 {selected.length} / {ANSWERS}</span>
      </div>
      <ul className="angel-tiles">
        {QUESTIONS.map(q => {
          const on = selected.includes(q.id), off = !on && full;
          return (
            <li key={q.id}>
              <button type="button" onClick={() => toggle(q)} disabled={off} aria-pressed={on}
                className={'angel-tile' + (on ? ' on' : '') + (off ? ' off' : '') + (q.required ? ' must' : '')}
                style={on ? { background: `linear-gradient(135deg, ${q.from}, ${q.to})` } : undefined}>
                <span className="text-3xl leading-none">{q.emoji}</span>
                <span className="angel-tile-q">{q.text}</span>
                <span className="angel-tile-badge">{q.required ? '必答' : on ? '✓ 选了' : full ? '选满了' : '选这张'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3 mt-4">
        <button onClick={onNext} disabled={!full} className="angel-btn solid">下一步：回答 →</button>
        <span className="text-sm text-slate-500">{full ? '选好了，去一张一张回答吧' : '再选 ' + (ANSWERS - selected.length) + ' 张'}</span>
      </div>
    </div>
  );
}
