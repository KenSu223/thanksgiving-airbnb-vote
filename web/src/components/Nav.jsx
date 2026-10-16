import { useEffect } from 'react';
import { NAV_GROUPS, VIEWS } from '../lib/config.js';
import { load, save } from '../lib/storage.js';
import NavIcon from './NavIcon.jsx';
import PresencePanel from './PresencePanel.jsx';
import { reduceMotion } from '../lib/motion.js';
import './nav.css';

// 左侧导航（md 以上，也包括横过来的手机）：按 config 里的分组和顺序全摆出来，每组上面一个小组名。
// 比屏幕高时侧栏自己上下滑；矮屏幕上收紧（nav.css）
export function Sidebar({ view, onView }) {
  return (
    <aside id="sidebar" className="hidden md:flex flex-col w-64 shrink-0 h-screen sticky top-0 px-4 py-6">
      <div className="side-brand px-2 mb-8">
        <img src="/icon.svg" alt="" width="40" height="40" className="w-10 h-10 rounded-xl mb-3 shadow-md" />
        <div className="font-extrabold text-lg leading-tight">Denver 感恩节之旅</div>
        <div className="side-tag text-xs text-slate-500 mt-1">Thanksgiving 2026 · 大家一起</div>
      </div>
      <nav className="flex flex-col" aria-label="主导航">
        {NAV_GROUPS.map(([g, label]) => (
          <div key={g} className="nav-group">
            <div className="nav-group-label">{label}</div>
            {pagesOf(g).map(([k, v]) => (
              <button key={k} className={'nav-item' + (k === view ? ' active' : '')} aria-current={k === view ? 'page' : undefined} onClick={() => onView(k)}>
                <span className="nav-ico"><NavIcon name={v.icon} /></span>
                <span className="nav-name">{v.nav}</span>
                <span className="nav-sub">{v.navSub}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="mt-auto">
        <PresencePanel />
        <p className="side-foot px-2 text-xs text-slate-500 leading-relaxed">有链接的人都能加房源、投票、记账 · 数据实时共享</p>
      </div>
    </aside>
  );
}

const pagesOf = g => Object.entries(VIEWS).filter(([, v]) => v.group === g);
// 每组记住上次看的是哪页：点底部的「一起」回到上次的游戏 / 分账，而不是每次都从第一页开始
const LAST = 'navLast:';
const lastOf = g => { const v = load(LAST + g); return VIEWS[v]?.group === g ? v : pagesOf(g)[0][0]; };

// 手机底部：三个大组（行程 / 去哪 / 一起），一排放得下，新来的人一眼看到全部。
// 点别的组 → 那组上次看的页；点正在看的组 → 回到顶上（组里的小标签在标题下面）
export function BottomNav({ view, onView }) {
  const group = VIEWS[view]?.group;
  useEffect(() => { if (group) save(LAST + group, view); }, [view, group]);
  const pick = g => {
    if (g === group) window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    else onView(lastOf(g));
  };
  return (
    <div id="bottomNav" className="md:hidden fixed z-40">
      <nav className="bnav-strip" aria-label="主导航">
        {NAV_GROUPS.map(([g, label, icon]) => (
          <button key={g} className={'bnav-item' + (g === group ? ' active' : '')} aria-current={g === group ? 'true' : undefined} onClick={() => pick(g)}>
            <span className="nav-ico"><NavIcon name={icon} size={22} /></span>{label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// 手机上标题下面那一排：这一组里的几页（像 App Store 顶上的分段标签，只有字，五个也放得下一排）。
// 电脑上侧栏已经全有了，不显示
export function SubTabs({ view, onView }) {
  const group = VIEWS[view]?.group;
  const pages = group ? pagesOf(group) : [];
  if (pages.length < 2) return null;
  return (
    <nav className="subtabs md:hidden" aria-label={NAV_GROUPS.find(([g]) => g === group)?.[1]}>
      {pages.map(([k, v]) => (
        <button key={k} className={'subtab' + (k === view ? ' active' : '')} aria-current={k === view ? 'page' : undefined} onClick={() => onView(k)}>
          {v.navSub}
        </button>
      ))}
    </nav>
  );
}
