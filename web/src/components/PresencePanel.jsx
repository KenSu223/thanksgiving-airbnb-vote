import { useEffect, useState } from 'react';
import { usePresence } from '../session/PresenceContext.jsx';
import { useSession } from '../session/SessionContext.jsx';
import './presence.css';

// 大家的在线状态：绿点 = 此刻开着 App；不在线就写最后一次在线是多久
// 以前（刚刚 / N 分钟前 / N 小时前 / N 天前；从没来过就写「还没来过」）。
// 名单是服务器排好的（在线的在前，再按最近在线排）。每 30 秒自己
// 重算一次「多久以前」，页面开着放着数字也会往前走。
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

export default function PresencePanel() {
  const { users } = usePresence();
  const { name } = useSession();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  if (!users.length) return null;
  const online = users.filter(u => u.online).length;
  return (
    <section className="presence" aria-label="大家的在线状态">
      <div className="presence-head">
        <span>大家</span>
        <span className="presence-count">{online} 人在线</span>
      </div>
      <ul className="presence-list">
        {users.map(u => (
          <li key={u.name} className="presence-row">
            <span className={'presence-dot' + (u.online ? ' on' : '')} aria-hidden="true" />
            <span className="presence-name">{u.name}{u.name === name ? '（我）' : ''}</span>
            <span className="presence-when">{u.online ? '在线' : agoText(u.lastSeen, now)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
