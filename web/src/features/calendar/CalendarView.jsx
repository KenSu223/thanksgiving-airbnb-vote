import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { TRIPS } from '../../lib/config.js';
import { useSession } from '../../session/SessionContext.jsx';
import { ALL, byDay, eventTime, flightEvents, stayEvents } from './agenda.js';
import JourneyMap from './JourneyMap.jsx';

const WEEK = '日一二三四五六';
const dayLabel = date => { const d = new Date(date + 'T12:00:00Z'); return { md: (d.getUTCMonth() + 1) + '/' + d.getUTCDate(), wd: '周' + WEEK[d.getUTCDay()] }; };
const TONE = {
  stay: 'bg-indigo-50 border-indigo-200 text-indigo-900', flight: 'bg-sky-50 border-sky-200', car: 'bg-emerald-50 border-emerald-200',
  warn: 'bg-amber-50 border-amber-300', muted: 'bg-slate-50 border-dashed border-slate-300 text-slate-500',
};

function Event({ e }) {
  const body = (
    <div className={'flex gap-3 items-start border rounded-xl px-3 py-2 ' + (TONE[e.tone] || 'glass-card border-white/60')}>
      <span className="text-xl leading-6">{e.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="font-bold text-sm">{e.title}</div>
        {e.detail && <div className="text-xs text-slate-500 mt-0.5">{e.detail}</div>}
      </div>
      {e.link && <span className="text-xs text-indigo-600 whitespace-nowrap">Airbnb ↗</span>}
    </div>
  );
  return e.link ? <a href={e.link} target="_blank" rel="noopener" className="block hover:opacity-90">{body}</a> : body;
}

// 📅 日历：每个人按天看自己的安排（住宿 + 航班；以后加餐厅和活动的报名）
export default function CalendarView({ active }) {
  const { name, users } = useSession();
  const [who, setWho] = useState(null);
  const [listings, setListings] = useState({});
  const [votes, setVotes] = useState({});
  const [people, setPeople] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const dayRefs = useRef({});
  const me = who ?? (name || ALL);

  const load = useCallback(async () => {
    try {
      const [flights, ...states] = await Promise.all([api('/api/flights'), ...Object.keys(TRIPS).map(t => api('/api/state?trip=' + t))]);
      setListings(Object.fromEntries(Object.keys(TRIPS).map((t, i) => [t, states[i].listings || []])));
      setVotes(Object.fromEntries(Object.keys(TRIPS).map((t, i) => [t, states[i].vote || null])));
      if (flights.ok) setPeople(flights.people);
    } catch (e) {}
    setLoaded(true);
  }, []);
  useEffect(() => { if (active) load(); }, [active, load]);

  const days = useMemo(() => byDay([...stayEvents(listings, votes), ...flightEvents(people, me)]), [listings, votes, people, me]);
  const jump = date => dayRefs.current[date]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const hasFlights = me === ALL || people.some(p => p.name.toLowerCase() === me.toLowerCase() && (p.arrival || p.departure || p.noFlight));

  return (
    <div className="space-y-4">
      <section className="glass-card rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-bold">看谁的日程</label>
        <select value={me} onChange={e => setWho(e.target.value)} className="border rounded-full px-3 py-1.5 text-sm">
          <option value={ALL}>👥 所有人</option>
          {users.map(u => <option key={u.name} value={u.name}>{u.name}{u.name === name ? '（我）' : ''}</option>)}
        </select>
        <span className="text-xs text-slate-500">时间都是丹佛时间 · 住宿按每段行程票数最高的那间 · 餐厅和活动报名之后也会出现在这里</span>
      </section>

      {loaded && <JourneyMap people={people} who={me} listings={listings} votes={votes} visible={active} />}

      {/* 日期条：点一下跳到那天 */}
      <nav className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {days.map(d => {
          const { md, wd } = dayLabel(d.date);
          const n = d.allDay.length + d.timed.length;
          return (
            <button key={d.date} onClick={() => jump(d.date)} className="shrink-0 glass-card rounded-xl px-3 py-2 text-center hover:ring-2 hover:ring-indigo-300">
              <div className="text-xs text-slate-500">{wd}</div>
              <div className="font-black">{md}</div>
              <div className="text-[10px] text-indigo-600 h-3">{n ? '●'.repeat(Math.min(n, 4)) : ''}</div>
            </button>
          );
        })}
      </nav>

      {loaded && me !== ALL && !hasFlights && (
        <p className="text-sm bg-amber-50 rounded-xl px-4 py-2">✈️ {me} 还没填航班，去 Flights 页填上，航班和接送机就会出现在日历里</p>
      )}

      <div className="space-y-3">
        {days.map(d => {
          const { md, wd } = dayLabel(d.date);
          return (
            <section key={d.date} ref={el => { dayRefs.current[d.date] = el; }} className="glass-card rounded-2xl p-4 scroll-mt-4">
              <h3 className="font-black text-lg mb-2">{md} <span className="text-sm font-medium text-slate-500">{wd}</span></h3>
              <div className="space-y-2">
                {d.allDay.map(e => <Event key={e.id} e={e} />)}
                {d.timed.map(e => (
                  <div key={e.id} className="flex gap-3 items-start">
                    <span className="w-12 shrink-0 pt-2 text-sm font-bold tabular-nums text-slate-600">{eventTime(e)}</span>
                    <div className="flex-1 min-w-0"><Event e={e} /></div>
                  </div>
                ))}
                {!d.allDay.length && !d.timed.length && <p className="text-sm text-slate-400">没有安排</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
