import { useSyncExternalStore } from 'react';

// 坐在游戏桌上（那个游戏的页面开着、你坐下了）：左下 / 右下的悬浮球（聊天、投票）先收起来，
// 免得挡住出牌、落子的按钮。每张桌（每个游戏的连线）自己报一声，有一张坐着就算坐着。
const seats = new Set(), subs = new Set();
export function setSeated(id, on) {
  const had = seats.has(id);
  if (on) seats.add(id); else seats.delete(id);
  if (had !== on) subs.forEach(f => f());
}
const subscribe = f => { subs.add(f); return () => subs.delete(f); };
export const useSeated = () => useSyncExternalStore(subscribe, () => seats.size > 0);
