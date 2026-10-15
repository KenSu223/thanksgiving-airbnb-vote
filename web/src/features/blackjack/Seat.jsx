import Card from './Card.jsx';
import { ReactBubbles } from '../games/Reactions.jsx';

export const BJ_RESULT = { win: '赢了', lose: '输了', push: '平局', bust: '爆了 💥', blackjack: 'Blackjack! 🎉', refill: '破产了，补给 1000' };

function label(s, t, turn) {
  const net = s.net ? ' ' + (s.net > 0 ? '+' : '−') + Math.abs(s.net) : '';
  if (s.status === 'out') return s.result ? BJ_RESULT[s.result] + (s.result === 'refill' ? '' : net) : (t.phase === 'waiting' || t.phase === 'betting' ? '还没下注' : '这局没玩');
  if (s.status === 'bet') return '已下注';
  if (s.status === 'playing') return turn ? '思考中…' : '等待中';
  if (s.status === 'stood') return '停牌';
  if (s.status === 'bust') return '爆了 💥';
  if (s.status === 'blackjack') return 'Blackjack!';
  return (BJ_RESULT[s.result] || '') + net;
}

export default function Seat({ s, t, mine, cardDelay, reacts }) {
  const turn = t.turn === s.key;
  const tone = /^(win|blackjack)$/.test(s.result) ? 'text-amber-300' : /^(lose|bust)$/.test(s.result) ? 'text-rose-200' : 'text-emerald-100';
  return (
    <div data-react-to={s.key} className={'bj-seat' + (mine ? ' me' : '') + (turn ? ' turn' : '') + (s.connected ? '' : ' away')}>
      <ReactBubbles list={reacts} />
      <div className="flex items-center justify-between gap-2 text-sm mb-1">
        <span className="font-bold truncate">{s.name}{mine ? '（你）' : ''}</span>
        <span className="font-bold text-amber-200 tabular-nums">🪙 {s.chips.toLocaleString()}</span>
      </div>
      <div className="bj-hand">{s.cards.map((c, i) => { const id = t.round + ':' + s.key + ':' + i; return <Card key={id} card={c} delay={cardDelay(id)} />; })}</div>
      <div className="flex items-center justify-between text-xs mt-1 text-emerald-100">
        <span>{s.total != null ? s.total + ' 点' : ''}</span>
        <span>{s.bet ? '注 ' + s.bet + (s.doubled ? '（加倍）' : '') : ''}</span>
      </div>
      <div className={'text-sm font-bold mt-1 ' + tone}>{label(s, t, turn)}{s.leaving ? ' · 这局后离开' : ''}</div>
    </div>
  );
}
