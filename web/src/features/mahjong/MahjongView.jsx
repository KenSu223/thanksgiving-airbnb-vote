import { Fragment, useEffect, useState } from 'react';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { useTable, useCountdown, secondsLeft } from '../games/useTable.js';
import { alertsOn, setAlertsOn, unlock, useTurnAlert } from '../games/turnAlert.js';
import TableFrame, { useFullTable, RoomPicker, PointsBoard } from '../games/TableFrame.jsx';
import MjTile from './MjTile.jsx';
import { ReactionBar, ReactBubbles, reactionsFor } from '../games/Reactions.jsx';
import './mahjong.css';

const PHASE = { waiting: '等人开始', swap: '换三张', lack: '定缺', playing: '打牌中', result: '这局结束' };
const SUIT = { m: '万', s: '条', p: '筒' };
const FROM = { 1: '上家', 2: '对家', 3: '下家' }; // 换三张：牌从谁那来（swapDir = 牌往后传几家）
const REL = { 1: '下家', 2: '对家', 3: '上家' };  // 座位相对你：下一个出牌的是下家
const sign = n => (n > 0 ? '+' : '') + n;

function Melds({ melds, size = 'sm' }) {
  if (!melds?.length) return null;
  return (
    <div className="mj-melds">
      {melds.map((m, i) => (
        <div key={i} className="mj-meld">
          {Array.from({ length: m.type === 'kong' ? 4 : 3 }, (_, k) => <MjTile key={k} kind={m.concealed && (k === 0 || k === 3) ? null : m.kind} size={size} />)}
        </div>
      ))}
    </div>
  );
}
function River({ tiles, lastHere, size = 'xs' }) {
  return <div className="mj-river">{tiles.map((k, i) => <MjTile key={i} kind={k} size={size} lit={lastHere && i === tiles.length - 1} />)}</div>;
}
// 一家亮在桌上的牌：碰/杠的，和打出去的（牌河），各带一个小标签，不会混在一起
function Piles({ melds, river, lastHere, mine }) {
  return <>
    {melds?.length ? <div className="mj-row"><span className="mj-cap">{mine ? '我碰杠' : '碰杠'}</span><Melds melds={melds} /></div> : null}
    {river?.length ? <div className="mj-row"><span className="mj-cap">{mine ? '我打的' : '打出'}</span><River tiles={river} lastHere={lastHere} /></div> : null}
  </>;
}
function WonTag({ won }) {
  if (!won) return null;
  return <span className="mj-won">第{won.order}胡 · {won.self ? '自摸' : '点炮'} {won.fan}番</span>;
}

function Opp({ s, idx, t, timer, className = '', reacts, rel }) {
  if (!s) return <div className={'gt-seat empty ' + className}>{rel ? rel + ' · ' : ''}空位</div>;
  const turn = t.turn === idx && t.phase === 'playing' && t.stage === 'act';
  return (
    <div className={'mj-opp ' + className}>
      <div data-react-to={s.name.toLowerCase()} className={'gt-seat' + (turn ? ' turn' : '') + (s.connected ? '' : ' away')}>
        <ReactBubbles list={reacts} />
        <div className="mj-head">
          {rel && <span className="mj-rel">{rel}</span>}
          <span className="font-bold truncate">{s.name}{s.me ? '（你）' : ''}</span>
          {t.dealer === idx && <span className="gt-role gold">庄</span>}
          {s.lack && <span className="mj-lack">缺{SUIT[s.lack]}</span>}
          <WonTag won={s.won} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs mt-1 text-emerald-50/90">
          <span>🀫 {s.count} 张{t.phase === 'swap' || t.phase === 'lack' ? (s.picked ? ' · 选好了' : ' · 在选') : ''}</span>
          {t.ledger[idx] ? <span className={t.ledger[idx] > 0 ? 'text-amber-200' : ''}>本局 {sign(t.ledger[idx])}</span> : null}
          {s.points != null && <span className="tabular-nums">🫘 {s.points.toLocaleString()}</span>}
        </div>
        <div className="mj-extra text-xs mt-0.5 min-h-[1rem] text-amber-200">
          {turn ? '出牌中' + (timer ? ' · ' + timer : '…') : t.said[idx] || (s.auto ? '托管中' : !s.connected ? '掉线了' : '')}
        </div>
      </div>
      {s.won && s.hand && <div className="mj-row"><span className="mj-cap">胡的牌</span><div className="mj-river">{s.hand.map((k, i) => <MjTile key={i} kind={k} size="xs" />)}<MjTile kind={s.won.tile} size="xs" lit /></div></div>}
      <Piles melds={s.melds} river={s.river} lastHere={t.last?.seat === idx && t.phase === 'playing'} />
    </div>
  );
}

