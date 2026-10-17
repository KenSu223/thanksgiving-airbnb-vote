import { useEffect, useRef, useState } from 'react';
import { useSession } from '../session/SessionContext.jsx';
import { usePresence } from '../session/PresenceContext.jsx';
import { agoText } from './PresencePanel.jsx';
import './login.css';
import './presence.css';

// 登录 sheet：玻璃面板 + 右上角关闭钮。点遮罩、按 Esc 也能关（和「先随便看看」一个效果）
// 两个界面：picker 只管选人 / 加入；account 是登录后的账号界面——本人一行 +
// 账号保护卡（设 / 改 / 去掉 4 位 PIN，要先是本人登录着）。设了 PIN 的账号
// 在新设备上登录要输 PIN（challenge 视图）。
// 「我来过了」是一份能点的名单：一行一个人（头像 + 名字 + 在线状态），
// 点谁就登谁。在线状态来自 PresenceContext：在在线的只有一个绿点，
// 不在线的是小灰字（3 分钟前 / 还没来过）。
export default function LoginModal() {
  const { name, token, users, loginOpen, closeLogin, login, challenge, setChallenge, verifyPin, setAccountPin, removeAccountPin } = useSession();
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
  const [sel, setSel] = useState('');
  const [msg, setMsg] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [pinVal, setPinVal] = useState('');
  // picker 只管选人 / 加入；account 是登录后管自己 PIN 的地方。pinOpen：保护卡里
  // 设 / 改 PIN 的输入框展开着没有。
  const [view, setView] = useState('picker');
  const [pinOpen, setPinOpen] = useState(false);
  const listRef = useRef(null), inputRef = useRef(null), pinRef = useRef(null);

  useEffect(() => {
    if (!loginOpen) return;
    setNewName(''); setMsg(''); setPinVal(''); setPinOpen(false);
    setSel(users.some(u => u.name === name) ? name : '');
    // 已登录（或从账号保护提醒进来）直接落到账号界面；没登录才是选人界面
    setView(name ? 'account' : 'picker');
    if (users.length) listRef.current?.querySelector('.sel, button')?.focus();
    else inputRef.current?.focus();
    const onKey = e => { if (e.key === 'Escape') closeLogin(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loginOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- 只在打开时聚焦一次

  // 进入输 PIN 视图时清空、聚焦
  useEffect(() => {
    setPinCode(''); setMsg('');
    if (challenge) setTimeout(() => pinRef.current?.focus(), 60);
  }, [challenge]);

  if (!loginOpen) return null;
  const field = 'flex-1 min-w-0 rounded-xl border border-white/70 bg-white/75 px-3.5 py-2.5 shadow-[inset_0_1px_3px_rgba(15,23,42,.06)] focus:outline-none focus:ring-2 focus:ring-indigo-400';
  const selUser = users.find(u => u.name === sel);
  const me = name ? users.find(u => u.name === name) : null;
  const myPres = name ? presOf(name) : null;
  const go = async n => { setMsg(''); const err = await login(n); if (err) setMsg(err); };
  const join = async () => { setMsg(''); const err = await login(newName); if (err) setMsg(err); };
  const doVerifyPin = async () => {
    setMsg('');
    const err = await verifyPin(pinCode);
    if (err) setMsg(err);
  };
  // 给自己设 / 改 PIN：要出示当前的 token。设上之后 token 会轮换，
  // setAccountPin 会把新身份换上。
  const startPinSet = async () => {
    setMsg('');
    const t = sel === name ? token : selUser?.token;
    if (!t) { setMsg('先登录这个账号再设 PIN'); return; }
    const err = await setAccountPin(sel, pinVal, t);
    if (err) { setMsg(err); return; }
    setPinOpen(false); setPinVal('');
  };
  const doRemovePin = async () => {
    setMsg('');
    const err = await removeAccountPin();
    if (err) setMsg(err);
  };
  // 账号保护卡：只出现在账号界面。sel 在账号界面里恒等于本人，所以卡里操作的都是自己的账号。
  const protectCard = selUser && (
    <div className="mb-3 rounded-2xl border border-white/60 bg-white/45 px-3.5 py-2.5">
      <p className="mb-1 text-xs font-bold tracking-wide text-slate-500">账号保护</p>
      <div className="flex items-center gap-2 py-1.5">
        <span className="text-sm font-bold text-slate-700">🔑 PIN</span>
        {selUser.pinBound ? (
          <>
            <span className="ml-auto text-xs text-slate-400">已设置</span>
            {sel === name && (
              <>
                <button onClick={() => setPinOpen(o => !o)} className="shrink-0 font-medium text-indigo-500 transition hover:text-indigo-700">改 PIN</button>
                <button onClick={doRemovePin} className="shrink-0 font-medium text-slate-400 transition hover:text-rose-500">去掉</button>
              </>
            )}
          </>
        ) : (
          <button onClick={() => setPinOpen(o => !o)} className="ml-auto shrink-0 rounded-lg bg-white/70 px-3 py-1.5 text-xs font-bold text-indigo-600 shadow-[0_1px_3px_rgba(15,23,42,.06)] transition hover:bg-white">设置</button>
        )}
      </div>
      {pinOpen && (
        <div className="mb-1.5 flex gap-2">
          <input value={pinVal} onChange={e => setPinVal(e.target.value.replace(/\D/g, '').slice(0, 4))} onKeyDown={e => e.key === 'Enter' && pinVal.length === 4 && startPinSet()}
            className={field} placeholder={selUser.pinBound ? `给 ${sel} 换个新 PIN` : `给 ${sel} 设个 4 位 PIN`} inputMode="numeric" maxLength={4} />
          <button onClick={startPinSet} disabled={pinVal.length !== 4} className="shrink-0 rounded-xl bg-slate-900/90 px-4 py-2.5 font-bold text-white shadow-[0_8px_20px_-6px_rgba(15,23,42,.5)] transition hover:bg-slate-900 active:scale-[.98] disabled:opacity-40">{selUser.pinBound ? '保存新 PIN' : '设置 PIN'}</button>
        </div>
      )}
      <p className="mt-1.5 text-[11px] leading-snug text-slate-400">设了 PIN，换设备登录要输一次；这台验过就不用了。</p>
    </div>
  );
  return (
    <div className="login-fade fixed inset-0 bg-slate-950/45 backdrop-blur-[3px] flex items-center justify-center z-50 px-4"
      onClick={e => { if (e.target === e.currentTarget) closeLogin(); }}>
      <div className="login-pop glass-sheet relative rounded-[28px] px-6 pb-6 pt-3 w-full max-w-sm" role="dialog" aria-modal="true" aria-label="登录">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-400/40" aria-hidden="true" />
        <button onClick={closeLogin} aria-label="关闭"
          className="login-close absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full border border-white/70 bg-white/60 text-base leading-none text-slate-500 shadow-[0_2px_8px_rgba(15,23,42,.12),inset_0_1px_0_rgba(255,255,255,.9)] hover:bg-white/90 hover:text-slate-700">✕</button>

        {challenge ? (
          <div>
            <div className="mb-5 flex items-center gap-3.5 pr-8">
              <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-[26px] shadow-[0_8px_20px_-6px_rgba(99,60,235,.6),inset_0_1px_0_rgba(255,255,255,.4)]">🔑</span>
              <div>
                <h3 className="text-xl font-extrabold leading-tight">输入 PIN</h3>
                <p className="mt-0.5 text-sm leading-snug text-slate-500"><b>{challenge.name}</b> · 这个设备还没验过</p>
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
              <span className="text-slate-400">连错 5 次锁 10 分钟</span>
            </div>
            {msg && <p className="mt-2.5 text-sm font-medium text-rose-600">{msg}</p>}
          </div>
        ) : view === 'account' && me ? (
          <div>
            <div className="mb-5 flex items-center gap-3.5 pr-8">
              <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-[26px] shadow-[0_8px_20px_-6px_rgba(99,60,235,.6),inset_0_1px_0_rgba(255,255,255,.4)]">👋</span>
              <div>
                <h3 className="text-xl font-extrabold leading-tight">{name}</h3>
                <p className="mt-0.5 text-sm leading-snug text-slate-500">已登录</p>
              </div>
            </div>
            <ul className="login-users mb-2">
              <li>
                <div className="login-user sel">
                  <span className="avatar login-user-av" aria-hidden="true">{Array.from(name)[0].toUpperCase()}</span>
                  <span className="login-user-name">{name}{me.pinBound ? ' 🔒' : ''}</span>
                  {myPres && (myPres.online
                    ? <span className="presence-dot on" role="img" aria-label="在线" />
                    : <span className="presence-when">{agoText(myPres.lastSeen, now)}</span>)}
                </div>
              </li>
            </ul>
            {protectCard}
            {msg && <p className="mt-2.5 text-sm font-medium text-rose-600">{msg}</p>}
            <button onClick={() => { setView('picker'); setPinOpen(false); setMsg(''); }} className="mt-1 w-full text-center text-sm font-medium text-slate-400 transition hover:text-slate-600">切换账号</button>
            <button onClick={closeLogin} className="mt-2.5 w-full text-center text-sm font-medium text-slate-400 transition hover:text-slate-600">先随便看看 →</button>
          </div>
        ) : (
          <div>
            <div className="mb-5 flex items-center gap-3.5 pr-8">
              <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-[26px] shadow-[0_8px_20px_-6px_rgba(99,60,235,.6),inset_0_1px_0_rgba(255,255,255,.4)]">👋</span>
              <div>
                <h3 className="text-xl font-extrabold leading-tight">你是谁？</h3>
                <p className="mt-0.5 text-sm leading-snug text-slate-500">选你的名字登录</p>
              </div>
            </div>
            {users.length > 0 && (
              <div>
                <div className="text-xs font-bold tracking-wide text-slate-500">我来过了</div>
                <ul className="login-users mb-2 mt-1.5" ref={listRef}>
                  {users.map(u => {
                    const p = presOf(u.name);
                    return (
                      <li key={u.name}>
                        <button type="button" className={'login-user' + (sel === u.name ? ' sel' : '')} aria-pressed={sel === u.name}
                          onClick={() => { setSel(u.name); setPinOpen(false); go(u.name); }}>
                          <span className="avatar login-user-av" aria-hidden="true">{Array.from(u.name)[0].toUpperCase()}</span>
                          <span className="login-user-name">{u.name}{u.pinBound ? ' 🔒' : ''}</span>
                          {p && (p.online
                            ? <span className="presence-dot on" role="img" aria-label="在线" />
                            : <span className="presence-when">{agoText(p.lastSeen, now)}</span>)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="mb-3.5 flex items-center gap-3 text-xs text-slate-400"><span className="flex-1 border-t border-white/60"></span>第一次来？<span className="flex-1 border-t border-white/60"></span></div>
              </div>
            )}
            <div className="flex gap-2">
              <input ref={inputRef} value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && join()}
                className={field} placeholder="输入你的名字，比如 Ken" maxLength={20} />
              <button onClick={join} className="shrink-0 rounded-xl bg-slate-900/90 px-5 py-2.5 font-bold text-white shadow-[0_8px_20px_-6px_rgba(15,23,42,.5)] transition hover:bg-slate-900 active:scale-[.98]">加入</button>
            </div>
            {msg && <p className="mt-2.5 text-sm font-medium text-rose-600">{msg}</p>}
            <button onClick={closeLogin} className="mt-4 w-full text-center text-sm font-medium text-slate-400 transition hover:text-slate-600">先随便看看 →</button>
          </div>
        )}
      </div>
    </div>
  );
}
