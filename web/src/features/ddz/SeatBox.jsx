import { CardRun } from '../games/PlayingCard.jsx';
import { ReactBubbles } from '../games/Reactions.jsx';

// 一个座位：名字、地主/农民、剩几张、豆子，以及这一轮说了什么 / 出了什么。
export function Said({ said }) {
  if (!said) return <div className="gt-said" />;
  if (typeof said === 'string') return <div className="gt-said"><span className="gt-bubble">{said}</span></div>;
  return <div className="gt-said"><CardRun cards={said.cards} /></div>;
}

export default function SeatBox({ s, idx, t, timer, compact, reacts }) {
  if (!s) return <div className="gt-seat empty">空位</div>;
  const turn = t.turn === idx && (t.phase === 'bidding' || t.phase === 'playing');
  const role = t.landlord < 0 ? null : t.landlord === idx ? '👑 地主' : '农民';
  const badge = role && <span className={'gt-role' + (t.landlord === idx ? ' gold' : '')}>{role}</span>;
  // 两边的小座位框太窄，地主/农民放到第二行，名字才不会被挤掉
  // data-react-to：表情拖放的目标（玩家 key），Reactions.jsx 靠它命中座位
  return (
    <div data-react-to={s.name.toLowerCase()} className={'gt-seat' + (turn ? ' turn' : '') + (s.connected ? '' : ' away') + (compact ? ' compact' : '')}>
      <ReactBubbles list={reacts} />
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold truncate">{s.name}{s.me ? '（你）' : ''}</span>
        {!compact && badge}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs mt-1 text-emerald-50/90">
        <span>🂠 {s.count} 张</span>
        {compact && badge}
        {s.points != null && <span className="tabular-nums">🫘 {s.points.toLocaleString()}</span>}
      </div>
      <div className="text-xs mt-1 min-h-[1rem] text-amber-200">
        {turn ? '思考中' + (timer ? ' · ' + timer : '…') : s.auto ? '托管中' : s.leaving ? '这局后离开' : !s.connected ? '掉线了' : ''}
      </div>
    </div>
  );
}
