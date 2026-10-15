// 日历：把各个页面的数据变成一条条「事件」，再按天排好。
// 每个来源一个函数（住宿、航班……），以后餐厅和活动的报名加一个来源就行。
// 事件：{ id, at: UTC 毫秒 | null（全天）, date: 'YYYY-MM-DD'（丹佛日期）, icon, title, detail, tone, link }
import { TRIPS } from '../../lib/config.js';
import { sortListings, isBooked } from '../hunt/price.js';
import { departureRuns, duration, localTime, pickupRuns } from '../flights/plan.js';

export const TZ = 'America/Denver'; // 行程都在科罗拉多，日历按丹佛时间排
export const ALL = '__all__';

export const dateOf = ms => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const timeOf = ms => localTime(ms, TZ, false);
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// 一段行程住哪：投票截止后是大家定下的那间，之前是目前票数最高的。{ top, chosen } 或 top 为空
export function tripStay(key, listingsByTrip, voteByTrip = {}) {
  const T = TRIPS[key], all = listingsByTrip[key] || [], vote = voteByTrip[key];
  const chosen = vote && vote.chosenId ? all.find(l => l.id === vote.chosenId) : null;
  return { top: chosen || sortListings(all.filter(l => (l.votes || []).length), 'votes', T)[0] || null, chosen };
}

// 🏠 每段行程票数最高的那间：入住、住在、退房（Airbnb 没给具体时间，算全天）
export function stayEvents(listingsByTrip, voteByTrip = {}) {
  const out = [];
  for (const [key, T] of Object.entries(TRIPS)) {
    const vote = voteByTrip[key];
    const { top, chosen } = tripStay(key, listingsByTrip, voteByTrip);
    if (!top) {
      out.push({ id: key + ':none', at: null, date: T.checkIn, icon: '🏠', tone: 'muted', title: T.date + ' 住哪还没定', detail: '去 Stays 投票，票最高的会出现在这里' });
      continue;
    }
    const votes = top.votes.length;
    const warn = isBooked(top, T) ? ' · ⚠️ Airbnb 显示这几天已经订不了' : '';
    const link = 'https://www.airbnb.com/rooms/' + top.roomId + '?adults=' + T.people + '&check_in=' + T.checkIn + '&check_out=' + T.checkOut;
    const base = { tone: warn ? 'warn' : 'stay', link };
    const status = chosen ? (vote.booking?.status === 'booked' ? '✅ 已订好' : '🏆 大家定了这间（' + votes + ' 票）') : '目前票数最高（' + votes + ' 票）· 还在投票';
    out.push({ ...base, id: key + ':in', at: null, date: T.checkIn, icon: '🏠', title: '入住 ' + top.title, detail: status + (top.area ? ' · ' + top.area : '') + ' · 住 ' + T.nights + ' 晚' + warn });
    for (let d = addDays(T.checkIn, 1); d < T.checkOut; d = addDays(d, 1)) {
      out.push({ ...base, id: key + ':' + d, at: null, date: d, icon: '🛏️', title: '住在 ' + top.title, detail: top.area || '' });
    }
    out.push({ ...base, id: key + ':out', at: null, date: T.checkOut, icon: '🧳', title: '退房 ' + top.title, detail: '' });
  }
  return out;
}

// ✈️ 航班、接机、全员还车。who 是某个人的名字，或 ALL 看所有人
export function flightEvents(people, who) {
  const all = who === ALL;
  const mine = p => all || same(p.name, who);
  const travelers = people.filter(p => !p.noFlight);
  const out = [];
  for (const p of travelers.filter(mine)) {
    const prefix = all ? p.name + ' ' : '';
    if (p.arrival) {
      const f = p.arrival;
      out.push({ id: p.name + ':arr', at: f.arrUtc, date: dateOf(f.arrUtc), icon: '🛬', tone: 'flight',
        title: prefix + '落地 ' + f.to.iata + ' · ' + f.flight,
        detail: f.from.iata + ' ' + localTime(f.depUtc, f.from.tz) + '（当地）起飞 · 飞 ' + duration(f.minutes) });
    }
    if (p.departure) {
      const f = p.departure;
      out.push({ id: p.name + ':dep', at: f.depUtc, date: dateOf(f.depUtc), icon: '🛫', tone: 'flight',
        title: prefix + f.flight + ' 起飞 ' + f.from.iata + ' → ' + f.to.iata,
        detail: '到 ' + f.to.city + ' ' + localTime(f.arrUtc, f.to.tz) + '（当地）· 飞 ' + duration(f.minutes) });
    }
  }
  // 接机：被接的人看到谁来接，司机看到去接谁
  for (const r of pickupRuns(travelers)) {
    const names = r.items.map(i => i.name);
    const drivers = [...new Set(r.items.map(i => i.pickupBy).filter(Boolean))];
    const where = r.airport.iata + ' ' + r.airport.city;
    if (all || drivers.some(d => same(d, who))) {
      out.push({ id: 'pickup:' + r.airport.iata + r.first, at: r.pickupAt, date: dateOf(r.pickupAt), icon: '🚗', tone: drivers.length ? 'car' : 'warn',
        title: (drivers.length ? drivers.join('、') + ' ' : '') + '去 ' + r.airport.iata + ' 接 ' + names.join('、'),
        detail: drivers.length ? where : where + ' · ⚠️ 还没人认领，去 Flights 页点「我来接」' });
    } else if (names.some(n => same(n, who))) {
      out.push({ id: 'pickup:' + r.airport.iata + r.first, at: r.pickupAt, date: dateOf(r.pickupAt), icon: '🚗', tone: drivers.length ? 'car' : 'warn',
        title: drivers.length ? drivers.join('、') + ' 来 ' + r.airport.iata + ' 接你' : '在 ' + r.airport.iata + ' 等接机',
        detail: drivers.length ? (names.length > 1 ? '同一趟还有 ' + names.filter(n => !same(n, who)).join('、') : '') : '⚠️ 还没人认领这趟接机' });
    }
  }
  // 全员一起去机场还车
  for (const r of departureRuns(travelers)) {
    if (!all && !r.items.some(i => same(i.name, who))) continue;
    out.push({ id: 'return:' + r.airport.iata, at: r.arriveBy, date: dateOf(r.arriveBy), icon: '🚙', tone: 'car',
      title: '全员到 ' + r.airport.iata + ' 租车点还车',
      detail: timeOf(r.terminalBy) + ' 前到航站楼 · 按最早的 ' + r.items[0].f.flight + '（' + r.items[0].name + '）算' });
  }
  return out;
}

// 按天分组：[{ date, allDay: [...], timed: [...] }]，覆盖所有事件和行程日期之间的每一天
export function byDay(events) {
  const tripDates = Object.values(TRIPS).flatMap(T => [T.checkIn, T.checkOut]);
  const dates = events.map(e => e.date).concat(tripDates).sort();
  if (!dates.length) return [];
  const days = [];
  for (let d = dates[0]; d <= dates[dates.length - 1]; d = addDays(d, 1)) {
    const today = events.filter(e => e.date === d);
    days.push({ date: d, allDay: today.filter(e => e.at == null), timed: today.filter(e => e.at != null).sort((a, b) => a.at - b.at) });
  }
  return days;
}

export const eventTime = e => (e.at == null ? '' : timeOf(e.at));
