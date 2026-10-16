import { useEffect, useState } from 'react';
import { usePresence } from '../session/PresenceContext.jsx';
import { useSession } from '../session/SessionContext.jsx';
import './presence.css';

// 大家的在线状态：绿点 = 此刻开着 App，在线的就只有这个点、不写字；
// 不在线的在右边用小灰字写最后一次在线是多久以前（刚刚 / N 分钟前 /
// N 小时前 / N 天前；从没来过就写「还没来过」）。
// 名单是服务器排好的（在线的在前，再按最近在线排）。每 30 秒自己
// 重算一次「多久以前」，页面开着放着数字也会往前走。
// showGame（游戏 tab 的那份名单）：在线的人要是在玩游戏，右边用小
// 灰字写「在玩 X」——key 和 GamesView 的 GAMES 对齐，服务器只认这几个。
const GAME_LABELS = { bj: 'Blackjack', ddz: '斗地主', gd: '掼蛋', mj: '川麻', dodge: '鲁班躲技能', 2048: '2048', uc: '谁是卧底', av: '阿瓦隆', ww: '狼人杀' };
export function agoText(lastSeen, now) {
  if (!lastSeen) return '还没来过';
  const s = Math.max(0, Math.floor((now - lastSeen) / 1000));
  if (s < 45) return '刚刚在线';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export default function PresencePanel({ fold = false, showGame = false }) {
  const { users } = usePresence();
  const { name } = useSession();
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(!fold); // fold 的默认收起，只露标题那行
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  if (!users.length) return null;
  const online = users.filter(u => u.online).length;
  const head = (
    <>
      <span>大家</span>
      <span className="presence-right">
        <span className="presence-count">{online} 人在线</span>
        {fold && <span className="presence-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>}
      </span>
    </>
  );
  return (
    <section className="presence" aria-label="大家的在线状态">
      {fold ? (
        <button type="button" className="presence-head presence-foldbtn" aria-expanded={open} onClick={() => setOpen(o => !o)}>{head}</button>
      ) : (
        <div className="presence-head">{head}</div>
      )}
      {open && (
      <ul className="presence-list">
        {users.map(u => (
          <li key={u.name} className="presence-row">
            <span className={'presence-dot' + (u.online ? ' on' : '')} aria-hidden="true" />
            <span className="presence-name">{u.name}{u.name === name ? '（我）' : ''}</span>
            {u.online
              ? (showGame && u.game && <span className="presence-when">在玩{GAME_LABELS[u.game] || u.game}</span>)
              : <span className="presence-when">{agoText(u.lastSeen, now)}</span>}
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}
