import { useEffect, useState } from 'react';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { useParty, PartyFrame, TopBar, Banner, SeatGrid, SecretCard, VoteBar, SpeakBar, StartBar, StopButton, LogList, WinsBoard, Choice } from './PartyKit.jsx';
import { ReactionBar } from '../games/Reactions.jsx';

// 狼人杀：app 当上帝——每一步都念出来（开着播报的设备），等该行动的人在手机上选，夜里谁死了天亮再说。
// 晚上大家都看着自己的手机：轮到的角色有按钮，其他人只看到「天黑请闭眼」。
const PHASES = { waiting: '等人', look: '看身份', night: '天黑', guard: '天黑', wolf: '天黑', witch: '天黑', seer: '天黑', dawn: '天亮', signup: '竞选警长', sheriffSpeak: '竞选发言', sheriffPk: '竞选 PK', sheriffVote: '选警长', sheriffPkVote: '选警长', skill: '技能', badge: '移交警徽', order: '发言顺序', speak: '发言', pk: 'PK 发言', last: '遗言', vote: '放逐投票', pkvote: 'PK 投票', dusk: '天要黑了', result: '这局结束' };
const ROLE_NAMES = { wolf: '狼人', villager: '村民', seer: '预言家', witch: '女巫', hunter: '猎人', guard: '守卫', idiot: '白痴' };
const ICON = { wolf: '🐺', villager: '👨‍🌾', seer: '🔮', witch: '🧪', hunter: '🔫', guard: '🛡', idiot: '🤪' };
const ABOUT = {
  wolf: '晚上和同伴一起杀一个人；白天藏好自己，可以自爆',
  villager: '没有技能，靠发言和投票找出狼人',
  seer: '每晚查验一个人是好人还是狼人',
  witch: '一瓶解药（救今晚被杀的人）、一瓶毒药，一晚只能用一瓶',
  hunter: '死的时候可以开枪带走一个人（被毒死不行）',
  guard: '每晚守护一个人不被狼杀，不能连着两晚守同一个人',
  idiot: '白天被投出去时翻牌免死，之后不能投票',
};
const NIGHT_ROLE = { guard: '守卫', wolf: '狼人', witch: '女巫', seer: '预言家' };
const GODS = ['seer', 'witch', 'hunter', 'guard', 'idiot'];
const nums = list => list.map(k => k + 1).join('、') + ' 号';

