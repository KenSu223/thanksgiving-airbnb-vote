import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../../session/SessionContext.jsx';
import { load, save } from '../../lib/storage.js';

// 斗地主 / 掼蛋 / 川麻 共用的连线：牌局都在服务器（每个游戏一个 Durable Object，里面几张桌子），
// 这里只负责连上、选桌、坐下、站起。和 21 点一样：不在这页、也没坐下就不连，省免费额度；
// 被站起来了且不在这页就断开。
// path：WebSocket 地址（/api/ddz）；roomKey：记住看哪张桌的 localStorage key；
// noHint：点「提示」却没有能出的牌时显示的话。
export function useTable(active, { path, roomKey, noHint }) {
  const { name, token, ensureName, openLogin } = useSession();
  const [st, setSt] = useState(null); // 服务器发来的 { room, seatedAt, you, table, lobby, board } + 收到的时间 at
  const [live, setLive] = useState(false);
  const [msg, setMsg] = useState('');
  const [hint, setHint] = useState(null); // 提示：服务器建议出的牌
  const [room, setRoom] = useState(() => Number(load(roomKey)) || 1);
  const ws = useRef(null), retry = useRef(0), msgTimer = useRef(null);
  const wantSeat = useRef(false), satConfirmed = useRef(false);
  const activeRef = useRef(active), roomRef = useRef(room);
  activeRef.current = active; roomRef.current = room;
  const credRef = useRef({ name, token });
  credRef.current = { name, token };
  const actions = useRef({});

  const wanted = () => (activeRef.current && document.visibilityState === 'visible') || wantSeat.current;
  const send = useCallback(m => { if (ws.current && ws.current.readyState === 1) ws.current.send(JSON.stringify(m)); }, []);
  const flash = text => { setMsg(text); clearTimeout(msgTimer.current); msgTimer.current = setTimeout(() => setMsg(''), 4000); };
  const disconnectIfIdle = () => { if (ws.current && !wanted()) ws.current.close(); };

  actions.current.connect = () => {
    if (ws.current || !wanted()) return;
    const s = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path + '?room=' + roomRef.current);
    ws.current = s; satConfirmed.current = false;
    s.onopen = () => {
      retry.current = 0; setLive(true);
      if (wantSeat.current && actions.current.me) { send({ type: 'sit', room: roomRef.current, ...actions.current.me, ...actions.current.extra }); actions.current.extra = null; }
      else { const c = credRef.current; if (c.name && c.token) send({ type: 'identify', name: c.name, token: c.token }); } // 围观也要能发表情：先证明身份，不用坐下
    };
    s.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type !== 'state') return;
      setSt({ ...m, at: Date.now() });
      if (m.hint) { setHint(m.hint); if (!m.hint.length && noHint) flash(noHint); }
      if (m.you) satConfirmed.current = true;
      else if (wantSeat.current && (satConfirmed.current || m.error)) { // 被站起来了，或者坐不下
        wantSeat.current = false; satConfirmed.current = false;
        disconnectIfIdle();
      }
      if (m.error === '先登录再坐下') openLogin(me => actions.current.sit(me));
      else if (m.error || m.notice) flash(m.error || m.notice);
    };
    s.onclose = () => {
      if (ws.current === s) ws.current = null;
      setLive(false);
      if (wanted()) setTimeout(() => actions.current.connect(), Math.min(10000, 800 * 2 ** retry.current++));
    };
  };
  // extra（派对游戏的座位号 { seat }）只跟这一次坐下走；断线重连时再坐下不带它，免得把人挪回去
  actions.current.sit = (me, extra) => {
    actions.current.me = { name: me.name, token: me.token };
    wantSeat.current = true;
    if (ws.current && ws.current.readyState === 1) send({ type: 'sit', room: roomRef.current, ...actions.current.me, ...extra });
    else { actions.current.extra = extra; actions.current.connect(); }
  };

  // sit()（牌桌）或 sit({ seat })（派对游戏选座位）；onClick 直接传进来的点击事件不算
  const sit = extra => ensureName(me => actions.current.sit(me, Number.isInteger(extra?.seat) ? { seat: extra.seat } : null));
  // 站起来：服务器这时才保存豆子（这局打到一半的话，托管打完再存）
  const standUp = useCallback(() => {
    send({ type: 'leave' });
    wantSeat.current = false; satConfirmed.current = false;
    setTimeout(disconnectIfIdle, 500);
  }, [send]); // eslint-disable-line react-hooks/exhaustive-deps -- disconnectIfIdle only reads refs
  // 换桌看：只换看哪张桌，坐着的人还坐在原来那桌
  const watch = useCallback(r => { setRoom(r); save(roomKey, String(r)); send({ type: 'watch', room: r }); }, [send, roomKey]);

  useEffect(() => {
    const onVis = () => (document.visibilityState === 'visible' ? actions.current.connect() : disconnectIfIdle());
    if (active) actions.current.connect(); else disconnectIfIdle();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { wantSeat.current = false; ws.current?.close(); clearTimeout(msgTimer.current); }, []);

  // 换了人：先把原来的人站起来
  useEffect(() => {
    if (st?.you && name && st.you !== name.toLowerCase()) standUp();
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  // 登录/换人之后补上身份（围观发表情用；坐下了就不用，sit 本身就证明了）
  useEffect(() => { if (name && token) send({ type: 'identify', name, token }); }, [name, token, send]);

  return { st, live, msg, flash, hint, setHint, room, watch, send, sit, standUp };
}

// 还剩几秒（用服务器给的时间算）；没在倒计时就是 null
export function secondsLeft(st) {
  const t = st?.table;
  return t?.deadline ? Math.max(0, Math.ceil((t.deadline - t.now - (Date.now() - st.at)) / 1000)) : null;
}

// 倒计时：只在这页开着、连着的时候走（每 250ms 重画一次，用到它的组件跟着更新）
export function useCountdown(st, running) {
  const [, tick] = useState(0);
  const t = st?.table;
  useEffect(() => {
    if (!running || !t?.deadline) return;
    const id = setInterval(() => tick(n => n + 1), 250);
    return () => clearInterval(id);
  }, [running, t?.deadline]);
  const left = secondsLeft(st);
  return left == null ? '' : left + 's';
}
