// 两段行程，各自一份候选清单（后端按 trip 分开存）
// areas：固定显示的区域标签页（按这个顺序）。每个区域的中心和范围在 worker/config/trips.js 的 zones 里，名字要一致；
// 不在这些范围里的房源，后端会按位置自动起新区域，标签页也会自动多出来（features/hunt/zones.js）
export const TRIPS = {
  nov25: { date: '11月25–26', people: 9, nights: 1, checkIn: '2026-11-25', checkOut: '2026-11-26', areas: ['Denver 市区', 'Denver 周边'] },
  nov26: { date: '11月26–29', people: 14, nights: 3, checkIn: '2026-11-26', checkOut: '2026-11-29', areas: ['大沙丘区域', '落基山 · Estes Park'] },
};
export const DEFAULT_TRIP = 'nov25';

// 左侧导航的几个页面。tripScoped：页面内容按行程分（显示行程标签页和日期人数）
// 导航：一个英文单词 + 中文名，按行程的先后排、分三组。电脑上侧栏全摆出来（组名在上面）；
// 手机上底部只有三个组（行程 / 去哪 / 一起），组里的页面是标题下面的一排小标签（navSub 当标签名）。
// 页面标题也由这两个名字拼成，导航和标题永远一致。键名就是网址里的 #…，别改（旧链接要能打开）。
// NAV_GROUPS：[键, 组名, 手机底部的图标]
export const NAV_GROUPS = [['trip', '行程', 'trip'], ['explore', '去哪', 'explore'], ['together', '一起', 'together']];
const views = {
  hunt: { nav: 'Stays', navSub: '住宿', icon: 'stays', group: 'trip', tripScoped: true,
    sub: '看中哪间就把 Airbnb 或酒店链接贴进来，票数最高的我们就订它' },
  flights: { nav: 'Flights', navSub: '航班', icon: 'flights', group: 'trip',
    sub: '大家填上到达和离开的航班 · 看航线地图，自动排接机和送机' },
  cars: { nav: 'Cars', navSub: '用车', icon: 'cars', group: 'trip',
    sub: '每辆车挑个车型（几个座、后备箱多大），先到先得选座位，再告诉大家你带几件什么行李' },
  calendar: { nav: 'Schedule', navSub: '日程', icon: 'schedule', group: 'trip',
    sub: '按天看每个人的安排：住哪、航班、接送机' },
  todos: { nav: 'Tasks', navSub: '待办', icon: 'tasks', group: 'trip',
    sub: '出发前要准备的、路上要跑的腿、回来要收尾的 · 加一条，指派给谁，或者自己点「我来」认领' },
  food: { nav: 'Dining', navSub: '餐厅', icon: 'dining', group: 'explore', tripScoped: true,
    sub: '看中哪家就把 Google 地图链接贴进来，大家点想去' },
  activities: { nav: 'Activities', navSub: '活动', icon: 'activities', group: 'explore',
    sub: '从 Reddit、本地媒体和官方推荐里扒的第一批 20 个候选 · 喜欢哪个就投票，票高的优先排进行程' },
  games: { nav: 'Games', navSub: '游戏', icon: 'games', group: 'together',
    sub: 'Blackjack、斗地主、掼蛋、川麻、鲁班躲技能、2048、五子棋、谁是卧底、阿瓦隆、狼人杀 · 筹码和豆子只是好玩，不跟分账挂钩' },
  angel: { nav: 'Gifts', navSub: '神秘天使', icon: 'gifts', group: 'together',
    sub: '答几道小问题让天使认识你 · 大家交了之后抽签，偷偷给分到的人准备惊喜' },
  split: { nav: 'Expenses', navSub: '分账', icon: 'expenses', group: 'together',
    sub: '全员一本账 · 共同支出记在这里，自动算清谁该给谁多少钱' },
};
export const VIEWS = Object.fromEntries(Object.entries(views).map(([k, v]) => [k, { ...v, title: v.nav + ' · ' + v.navSub }]));
