import { useEffect, useRef, useState } from 'react';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { useTable, useCountdown, secondsLeft } from '../games/useTable.js';
import { alertsOn, setAlertsOn, unlock, useTurnAlert } from '../games/turnAlert.js';
import TableFrame, { useFullTable, RoomPicker, PointsBoard } from '../games/TableFrame.jsx';
import PlayingCard from '../games/PlayingCard.jsx';
import CardHand from '../games/CardHand.jsx';
import SeatBox, { Said } from './SeatBox.jsx';
import { ReactionBar, reactionsFor } from '../games/Reactions.jsx';
import './ddz.css';

const PHASE = { waiting: '等人开始', bidding: '叫地主中', playing: '对局中', result: '这局结束' };

export default function DdzView({ active }) {
  const { st, live, msg, hint, setHint, room, watch, send, sit, standUp } = useTable(active, { path: '/api/ddz', roomKey: 'ddzRoom', noHint: '没有管得上的牌，建议不出' });
  const timer = useCountdown(st, active && live);
  const t = st?.table;
  const me = t ? t.you : -1;
  const mySeat = me >= 0 ? t.seats[me] : null;
  const myCards = mySeat?.cards || [];
  const [sel, setSel] = useState(() => new Set());
  const { full, exit, enter, canEnter } = useFullTable(active && me >= 0);

  // 出了牌 / 新的一局：清掉选中的牌；提示回来了：选上建议的牌
  const handKey = (t?.round || 0) + ':' + myCards.length;
  useEffect(() => { setSel(new Set()); }, [handKey]);
  useEffect(() => { if (hint) { setSel(new Set(hint)); setHint(null); } }, [hint, setHint]);
  // 自己这边赢了撒点彩带
  const won = t?.phase === 'result' && me >= 0 && t.result?.deltas[me] > 0;
  const round = t?.round;
  useEffect(() => {
    if (won && !reduceMotion) confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 }, colors: CONFETTI_COLORS });
  }, [won, round]);

  // 点一张或者划过一串：每张都翻一下
  const flip = list => setSel(s => { const n = new Set(s); for (const c of list) { if (n.has(c)) n.delete(c); else n.add(c); } return n; });
  const deal = label => <button onClick={() => send({ type: 'start' })} className="gt-btn bg-amber-400 text-slate-900">{label}</button>;
  const bottom = me >= 0 ? me : 0, right = (bottom + 1) % 3, left = (bottom + 2) % 3;
  const myTurn = me >= 0 && t.turn === me;
  const leading = myTurn && t.phase === 'playing' && (t.trickBy === -1 || t.trickBy === me);
  // 轮到你了（自己在想，不是托管）：横幅 + 叮咚 / 震动；最后 5 秒变红、每秒滴一声；后台时标题闪
  const thinking = myTurn && !mySeat.auto && (t.phase === 'bidding' || t.phase === 'playing');
  const secs = secondsLeft(st);
  const hurry = thinking && secs != null && secs <= 5;
  useTurnAlert(thinking && live ? t.deadline : 0, secs);
  const [alerts, setAlerts] = useState(alertsOn);
  const toggleAlerts = () => { setAlertsOn(!alerts); setAlerts(!alerts); };
  // 三家都不叫：服务器重新洗牌发牌了，说一声（只在刚发生时）
  const [redealt, setRedealt] = useState(false);
  const seenRedeal = useRef(null);
  useEffect(() => {
    if (!t?.redealtAt || t.redealtAt === seenRedeal.current) return;
    const fresh = seenRedeal.current !== null || t.now - t.redealtAt < 4000; // opening the page long after: don't
    seenRedeal.current = t.redealtAt;
    if (!fresh) return;
    setRedealt(true);
    const id = setTimeout(() => setRedealt(false), 3500);
    return () => clearTimeout(id);
  }, [t?.redealtAt]); // eslint-disable-line react-hooks/exhaustive-deps -- only a new redeal matters
  // 叫地主 / 抢地主：一条横幅（还写着超时算不叫）；出牌：按钮旁边一个会动的 🔔 就够了，最后 5 秒倒计时变红
  const yourTurn = thinking && live && t.phase === 'bidding' && (
    <div className={'gt-yourturn' + (hurry ? ' hurry' : '')} role="status">
      <span>{hurry ? '⏰ 快没时间了' : '🔔 轮到你了'}{t.bidStage === 'call' ? '：叫地主吗？' : '：抢地主吗？'}</span>
      {secs != null && <b className="tabular-nums">{secs}s</b>}
      {hurry && <small>{t.bidStage === 'call' ? '超时算不叫' : '超时算不抢'}</small>}
    </div>
  );
  const bell = thinking && live && t.phase === 'playing' && (
    <span className={'gt-bell' + (hurry ? ' hurry' : '')} role="status" aria-label={(leading ? '轮到你先出' : '轮到你出牌') + (hurry ? '，快没时间了，超时自动帮你出' : '')}
      title={hurry ? '快没时间了，超时自动帮你出' : '轮到你出牌'}>{hurry ? '⏰' : '🔔'}</span>
  );
  const status = !t ? '连接中…' : !live ? '断线了，重连中…' : '桌 ' + room + ' · ' + PHASE[t.phase];
  const odds = t ? t.multiplier * 2 ** t.bombs : 1;
  const here = st?.lobby?.[room - 1];
  const seatedElsewhere = st?.seatedAt && st.seatedAt !== room;

  function controls() {
    if (!live || !t) return null;
    if (seatedElsewhere) return <button onClick={() => watch(st.seatedAt)} className="gt-btn bg-amber-400 text-slate-900">回到我坐的桌 {st.seatedAt}</button>;
    if (t.waiting) return <>
      {t.phase === 'waiting' ? deal('开始游戏') : <span className="text-sm text-emerald-100">{t.phase === 'result' ? '点「再来一局」就坐下' : '已经排上了，这局打完就坐下'}</span>}
      <button onClick={standUp} className="gt-btn bg-white/15 text-white ml-auto">不等了</button>
    </>;
    if (me < 0) {
      const taken = (here?.people.length || 0) >= 3;
      return <button onClick={sit} disabled={taken} className="gt-btn bg-amber-400 text-slate-900">{taken ? '这桌满了' : '🪑 坐下'}</button>;
    }
    const stand = <button onClick={standUp} className="gt-btn bg-white/15 text-white ml-auto">站起来</button>;
    const auto = mySeat.auto
      ? <button onClick={() => send({ type: 'auto', on: false })} className="gt-btn bg-fuchsia-500 text-white">取消托管</button>
      : t.phase === 'playing' || t.phase === 'bidding' ? <button onClick={() => send({ type: 'auto', on: true })} className="gt-btn bg-white/15 text-white">托管</button> : null;
    if (t.phase === 'waiting') return <>{deal('开始游戏')}<span className="text-sm text-emerald-100">空位由机器人补上</span>{stand}</>;
    // 再来一局 is in the result banner; full screen also puts it here, where it's always on screen
    if (t.phase === 'result') return full ? <>{deal('🔁 再来一局')}{stand}</> : stand;
    if (!myTurn || mySeat.auto) return <><span className="text-sm text-emerald-100">{t.phase === 'bidding' ? '等别人叫地主…' : '等别人出牌…'}</span>{auto}{stand}</>;
    if (t.phase === 'bidding') {
      const call = t.bidStage === 'call';
      return <>
        <button onClick={() => send({ type: 'bid', yes: true })} className="gt-btn bg-amber-400 text-slate-900">{call ? '叫地主' : '抢地主'}</button>
        <button onClick={() => send({ type: 'bid', yes: false })} className="gt-btn bg-white text-emerald-800">{call ? '不叫' : '不抢'}</button>
        <span className="text-sm text-amber-200">{timer}</span>{auto}{stand}
      </>;
    }
    return <>
      {bell}
      <button onClick={() => send({ type: 'pass' })} disabled={leading} className="gt-btn bg-white text-emerald-800">不出</button>
      <button onClick={() => send({ type: 'hint' })} className="gt-btn bg-sky-400 text-slate-900">提示</button>
      <button onClick={() => send({ type: 'play', cards: [...sel] })} disabled={!sel.size} className="gt-btn bg-amber-400 text-slate-900">出牌</button>
      <span className={'text-sm tabular-nums ' + (hurry ? 'gt-timer-hurry' : 'text-amber-200')}>{timer}</span>{auto}{stand}
    </>;
  }

  const result = t?.phase === 'result' && t.result;
  // 全屏时自己的座位框收起来，地主/豆子挪到顶上那行
  const meLine = full && mySeat && <span className="text-xs text-emerald-50/90">{t.landlord === me ? '👑 地主 · ' : t.landlord >= 0 ? '农民 · ' : ''}🫘 {mySeat.points?.toLocaleString()}</span>;
  return (
    <div>
      <RoomPicker st={st} room={room} watch={watch} phases={PHASE} />
      <div className="grid lg:grid-cols-3 gap-5">
        <TableFrame full={full} onExit={exit} className="lg:col-span-2">
          {/* 点牌桌任何地方都让浏览器允许提醒出声（浏览器要求先点过页面） */}
          <div style={{ display: 'contents' }} onPointerDownCapture={unlock}>
          <div className="gt-bar flex items-center justify-between gap-3 mb-3 text-sm">
            <span className="font-medium text-emerald-100">{status}</span>
            {meLine}
            {t && t.landlord >= 0 && <span className="font-bold text-amber-200">倍数 ×{odds}{t.bombs ? '（炸弹 ' + t.bombs + '）' : ''}</span>}
            <button onClick={toggleAlerts} aria-pressed={alerts} title={alerts ? '轮到你时响一声（点一下关掉）' : '轮到你时不响（点一下打开）'}
              className="text-xs rounded-full bg-white/15 px-2 py-1">{alerts ? '🔔 提醒' : '🔕 提醒'}</button>
            {canEnter && <button onClick={enter} className="text-xs rounded-full bg-white/15 px-2 py-1">⛶ 全屏</button>}
          </div>
          {redealt && <div className="dz-redeal" role="status">🔀 三家都不叫，重新洗牌发牌</div>}
          {t && (
            <>
              <div className="gt-mid">
                <div className="dz-top">
                  <div className="dz-side"><SeatBox s={t.seats[left]} idx={left} t={t} timer={timer} compact reacts={reactionsFor(st?.reactions, t.seats[left]?.name?.toLowerCase())} /><Said said={t.said[left]} /></div>
                  <div className="dz-center">
                    <div className="text-[11px] tracking-widest text-emerald-200 mb-1">底牌</div>
                    <div className="flex justify-center gap-1">{(t.bottom.length ? t.bottom : [null, null, null]).map((c, i) => <PlayingCard key={i + ':' + c} card={c} size="sm" />)}</div>
                  </div>
                  <div className="dz-side right"><SeatBox s={t.seats[right]} idx={right} t={t} timer={timer} compact reacts={reactionsFor(st?.reactions, t.seats[right]?.name?.toLowerCase())} /><Said said={t.said[right]} /></div>
                </div>
                {result && (
                  <div className="gt-result">
                    <div className="text-lg font-extrabold">{result.landlordWin ? '👑 地主赢了！' : '🌾 农民赢了！'}{result.spring ? (result.landlordWin ? ' · 春天 ×2' : ' · 反春 ×2') : ''}</div>
                    <div className="text-sm mt-1">倍数 ×{result.factor} · {result.names.map((n, k) => n + ' ' + (result.deltas[k] > 0 ? '+' : '') + result.deltas[k]).join(' · ')}</div>
                    {[left, right].filter(k => t.seats[k]?.cards?.length).map(k => (
                      <div key={k} className="flex items-center justify-center gap-2 mt-2 text-xs">
                        <span className="shrink-0 text-emerald-100">{result.names[k]} 剩</span>
                        <div className="dz-left"><Said said={{ cards: t.seats[k].cards }} /></div>
                      </div>
                    ))}
                    {live && (me >= 0 || t.waiting) && !seatedElsewhere && <div className="mt-3">{deal('🔁 再来一局')}</div>}
                  </div>
                )}
                <div className="mt-2 dz-mine"><Said said={t.said[bottom]} /></div>
              </div>
              {!full && <div className="mt-2"><SeatBox s={t.seats[bottom]} idx={bottom} t={t} timer={timer} reacts={reactionsFor(st?.reactions, t.seats[bottom]?.name?.toLowerCase())} /></div>}
              <CardHand cards={t.seats[bottom]?.cards || Array.from({ length: t.seats[bottom]?.count || 0 }, () => null)}
                sel={sel} onToggle={flip} pickable={me >= 0 && t.phase === 'playing'} />
            </>
          )}
          {yourTurn}
          <div className="flex flex-wrap items-center gap-2 mt-4 dz-controls">{controls()}</div>
          <p className="text-sm mt-2 min-h-[1.25rem] text-amber-200 dz-msg">{msg}</p>
          </div>
        </TableFrame>
        <ReactionBar send={send} active={active} />
        <PointsBoard title="斗地主豆子榜" rows={st?.board || []} me={st?.boardMe}>
          规则：一副牌 54 张，三人各 17 张，留 3 张底牌。叫地主 / 抢地主，每抢一次 ×2；炸弹、王炸各 ×2；春天 / 反春 ×2。底分 10 豆，地主一人对两家，输赢都算两份。
          叫地主超时算不叫（抢地主超时算不抢），三家都不叫就重新洗牌。提示：点一次给一种出法，再点换下一种；不拆牌、小的先给，带牌带最小的闲牌，炸弹放最后。
          空位由机器人补上；掉线或连着两次没出牌会自动托管。豆子只是好玩，和分账无关。
        </PointsBoard>
      </div>
    </div>
  );
}
