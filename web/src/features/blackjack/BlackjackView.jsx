import { useEffect, useRef, useState } from 'react';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { useBlackjack } from './useBlackjack.js';
import Card from './Card.jsx';
import Seat from './Seat.jsx';
import { ReactionBar, reactionsFor } from '../games/Reactions.jsx';
import Controls from './Controls.jsx';
import Leaderboard from './Leaderboard.jsx';
import './blackjack.css';

// 倒计时用服务器给的时间算，本地每 250ms 刷一下
function useCountdown(st) {
  const [, tick] = useState(0);
  const t = st?.table;
  useEffect(() => {
    if (!t?.deadline) return;
    const id = setInterval(() => tick(n => n + 1), 250);
    return () => clearInterval(id);
  }, [t?.deadline]);
  if (!t) return '';
  const left = t.deadline ? Math.max(0, Math.ceil((t.deadline - t.now - (Date.now() - st.at)) / 1000)) : 0;
  if (t.phase === 'waiting') return t.seats.length ? '等人下注' : '';
  if (t.phase === 'betting') return '下注中 · ' + left + 's';
  if (t.phase === 'playing') { const s = t.seats.find(x => x.key === t.turn); return (s ? (s.key === st.you ? '轮到你' : '轮到 ' + s.name) + ' · ' : '') + left + 's'; }
  return t.phase === 'result' ? left + 's 后下一局' : '';
}

export default function BlackjackView({ active }) {
  const { st, live, me, msg, send, sit, standUp } = useBlackjack(active);
  const timer = useCountdown(st);
  const t = st?.table;
  const shown = useRef(new Set()); // 已经画过的牌：只有新牌播发牌动画
  const celebrated = useRef(-1);

  // 这次渲染里新出现的牌按顺序错开 90ms
  const fresh = [];
  const cardDelay = id => { if (shown.current.has(id)) return null; let i = fresh.indexOf(id); if (i < 0) { fresh.push(id); i = fresh.length - 1; } return i * 90; };
  useEffect(() => { shown.current.clear(); }, [t?.round]); // 先清上一局，再记这一局画过的牌
  useEffect(() => { fresh.forEach(id => shown.current.add(id)); });

  // 自己赢了撒点彩带
  useEffect(() => {
    if (!t || t.phase !== 'result' || !me || celebrated.current === t.round || !/^(win|blackjack)$/.test(me.result)) return;
    celebrated.current = t.round;
    if (!reduceMotion) confetti({ particleCount: me.result === 'blackjack' ? 160 : 60, spread: 80, origin: { y: 0.6 }, colors: CONFETTI_COLORS });
  }, [t, me]);

  const status = !t ? '连接中…' : !live ? '断线了，重连中…' : t.seats.length + '/' + t.rules.seats + ' 人在桌上' + (me ? '' : ' · 你在旁观');
  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <section className="lg:col-span-2 bj-felt rounded-2xl shadow-xl p-4 md:p-6 text-white">
        <div className="flex items-center justify-between gap-3 mb-4 text-sm">
          <span className="font-medium text-emerald-100">{status}</span>
          <span className="font-bold tabular-nums text-amber-200">{timer}</span>
        </div>
        {t && (
          <>
            <div className="text-center mb-6">
              <div className="text-xs tracking-widest text-emerald-200 mb-2">庄家 DEALER <span className="font-bold text-white">{t.dealerTotal != null ? '· ' + t.dealerTotal + ' 点' : ''}</span></div>
              <div className="bj-hand justify-center">
                {t.dealer.map((c, i) => { const id = t.round + ':dealer:' + i + ':' + c; return <Card key={id} card={c} delay={cardDelay(id)} />; })}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {t.seats.length ? t.seats.map(s => <Seat key={s.key} s={s} t={t} mine={s.key === st.you} cardDelay={cardDelay} reacts={reactionsFor(st?.reactions, s.key)} />)
                : <p className="col-span-full text-center text-emerald-100/80 text-sm py-6">桌上还没人，坐下开一局吧</p>}
            </div>
            <div className="mt-5"><Controls t={t} me={me} live={live} send={send} sit={sit} standUp={standUp} /></div>
          </>
        )}
        <p className="text-sm mt-3 min-h-[1.25rem] text-amber-200">{msg}</p>
        <ReactionBar send={send} active={active} />
      </section>
      <Leaderboard rows={st?.board || []} />
    </div>
  );
}
