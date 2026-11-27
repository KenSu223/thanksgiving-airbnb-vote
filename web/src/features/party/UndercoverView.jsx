import { useEffect, useRef, useState } from 'react';
import { confetti, CONFETTI_COLORS } from '../../lib/confetti.js';
import { reduceMotion } from '../../lib/motion.js';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import { useParty, PartyFrame, TopBar, Banner, SeatGrid, SecretCard, LogList, WinsBoard, Choice } from './PartyKit.jsx';
import { ReactionBar } from '../games/Reactions.jsx';

// 谁是卧底：有一个真人主持人。主持人坐主持位（不算玩家），自己想好平民的词和卧底的词写进来，
// 定几个卧底、几个白板（随机分，或者点座位指定），然后发词。每个人只看到自己的词。
// 描述、讨论、投票都当面来；谁被投出去由主持人点，app 显示他是什么身份（不显示词）。
// 全程手动：不念、不计时、不自动往下走；哪边赢了 app 会提醒，由主持人点结束。
const PHASES = { waiting: '等人', playing: '进行中', result: '这局结束' };
const ROLE_TONE = { 平民: 'good', 卧底: 'bad', 白板: 'gold' };
const CYCLE = { undefined: 'spy', spy: 'blank', blank: 'civ' }; // 指定模式：点一下 平民 → 卧底 → 白板 → 平民
const PICK_LABEL = { spy: '卧底', blank: '白板' };

