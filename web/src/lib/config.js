// 两段行程，各自一份候选清单（后端按 trip 分开存）
// areas：固定显示的区域标签页（按这个顺序）。每个区域的中心和范围在 worker/config/trips.js 的 zones 里，名字要一致；
// 不在这些范围里的房源，后端会按位置自动起新区域，标签页也会自动多出来（features/hunt/zones.js）
export const TRIPS = {
  nov25: { date: '11月25–26', people: 9, nights: 1, checkIn: '2026-11-25', checkOut: '2026-11-26', areas: ['Denver 市区', 'Denver 周边'],
    googleTs: 'CAEaIAoCGgASGhIUCgcI6g8QCxgZEgcI6g8QCxgaGAEyAggBKgkKBToDVVNEGgA' },
  nov26: { date: '11月26–29', people: 14, nights: 3, checkIn: '2026-11-26', checkOut: '2026-11-29', areas: ['大沙丘区域', '落基山 · Estes Park'],
    googleTs: 'CAEaIAoCGgASGhIUCgcI6g8QCxgaEgcI6g8QCxgdGAMyAggBKgkKBToDVVNEGgA' },
};
export const DEFAULT_TRIP = 'nov25';

// 左侧导航的几个页面。tripScoped：页面内容按行程分（显示行程标签页和日期人数）
// 这里的顺序就是导航里的标签顺序，八个全直接摆出来
export const VIEWS = {
  hunt: { title: '🏠 AirBnb hunting · 一起选房', sub: '看中哪间就把 Airbnb 链接贴进来，票数最高的我们就订它',
    nav: 'AirBnb hunting', navSub: '一起选房 · 投票', icon: '🏠', tripScoped: true },
  food: { title: '🍜 Restaurant hunting · 找餐厅', sub: '看中哪家就把 Google 地图链接贴进来，大家点想去',
    nav: 'Restaurants', navSub: '找餐厅 · Google 地图', icon: '🍜', tripScoped: true },
  activities: { title: '🎿 Activities · 玩什么', sub: '从 Reddit、本地媒体和官方推荐里扒的第一批 20 个候选 · 喜欢哪个就投票，票高的优先排进行程',
    nav: 'Activities', navSub: '玩什么 · 投票', icon: '🎿' },
  flights: { title: '✈️ Flights · 航班', sub: '大家填上到达和离开的航班 · 看航线地图，自动排接机和送机',
    nav: 'Flights', navSub: '航班 · 接送机', icon: '✈️' },
  calendar: { title: '📅 Calendar · 日程', sub: '按天看每个人的安排：住哪、航班、接送机',
    nav: 'Calendar', navSub: '日程 · 每天做什么', icon: '📅' },
  games: { title: '🎲 Gameroom', sub: 'Blackjack、斗地主、掼蛋、川麻、鲁班躲技能 · 筹码和豆子只是好玩，不跟分账挂钩',
    nav: 'Gameroom', navSub: 'Blackjack · 斗地主 · 掼蛋 · 川麻', icon: '🎲' },
  angel: { title: '😇 Secret Angel · 神秘天使', sub: '刷卡片选你想要的礼物 · 大家选好后抽签，偷偷给分到的人准备惊喜',
    nav: 'Secret Angel', navSub: '选礼物 · 抽天使', icon: '😇' },
  split: { title: '💰 Split that bill · 分账', sub: '全员一本账 · 共同支出记在这里，自动算清谁该给谁多少钱',
    nav: 'Split that bill', navSub: '分账 · 谁该给谁', icon: '💰' },
};
