// 车型表：美国租车公司常见的车，按级别分组。服务器（worker/cars/routes.js）和页面共用这一份。
// 租车订的是「级别」（某某车或同级车型），到店才知道具体是哪辆，所以这里只要座位怎么排、
// 后备箱大概多大——不用接租车公司（他们也没有对个人开放的接口）。
//
// rows：每排几个座，第一排是主驾 + 副驾（面包车也是两个）。alt：同一款车常见的另一种排法
// （二排是长条座椅还是两个独立座椅，7 座 / 8 座），选车型时可以挑。
// liters：所有座位都用上时（三排车就是最后一排立着）后备箱实际能码行李的空间，大约是官方
// 容积（立方英尺，装到车顶）的七成（cuft × 28.3 × 0.68），用来和行李预设（bags.js）比。
export const CLASSES = [
  { id: 'sedan', name: '轿车' },
  { id: 'suv', name: '五座 SUV' },
  { id: 'suv3', name: '三排 SUV' },
  { id: 'mpv', name: '商务车（MPV）' },
  { id: 'bus', name: '大面包车（12–15 座）' },
];

const L = cuft => Math.round(cuft * 28.317 * 0.68 / 10) * 10;
const BENCH8 = [2, 3, 3], CAPT7 = [2, 2, 3];

