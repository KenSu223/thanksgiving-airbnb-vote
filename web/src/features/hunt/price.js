// 价格：优先用 Airbnb 实时报价（按当前行程的日期和人数）
export const liveOf = (l, T) => (l.live && l.live.checkIn === T.checkIn && l.live.checkOut === T.checkOut ? l.live : null);
export const isBooked = (l, T) => { const v = liveOf(l, T); return !!(v && !v.available); };
// 用来排序/地图的价格：有实时价用实时价，否则退回手动添加时填的价格。
// Google 酒店的拉取价是每间房（2 人）的总价，按全团需要的间数放大成可比总价。
export function effPrice(l, T) {
  const v = liveOf(l, T);
  if (v) return v.available ? v.total : null;
  if (l.gPrice && l.gPrice.checkIn === T.checkIn && l.gPrice.checkOut === T.checkOut) {
    return l.gPrice.total * Math.ceil(T.people / 2);
  }
  return l.priceNights ? l.priceUSD || null : null;
}
export const UNAVAILABLE = { DATE: '这几天已经被订了', GUEST: '住不下这么多人，Airbnb 不给报价', MIN_NIGHTS: '不满足最少入住晚数', MAX_NIGHTS: '超过最多入住晚数' };

// 排序：先按所选方式排，订满的（实时报价显示这几天订不了）一律沉到最后，
// 组内仍保持所选排序。没有实时报价的房源不算订满，照常参与排序。
export function sortListings(list, sortBy, T) {
  const p = l => effPrice(l, T) || 1e9;
  const byMode = (a, b) => sortBy === 'votes'
    ? (b.votes || []).length - (a.votes || []).length || p(a) - p(b)
    : sortBy === 'added'
      ? (b.createdAt || 0) - (a.createdAt || 0)
      : p(a) - p(b);
  return list.slice().sort((a, b) => (isBooked(a, T) ? 1 : 0) - (isBooked(b, T) ? 1 : 0) || byMode(a, b));
}
