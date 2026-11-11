import { useRef, useState } from 'react';

// A word that bursts out over the table for a moment: 炸弹！ 王炸！ 春天 (斗地主, 掼蛋, over the middle of
// the table), 碰 / 杠 / 胡 (川麻, in front of whoever called it). shout(text, { cls, seat }) shows one;
// it takes itself away again.
export function useCallouts(ms = 1500) {
  const [list, setList] = useState([]);
  const id = useRef(0);
  const shout = (text, extra) => {
    const n = ++id.current;
    setList(c => [...c, { id: n, text, ...extra }]);
    setTimeout(() => setList(c => c.filter(x => x.id !== n)), ms);
  };
  return [list, shout];
}
// over the middle of the table (the parent is .gt-mid)
export function Callouts({ list }) {
  return list.map(c => <span key={c.id} className={'gt-callout ' + (c.cls || '')} aria-hidden="true">{c.text}</span>);
}
