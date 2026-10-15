import { useEffect, useState } from 'react';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { useParty, PartyFrame, TopBar, Banner, SeatGrid, SecretCard, StartBar, StopButton, LogList, WinsBoard, Choice } from './PartyKit.jsx';

// 阿瓦隆：好人（梅林、派西维尔、忠臣）对坏人（刺客、莫甘娜、莫德雷德、奥伯伦、爪牙）。
// 队长选人 → 所有人公开投票 → 队员暗中出成功 / 失败；三个任务定胜负，好人赢了还要躲过刺客的一刀。
const PHASES = { waiting: '等人', look: '看身份', team: '选队员', teamvote: '组队投票', quest: '做任务', lady: '湖中仙女', assassin: '刺杀梅林', result: '这局结束' };
const CN = ['一', '二', '三', '四', '五'];
const nums = list => list.map(k => k + 1).join('、') + ' 号';

export default function AvalonView({ active }) {
  const p = useParty(active, { path: '/api/avalon', roomKey: 'avRoom', game: 'avalon' });
  const { t, me, st, send, seated, inGame } = p;
  const [choice, setChoice] = useState(null);
  const pickKey = t ? t.phase + ':' + t.q + ':' + t.lady : '';
  useEffect(() => setChoice(null), [pickKey]);
  const won = t?.phase === 'result' && t.result?.winners?.includes(me);
  useEffect(() => { if (won && !reduceMotion) confetti({ particleCount: 120, spread: 90, origin: { y: 0.6 }, colors: CONFETTI_COLORS }); }, [won, t?.game]);

  const n = t ? t.seats.filter(Boolean).length : 0;
  const players = t?.players || [];
  const mine = t?.mine, reveal = t?.reveal, v = t?.vote;
  const leader = t?.leader ?? -1, ph = t?.phase;
  const amLeader = inGame && leader === me && ph === 'team';
  const onTeam = (t?.team || []).includes(me);

  const badges = i => {
    const b = [];
    if (reveal?.roles[i]) b.push(<span key="r" className={'pt-b ' + (reveal.evil[i] ? 'bad' : 'good')}>{reveal.roles[i]}</span>);
    if (inGame || ph === 'result') {
      if (leader === i && TEAM_PHASES.includes(ph)) b.push(<span key="l" className="pt-b gold" title="队长">👑</span>);
      if (t.team?.includes(i) && ['team', 'teamvote', 'quest'].includes(ph)) b.push(<span key="t" className="pt-b good" title="在队伍里">🛡</span>);
      if (t.ladyOn && t.lady === i && ph !== 'result') b.push(<span key="w" className="pt-b" title="湖中仙女">🌊</span>);
      if (t.evilShown?.includes(i)) b.push(<span key="e" className="pt-b bad">{t.assassin === i ? '🗡 刺客' : '😈'}</span>);
      if (ph === 'team' && t.lastVote) b.push(<span key="v" className="pt-b" title="上次组队投票">{t.lastVote.no.includes(i) ? '❌' : '✅'}</span>);
    }
    return b;
  };

  // which seats can be tapped, and what the tap means
  let pickable = null, picked = choice, onPick = setChoice;
  if (amLeader) { pickable = players; picked = t.team; onPick = k => send({ type: 'pick', seat: k }); }
  else if (ph === 'lady' && t.lady === me && inGame) pickable = players.filter(k => k !== me && !t.ladyUsed.includes(k));
  else if (ph === 'assassin' && t.assassin === me) pickable = players.filter(k => k !== me && !(t.evilShown || []).includes(k));

  let title = '阿瓦隆', sub = '';
  if (t) {
    const size = t.sizes?.[t.q];
    if (ph === 'waiting') { title = '等人坐下'; sub = n + ' 人 · 5–10 人是官方规则，11–14 人用扩展规则'; }
    else if (ph === 'look') { title = '看看你的身份'; sub = '看好了点「看好了」（' + (t.looking?.ready.length || 0) + '/' + players.length + '）'; }
    else if (ph === 'team') { title = amLeader ? '👑 你是队长：选 ' + size + ' 个人' : '👑 ' + (leader + 1) + ' 号队长在选人'; sub = '第' + CN[t.q] + '个任务 · ' + size + ' 人' + (t.twoFails === t.q ? ' · 两张失败才算失败' : '') + (t.rejects ? ' · 已连续否决 ' + t.rejects + ' 次' : ''); }
    else if (ph === 'teamvote') { title = '赞成这个队伍吗？'; sub = '队伍：' + nums(t.team) + ' · 已投 ' + (v?.voted.length || 0) + '/' + players.length; }
    else if (ph === 'quest') { title = onTeam ? '你在任务里：出成功还是失败？' : '⚔️ ' + nums(t.team) + '在做任务'; sub = '已出 ' + (v?.voted.length || 0) + '/' + t.team.length; }
    else if (ph === 'lady') { title = t.lady === me ? '🌊 湖中仙女在你手上：选一个人查验' : '🌊 ' + (t.lady + 1) + ' 号在用湖中仙女'; sub = '查过的人不能再查'; }
    else if (ph === 'assassin') { title = t.assassin === me ? '🗡 你是刺客：指认梅林' : '🗡 刺客在指认梅林'; sub = '坏人亮出身份，可以一起商量'; }
    else if (ph === 'result') { title = t.result?.title || '这局结束'; sub = won ? '你赢了 🎉' : ''; }
  }

  const actions = t && inGame && (() => {
    if (ph === 'look' && !t.looking?.ready.includes(me)) return <button className="pt-btn main" onClick={() => send({ type: 'ready' })}>看好了</button>;
    if (amLeader) return <><span className="pt-hint">点座位选人（{t.team.length}/{t.sizes[t.q]}），大家可以先商量</span><button className="pt-btn main" disabled={t.team.length !== t.sizes[t.q]} onClick={() => send({ type: 'propose' })}>提交队伍</button></>;
    if (ph === 'teamvote') return v?.mine != null
      ? <span className="pt-hint">你投了{v.mine === 1 ? '赞成' : '反对'}，等别人（{v.voted.length}/{v.voters.length}）</span>
      : <><button className="pt-btn good" onClick={() => send({ type: 'vote', target: 1 })}>✅ 赞成</button><button className="pt-btn bad" onClick={() => send({ type: 'vote', target: 0 })}>❌ 反对</button></>;
    if (ph === 'quest' && onTeam) return v?.mine != null
      ? <span className="pt-hint">你出了{v.mine === 1 ? '成功' : '失败'}，等队友</span>
      : <><button className="pt-btn good" onClick={() => send({ type: 'vote', target: 1 })}>成功</button><button className="pt-btn bad" disabled={!mine?.evil} onClick={() => send({ type: 'vote', target: 0 })}>失败</button>{!mine?.evil && <span className="pt-hint">好人只能出成功</span>}</>;
    if (ph === 'lady' && t.lady === me) return <><span className="pt-hint">{choice != null ? '选了 ' + (choice + 1) + ' 号' : '点一个座位'}</span><button className="pt-btn main" disabled={choice == null} onClick={() => send({ type: 'lady', seat: choice })}>查验{choice != null ? ' ' + (choice + 1) + ' 号' : ''}</button></>;
    if (ph === 'assassin' && t.assassin === me) return <><span className="pt-hint">{choice != null ? '选了 ' + (choice + 1) + ' 号' : '点你觉得是梅林的人'}</span><button className="pt-btn bad" disabled={choice == null} onClick={() => { if (window.confirm('指认 ' + (choice + 1) + ' 号是梅林？只有一次机会')) send({ type: 'assassinate', seat: choice }); }}>指认{choice != null ? ' ' + (choice + 1) + ' 号' : ''}</button></>;
    return null;
  })();

  const s = t?.settings || {};
  const settings = t && seated && !inGame && (
    <div className="pt-panel">
      <h3>角色（谁都能改）</h3>
      <Choice label="派西维尔" value={!!s.percival} options={[[true, '有'], [false, '没有']]} onPick={x => send({ type: 'settings', settings: { percival: x } })} />
      <Choice label="莫甘娜" value={!!s.morgana} options={[[true, '有'], [false, '没有']]} onPick={x => send({ type: 'settings', settings: { morgana: x } })} />
      <Choice label="莫德雷德" value={!!s.mordred} options={[[true, '有'], [false, '没有']]} onPick={x => send({ type: 'settings', settings: { mordred: x } })} />
      <Choice label="奥伯伦" value={!!s.oberon} options={[[true, '有'], [false, '没有']]} onPick={x => send({ type: 'settings', settings: { oberon: x } })} />
      <Choice label="湖中仙女" value={!!s.lady} options={[[true, '7 人以上用'], [false, '不用']]} onPick={x => send({ type: 'settings', settings: { lady: x } })} />
    </div>
  );

  const card = mine && (
    <SecretCard label="我的身份（点开看）" tone={mine.evil ? 'evil' : 'good'}>
      <div className="pt-word">{mine.evil ? '😈 ' : '🛡 '}{mine.role}</div>
      <div className="pt-small">{mine.evil ? '坏人：让三个任务失败，或者在最后刺中梅林' : '好人：完成三个任务' + (mine.key === 'merlin' ? '，别让刺客认出你' : '')}</div>
      {mine.knows?.see?.length > 0 && <div className="pt-know">{mine.knows.as}：<b>{nums(mine.knows.see)}</b></div>}
      {mine.knows?.note && <div className="pt-small">{mine.knows.note}</div>}
      {mine.ladySeen?.map(x => <div key={x.seat} className="pt-know">🌊 你查过 {x.seat + 1} 号：<b>{x.evil ? '坏人' : '好人'}</b></div>)}
    </SecretCard>
  );

  const track = t && t.sizes && (
    <div className="av-track">
      {t.sizes.map((size, q) => {
        const r = t.quests[q];
        return (
          <div key={q} className={'av-quest' + (r ? (r.ok ? ' ok' : ' fail') : q === t.q && TEAM_PHASES.includes(ph) ? ' now' : '')} title={r ? nums(r.team) + ' · ' + r.fails + ' 张失败' : ''}>
            <span className="av-size">{r ? (r.ok ? '✓' : '✗') : size}</span>
            <span className="av-cap">{r ? r.fails + ' 败' : t.twoFails === q ? '2 败' : '任务' + CN[q]}</span>
          </div>
        );
      })}
      <div className="av-rejects" title="连续否决（到 5 次坏人赢）">{[0, 1, 2, 3, 4].map(k => <i key={k} className={k < t.rejects ? 'on' : ''} />)}</div>
    </div>
  );

  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2">
        <PartyFrame theme="avalon">
          <TopBar p={p} phases={PHASES} title="🏰 阿瓦隆" />
          <Banner p={p} title={title} sub={sub} tone={amLeader || (ph === 'quest' && onTeam) || (ph === 'lady' && t.lady === me) || (ph === 'assassin' && t.assassin === me) ? 'hot' : ''} />
          {actions && <div className="pt-actions">{actions}</div>}
          <StartBar p={p} label="开始（发身份）" />
          {track}
          {card}
          {ph === 'result' && reveal && (
            <div className="pt-result">
              <div className="pt-result-title">{t.result.title}</div>
              {t.assassinGuess >= 0 && <div className="text-sm mt-1">刺客指认了 {t.assassinGuess + 1} 号</div>}
              <div className="pt-reveal">
                {players.map(k => <div key={k} className={t.result.winners.includes(k) ? 'win' : ''}>{k + 1} 号 {t.seats[k]?.name || ''}：<b>{reveal.roles[k]}</b></div>)}
              </div>
            </div>
          )}
          <SeatGrid p={p} badges={badges} pickable={pickable} picked={picked} onPick={onPick} />
          {t?.lastVote && inGame && ph !== 'teamvote' && (
            <p className="pt-hint">上次组队 {nums(t.lastVote.team)}：赞成 {t.lastVote.yes.length ? nums(t.lastVote.yes) : '无'} · 反对 {t.lastVote.no.length ? nums(t.lastVote.no) : '无'}</p>
          )}
          {settings}
          {!seated && t && <p className="pt-hint">点一个空座位坐下{inGameLike(ph) ? '（这局已经开始了，下一局再坐）' : ''}。</p>}
          <LogList log={t?.log} />
          <div className="flex justify-between items-center mt-2"><span className="text-xs opacity-60">{st && !p.live ? '连接断了，正在重连…' : p.msg}</span><StopButton p={p} /></div>
        </PartyFrame>
      </div>
      <WinsBoard title="阿瓦隆 胜场榜" rows={st?.board || []}>
        <p><b>怎么玩：</b>好人要完成三个任务，坏人要让三个任务失败。每轮队长选人，所有人公开投票赞成 / 反对（过半数才通过，连续否决五次坏人赢）。队员暗中出成功或失败，好人只能出成功，一张失败任务就失败（7 人以上第四个任务要两张）。</p>
        <p className="mt-1">梅林知道坏人是谁（看不到莫德雷德），派西维尔知道谁可能是梅林（莫甘娜会冒充），坏人互相认识（奥伯伦除外）。好人完成三个任务后，刺客还有一次机会：指认中梅林，坏人翻盘。</p>
        <p className="mt-1">湖中仙女（7 人以上）：第二、三、四个任务后，拿着的人可以偷看一个人是好是坏，然后交给他。</p>
        <p className="mt-1 text-slate-400">11–14 人是扩展规则（官方只到 10 人）：坏人和队伍都多一些。</p>
      </WinsBoard>
    </div>
  );
}
const TEAM_PHASES = ['team', 'teamvote', 'quest'];
const inGameLike = ph => ph && ph !== 'waiting' && ph !== 'result';
