import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../../session/SessionContext.jsx';
import { signedOut } from '../../lib/api.js';

// 2048 的连线（WebSocket /api/2048）：在这页、页面看得见时才连；连上就报上名字，
// 服务器回这个人正在玩的那局（没有就开一局）。onState 收到服务器发来的每条消息。
export function useG2048(active, onState) {
  const { name, token, epoch } = useSession();
  const [live, setLive] = useState(false);
  const ws = useRef(null), retry = useRef(0);
  const activeRef = useRef(active), cred = useRef({ name, token }), handler = useRef(onState);
  activeRef.current = active; cred.current = { name, token }; handler.current = onState;

  const wanted = () => activeRef.current && document.visibilityState === 'visible';
  const send = useCallback(m => {
    if (ws.current && ws.current.readyState === 1) { ws.current.send(JSON.stringify(m)); return true; }
    return false;
  }, []);
  const hello = useCallback(() => {
    const c = cred.current;
    if (c.name && c.token) send({ type: 'hello', name: c.name, token: c.token });
  }, [send]);

  const connect = useRef(null);
  connect.current = () => {
    if (ws.current || !wanted()) return;
    const s = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/2048');
    ws.current = s;
    s.onopen = () => { retry.current = 0; setLive(true); hello(); };
    s.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type === 'state') handler.current(m);
      if (/先登录/.test(m.error || '') && cred.current.name) signedOut(); // the name we gave wasn't taken: check the session
    };
    s.onclose = () => {
      if (ws.current === s) ws.current = null;
      setLive(false);
      if (wanted()) setTimeout(() => connect.current(), Math.min(10000, 800 * 2 ** retry.current++));
    };
  };

  useEffect(() => {
    const onVis = () => (wanted() ? connect.current() : ws.current?.close());
    if (active) connect.current(); else ws.current?.close();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [active]);
  useEffect(() => () => ws.current?.close(), []);
  // 登录 / 换了人 / 重新登录成同一个人（epoch）：重新报名字，拿这个人的那局
  useEffect(() => { hello(); }, [name, token, epoch, hello]);

  return { live, send };
}
