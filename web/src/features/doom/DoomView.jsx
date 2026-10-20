import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../lib/api.js';
import { load, save } from '../../lib/storage.js';
import { useSession } from '../../session/SessionContext.jsx';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { SIM_VERSION, PERKS } from './sim.js';
import DoomGame from './DoomGame.jsx';
import { BoardRows, place, TOP_NOTE } from '../games/TopBoard.jsx';
import * as sfx from './sfx.js';
import './doom.css';

// 末日小队：一个人玩，小队自己往前冲、自己开火，你只管左右走位：穿过数字门加人（红门打几枪会变好），
// 挡住一波波丧尸，每波之后三选一强化，每 5 波一个尸王。打到全军覆没为止，比击杀分。
// 手机上开打就铺满屏幕，竖着玩。
const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const ENDS = { dead: '全军覆没', quit: '结算了', time: '打太久了（30 分钟），自动结算' };
const pts = n => '💀 ' + n.toLocaleString('en-US');

// 交成绩和躲技能一样：开局拿服务器签名的「票」（种子在里面），记下每个操作；结束后服务器
// 自己重放一遍算分（verify.js）。网络不通时先存在这台设备上，下次再交。
const PENDING = 'doomPending';
const pendingScore = () => {
  try { const p = JSON.parse(load(PENDING) || 'null'); return p && p.ticket && Array.isArray(p.events) ? p : null; } catch (e) { return null; }
};
async function sendScore(s) {
  let r = null;
  try { r = await api('/api/doom/score', 'POST', s); } catch (e) { /* offline */ }
  if (r && r.ok) {
    const p = pendingScore();
    if (p && p.name === s.name && p.score <= s.score) save(PENDING, '');
    return r;
  }
  if (r) return r;
  const p = pendingScore();
  if (!p || p.name !== s.name || p.score < s.score) save(PENDING, JSON.stringify(s));
  return { ok: false, retry: true, error: '网络有点问题，成绩先存在这台设备上' };
}

