import { QUESTIONS, MAX_ANSWER } from './questions.js';

// 十道题，每道一行短答；答了的那道会亮起来。挑五道答，「不能送的」必答。
export default function Questions({ answers, onChange }) {
  return (
    <ul className="angel-qs">
      {QUESTIONS.map(q => {
        const v = answers[q.id] || '';
        return (
          <li key={q.id} className={'angel-q' + (v.trim() ? ' done' : '') + (q.required ? ' must' : '')}>
            <label htmlFor={'aq-' + q.id} className="angel-q-text">
              {q.text}{q.required && <span className="angel-req">必答</span>}
            </label>
            <input id={'aq-' + q.id} value={v} maxLength={MAX_ANSWER} placeholder={q.hint} autoComplete="off"
              onChange={e => onChange({ ...answers, [q.id]: e.target.value })} className="angel-q-input" />
          </li>
        );
      })}
    </ul>
  );
}