export const MODELS = [
  { id: 'camry', cls: 'sedan', make: 'Toyota', name: 'Camry', rows: [2, 3], liters: L(15.1) },
  { id: 'corolla', cls: 'sedan', make: 'Toyota', name: 'Corolla', rows: [2, 3], liters: L(13.1) },
  { id: 'altima', cls: 'sedan', make: 'Nissan', name: 'Altima', rows: [2, 3], liters: L(15.4) },
  { id: 'malibu', cls: 'sedan', make: 'Chevrolet', name: 'Malibu', rows: [2, 3], liters: L(15.7) },
  { id: 'model3', cls: 'sedan', make: 'Tesla', name: 'Model 3', rows: [2, 3], liters: L(19.8) },

  { id: 'x5', cls: 'suv', make: 'BMW', name: 'X5', rows: [2, 3], liters: 650 },
  { id: 'rav4', cls: 'suv', make: 'Toyota', name: 'RAV4', rows: [2, 3], liters: L(37.6) },
  { id: 'crv', cls: 'suv', make: 'Honda', name: 'CR-V', rows: [2, 3], liters: L(39.3) },
  { id: 'rogue', cls: 'suv', make: 'Nissan', name: 'Rogue', rows: [2, 3], liters: L(36.5) },
  { id: 'equinox', cls: 'suv', make: 'Chevrolet', name: 'Equinox', rows: [2, 3], liters: L(29.9) },
  { id: 'tucson', cls: 'suv', make: 'Hyundai', name: 'Tucson', rows: [2, 3], liters: L(38.7) },
  { id: 'grandcherokee', cls: 'suv', make: 'Jeep', name: 'Grand Cherokee', rows: [2, 3], liters: L(37.7) },
  { id: 'outback', cls: 'suv', make: 'Subaru', name: 'Outback', rows: [2, 3], liters: L(32.5) },
  { id: 'modely', cls: 'suv', make: 'Tesla', name: 'Model Y', rows: [2, 3], liters: L(34.3) },

  { id: 'tahoe', cls: 'suv3', make: 'Chevrolet', name: 'Tahoe', rows: BENCH8, alt: CAPT7, liters: L(25.5) },
  { id: 'suburban', cls: 'suv3', make: 'Chevrolet', name: 'Suburban', rows: BENCH8, alt: CAPT7, liters: L(41.5) },
  { id: 'yukonxl', cls: 'suv3', make: 'GMC', name: 'Yukon XL', rows: BENCH8, alt: CAPT7, liters: L(41.5) },
  { id: 'expedition', cls: 'suv3', make: 'Ford', name: 'Expedition', rows: BENCH8, alt: CAPT7, liters: L(21) },
  { id: 'expeditionmax', cls: 'suv3', make: 'Ford', name: 'Expedition MAX', rows: BENCH8, alt: CAPT7, liters: L(36) },
  { id: 'escalade', cls: 'suv3', make: 'Cadillac', name: 'Escalade', rows: CAPT7, alt: BENCH8, liters: L(25.5) },
  { id: 'traverse', cls: 'suv3', make: 'Chevrolet', name: 'Traverse', rows: BENCH8, alt: CAPT7, liters: L(23) },
  { id: 'explorer', cls: 'suv3', make: 'Ford', name: 'Explorer', rows: [2, 3, 2], alt: [2, 2, 2], liters: L(18.2) },
  { id: 'highlander', cls: 'suv3', make: 'Toyota', name: 'Highlander', rows: BENCH8, alt: CAPT7, liters: L(16) },
  { id: 'grandhighlander', cls: 'suv3', make: 'Toyota', name: 'Grand Highlander', rows: BENCH8, alt: CAPT7, liters: L(20.6) },
  { id: 'pilot', cls: 'suv3', make: 'Honda', name: 'Pilot', rows: BENCH8, alt: CAPT7, liters: L(18.6) },
  { id: 'telluride', cls: 'suv3', make: 'Kia', name: 'Telluride', rows: BENCH8, alt: CAPT7, liters: L(21) },
  { id: 'palisade', cls: 'suv3', make: 'Hyundai', name: 'Palisade', rows: BENCH8, alt: CAPT7, liters: L(18) },
  { id: 'pathfinder', cls: 'suv3', make: 'Nissan', name: 'Pathfinder', rows: BENCH8, alt: CAPT7, liters: L(16.6) },
  { id: 'atlas', cls: 'suv3', make: 'Volkswagen', name: 'Atlas', rows: CAPT7, alt: BENCH8, liters: L(20.6) },
  { id: 'durango', cls: 'suv3', make: 'Dodge', name: 'Durango', rows: CAPT7, alt: BENCH8, liters: L(17.2) },
  { id: 'grandcherokeel', cls: 'suv3', make: 'Jeep', name: 'Grand Cherokee L', rows: [2, 3, 2], alt: [2, 2, 2], liters: L(17.2) },

  { id: 'pacifica', cls: 'mpv', make: 'Chrysler', name: 'Pacifica', rows: CAPT7, alt: BENCH8, liters: L(32.3) },
  { id: 'sienna', cls: 'mpv', make: 'Toyota', name: 'Sienna', rows: CAPT7, alt: BENCH8, liters: L(33.5) },
  { id: 'odyssey', cls: 'mpv', make: 'Honda', name: 'Odyssey', rows: BENCH8, alt: CAPT7, liters: L(32.8) },
  { id: 'carnival', cls: 'mpv', make: 'Kia', name: 'Carnival', rows: BENCH8, alt: CAPT7, liters: L(40.2) },

  { id: 'transit15', cls: 'bus', make: 'Ford', name: 'Transit 15 座', rows: [2, 3, 3, 3, 4], liters: 1200 },
  { id: 'transit12', cls: 'bus', make: 'Ford', name: 'Transit 12 座', rows: [2, 3, 3, 4], liters: 1800 },
  { id: 'express15', cls: 'bus', make: 'Chevrolet', name: 'Express 15 座', rows: [2, 3, 3, 3, 4], liters: 500 },
  { id: 'express12', cls: 'bus', make: 'Chevrolet', name: 'Express 12 座', rows: [2, 3, 3, 4], liters: 1300 },
  { id: 'sprinter12', cls: 'bus', make: 'Mercedes-Benz', name: 'Sprinter 12 座', rows: [2, 3, 3, 4], liters: 1600 },
];
export const modelById = id => MODELS.find(m => m.id === id) || null;

