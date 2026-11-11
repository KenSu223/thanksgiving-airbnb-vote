import { Fragment, useEffect, useState } from 'react';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { useTable, useCountdown, secondsLeft } from '../games/useTable.js';
import { unlock, useTurnAlert } from '../games/turnAlert.js';
import { unlock as unlockSfx, play, say, useTableFx, tileName } from '../games/tableSfx.js';
import SoundToggles from '../games/SoundToggles.jsx';
import { useCallouts } from '../games/Callouts.jsx';
import TableFrame, { useFullTable, RoomPicker, PointsBoard, SavedNote } from '../games/TableFrame.jsx';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import MjTile from './MjTile.jsx';
import { ReactionBar, ReactBubbles, reactionsFor } from '../games/Reactions.jsx';
import './mahjong.css';

const PHASE = { waiting: '等人开始', swap: '换三张', lack: '定缺', playing: '打牌中', result: '这局结束' };
const SUIT = { m: '万', s: '条', p: '筒' };
const FROM = { 1: '上家', 2: '对家', 3: '下家' }; // 换三张：牌从谁那来（swapDir = 牌往后传几家）
const REL = { 1: '下家', 2: '对家', 3: '上家' };  // 座位相对你：下一个出牌的是下家
const sign = n => (n > 0 ? '+' : '') + n;

// mark: the tile picked in your hand — the same tile lights up blue wherever it lies on the table (how many are gone?)
function Melds({ melds, size = 'sm', mark }) {
  if (!melds?.length) return null;
  return (
    <div className="mj-melds">
      {melds.map((m, i) => (
        <div key={i} className="mj-meld">
          {Array.from({ length: m.type === 'kong' ? 4 : 3 }, (_, k) => <MjTile key={k} kind={m.concealed && (k === 0 || k === 3) ? null : m.kind} size={size} className={mark && m.kind === mark ? 'same' : ''} />)}
        </div>
      ))}
    </div>
  );
}
// 牌河：这一家打出去的牌，按打的先后一张张摆在自己面前。刚打的那张亮金边、头上一个跳动的小箭头，
// 拍到桌上带点灰（新牌是新挂上去的，动画只播这一下）
function River({ tiles, lastHere, mark }) {
  return (
    <div className="mj-river">
      {tiles.map((k, i) => { const last = lastHere && i === tiles.length - 1; return <MjTile key={i} kind={k} size="rv" slam={last} className={(last ? 'last' : '') + (mark === k ? ' same' : '')} />; })}
    </div>
  );
}
// 听牌提示：胡哪几张、各几番、还剩几张（别人手里的看不到，按桌上看得见的算）
function TingBar({ head, waits }) {
  const total = waits.reduce((a, w) => a + w.left, 0);
  return (
    <div className="mj-ting" role="status">
      <span className="mj-ting-head">{head}</span>
      {waits.map(w => (
        <span key={w.kind} className={'mj-ting-item' + (w.left ? '' : ' dead')}>
          <MjTile kind={w.kind} size="xs" inline />
          <span>{w.fan ? w.fan + '番' : '平胡'} · 剩{w.left}</span>
        </span>
      ))}
      <span className="mj-ting-total">共剩 {total} 张</span>
    </div>
  );
}
function WonTag({ won }) {
  if (!won) return null;
  return <span className="mj-won">第{won.order}胡 · {won.self ? '自摸' : '点炮'} {won.fan}番</span>;
}

