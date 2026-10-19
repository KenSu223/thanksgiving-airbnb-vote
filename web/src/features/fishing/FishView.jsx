import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../lib/api.js';
import { load, save } from '../../lib/storage.js';
import { useSession } from '../../session/SessionContext.jsx';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { SIM_VERSION, KINDS, KIND_KEYS, target } from './sim.js';
import FishGame from './FishGame.jsx';
import KindIcon from './KindIcon.jsx';
import { BoardRows, place, TOP_NOTE } from '../games/TopBoard.jsx';
import * as sfx from './sfx.js';
import './fishing.css';

// 小小钓鱼：一个人玩，小船上的鱼线左右摆，看准了放下去，钓各种各样的鱼。每关 60 秒，
// 金币够了目标就进商店、下一关；不够就结束。成绩是最后的金币，全时间排行榜；
// 钓到过的每一种都记进自己的图鉴。手机上开打就铺满整个屏幕（竖着玩）。
const coins = n => '🪙 ' + n.toLocaleString('en-US');
const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const ENDS = { fail: '时间到，没够目标', quit: '结算了', time: '玩太久了（45 分钟），自动结算' };
const GROUPS = [['fish', '🐟 鱼'], ['bed', '🐚 海底宝贝'], ['junk', '🗑️ 垃圾']];

// 交成绩和躲技能一样：开局时服务器发一张签了名的「票」（种子在里面），这局的每个操作都记下来；
// 结束以后把票和操作交上去，服务器自己重放一遍算出金币，那才是成绩（verify.js）。
// 网络不通时先存在这台设备上（只留最好的那次），点「重新提交」或者下次打开这页时再交。
const PENDING = 'fishPending';
const pendingScore = () => {
  try { const p = JSON.parse(load(PENDING) || 'null'); return p && p.ticket && Array.isArray(p.events) ? p : null; } catch (e) { return null; }
};
async function sendScore(s) {
  let r = null;
  try { r = await api('/api/fish/score', 'POST', s); } catch (e) { /* offline */ }
  if (r && r.ok) {
    const p = pendingScore();
    if (p && p.name === s.name && p.money <= s.money) save(PENDING, '');
    return r;
  }
  if (r) return r; // a real refusal (not logged in…): nothing to retry
  const p = pendingScore();
  if (!p || p.name !== s.name || p.money < s.money) save(PENDING, JSON.stringify(s));
  return { ok: false, retry: true, error: '网络有点问题，成绩先存在这台设备上' };
}

// What this run caught, as little icons with counts
function Catch({ caught }) {
  const kinds = KIND_KEYS.filter(k => caught?.[k]);
  if (!kinds.length) return <div className="text-xs text-sky-100/70 mt-2">这局什么都没钓到</div>;
  return (
    <div className="fh-catch" aria-label="这局钓到">
      {kinds.map(k => <span key={k} title={KINDS[k].label}><KindIcon kind={k} w={34} h={24} label={KINDS[k].label} /><b>×{caught[k]}</b></span>)}
    </div>
  );
}

