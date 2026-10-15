// 待办分三段：出发前、旅途中、回来后（和后端 worker/todos/routes.js 的 PHASES 对应）
export const PHASES = [
  { id: 'pre', name: '出发前', hint: '订东西、准备、打包' },
  { id: 'during', name: '旅途中', hint: '采购、跑腿、做饭' },
  { id: 'post', name: '回来后', hint: '收尾、分账、还东西' },
];
const WEEK = '日一二三四五六';
export const dueLabel = due => { if (!due) return ''; const d = new Date(due + 'T12:00:00Z'); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' 周' + WEEK[d.getUTCDay()]; };
// 今天（本地）之前的日期算过期
export const overdue = (t, today) => !t.done && t.due && t.due < today;
export const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