// 一个座位的名牌：谁、庄、缺哪门、手里几张、这局输赢、豆子、在干什么（表情也落在这个框上）
function Seat({ s, idx, t, timer, reacts, rel }) {
  if (!s) return <div className="gt-seat empty">{rel ? rel + ' · ' : ''}空位</div>;
  const turn = t.turn === idx && t.phase === 'playing' && t.stage === 'act';
  const doing = turn ? '出牌中' + (timer ? ' · ' + timer : '…') : t.said[idx] || (s.auto ? '托管中' : !s.connected ? '掉线了' : '');
  return (
    <div data-react-to={s.name.toLowerCase()} className={'gt-seat mj-seat' + (turn ? ' turn' : '') + (s.connected ? '' : ' away')}>
      <ReactBubbles list={reacts} />
      <div className="mj-head">
        {rel && <span className="mj-rel">{rel}</span>}
        <span className="font-bold truncate">{s.name}{s.me ? '（你）' : ''}</span>
        {t.dealer === idx && <span className="gt-role gold">庄</span>}
        {s.lack && <span className="mj-lack">缺{SUIT[s.lack]}</span>}
        <WonTag won={s.won} />
      </div>
      <div className="mj-stats">
        <span>🀫 {s.count} 张{t.phase === 'swap' || t.phase === 'lack' ? (s.picked ? ' · 选好了' : ' · 在选') : ''}</span>
        {t.ledger[idx] ? <span className={t.ledger[idx] > 0 ? 'text-amber-200' : ''}>本局 {sign(t.ledger[idx])}</span> : null}
        {s.points != null && <span className="tabular-nums">🫘 {s.points.toLocaleString()}</span>}
        {doing && <span className="mj-doing">{doing}</span>}
      </div>
    </div>
  );
}

// 桌子正中：还剩几张牌，四个小箭头指着四家，轮到谁谁那个亮
function Plate({ t, at }) {
  const cur = t.phase === 'playing' && t.stage === 'act' ? t.turn : -1;
  return (
    <div className="mj-plate" aria-label={t.phase === 'playing' ? '牌墙还剩 ' + t.wallLeft + ' 张' : PHASE[t.phase]}>
      {['t', 'l', 'r', 'b'].map(p => <i key={p} className={'mj-dir ' + p + (at[p] === cur ? ' on' : '')} />)}
      {t.phase === 'playing' ? <><b>{t.wallLeft}</b><small>剩余</small></> : <small className="big">{PHASE[t.phase]}</small>}
    </div>
  );
}

