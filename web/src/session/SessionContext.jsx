import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { load, save } from '../lib/storage.js';

// 登录：从后端的用户列表里选名字。名字和投票用的 token 存在 localStorage
// （vn / vt）；登录成已有用户时换成那个用户的 token，投票就跟着人走。
const SessionContext = createContext(null);
export const useSession = () => useContext(SessionContext);

function initialToken() {
  let t = load('vt');
  if (!t) { t = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(); save('vt', t); }
  return t;
}

// 这台设备记住每个"验过的人"的 token（localStorage vtu：{ 名字小写: token }）。
// vt 只存当前身份，切去别人再切回来时，设了 PIN 的账号的 token 就丢了、又被要
// PIN——和"这台设备验过就不用了"的承诺对不上。登录时优先出示记住的
// token，服务器认得就直接放行；token 已在别处轮换失效时（改了 PIN），自然落回
// 输 PIN，验过后 adopt 会把新 token 记下来。
function recallUserToken(n) {
  try { return JSON.parse(load('vtu', '{}'))[String(n).toLowerCase()] || ''; } catch (e) { return ''; }
}
function rememberUserToken(n, t) {
  if (!n || !t) return;
  let m = {};
  try { m = JSON.parse(load('vtu', '{}')) || {}; } catch (e) {}
  m[String(n).toLowerCase()] = t;
  save('vtu', JSON.stringify(m));
}

