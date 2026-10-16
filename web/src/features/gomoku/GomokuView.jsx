import { useEffect, useMemo, useRef, useState } from 'react';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { useTable, useCountdown, secondsLeft } from '../games/useTable.js';
import { alertsOn, setAlertsOn, unlock, useTurnAlert } from '../games/turnAlert.js';
import { BoardRows, place, TOP_NOTE } from '../games/TopBoard.jsx';
import { ReactionBar, ReactBubbles, reactionsFor } from '../games/Reactions.jsx';
import '../games/table.css';
import './gomoku.css';

// 五子棋：棋局在服务器上（worker/gomoku，一个 Durable Object 三张桌），每下一步都存起来，
// 部署、重启都接着下。连线、选桌、坐下 / 站起来用牌桌那套 useTable。
// 落子：电脑上鼠标移过去有个虚影，点一下就下；手机上手指点不准，先点一下放个虚影，
// 再点同一个地方（或者按「落子」）才算下。
const SIZE = 15;
const STARS = [3 * SIZE + 3, 3 * SIZE + 11, 7 * SIZE + 7, 11 * SIZE + 3, 11 * SIZE + 11];
const PHASE = { waiting: '等人开始', playing: '对局中', over: '这局结束' };
const COLOR = ['黑', '白'];
const STONE = ['⚫', '⚪'];

// 选桌：每张桌坐了谁、有没有 🤖、几个人在看
function Rooms({ st, room, watch }) {
  const lobby = st?.lobby || [1, 2, 3].map(r => ({ room: r, people: [], bots: 0, phase: 'waiting', watching: 0 }));
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {lobby.map(l => (
        <button key={l.room} onClick={() => watch(l.room)}
          className={'rounded-2xl px-4 py-2 text-left border-2 ' + (l.room === room ? 'bg-white border-indigo-500 shadow' : 'bg-white/70 border-transparent hover:border-indigo-200')}>
          <div className="font-bold text-sm">桌 {l.room}{st?.seatedAt === l.room ? ' · 你在这' : ''}</div>
          <div className="text-xs text-slate-500">
            {l.people.length ? l.people.join(' vs ') : '空着'}{l.bots ? ' vs 🤖' : ''} · {PHASE[l.phase] || l.phase}{l.watching ? ' · 👀 ' + l.watching : ''}
          </div>
        </button>
      ))}
    </div>
  );
}

// 一个座位：执黑 / 执白、谁、在想 / 托管 / 掉线。data-react-to 让表情能拖到这个人身上
function Seat({ s, k, t, timer, reacts, action }) {
  const turn = t.phase === 'playing' && t.turn === k;
  return (
    <div data-react-to={s ? s.name.toLowerCase() : undefined}
      className={'gm-seat' + (turn ? ' turn' : '') + (s && !s.connected ? ' away' : '')}>
      {s && <ReactBubbles list={reacts} />}
      <div className="flex items-center gap-2 min-w-0">
        <span className={'gm-dot ' + (k ? 'w' : 'b')} aria-hidden="true" />
        <span className="font-bold truncate">{s ? s.name + (s.me ? '（你）' : '') : '空位'}</span>
      </div>
      <div className="text-xs mt-1 min-h-[1rem] text-amber-100/90 truncate">
        {turn ? (s.auto ? '托管中…' : '思考中' + (timer ? ' · ' + timer : '…'))
          : s?.auto ? '托管中' : s && !s.connected ? '掉线了' : COLOR[k] + (k ? '棋' : '棋 · 先手')}
      </div>
      {action}
    </div>
  );
}

