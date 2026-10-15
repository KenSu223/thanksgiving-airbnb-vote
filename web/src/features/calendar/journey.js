// 旅程地图的数据：某个人（或所有人）按时间顺序走过的地方和每一段路。
//   一个人：老家机场 ✈ 丹佛 → 🚗 各段行程住的房子（只算 ta 人在科罗拉多那几天的）→ 🚗 机场 ✈ 回家
//   所有人：大家的到达航班一起飞进来 → 全员开车跑一遍各段住处 → 回机场 → 大家的离开航班一起飞走
// 每一步（step）是同时动的几段路（legs）；地图按步播放，下面的站点条也是按步列的。
import { TRIPS } from '../../lib/config.js';
import { arc, bend, km } from '../../lib/geo.js';
import { ALL, dateOf, tripStay } from './agenda.js';
import { localTime } from '../flights/plan.js';

export const COLORS = ['#4f46e5', '#e11d48', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#2563eb'];
const md = date => { const [, m, d] = date.split('-').map(Number); return m + '/' + d; };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const hasSpot = p => p && p.lat != null && p.lng != null;
// 开车多久：直线距离 × 1.3（路是弯的）÷ 85 km/h，按半小时取整
export const driveHours = (a, b) => Math.max(0.5, Math.round(km(a, b) * 1.3 / 85 * 2) / 2);

const airport = a => ({ id: 'ap:' + a.iata, kind: 'airport', lat: a.lat, lng: a.lng, label: a.iata, name: a.city || a.name });
function stayStop(key, l) {
  const T = TRIPS[key];
  return { id: 'stay:' + key, kind: 'stay', lat: l.lat, lng: l.lng, label: md(T.checkIn), name: l.title || '住处', area: l.area || '', date: T.checkIn, trip: key };
}
const flightLeg = (f, color, who) => ({ kind: 'flight', from: airport(f.from), to: airport(f.to), pts: arc(f.from, f.to), color, who, minutes: f.minutes });
const driveLeg = (from, to, color) => ({ kind: 'drive', from, to, pts: bend(from, to), color, hours: driveHours(from, to) });

// 住处：每段行程定下（或票最高）、有坐标的那间，按入住日期排
function stays(listingsByTrip, votes) {
  return Object.keys(TRIPS).map(k => ({ key: k, l: tripStay(k, listingsByTrip, votes).top }))
    .filter(s => hasSpot(s.l)).sort((a, b) => TRIPS[a.key].checkIn.localeCompare(TRIPS[b.key].checkIn));
}
// 这个人人在科罗拉多的日子和这段住宿有没有重叠（没填航班就算都在）
const overlaps = (T, p) => {
  const from = p && p.arrival ? dateOf(p.arrival.arrUtc) : '0000';
  const to = p && p.departure ? dateOf(p.departure.depUtc) : '9999';
  return T.checkIn < to && T.checkOut > from;
};
const driveStep = (from, to, title, when) => ({ kind: 'drive', legs: [driveLeg(from, to, '#0f172a')], title, when: when + ' · 约 ' + driveHours(from, to) + ' 小时车程', to });
const tz = 'America/Denver';

export function buildJourney(people, who, listingsByTrip, votes) {
  const all = who === ALL;
  const travelers = people.filter(p => !p.noFlight);
  const homes = stays(listingsByTrip, votes);
  const steps = [];
  if (!all) {
    const p = travelers.find(x => same(x.name, who));
    let at = null;
    if (p && p.arrival) {
      const f = p.arrival;
      steps.push({ kind: 'flight', legs: [flightLeg(f, COLORS[0], p.name)], title: f.from.iata + ' → ' + f.to.iata + ' · ' + f.flight, when: md(dateOf(f.arrUtc)) + ' ' + localTime(f.arrUtc, tz, false) + ' 落地', to: airport(f.to) });
      at = airport(f.to);
    }
    for (const s of homes.filter(s => overlaps(TRIPS[s.key], p))) {
      const stop = stayStop(s.key, s.l);
      if (at) steps.push(driveStep(at, stop, '入住 ' + stop.name, md(stop.date)));
      else steps.push({ kind: 'start', legs: [], title: '入住 ' + stop.name, when: md(stop.date), to: stop });
      at = stop;
    }
    if (p && p.departure) {
      const f = p.departure, ap = airport(f.from);
      if (at && at.id !== ap.id) steps.push(driveStep(at, ap, '去 ' + f.from.iata + ' 还车', md(dateOf(f.depUtc))));
      steps.push({ kind: 'flight', legs: [flightLeg(f, COLORS[0], p.name)], title: f.from.iata + ' → ' + f.to.iata + ' · ' + f.flight, when: md(dateOf(f.depUtc)) + ' ' + localTime(f.depUtc, tz, false) + ' 起飞', to: airport(f.to) });
    }
  } else {
    const arr = travelers.filter(p => p.arrival), dep = travelers.filter(p => p.departure);
    const hubOf = list => { // 大家最常落地 / 起飞的那个机场
      const n = new Map();
      for (const f of list) n.set(f.iata, { a: f, c: ((n.get(f.iata) || {}).c || 0) + 1 });
      return [...n.values()].sort((x, y) => y.c - x.c)[0]?.a || null;
    };
    const days = list => { const d = list.map(dateOf).sort(); return d.length ? md(d[0]) + (d[0] !== d[d.length - 1] ? '–' + md(d[d.length - 1]) : '') : ''; };
    let at = null;
    if (arr.length) {
      const hub = hubOf(arr.map(p => p.arrival.to));
      steps.push({ kind: 'flight', legs: arr.map((p, i) => flightLeg(p.arrival, COLORS[i % COLORS.length], p.name)), title: arr.length + ' 人飞到 ' + hub.iata, when: days(arr.map(p => p.arrival.arrUtc)) + ' 陆续落地', to: airport(hub) });
      at = airport(hub);
    }
    for (const s of homes) {
      const stop = stayStop(s.key, s.l);
      if (at) steps.push(driveStep(at, stop, '入住 ' + stop.name, md(stop.date)));
      else steps.push({ kind: 'start', legs: [], title: '入住 ' + stop.name, when: md(stop.date), to: stop });
      at = stop;
    }
    if (dep.length) {
      const hub = airport(hubOf(dep.map(p => p.departure.from)));
      if (at && at.id !== hub.id) steps.push(driveStep(at, hub, '回 ' + hub.label + ' 还车', days(dep.map(p => p.departure.depUtc))));
      steps.push({ kind: 'flight', legs: dep.map((p, i) => flightLeg(p.departure, COLORS[i % COLORS.length], p.name)), title: dep.length + ' 人从 ' + hub.label + ' 飞回家', when: days(dep.map(p => p.departure.depUtc)) + ' 陆续起飞', to: null });
    }
  }
  // 站点：每段路的两头，去重，按第一次出现排
  const stops = [];
  const add = s => { if (s && hasSpot(s) && !stops.some(x => x.id === s.id)) stops.push(s); };
  for (const st of steps) { if (st.kind === 'start') add(st.to); for (const l of st.legs) { add(l.from); add(l.to); } }
  return { steps, stops };
}
