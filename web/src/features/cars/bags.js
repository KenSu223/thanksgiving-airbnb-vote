import { layoutOf, modelById, seatName as seatNameIn } from './models.js';

// 行李预设：名字、尺寸说明、大概占多少升（用来估后备箱装不装得下）。和后端 worker/cars/routes.js 的 BAGS 一一对应
export const BAGS = [
  { id: 'backpack', name: '背包', hint: '双肩包 / 随身小包', liters: 25 },
  { id: 'carryon', name: '登机箱', hint: '20 寸左右', liters: 40 },
  { id: 'medium', name: '中号箱', hint: '24 寸托运', liters: 70 },
  { id: 'large', name: '大号箱', hint: '28 寸托运', liters: 100 },
  { id: 'duffel', name: '旅行袋', hint: '软包 / 健身包', liters: 55 },
  { id: 'skis', name: '雪具包', hint: '雪板或双板', liters: 80 },
];
// 一个 28 寸大箱占多少升：车型表里「能放约 N 个大箱」用它算
export const LARGE_LITERS = BAGS.find(b => b.id === 'large').liters;

// 座位名（主驾、后排左、三排中…）跟着这辆车的排法走
export const seatName = (id, car) => seatNameIn(id, layoutOf(car));
export const seatShort = (id, car) => seatName(id, car).replace('排', '');
// 车的叫法：起了名就用名字，不然是车型 + 第几辆（Suburban · 2）
export const modelShort = car => (car.model === 'custom' ? car.custom?.name || '其他车型' : (modelById(car.model) || modelById('x5')).name);
export const carName = (car, i) => car.label || modelShort(car) + ' · ' + (i + 1);

// 一辆车上所有乘客的行李加起来：{ counts: { carryon: 3, … }, liters, pieces }
export function carLoad(car, bagsByName) {
  const counts = {};
  let liters = 0, pieces = 0;
  for (const who of Object.values(car.seats)) {
    if (!who) continue;
    for (const b of BAGS) {
      const n = (bagsByName[who] || {})[b.id] || 0;
      if (!n) continue;
      counts[b.id] = (counts[b.id] || 0) + n;
      liters += n * b.liters; pieces += n;
    }
  }
  return { counts, liters, pieces };
}
