// 神秘天使的十道题（服务器 worker/angel/routes.js 和页面共用这一份）。大家可能互相不熟，
// 礼物分类又太具体，所以改成问答：先从十张问题卡片里挑五张，再一张一张回答（正好五道，不会全答），
// 每道一行。第一张「不能送的」必答（防踩雷），算在五道里。每张卡有自己的 emoji 和渐变色。
// id 存到后端，改文案不影响已经存的答案；新题加在后面。
export const QUESTIONS = [
  { id: 'nogo', emoji: '🙅', text: '有什么不能送的？', hint: '过敏、忌口、不喝酒、不想占行李…', required: true, from: '#be123c', to: '#f43f5e' },
  { id: 'travel', emoji: '🧳', text: '旅行时离不开的一样东西', hint: '比如：降噪耳机、润唇膏', from: '#0369a1', to: '#0ea5e9' },
  { id: 'rich', emoji: '💰', text: '如果财富自由，最想做什么？', hint: '环游世界？开个小馆子？', from: '#a16207', to: '#eab308' },
  { id: 'shop', emoji: '🏪', text: '如果你开一家小店，会开什么店？', hint: '咖啡店？书店？花店？', from: '#6d28d9', to: '#a855f7' },
  { id: 'giftcard', emoji: '💳', text: '如果有一张购物卡，必须今天花完，你会买什么？', hint: '想买却一直没舍得的…', from: '#0f766e', to: '#14b8a6' },
  { id: 'dayoff', emoji: '🏖️', text: '如果明天放一天假、什么都不用管，你会怎么过？', hint: '宅家追剧？出门爬山？', from: '#c2410c', to: '#f97316' },
  { id: 'skill', emoji: '✨', text: '如果能瞬间学会一项技能，你选什么？', hint: '做饭？画画？弹吉他？', from: '#4338ca', to: '#818cf8' },
  { id: 'world', emoji: '🎬', text: '如果能住进任何一部电影、动画或游戏的世界，你选哪个？', hint: '哈利波特？宝可梦？吉卜力？', from: '#9d174d', to: '#ec4899' },
  { id: 'snack', emoji: '🍿', text: '如果这辈子只能吃一种零食，是什么？', hint: '黑巧？薯片？辣条？', from: '#92400e', to: '#d97706' },
  { id: 'room', emoji: '🛋️', text: '如果你的房间只能再加一样东西，会是什么？', hint: '一盏灯？一张懒人沙发？', from: '#166534', to: '#22c55e' },
];
export const ANSWERS = 5; // 正好答这么多道
export const MAX_ANSWER = 60;
export const questionById = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));

// 只留认识的题、去掉空白，每道最多 MAX_ANSWER 个字
export function cleanAnswers(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const q of QUESTIONS) {
    const v = String(raw[q.id] ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER);
    if (v) out[q.id] = v;
  }
  return out;
}
// 还差什么才能交（没问题就是 null）：「不能送的」必答，一共正好 ANSWERS 道
export function answersError(answers) {
  const a = cleanAnswers(answers);
  const missing = QUESTIONS.filter(q => q.required && !a[q.id]);
  if (missing.length) return '「' + missing[0].text + '」要答一下';
  const n = Object.keys(a).length;
  if (n < ANSWERS) return '再答 ' + (ANSWERS - n) + ' 道（一共答 ' + ANSWERS + ' 道）';
  if (n > ANSWERS) return '只答 ' + ANSWERS + ' 道就好（现在 ' + n + ' 道）';
  return null;
}
