import { useEffect, useRef, useState } from 'react';
import { load, save } from '../../lib/storage.js';

// 语音播报（狼人杀的「上帝」、谁是卧底 / 阿瓦隆的「请 3 号发言」）：用浏览器自带的朗读（speechSynthesis），
// 中文声音。iPhone 要在点按钮的那一下先说一句才放得出声，所以打开播报时就念「播报已开启」。
// 开着播报时让屏幕别黑（Wake Lock），不然手机一锁屏就不念了。
// 一桌人只要一台开着就够（不然十台手机一起念）：默认只有开局的人和没坐下的（放桌上当「上帝」的那台）开着，
// 别人自己点开；点过的以这台设备自己的选择为准。
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

let zh = null;
function voice() {
  if (!canSpeak()) return null;
  if (zh) return zh;
  const all = window.speechSynthesis.getVoices();
  zh = all.find(v => /^zh[-_]CN/i.test(v.lang)) || all.find(v => /^zh/i.test(v.lang)) || null;
  return zh;
}
if (canSpeak()) window.speechSynthesis.onvoiceschanged = () => { zh = null; voice(); };

export function speak(text) {
  if (!canSpeak() || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN'; u.rate = 1; u.pitch = 1;
  const v = voice(); if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}
export function hush() { if (canSpeak()) window.speechSynthesis.cancel(); }

// table.say: [{ id, text, at }] — the newest announcements. Speaks the ones that are new since the
// last state (not the backlog when you first open the page), only while `on`.
export function useAnnouncer(table, on) {
  const heard = useRef(null);
  useEffect(() => {
    const say = table?.say || [];
    const top = say.length ? say[say.length - 1].id : 0;
    if (heard.current == null || !on) { heard.current = top; return; }
    const fresh = say.filter(s => s.id > heard.current && (!s.at || !table.now || table.now - s.at < 20000));
    heard.current = Math.max(heard.current, top);
    for (const s of fresh.slice(-4)) speak(s.text);
  }, [table?.say, on]); // eslint-disable-line react-hooks/exhaustive-deps -- only new announcements matter
}

// 这台设备开不开播报：自己点过就按点的，没点过按默认（defaultOn）
export function useVoiceSetting(game, defaultOn) {
  const key = 'voice:' + game;
  const [mine, setMine] = useState(() => { const v = load(key); return v === 'on' ? true : v === 'off' ? false : null; });
  const on = mine ?? defaultOn;
  const set = v => { setMine(v); save(key, v ? 'on' : 'off'); if (v) speak('播报已开启'); else hush(); };
  return [on && canSpeak(), set];
}

// 开着播报时屏幕常亮（切回来要重新要一次）
export function useWakeLock(on) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock = null, dead = false;
    const get = async () => { try { lock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed now */ } };
    const onVis = () => { if (document.visibilityState === 'visible' && !dead) get(); };
    get();
    document.addEventListener('visibilitychange', onVis);
    return () => { dead = true; document.removeEventListener('visibilitychange', onVis); lock?.release?.().catch(() => {}); };
  }, [on]);
}
