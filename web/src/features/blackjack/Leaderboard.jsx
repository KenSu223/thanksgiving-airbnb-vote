import { BoardRows, place, TOP_NOTE } from '../games/TopBoard.jsx';

// 净赢 = 现在的筹码 − 发给你的（开局 1000 + 每次补给 1000），可以是负的
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString();

export default function Leaderboard({ rows, me }) {
  return (
    <aside className="glass-card rounded-2xl p-5 self-start">
      <h2 className="font-bold text-lg mb-1">🏆 筹码榜</h2>
      <p className="text-xs text-slate-500 mb-3">按净赢排：现在的筹码 − 1000 ×（1 + 补给次数），输多了是负数，补给再多也不会往上排 · 站起来时才保存筹码 · 初始 1000，输光了自动补给 · {TOP_NOTE}</p>
      <BoardRows rows={rows} me={me} row={(r, i, isMe) => (
        <div key={isMe ? 'me' : r.name} className={'flex items-center justify-between gap-2 border-b py-1.5 text-sm' + (isMe ? ' font-bold text-indigo-700' : '')}>
          <span className="truncate">{place(i)} {r.name}{r.seated && <span className="text-xs text-emerald-600"> 在桌上</span>}</span>
          <span className="whitespace-nowrap">
            <span className={'font-bold tabular-nums ' + (r.net > 0 ? 'text-emerald-600' : r.net < 0 ? 'text-rose-600' : '')}>{signed(r.net)}</span>
            <span className="text-xs text-slate-400 tabular-nums"> 🪙{r.chips.toLocaleString()}{r.refills ? ` · 补给×${r.refills}` : ''}</span>
          </span>
        </div>
      )} />
      <p className="text-xs text-slate-400 mt-4 leading-relaxed">规则：6 副牌，庄家软 17 停牌，Blackjack 赔 3:2，头两张可以加倍，不能分牌和买保险。每注 10–500。筹码只是好玩，和分账无关。</p>
    </aside>
  );
}
