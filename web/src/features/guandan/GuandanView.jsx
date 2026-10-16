import { useEffect, useState } from 'react';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { useTable, useCountdown, secondsLeft } from '../games/useTable.js';
import { alertsOn, setAlertsOn, unlock, useTurnAlert } from '../games/turnAlert.js';
import TableFrame, { useFullTable, RoomPicker, PointsBoard } from '../games/TableFrame.jsx';
import PlayingCard, { CardRun, faceOf } from '../games/PlayingCard.jsx';
import CardHand from '../games/CardHand.jsx';
import { ReactionBar, ReactBubbles, reactionsFor } from '../games/Reactions.jsx';
import './guandan.css';

const PHASE = { waiting: '等人开始', tribute: '进贡中', playing: '对局中', result: '这局结束' };
const PLACE = ['', '头游', '二游', '三游', '末游'];
const RANK_NUM = { J: 11, Q: 12, K: 13, A: 14 };
const rankNum = c => { const f = faceOf(c); return RANK_NUM[f.slice(0, -1)] || Number(f.slice(0, -1)); };
const levelName = l => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[l] || String(l);
// 逢人配：红心的级牌
const wildOf = level => c => !/j/.test(faceOf(c)) && faceOf(c).slice(-1) === '♥' && rankNum(c) === level;
const TYPE_NAME = { full: '三带二', straight: '顺子', tube: '三连对', plate: '钢板', sflush: '同花顺', jokers: '天王炸' };
const playLabel = p => (!p ? '' : p.type === 'bomb' ? '💣 ' + p.n + ' 炸' : p.type === 'sflush' || p.type === 'jokers' ? '💣 ' + TYPE_NAME[p.type] : TYPE_NAME[p.type] || '');

function Said({ said, isWild }) {
  if (!said) return <div className="gt-said" />;
  if (typeof said === 'string') return <div className="gt-said"><span className="gt-bubble">{said}</span></div>;
  return <div className="gt-said gd-said"><CardRun cards={said.cards} isWild={isWild} />{playLabel(said.play) && <span className="gd-tag">{playLabel(said.play)}</span>}</div>;
}

