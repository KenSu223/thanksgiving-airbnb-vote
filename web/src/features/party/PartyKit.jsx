import { useEffect, useRef, useState } from 'react';
import { useTable, useCountdown, secondsLeft } from '../games/useTable.js';
import { RoomPicker } from '../games/TableFrame.jsx';
import { ReactBubbles, reactionsFor } from '../games/Reactions.jsx';
import { useAnnouncer, useVoiceSetting, useWakeLock, canSpeak, unlockVoice } from './voice.js';
import './party.css';

// 谁是卧底 / 阿瓦隆 / 狼人杀 共用的零件：连线（useTable，掉线、锁屏回来自动坐回原座位）、
// 播报开关、座位格子（选座位、换座位、投票时点人）、顶上的阶段横幅、只给自己看的身份牌、记录和胜场榜。

// voice: false — a game run by a person (谁是卧底): no 播报, no switch for it
export function useParty(active, { path, roomKey, game, voice = true }) {
  const tb = useTable(active, { path, roomKey });
  const { st, live } = tb;
  const t = st?.table;
  const me = t ? t.you : -1;
  const seated = me >= 0;
  // 播报默认：开局的那个人、和没坐下的（放在桌上当「上帝」的那台）开着
  const [voicePref, setVoice] = useVoiceSetting(game, !seated || (!!t?.host && t.host === st?.you));
  const voiceOn = voice && voicePref;
  useAnnouncer(t, voiceOn && active && live);
  useWakeLock(voiceOn && active && !!t && t.phase !== 'waiting');
  const timer = useCountdown(st, active && live);
  const secs = secondsLeft(st);
  return { ...tb, t, me, seated, inGame: !!t?.inGame, voice, voiceOn, setVoice, timer, secs };
}

// 第一次点到桌上任何地方时顺便把朗读解锁（iPhone 要求）
export function PartyFrame({ theme, children }) {
  return <section className={'pt-frame pt-' + theme + ' rounded-2xl shadow-xl p-3 md:p-5'} onPointerDownCapture={unlockVoice}>{children}</section>;
}

// 顶上一排：选桌、播报、站起来
export function TopBar({ p, phases, title }) {
  const { st, room, watch, seated, t, standUp, voice, voiceOn, setVoice } = p;
  return (
    <>
      <RoomPicker st={st} room={room} watch={watch} phases={phases} rooms={2} />
      <div className="pt-top">
        <span className="pt-title">{title}</span>
        {voice && canSpeak() && <button className={'pt-chip' + (voiceOn ? ' on' : '')} onClick={() => setVoice(!voiceOn)} title="这台设备念出每一步（一桌开一台就够）">{voiceOn ? '🔊 播报开' : '🔈 播报关'}</button>}
        {seated && t && !t.inGame && <button className="pt-chip" onClick={standUp}>站起来</button>}
      </div>
    </>
  );
}

// 横幅：现在在干什么、还剩几秒
export function Banner({ title, sub, p, tone = '' }) {
  const hurry = p.secs != null && p.secs <= 5;
  return (
    <div className={'pt-banner ' + tone}>
      <div className="pt-banner-main">{title}</div>
      {(sub || p.timer) && <div className="pt-banner-sub">{sub}{p.timer && <span className={'pt-timer' + (hurry ? ' hurry' : '')}>{p.timer}</span>}</div>}
    </div>
  );
}

// 座位格子。badges(i, seat) 给每个座位的小标签；pick 时可以点的座位亮起来。
// 局中只摆在玩的人（空座位藏起来，手机上一屏看得完）；局外空座位可以点「坐这 / 换到这」。
// 有人的座位和牌桌一样是表情拖放的目标（data-react-to=玩家 key，见
// games/Reactions.jsx）：气泡冒在座位角上。服务器那边三个派对游戏共用
// TableHall，react 的收发和 reactions 字段本来就有，只差前端这一步。
export function SeatGrid({ p, badges, pickable, picked, onPick, dim }) {
  const { t, st, seated, sit, send } = p;
  if (!t) return null;
  const open = t.phase === 'waiting' || t.phase === 'result';
  return (
    <div className="pt-seats">
      {t.seats.map((s, i) => {
        const canPick = pickable && pickable.includes(i);
        const isPicked = Array.isArray(picked) ? picked.includes(i) : picked === i;
        if (!s) {
          if (!open) return null;
          return (
            <button key={i} className="pt-seat empty can" onClick={() => (seated ? send({ type: 'seat', seat: i }) : sit({ seat: i }))}>
              <span className="pt-num">{i + 1}</span><span className="pt-sitlabel">{seated ? '换到这' : '坐这'}</span>
            </button>
          );
        }
        const cls = 'pt-seat' + (s.me ? ' me' : '') + (canPick ? ' can' : '') + (isPicked ? ' picked' : '') + (dim && dim(i) ? ' dim' : '') + (t.speaker === i ? ' speaking' : '');
        const body = (
          <>
            <ReactBubbles list={reactionsFor(st?.reactions, s.name.toLowerCase())} />
            <span className="pt-num">{i + 1}</span>
            <span className="pt-name">{s.name}{s.me && <em> (你)</em>}</span>
            <span className="pt-badges">
              {!s.connected && <span className="pt-b off" title="掉线了">📵</span>}
              {t.speaker === i && <span className="pt-b talk">🎤</span>}
              {t.vote && t.vote.voted.includes(i) && <span className="pt-b ok" title="投了">✓</span>}
              {t.looking && t.looking.ready.includes(i) && <span className="pt-b ok" title="看好了">✓</span>}
              {badges && badges(i, s)}
            </span>
            {open && !s.connected && seated && !s.me && <span className="pt-kick" role="button" onClick={e => { e.stopPropagation(); send({ type: 'kick', seat: i }); }}>请走</span>}
          </>
        );
        return canPick
          ? <button key={i} data-react-to={s.name.toLowerCase()} className={cls} onClick={() => onPick(i)}>{body}</button>
          : <div key={i} data-react-to={s.name.toLowerCase()} className={cls}>{body}</div>;
      })}
    </div>
  );
}

