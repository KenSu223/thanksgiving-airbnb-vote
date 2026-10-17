// Secret Angel's questions (worker/angel/routes.js + web/src/features/angel/questions.js):
// exactly five of the ten answered, "what can't I be given" among them; old gift-category
// wishes are refused; a draw puts everyone registered in one random circle (no swaps), shows each
// angel the answers of the person they give to, and leaving someone out takes them out of it.
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/angel.mjs
const B = process.env.TEST_BASE || 'http://localhost:8791';
const J = async (m, p, o) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: o === undefined ? undefined : JSON.stringify(o) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return j;
};
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
const tag = Date.now().toString(36).slice(-5);
const login = async n => (await J('POST', '/api/login', { name: n + tag, token: 'dev-angel-' + n + tag })).user;
const A = await login('AngA'), Bu = await login('AngB');
ck('test users created', !!(A?.token && Bu?.token));
const as = u => ({ name: u.name, token: u.token });
const FIVE = { nogo: '不喝酒', travel: '降噪耳机', rich: '环游世界', shop: '咖啡店', snack: '黑巧' };

let r = await J('POST', '/api/angel/prefs', { answers: FIVE });
ck('answering needs a login', r.ok === false, JSON.stringify(r));
r = await J('POST', '/api/angel/prefs', { ...as(A), picks: { snacks: 'love' }, note: 'old style' });
ck('old gift-category wishes are refused', r.ok === false, JSON.stringify(r));
r = await J('POST', '/api/angel/prefs', { ...as(A), answers: { travel: 'a', rich: 'b', shop: 'c', snack: 'd', room: 'e' } });
ck('"what can\'t I be given" is required', r.ok === false && /不能送/.test(r.error), r.error);
r = await J('POST', '/api/angel/prefs', { ...as(A), answers: { nogo: 'x', travel: 'a', rich: 'b', shop: '   ' } });
ck('fewer than five (blanks don\'t count) is refused', r.ok === false && /再答 2 道/.test(r.error), r.error);
r = await J('POST', '/api/angel/prefs', { ...as(A), answers: { ...FIVE, room: '懒人沙发' } });
ck('more than five is refused (exactly five, not all ten)', r.ok === false && /只答 5 道/.test(r.error), r.error);
r = await J('POST', '/api/angel/prefs', { ...as(A), answers: { ...FIVE, travel: 'x'.repeat(200), bogus: 'nope' } });
ck('five answers save; unknown questions dropped; answers capped at 60', r.ok === true && r.mine?.answers?.nogo === '不喝酒'
  && !('bogus' in r.mine.answers) && r.mine.answers.travel.length === 60, JSON.stringify(r.mine));
ck('they show as done', r.people.find(p => p.name === A.name)?.submitted === true);
r = await J('POST', '/api/angel/prefs', { ...as(Bu), answers: { nogo: '对坚果过敏', travel: '润唇膏', rich: '开花店', shop: '花店', world: '吉卜力' } });
ck('a second person answers', r.ok === true);

// ---- the draw: everyone registered (not left out) in one random circle, Secret Santa style ----
// C answers; D never does — D is in the draw all the same. Other suites add people too, so
// everything is checked from these four's side.
const C = await login('AngC'), D = await login('AngD');
await J('POST', '/api/angel/prefs', { ...as(C), answers: FIVE });
r = await J('POST', '/api/angel/draw', as(A));
ck('a draw goes through', r.ok === true && r.drawn === true, JSON.stringify(r).slice(0, 160));
ck('everyone registered is in the circle, answered or not', r.people.filter(p => !p.excluded).every(p => p.inDraw), JSON.stringify(r.people.filter(p => !p.inDraw)).slice(0, 160));
const look = u => J('GET', '/api/angel?name=' + encodeURIComponent(u.name) + '&token=' + u.token);
const four = [A, Bu, C, D], seen = {};
for (const u of four) seen[u.name] = await look(u);
const to = n => seen[n].master?.name;
ck('D, who never answered, is in it and gives to someone', seen[D.name].inDraw === true && !!to(D.name));
ck('nobody draws themselves', four.every(u => to(u.name) && to(u.name) !== u.name), JSON.stringify(four.map(u => [u.name, to(u.name)])));
ck('nobody swaps (a → b and b → a)', four.every(u => !four.some(v => to(u.name) === v.name && to(v.name) === u.name)), JSON.stringify(four.map(u => [u.name, to(u.name)])));
const m = seen[A.name].master;
if (m && m.name === Bu.name) {
  ck('…and the angel sees that person\'s answers, "can\'t be given" included', m.prefs?.answers?.nogo === '对坚果过敏' && m.prefs.answers.world === '吉卜力', JSON.stringify(m.prefs));
}
ck('no old category picks are sent to the page', !JSON.stringify(seen[A.name]).includes('"picks"'));

// ---- left out after the draw: out of the circle, whoever gave to them gives to their person ----
const giver = [A, Bu, D].find(u => to(u.name) === C.name), cTarget = to(C.name);
r = await J('POST', '/api/angel/exclude', { ...as(A), target: C.name, excluded: true });
const cNow = await look(C);
ck('left out after the draw: out of the circle', r.ok === true && r.drawn === true && cNow.inDraw === false && !cNow.master, JSON.stringify(cNow).slice(0, 160));
const now = {};
for (const u of [A, Bu, D]) now[u.name] = (await look(u)).master?.name;
ck('nobody gives to the left-out person any more', Object.values(now).every(n => n && n !== C.name), JSON.stringify(now));
if (giver) ck('whoever gave to them now gives to their person', now[giver.name] === cTarget, JSON.stringify({ giver: giver.name, now: now[giver.name], cTarget }));
ck('nobody else changes', [A, Bu, D].filter(u => u !== giver).every(u => now[u.name] === to(u.name)), JSON.stringify({ now, before: four.map(u => to(u.name)) }));
r = await J('POST', '/api/angel/exclude', { ...as(A), target: C.name, excluded: false });
const cBack = r.people?.find(p => p.name === C.name);
ck('brought back, they wait for the next reshuffle', r.ok === true && cBack?.excluded === false && cBack?.inDraw === false, JSON.stringify(cBack));

console.log(`ANGEL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