function Seat({ s, idx, t, me, timer, compact, reacts }) {
  if (!s) return <div className="gt-seat empty">空位</div>;
  const turn = t.turn === idx && t.phase === 'playing';
  const mate = me >= 0 && idx !== me && idx % 2 === me % 2;
  return (
    <div data-react-to={s.name.toLowerCase()} className={'gt-seat' + (turn ? ' turn' : '') + (s.connected ? '' : ' away') + (compact ? ' compact' : '')}>
      <ReactBubbles list={reacts} />
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold truncate">{s.name}{s.me ? '（你）' : ''}</span>
        {s.place > 0 && <span className={'gt-role' + (s.place === 1 ? ' gold' : '')}>{PLACE[s.place]}</span>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs mt-1 text-emerald-50/90">
        <span>🂠 {s.count} 张</span>
        {mate && <span className="gt-role">队友</span>}
        {s.points != null && <span className="tabular-nums">🫘 {s.points.toLocaleString()}</span>}
      </div>
      <div className="text-xs mt-1 min-h-[1rem] text-amber-200">
        {turn ? '思考中' + (timer ? ' · ' + timer : '…') : s.auto ? '托管中' : s.leaving ? '这局后离开' : !s.connected ? '掉线了' : ''}
      </div>
    </div>
  );
}

export default function GuandanView({ active }) {
  const { st, live, msg, flash, hint, setHint, room, watch, send, sit, standUp } = useTable(active, { path: '/api/guandan', roomKey: 'gdRoom', noHint: '没有管得上的牌，建议不出' });
  const timer = useCountdown(st, active && live);
  const t = st?.table;
  const me = t ? t.you : -1;
  const mySeat = me >= 0 ? t.seats[me] : null;
  const myCards = mySeat?.cards || [];
  const [sel, setSel] = useState(() => new Set());
  const { full, exit, enter, canEnter } = useFullTable(active && me >= 0);
  const isWild = wildOf(t?.level);

  const handKey = (t?.round || 0) + ':' + myCards.length + ':' + t?.phase;
  useEffect(() => { setSel(new Set()); }, [handKey]);
  useEffect(() => { if (hint) { setSel(new Set(hint)); setHint(null); } }, [hint, setHint]);
  const won = t?.phase === 'result' && me >= 0 && t.result?.deltas[me] > 0;
  const round = t?.round;
  useEffect(() => {
    if (won && !reduceMotion) confetti({ particleCount: t.result.matchWon ? 220 : 110, spread: 90, origin: { y: 0.6 }, colors: CONFETTI_COLORS });
  }, [won, round]); // eslint-disable-line react-hooks/exhaustive-deps

  const flip = list => setSel(s => { const n = new Set(s); for (const c of list) { if (n.has(c)) n.delete(c); else n.add(c); } return n; });
  const deal = label => <button onClick={() => send({ type: 'start' })} className="gt-btn bg-amber-400 text-slate-900">{label}</button>;
  const bottom = me >= 0 ? me : 0, right = (bottom + 1) % 4, top = (bottom + 2) % 4, left = (bottom + 3) % 4;
  const myTurn = me >= 0 && t.turn === me && t.phase === 'playing';
  const leading = myTurn && (t.trickBy === -1 || t.trickBy === me);
  const here = st?.lobby?.[room - 1];
  const seatedElsewhere = st?.seatedAt && st.seatedAt !== room;
  const name = k => t.seats[k]?.name || t.result?.names[k] || '空位';
  // 级数：坐着的人看「我们 / 对方」，旁观的看两队
  const us = me >= 0 ? me % 2 : 0;
  const levels = t && (me >= 0 ? `我们打 ${levelName(t.levels[us])} · 对方打 ${levelName(t.levels[1 - us])}` : `${name(0)}队 ${levelName(t.levels[0])} · ${name(1)}队 ${levelName(t.levels[1])}`);
  const status = !t ? '连接中…' : !live ? '断线了，重连中…' : '桌 ' + room + ' · ' + PHASE[t.phase];
  // 轮到你（出牌，或者要还贡）：按钮旁边一个会动的 🔔、叮咚一声、手机震一下、后台时标题闪；
  // 最后 5 秒变 ⏰、倒计时变红（games/turnAlert.js，和斗地主、川麻一样）
  const deciding = !!t && !!mySeat && live && !mySeat.auto && !seatedElsewhere && ((myTurn && !mySeat.place) || (t.phase === 'tribute' && !!t.mustReturn));
  const secs = secondsLeft(st);
  const hurry = deciding && secs != null && secs <= 5;
  useTurnAlert(deciding ? t.phase + ':' + t.deadline : 0, secs);
  const [alerts, setAlerts] = useState(alertsOn);
  const toggleAlerts = () => { setAlertsOn(!alerts); setAlerts(!alerts); };
  const soon = t?.phase === 'tribute' ? '超时自动帮你还一张' : '超时自动帮你出';
  const bell = deciding && (
    <span className={'gt-bell' + (hurry ? ' hurry' : '')} role="status" aria-label={(t.phase === 'tribute' ? '轮到你还贡' : leading ? '轮到你先出' : '轮到你出牌') + (hurry ? '，快没时间了，' + soon : '')}
      title={hurry ? '快没时间了，' + soon : t.phase === 'tribute' ? '轮到你还贡' : '轮到你出牌'}>{hurry ? '⏰' : '🔔'}</span>
  );
  const clock = <span className={'text-sm tabular-nums ' + (hurry ? 'gt-timer-hurry' : 'text-amber-200')}>{timer}</span>;

  function giveBack() {
    if (sel.size !== 1) return flash('选一张 10 或以下的牌还回去');
    send({ type: 'back', card: [...sel][0] });
  }

  function controls() {
    if (!live || !t) return null;
    if (seatedElsewhere) return <button onClick={() => watch(st.seatedAt)} className="gt-btn bg-amber-400 text-slate-900">回到我坐的桌 {st.seatedAt}</button>;
    if (t.waiting) return <>
      {t.phase === 'waiting' ? deal('开始游戏') : <span className="text-sm text-emerald-100">{t.phase === 'result' ? '点「再来一局」就坐下' : '已经排上了，这局打完就坐下'}</span>}
      <button onClick={standUp} className="gt-btn bg-white/15 text-white ml-auto">不等了</button>
    </>;
    if (me < 0) {
      const taken = (here?.people.length || 0) >= 4;
      return <button onClick={sit} disabled={taken} className="gt-btn bg-amber-400 text-slate-900">{taken ? '这桌满了' : '🪑 坐下'}</button>;
    }
    const stand = <button onClick={standUp} className="gt-btn bg-white/15 text-white ml-auto">站起来</button>;
    const auto = mySeat.auto
      ? <button onClick={() => send({ type: 'auto', on: false })} className="gt-btn bg-fuchsia-500 text-white">取消托管</button>
      : t.phase === 'playing' || t.phase === 'tribute' ? <button onClick={() => send({ type: 'auto', on: true })} className="gt-btn bg-white/15 text-white">托管</button> : null;
    if (t.phase === 'waiting') return <>{deal('开始游戏')}<span className="text-sm text-emerald-100">空位由机器人补上，对面是队友</span>{stand}</>;
    // 再来一局 is in the result banner; full screen also puts it here, where it's always on screen
    if (t.phase === 'result') return full ? <>{deal('🔁 再来一局')}{stand}</> : stand;
    if (t.phase === 'tribute') {
      if (!t.mustReturn) return <><span className="text-sm text-emerald-100">等还贡…</span>{auto}{stand}</>;
      return <>{bell}<button onClick={giveBack} disabled={sel.size !== 1} className="gt-btn bg-amber-400 text-slate-900">还贡</button>
        <span className="text-sm text-amber-200">选一张 10 或以下的牌</span>{clock}{auto}{stand}</>;
    }
    if (mySeat.place) return <><span className="text-sm text-emerald-100">你已经{PLACE[mySeat.place]}，看队友的</span>{stand}</>;
    if (!myTurn || mySeat.auto) return <><span className="text-sm text-emerald-100">等别人出牌…</span>{auto}{stand}</>;
    return <>
      {bell}
      <button onClick={() => send({ type: 'pass' })} disabled={leading} className="gt-btn bg-white text-emerald-800">不出</button>
      <button onClick={() => send({ type: 'hint' })} className="gt-btn bg-sky-400 text-slate-900">提示</button>
      <button onClick={() => send({ type: 'play', cards: [...sel] })} disabled={!sel.size} className="gt-btn bg-amber-400 text-slate-900">出牌</button>
      {clock}{auto}{stand}
    </>;
  }

  const result = t?.phase === 'result' && t.result;
  const tr = t?.tribute;
  const tributeLine = tr && (tr.resist ? '抗贡！手里有两个大王，不用进贡' :
    tr.gives.map(g => `${name(g.from)} 进贡 ${cardText(g.card)} → ${name(g.to)}`).concat(tr.returns.map(r => `${name(r.from)} 还贡 ${r.card ? cardText(r.card) : r.done ? '一张' : '…'} → ${name(r.to)}`)).join(' · '));
  const weWon = result && (me >= 0 ? result.winTeam === us : null);
  const meLine = full && mySeat && <span className="text-xs text-emerald-50/90">{mySeat.place ? PLACE[mySeat.place] + ' · ' : ''}🫘 {mySeat.points?.toLocaleString()}</span>;
  return (
    <div>
      <RoomPicker st={st} room={room} watch={watch} phases={PHASE} />
      <div className="grid lg:grid-cols-3 gap-5">
        <TableFrame full={full} onExit={exit} className="lg:col-span-2">
          {/* 点牌桌任何地方都让浏览器允许提醒出声（浏览器要求先点过页面） */}
          <div style={{ display: 'contents' }} onPointerDownCapture={unlock}>
          <div className="gt-bar flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-3 text-sm">
            <span className="font-medium text-emerald-100">{status}</span>
            {meLine}
            {t && <span className="font-bold text-amber-200">本局打 {levelName(t.level)}<span className="font-normal text-emerald-100"> · {levels}</span></span>}
            <button onClick={toggleAlerts} aria-pressed={alerts} title={alerts ? '轮到你时响一声（点一下关掉）' : '轮到你时不响（点一下打开）'}
              className="text-xs rounded-full bg-white/15 px-2 py-1">{alerts ? '🔔 提醒' : '🔕 提醒'}</button>
            {canEnter && <button onClick={enter} className="text-xs rounded-full bg-white/15 px-2 py-1">⛶ 全屏</button>}
          </div>
          {t && (
            <>
              <div className="gt-mid">
                <div className="gd-top"><Seat s={t.seats[top]} idx={top} t={t} me={me} timer={timer} compact reacts={reactionsFor(st?.reactions, t.seats[top]?.name?.toLowerCase())} /><Said said={t.said[top]} isWild={isWild} /></div>
                <div className="gd-row">
                  <div className="gd-side"><Seat s={t.seats[left]} idx={left} t={t} me={me} timer={timer} compact reacts={reactionsFor(st?.reactions, t.seats[left]?.name?.toLowerCase())} /><Said said={t.said[left]} isWild={isWild} /></div>
                  <div className="gd-side right"><Seat s={t.seats[right]} idx={right} t={t} me={me} timer={timer} compact reacts={reactionsFor(st?.reactions, t.seats[right]?.name?.toLowerCase())} /><Said said={t.said[right]} isWild={isWild} /></div>
                </div>
                {tributeLine && !result && t.phase !== 'waiting' && <div className="gd-note">{tributeLine}</div>}
                {result && (
                  <div className="gt-result">
                    <div className="text-lg font-extrabold">
                      {result.matchWon ? '🏆 过 A！' : ''}{weWon === null ? `${name(result.order[0])}队赢了` : weWon ? '🎉 我们赢了！' : '对方赢了'}
                      {!result.matchWon && ` · 升 ${result.up} 级`}
                    </div>
                    <div className="text-sm mt-1">{result.order.map((k, i) => PLACE[i + 1] + ' ' + name(k)).join(' · ')}</div>
                    <div className="text-sm mt-1">{result.names.map((n, k) => n + ' ' + (result.deltas[k] > 0 ? '+' : '') + result.deltas[k]).join(' · ')}</div>
                    {result.matchWon ? <div className="text-xs mt-1 text-emerald-100">整场结束，下一局两队都从 2 打起</div>
                      : <div className="text-xs mt-1 text-emerald-100">下一局打 {levelName(result.after[result.winTeam])}</div>}
                    {[left, top, right].filter(k => t.seats[k]?.cards?.length).map(k => (
                      <div key={k} className="flex items-center justify-center gap-2 mt-2 text-xs">
                        <span className="shrink-0 text-emerald-100">{name(k)} 剩</span>
                        <div className="gd-left"><CardRun cards={t.seats[k].cards} isWild={isWild} /></div>
                      </div>
                    ))}
                    {live && (me >= 0 || t.waiting) && !seatedElsewhere && <div className="mt-3">{deal('🔁 再来一局')}</div>}
                  </div>
                )}
                <div className="mt-1 gd-mine"><Said said={t.said[bottom]} isWild={isWild} /></div>
              </div>
              {!full && <div className="mt-1"><Seat s={t.seats[bottom]} idx={bottom} t={t} me={me} timer={timer} reacts={reactionsFor(st?.reactions, t.seats[bottom]?.name?.toLowerCase())} /></div>}
              <CardHand cards={t.seats[bottom]?.cards || Array.from({ length: t.seats[bottom]?.count || 0 }, () => null)}
                sel={sel} onToggle={flip} isWild={isWild} pickable={me >= 0 && (t.phase === 'playing' || t.mustReturn)} />
            </>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-4 gd-controls">{controls()}</div>
          <p className="text-sm mt-2 min-h-[1.25rem] text-amber-200 gd-msg">{msg}</p>
          </div>
        </TableFrame>
        <ReactionBar send={send} active={active} />
        <PointsBoard title="掼蛋豆子榜" rows={st?.board || []} me={st?.boardMe}>
          规则：两副牌 108 张，四人各 27 张，对面是队友。从 2 打起，打几就是级牌（比 A 大），红心级牌是「配」，能当任何牌（王除外）。
          牌型：单张、对子、三张、三带二、顺子（5 张）、三连对、钢板；炸弹 4–10 张，同花顺比 5 炸大、比 6 炸小，四个王最大。
          头游一方升级：队友二游升 3 级、三游升 2 级、末游升 1 级；在自己的 A 上赢（队友不是末游）就是整场赢。
          从第二局起末游进贡最大的牌，头游还一张 10 以下的；双下两人都进贡；有两个大王可以抗贡。出完牌的人没人管，由队友接风。
          每局按升的级数算豆子（底分 10），整场赢 +60。空位由机器人补上。
        </PointsBoard>
      </div>
    </div>
  );
}

function cardText(c) {
  const f = faceOf(c);
  return f === 'sj' ? '小王' : f === 'bj' ? '大王' : f.slice(-1) + f.slice(0, -1);
}
