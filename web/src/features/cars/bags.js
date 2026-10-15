// 行李预设：名字、尺寸说明、大概占多少升（用来估后备箱装不装得下）。和后端 worker/cars/routes.js 的 BAGS 一一对应
export const BAGS = [
  { id: 'backpack', name: '背包', hint: '双肩包 / 随身小包', liters: 25 },
  { id: 'carryon', name: '登机箱', hint: '20 寸左右', liters: 40 },
  { id: 'medium', name: '中号箱', hint: '24 寸托运', liters: 70 },
  { id: 'large', name: '大号箱', hint: '28 寸托运', liters: 100 },
  { id: 'duffel', name: '旅行袋', hint: '软包 / 健身包', liters: 55 },
  { id: 'skis', name: '雪具包', hint: '雪板或双板', liters: 80 },
];
// X5 后排坐满人时，后备箱实际能码行李的空间大约这么多（官方 33.9 立方英尺是装到车顶的）
export const TRUNK_LITERS = 650;

export const SEATS = [
  { id: 'driver', name: '主驾', short: '主驾' },
  { id: 'front', name: '副驾', short: '副驾' },
  { id: 'rearLeft', name: '后排左', short: '后左' },
  { id: 'rearMiddle', name: '后排中', short: '后中' },
  { id: 'rearRight', name: '后排右', short: '后右' },
];
export const seatName = id => (SEATS.find(s => s.id === id) || { name: id }).name;
export const carName = (car, i) => car.label || 'X5 · ' + (i + 1);

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