export default function UndercoverView({ active }) {
  const p = useParty(active, { path: '/api/undercover', roomKey: 'ucRoom', game: 'undercover', voice: false });
  const { t, me, st, send, seated, sit, standUp } = p;
  const confirm = useConfirm();
  const isMc = !!t?.isMc, ph = t?.phase;
  const won = ph === 'result' && t.result?.winners?.includes(me);
  useEffect(() => { if (won && !reduceMotion) confetti({ particleCount: 120, spread: 90, origin: { y: 0.6 }, colors: CONFETTI_COLORS }); }, [won, t?.game]);

  // the host's words: typed locally, sent a moment after typing stops (and on leaving the box)
  const setup = t?.setup;
  const [words, setWords] = useState({ civWord: '', spyWord: '' });
  const typing = useRef(false), timer = useRef(null);
  useEffect(() => { if (setup && !typing.current) setWords({ civWord: setup.civWord, spyWord: setup.spyWord }); }, [setup?.civWord, setup?.spyWord]); // eslint-disable-line react-hooks/exhaustive-deps
  const typeWord = (k, v) => {
    typing.current = true; setWords(w => ({ ...w, [k]: v }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { typing.current = false; send({ type: 'settings', settings: { [k]: v } }); }, 500);
  };
  const flushWords = () => { if (!typing.current) return; clearTimeout(timer.current); typing.current = false; send({ type: 'settings', settings: words }); };
  useEffect(() => () => clearTimeout(timer.current), []);

  const n = t ? t.seats.filter(Boolean).length : 0;
  const players = t?.players || [];
  const reveal = t?.reveal;
  const playing = ph === 'playing';
  const picking = isMc && !playing && setup?.mode === 'pick';
  const roleOf = i => t?.all?.find(a => a.seat === i);
  const outOf = i => t?.out?.find(o => o.seat === i);
  const badges = i => {
    if (reveal?.roles[i]) return <span className={'pt-b ' + ROLE_TONE[reveal.roles[i]]}>{reveal.roles[i]}</span>;
    const o = outOf(i);
    if (o) return <span className={'pt-b ' + ROLE_TONE[o.role]}>出局·{o.role}</span>;
    const a = roleOf(i); // the host sees everyone's role and word
    if (a) return <span className={'pt-b ' + ROLE_TONE[a.role]}>{a.role}{a.word ? '·' + a.word : ''}</span>;
    const pk = picking && setup.picks[i];
    if (pk) return <span className={'pt-b ' + (pk === 'spy' ? 'bad' : 'gold')}>{PICK_LABEL[pk]}</span>;
    return null;
  };
  const dim = i => players.includes(i) && t?.alive && !t.alive[i] && ph !== 'waiting';

  // what tapping a seat does: the host picks 卧底 / 白板 before the game, and taps who's out during it
  let pickable = null, onPick = null;
  if (picking) { pickable = t.seats.map((s, i) => (s ? i : -1)).filter(i => i >= 0); onPick = i => send({ type: 'settings', settings: { pick: { seat: i, role: CYCLE[setup.picks[i]] } } }); }
  else if (isMc && playing) {
    pickable = players.filter(k => t.alive[k]);
    onPick = async i => { if (await confirm({ title: (i + 1) + ' 号 ' + (t.seats[i]?.name || '') + ' 出局？', message: '大家投出去的是 TA 吧？点错了可以撤销。', confirmText: '出局' })) send({ type: 'out', seat: i }); };
  }

  let title = '谁是卧底', sub = '';
  if (t) {
    if (ph === 'waiting') {
      if (!t.mc) { title = '先请一个人当主持人'; sub = '主持人坐主持位，自己想词、发词、点谁出局（不算玩家）'; }
      else if (isMc) { title = '写好两个词，定好卧底和白板，点「发词」'; sub = n + ' 个玩家 · 至少 4 个'; }
      else { title = '等主持人 ' + t.mc.name + ' 发词'; sub = n + ' 个玩家 · 点空座位坐下'; }
    } else if (playing) {
      title = isMc ? '投出去了谁，就点谁' : '看你的词，当面轮流描述、投票';
      sub = (t.counts ? t.counts.spies + ' 个卧底' + (t.counts.blanks ? '、' + t.counts.blanks + ' 个白板' : '') + ' · ' : '') + '场上还有 ' + players.filter(k => t.alive[k]).length + ' 人';
    } else if (ph === 'result') { title = t.result?.title || '这局结束'; sub = won ? '你赢了 🎉' : ''; }
  }

  // the host chair
  const mc = t?.mc;
  const chair = t && (
    <div className="pt-panel uc-chair">
      <span className="uc-chair-title">🎙 主持位</span>
      {mc ? <span className="uc-chair-name">{mc.name}{mc.me ? '（你）' : ''}{!mc.connected && ' · 掉线了'}</span> : <span className="pt-hint">空着</span>}
      {!mc && !(seated && playing && players.includes(me)) && <button className="pt-btn main" onClick={() => sit({ host: true })}>我来当主持人</button>}
      {mc && !mc.connected && playing && !players.includes(me) && !isMc && <button className="pt-btn main" onClick={() => sit({ host: true })}>接替主持</button>}
      {isMc && !playing && <button className="pt-btn" onClick={standUp}>让出主持位</button>}
    </div>
  );

  // the host's setup, before a game
  const setupPanel = isMc && !playing && setup && (
    <div className="pt-panel">
      <h3>主持人设置（只有你看得到）</h3>
      <div className="uc-words">
        <label>平民的词<input value={words.civWord} maxLength={20} onChange={e => typeWord('civWord', e.target.value)} onBlur={flushWords} placeholder="比如 牛奶" /></label>
        <label>卧底的词<input value={words.spyWord} maxLength={20} onChange={e => typeWord('spyWord', e.target.value)} onBlur={flushWords} placeholder="比如 豆浆" /></label>
      </div>
      <Choice label="怎么分" value={setup.mode} options={[['random', '随机'], ['pick', '我来指定']]} onPick={x => send({ type: 'settings', settings: { mode: x } })} />
      {setup.mode === 'random' ? <>
        <Choice label="卧底人数" value={setup.spies} options={[0, 1, 2, 3, 4, 5, 6].map(x => [x, String(x)])} onPick={x => send({ type: 'settings', settings: { spies: x } })} />
        <Choice label="白板人数" value={setup.blanks} options={[0, 1, 2, 3, 4, 5, 6].map(x => [x, String(x)])} onPick={x => send({ type: 'settings', settings: { blanks: x } })} />
      </> : <p className="pt-hint">点下面的座位：点一下变卧底，再点变白板，再点变回平民（玩家看不到）。</p>}
      <div className="pt-actions">
        <button className="pt-btn main" onClick={() => { flushWords(); send({ type: 'deal' }); }}>发词</button>
        <span className="pt-hint">发出去以后每个人只看得到自己的词</span>
      </div>
    </div>
  );

  // the host's controls during a game
  const winner = t?.winner;
  const hostPanel = isMc && playing && (
    <div className="pt-panel">
      <h3>主持人（只有你看得到）</h3>
      <p className="pt-hint">平民的词「<b>{t.words?.civ}</b>」{t.words?.spy ? <> · 卧底的词「<b>{t.words.spy}</b>」</> : null} · 点座位标记谁被投出去</p>
      {winner && <p className="pt-hint strong">按规则{winner === 'civ' ? '平民' : '卧底'}已经赢了，可以结束了</p>}
      <div className="pt-actions">
        <button className="pt-btn" onClick={() => send({ type: 'undo' })} disabled={!t.out?.length}>撤销上一次出局</button>
        <button className="pt-btn good" onClick={async () => { if (await confirm({ title: '平民赢？', message: '结束这局，平民赢（记进胜场榜）。', confirmText: '平民赢' })) send({ type: 'end', side: 'civ' }); }}>平民赢</button>
        <button className="pt-btn bad" onClick={async () => { if (await confirm({ title: '卧底赢？', message: '结束这局，卧底（和白板）赢（记进胜场榜）。', confirmText: '卧底赢' })) send({ type: 'end', side: 'spy' }); }}>卧底赢</button>
        <button className="pt-link" onClick={async () => { if (await confirm({ title: '结束这局，不算输赢？', message: '亮出所有人的身份和词，不记胜负。', confirmText: '结束' })) send({ type: 'end', side: null }); }}>结束不算</button>
      </div>
    </div>
  );

  const mine = t?.mine;
  const card = mine && (
    <SecretCard label={ph === 'result' ? '我的词' : '我的词（点开看）'}>
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
          <Banner p={p} title={title} sub={sub} tone={isMc ? 'hot' : ''} />
          {chair}
          {setupPanel}
          {hostPanel}
          {card}
          {ph === 'result' && reveal && (
            <div className="pt-result">
              <div className="pt-result-title">{t.result.title}</div>
              <div className="text-sm mt-1">平民的词「{reveal.civWord}」{reveal.spyWord ? ' · 卧底的词「' + reveal.spyWord + '」' : ''}</div>
              <div className="pt-reveal">
                {players.map(k => <div key={k} className={t.result.winners.includes(k) ? 'win' : ''}>{k + 1} 号 {t.seats[k]?.name || ''}：<b>{reveal.roles[k]}</b> · {reveal.words[k] || '（白板）'}</div>)}
              </div>
              {isMc && <p className="pt-hint mt-2">想好下一组词，就可以再来一局</p>}
            </div>
          )}
          <SeatGrid p={p} badges={badges} pickable={pickable} picked={null} onPick={onPick} dim={dim} />
          {!seated && t && !mc && <p className="pt-hint">没有主持人就开不了局：谁来想词谁就坐主持位。</p>}
          {!seated && t && (ph === 'waiting' || ph === 'result') && <p className="pt-hint">玩家点一个空座位坐下。</p>}
          <LogList log={t?.log} />
          <div className="flex justify-between items-center mt-2"><span className="text-xs opacity-60">{st && !p.live ? '连接断了，正在重连…' : p.msg}</span></div>
          <ReactionBar send={send} active={active} />
        </PartyFrame>
      </div>
      <WinsBoard title="谁是卧底 胜场榜" rows={st?.board || []} me={st?.boardMe}>
        <p><b>怎么玩：</b>先有一个人坐主持位当主持人（不算玩家）。主持人自己想一对像但不一样的词，写进来，定几个卧底、几个白板（随机，或者点座位指定），点「发词」。</p>
        <p className="mt-1">每个人点开看自己的词（别给旁边的人看）。卧底的词和大家的很像但不一样，白板没有词，谁也不知道自己是不是卧底。大家当面轮流描述、讨论、投票，投出去的人由主持人点一下，app 显示他是平民、卧底还是白板。</p>
        <p className="mt-1">卧底（和白板）全出局平民赢；卧底人数追上平民，或者只剩 3 个人时卧底还在，卧底赢——app 会提醒主持人，由主持人点结束。</p>
      </WinsBoard>
    </div>
  );
}