// 只给自己看的身份 / 词：点一下翻开，5 秒后自己盖上（旁边的人瞄不到）
export function SecretCard({ label, children, tone = '' }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flip = () => { setOpen(o => !o); clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 5000); };
  return (
    <button className={'pt-secret ' + tone + (open ? ' open' : '')} onClick={flip}>
      {open ? children : <span className="pt-secret-cover">🔒 {label}<small>点一下翻开，5 秒后自动盖上</small></span>}
    </button>
  );
}

// 投票：选好了点「投 X 号」，也可以弃票
export function VoteBar({ p, choice, setChoice, label = '投' }) {
  const v = p.t?.vote;
  if (!v || !v.voters.includes(p.me)) return null;
  if (v.mine != null) return <p className="pt-hint">已经{v.mine >= 0 ? label + ' ' + (v.mine + 1) + ' 号' : '弃票'}，等别人投完（{v.voted.length}/{v.voters.length}）</p>;
  return (
    <div className="pt-actions">
      <span className="pt-hint">{choice != null ? '选了 ' + (choice + 1) + ' 号' : '点上面的座位选人'}</span>
      <button className="pt-btn main" disabled={choice == null} onClick={() => { p.send({ type: 'vote', target: choice }); setChoice(null); }}>{choice != null ? label + ' ' + (choice + 1) + ' 号' : label}</button>
      <button className="pt-btn" onClick={() => { p.send({ type: 'vote', target: -1 }); setChoice(null); }}>弃票</button>
    </div>
  );
}

// 发言时：轮到你（或者你开的局）就有「说完了」
export function SpeakBar({ p }) {
  const { t, me, st, send } = p;
  if (!t || t.speaker < 0) return null;
  const mine = t.speaker === me, host = t.host && t.host === st?.you;
  const gone = t.seats[t.speaker] && !t.seats[t.speaker].connected;
  if (!mine && !host && !gone) return <p className="pt-hint">{t.speaker + 1} 号在说，听着就好</p>;
  return (
    <div className="pt-actions">
      {mine ? <span className="pt-hint strong">轮到你了，说完点这里 👉</span> : <span className="pt-hint">{t.speaker + 1} 号{gone ? '掉线了，' : '说完了的话'}可以帮他点</span>}
      <button className="pt-btn main" onClick={() => send({ type: 'done' })}>{mine ? '我说完了' : '下一个'}</button>
    </div>
  );
}

// 开始前：开始 / 再来一局；局中：结束这局
export function StartBar({ p, label }) {
  const { t, seated, send, inGame } = p;
  if (!t || !seated) return null;
  const count = t.seats.filter(Boolean).length;
  if (!inGame) return (
    <div className="pt-actions">
      <button className="pt-btn main" disabled={count < t.min} onClick={() => send({ type: 'start' })}>{t.phase === 'result' ? '🔁 再来一局' : label || '开始'}</button>
      <span className="pt-hint">{count < t.min ? '至少 ' + t.min + ' 人，现在 ' + count + ' 人' : count + ' 人，人齐了谁都可以点开始'}</span>
    </div>
  );
  return null;
}
export function StopButton({ p }) {
  if (!p.inGame) return null;
  return <button className="pt-link" onClick={() => { if (window.confirm('结束这局？所有人的身份都会亮出来，不算输赢')) p.send({ type: 'stop' }); }}>结束这局</button>;
}

export function LogList({ log }) {
  const box = useRef(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [log?.length]);
  if (!log?.length) return null;
  return (
    <div className="pt-log" ref={box}>
      {log.map(l => <div key={l.id}>{l.text}</div>)}
    </div>
  );
}

export function WinsBoard({ title, rows, children }) {
  return (
    <aside className="glass-card rounded-2xl p-5 self-start">
      <h2 className="font-bold text-lg mb-1">🏆 {title}</h2>
      <p className="text-xs text-slate-500 mb-3">按赢的局数排 · 一样多比胜率</p>
      {rows.length ? rows.map((r, i) => (
        <div key={r.name} className="flex items-center justify-between gap-2 border-b py-1.5 text-sm">
          <span className="truncate">{i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1) + '.'} {r.name}{r.seated && <span className="text-xs text-emerald-600"> 在桌上</span>}</span>
          <span className="font-bold tabular-nums whitespace-nowrap">{r.wins || 0} 胜<span className="text-xs font-normal text-slate-400"> / {r.games || 0} 局</span></span>
        </div>
      )) : <p className="text-sm text-slate-400">还没人玩过</p>}
      <div className="text-xs text-slate-500 mt-4 leading-relaxed">{children}</div>
    </aside>
  );
}

// 设置里的一排选项
export function Choice({ label, value, options, onPick, disabled }) {
  return (
    <div className="pt-choice">
      <span className="pt-choice-label">{label}</span>
      <span className="pt-choice-opts">
        {options.map(([v, text]) => (
          <button key={String(v)} disabled={disabled} className={'pt-opt' + (v === value ? ' on' : '')} onClick={() => onPick(v)}>{text}</button>
        ))}
      </span>
    </div>
  );
}
