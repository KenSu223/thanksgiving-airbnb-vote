import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../../session/SessionContext.jsx';
import { signedOut } from '../../lib/api.js';
import { setSeated } from '../../lib/seated.js';

// 21 点：牌局都在服务器（Durable Object）里，这里只负责连线。
// 不在 21 点页面、也没坐下就不连：没人连着时 Durable Object 能休息，省免费额度。
export function useBlackjack(active) {
  const { name, token, ensureName, openLogin, epoch } = useSession();
  const [st, setSt] = useState(null); // 服务器发来的 { table, you, board } + 收到的时间 at
  const [live, setLive] = useState(false);
  const [msg, setMsg] = useState('');
  const ws = useRef(null), retry = useRef(0), msgTimer = useRef(null);
  const wantSeat = useRef(false), satConfirmed = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const credRef = useRef({ name, token });
  credRef.current = { name, token };
  const actions = useRef({}); // connect / sit，给 socket 回调用最新的版本

  const wanted = () => (activeRef.current && document.visibilityState === 'visible') || wantSeat.current;
  const send = useCallback(m => { if (ws.current && ws.current.readyState === 1) ws.current.send(JSON.stringify(m)); }, []);
  const flash = text => { setMsg(text); clearTimeout(msgTimer.current); msgTimer.current = setTimeout(() => setMsg(''), 4000); };
  const disconnectIfIdle = () => { if (ws.current && !wanted()) ws.current.close(); };

  actions.current.connect = () => {
    if (ws.current || !wanted()) return;
    const s = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/bj');
    ws.current = s; satConfirmed.current = false;
    s.onopen = () => {
      retry.current = 0; setLive(true);
      if (wantSeat.current && actions.current.me) send({ type: 'sit', ...actions.current.me });
      else { const c = credRef.current; if (c.name && c.token) send({ type: 'identify', name: c.name, token: c.token }); } // 围观也要能发表情：先证明身份，不用坐下
    };
    s.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type !== 'state') return;
      setSt({ ...m, at: Date.now() });
      if (m.you) satConfirmed.current = true;
      else if (wantSeat.current && (satConfirmed.current || m.error)) { // 被站起来了，或者坐不下
        wantSeat.current = false; satConfirmed.current = false;
        disconnectIfIdle(); // 不在这页的话就断开，别让 Durable Object 一直开着占免费额度
      }
      if (m.error === '先登录再坐下') { if (credRef.current.name) { signedOut(); flash('正在重新登录，好了再点一次坐下'); } else openLogin(me => actions.current.sit(me)); }
      else if (m.error || m.notice) flash(m.error || m.notice);
    };
    s.onclose = () => {
      if (ws.current === s) ws.current = null;
      setLive(false);
      if (wanted()) setTimeout(() => actions.current.connect(), Math.min(10000, 800 * 2 ** retry.current++));
    };
  };
  // 坐下要用登录名单里的名字和 token
  actions.current.sit = me => {
    actions.current.me = { name: me.name, token: me.token };
    wantSeat.current = true;
    if (ws.current && ws.current.readyState === 1) send({ type: 'sit', ...actions.current.me });
    else actions.current.connect();
  };

  const sit = () => ensureName(me => actions.current.sit(me));
  // 站起来：服务器存筹码（这一手打到一半的话，打完再存）
  const standUp = useCallback(() => {
    send({ type: 'leave' });
    wantSeat.current = false; satConfirmed.current = false;
    setTimeout(disconnectIfIdle, 500);
  }, [send]); // eslint-disable-line react-hooks/exhaustive-deps -- disconnectIfIdle only reads refs

  // 进出 21 点页面、切到别的标签页：按需要连上或断开（坐着的人离开页面也留在桌上）
  useEffect(() => {
    const onVis = () => (document.visibilityState === 'visible' ? actions.current.connect() : disconnectIfIdle());
    if (active) actions.current.connect(); else disconnectIfIdle();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { wantSeat.current = false; ws.current?.close(); clearTimeout(msgTimer.current); }, []);

  // 换了人：先把原来的人从桌上站起来
  useEffect(() => {
    if (st?.you && name && st.you !== name.toLowerCase()) standUp();
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  // 登录/换人之后补上身份（围观发表情用；坐下了就不用，sit 本身就证明了）
  useEffect(() => { if (name && token) send({ type: 'identify', name, token }); }, [name, token, epoch, send]); // (epoch: signed in again as the same person)

  const me = st?.you ? st.table.seats.find(s => s.key === st.you) : null;
  // 21 点的页面开着、你坐在桌上：聊天、投票的悬浮球先收起来（lib/seated.js）
  const seatedHere = !!(active && me);
  useEffect(() => { setSeated('bj', seatedHere); }, [seatedHere]);
  useEffect(() => () => setSeated('bj', false), []);
  return { st, live, me, msg, send, sit, standUp };
}
