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
// vt 只存当前身份，切去别人再切回来时，绑邮箱账号的 token 就丢了、又被要
// 验证码——和"这台设备验过就不用了"的承诺对不上。登录时优先出示记住的
// token，服务器认得就直接放行；token 已在别处轮换失效时，自然落回验证码
// 流程，验过后 adopt 会把新 token 记下来。
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
  // 邮箱验证码挑战：{ kind: 'login'|'bind', name, email?, emailHint? }。
  // login = 选了绑邮箱的人但这台设备没有 ta 的 token；bind = 正在给某人绑邮箱。
  const [challenge, setChallenge] = useState(null);
  // 每次登录成功 +1：绑邮箱提醒靠它判断"这是一次新登录"（刷新页面恢复
  // 会话不算登录，不弹）。bindIntent = 从保护提醒打开登录框（选中本人）。
  const [loginTick, setLoginTick] = useState(0);
  const [bindIntent, setBindIntent] = useState(false);
  const pending = useRef(null); // 登录后要接着做的事（比如投票），参数是 { name, token }

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

  // 打开登录框并选中当前账号（账号保护提醒的按钮用；保护卡就在名单
  // 下面，绑邮箱还是设 PIN 由用户在卡里选）
  const openBind = useCallback(() => { setBindIntent(true); setLoginOpen(true); loadUsers(); }, [loadUsers]);

  // 已登录就直接做；没登录先弹登录框，登录后再做
  const ensureName = useCallback(fn => {
    if (name) fn({ name, token });
    else openLogin(fn);
  }, [name, token, openLogin]);

  // 登录/绑定成功后：换上这个账号的身份，关弹窗，接着做刚才想做的事
  const adopt = useCallback(r => {
    setLoginTick(t => t + 1);
    setName(r.user.name); setToken(r.user.token); if (r.users) setUsers(r.users);
    save('vn', r.user.name); save('vt', r.user.token);
    rememberUserToken(r.user.name, r.user.token);
    setChallenge(null);
    setLoginOpen(false);
    const f = pending.current; pending.current = null;
    if (f) f({ name: r.user.name, token: r.user.token });
  }, []);

  // 返回错误文字，成功返回 null。绑了邮箱的账号在这台设备上没有 token 时，
  // 服务器回 needCode：不算失败，转入验证码流程（弹窗自己切到验证码视图）。
  const login = useCallback(async input => {
    const n = String(input || '').trim();
    if (!n) return null;
    // 这台设备验过这个人就出示记住的 token，切回来不用再收验证码
    const presented = recallUserToken(n) || token;
    let r;
    try { r = await api('/api/login', 'POST', { name: n, token: presented }); } catch (e) { r = { ok: false, error: '网络有点问题，稍后再试' }; }
    if (!r.ok) return r.error || '登录失败';
    if (r.needCode) {
      if (r.users) setUsers(r.users);
      // 邮箱和 PIN 是平行的两种验证：两个都设了，挑战里带上 canPin，
      // 验证码视图里能一键换成输 PIN。
      setChallenge({ kind: 'login', name: r.name, emailHint: r.emailHint, canPin: !!r.needPin });
      return null;
    }
    if (r.needPin) {
      if (r.users) setUsers(r.users);
      setChallenge({ kind: 'pin', name: r.name });
      return null;
    }
    adopt(r);
    return null;
  }, [token, adopt]);

  // 发送验证码（bind 要带上该账号当前的 token 和想绑的邮箱；login 只带名字，
  // 邮箱由服务器按已绑定记录发）。成功返回服务器结果（含 emailHint，开发模式
  // 还含 devCode），失败返回错误文字。
  const sendAuthCode = useCallback(async ({ name: n, token: t, email, purpose }) => {
    let r;
    try { r = await api('/api/auth/send-code', 'POST', { name: n, token: t, email, purpose }); }
    catch (e) { return '网络有点问题，稍后再试'; }
    return r.ok ? r : (r.error || '发送失败');
  }, []);

  // 校验验证码：login 过关 = 拿到该账号 token；bind 过关 = 邮箱绑上且 token
  // 已轮换。两种都直接换上返回的身份。
  const verifyAuthCode = useCallback(async code => {
    if (!challenge) return '先选好你的名字';
    let r;
    try {
      r = await api('/api/auth/verify', 'POST', {
        name: challenge.name, code, purpose: challenge.kind,
        deviceToken: token, // login 时把这台设备之前的投票并到账号名下
      });
    } catch (e) { return '网络有点问题，稍后再试'; }
    if (!r.ok) return r.error || '验证失败';
    adopt(r);
    return null;
  }, [challenge, token, adopt]);

  // 校验 PIN（challenge 是 kind:'pin' 时用）：过关 = 拿到该账号 token，
  // 和验证码登录一样直接换上返回的身份。
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
  // 服务器会轮换 token，返回的新身份直接换上（和绑邮箱一样）。
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

  // 新人加入并顺手绑邮箱：先建号登录，再发绑定验证码，进入验证码视图。
  const joinWithEmail = useCallback(async (input, email) => {
    const n = String(input || '').trim();
    if (!n) return null;
    let r;
    try { r = await api('/api/login', 'POST', { name: n, token }); } catch (e) { r = { ok: false, error: '网络有点问题，稍后再试' }; }
    if (!r.ok) return r.error || '登录失败';
    setName(r.user.name); setToken(r.user.token); setUsers(r.users);
    save('vn', r.user.name); save('vt', r.user.token);
    rememberUserToken(r.user.name, r.user.token);
    const sent = await sendAuthCode({ name: r.user.name, token: r.user.token, email, purpose: 'bind' });
    if (typeof sent === 'string') return sent; // 账号已建好，只是验证码没发出去
    setChallenge({ kind: 'bind', name: r.user.name, email, emailHint: sent.emailHint, sent: true, devCode: sent.devCode });
    return null;
  }, [token, sendAuthCode]);

  const value = { name, token, users, setUsers, loadUsers, loginOpen, openLogin, closeLogin, ensureName, login, challenge, setChallenge, sendAuthCode, verifyAuthCode, verifyPin, setAccountPin, removeAccountPin, joinWithEmail, loginTick, bindIntent, openBind };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
