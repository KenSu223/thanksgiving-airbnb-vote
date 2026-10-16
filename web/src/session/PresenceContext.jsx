import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useSession } from './SessionContext.jsx';

// 在线状态：整个 App 就这一条连线（WebSocket /api/presence）。规矩和
// 各个游戏的连线一样——页面看得见才连，藏起来 / 锁屏就断开，所以
// 「在线」就是「App 此刻开在谁的屏幕上」；断开那一刻就是 lastSeen。
// 连上之后：登录了就报名字（服务器核对 token，冒充不了别人），每
// 25 秒 ping 一下刷新自己的 lastSeen；服务器在有人来 / 走时广播
// 全员名单。没登录也能连，只能看名单，不能把自己挂上去。
const Ctx = createContext({ users: [] });
export const usePresence = () => useContext(Ctx);

const PING_MS = 25000;

export function PresenceProvider({ children }) {
  const { name, token } = useSession();
  const [users, setUsers] = useState([]);
  const ws = useRef(null), retry = useRef(0), ping = useRef(null);
  const cred = useRef({ name, token });
  cred.current = { name, token };

  const send = m => {
    if (ws.current && ws.current.readyState === 1) { ws.current.send(JSON.stringify(m)); return true; }
    return false;
  };
  const hello = () => {
    const c = cred.current;
    if (c.name && c.token) send({ type: 'hello', name: c.name, token: c.token });
  };

  const connect = useRef(null);
  connect.current = () => {
    if (ws.current || document.visibilityState !== 'visible') return;
    const s = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/presence');
    ws.current = s;
    s.onopen = () => {
      retry.current = 0;
      hello();
      clearInterval(ping.current);
      ping.current = setInterval(() => send({ type: 'ping' }), PING_MS);
    };
    s.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type === 'roster' && Array.isArray(m.users)) setUsers(m.users);
    };
    s.onclose = () => {
      if (ws.current === s) ws.current = null;
      clearInterval(ping.current);
      if (document.visibilityState === 'visible') setTimeout(() => connect.current(), Math.min(10000, 800 * 2 ** retry.current++));
    };
  };

  useEffect(() => {
    const onVis = () => (document.visibilityState === 'visible' ? connect.current() : ws.current?.close());
    connect.current();
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); ws.current?.close(); };
  }, []);
  // 登录 / 换了人：在同一条连线上重新报名字
  useEffect(() => { hello(); }, [name, token]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={{ users }}>{children}</Ctx.Provider>;
}
