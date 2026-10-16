import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../session/SessionContext.jsx';
import { useToast } from './Toast.jsx';
import { load, save } from '../lib/storage.js';
import { useSeated } from '../lib/seated.js';
import './chat.css';

// 聊天室：投票球上面的 💬。全组一个房间，服务器只留最近 100 条（worker/chat/room.js），
// WebSocket 推过来（服务器那边空闲时会睡，连着不花钱），所以这页一直连着、红点灰点随时更新。
// 没读的：普通消息是灰色的数字，有人 @我 就变红色（还会弹一句提示）；打开聊天室，别人没读的
// 消息灰底、上面一条「以下是新消息」，@我 的红框。读到哪了记在这台设备上。
// 输入 @ 会弹出成员列表，点一下就 @ 上；最后一个「@all 所有人」叫全组（@all 或 @所有人 都算）。
// 谁被 @ 了由服务器从文字里认出来。
const time = at => {
  const d = new Date(at), today = new Date();
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? hm : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function useChat(name, token, onMsg) {
  const [msgs, setMsgs] = useState([]);
  const [live, setLive] = useState(false);
  const ws = useRef(null), retry = useRef(0), cb = useRef(onMsg);
  cb.current = onMsg;
  const cred = useRef({ name, token }); cred.current = { name, token };
  const connect = useRef(null);
  connect.current = () => {
    if (ws.current || !cred.current.name || document.visibilityState !== 'visible') return;
    const s = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/chat');
    ws.current = s;
    s.onopen = () => { retry.current = 0; s.send(JSON.stringify({ type: 'hello', ...cred.current })); };
    s.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type === 'history') { setMsgs(m.msgs); setLive(true); }
      else if (m.type === 'msg') { setMsgs(list => [...list, m.msg].slice(-100)); cb.current?.(m.msg); }
      else if (m.type === 'error') cb.current?.(null, m.error);
    };
    s.onclose = () => {
      if (ws.current === s) ws.current = null;
      setLive(false);
      if (cred.current.name && document.visibilityState === 'visible') setTimeout(() => connect.current(), Math.min(15000, 1000 * 2 ** retry.current++));
    };
  };
  useEffect(() => {
    ws.current?.close(); ws.current = null; setMsgs([]);
    if (!name) return undefined;
    connect.current();
    const onVis = () => (document.visibilityState === 'visible' ? connect.current() : ws.current?.close());
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); ws.current?.close(); ws.current = null; };
  }, [name, token]);
  const send = useCallback(text => {
    if (!ws.current || ws.current.readyState !== 1) return false;
    ws.current.send(JSON.stringify({ type: 'send', text }));
    return true;
  }, []);
  return { msgs, live, send };
}

// 一条消息的文字：被 @ 的人加粗（@我 是红的）；@all / @所有人 叫的也有我，对别人都是红的
const ALL_WORDS = ['all', '所有人'];
function Text({ msg, names, me }) {
  const tagged = (msg.mentions || []).map(k => names.get(k) || k);
  if (!tagged.length && !msg.all) return msg.text;
  const alts = [...(msg.all ? ['all(?![a-z0-9_])', '所有人'] : []), ...tagged.sort((a, b) => b.length - a.length).map(esc)];
  const re = new RegExp('(@(?:' + alts.join('|') + '))', 'gi');
  return msg.text.split(re).map((part, i) => {
    if (i % 2 === 0) return part;
    const word = part.slice(1).toLowerCase();
    const isMe = word === me || (ALL_WORDS.includes(word) && msg.byKey !== me);
    return <span key={i} className={'ch-at' + (isMe ? ' me' : '')}>{part}</span>;
  });
}