export function SessionProvider({ children }) {
  const [name, setName] = useState(() => load('vn', ''));
  const [token, setToken] = useState(initialToken);
  const [users, setUsers] = useState([]);
  const [loginOpen, setLoginOpen] = useState(false);
  // PIN 挑战：{ kind: 'pin', name } = 选了设过 PIN 的人，但这台设备没有 ta 的 token。
  const [challenge, setChallenge] = useState(null);
  // 每次登录成功 +1：设 PIN 提醒靠它判断"这是一次新登录"（刷新页面恢复
  // 会话不算登录，不弹）。bindIntent = 从保护提醒打开登录框（选中本人）。
  const [loginTick, setLoginTick] = useState(0);
  const [bindIntent, setBindIntent] = useState(false);
  const pending = useRef(null); // 登录后要接着做的事（比如投票），参数是 { name, token }
  // epoch：每次登录（包括重新登录成同一个人、悄悄换回有效的 token）+1。游戏、聊天、
  // 在线名单的连线都跟着它重新报一次名字——同一个人同一个 token 时 name / token
  // 都没变，以前就什么都不发生，只好切到别人再切回来。
  const [epoch, setEpoch] = useState(0);
  // stale：这台设备的登录在服务器那边已经不认了（设了 PIN 的账号在别处改了 PIN）
  const [stale, setStale] = useState(false);
  const cur = useRef({ name, token }); cur.current = { name, token };

  const loadUsers = useCallback(async () => {
    try { const r = await api('/api/users'); if (r.ok) setUsers(r.users); } catch (e) {}
  }, []);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const openLogin = useCallback(fn => {
    pending.current = fn || null;
    setLoginOpen(true);
    loadUsers(); // 别人可能刚注册，顺手刷新一下列表
  }, [loadUsers]);

  const closeLogin = useCallback(() => { pending.current = null; setChallenge(null); setBindIntent(false); setLoginOpen(false); }, []);

  // 打开登录框到自己的账号界面（账号保护提醒的按钮用；设 PIN 的卡就在那里）
  const openBind = useCallback(() => { setBindIntent(true); setLoginOpen(true); loadUsers(); }, [loadUsers]);

  // 已登录就直接做；没登录先弹登录框，登录后再做
  const ensureName = useCallback(fn => {
    if (name) fn({ name, token });
    else openLogin(fn);
  }, [name, token, openLogin]);

  // 登录 / 设 PIN 成功后：换上这个账号的身份，关弹窗，接着做刚才想做的事。
  // quiet：自己检查出 token 过期、悄悄换回有效的那个（不算一次新登录，不关弹窗）。
  const adopt = useCallback((r, { quiet = false } = {}) => {
    if (!quiet) setLoginTick(t => t + 1);
    setEpoch(e => e + 1);
    setStale(false);
    setName(r.user.name); setToken(r.user.token); if (r.users) setUsers(r.users);
    save('vn', r.user.name); save('vt', r.user.token);
    rememberUserToken(r.user.name, r.user.token);
    if (quiet) return;
    setChallenge(null);
    setLoginOpen(false);
    const f = pending.current; pending.current = null;
    if (f) f({ name: r.user.name, token: r.user.token });
  }, []);

  // 这台设备的登录还管不管用（打开页面、切回来、哪里回了「先登录…」时问一下服务器）：
  // - 管用：什么都不用做（被拒的那条连线让它重新报一次名字）
  // - 账号已经没了（退役）：这里也退出登录
  // - 没设 PIN 的账号：token 本来就是公开的，悄悄换回现在有效的那个
  // - 设了 PIN 的账号：直接弹出输 PIN（说明登录过期了），不用先切别人再切回来
  const lastCheck = useRef(0);
  const checkSession = useCallback(async ({ reidentify = false } = {}) => {
    const { name: n, token: t } = cur.current;
    if (!n) return;
    lastCheck.current = Date.now();
    let r;
    try { r = await api('/api/auth/check', 'POST', { name: n, token: t }); } catch (e) { return; } // 没网：先不管
    if (!r || !r.ok || cur.current.name !== n) return;
    if (!r.exists) { setName(''); save('vn', ''); setStale(false); return; }
    if (r.valid) { setStale(false); if (reidentify) setEpoch(e => e + 1); return; }
    if (!r.pinBound) {
      let l = null;
      try { l = await api('/api/login', 'POST', { name: n, token: t }); } catch (e) { return; }
      if (l?.ok && l.user && cur.current.name === n) adopt(l, { quiet: true });
      return;
    }
    setStale(true);
    setChallenge({ kind: 'pin', name: r.name || n, stale: true });
    setLoginOpen(true);
  }, [adopt]);
  useEffect(() => {
    checkSession();
    // 被拒了（api.js / 各条连线发 session:check）：马上查，但几秒内只查一次
    const onFail = () => { if (Date.now() - lastCheck.current > 4000) checkSession({ reidentify: true }); };
    // 切回这个页面：隔了半分钟以上就再查一次（可能在别的设备上改了 PIN）
    const onShow = () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck.current > 30000) checkSession(); };
    // 另一个标签页换了人：这里跟着换
    const onStorage = e => {
      if (e.key !== 'vn' && e.key !== 'vt') return;
      setName(load('vn', '')); setToken(load('vt') || cur.current.token); setEpoch(x => x + 1);
    };
    window.addEventListener('session:check', onFail);
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('session:check', onFail);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('storage', onStorage);
    };
  }, [checkSession]);

  // 返回错误文字，成功返回 null。设了 PIN 的账号在这台设备上没有 token 时，
  // 服务器回 needPin：不算失败，转入输 PIN（弹窗自己切到 PIN 视图）。
  const login = useCallback(async input => {
    const n = String(input || '').trim();
    if (!n) return null;
    // 这台设备验过这个人就出示记住的 token，切回来不用再输 PIN
    const presented = recallUserToken(n) || token;
    let r;
    try { r = await api('/api/login', 'POST', { name: n, token: presented }); } catch (e) { r = { ok: false, error: '网络有点问题，稍后再试' }; }
    if (!r.ok) return r.error || '登录失败';
    if (r.needPin) {
      if (r.users) setUsers(r.users);
      setChallenge({ kind: 'pin', name: r.name });
      return null;
    }
    adopt(r);
    return null;
  }, [token, adopt]);

  // 校验 PIN（challenge 是 kind:'pin' 时用）：过关 = 拿到该账号 token，直接换上。
  const verifyPin = useCallback(async pin => {
    if (!challenge) return '先选好你的名字';
    let r;
    try {
      r = await api('/api/auth/pin/verify', 'POST', {
        name: challenge.name, pin, deviceToken: token,
      });
    } catch (e) { return '网络有点问题，稍后再试'; }
    if (!r.ok) return r.error || '验证失败';
    adopt(r);
    return null;
  }, [challenge, token, adopt]);

  // 给账号设 / 改 4 位 PIN：要出示该账号当前的 token（没保护的账号
  // token 还在名单里，选了名字就有；有保护的得是本人登录着）。成功后
  // 服务器会轮换 token，返回的新身份直接换上。
  const setAccountPin = useCallback(async (targetName, pin, presented) => {
    let r;
    try { r = await api('/api/auth/pin/set', 'POST', { name: targetName, token: presented, pin }); }
    catch (e) { return '网络有点问题，稍后再试'; }
    if (!r.ok) return r.error || '没设上';
    adopt(r);
    return null;
  }, [adopt]);

  // 去掉自己的 PIN（回到没保护的账号）：只认当前会话的 token。
  const removeAccountPin = useCallback(async () => {
    let r;
    try { r = await api('/api/auth/pin/remove', 'POST', { name, token }); }
    catch (e) { return '网络有点问题，稍后再试'; }
    if (!r.ok) return r.error || '没去掉';
    if (r.users) setUsers(r.users);
    return null;
  }, [name, token]);

  const value = { name, token, users, setUsers, loadUsers, loginOpen, openLogin, closeLogin, ensureName, login, challenge, setChallenge, verifyPin, setAccountPin, removeAccountPin, loginTick, bindIntent, openBind, epoch, stale };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