export default function MahjongView({ active }) {
  const { st, live, msg, flash, room, watch, send, sit, standUp } = useTable(active, { path: '/api/mahjong', roomKey: 'mjRoom' });
  const timer = useCountdown(st, active && live);
  const t = st?.table;
  const me = t ? t.you : -1;
  const mySeat = me >= 0 ? t.seats[me] : null;
  const hand = mySeat?.hand || [];
  const [sel, setSel] = useState(() => new Set()); // indexes into the hand
  const { full, exit, enter, canEnter } = useFullTable(active && me >= 0);

  const handKey = (t?.round || 0) + ':' + hand.join() + ':' + t?.phase + ':' + t?.stage;
  useEffect(() => { setSel(new Set()); }, [handKey]);
  const won = t?.phase === 'result' && me >= 0 && t.result?.deltas[me] > 0;
  const round = t?.round;
  useEffect(() => {
    if (won && !reduceMotion) confetti({ particleCount: 110, spread: 90, origin: { y: 0.6 }, colors: CONFETTI_COLORS });
  }, [won, round]);
  // 自己胡了也撒一下
  const myWin = mySeat?.won?.order;
  useEffect(() => {
    if (myWin && !reduceMotion) confetti({ particleCount: 80, spread: 70, origin: { y: 0.7 }, colors: CONFETTI_COLORS });
  }, [myWin]);

  const bottom = me >= 0 ? me : 0, right = (bottom + 1) % 4, top = (bottom + 2) % 4, left = (bottom + 3) % 4;
  const rel = d => (me >= 0 ? REL[d] : null);
  const here = st?.lobby?.[room - 1];
  const seatedElsewhere = st?.seatedAt && st.seatedAt !== room;
  const opts = t?.options, claim = t?.claim;
  const name = k => t.seats[k]?.name || t.result?.names[k] || '空位';
  const status = !t ? '连接中…' : !live ? '断线了，重连中…' : '桌 ' + room + ' · ' + PHASE[t.phase] + (t.phase === 'playing' ? ' · 剩 ' + t.wallLeft + ' 张' : '');
  const deal = label => <button onClick={() => send({ type: 'start' })} className="gt-btn bg-amber-400 text-slate-900">{label}</button>;

  // 点牌：换三张时最多选三张同一门；打牌时点一下选中，再点一下就打出去
  function tap(i) {
    if (t.phase === 'swap' && !mySeat.swap) {
      setSel(s => {
        const n = new Set([...s].filter(j => hand[j]?.[0] === hand[i][0]));
        if (n.has(i)) n.delete(i); else if (n.size < 3) n.add(i);
        return n;
      });
    } else if (opts) {
      if (sel.has(i)) return discard(i);
      setSel(new Set([i]));
    }
  }
  function discard(i) {
    const k = hand[i];
    if (opts.mustLack && k[0] !== mySeat.lack) return flash('先把缺的' + SUIT[mySeat.lack] + '打完');
    send({ type: 'discard', tile: k });
  }
  const swapTiles = [...sel].map(i => hand[i]);
  const suitCount = s => hand.filter(k => k[0] === s).length;
  const lackPick = mySeat && ['m', 's', 'p'].reduce((a, s) => (suitCount(s) < suitCount(a) ? s : a), 'm');

  // ---- 这一刻要你做决定吗？换三张 / 定缺 / 出牌 / 碰杠胡：横幅说清楚做什么、剩几秒、超时会怎样 ----
  const acting = !!mySeat && live && !mySeat.auto && !mySeat.won && !seatedElsewhere && (
    (t.phase === 'swap' && !mySeat.swap) || (t.phase === 'lack' && !mySeat.lack) || (t.phase === 'playing' && (!!claim || !!opts)));
  const secs = secondsLeft(st);
  const hurry = acting && secs != null && secs <= 5;
  useTurnAlert(acting ? t.phase + ':' + t.stage + ':' + t.deadline : 0, secs);
  const [alerts, setAlerts] = useState(alertsOn);
  const toggleAlerts = () => { setAlertsOn(!alerts); setAlerts(!alerts); };
  const claimTile = claim && t.claimOn ? t.claimOn.kind : null;
  let ask = null;
  if (acting) {
    if (t.phase === 'swap') ask = { head: '🔄 换三张：选同一门的 3 张换出去', sub: '选好点「换这三张」· 往哪家传，大家选完随机定', soon: '超时自动帮你选' };
    else if (t.phase === 'lack') ask = { head: '🎯 定缺：选一门不要', sub: `这门的牌要先打完，手里还有就不能胡 · 建议缺${SUIT[lackPick]}（只有 ${suitCount(lackPick)} 张）`, soon: '超时自动帮你定' };
    else if (claim) ask = {
      head: <>🀄 {name(t.claimOn.from)} {t.claimOn.rob ? '补杠' : '打出'} <MjTile kind={claimTile} size="sm" inline lit />，你可以{[claim.hu && '胡', claim.kong && '杠', claim.pong && '碰'].filter(Boolean).join(' / ')}</>,
      sub: '不要就点「过」· 手里一样的牌已经抬起来了', soon: '超时由电脑替你决定（能胡一定胡）' };
    else ask = { head: opts.hu ? '🀄 轮到你：可以自摸！' : '🔔 轮到你出牌', sub: opts.mustLack ? `先打缺的${SUIT[mySeat.lack]}（标了「缺」的牌）` : '点一张，再点一下打出', soon: '超时自动帮你打一张' };
  }
  const banner = ask && (
    <div className={'gt-yourturn' + (hurry ? ' hurry' : '')} role="status">
      <span>{hurry ? '⏰ 快没时间了 · ' : ''}{ask.head}</span>
      {secs != null && <b className="tabular-nums">{secs}s</b>}
      <small>{hurry ? ask.soon : ask.sub}</small>
    </div>
  );

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
      : t.phase !== 'waiting' && t.phase !== 'result' && !mySeat.won ? <button onClick={() => send({ type: 'auto', on: true })} className="gt-btn bg-white/15 text-white">托管</button> : null;
    if (t.phase === 'waiting') return <>{deal('开始游戏')}<span className="text-sm text-emerald-100">空位由机器人补上</span>{stand}</>;
    // 再来一局 is in the result banner; full screen also puts it here, where it's always on screen
    if (t.phase === 'result') return full ? <>{deal('🔁 再来一局')}{stand}</> : stand;
    if (t.phase === 'swap') {
      if (mySeat.swap) return <><span className="text-sm text-emerald-100">选好了，等别人…</span>{auto}{stand}</>;
      return <><button onClick={() => send({ type: 'swap', tiles: swapTiles })} disabled={swapTiles.length !== 3} className="gt-btn bg-amber-400 text-slate-900">换这三张{swapTiles.length !== 3 ? `（已选 ${swapTiles.length}）` : ''}</button>{auto}{stand}</>;
    }
    if (t.phase === 'lack') {
      if (mySeat.lack) return <><span className="text-sm text-emerald-100">缺{SUIT[mySeat.lack]}，等别人定缺…</span>{auto}{stand}</>;
      return <>{['m', 's', 'p'].map(s => (
        <button key={s} onClick={() => send({ type: 'lack', suit: s })} className={'gt-btn ' + (s === lackPick ? 'bg-amber-400 text-slate-900' : 'bg-white text-emerald-800')}>缺{SUIT[s]}{s === lackPick ? '（建议）' : ''}</button>
      ))}{auto}{stand}</>;
    }
    if (claim) return <>
      {claim.hu && <button onClick={() => send({ type: 'claim', choice: 'hu' })} className="gt-btn bg-rose-500 text-white">胡！<MjTile kind={claimTile} size="xs" inline /></button>}
      {claim.kong && <button onClick={() => send({ type: 'claim', choice: 'kong' })} className="gt-btn bg-amber-400 text-slate-900">杠 <MjTile kind={claimTile} size="xs" inline /></button>}
      {claim.pong && <button onClick={() => send({ type: 'claim', choice: 'pong' })} className="gt-btn bg-amber-400 text-slate-900">碰 <MjTile kind={claimTile} size="xs" inline /></button>}
      <button onClick={() => send({ type: 'claim', choice: 'pass' })} className="gt-btn bg-white text-emerald-800">过</button>{stand}
    </>;
    if (mySeat.won) return <><span className="text-sm text-emerald-100">你已经胡了，看他们血战到底</span>{stand}</>;
    if (opts) return <>
      {opts.hu && <button onClick={() => send({ type: 'hu' })} className="gt-btn bg-rose-500 text-white">自摸！</button>}
      {opts.kongs.map(k => <button key={k.kind} onClick={() => send({ type: 'kong', tile: k.kind })} className="gt-btn bg-amber-400 text-slate-900">杠 <MjTile kind={k.kind} size="xs" inline /></button>)}
      <button onClick={() => sel.size && discard([...sel][0])} disabled={!sel.size} className="gt-btn bg-amber-400 text-slate-900">出牌</button>
      {auto}{stand}
    </>;
    return <><span className="text-sm text-emerald-100">等别人…</span>{auto}{stand}</>;
  }

  const result = t?.phase === 'result' && t.result;
  // 结算：先说你自己怎么样了
  let mine = null;
  if (result && me >= 0) {
    const w = result.wins.find(x => x.seat === me);
    const hit = result.wins.filter(x => !x.self && x.from === me);
    const check = result.check.find(c => c.seat === me);
    mine = (
      <div className="mj-you">
        你本局 <b className={result.deltas[me] > 0 ? 'text-amber-300' : result.deltas[me] < 0 ? 'text-rose-300' : ''}>{sign(result.deltas[me])}</b> 豆
        {w && <> · 第{w.order}个胡：{w.self ? '自摸' : '胡 ' + name(w.from) + ' 打的'} <MjTile kind={w.tile} size="xs" inline /> {w.fan}番（{w.names.join('·')}）</>}
        {hit.map(x => <Fragment key={x.seat}> · {name(x.seat)} 胡了你打的 <MjTile kind={x.tile} size="xs" inline />（{x.fan}番）</Fragment>)}
        {!w && check && <> · {check.hua ? '你是花猪，赔每个不是花猪的人' : check.ready ? '你听牌了' : '你没听牌，赔听牌的人'}</>}
      </div>
    );
  }
  const lastTile = t?.claimOn || (t?.phase === 'playing' && t.last);
  const meLine = full && mySeat && <span className="text-xs text-emerald-50/90">{mySeat.lack ? '缺' + SUIT[mySeat.lack] + ' · ' : ''}{t.ledger[me] ? '本局 ' + sign(t.ledger[me]) + ' · ' : ''}🫘 {mySeat.points?.toLocaleString()}</span>;
  // 手牌上的记号：换三张刚拿到的三张（定缺和第一次出牌前）标「新」；有人打出能碰/杠/胡的牌时，手里一样的抬起来
  const fresh = new Set();
  if (mySeat?.received && (t.phase === 'lack' || (t.phase === 'playing' && !mySeat.river.length && !mySeat.melds.length))) {
    const need = [...mySeat.received];
    hand.forEach((k, i) => { const j = need.indexOf(k); if (j >= 0) { fresh.add(i); need.splice(j, 1); } });
  }
  const minePiles = mySeat && (mySeat.melds.length || mySeat.river.length) ? <Piles mine melds={mySeat.melds} river={mySeat.river} lastHere={t.last?.seat === me && t.phase === 'playing'} /> : null;
  const seat = (k, d, cls) => <Opp key={k} s={t.seats[k]} idx={k} t={t} timer={timer} className={cls} rel={rel(d)} reacts={reactionsFor(st?.reactions, t.seats[k]?.name?.toLowerCase())} />;
  const center = t && (
    <div className={'mj-center' + (result ? ' wide' : '')}>
      {lastTile && !result && !full && (
        <div className="flex items-center gap-2">
          <MjTile kind={lastTile.kind} size="lg" lit />
          <span className="text-sm text-emerald-100">{name(lastTile.seat ?? lastTile.from)} {t.claimOn?.rob ? '补杠' : '打出'}</span>
        </div>
      )}
      {t.phase === 'lack' && mySeat?.received && <div className="mj-note">换三张：从{FROM[t.swapDir]}拿到 {mySeat.received.map((k, i) => <MjTile key={i} kind={k} size="xs" inline className="mx-px" />)}（手里标了「新」）</div>}
      {result && (
        <div className="gt-result w-full">
          <div className="text-lg font-extrabold">{result.wins.length ? '🀄 这局结束' : '流局'}{won ? ' · 你赢了！' : ''}</div>
          {mine}
          {result.wins.map(w => (
            <div key={w.seat} className="text-sm mt-1">第{w.order}胡 {name(w.seat)} {w.self ? '自摸' : '胡 ' + name(w.from) + ' 的'} <MjTile kind={w.tile} size="xs" inline /> {w.fan}番（{w.names.join('·')}）</div>
          ))}
          {result.check.map(c => (
            <div key={c.seat} className="text-xs mt-1 text-emerald-100">{name(c.seat)}：{c.hua ? '花猪，赔每个不是花猪的人' : c.ready ? '听牌 ' + c.fan + '番' : '没听牌，赔听牌的人'}</div>
          ))}
          <div className="text-sm mt-2">{result.names.map((n, k) => n + ' ' + sign(result.deltas[k])).join(' · ')}</div>
          {live && (me >= 0 || t.waiting) && !seatedElsewhere && <div className="mt-3">{deal('🔁 再来一局')}</div>}
        </div>
      )}
    </div>
  );
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
            {t && t.phase !== 'waiting' && <span className="text-xs text-emerald-100">庄：{name(t.dealer)}</span>}
            {full && lastTile && !result && <span className="flex items-center gap-1 text-xs text-emerald-100">{name(lastTile.seat ?? lastTile.from)} {t.claimOn?.rob ? '补杠' : '打出'} <MjTile kind={lastTile.kind} size="sm" lit /></span>}
            <button onClick={toggleAlerts} aria-pressed={alerts} title={alerts ? '轮到你时响一声（点一下关掉）' : '轮到你时不响（点一下打开）'}
              className="text-xs rounded-full bg-white/15 px-2 py-1">{alerts ? '🔔 提醒' : '🔕 提醒'}</button>
            {canEnter && <button onClick={enter} className="text-xs rounded-full bg-white/15 px-2 py-1">⛶ 全屏</button>}
          </div>
          {t && (
            <>
              <div className="gt-mid">
                {/* 全屏（手机横着）时三家排成一行：上家、对家、下家；电脑上像一张桌子：对家在上，上家左，下家右 */}
                {full ? (
                  <><div className="mj-grid">{seat(left, 3)}{seat(top, 2)}{seat(right, 1)}</div>{center}</>
                ) : (
                  <div className="mj-table">{seat(left, 3, 'mj-l')}{seat(top, 2, 'mj-t')}{seat(right, 1, 'mj-r')}{center}</div>
                )}
                {!full && minePiles && <div className="mt-2 flex flex-col gap-1">{minePiles}</div>}
              </div>
              {/* 全屏时中间那块会滚动，自己碰杠的、打过的牌放在手牌正上方，一直看得见 */}
              {full && minePiles && <div className="mj-mine-strip">{minePiles}</div>}
              {!full && mySeat && (
                <div className="mt-2 text-sm flex flex-wrap items-center gap-2">
                  <span className="font-bold">{mySeat.name}（你）</span>
                  {t.dealer === me && <span className="gt-role gold">庄</span>}
                  {mySeat.lack && <span className="mj-lack">缺{SUIT[mySeat.lack]}</span>}
                  <WonTag won={mySeat.won} />
                  {t.ledger[me] ? <span className="text-amber-200">本局 {sign(t.ledger[me])}</span> : null}
                  <span className="ml-auto tabular-nums">🫘 {mySeat.points?.toLocaleString()}</span>
                </div>
              )}
              {mySeat ? (
                <div className="mj-hand">
                  {hand.map((k, i) => {
                    const drawn = mySeat.drawn && i === hand.lastIndexOf(mySeat.drawn) && opts;
                    const pickable = (t.phase === 'swap' && !mySeat.swap) || !!opts;
                    const lackTile = mySeat.lack && k[0] === mySeat.lack && t.phase === 'playing';
                    const cls = [drawn && 'drawn', lackTile && 'lackt', fresh.has(i) && 'fresh', claimTile === k && 'match'].filter(Boolean).join(' ');
                    return (
                      <Fragment key={i}>
                        {i > 0 && hand[i - 1][0] !== k[0] && !drawn && <span className="mj-gap" aria-hidden="true" />}
                        <MjTile kind={k} selected={sel.has(i)} onClick={pickable ? () => tap(i) : undefined} className={cls} />
                      </Fragment>
                    );
                  })}
                  {mySeat.won && <MjTile kind={mySeat.won.tile} className="drawn" lit />}
                </div>
              ) : t.seats[bottom] && <Opp s={t.seats[bottom]} idx={bottom} t={t} timer={timer} reacts={reactionsFor(st?.reactions, t.seats[bottom]?.name?.toLowerCase())} />}
            </>
          )}
          {banner}
          <div className="flex flex-wrap items-center gap-2 mt-4 mj-controls">{controls()}</div>
          <p className="text-sm mt-2 min-h-[1.25rem] text-amber-200 mj-msg">{msg}</p>
          </div>
        </TableFrame>
        <ReactionBar send={send} active={active} />
        <PointsBoard title="川麻豆子榜" rows={st?.board || []}>
          规则：血战到底。108 张（万条筒），开局换三张、定缺；只能碰、杠，不能吃；缺的那门要先打完，手里还有就不能胡。
          一炮可以多响；没胡的放过一张能胡的牌，到自己下次摸牌前都不能胡别人打的（过水不胡）。胡了的人退出，剩下的接着打，直到三家胡完或者摸完牌。
          番：平胡 0、对对胡 1、清一色 2、七对 2、带幺九 2、将对 +2、金钩钓 +1、每个根 +1、杠上花 / 杠上炮 / 抢杠 / 海底 +1，不封顶。
          底分 5 豆 × 2^番；自摸每家多给一底。杠：直杠点杠的人给 2 底，暗杠每家 2 底，补杠每家 1 底。摸完牌时花猪赔每家 16 底，没听牌的赔听牌的人。
        </PointsBoard>
      </div>
    </div>
  );
}
