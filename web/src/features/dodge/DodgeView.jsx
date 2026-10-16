import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../lib/api.js';
import { load, save } from '../../lib/storage.js';
import { useSession } from '../../session/SessionContext.jsx';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { HZ, SKILLS, SIM_VERSION } from './sim.js';
import DodgeGame, { killedBy } from './DodgeGame.jsx';
import DodgePreview from './DodgePreview.jsx';
import { BoardRows, place, TOP_NOTE } from '../games/TopBoard.jsx';
import * as sfx from './sfx.js';
import './dodge.css';

// 鲁班七号躲技能：一个人玩，活得越久越好，全时间排行榜。
// 手机上开打就全屏、锁成横屏（安卓）；锁不了的（iPhone）竖着拿就提示横过来，并且先暂停。
const secs = ticks => (ticks / HZ).toFixed(1);
const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const PORTRAIT = '(orientation: portrait)';
// iPhone 上的 Safari / Chrome 都不让网页隐藏地址栏（全屏接口只给视频用），横屏时会占掉一截屏幕。
// 从主屏幕图标打开（添加到主屏幕）就没有地址栏，所以在浏览器里打开时提示一下。
const IOS = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const fromHomeScreen = () => navigator.standalone === true || window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
const HOME_TIP = '📲 iPhone 想去掉地址栏：点「分享」→「添加到主屏幕」，以后从主屏幕的图标打开就是全屏';