export default function WerewolfView({ active }) {
  const p = useParty(active, { path: '/api/werewolf', roomKey: 'wwRoom', game: 'werewolf' });
  const { t, me, st, send, seated, inGame } = p;
  const [choice, setChoice] = useState(null);
  const stepKey = t ? t.phase + ':' + t.nightNo + ':' + t.day + ':' + (t.speaker ?? '') : '';
  useEffect(() => setChoice(null), [stepKey]);
  const won = t?.phase === 'result' && t.result?.winners?.includes(me);
  useEffect(() => { if (won && !reduceMotion) confetti({ particleCount: 140, spread: 100, origin: { y: 0.6 }, colors: CONFETTI_COLORS }); }, [won, t?.game]);

  const n = t ? t.seats.filter(Boolean).length : 0;
  const players = t?.players || [];
  const mine = t?.mine, ph = t?.phase, reveal = t?.reveal, v = t?.vote;
  const alive = i => !!t?.alive?.[i];
  const live = players.filter(alive);
  const acting = !!mine?.acting;

  const badges = i => {
    const b = [];
    if (reveal?.roles[i]) b.push(<span key="r" className={'pt-b ' + (reveal.wolves[i] ? 'bad' : 'good')}>{reveal.roles[i]}</span>);
    if (!t || !(inGame || ph === 'result' || (t.players.length && ph !== 'waiting'))) return b;
    if (players.includes(i) && !alive(i)) b.push(<span key="d" className="pt-b" title="出局了">💀</span>);
    if (t.sheriff === i) b.push(<span key="s" className="pt-b gold" title="警长">👮 警长</span>);
    if (t.idiotShown === i) b.push(<span key="i" className="pt-b" title="白痴已翻牌，不能投票">🤪 白痴</span>);
    if (t.candidates?.includes(i)) b.push(<span key="c" className="pt-b talk">🙋 上警</span>);
    if (t.withdrawn?.includes(i)) b.push(<span key="w" className="pt-b">退水</span>);
    if (mine?.wolves?.includes(i) && i !== me && !reveal) b.push(<span key="t" className="pt-b bad" title="狼同伴">🐺</span>);
    const chk = mine?.checks?.filter(c => c.seat === i).at(-1);
    if (chk && !reveal) b.push(<span key="k" className={'pt-b ' + (chk.wolf ? 'bad' : 'good')}>{chk.wolf ? '查杀' : '金水'}</span>);
    const picks = mine?.picks?.filter(([, x]) => x === i).map(([w]) => w + 1);
    if (picks?.length) b.push(<span key="p" className="pt-b bad" title={'刀这个人的狼：' + picks.join('、') + ' 号'}>🔪{picks.join(',')}</span>);
    return b;
  };
  const dim = i => players.includes(i) && !alive(i) && ph !== 'waiting';

  // tapping seats: what can be picked now
  let pickable = null;
  if (acting && ph === 'guard') pickable = live.filter(k => k !== mine.guardLast);
  else if (acting && ph === 'wolf') pickable = live;
  else if (acting && ph === 'witch' && mine.potions?.poison) pickable = live.filter(k => k !== me);
  else if (acting && ph === 'seer') pickable = live.filter(k => k !== me && !mine.checks?.some(c => c.seat === k));
  else if (ph === 'skill' && mine?.canShoot) pickable = live;
  else if (ph === 'badge' && t.badgeFrom === me) pickable = live;
  else if (v && v.voters.includes(me) && v.mine == null) pickable = v.targets.filter(k => !(v.noSelf && k === me));
  const onPick = k => { if (acting && ph === 'wolf') send({ type: 'kill', seat: k }); else setChoice(k); };
  const myWolfPick = mine?.picks?.find(([w]) => w === me)?.[1];
  const picked = acting && ph === 'wolf' ? myWolfPick : choice;

  // the banner
  let title = '狼人杀', sub = '', tone = '';
  if (t) {
    const sp = t.speaker;
    if (ph === 'waiting') { title = '等人坐下'; sub = n + ' 人 · 6–14 人能玩'; }
    else if (ph === 'look') { title = '看看你的身份'; sub = '看好了点「看好了」（' + (t.looking?.ready.length || 0) + '/' + players.length + '）'; }
    else if (ph === 'night') title = '🌙 天黑请闭眼';
    else if (NIGHT_ROLE[ph] && !acting) { title = '🌙 天黑请闭眼'; sub = NIGHT_ROLE[ph] + '行动中…'; }
    else if (acting && ph === 'guard') { title = '🛡 守卫：今晚守护谁？'; sub = '点一个人，或者空守' + (mine.guardLast >= 0 ? ' · 昨晚守了 ' + (mine.guardLast + 1) + ' 号，今晚不能再守他' : ''); tone = 'hot'; }
    else if (acting && ph === 'wolf') { title = '🐺 狼人：今晚杀谁？'; sub = '点一个人（同伴能看到你选了谁），意见一致就定了'; tone = 'hot'; }
    else if (acting && ph === 'witch') {
      title = '🧪 女巫：要用药吗？'; tone = 'hot';
      sub = mine.witchSaw == null ? '解药用过了，你不知道今晚谁被杀' : mine.witchSaw < 0 ? '今晚没有人被杀' : '今晚 ' + (mine.witchSaw + 1) + ' 号被杀了';
    } else if (acting && ph === 'seer') { title = '🔮 预言家：查验谁？'; sub = '点一个人，马上告诉你他是好人还是狼人'; tone = 'hot'; }
    else if (ph === 'dawn') title = '☀️ 天亮了';
    else if (ph === 'signup') { title = '👮 竞选警长'; sub = '想当警长的点「上警」· 警长一票算 1.5 票'; }
    else if ((ph === 'sheriffSpeak' || ph === 'sheriffPk') && sp >= 0) { title = '🎤 ' + (sp + 1) + ' 号竞选发言'; sub = '上警：' + (t.candidates.length ? nums(t.candidates) : '没人了'); }
    else if (ph === 'sheriffVote' || ph === 'sheriffPkVote') { title = '投票选警长'; sub = '已投 ' + (v?.voted.length || 0) + '/' + (v?.voters.length || 0); }
    else if (ph === 'skill') { title = mine?.canShoot ? '🔫 你是猎人：要开枪吗？' : '请 ' + (t.skillSeat + 1) + ' 号确认是否发动技能'; tone = mine?.canShoot ? 'hot' : ''; }
    else if (ph === 'badge') { title = t.badgeFrom === me ? '👮 你要把警徽交给谁？' : '👮 警长 ' + (t.badgeFrom + 1) + ' 号移交警徽'; tone = t.badgeFrom === me ? 'hot' : ''; }
    else if (ph === 'order') { title = t.sheriff === me ? '👮 你是警长：选发言顺序' : '👮 警长选择发言顺序'; tone = t.sheriff === me ? 'hot' : ''; }
    else if ((ph === 'speak' || ph === 'pk') && sp >= 0) { title = '🎤 ' + (sp + 1) + ' 号 ' + (t.seats[sp]?.name || '') + (ph === 'pk' ? ' PK 发言' : ' 发言'); sub = '第 ' + t.day + ' 天'; tone = sp === me ? 'hot' : ''; }
    else if (ph === 'last' && sp >= 0) { title = '🕯 ' + (sp + 1) + ' 号发表遗言'; tone = sp === me ? 'hot' : ''; }
    else if (ph === 'vote' || ph === 'pkvote') { title = ph === 'pkvote' ? 'PK 投票' : '放逐投票：投出你怀疑的人'; sub = '已投 ' + (v?.voted.length || 0) + '/' + (v?.voters.length || 0) + (t.sheriff >= 0 ? ' · 警长 1.5 票' : ''); }
    else if (ph === 'dusk') title = '🌆 天要黑了';
    else if (ph === 'result') { title = t.result?.title || '这局结束'; sub = won ? '你赢了 🎉' : ''; }
  }

  // the buttons for this moment
  const leftOf = s => { const l = live.filter(k => k !== s); return l.find(k => k > s) ?? l[0]; };
  const rightOf = s => { const l = live.filter(k => k !== s); return [...l].reverse().find(k => k < s) ?? l[l.length - 1]; };
  const actions = t && (() => {
    if (ph === 'look' && inGame && !t.looking?.ready.includes(me)) return <button className="pt-btn main" onClick={() => send({ type: 'ready' })}>看好了</button>;
    if (acting && ph === 'guard') return <><button className="pt-btn main" disabled={choice == null} onClick={() => send({ type: 'guard', seat: choice })}>守护{choice != null ? ' ' + (choice + 1) + ' 号' : ''}</button><button className="pt-btn" onClick={() => send({ type: 'guard', seat: -1 })}>空守</button></>;
    if (acting && ph === 'wolf') return <><span className="pt-hint">{myWolfPick != null ? '你选了 ' + (myWolfPick >= 0 ? (myWolfPick + 1) + ' 号' : '空刀') + '，等同伴' : '点一个座位'}</span><button className="pt-btn" onClick={() => send({ type: 'kill', seat: -1 })}>空刀</button></>;
    if (acting && ph === 'witch') {
      const canSave = mine.potions?.save && mine.witchSaw >= 0 && (mine.witchSaw !== me || mine.witchSelf);
      return <>
        {canSave && <button className="pt-btn good" onClick={() => send({ type: 'witch', use: 'save' })}>💊 救 {mine.witchSaw + 1} 号</button>}
        {mine.potions?.poison && <button className="pt-btn bad" disabled={choice == null} onClick={() => send({ type: 'witch', use: 'poison', seat: choice })}>☠️ 毒{choice != null ? ' ' + (choice + 1) + ' 号' : '（先点一个人）'}</button>}
        <button className="pt-btn" onClick={() => send({ type: 'witch', use: 'none' })}>不用药</button>
        {mine.witchSaw === me && !mine.witchSelf && <span className="pt-hint">女巫不能救自己</span>}
      </>;
    }
    if (acting && ph === 'seer') return <button className="pt-btn main" disabled={choice == null} onClick={() => send({ type: 'check', seat: choice })}>查验{choice != null ? ' ' + (choice + 1) + ' 号' : ''}</button>;
    if (ph === 'seer' && mine?.key === 'seer' && mine.checks?.length && mine.checks.at(-1).night === t.nightNo) {
      const c = mine.checks.at(-1);
      return <span className="pt-hint strong">{c.seat + 1} 号是{c.wolf ? '狼人 🐺' : '好人 ✅'}</span>;
    }
    if (ph === 'signup' && inGame) {
      const on = t.candidates.includes(me);
      return <><button className={'pt-btn ' + (on ? 'main' : '')} onClick={() => send({ type: 'signup', yes: true })}>🙋 上警{on ? ' ✓' : ''}</button><button className={'pt-btn ' + (!on && t.signed?.includes(me) ? 'main' : '')} onClick={() => send({ type: 'signup', yes: false })}>不上警</button></>;
    }
    if (ph === 'skill' && mine?.canShoot) return <><button className="pt-btn bad" disabled={choice == null} onClick={() => send({ type: 'shoot', seat: choice })}>🔫 带走{choice != null ? ' ' + (choice + 1) + ' 号' : '（先点一个人）'}</button><button className="pt-btn" onClick={() => send({ type: 'shoot', seat: -1 })}>不开枪</button></>;
    if (ph === 'badge' && t.badgeFrom === me) return <><button className="pt-btn main" disabled={choice == null} onClick={() => send({ type: 'badge', seat: choice })}>交给{choice != null ? ' ' + (choice + 1) + ' 号' : '…'}</button><button className="pt-btn bad" onClick={() => send({ type: 'badge', seat: -1 })}>撕掉警徽</button></>;
    if (ph === 'order' && t.sheriff === me) return <><button className="pt-btn main" onClick={() => send({ type: 'order', dir: 'cw' })}>从 {leftOf(me) + 1} 号开始 ↻</button><button className="pt-btn main" onClick={() => send({ type: 'order', dir: 'ccw' })}>从 {rightOf(me) + 1} 号开始 ↺</button><span className="pt-hint">警长最后说</span></>;
    return null;
  })();

  const s = t?.settings || {};
  const counts = t?.counts || {};
  const custom = !!s.roles;
  const setRoles = patch => send({ type: 'settings', settings: { roles: { ...counts, ...patch } } });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const settings = t && seated && !inGame && (
    <div className="pt-panel">
      <h3>角色和规则（谁都能改）</h3>
      <Choice label="角色" value={custom} options={[[false, '按人数推荐'], [true, '自己配']]} onPick={x => send({ type: 'settings', settings: { roles: x ? counts : null } })} />
      <p className="pt-hint">{Object.entries(counts).map(([r, c]) => ROLE_NAMES[r] + (c > 1 ? '×' + c : '')).join('、')}（{total} 个角色，现在 {n} 人{total !== n ? '，对不上' : ''}）</p>
      {custom && <>
        <Choice label="狼人" value={counts.wolf || 0} options={[1, 2, 3, 4, 5].map(x => [x, String(x)])} onPick={x => setRoles({ wolf: x })} />
        <Choice label="村民" value={counts.villager || 0} options={[0, 1, 2, 3, 4, 5, 6].map(x => [x, String(x)])} onPick={x => setRoles({ villager: x })} />
        {GODS.map(r => <Choice key={r} label={ICON[r] + ' ' + ROLE_NAMES[r]} value={counts[r] || 0} options={[[1, '有'], [0, '没有']]} onPick={x => setRoles({ [r]: x })} />)}
      </>}
      <Choice label="警长" value={s.sheriff ?? null} options={[[null, '自动（9 人以上）'], [true, '要'], [false, '不要']]} onPick={x => send({ type: 'settings', settings: { sheriff: x } })} />
      <Choice label="每人发言" value={s.speakSec} options={[[60, '1 分钟'], [90, '90 秒'], [120, '2 分钟'], [180, '3 分钟']]} onPick={x => send({ type: 'settings', settings: { speakSec: x } })} />
      <Choice label="女巫自救" value={!!s.witchSelf} options={[[false, '不能'], [true, '第一晚可以']]} onPick={x => send({ type: 'settings', settings: { witchSelf: x } })} />
    </div>
  );

  const card = mine && (
    <SecretCard label="我的身份（点开看）" tone={mine.wolf ? 'evil' : 'good'}>
      <div className="pt-word">{ICON[mine.key]} {mine.role}</div>
      <div className="pt-small">{ABOUT[mine.key]}{!mine.alive ? ' · 你已经出局了' : ''}</div>
      {mine.wolves && mine.wolves.length > 1 && <div className="pt-know">狼同伴：<b>{nums(mine.wolves.filter(k => k !== me))}</b></div>}
      {mine.potions && <div className="pt-know">解药 {mine.potions.save ? '✅' : '用过了'} · 毒药 {mine.potions.poison ? '✅' : '用过了'}</div>}
      {mine.checks?.map(c => <div key={c.night} className="pt-know">第 {c.night} 晚：{c.seat + 1} 号是 <b>{c.wolf ? '狼人' : '好人'}</b></div>)}
    </SecretCard>
  );

  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2">
        <PartyFrame theme={'werewolf' + (t?.isNight ? ' night' : '')}>
          <TopBar p={p} phases={PHASES} title="🐺 狼人杀" />
          <Banner p={p} title={title} sub={sub} tone={tone} />
          {actions && <div className="pt-actions">{actions}</div>}
          <SpeakBar p={p} />
          {(ph === 'sheriffSpeak' || ph === 'sheriffPk') && t.candidates.includes(me) && <div className="pt-actions"><button className="pt-btn" onClick={() => send({ type: 'withdraw' })}>退水（不竞选了）</button></div>}
          <VoteBar p={p} choice={choice} setChoice={setChoice} />
          <StartBar p={p} label="开始（发身份）" />
          {mine?.canBoom && <div className="pt-actions"><button className="pt-btn bad" onClick={() => { if (window.confirm('自爆？你会出局，今天直接天黑')) send({ type: 'boom' }); }}>💥 自爆</button></div>}
          {card}
          {ph === 'result' && reveal && (
            <div className="pt-result">
              <div className="pt-result-title">{t.result.title}</div>
              <div className="pt-reveal">
                {players.map(k => <div key={k} className={t.result.winners.includes(k) ? 'win' : ''}>{k + 1} 号 {t.seats[k]?.name || ''}：<b>{reveal.roles[k]}</b></div>)}
              </div>
              {reveal.history?.length > 0 && (
                <div className="ww-history">
                  {reveal.history.map(h => (
                    <div key={h.night}>第 {h.night} 晚：{[h.guard >= 0 && '守 ' + (h.guard + 1) + ' 号', '刀 ' + (h.kill >= 0 ? (h.kill + 1) + ' 号' : '空'), h.save && '救了', h.poison >= 0 && '毒 ' + (h.poison + 1) + ' 号', h.check >= 0 && '查 ' + (h.check + 1) + ' 号'].filter(Boolean).join(' · ')}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          <SeatGrid p={p} badges={badges} pickable={pickable} picked={picked} onPick={onPick} dim={dim} />
          {settings}
          {!seated && t && <p className="pt-hint">🎙 这台设备可以当「上帝」：不用坐下，打开播报，放在桌子中间。要玩就点一个空座位{t.phase !== 'waiting' && t.phase !== 'result' ? '（这局已经开始了，下一局再坐）' : ''}。</p>}
          <LogList log={t?.log} />
          <div className="flex justify-between items-center mt-2"><span className="text-xs opacity-60">{st && !p.live ? '连接断了，正在重连…' : p.msg}</span><StopButton p={p} /></div>
          <ReactionBar send={send} active={active} />
        </PartyFrame>
      </div>
      <WinsBoard title="狼人杀 胜场榜" rows={st?.board || []}>
        <p><b>app 当上帝：</b>每一步都会念出来（开着「播报」的设备念，一桌开一台就够；可以放一台不坐下的手机或平板在桌子中间）。晚上大家都看自己的手机，轮到你的角色才有按钮，别人只看到「天黑请闭眼」。</p>
        <p className="mt-1"><b>晚上：</b>守卫 → 狼人 → 女巫 → 预言家。死了的角色也照样叫，等一会儿再闭眼，听不出谁还活着。同守同救会死。女巫{s.witchSelf ? '第一晚可以' : '不能'}自救。</p>
        <p className="mt-1"><b>白天：</b>{t?.sheriffOn ? '第一天先竞选警长（警长一票算 1.5 票，发言顺序由他定，他最后说）。' : ''}公布昨晚谁死了（不说怎么死的），第一晚死的人有遗言。大家依次发言，然后投票放逐，平票的人再说一次再投，还平就没人出局。被投出去的有遗言；猎人（没被毒死）可以开枪；白痴翻牌免死但以后不能投票。狼人白天可以自爆，直接天黑。</p>
        <p className="mt-1"><b>输赢（屠边）：</b>狼人全出局好人赢；村民全出局或者神职全出局狼人赢。</p>
      </WinsBoard>
    </div>
  );
}
