import { TRIPS, VIEWS } from '../lib/config.js';
import { SubTabs } from './Nav.jsx';
import './header.css';

// 页面标题。按行程分的页面（选房）才显示行程标签页和日期人数；分账、21 点是全员的。
// 手机上标题下面是这一组的几页（SubTabs），电脑上在侧栏
export default function Header({ view, trip, onTrip, onView }) {
  const V = VIEWS[view], T = TRIPS[trip];
  return (
    <header className="app-header px-6 py-7 md:py-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{V.nav}<span className="ml-3 font-medium text-slate-400 text-xl md:text-2xl">{V.navSub}</span></h1>
        <SubTabs view={view} onView={onView} />
        <p className="mt-2 text-slate-600">{(V.tripScoped ? T.date + ' · ' + T.people + '人 · 住' + T.nights + '晚 · ' : '') + V.sub}</p>
        {V.tripScoped && (
          <nav className="mt-5 flex flex-wrap gap-2" aria-label="行程">
            {Object.entries(TRIPS).map(([k, t]) => (
              <button key={k} className={'trip-tab rounded-full px-5 py-2 font-bold' + (k === trip ? ' active' : '')} aria-current={k === trip ? 'true' : undefined} onClick={() => onTrip(k)}>
                {t.date} <span className="font-normal text-sm opacity-80">· {t.people}人 · {t.nights}晚</span>
              </button>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