export default function FishView({ active }) {
  const { name, token, ensureName } = useSession();
  const [board, setBoard] = useState([]);
  const [boardMe, setBoardMe] = useState(null);
  const [mineKinds, setMineKinds] = useState([]); // every kind I've ever caught (my 图鉴)
  const showBoard = useCallback(r => { setBoard(r.board || []); setBoardMe(r.boardMe || null); if (r.kinds) setMineKinds(r.kinds); }, []);
  // while playing: { me, seed, ticket, practice?, n }; while watching: { replay, seed, n }
  const [run, setRun] = useState(null);
  const [result, setResult] = useState(null); // { money, level, cleared, end, caught, server?, error?, retry?, practice?, replay? }
  const [msg, setMsg] = useState('');
  const [touch] = useState(isTouch);
  const [paused, setPaused] = useState(false);

  const loadBoard = useCallback(() => api('/api/fish/board?name=' + encodeURIComponent(name || '') + '&token=' + encodeURIComponent(token || ''))
    .then(r => r.ok && showBoard(r)).catch(() => {}), [name, token, showBoard]);
  useEffect(() => { if (!name) setMineKinds([]); }, [name]);
  useEffect(() => {
    if (!active) return;
    const p = pendingScore();
    if (p) sendScore(p).then(r => (r.ok ? showBoard(r) : loadBoard()));
    else loadBoard();
  }, [active, loadBoard, showBoard]);
  // leaving the page or switching apps pauses the run
  const playing = run && !run.replay && !result;
  useEffect(() => { if (playing && !active) setPaused(true); }, [playing, active]);
  useEffect(() => {
    const f = () => { if (document.hidden && playing) setPaused(true); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [playing]);
  const full = touch && !!run;
  // on a computer, bring the whole field into view when a run starts
  const boxRef = useRef(null);
  useEffect(() => { if (run && !touch) boxRef.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }); }, [run, touch]);
  // while a run fills the phone screen: no scrolling, no text selection / long-press menu
  useEffect(() => {
    if (!full) return;
    const stop = e => e.preventDefault();
    document.documentElement.classList.add('fh-lock');
    window.getSelection?.()?.removeAllRanges();
    document.addEventListener('selectstart', stop);
    document.addEventListener('contextmenu', stop);
    return () => {
      document.documentElement.classList.remove('fh-lock');
      document.removeEventListener('selectstart', stop);
      document.removeEventListener('contextmenu', stop);
    };
  }, [full]);

  function start() {
    sfx.unlock(); // must happen right on the tap
    setMsg('');
    ensureName(async me => {
      // the server deals the seed with a signed ticket, so the run can be checked when it ends;
      // without one it's a practice run that doesn't count
      const t = await api('/api/fish/start', 'POST', { name: me.name, token: me.token }).catch(() => null);
      setResult(null); setPaused(false);
      setRun(x => ({ me: { name: me.name, token: me.token }, n: (x?.n || 0) + 1,
        ...(t?.ok ? { seed: t.seed, ticket: t.ticket } : { seed: Math.floor(Math.random() * 4294967296), ticket: null, practice: t?.error || '没连上服务器' }) }));
    });
  }
  // watch someone's best run again: the same seed and inputs play out the same way
  async function watch(who) {
    sfx.unlock();
    setMsg('');
    const r = await api('/api/fish/replay?name=' + encodeURIComponent(who)).catch(() => null);
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
      if (((r.newBest && r.money > 0) || r.newKinds?.length) && !reduceMotion) confetti({ particleCount: 140, spread: 90, origin: { y: 0.5 }, colors: CONFETTI_COLORS });
    }
  }
  function done(sim, events) {
    const res = { money: sim.money, level: sim.level, cleared: sim.cleared, end: sim.end, caught: { ...sim.caught } };
    if (run.replay) { setResult({ ...res, replay: true }); return; }
    setResult({ ...res, practice: run.ticket ? null : run.practice });
    // money only picks the best of several saved runs; the server replays the inputs for the score
    if (run.ticket) submit({ ...run.me, ticket: run.ticket, events, money: sim.money });
  }
  function retry() {
    const p = pendingScore();
    setResult(x => ({ ...x, error: '', retry: false }));
    if (p) submit(p);
  }
  function quit() { setRun(null); setResult(null); setPaused(false); loadBoard(); }

  const mine = boardMe || board.find(r => name && r.name.toLowerCase() === name.toLowerCase());
  const reached = r => (r.cleared ? `过了 ${r.cleared} 关` : '第 1 关没过');
  const newKinds = result?.server?.newKinds || [];
  const overlay = result && (result.replay ? (
    <div className="fh-over">
      <div className="text-2xl font-extrabold">回放结束：{run.replay.name} {coins(result.money)}</div>
      <div className="text-sm mt-1 text-sky-100/90">{reached(result)} · {ENDS[result.end] || ''}</div>
      <Catch caught={result.caught} />
      <div className="flex gap-2 justify-center mt-3">
        <button onClick={again} className="fh-btn fh-btn-sun">再看一次</button>
        <button onClick={quit} className="fh-btn fh-btn-dim">退出</button>
      </div>
    </div>
  ) : (
    <div className="fh-over">
      <div className="text-sm text-sky-100/90">{ENDS[result.end] || '结束了'}{result.end === 'fail' ? `（第 ${result.level} 关要 ${coins(target(result.level))}）` : ''}</div>
      <div className="text-3xl font-extrabold mt-1 text-amber-300">{coins(result.server?.money ?? result.money)}</div>
      <div className="text-sm mt-1">{reached(result.server || result)}</div>
      <Catch caught={result.caught} />
      {newKinds.length > 0 && <div className="fh-new">📖 新进图鉴：{newKinds.map(k => KINDS[k]?.label || k).join('、')}</div>}
      <div className="text-sm mt-2 min-h-[1.25rem] text-amber-200">
        {result.practice ? `这局没记分：${result.practice}`
          : result.server ? (result.server.newBest ? `🎉 新纪录！排第 ${result.server.rank} 名` : `你的最好 ${coins(result.server.best)} · 第 ${result.server.rank} 名`)
          : result.error || '核对中…'}
      </div>
      <div className="flex gap-2 justify-center mt-3 flex-wrap">
        {result.retry && <button onClick={retry} className="fh-btn fh-btn-sky">重新提交</button>}
        <button onClick={start} className="fh-btn fh-btn-sun">再来一局</button>
        <button onClick={quit} className="fh-btn fh-btn-dim">{touch ? '退出' : '看排行榜'}</button>
      </div>
    </div>
  ));
  const game = run && (
    <FishGame key={run.n} seed={run.seed} touch={touch} paused={paused} onPause={() => setPaused(true)} onResume={() => setPaused(false)}
      onDone={done} onLeave={quit} replay={run.replay?.events} replayName={run.replay?.name}>
      {overlay}
    </FishGame>
  );
  const got = new Set(mineKinds);

  return (
    <div>
      <div className="grid lg:grid-cols-3 gap-5">
        <section className="lg:col-span-2">
          {run && !touch ? <div ref={boxRef} className="fh-box">{game}</div> : (
            <>
              <div className="fh-intro rounded-2xl shadow-xl p-5 md:p-7 text-white">
                <div className="fh-intro-art" aria-hidden="true">
                  <i /><b />
                  <span className="fh-swim fh-swim-a"><KindIcon kind="clown" w={54} h={38} swim={!reduceMotion} /></span>
                  <span className="fh-swim fh-swim-b"><KindIcon kind="angel" w={44} h={52} swim={!reduceMotion} /></span>
                </div>
                <div className="fh-intro-content">
                  <div className="fh-eyebrow">LITTLE FISHING · 钓鱼</div>
                  <div className="fh-title">小小钓鱼<span>看准了再放线。</span></div>
                  <p className="fh-description">鱼线在小船下左右摆，点一下就放下去。各种鱼在不同的深度游来游去，越大越值钱、也越重；海底还有珍珠、宝箱和垃圾。每关 60 秒，金币够了目标才能进下一关。</p>
                  <div className="fh-rule-tags"><span>每关 60 秒</span><span>{KIND_KEYS.length} 种可以钓</span><span>商店买道具</span></div>
                  <ul className="mt-3 text-sm text-sky-50/90 space-y-1">
                    <li>{touch ? '👆 点水面放线' : '🖱️ 点画面，或者按 ↓ / 空格放线'}；鱼会游，要算好提前量</li>
                    <li>✂️ 钓到靴子、礁石这种不想要的，{touch ? '点 ✂️' : '点 ✂️ 或按 ↑'} 剪断线，钩子马上空着回来</li>
                    <li>🐉 龙鱼在最深处，第 3 关起才有，游得飞快，值 800</li>
                    <li>🏪 过关进商店；买东西花的金币会从成绩里扣掉</li>
                  </ul>
                  {mine && <p className="mt-3 text-amber-200 font-bold">你的最好：{coins(mine.money)}（{reached(mine)}）</p>}
                  <button onClick={start} className="fh-btn fh-start mt-4 text-lg">开始钓鱼 <span aria-hidden="true">→</span></button>
                  {msg && <p className="mt-2 text-sm text-amber-200">{msg}</p>}
                </div>
              </div>
              {!run && (
                <div className="fh-dex glass-card rounded-2xl p-4 mt-4">
                  <div className="flex items-baseline justify-between gap-2 mb-2">
                    <h3 className="font-bold">📖 我的图鉴</h3>
                    <span className="text-xs text-slate-500">{name ? `钓到过 ${got.size} / ${KIND_KEYS.length} 种` : '登录以后记下你钓到过的'}</span>
                  </div>
                  {GROUPS.map(([group, title]) => (
                    <div key={group} className="mb-2">
                      <div className="text-xs font-bold text-slate-500 mb-1">{title}</div>
                      <div className="fh-dex-grid">
                        {KIND_KEYS.filter(k => KINDS[k].group === group).map(k => (
                          <div key={k} className={'fh-dex-card' + (got.has(k) ? ' got' : '')}>
                            <KindIcon kind={k} w={64} h={44} className="fh-dex-icon" label={KINDS[k].label} />
                            <b>{KINDS[k].label}</b>
                            <span className="fh-dex-value">{k === 'chest' ? '🪙 ？' : coins(KINDS[k].value)}</span>
                            <small>{got.has(k) ? KINDS[k].note : '还没钓到'}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
        <aside className="glass-card rounded-2xl p-5 self-start">
          <h2 className="font-bold text-lg mb-1">🏆 小小钓鱼排行榜</h2>
          <p className="text-xs text-slate-500 mb-3">每人最好的一局（最后剩下的金币）· {TOP_NOTE} · 成绩由服务器重放核对 · 前三名的录像公开（点 ▶ 看）· 「种」是图鉴里钓到过几种</p>
          <BoardRows rows={board} me={boardMe} empty="还没人钓过，来当第一" row={(r, i, isMe) => (
            <div key={isMe ? 'me' : r.name} className={'flex items-center justify-between gap-2 border-b py-1.5 text-sm' + (isMe || (mine && r.name === mine.name) ? ' font-bold text-indigo-700' : '')}>
              <span className="truncate">{place(i)} {r.name}</span>
              <span className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400 whitespace-nowrap">{r.kinds || 0} 种 · {reached(r)}</span>
                <span className="tabular-nums whitespace-nowrap">{coins(r.money)}</span>
                {i >= 3 ? <span className="fh-watch fh-watch-none" aria-hidden="true" />
                  : r.replay
                  ? <button className="fh-watch" onClick={() => watch(r.name)} aria-label={`看 ${r.name} 的回放`} title="看回放">▶</button>
                  : <span className="fh-watch fh-watch-none" aria-hidden="true">·</span>}
              </span>
            </div>
          )} />
        </aside>
      </div>
      {full && createPortal(<div className="fh-full">{game}</div>, document.body)}
    </div>
  );
}
