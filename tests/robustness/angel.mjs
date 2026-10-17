// Secret Angel's questions (worker/angel/routes.js + web/src/features/angel/questions.js):
// five of the ten answered, "what can't I be given" among them; old gift-category
// wishes are refused; a draw shows each angel the answers of the person they give to.
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
r = await J('POST', '/api/angel/prefs', { ...as(A), answers: { ...FIVE, bogus: 'nope', room: 'x'.repeat(200) } });
ck('five answers save; unknown questions dropped; answers capped at 60', r.ok === true && r.mine?.answers?.nogo === '不喝酒'
  && !('bogus' in r.mine.answers) && r.mine.answers.room.length === 60, JSON.stringify(r.mine));
ck('they show as done', r.people.find(p => p.name === A.name)?.submitted === true && r.people.find(p => p.name === A.name)?.inPool === true);
r = await J('POST', '/api/angel/prefs', { ...as(Bu), answers: { ...FIVE, nogo: '对坚果过敏', world: '吉卜力' } });
ck('a second person answers', r.ok === true);

// Only these two are in this suite's draw if nobody else answered; other suites may add people,
// so check from A's side: A gives to someone, and sees that person's answers (or their note).
r = await J('POST', '/api/angel/draw', as(A));
ck('a draw goes through', r.ok === true && r.drawn === true, JSON.stringify(r).slice(0, 160));
const seenA = await J('GET', '/api/angel?name=' + encodeURIComponent(A.name) + '&token=' + A.token);
const m = seenA.master;
ck('the angel sees who they give to', !!m?.name, JSON.stringify(seenA).slice(0, 160));
if (m && m.name === Bu.name) {
  ck('…and that person\'s answers, "can\'t be given" included', m.prefs?.answers?.nogo === '对坚果过敏' && m.prefs.answers.world === '吉卜力', JSON.stringify(m.prefs));
}
ck('no old category picks are sent to the page', !JSON.stringify(seenA).includes('"picks"'));
const seenB = await J('GET', '/api/angel?name=' + encodeURIComponent(Bu.name) + '&token=' + Bu.token);
ck('nobody sees their own angel', seenB.master?.name !== Bu.name);

console.log(`ANGEL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
