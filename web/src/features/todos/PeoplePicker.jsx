// 点名字选人（可以多选）：选中的是实心胶囊
export default function PeoplePicker({ people, value, onChange, me }) {
  const on = new Set(value);
  const toggle = n => onChange(on.has(n) ? value.filter(x => x !== n) : [...value, n]);
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="指派给谁">
      {people.map(n => (
        <button key={n} type="button" onClick={() => toggle(n)} aria-pressed={on.has(n)} className={'td-person' + (on.has(n) ? ' on' : '')}>
          {n}{n === me ? '（我）' : ''}
        </button>
      ))}
    </div>
  );
}