export default function DoomView({ active }) {
  const { name, token, ensureName } = useSession();
  const [board, setBoard] = useState([]);
  const [boardMe, setBoardMe] = useState(null);
  const showBoard = useCallback(r => { setBoard(r.board || []); setBoardMe(r.boardMe || null); }, []);
  const [run, setRun] = useState(null);
  const [result, setResult] = useState(null);
  const [msg, setMsg] = useState('');
  const [touch] = useState(isTouch);
  const [paused, setPaused] = useState(false);

  const loadBoard = useCallback(() => api('/api/doom/board?name=' + encodeURIComponent(name || '') + '&token=' + encodeURIComponent(token || ''))
    .then(r => r.ok && showBoard(r)).catch(() => {}), [name, token, showBoard]);
  useEffect(() => {
    if (!active) return;
    const p = pendingScore();
    if (p) sendScore(p).then(r => (r.ok ? showBoard(r) : loadBoard()));
    else loadBoard();
  }, [active, loadBoard, showBoard]);
  const playing = run && !run.replay && !result;
  useEffect(() => { if (playing && !active) setPaused(true); }, [playing, active]);
  useEffect(() => {
    const f = () => { if (document.hidden && playing) setPaused(true); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [playing]);
  const full = touch && !!run;
  const boxRef = useRef(null);
  useEffect(() => { if (run && !touch) boxRef.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }); }, [run, touch]);
  useEffect(() => {
    if (!full) return;
    const stop = e => e.preventDefault();
    document.documentElement.classList.add('dm-lock');
    window.getSelection?.()?.removeAllRanges();
    document.addEventListener('selectstart', stop);
    document.addEventListener('contextmenu', stop);
    return () => {
      document.documentElement.classList.remove('dm-lock');
      document.removeEventListener('selectstart', stop);
      document.removeEventListener('contextmenu', stop);
    };
  }, [full]);

  function start() {
    sfx.unlock();
    setMsg('');
    ensureName(async me => {
      const t = await api('/api/doom/start', 'POST', { name: me.name, token: me.token }).catch(() => null);
      setResult(null); setPaused(false);
      setRun(x => ({ me: { name: me.name, token: me.token }, n: (x?.n || 0) + 1,
        ...(t?.ok ? { seed: t.seed, ticket: t.ticket } : { seed: Math.floor(Math.random() * 4294967296), ticket: null, practice: t?.error || '没连上服务器' }) }));
    });
  }
  async function watch(who) {
    sfx.unlock();
    setMsg('');
    const r = await api('/api/doom/replay?name=' + encodeURIComponent(who)).catch(() => null);
    if (!r?.ok || r.v !== SIM_VERSION) { setMsg(r?.ok ? '这条回放是旧版游戏录的，放不了了' : r?.error || '回放没加载出来，再试一次'); return; }
    setResult(null); setPaused(false);
    setRun(x => ({ replay: r, seed: r.seed, n: (x?.n || 0) + 1 }));
  }
  function again() { setResult(null); setPaused(false); setRun(x => ({ ...x, n: x.n + 1 })); }
  async function submit(score) {
    const r = await sendScore(score);
    setResult(x => ({ ...x, server: r.ok ? r : null, error: r.ok ? '' : r.error, retry: !!r.retry }));
    if (r.ok) {
      showBoard(r);
      if (r.newBest && r.score > 0 && !reduceMotion) confetti({ particleCount: 140, spread: 90, origin: { y: 0.5 }, colors: CONFETTI_COLORS });
    }
  }
  function done(sim, events) {
    const res = { score: sim.score, kills: sim.kills, wave: sim.wave, end: sim.end, picks: { ...sim.picks } };
    if (run.replay) { setResult({ ...res, replay: true }); return; }
    setResult({ ...res, practice: run.ticket ? null : run.practice });
    if (run.ticket) submit({ ...run.me, ticket: run.ticket, events, score: sim.score });
  }
  function retry() {
    const p = pendingScore();
    setResult(x => ({ ...x, error: '', retry: false }));
    if (p) submit(p);
  }
  function quit() { setRun(null); setResult(null); setPaused(false); loadBoard(); }

  const mine = boardMe || board.find(r => name && r.name.toLowerCase() === name.toLowerCase());
  const build = picks => PERKS.filter(p => picks?.[p.key]).map(p => p.emoji + (picks[p.key] > 1 ? '×' + picks[p.key] : '')).join(' ');
  const overlay = result && (result.replay ? (
    <div className="dm-over">
      <div className="text-2xl font-extrabold">回放结束：{run.replay.name} {pts(result.score)}</div>
      <div className="text-sm mt-1 text-slate-300">打到第 {result.wave} 波 · {ENDS[result.end] || ''}</div>
      {build(result.picks) && <div className="text-sm mt-2">强化：{build(result.picks)}</div>}
      <div className="flex gap-2 justify-center mt-3">
        <button onClick={again} className="dm-btn dm-btn-hot">再看一次</button>
        <button onClick={quit} className="dm-btn dm-btn-dim">退出</button>
      </div>
    </div>
  ) : (
    <div className="dm-over">
      <div className="text-sm text-slate-300">{ENDS[result.end] || '结束了'}</div>
      <div className="text-3xl font-extrabold mt-1 text-amber-300">{pts(result.server?.score ?? result.score)}</div>
      <div className="text-sm mt-1">打到第 {result.wave} 波 · 干掉 {result.kills} 只</div>
      {build(result.picks) && <div className="text-sm mt-2">这局的强化：{build(result.picks)}</div>}
      <div className="text-sm mt-2 min-h-[1.25rem] text-amber-200">
        {result.practice ? `这局没记分：${result.practice}`
          : result.server ? (result.server.newBest ? `🎉 新纪录！排第 ${result.server.rank} 名` : `你的最好 ${pts(result.server.best)} · 第 ${result.server.rank} 名`)
          : result.error || '核对中…'}
      </div>
      <div className="flex gap-2 justify-center mt-3 flex-wrap">
        {result.retry && <button onClick={retry} className="dm-btn dm-btn-sky">重新提交</button>}
        <button onClick={start} className="dm-btn dm-btn-hot">再来一局</button>
        <button onClick={quit} className="dm-btn dm-btn-dim">{touch ? '退出' : '看排行榜'}</button>
      </div>
    </div>
  ));
  const game = run && (
    <DoomGame key={run.n} seed={run.seed} touch={touch} paused={paused} onPause={() => setPaused(true)} onResume={() => setPaused(false)}
      onDone={done} onLeave={quit} replay={run.replay?.events} replayName={run.replay?.name}>
      {overlay}
    </DoomGame>
  );

  return (
    <div>
      <div className="grid lg:grid-cols-3 gap-5">
        <section className="lg:col-span-2">
          {run && !touch ? <div ref={boxRef} className="dm-box">{game}</div> : (
            <div className="dm-intro rounded-2xl shadow-xl p-5 md:p-7 text-white">
              <div className="dm-intro-content">
                <div className="dm-eyebrow">DOOM SQUAD · 打丧尸</div>
                <div className="dm-title">末日小队<span>人越多，火力越猛。</span></div>
                <p className="dm-description">小队自己往前冲、自己开火，你只管左右走位：穿过数字门加人，躲开扣人的红门（打几枪它会变好），挡住一波又一波的丧尸。每守住一波，三选一拿一个强化。</p>
                <div className="dm-rule-tags"><span>数字门</span><span>每波三选一</span><span>每 5 波一个尸王</span></div>
                <ul className="mt-3 text-sm text-slate-200 space-y-1">
                  <li>{touch ? '👆 在路上左右拖动' : '🖱️ 鼠标在路上左右移动，或者按 ← / →'}，小队跟着走</li>
                  <li>🔵 蓝门是好的（+人、×2、射速）；🔴 红门扣人，朝它开枪数字会往上涨，打成正的就变蓝</li>
                  <li>🧟 丧尸碰到小队会咬掉人；胖子咬得多，尸王碰到就全军覆没——一定要在它走到之前打死</li>
                  <li>🔥 每波之后三选一：射速、伤害、援军、穿透、散射、暴击、迫击炮、护盾</li>
                  <li>💀 击杀算分：丧尸 1、跑尸 2、胖子 6、尸王 40</li>
                </ul>
                {mine && <p className="mt-3 text-amber-200 font-bold">你的最好：{pts(mine.score)}（第 {mine.wave} 波）</p>}
                <button onClick={start} className="dm-btn dm-start mt-4 text-lg">出发 <span aria-hidden="true">→</span></button>
                {msg && <p className="mt-2 text-sm text-amber-200">{msg}</p>}
              </div>
            </div>
          )}
        </section>
        <aside className="glass-card rounded-2xl p-5 self-start">
          <h2 className="font-bold text-lg mb-1">🏆 末日小队排行榜</h2>
          <p className="text-xs text-slate-500 mb-3">每人最好的一局（击杀分）· {TOP_NOTE} · 成绩由服务器重放核对 · 前三名的录像公开（点 ▶ 看）</p>
          <BoardRows rows={board} me={boardMe} empty="还没人打过，来当第一" row={(r, i, isMe) => (
            <div key={isMe ? 'me' : r.name} className={'flex items-center justify-between gap-2 border-b py-1.5 text-sm' + (isMe || (mine && r.name === mine.name) ? ' font-bold text-indigo-700' : '')}>
              <span className="truncate">{place(i)} {r.name}</span>
              <span className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400 whitespace-nowrap">第 {r.wave} 波</span>
                <span className="tabular-nums whitespace-nowrap">{pts(r.score)}</span>
                {i >= 3 ? <span className="dm-watch dm-watch-none" aria-hidden="true" />
                  : r.replay
                  ? <button className="dm-watch" onClick={() => watch(r.name)} aria-label={`看 ${r.name} 的回放`} title="看回放">▶</button>
                  : <span className="dm-watch dm-watch-none" aria-hidden="true">·</span>}
              </span>
            </div>
          )} />
        </aside>
      </div>
      {full && createPortal(<div className="dm-full">{game}</div>, document.body)}
    </div>
  );
}