// 「其他车型」：自己写名字、几个座、后备箱大概多大
export const TRUNKS = [
  { id: 'S', name: '小（轿车那么大）', liters: 300 },
  { id: 'M', name: '中（五座 SUV）', liters: 650 },
  { id: 'L', name: '大（加长 SUV / 商务车）', liters: 850 },
  { id: 'XL', name: '很大（面包车）', liters: 1300 },
];
export const MIN_SEATS = 2, MAX_SEATS = 15;
// n 个座排成几排：第一排 2 个，后面每排 3 个，最后剩 4 个就排成 2 + 2，剩 1 个就单独一排
export function rowsForSeats(n) {
  const rows = [2];
  let rest = Math.max(0, Math.min(MAX_SEATS, n) - 2);
  while (rest > 0) { const k = rest === 4 ? 2 : Math.min(3, rest); rows.push(k); rest -= k; }
  return rows;
}

// 一辆车（{ model, v, custom }）的座位排法、后备箱、名字
export function layoutOf(car) {
  if (car.model === 'custom') return rowsForSeats(car.custom?.seats || 5);
  const m = modelById(car.model) || modelById('x5');
  return car.v === 1 && m.alt ? m.alt : m.rows;
}
export function trunkOf(car) {
  if (car.model === 'custom') return (TRUNKS.find(t => t.id === car.custom?.trunk) || TRUNKS[1]).liters;
  return (modelById(car.model) || modelById('x5')).liters;
}
export function modelName(car) {
  if (car.model === 'custom') return car.custom?.name || '其他车型';
  const m = modelById(car.model) || modelById('x5');
  return m.make + ' ' + m.name;
}
export const seatCount = rows => rows.reduce((a, b) => a + b, 0);
// 「Chevrolet Suburban（8 座）」；名字里已经带着几座的（Transit 15 座）就不再重复
export function modelTitle(car) {
  const n = modelName(car);
  return /座$/.test(n) ? n : n + '（' + seatCount(layoutOf(car)) + ' 座）';
}
export const rowsText = rows => rows.join('+');

// 座位 id：第一排 driver / front（三个就是 driver / frontMiddle / front），第二排 rearLeft /
// rearMiddle / rearRight（两个就是 rearLeft / rearRight）——和以前三辆 X5 存下来的座位一样；
// 第三排起 r3-1、r3-2…（从左往右）。
export function seatIds(rows) {
  return rows.flatMap((k, r) => {
    if (r === 0) return k === 3 ? ['driver', 'frontMiddle', 'front'] : k === 1 ? ['driver'] : ['driver', 'front'];
    if (r === 1) return k === 3 ? ['rearLeft', 'rearMiddle', 'rearRight'] : k === 2 ? ['rearLeft', 'rearRight'] : k === 1 ? ['rearMiddle'] : Array.from({ length: k }, (_, i) => 'r2-' + (i + 1));
    return Array.from({ length: k }, (_, i) => 'r' + (r + 1) + '-' + (i + 1));
  });
}
const ROW_NAMES = ['前排', '二排', '三排', '四排', '五排'];
const SIDE = { 1: ['中'], 2: ['左', '右'], 3: ['左', '中', '右'], 4: ['左', '中左', '中右', '右'] };
// 座位的中文名：主驾、副驾、后排左（两排的车）/ 二排左、三排中…
export function seatName(id, rows) {
  if (id === 'driver') return '主驾';
  if (id === 'front') return '副驾';
  if (id === 'frontMiddle') return '前排中';
  const ids = seatIds(rows);
  let at = ids.indexOf(id);
  if (at < 0) return id;
  for (let r = 0; r < rows.length; r++) {
    if (at < rows[r]) {
      const row = rows.length === 2 && r === 1 ? '后排' : ROW_NAMES[r] || (r + 1) + '排';
      return row + ((SIDE[rows[r]] || [])[at] || (at + 1));
    }
    at -= rows[r];
  }
  return id;
}
