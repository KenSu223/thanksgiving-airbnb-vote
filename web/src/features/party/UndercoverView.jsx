import { useEffect, useState } from 'react';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { useParty, PartyFrame, TopBar, Banner, SeatGrid, SecretCard, VoteBar, SpeakBar, StartBar, StopButton, LogList, WinsBoard, Choice } from './PartyKit.jsx';

// 谁是卧底：每人一个词，卧底的词和大家的像但不一样（白板没有词）。轮流用一句话说自己的词（当面说，
// app 叫号），然后投票，票最多的出局并公布他是平民还是卧底。
const PHASES = { waiting: '等人', look: '看词', speak: '发言中', vote: '投票中', pk: '平票再说', pkvote: '平票投票', between: '下一轮', result: '这局结束' };
const auto = n => (n <= 6 ? 1 : n <= 10 ? 2 : 3);
const ROLE_TONE = { 平民: 'good', 卧底: 'bad', 白板: 'gold' };

export default function UndercoverView({ active }) {
  const p = useParty(active, { path: '/api/undercover', roomKey: 'ucRoom', game: 'undercover' });
  const { t, me, st, send, seated, inGame } = p;
  const [choice, setChoice] = useState(null);
  const voteKey = t?.vote ? t.phase + t.round : '';
  useEffect(() => setChoice(null), [voteKey]);
  const won = t?.phase === 'result' && t.result?.winners?.includes(me);
  useEffect(() => { if (won && !reduceMotion) confetti({ particleCount: 120, spread: 90, origin: { y: 0.6 }, colors: CONFETTI_COLORS }); }, [won, t?.game]);

  const n = t ? t.seats.filter(Boolean).length : 0;
  const players = t?.players || [];
  const outOf = i => t?.out?.find(o => o.seat === i);
  const reveal = t?.reveal;
  const badges = i => {
    if (reveal && reveal.roles[i]) return <span className={'pt-b ' + ROLE_TONE[reveal.roles[i]]}>{reveal.roles[i]}</span>;
    const o = outOf(i);
    return o ? <span className={'pt-b ' + ROLE_TONE[o.role]}>出局·{o.role}</span> : null;
  };
  const v = t?.vote;
  const pickable = v && v.voters.includes(me) && v.mine == null ? v.targets.filter(k => !(v.noSelf && k === me)) : null;

  let title = '谁是卧底', sub = '';
  if (t) {
    const ph = t.phase, sp = t.speaker;
    if (ph === 'waiting') { title = '等人坐下'; sub = n + ' 人 · 4–14 人能玩'; }
    else if (ph === 'look') { title = '看看你的词'; sub = '看好了点「看好了」（' + (t.looking?.ready.length || 0) + '/' + players.length + '）'; }
    else if ((ph === 'speak' || ph === 'pk') && sp >= 0) { title = '🎤 ' + (sp + 1) + ' 号 ' + (t.seats[sp]?.name || '') + (ph === 'pk' ? ' 再说一次' : ' 发言'); sub = '第 ' + t.round + ' 轮 · 用一句话说你的词，别说太明白'; }
    else if (ph === 'vote' || ph === 'pkvote') { title = ph === 'pkvote' ? '平票：在他们里面投一个' : '投票：你觉得谁是卧底？'; sub = '已投 ' + (v?.voted.length || 0) + '/' + (v?.voters.length || 0); }
    else if (ph === 'between') title = '下一轮马上开始';
    else if (ph === 'result') { title = t.result?.title || '这局结束'; sub = won ? '你赢了 🎉' : ''; }
  }

  const s = t?.settings || {};
  const settings = t && seated && !inGame && (
    <div className="pt-panel">
      <h3>设置（谁都能改）</h3>
      <Choice label="卧底人数" value={s.spies} options={[[0, '自动（' + auto(Math.max(4, n)) + '）'], [1, '1'], [2, '2'], [3, '3']]} onPick={x => send({ type: 'settings', settings: { spies: x } })} />
      <Choice label="白板" value={!!s.blank} options={[[false, '不要'], [true, '加 1 个']]} onPick={x => send({ type: 'settings', settings: { blank: x } })} />
      <Choice label="每人发言" value={s.speakSec} options={[[30, '30 秒'], [60, '60 秒'], [90, '90 秒'], [120, '2 分钟']]} onPick={x => send({ type: 'settings', settings: { speakSec: x } })} />
    </div>
  );

  const mine = t?.mine;
  const card = mine && (
    <SecretCard label={t.phase === 'result' ? '我的词' : '我的词（点开看）'}>
      {mine.blank
        ? <><div className="pt-word">你是白板</div><div className="pt-small">没有词：听别人怎么说，装作你也有</div></>
        : <><div className="pt-word">{mine.word}</div><div className="pt-small">{mine.role ? '你是' + mine.role : '你可能是平民，也可能是卧底'}</div></>}
    </SecretCard>
  );

  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2">
        <PartyFrame theme="undercover">
          <TopBar p={p} phases={PHASES} title="🕵️ 谁是卧底" />
          <Banner p={p} title={title} sub={sub} tone={t?.speaker === me && me >= 0 ? 'hot' : ''} />
          {t?.phase === 'look' && inGame && !t.looking?.ready.includes(me) && <div className="pt-actions"><button className="pt-btn main" onClick={() => send({ type: 'ready' })}>看好了</button></div>}
          <SpeakBar p={p} />
          <VoteBar p={p} choice={choice} setChoice={setChoice} />
          <StartBar p={p} label="开始（发词）" />
          {card}
          {t?.phase === 'result' && reveal && (
            <div className="pt-result">
              <div className="pt-result-title">{t.result.title}</div>
              <div className="text-sm mt-1">平民的词「{t.result.civWord}」 · 卧底的词「{t.result.spyWord}」</div>
              <div className="pt-reveal">
                {players.map(k => <div key={k} className={t.result.winners.includes(k) ? 'win' : ''}>{k + 1} 号 {t.seats[k]?.name || ''}：<b>{reveal.roles[k]}</b> · {reveal.words[k] || '（白板）'}</div>)}
              </div>
            </div>
          )}
          <SeatGrid p={p} badges={badges} pickable={pickable} picked={choice} onPick={setChoice} dim={i => inGameDead(t, i)} />
          {settings}
          {!seated && t && <p className="pt-hint">点一个空座位坐下{t.phase !== 'waiting' && t.phase !== 'result' ? '（这局已经开始了，下一局再坐）' : ''}。没坐下也能看，适合放桌上当播报机。</p>}
          <LogList log={t?.log} />
          <div className="flex justify-between items-center mt-2"><span className="text-xs opacity-60">{st && !p.live ? '连接断了，正在重连…' : p.msg}</span><StopButton p={p} /></div>
        </PartyFrame>
      </div>
      <WinsBoard title="谁是卧底 胜场榜" rows={st?.board || []}>
        <p><b>怎么玩：</b>每人点开看自己的词（别给旁边的人看）。卧底的词和大家的很像但不一样，白板没有词。谁也不知道自己是不是卧底。</p>
        <p className="mt-1">轮到你时用一句话描述你的词，别太直白（卧底会听出来），也别太含糊（会被当成卧底）。一轮说完大家投票，票最多的出局，公布他是平民还是卧底；平票就让平票的人再说一次再投，还平就这轮没人出局。</p>
        <p className="mt-1">卧底（和白板）全出局平民赢；卧底人数追上平民，或者只剩 3 个人时卧底还在，卧底赢。</p>
      </WinsBoard>
    </div>
  );
}

const inGameDead = (t, i) => !!t && t.players?.includes(i) && t.alive && !t.alive[i] && t.phase !== 'waiting';