async function enterFull() {
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch (e) { /* not allowed here (iPhone) */ }
  try { await window.screen.orientation?.lock?.('landscape'); } catch (e) { /* not allowed here */ }
}
function leaveFull() {
  try { window.screen.orientation?.unlock?.(); } catch (e) { /* fine */ }
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

// 交成绩：开局时服务器发一张签了名的「票」（种子在里面），这局的每个操作都记下来；
// 死了以后把票和操作交上去，服务器自己重放一遍算出存活时间，那才是成绩（verify.js）。
// 网络不通时先存在这台设备上（只留最好的那次），点「重新提交」或者下次打开这页时再交，
// 好不容易活很久的一局不会丢。旧页面存下的只有时间、没有操作，核对不了，就不交了。
const PENDING = 'dodgePending';
const pendingScore = () => {
  try { const p = JSON.parse(load(PENDING) || 'null'); return p && p.ticket && Array.isArray(p.events) ? p : null; } catch (e) { return null; }
};
// 🤖：重放时量出来躲开危险的速度比人快（verify.js 的 BOT）
const BOT_NOTE = ms => `🤖 这局躲开危险平均只用了 ${ms} 毫秒，人一般要 200 毫秒以上，可能是外挂`;
async function sendScore(s) {
  let r = null;
  try { r = await api('/api/dodge/score', 'POST', s); } catch (e) { /* offline */ }
  if (r && r.ok) {
    const p = pendingScore();
    if (p && p.name === s.name && p.ticks <= s.ticks) save(PENDING, '');
    return r;
  }
  if (r) return r; // a real refusal (not logged in…): nothing to retry
  const p = pendingScore();
  if (!p || p.name !== s.name || p.ticks < s.ticks) save(PENDING, JSON.stringify(s));
  return { ok: false, retry: true, error: '网络有点问题，成绩先存在这台设备上' };
}

export default function DodgeView({ active }) {
  const { name, token, ensureName } = useSession();
  // the top 3, and your own place when you're below them (only you get it)
  const [board, setBoard] = useState([]);
  const [boardMe, setBoardMe] = useState(null);
  const showBoard = useCallback(r => { setBoard(r.board || []); setBoardMe(r.boardMe || null); }, []);
  // while playing: { me: { name, token }, seed, ticket, practice?, n }; while watching: { replay, seed, n }
  const [run, setRun] = useState(null);
  const [result, setResult] = useState(null); // { ticks, by, server?, error?, retry?, practice?, replay? }
  const [msg, setMsg] = useState('');
  const [touch] = useState(isTouch);
  const [portrait, setPortrait] = useState(() => window.matchMedia(PORTRAIT).matches);
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false); // the 3-2-1 is over and the run is going

  const loadBoard = useCallback(() => api('/api/dodge/board?name=' + encodeURIComponent(name || '') + '&token=' + encodeURIComponent(token || ''))
    .then(r => r.ok && showBoard(r)).catch(() => {}), [name, token, showBoard]);
  // opening the page also sends a score that couldn't be sent last time
  useEffect(() => {
    if (!active) return;
    const p = pendingScore();
    if (p) sendScore(p).then(r => (r.ok ? showBoard(r) : loadBoard()));
    else loadBoard();
  }, [active, loadBoard, showBoard]);
  useEffect(() => {
    const q = window.matchMedia(PORTRAIT), f = () => setPortrait(q.matches);
    q.addEventListener('change', f);
    return () => q.removeEventListener('change', f);
  }, []);
  // leaving the page, switching apps or turning the phone upright pauses the run
  const playing = run && !result;
  useEffect(() => { if (playing && (!active || (touch && portrait))) setPaused(true); }, [playing, active, touch, portrait]);
  // turned sideways before the run got going: just start, no 继续 needed
  useEffect(() => { if (playing && !started && active && !(touch && portrait)) setPaused(false); }, [playing, started, active, touch, portrait]);
  useEffect(() => {
    const f = () => { if (document.hidden && playing) setPaused(true); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [playing]);
  const full = touch && !!run;
  // while a run is on screen: no scrolling, and no text selection / long-press copy menu
  // (a stray long-press on iPhone used to select text and pop up 拷贝)
  useEffect(() => {
    if (!full) return;
    const stop = e => e.preventDefault();
    document.documentElement.classList.add('dg-lock');
    window.getSelection?.()?.removeAllRanges();
    document.addEventListener('selectstart', stop);
    document.addEventListener('contextmenu', stop);
    return () => {
      document.documentElement.classList.remove('dg-lock');
      document.removeEventListener('selectstart', stop);
      document.removeEventListener('contextmenu', stop);
    };
  }, [full]);
  const [homeTip] = useState(() => touch && IOS && !fromHomeScreen());

  function start() {
    if (touch) enterFull(); // must happen right on the tap
    sfx.unlock();           // so must starting the sound
    setMsg('');
    ensureName(async me => {
      // the server deals the seed with a signed ticket, so the run can be checked when it ends;
      // without one it's a practice run that doesn't count
      const t = await api('/api/dodge/start', 'POST', { name: me.name, token: me.token }).catch(() => null);
      setResult(null); setPaused(false); setStarted(false);
      setRun(x => ({ me: { name: me.name, token: me.token }, n: (x?.n || 0) + 1,
        ...(t?.ok ? { seed: t.seed, ticket: t.ticket } : { seed: Math.floor(Math.random() * 4294967296), ticket: null, practice: t?.error || '没连上服务器' }) }));
    });
  }
  // watch someone's best run again: the same seed and inputs play out the same way
  async function watch(who) {
    if (touch) enterFull(); // right on the tap
    sfx.unlock();
    setMsg('');
    const r = await api('/api/dodge/replay?name=' + encodeURIComponent(who)).catch(() => null);
    if (!r?.ok || r.v !== SIM_VERSION) {
      if (touch) leaveFull();
      setMsg(r?.ok ? '这条回放是旧版游戏录的，放不了了' : r?.error || '回放没加载出来，再试一次');
      return;
    }
    setResult(null); setPaused(false); setStarted(false);
    setRun(x => ({ replay: r, seed: r.seed, n: (x?.n || 0) + 1 }));
  }
  function again() { setResult(null); setPaused(false); setStarted(false); setRun(x => ({ ...x, n: x.n + 1 })); }
  async function submit(score) {
    const r = await sendScore(score);
    setResult(x => ({ ...x, server: r.ok ? r : null, error: r.ok ? '' : r.error, retry: !!r.retry }));
    if (r.ok) {
      showBoard(r);
      if (r.newBest && !reduceMotion) confetti({ particleCount: 140, spread: 90, origin: { y: 0.5 }, colors: CONFETTI_COLORS });
    }
  }
  function dead(sim, events) {
    if (run.replay) { setResult({ ticks: sim.tick, by: sim.by, replay: true }); return; }
    setResult({ ticks: sim.tick, by: sim.by, practice: run.ticket ? null : run.practice });
    // ticks only picks the best of several saved runs; the server replays the inputs for the score
    if (run.ticket) submit({ ...run.me, ticket: run.ticket, events, ticks: sim.tick });
  }
  function retry() {
    const p = pendingScore();
    setResult(x => ({ ...x, error: '', retry: false }));
    if (p) submit(p);
  }
  function quit() { setRun(null); setResult(null); setPaused(false); if (touch) leaveFull(); loadBoard(); }

  const mine = boardMe || board.find(r => name && r.name.toLowerCase() === name.toLowerCase());
  const overlay = result && (result.replay ? (
    <div className="dg-over">
      <div className="text-2xl font-extrabold">回放结束：{run.replay.name} 存活 {secs(result.ticks)} 秒</div>
      <div className="text-sm mt-1 text-slate-200">{killedBy(result.by)}</div>
      {run.replay.bot && <div className="dg-death-tip">{BOT_NOTE(run.replay.stats.medianMs)}</div>}
      <div className="flex gap-2 justify-center mt-3">
        <button onClick={again} className="dg-btn bg-amber-400 text-slate-900">再看一次</button>
        <button onClick={quit} className="dg-btn bg-white/15 text-white">退出</button>
      </div>
    </div>
  ) : (
    <div className="dg-over">
      <div className="text-2xl font-extrabold">阵亡！存活 {secs(result.server?.ticks ?? result.ticks)} 秒</div>
      <div className="text-sm mt-1 text-slate-200">{killedBy(result.server ? result.server.by : result.by)}</div>
      {result.by && <div className="dg-death-tip">{SKILLS[result.by].tip}</div>}
      <div className="text-sm mt-2 min-h-[1.25rem] text-amber-200">
        {result.practice ? `这局没记分：${result.practice}`
          : result.server ? (result.server.newBest ? `🎉 新纪录！排第 ${result.server.rank} 名` : `你的最好 ${secs(result.server.best)} 秒 · 第 ${result.server.rank} 名`)
          : result.error || '核对中…'}
      </div>
      {result.server?.bot && <div className="dg-death-tip">{BOT_NOTE(result.server.react)}</div>}
      <div className="flex gap-2 justify-center mt-3">
        {result.retry && <button onClick={retry} className="dg-btn bg-sky-400 text-slate-900">重新提交</button>}
        <button onClick={start} className="dg-btn bg-amber-400 text-slate-900">再来一局</button>
        <button onClick={quit} className="dg-btn bg-white/15 text-white">{touch ? '退出' : '看排行榜'}</button>
      </div>
    </div>
  ));
  const pause = paused && !result && (
    <div className="dg-over">
      {touch && portrait
        ? <><div className="text-4xl">📱↻</div><div className="text-lg font-bold mt-2">把手机横过来</div><div className="text-sm text-slate-300 mt-1">横屏才能玩，转过来就能继续</div>
            {homeTip && <div className="dg-tip mt-3">{HOME_TIP}</div>}</>
        : <><div className="text-lg font-bold">暂停了</div><button onClick={() => setPaused(false)} className="dg-btn bg-amber-400 text-slate-900 mt-3">继续</button></>}
      <button onClick={quit} className="dg-btn bg-white/15 text-white mt-2">不玩了</button>
    </div>
  );
  // the first run on an upright phone: wait for it to be turned before counting down
  const hold = paused || (touch && portrait);
  const game = run && (
    <DodgeGame key={run.n} seed={run.seed} touch={touch} hold={hold} onGo={() => setStarted(true)} onDead={dead} onPause={() => setPaused(true)}
      replay={run.replay?.events} replayName={run.replay?.name}>
      {overlay}{pause}
    </DodgeGame>
  );

  return (
    <div>
      <div className="grid lg:grid-cols-3 gap-5">
        <section className={run && !touch ? "lg:col-span-3" : "lg:col-span-2"}>
          {run && !touch ? <div className="dg-box">{game}</div> : (
            <div className="dg-intro rounded-2xl shadow-xl p-5 md:p-7 text-white">
              <DodgePreview />
              <div className="dg-intro-content">
              <div className="dg-eyebrow">峡谷训练场 / SURVIVAL</div>
              <div className="dg-title">鲁班七号<span>走位，才是生存之道。</span></div>
              <p className="dg-description">六位英雄的技能，全冲你而来。读懂前摇，躲开弹道，用一次闪现绝处逢生。</p>
              <div className="dg-rule-tags"><span>一击阵亡</span><span>难度递增</span><span>8 秒闪现 · 训练冷却</span></div>
              <ul className="mt-3 text-sm text-emerald-50/90 space-y-1">
                {touch
                  ? <><li>横屏游玩 · 左手摇杆走位</li><li>右手拖动闪现瞄准，松手释放；拖远取消</li></>
                  : <><li>🖱️ 鼠标右键点哪走哪（按住右键会一直跟着鼠标）</li><li>⌨️ F 或 D 闪现，朝鼠标方向跳一段，8 秒冷却</li></>}
                <li>观察地面预警，提前走位；闪现落点仍会受伤</li>
              </ul>
              {mine && <p className="mt-3 text-amber-200 font-bold">你的最好：{secs(mine.ticks)} 秒</p>}
              {homeTip && <p className="dg-tip mt-3">{HOME_TIP}</p>}
              <button onClick={start} className="dg-btn dg-start mt-4 text-lg">进入训练 <span aria-hidden="true">→</span></button>
              {msg && <p className="mt-2 text-sm text-amber-200">{msg}</p>}
              </div>
            </div>
          )}
          {!run && <p className="dg-roster-hint">🔊 点技能卡可以试听音效</p>}
          {!run && <div className="dg-roster" aria-label="敌方技能">
            {Object.entries(SKILLS).map(([kind, skill]) => <div key={kind} className={'dg-skill-card dg-skill-' + kind}
              role="button" tabIndex={0} aria-label={`试听${skill.who}的${skill.what}`} onClick={() => sfx.preview(kind)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sfx.preview(kind); } }}>
              <span className="dg-skill-seal" aria-hidden="true">{skill.who.slice(0, 1)}</span>
              <div><strong>{skill.who}<small>{skill.from ? `${skill.from} 秒后加入` : '开局登场'}</small></strong><span>{skill.what}</span></div>
              <p>{skill.tip}</p>
            </div>)}
          </div>}
        </section>
        <aside className="glass-card rounded-2xl p-5 self-start">
          <h2 className="font-bold text-lg mb-1">🏆 躲技能排行榜</h2>
          <p className="text-xs text-slate-500 mb-3">每人最好的一次 · {TOP_NOTE} · 新成绩由服务器重放核对 · 为了防止作弊，前三名的录像会被保存并公开（点 ▶ 看）</p>
          <BoardRows rows={board} me={boardMe} empty="还没人玩过，来当第一" row={(r, i, isMe) => (
            <div key={isMe ? 'me' : r.name} className={'flex items-center justify-between gap-2 border-b py-1.5 text-sm' + (isMe || (mine && r.name === mine.name) ? ' font-bold text-indigo-700' : '')}>
              <span className="truncate">{place(i)} {r.name}
                {r.bot && <span className="dg-bot-mark" title={BOT_NOTE(r.react)} aria-label={BOT_NOTE(r.react)}> 🤖</span>}</span>
              <span className="flex items-center gap-1.5">
                <span className="tabular-nums whitespace-nowrap">{secs(r.ticks)} 秒</span>
                {/* only the top 3's replays are public (the server hands out no others); below that, an empty slot keeps the times lined up */}
                {i >= 3 ? <span className="dg-watch dg-watch-none" aria-hidden="true" />
                  : r.replay
                  ? <button className="dg-watch" onClick={() => watch(r.name)} aria-label={`看 ${r.name} 的回放`} title="看回放">▶</button>
                  : <span className="dg-watch dg-watch-none" title="以前的纪录，没有回放" aria-hidden="true">·</span>}
              </span>
            </div>
          )} />
        </aside>
      </div>
      {full && createPortal(<div className="dg-full">{game}</div>, document.body)}
    </div>
  );
}