export default function GomokuView({ active }) {
  const { st, live, msg, room, watch, send, sit, standUp } = useTable(active, { path: '/api/gomoku', roomKey: 'gmRoom' });
  const timer = useCountdown(st, active && live);
  const t = st?.table;
  const shown = st?.room || room;
  const me = t ? t.you : -1;
  const mySeat = me >= 0 ? t.seats[me] : null;
  // 服务器把你放回了你坐的那桌（刷新、手机锁屏回来）：选桌那里也跟着过去
  useEffect(() => { if (st?.room && st.room !== room) watch(st.room); }, [st?.room]); // eslint-disable-line react-hooks/exhaustive-deps

  const moves = useMemo(() => t?.moves || [], [t?.moves]);
  const stones = useMemo(() => {
    const b = new Array(SIZE * SIZE).fill(0);
    moves.forEach((at, i) => { b[at] = i % 2 ? 2 : 1; });
    return b;
  }, [moves]);
  const last = moves.length ? moves[moves.length - 1] : -1;
  const winSet = useMemo(() => new Set(t?.result?.line || []), [t?.result]);

  const myTurn = !!t && t.phase === 'playing' && me >= 0 && t.turn === me;
  const canPlay = live && myTurn && !mySeat.auto;
  const [ghost, setGhost] = useState(null); // 虚影 { at, touch }：在哪、是不是手指点出来的
  // 局面变了（对方下了、悔棋、新的一局）或者不该你下了：虚影收掉
  useEffect(() => { if (ghost && (stones[ghost.at] || !canPlay)) setGhost(null); }, [stones, canPlay, ghost]);

  // 赢了撒点彩带
  const won = t?.phase === 'over' && me >= 0 && t.result?.winner === me;
  const round = t?.round;
  useEffect(() => {
    if (won && !reduceMotion) confetti({ particleCount: 120, spread: 90, origin: { y: 0.6 }, colors: CONFETTI_COLORS });
  }, [won, round]);

  // 和人下时轮到你：叮咚、震一下，最后 10 秒横幅变红、最后 5 秒滴答（和 🤖 下它马上就回，不用提醒）
  const secs = secondsLeft(st);
  const hurry = canPlay && secs != null && secs <= 10;
  useTurnAlert(canPlay && !t.vsBot ? t.deadline : 0, secs);
  const [alerts, setAlerts] = useState(alertsOn);
  const toggleAlerts = () => { setAlertsOn(!alerts); setAlerts(!alerts); };

  // 点棋盘：算出离手指 / 鼠标最近的交叉点
  const boardRef = useRef(null), down = useRef(null);
  const pointAt = e => {
    const r = boardRef.current.getBoundingClientRect(), cell = r.width / SIZE;
    const col = Math.floor((e.clientX - r.left) / cell), row = Math.floor((e.clientY - r.top) / cell);
    return row >= 0 && row < SIZE && col >= 0 && col < SIZE ? row * SIZE + col : -1;
  };
  const drop = at => { send({ type: 'move', at }); setGhost(null); };
  const onMove = e => {
    if (e.pointerType !== 'mouse') return;
    const at = pointAt(e), ok = canPlay && at >= 0 && !stones[at];
    setGhost(g => (g?.touch ? g : ok ? (g?.at === at ? g : { at, touch: false }) : null)); // 手指点出来的虚影不跟着鼠标走
  };
  const onDown = e => { down.current = { x: e.clientX, y: e.clientY }; };
  const onUp = e => {
    const d = down.current;
    down.current = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return; // 手指划了一下（在滚页面），不算点
    const at = pointAt(e);
    if (!canPlay || at < 0 || stones[at]) return;
    if (e.pointerType === 'mouse' || (ghost?.touch && ghost.at === at)) drop(at);
    else setGhost({ at, touch: true });
  };
  // 手指点出来的虚影旁边的「落子 ✓」：贴着虚影（上面放不下就放下面，靠边的往里挪），不会被页面角上的悬浮按钮挡住
  const confirmAt = g => {
    const r = Math.floor(g.at / SIZE), c = g.at % SIZE;
    return { left: ((c + 0.5) * 100) / SIZE + '%', top: ((r + 0.5) * 100) / SIZE + '%',
      transform: 'translate(' + (c <= 1 ? '-18%' : c >= SIZE - 2 ? '-82%' : '-50%') + ', ' + (r < 2 ? '62%' : '-162%') + ')' };
  };
  const stop = e => e.stopPropagation(); // 点「落子 ✓」不算点棋盘

  const vsBot = t?.vsBot;
  const seatedElsewhere = st?.seatedAt && st.seatedAt !== shown;
  const people = t ? t.seats.filter(s => s && !s.bot).length : 0;
  const leave = () => {
    if (t.phase === 'playing' && !vsBot && !window.confirm('现在站起来算认输，确定吗？')) return;
    standUp();
  };
  const resign = () => { if (window.confirm('确定认输？')) send({ type: 'resign' }); };
  const fresh = () => { if (window.confirm('不下上次那局了，重新开一局？（上次那局不算输赢）')) send({ type: 'fresh' }); };
  const btn = (label, onClick, cls = 'bg-white/15 text-white', disabled = false) => (
    <button onClick={onClick} disabled={disabled} className={'gt-btn ' + cls}>{label}</button>
  );
  // 座位上的「坐这里」：没坐下时空位 / 🤖 的位子能坐；自己一个人坐着时可以换到另一边（换颜色）
  const seatAction = k => {
    const s = t.seats[k];
    if (!live || seatedElsewhere || t.phase === 'playing' || (s && !s.bot)) return null;
    if (me < 0) return <button onClick={() => sit({ seat: k })} className="gm-take">{s ? '换下 🤖，坐这里' : '坐这里'}</button>;
    if (t.phase !== 'waiting') return null; // 下完一局：「再来一局」自己会换先手
    return <button onClick={() => sit({ seat: k })} className="gm-take">换到这边执{COLOR[k]}</button>;
  };

  function controls() {
    if (!live || !t) return null;
    if (seatedElsewhere) return btn('回到我坐的桌 ' + st.seatedAt, () => watch(st.seatedAt), 'bg-amber-400 text-slate-900');
    if (me < 0) {
      if (t.phase === 'playing') return <span className="text-sm text-amber-100">正在下，可以观战 👀</span>;
      if (people >= 2) return <span className="text-sm text-amber-100">这桌满了，可以观战 👀</span>;
      return <>
        {[0, 1].filter(k => !t.seats[k] || t.seats[k].bot).map(k => btn('🪑 坐' + COLOR[k] + '棋' + (k ? '' : '（先手）'), () => sit({ seat: k }), k ? 'bg-white text-slate-800' : 'bg-slate-900 text-white'))}
        {!people && <span className="text-sm text-amber-100">一个人坐下就和 🤖 下</span>}
      </>;
    }
    const stand = btn('站起来', leave, 'bg-white/15 text-white ml-auto');
    if (t.phase === 'waiting') return <>{btn('开始', () => send({ type: 'start' }), 'bg-amber-400 text-slate-900')}<span className="text-sm text-amber-100">{vsBot ? '对面是 🤖，也可以等人来坐它的位子' : '两个人都到了'}</span>{stand}</>;
    if (t.phase === 'over') return <>{btn('🔁 再来一局', () => send({ type: 'start' }), 'bg-amber-400 text-slate-900')}{stand}</>;
    const mine = moves.filter((_, i) => i % 2 === me).length;
    return <>
      {canPlay && ghost?.touch && btn('落子', () => drop(ghost.at), 'bg-amber-400 text-slate-900')}
      {vsBot && btn('悔棋', () => send({ type: 'undo' }), 'bg-white text-slate-800', !mine)}
      {btn('认输', resign)}
      {mySeat.auto ? btn('取消托管', () => send({ type: 'auto', on: false }), 'bg-fuchsia-500 text-white') : !vsBot && btn('托管', () => send({ type: 'auto', on: true }))}
      {stand}
    </>;
  }

  const result = t?.phase === 'over' && t.result;
  const resultText = r => {
    if (r.how === 'draw') return '棋盘下满了，和棋 🤝';
    const w = STONE[r.winner] + ' ' + (r.names[r.winner] || COLOR[r.winner] + '棋');
    if (r.how === 'five') return (r.winner === me ? '🎉 你赢了！' : w + ' 赢了！') + '连成五个';
    return (r.by || '') + (r.how === 'left' ? ' 站起来走了，算认输' : ' 认输了') + ' · ' + w + ' 赢';
  };
  const status = !t ? '连接中…' : !live ? '断线了，重连中…' : '桌 ' + shown + ' · ' + PHASE[t.phase] + (moves.length ? ' · 第 ' + moves.length + ' 手' : '');
  const w = st?.watch;
  return (
    <div>
      <Rooms st={st} room={shown} watch={watch} />
      <div className="grid lg:grid-cols-3 gap-5">
        <section className="gm-felt lg:col-span-2 rounded-2xl shadow-xl p-2 sm:p-4" onPointerDownCapture={unlock}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 text-sm px-1">
            <span className="font-medium text-amber-50">{status}</span>
            {w?.n > 0 && <span className="text-amber-100/90 truncate max-w-full" title={w.names.join('、')}>👀 {w.n} 人观战{w.names.length ? '：' + w.names.join('、') : ''}</span>}
            {t && !vsBot && me >= 0 && <button onClick={toggleAlerts} aria-pressed={alerts} title={alerts ? '轮到你时响一声（点一下关掉）' : '轮到你时不响（点一下打开）'}
              className="ml-auto text-xs rounded-full bg-white/15 px-2 py-1">{alerts ? '🔔 提醒' : '🔕 提醒'}</button>}
          </div>
          {t && (
            <div className="grid grid-cols-2 gap-2 mb-2">
              {[0, 1].map(k => <Seat key={k} s={t.seats[k]} k={k} t={t} timer={timer}
                reacts={reactionsFor(st?.reactions, t.seats[k]?.name?.toLowerCase())} action={seatAction(k)} />)}
            </div>
          )}
          {t?.resumed && me >= 0 && t.phase === 'playing' && (
            <div className="gm-note" role="status">
              <span>♻️ 接着上次那局（{moves.length} 手）</span>
              <button onClick={fresh} className="underline font-bold">重新开一局</button>
            </div>
          )}
          {myTurn && live && !mySeat.auto && !vsBot && (
            <div className={'gt-yourturn gm-turn' + (hurry ? ' hurry' : '')} role="status">
              <span>{hurry ? '⏰ 快没时间了' : '🔔 轮到你了'}</span>{secs != null && <b className="tabular-nums">{secs}s</b>}
              {hurry && <small>超时 🤖 帮你下一步</small>}
            </div>
          )}
          <div className="gm-wrap">
            <div ref={boardRef} className={'gm-board' + (canPlay ? ' mine' : '')} role="application" aria-label="五子棋棋盘，15 × 15"
              onPointerMove={onMove} onPointerLeave={e => { if (e.pointerType === 'mouse') setGhost(g => (g?.touch ? g : null)); }}
              onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => { down.current = null; }}>
              <svg className="gm-lines" viewBox="0 0 150 150" aria-hidden="true">
                {Array.from({ length: SIZE }, (_, i) => (
                  <g key={i}>
                    <line x1="5" y1={5 + i * 10} x2="145" y2={5 + i * 10} className={i === 0 || i === SIZE - 1 ? 'edge' : ''} />
                    <line x1={5 + i * 10} y1="5" x2={5 + i * 10} y2="145" className={i === 0 || i === SIZE - 1 ? 'edge' : ''} />
                  </g>
                ))}
                {STARS.map(p => <circle key={p} cx={5 + (p % SIZE) * 10} cy={5 + Math.floor(p / SIZE) * 10} r="1.5" />)}
              </svg>
              {moves.map((at, i) => (
                <div key={at} className={'gm-stone ' + (i % 2 ? 'w' : 'b') + (at === last ? ' last' : '') + (winSet.has(at) ? ' win' : '')}
                  style={{ '--r': Math.floor(at / SIZE), '--c': at % SIZE }} />
              ))}
              {ghost && <div className={'gm-stone ghost ' + (me ? 'w' : 'b')} style={{ '--r': Math.floor(ghost.at / SIZE), '--c': ghost.at % SIZE }} />}
              {ghost?.touch && <button className="gm-confirm" style={confirmAt(ghost)} onPointerDown={stop} onPointerUp={stop} onClick={() => drop(ghost.at)}>落子 ✓</button>}
            </div>
          </div>
          {result && (
            <div className="gm-result" role="status">
              <div className="text-lg font-extrabold">{resultText(result)}</div>
              <div className="text-xs mt-0.5 opacity-90">{STONE[0]} {result.names[0]} vs {STONE[1]} {result.names[1]} · {moves.length} 手</div>
            </div>
          )}
          {canPlay && (
            <p className="gm-hint">轮到你{STONE[me]} · <span className="gm-mouse">点一下交叉点就下</span>
              <span className="gm-touch">{ghost?.touch ? '再点一下虚影，或者按「落子 ✓」' : '先点一下放个虚影，再点一下（或按「落子」）才算下'}</span></p>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-3">{controls()}</div>
          <p className="text-sm mt-2 min-h-[1.25rem] text-amber-200">{msg}</p>
        </section>
        <ReactionBar send={send} active={active} />
        <aside className="glass-card rounded-2xl p-5 self-start">
          <h2 className="font-bold text-lg mb-1">🏆 五子棋胜场榜</h2>
          <p className="text-xs text-slate-500 mb-3">每局下完记一次，和 🤖 下也算 · 先比赢的局数，再比胜率 · {TOP_NOTE}</p>
          <BoardRows rows={st?.board || []} me={st?.boardMe} empty="还没人下完过一局" row={(r, i, isMe) => (
            <div key={isMe ? 'me' : r.name} className={'flex items-center justify-between gap-2 border-b py-1.5 text-sm' + (isMe ? ' font-bold text-indigo-700' : '')}>
              <span className="truncate">{place(i)} {r.name}</span>
              <span className="font-bold tabular-nums whitespace-nowrap">{r.wins} 胜<span className="text-xs font-normal text-slate-400"> / {r.games} 局{r.draws ? ' · 和 ' + r.draws : ''}</span></span>
            </div>
          )} />
          <div className="text-xs text-slate-400 mt-4 leading-relaxed">
            规则：15 × 15 的棋盘，黑先，横、竖、斜连成五个（或更多）就赢，没有禁手；下满了算和棋。每步 60 秒，超时 🤖 替你下一步，连着两次就托管。
            一个人坐下就和 🤖 下：可以悔棋（退回你的上一步和它的回应）；站起来这局会存着，下次一个人坐下接着下。
            和人下：选座位就是选颜色，再来一局换先手；中途站起来算认输。谁都能来观战。
          </div>
        </aside>
      </div>
    </div>
  );
}