export default function MahjongView({ active }) {
  const { st, live, msg, flash, room, watch, send, sit, standUp } = useTable(active, { path: '/api/mahjong', roomKey: 'mjRoom' });
  const confirm = useConfirm();
  const dropParked = async () => { if (await confirm({ title: '不打这把了？', message: '上次存着的这把就扔掉了，不算输赢。', confirmText: '不打了', danger: true })) send({ type: 'end' }); };
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

  // 声音和喊牌：打一张「啪」一声、念出是什么牌；碰 / 杠 / 胡在那一家面前跳出大字，也喊出来
  const [calls, shout] = useCallouts();
  useTableFx(t?.fx, room, active, (e, after) => {
    if (e.k === 'deal') play('shuffle', after);
    else if (e.k === 'swap') play('swap', after);
    else if (e.k === 'discard') { play('tile', after); say(tileName(e.tile), after); }
    else if (e.k === 'pong') { play('pong', after); say('碰', after); shout('碰', { seat: e.seat, cls: 'pong' }); }
    else if (e.k === 'kong') { play('kong', after); say('杠', after); shout(e.how, { seat: e.seat, cls: 'kong' }); }
    else if (e.k === 'hu') { play('hu', after); say(e.self ? '自摸' : '胡了', after); shout(e.self ? '自摸' : '胡', { seat: e.seat, cls: 'hu' }); }
    else if (e.k === 'end') { const d = me >= 0 ? t.result?.deltas[me] || 0 : 0; play(d > 0 ? 'win' : d < 0 ? 'lose' : 'draw', after + 0.7); }
  });

  const bottom = me >= 0 ? me : 0, right = (bottom + 1) % 4, top = (bottom + 2) % 4, left = (bottom + 3) % 4;
  const rel = d => (me >= 0 ? REL[d] : null);
  const here = st?.lobby?.[room - 1];
  const seatedElsewhere = st?.seatedAt && st.seatedAt !== room;
  const opts = t?.options, claim = t?.claim;
  const name = k => t.seats[k]?.name || t.result?.names[k] || '空位';
  const status = !t ? '连接中…' : !live ? '断线了，重连中…' : '桌 ' + room + ' · ' + PHASE[t.phase];
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

  // ---- 这一刻要你做决定吗？换三张 / 定缺 / 碰杠胡：横幅说清楚做什么、剩几秒、超时会怎样；
  //      轮到你出牌：按钮旁边一个会动的 🔔 就够了（最后 5 秒变 ⏰、倒计时变红）----
  const acting = !!mySeat && live && !mySeat.auto && !mySeat.won && !seatedElsewhere && (
    (t.phase === 'swap' && !mySeat.swap) || (t.phase === 'lack' && !mySeat.lack) || (t.phase === 'playing' && (!!claim || !!opts)));
  const secs = secondsLeft(st);
  const hurry = acting && secs != null && secs <= 5;
  useTurnAlert(acting ? t.phase + ':' + t.stage + ':' + t.deadline : 0, secs);
  const claimTile = claim && t.claimOn ? t.claimOn.kind : null;
  let ask = null;
  if (acting) {
    if (t.phase === 'swap') ask = { head: '🔄 换三张：选同一门的 3 张换出去', sub: '选好点「换这三张」· 往哪家传，大家选完随机定', soon: '超时自动帮你选' };
    else if (t.phase === 'lack') ask = { head: '🎯 定缺：选一门不要', sub: `这门的牌要先打完，手里还有就不能胡 · 建议缺${SUIT[lackPick]}（只有 ${suitCount(lackPick)} 张）`, soon: '超时自动帮你定' };
    // 碰杠胡：提示小一点（一行），按钮在下面放大、会闪
    else if (claim) ask = {
      compact: true,
      head: <>{name(t.claimOn.from)} {t.claimOn.rob ? '补杠' : '打出'} <MjTile kind={claimTile} size="xs" inline lit />，可以{[claim.hu && '胡', claim.kong && '杠', claim.pong && '碰'].filter(Boolean).join(' / ')}</>,
      soon: '超时由电脑替你决定（能胡一定胡）' };
  }
  const bell = acting && !ask && (
    <span className={'gt-bell' + (hurry ? ' hurry' : '')} role="status" aria-label={'轮到你出牌' + (hurry ? '，快没时间了，超时自动帮你打一张' : '')}
      title={hurry ? '快没时间了，超时自动帮你打一张' : '轮到你出牌'}>{hurry ? '⏰' : '🔔'}</span>
  );
  const clock = <span className={'text-sm tabular-nums ' + (hurry ? 'gt-timer-hurry' : 'text-amber-200')}>{timer}</span>;
  const banner = ask && (
    <div className={'gt-yourturn' + (ask.compact ? ' compact' : '') + (hurry ? ' hurry' : '')} role="status">
      <span>{hurry ? '⏰ 快没时间了 · ' : ''}{ask.head}</span>
      {secs != null && <b className="tabular-nums">{secs}s</b>}
      {(hurry || ask.sub) && <small>{hurry ? ask.soon : ask.sub}</small>}
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
    // 存着上次一个人打的那把：接着打，或者扔掉
    if (t.phase === 'waiting' && t.parked) return <>{deal('▶ 接着打')}<button onClick={dropParked} className="gt-btn bg-white/15 text-white">不打这把了</button>{stand}</>;
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
      {claim.hu && <button onClick={() => send({ type: 'claim', choice: 'hu' })} className="gt-btn mj-claim hu bg-rose-500 text-white">胡！<MjTile kind={claimTile} size="sm" inline /></button>}
      {claim.kong && <button onClick={() => send({ type: 'claim', choice: 'kong' })} className="gt-btn mj-claim bg-amber-400 text-slate-900">杠 <MjTile kind={claimTile} size="sm" inline /></button>}
      {claim.pong && <button onClick={() => send({ type: 'claim', choice: 'pong' })} className="gt-btn mj-claim bg-amber-400 text-slate-900">碰 <MjTile kind={claimTile} size="sm" inline /></button>}
      <button onClick={() => send({ type: 'claim', choice: 'pass' })} className="gt-btn bg-white text-emerald-800">过</button>{stand}
    </>;
    if (mySeat.won) return <><span className="text-sm text-emerald-100">你已经胡了，看他们血战到底</span>{stand}</>;
    if (opts) return <>
      {bell}
      {opts.hu && <button onClick={() => send({ type: 'hu' })} className="gt-btn bg-rose-500 text-white">自摸！</button>}
      {opts.kongs.map(k => <button key={k.kind} onClick={() => send({ type: 'kong', tile: k.kind })} className="gt-btn bg-amber-400 text-slate-900">杠 <MjTile kind={k.kind} size="xs" inline /></button>)}
      <button onClick={() => sel.size && discard([...sel][0])} disabled={!sel.size} className="gt-btn bg-amber-400 text-slate-900">出牌</button>
      {opts.mustLack && <span className="text-sm text-amber-200">先打缺的{SUIT[mySeat.lack]}</span>}
      {clock}{auto}{stand}
    </>;
    return <><span className="text-sm text-emerald-100">等别人…</span>{auto}{stand}</>;
  }

  const result = t?.phase === 'result' && t.result;
  // 结算：一人一行——谁、怎么样（第几胡·自摸/胡谁的·几番，点炮几次，听牌/没听/花猪）、输赢多少；你那行高亮
  const scoreRows = result && [0, 1, 2, 3].map(k => {
    const w = result.wins.find(x => x.seat === k);
    const fed = result.wins.filter(x => !x.self && x.from === k).length;
    const c = !w && result.check.find(x => x.seat === k);
    return { k, delta: result.deltas[k], tags: [
      w && <span key="w" className="mj-tag win" title={w.names.join('·')}>第{w.order}胡 · {w.self ? '自摸' : '胡' + name(w.from)} <MjTile kind={w.tile} size="xs" inline /> {w.fan}番</span>,
      fed > 0 && <span key="f" className="mj-tag">点炮{fed > 1 ? ' ×' + fed : ''}</span>,
      c && <span key="c" className={'mj-tag' + (c.hua || !c.ready ? ' bad' : '')}>{c.hua ? '花猪' : c.ready ? '听牌' : '没听'}</span>,
    ].filter(Boolean) };
  }).sort((a, b) => b.delta - a.delta);
  // 刚打出来的那张（等着别人碰杠胡的时候也是它）：在打的那一家面前放大跳出来一下，牌河里那张亮着，桌子中间也写着
  const lastTile = t?.claimOn || (t?.phase === 'playing' && t.last);
  const lastSeat = lastTile ? lastTile.seat ?? lastTile.from : -1;
  const discardKey = lastTile ? lastSeat + ':' + lastTile.kind + ':' + t.wallLeft : '';
  const meLine = full && mySeat && <span className="text-xs text-emerald-50/90">{mySeat.lack ? '缺' + SUIT[mySeat.lack] + ' · ' : ''}{t.ledger[me] ? '本局 ' + sign(t.ledger[me]) + ' · ' : ''}🫘 {mySeat.points?.toLocaleString()}</span>;
  // 手牌上的记号：换三张刚拿到的三张（定缺和第一次出牌前）标「新」；有人打出能碰/杠/胡的牌时，手里一样的抬起来
  const fresh = new Set();
  if (mySeat?.received && (t.phase === 'lack' || (t.phase === 'playing' && !mySeat.river.length && !mySeat.melds.length))) {
    const need = [...mySeat.received];
    hand.forEach((k, i) => { const j = need.indexOf(k); if (j >= 0) { fresh.add(i); need.splice(j, 1); } });
  }
  // 手牌顺序：服务器排好了（万条筒、从小到大，缺的那门在最后）；刚摸的那张像真打麻将一样单独放最右边
  const drawnAt = mySeat?.drawn && opts ? hand.lastIndexOf(mySeat.drawn) : -1;
  const order = hand.map((_, i) => i).filter(i => i !== drawnAt).concat(drawnAt >= 0 ? [drawnAt] : []);
  // 听牌提示：手里 13 张时一直显示胡什么；轮到你出牌时，打了就能听的牌标「听」，选中那张就显示打了胡什么
  const ting = t?.ting;
  const tingIf = opts && ting?.ifDiscard;
  const selKind = sel.size === 1 && t?.phase === 'playing' ? hand[[...sel][0]] : null;
  const tingBar = !mySeat || mySeat.won ? null
    : ting?.now ? <TingBar head="听牌：胡" waits={ting.now} />
    : tingIf && selKind && tingIf[selKind] ? <TingBar head={<>打 <MjTile kind={selKind} size="xs" inline /> 就听：胡</>} waits={tingIf[selKind]} />
    : tingIf ? <div className="mj-ting" role="status"><span className="mj-ting-head">打标「听」的牌就听牌了，点一下看胡什么</span></div>
    : null;

  // 桌子的一边：这一家的名牌、碰杠的牌、（胡了或者这局结束后）亮出来的手牌，和面前的牌河。
  // 你自己那边只有牌河——名牌、碰杠的牌和手牌在桌子下面；没坐下看别人打时，下面那边和另外三边一样。
  const side = (k, pos, d) => {
    const s = t.seats[k], mine = pos === 'b' && me >= 0;
    const who = !mine && (
      <div className="mj-who" key="who">
        <Seat s={s} idx={k} t={t} timer={timer} rel={pos === 'b' ? null : rel(d)} reacts={reactionsFor(st?.reactions, s?.name?.toLowerCase())} />
        {s?.melds.length ? <Melds melds={s.melds} size="rv" mark={selKind} /> : null}
        {s?.hand && (s.won || result) && (
          <div className="mj-shown">
            <span className="mj-cap">{s.won ? '胡的牌' : '手牌'}</span>
            {s.hand.map((x, i) => <MjTile key={i} kind={x} size="xs" className={selKind === x ? 'same' : ''} />)}
            {s.won && <MjTile kind={s.won.tile} size="xs" lit />}
          </div>
        )}
      </div>
    );
    const river = s && <River key="river" tiles={s.river} lastHere={lastSeat === k && !result} mark={selKind} />;
    return (
      <div className={'mj-side mj-' + pos}>
        {pos === 'b' ? [river, who] : [who, river]}
        {lastSeat === k && !result && <MjTile key={discardKey} kind={lastTile.kind} size="xl" className="mj-pop" aria-hidden="true" />}
        {calls.filter(c => c.seat === k).map(c => <span key={c.id} className={'mj-call ' + c.cls} aria-hidden="true">{c.text}</span>)}
      </div>
    );
  };
  const board = t && (
    <div className="mj-board">
      {side(left, 'l', 3)}{side(top, 't', 2)}{side(right, 'r', 1)}
      <div className="mj-mid">
        <Plate t={t} at={{ t: top, l: left, r: right, b: bottom }} />
        {lastTile && !result && (
          <div className="mj-lastline" role="status">
            <MjTile key={discardKey} kind={lastTile.kind} size={full ? 'sm' : 'lg'} lit slam />
            <span>{name(lastSeat)}<br />{t.claimOn?.rob ? '补杠' : '打出'}</span>
          </div>
        )}
      </div>
      {side(bottom, 'b', 0)}
    </div>
  );
  return (
    <div>
      <RoomPicker st={st} room={room} watch={watch} phases={PHASE} />
      <div className="grid lg:grid-cols-3 gap-5">
        <TableFrame full={full} onExit={exit} className="lg:col-span-2">
          {/* 点牌桌任何地方都让浏览器允许出声（浏览器要求先点过页面） */}
          <div style={{ display: 'contents' }} onPointerDownCapture={() => { unlock(); unlockSfx(); }}>
          <div className="gt-bar flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-3 text-sm">
            <span className="font-medium text-emerald-100">{status}</span>
            {meLine}
            {t && t.phase !== 'waiting' && !full && <span className="text-xs text-emerald-100">庄：{name(t.dealer)}</span>}
            <SoundToggles />
            {canEnter && <button onClick={enter} className="gt-pill">⛶<span> 全屏</span></button>}
          </div>
          {t && (
            <>
              <div className="gt-mid">
                {result && (
                  <div className="gt-result mj-result">
                    <div className="text-lg font-extrabold">{result.wins.length ? '🀄 这局结束' : '流局'}{won ? ' · 你赢了！' : ''}</div>
                    <div className="mj-score">
                      {scoreRows.map(r => (
                        <div key={r.k} className={'mj-score-row' + (r.k === me ? ' me' : '')}>
                          <span className="mj-score-name">{name(r.k)}{r.k === me ? '（你）' : ''}</span>
                          <span className="mj-score-tags">{r.tags}</span>
                          <span className={'mj-score-delta' + (r.delta > 0 ? ' up' : r.delta < 0 ? ' down' : '')}>{sign(r.delta)}</span>
                        </div>
                      ))}
                    </div>
                    {live && (me >= 0 || t.waiting) && !seatedElsewhere && <div className="mt-3">{deal('🔁 再来一局')}</div>}
                  </div>
                )}
                {board}
              </div>
              {mySeat && !full && (
                <div className="mt-2"><Seat s={mySeat} idx={me} t={t} timer={timer} reacts={reactionsFor(st?.reactions, mySeat.name.toLowerCase())} /></div>
              )}
              {t.phase === 'lack' && mySeat?.received && <div className="mj-note">换三张：从{FROM[t.swapDir]}拿到 {mySeat.received.map((k, i) => <MjTile key={i} kind={k} size="xs" inline className="mx-px" />)}（手里标了「新」）</div>}
              {mySeat && tingBar}
              {mySeat && (
                // 全屏时自己的名牌收起来了：别人拖给你的表情就落在手牌这一行上
                <div className="mj-handrow" data-react-to={full ? mySeat.name.toLowerCase() : undefined}>
                  {full && <ReactBubbles list={reactionsFor(st?.reactions, mySeat.name.toLowerCase())} />}
                  <div className="mj-hand">
                    {order.map((i, n) => {
                      const k = hand[i], drawn = i === drawnAt;
                      const pickable = (t.phase === 'swap' && !mySeat.swap) || !!opts;
                      const lackTile = mySeat.lack && k[0] === mySeat.lack && t.phase === 'playing';
                      const cls = [drawn && 'drawn', lackTile && 'lackt', fresh.has(i) && 'fresh', claimTile === k && 'match'].filter(Boolean).join(' ');
                      return (
                        <Fragment key={i}>
                          {n > 0 && hand[order[n - 1]][0] !== k[0] && !drawn && <span className="mj-gap" aria-hidden="true" />}
                          <MjTile kind={k} selected={sel.has(i)} onClick={pickable ? () => tap(i) : undefined} className={cls} badge={tingIf?.[k] ? '听' : null} />
                        </Fragment>
                      );
                    })}
                    {mySeat.won && <MjTile kind={mySeat.won.tile} className="drawn" lit />}
                  </div>
                  {/* 自己碰的、杠的牌：像真打麻将一样摆在手牌右边 */}
                  {mySeat.melds.length > 0 && <div className="mj-mymelds"><span className="mj-cap">碰杠</span><Melds melds={mySeat.melds} mark={selKind} /></div>}
                </div>
              )}
            </>
          )}
          {banner}
          <SavedNote t={t} />
          <div className="flex flex-wrap items-center gap-2 mt-4 mj-controls">{controls()}</div>
          <p className="text-sm mt-2 min-h-[1.25rem] text-amber-200 mj-msg">{msg}</p>
          </div>
        </TableFrame>
        <ReactionBar send={send} active={active} />
        <PointsBoard title="川麻豆子榜" rows={st?.board || []} me={st?.boardMe} saveNote="每打完一把就保存豆子">
          规则：血战到底。108 张（万条筒），开局换三张、定缺；只能碰、杠，不能吃；缺的那门要先打完，手里还有就不能胡。
          一炮可以多响；没胡的放过一张能胡的牌，到自己下次摸牌前都不能胡别人打的（过水不胡）。胡了的人退出，剩下的接着打，直到三家胡完或者摸完牌。
          番：平胡 0、对对胡 1、清一色 2、七对 2、带幺九 2、将对 +2、金钩钓 +1、每个根 +1、杠上花 / 杠上炮 / 抢杠 / 海底 +1，不封顶。
          底分 5 豆 × 2^番；自摸每家多给一底。杠：直杠点杠的人给 2 底，暗杠每家 2 底，补杠每家 1 底。摸完牌时花猪赔每家 16 底，没听牌的赔听牌的人。
        </PointsBoard>
      </div>
    </div>
  );
}
