import { useState } from 'react';
import { load, save } from '../../lib/storage.js';
import BlackjackView from '../blackjack/BlackjackView.jsx';
import DdzView from '../ddz/DdzView.jsx';
import GuandanView from '../guandan/GuandanView.jsx';
import MahjongView from '../mahjong/MahjongView.jsx';
import DodgeView from '../dodge/DodgeView.jsx';
import G2048View from '../g2048/G2048View.jsx';
import AvalonView from '../party/AvalonView.jsx';
import UndercoverView from '../party/UndercoverView.jsx';

// Gameroom：几个小游戏放在一个标签页里，每个有自己的筹码 / 豆子榜。
// 每个游戏一直挂着（切走只是藏起来），各自按 active 决定连不连服务器。
const GAMES = [
  { key: 'bj', label: '🃏 Blackjack', View: BlackjackView },
  { key: 'ddz', label: '👑 斗地主', View: DdzView },
  { key: 'gd', label: '🥚 掼蛋', View: GuandanView },
  { key: 'mj', label: '🀄 川麻', View: MahjongView },
  { key: 'dodge', label: '🎯 鲁班躲技能', View: DodgeView },
  { key: '2048', label: '🔢 2048', View: G2048View },
  { key: 'uc', label: '🕵️ 谁是卧底', View: UndercoverView },
  { key: 'av', label: '🏰 阿瓦隆', View: AvalonView },
];

export default function GamesView({ active }) {
  const [game, setGame] = useState(() => (GAMES.some(g => g.key === load('game')) ? load('game') : 'bj'));
  const pick = g => { setGame(g); save('game', g); };
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-5">
        {GAMES.map(g => (
          <button key={g.key} onClick={() => pick(g.key)}
            className={'rounded-full px-5 py-2 font-bold ' + (g.key === game ? 'bg-indigo-600 text-white shadow' : 'glass-pill text-slate-600')}>{g.label}</button>
        ))}
      </div>
      {GAMES.map(({ key, View }) => <div key={key} hidden={game !== key}><View active={active && game === key} /></div>)}
    </>
  );
}