export default function ChatFab() {
  const { name, token, users } = useSession();
  const seated = useSeated(); // 坐在游戏桌上：球先收起来
  const toast = useToast();
  const me = name ? name.toLowerCase() : '';
  const [open, setOpen] = useState(false);
  const readKey = 'chatRead:' + me;
  const [readAt, setReadAt] = useState(() => Number(load(readKey)) || 0);
  useEffect(() => { setReadAt(Number(load('chatRead:' + me)) || 0); }, [me]);
  const openRef = useRef(open); openRef.current = open;
  const onMsg = useCallback((msg, error) => {
    if (error) { toast(error); return; }
    if (msg && !openRef.current && msg.byKey !== me && (msg.mentions || []).includes(me)) toast('💬 ' + msg.by + ' 在聊天室 @了' + (msg.all ? '所有人' : '你'));
  }, [me, toast]);
  const { msgs, live, send } = useChat(name, token, onMsg);
  const names = useMemo(() => new Map(users.map(u => [u.name.toLowerCase(), u.name])), [users]);

  // 打开着就算都读了
  const lastAt = msgs.length ? msgs[msgs.length - 1].at : 0;
  useEffect(() => {
    if (open && lastAt > readAt) { setReadAt(lastAt); save(readKey, String(lastAt)); }
  }, [open, lastAt]); // eslint-disable-line react-hooks/exhaustive-deps -- readKey/readAt follow me
  const unread = msgs.filter(m => m.at > readAt && m.byKey !== me);
  const atMe = unread.filter(m => (m.mentions || []).includes(me));

  // 打开时记下哪些是没读的（上次读到 → 打开那一刻的最后一条）：别人的这些消息灰底标出来，
  // 上面一条「以下是新消息」；@我 的照旧是红框。开着时新来的就是正在看的，不算没读。
  const [fresh, setFresh] = useState(null); // { from, to }
  const isNew = m => !!fresh && m.byKey !== me && m.at > fresh.from && m.at <= fresh.to;
  const firstNew = msgs.findIndex(isNew);
  const openChat = () => { setFresh({ from: readAt, to: lastAt }); nearBottom.current = true; setOpen(true); };

  // 列表：刚打开时，没读的一屏放不下就停在「以下是新消息」，放得下就到底；新消息来了滚到底
  // （往上翻着看的时候不打扰）。满 100 条后条数不变，所以看最后一条的 id。
  const list = useRef(null), divider = useRef(null), nearBottom = useRef(true);
  const lastId = msgs.length ? msgs[msgs.length - 1].id : '';
  useEffect(() => {
    const el = list.current, d = divider.current;
    if (!el) return;
    if (d && el.scrollHeight - d.offsetTop > el.clientHeight) el.scrollTop = d.offsetTop - 8;
    else el.scrollTop = el.scrollHeight;
  }, [open]);
  useEffect(() => {
    const el = list.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  // 输入：@ 后面的字用来筛成员
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const box = useRef(null);
  // 输入框跟着字数长高（最多到 css 的 max-height）
  useEffect(() => {
    const el = box.current;
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; }
  }, [text, open]);
  const before = text.slice(0, caret);
  const atMatch = /@([^\s@]*)$/.exec(before);
  const picks = atMatch ? users.filter(u => u.name.toLowerCase() !== me && u.name.toLowerCase().includes(atMatch[1].toLowerCase())).slice(0, 8) : [];
  // 「@all 所有人」排在最后（回车还是先选人），打 @a、@al、@所 也还在
  const pickAll = !!atMatch && ALL_WORDS.some(w => w.startsWith(atMatch[1].toLowerCase()));
  const pick = n => {
    const start = caret - atMatch[0].length;
    const next = text.slice(0, start) + '@' + n + ' ' + text.slice(caret);
    setText(next);
    const pos = start + n.length + 2;
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(pos, pos); setCaret(pos); });
  };
  const insertAt = () => {
    const next = text.slice(0, caret) + '@' + text.slice(caret);
    setText(next);
    const pos = caret + 1;
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(pos, pos); setCaret(pos); });
  };
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    if (send(t)) { setText(''); setCaret(0); nearBottom.current = true; } else toast('还没连上，稍等一下');
  };

  if (!name) return null;
  return (
    <>
      {/* 投票球正上方：手机在左下，电脑在右下；坐在游戏桌上时收起来（不挡出牌的按钮），聊天照样连着、@你照样提示 */}
      {!seated && <button onClick={openChat} aria-label={'聊天室' + (atMe.length ? '，' + atMe.length + ' 条 @你的' : unread.length ? '，' + unread.length + ' 条没读' : '')}
        className="glass-pill fixed bottom-[calc(9.5rem+env(safe-area-inset-bottom))] left-3 z-40 flex items-center gap-1.5 rounded-full py-2.5 pl-3.5 pr-4 font-bold shadow-[0_10px_28px_-8px_rgba(30,27,75,.45)] transition hover:scale-[1.04] active:scale-95 md:bottom-[5.25rem] md:left-auto md:right-4">
        <span className="text-lg leading-none">💬</span> 聊天
        {atMe.length > 0
          ? <span className="ch-badge red">@{atMe.length}</span>
          : unread.length > 0 && <span className="ch-badge gray">{unread.length > 99 ? '99+' : unread.length}</span>}
      </button>}

      {open && (
        <div className="login-fade fixed inset-0 z-[66] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-[3px]"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="login-pop glass-sheet flex h-[86vh] max-h-[44rem] w-full max-w-md flex-col rounded-[28px] px-4 py-4" role="dialog" aria-modal="true" aria-label="聊天室">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xl font-extrabold">💬 聊天室</h3>
              <span className="ml-2 mr-auto text-xs text-slate-400">{live ? '最近 100 条' : '连接中…'}</span>
              <button onClick={() => setOpen(false)} aria-label="关闭" className="grid h-9 w-9 place-items-center rounded-full bg-white/60 text-lg text-slate-500 transition hover:bg-white">✕</button>
            </div>
            <div ref={list} className="ch-list" onScroll={e => { const el = e.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
              {!msgs.length && <p className="py-10 text-center text-sm text-slate-400">{live ? '还没有人说话，打个招呼吧 👋' : '连接中…'}</p>}
              {msgs.map((m, i) => {
                const mine = m.byKey === me, tagged = (m.mentions || []).includes(me);
                const showName = !mine && (i === 0 || i === firstNew || msgs[i - 1].byKey !== m.byKey || m.at - msgs[i - 1].at > 5 * 60000);
                return (
                  <div key={m.id} className={'ch-row' + (mine ? ' mine' : '')}>
                    {i === firstNew && <div ref={divider} className="ch-new">以下是新消息</div>}
                    {showName && <div className="ch-name">{m.by} <span>{time(m.at)}</span></div>}
                    <div className={'ch-bubble' + (mine ? ' mine' : '') + (tagged ? ' tagged' : isNew(m) ? ' unread' : '')} title={time(m.at)}>
                      <Text msg={m} names={names} me={me} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="relative mt-2">
              {(picks.length > 0 || pickAll) && (
                <div className="ch-picks" role="listbox" aria-label="@谁">
                  {picks.map(u => <button key={u.name} role="option" aria-selected="false" onMouseDown={e => e.preventDefault()} onClick={() => pick(u.name)}>@{u.name}</button>)}
                  {pickAll && <button role="option" aria-selected="false" className="all" onMouseDown={e => e.preventDefault()} onClick={() => pick('all')}>@all 所有人</button>}
                </div>
              )}
              <div className="flex items-end gap-2">
                <button onClick={insertAt} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/70 text-lg font-bold text-indigo-600 transition hover:bg-white" aria-label="@某人">@</button>
                <textarea ref={box} rows={1} maxLength={500} value={text} placeholder="说点什么，@ 叫人"
                  onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart); }}
                  onSelect={e => setCaret(e.currentTarget.selectionStart)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (atMatch && (picks.length || pickAll)) pick(picks.length ? picks[0].name : 'all'); else submit(); } }}
                  className="ch-input" />
                <button onClick={submit} disabled={!text.trim()} className="btn-primary h-10 shrink-0 rounded-xl px-4 font-bold disabled:opacity-40">发送</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
