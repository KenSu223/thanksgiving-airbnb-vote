import { useEffect, useRef, useState } from 'react';
import { useSession } from '../session/SessionContext.jsx';
import { usePresence } from '../session/PresenceContext.jsx';
import { agoText } from './PresencePanel.jsx';
import './login.css';
import './presence.css';

// 登录 sheet：玻璃面板 + 右上角关闭钮。点遮罩、按 Esc 也能关（和「先随便看看」一个效果）
// 绑了邮箱的账号在新设备上登录要邮箱验证码（challenge 视图）；
// 没绑的可以从这里绑（选人 → 绑邮箱 → 收到码 → 验证完成）。
// 也可以给账号设 4 位 PIN（同样是 challenge 视图）：PIN 和邮箱是平行
// 的两种保护，绑一个就行、两个都绑也行——新设备登录时自己选用哪个
// 验证（视图里能互相切换）；PIN 在这里设 / 改 / 去掉。
// 「我来过了」是一份能点的名单：一行一个人（头像 + 名字 + 在线状态），
// 点谁就登谁。在线状态来自 PresenceContext：在在线的只有一个绿点，
// 不在线的是小灰字（3 分钟前 / 还没来过）。
export default function LoginModal() {
  const { name, token, users, loginOpen, closeLogin, login, challenge, setChallenge, sendAuthCode, verifyAuthCode, verifyPin, setAccountPin, removeAccountPin, joinWithEmail, bindIntent } = useSession();
  const { users: presenceUsers } = usePresence();
  const presOf = n => presenceUsers.find(u => u.name === n);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!loginOpen) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [loginOpen]);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [sel, setSel] = useState('');
  const [msg, setMsg] = useState('');
  const [bindEmail, setBindEmail] = useState('');
  const [code, setCode] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [pinVal, setPinVal] = useState('');
  // 选好人之后名单收起（只剩本人 + 换个人），界面只留账号保护卡；
  // listOpen 是「换个人」展开的完整名单。openRow 是保护卡里展开着的
  // 那一行（'mail' / 'pin' / null）——两行互斥，不会再同时摊开两个输入框。
  const [listOpen, setListOpen] = useState(false);
  const [openRow, setOpenRow] = useState(null);
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [cool, setCool] = useState(0);
  const listRef = useRef(null), inputRef = useRef(null), codeRef = useRef(null), pinRef = useRef(null);

  useEffect(() => {
    if (!loginOpen) return;
    setNewName(''); setNewEmail(''); setMsg(''); setBindEmail(''); setPinVal(''); setListOpen(false); setOpenRow(null);
    setSel(users.some(u => u.name === name) ? name : '');
    // 从账号保护提醒进来：选中本人，保护卡就在下面（不替 ta 选哪种）
    if (bindIntent && name) setSel(name);
    if (users.length) listRef.current?.querySelector('.sel, button')?.focus();
    else inputRef.current?.focus();
    const onKey = e => { if (e.key === 'Escape') closeLogin(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loginOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- 只在打开时聚焦一次

  // 进入验证码视图时：挑战里带着「已发送」状态（绑定流程是先发码再进来，
  // 登录流程进来时还没发）；重发倒计时也在这里起步
  useEffect(() => {
    setCode(''); setPinCode(''); setMsg('');
    setSent(!!challenge?.sent); setDevCode(challenge?.devCode || ''); setCool(challenge?.sent ? 60 : 0);
    if (challenge) setTimeout(() => (challenge.kind === 'pin' ? pinRef : codeRef).current?.focus(), 60);
  }, [challenge]);
  useEffect(() => {
    if (cool <= 0) return;
    const t = setTimeout(() => setCool(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cool]);

  if (!loginOpen) return null;
  const field = 'flex-1 min-w-0 rounded-xl border border-white/70 bg-white/75 px-3.5 py-2.5 shadow-[inset_0_1px_3px_rgba(15,23,42,.06)] focus:outline-none focus:ring-2 focus:ring-indigo-400';
  const selUser = users.find(u => u.name === sel);
  // 选好人又没展开「换个人」时，名单只剩本人这一行
  const shownUsers = sel && !listOpen ? users.filter(u => u.name === sel) : users;
  const go = async n => { setMsg(''); const err = await login(n); if (err) setMsg(err); };
  const join = async () => {
    setMsg('');
    const err = newEmail.trim()
      ? await joinWithEmail(newName, newEmail.trim())
      : await login(newName);
    if (err) setMsg(err);
  };
  // 给选中的人发绑定验证码：需要 ta 当前的 token（本人的用会话 token，
  // 未绑定的人 token 就在列表里）；发出后转入验证码视图。
  const startBind = async () => {
    setMsg('');
    const t = sel === name ? token : selUser?.token;
    if (!t) { setMsg('先登录这个账号再绑邮箱'); return; }
    const r = await sendAuthCode({ name: sel, token: t, email: bindEmail.trim(), purpose: 'bind' });
    if (typeof r === 'string') { setMsg(r); return; }
    setChallenge({ kind: 'bind', name: sel, email: bindEmail.trim(), emailHint: r.emailHint, sent: true, devCode: r.devCode });
  };
  const sendForChallenge = async () => {
    setMsg('');
    const t = challenge.kind === 'bind' ? (challenge.name === name ? token : users.find(u => u.name === challenge.name)?.token) : undefined;
    const r = await sendAuthCode({ name: challenge.name, token: t, email: challenge.email, purpose: challenge.kind });
    if (typeof r === 'string') { setMsg(r); return; }
    setSent(true); if (r.devCode) setDevCode(r.devCode); setCool(60);
  };
  const verify = async () => {
    setMsg('');
    const err = await verifyAuthCode(code.trim());
    if (err) setMsg(err);
  };
  const doVerifyPin = async () => {
    setMsg('');
    const err = await verifyPin(pinCode);
    if (err) setMsg(err);
  };
  // 给选中的人设 / 改 PIN：和绑邮箱一样要出示 ta 当前的 token。设上之后
  // token 会轮换，setAccountPin 会把新身份换上（选的人就是本人时）。
  const startPinSet = async () => {
    setMsg('');
    const t = sel === name ? token : selUser?.token;
    if (!t) { setMsg('先登录这个账号再设 PIN'); return; }
    const err = await setAccountPin(sel, pinVal, t);
    if (err) { setMsg(err); return; }
    setOpenRow(null); setPinVal('');
  };
  const doRemovePin = async () => {
    setMsg('');
    const err = await removeAccountPin();
    if (err) setMsg(err);
  };
  return (
    <div className="login-fade fixed inset-0 bg-slate-950/45 backdrop-blur-[3px] flex items-center justify-center z-50 px-4"
      onClick={e => { if (e.target === e.currentTarget) closeLogin(); }}>
      <div className="login-pop glass-sheet relative rounded-[28px] px-6 pb-6 pt-3 w-full max-w-sm" role="dialog" aria-modal="true" aria-label="登录">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-400/40" aria-hidden="true" />
        <button onClick={closeLogin} aria-label="关闭"
          className="login-close absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full border border-white/70 bg-white/60 text-base leading-none text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,.12),inset_0_1px_0_rgba(255,255,255,.9)] hover:bg-white/90 hover:text-slate-700">✕</button>

        {challenge ? (
          challenge.kind === 'pin' ? (
            <div>
              <div className="mb-5 flex items-center gap-3.5 pr-8">
                <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-[26px] shadow-[0_8px_20px_-6px_rgba(99,60,235,.6),inset_0_1px_0_rgba(255,255,255,.4)]">🔑</span>
                <div>
                  <h3 className="text-xl font-extrabold leading-tight">输入 PIN</h3>
                  <p className="mt-0.5 text-sm leading-snug text-slate-500"><b>{challenge.name}</b> 设了 4 位 PIN，这个设备还没验过</p>
                </div>
              </div>
              <div className="flex gap-2">
                <input ref={pinRef} value={pinCode} onChange={e => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  onKeyDown={e => e.key === 'Enter' && pinCode.length === 4 && doVerifyPin()}
                  className={field + ' text-center text-xl font-bold tracking-[0.4em]'} placeholder="····" inputMode="numeric" autoComplete="off" />
                <button onClick={doVerifyPin} disabled={pinCode.length !== 4} className="btn-primary shrink-0 rounded-xl px-5 py-2.5 font-bold disabled:opacity-40">验证</button>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <button onClick={() => setChallenge(null)} className="font-medium text-slate-400 transition hover:text-slate-600">← 换个人</button>
                <span className="text-slate-400">连错 5 次会锁 10 分钟</span>
              </div>
              {challenge.canCode && (
                <button onClick={() => setChallenge({ kind: 'login', name: challenge.name, emailHint: challenge.emailHint, canPin: true })}
                  className="mt-2.5 w-full text-center text-sm font-medium text-indigo-500 transition hover:text-indigo-700">或者用邮箱验证码验证 →</button>
              )}
              {msg && <p className="mt-2.5 text-sm font-medium text-rose-600">{msg}</p>}
            </div>
          ) : (
          <div>
            <div className="mb-5 flex items-center gap-3.5 pr-8">
              <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-[26px] shadow-[0_8px_20px_-6px_rgba(99,60,235,.6),inset_0_1px_0_rgba(255,255,255,.4)]">✉️</span>
              <div>
                <h3 className="text-xl font-extrabold leading-tight">输入验证码</h3>
                <p className="mt-0.5 text-sm leading-snug text-slate-500">
                  {challenge.kind === 'bind'
                    ? <>给 <b>{challenge.name}</b> 绑邮箱 {challenge.email}，验一下这个邮箱是你的</>
                    : <><b>{challenge.name}</b> 绑了邮箱，这个设备还没验过</>}
                </p>
              </div>
            </div>
            {sent ? (
              <p className="mb-3 text-sm text-slate-500">验证码已发到 <b>{challenge.emailHint || challenge.email}</b>，10 分钟内有效</p>
            ) : (
              <button onClick={sendForChallenge} className="btn-primary mb-3 w-full rounded-xl px-5 py-2.5 font-bold">发送验证码</button>
            )}
            {devCode && <p className="mb-3 rounded-xl bg-amber-100/80 px-3.5 py-2.5 text-sm font-medium text-amber-800">开发模式（没真发邮件）：验证码是 <b className="tracking-widest">{devCode}</b></p>}
            <div className="flex gap-2">
              <input ref={codeRef} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={e => e.key === 'Enter' && code.length === 6 && verify()}
                className={field + ' text-center text-xl font-bold tracking-[0.4em]'} placeholder="······" inputMode="numeric" autoComplete="one-time-code" />
              <button onClick={verify} disabled={code.length !== 6} className="btn-primary shrink-0 rounded-xl px-5 py-2.5 font-bold disabled:opacity-40">验证</button>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <button onClick={() => setChallenge(null)} className="font-medium text-slate-400 transition hover:text-slate-600">← 换个人</button>
              {sent && (cool > 0
                ? <span className="text-slate-400">{cool} 秒后可重发</span>
                : <button onClick={sendForChallenge} className="font-medium text-indigo-500 transition hover:text-indigo-700">重新发送</button>)}
            </div>
            {challenge.kind === 'login' && challenge.canPin && (
              <button onClick={() => setChallenge({ kind: 'pin', name: challenge.name, emailHint: challenge.emailHint, canCode: true })}
                className="mt-2.5 w-full text-center text-sm font-medium text-indigo-500 transition hover:text-indigo-700">或者用 PIN 验证 →</button>
            )}
            {msg && <p className="mt-2.5 text-sm font-medium text-rose-600">{msg}</p>}
          </div>
          )
        ) : (
          <div>
            <div className="mb-5 flex items-center gap-3.5 pr-8">
              <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-[26px] shadow-[0_8px_20px_-6px_rgba(99,60,235,.6),inset_0_1px_0_rgba(255,255,255,.4)]">👋</span>
              <div>
                <h3 className="text-xl font-extrabold leading-tight">你是谁？</h3>
                <p className="mt-0.5 text-sm leading-snug text-slate-500">选一下你的名字就能登录，投票和记账都会记在你名下</p>
              </div>
            </div>
            {users.length > 0 && (
              <div>
                <div className="text-xs font-bold tracking-wide text-slate-500">我来过了</div>
                <ul className="login-users mb-2 mt-1.5" ref={listRef}>
                  {shownUsers.map(u => {
                    const p = presOf(u.name);
                    return (
                      <li key={u.name}>
                        <button type="button" className={'login-user' + (sel === u.name ? ' sel' : '')} aria-pressed={sel === u.name}
                          onClick={() => { setSel(u.name); setOpenRow(null); setListOpen(false); go(u.name); }}>
                          <span className="avatar login-user-av" aria-hidden="true">{Array.from(u.name)[0].toUpperCase()}</span>
                          <span className="login-user-name">{u.name}{(u.emailBound || u.pinBound) ? ' 🔒' : ''}</span>
                          {p && (p.online
                            ? <span className="presence-dot on" role="img" aria-label="在线" />
                            : <span className="presence-when">{agoText(p.lastSeen, now)}</span>)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {sel && !listOpen && (
                  <button onClick={() => setListOpen(true)} className="mb-3 text-xs font-medium text-slate-400 transition hover:text-slate-600">换个人 ▾</button>
                )}
                {selUser && (
                  <div className="mb-3 rounded-2xl border border-white/60 bg-white/45 px-3.5 py-2.5">
                    <p className="mb-1 text-xs font-bold tracking-wide text-slate-500">账号保护 · 绑一个就行，两个都绑也可以</p>
                    <div className="flex items-center gap-2 py-1.5">
                      <span className="text-sm font-bold text-slate-700">📧 邮箱</span>
                      {selUser.emailBound
                        ? <span className="ml-auto text-xs text-slate-400">已绑 {selUser.emailHint}</span>
                        : <button onClick={() => setOpenRow(openRow === 'mail' ? null : 'mail')} className="ml-auto shrink-0 rounded-lg bg-white/70 px-3 py-1.5 text-xs font-bold text-indigo-600 shadow-[0_1px_3px_rgba(15,23,42,.06)] transition hover:bg-white">绑定</button>}
                    </div>
                    {openRow === 'mail' && !selUser.emailBound && (
                      <div className="mb-1.5 flex gap-2">
                        <input value={bindEmail} onChange={e => setBindEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && startBind()}
                          className={field} placeholder={`给 ${sel} 绑的邮箱`} inputMode="email" maxLength={120} />
                        <button onClick={startBind} className="shrink-0 rounded-xl bg-slate-900/90 px-4 py-2.5 font-bold text-white shadow-[0_8px_20px_-6px_rgba(15,23,42,.5)] transition hover:bg-slate-900 active:scale-[.98]">发验证码</button>
                      </div>
                    )}
                    <div className="border-t border-white/60" />
                    <div className="flex items-center gap-2 py-1.5">
                      <span className="text-sm font-bold text-slate-700">🔑 PIN</span>
                      {selUser.pinBound ? (
                        <>
                          <span className="ml-auto text-xs text-slate-400">已设置</span>
                          {sel === name && (
                            <>
                              <button onClick={() => setOpenRow(openRow === 'pin' ? null : 'pin')} className="shrink-0 font-medium text-indigo-500 transition hover:text-indigo-700">改 PIN</button>
                              <button onClick={doRemovePin} className="shrink-0 font-medium text-slate-400 transition hover:text-rose-500">去掉</button>
                            </>
                          )}
                        </>
                      ) : (
                        <button onClick={() => setOpenRow(openRow === 'pin' ? null : 'pin')} className="ml-auto shrink-0 rounded-lg bg-white/70 px-3 py-1.5 text-xs font-bold text-indigo-600 shadow-[0_1px_3px_rgba(15,23,42,.06)] transition hover:bg-white">设置</button>
                      )}
                    </div>
                    {openRow === 'pin' && (
                      <div className="mb-1.5 flex gap-2">
                        <input value={pinVal} onChange={e => setPinVal(e.target.value.replace(/\D/g, '').slice(0, 4))} onKeyDown={e => e.key === 'Enter' && pinVal.length === 4 && startPinSet()}
                          className={field} placeholder={selUser.pinBound ? `给 ${sel} 换个新 PIN` : `给 ${sel} 设个 4 位 PIN`} inputMode="numeric" maxLength={4} />
                        <button onClick={startPinSet} disabled={pinVal.length !== 4} className="shrink-0 rounded-xl bg-slate-900/90 px-4 py-2.5 font-bold text-white shadow-[0_8px_20px_-6px_rgba(15,23,42,.5)] transition hover:bg-slate-900 active:scale-[.98] disabled:opacity-40">{selUser.pinBound ? '保存新 PIN' : '设置 PIN'}</button>
                      </div>
                    )}
                    <p className="mt-1.5 text-[11px] leading-snug text-slate-400">绑了以后，换设备登录要验一下是你本人；这台设备验过一次就不用再验了。</p>
                  </div>
                )}
                {(!sel || listOpen) && (
                  <div className="mb-3.5 flex items-center gap-3 text-xs text-slate-400"><span className="flex-1 border-t border-white/60"></span>第一次来？<span className="flex-1 border-t border-white/60"></span></div>
                )}
              </div>
            )}
            {(!sel || listOpen) && (
              <>
                <div className="flex gap-2">
                  <input ref={inputRef} value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && join()}
                    className={field} placeholder="输入你的名字，比如 Ken" maxLength={20} />
                  <button onClick={join} className="shrink-0 rounded-xl bg-slate-900/90 px-5 py-2.5 font-bold text-white shadow-[0_8px_20px_-6px_rgba(15,23,42,.5)] transition hover:bg-slate-900 active:scale-[.98]">加入</button>
                </div>
                <input value={newEmail} onChange={e => setNewEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && join()}
                  className={field + ' mt-2 w-full'} placeholder="邮箱（可选）：绑上后换设备登录要验证码" inputMode="email" maxLength={120} />
              </>
            )}
            {msg && <p className="mt-2.5 text-sm font-medium text-rose-600">{msg}</p>}
            <button onClick={closeLogin} className="mt-4 w-full text-center text-sm font-medium text-slate-400 transition hover:text-slate-600">先随便看看 →</button>
          </div>
        )}
      </div>
    </div>
  );
}
