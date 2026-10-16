// The chat room (worker/chat/room.js) over real sockets: you have to say who
// you are (name + token) before reading or sending, messages reach everyone
// signed in, @name mentions are found by the server (case-insensitive, the
// longest name wins, never yourself), @all / @所有人 calls everyone (but a
// member whose name starts with "All" is still just them), empty and over-long messages are
// handled, and only the latest 100 are kept. Uses the global WebSocket
// client (Node 22+).
// Standalone use: TEST_BASE=http://localhost:8791 node tests/robustness/chat.mjs
if (typeof WebSocket === 'undefined') {
  console.log('FAIL this suite needs the global WebSocket client (Node 22+)');
  console.log('CHAT: 0 passed, 1 failed');
  process.exit(1);
}
const B = process.env.TEST_BASE || 'http://localhost:8791';
const WS = B.replace(/^http/, 'ws');
const J = async (m, p, o) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: o === undefined ? undefined : JSON.stringify(o) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* ignore */ }
  return j;
};
let pass = 0, fail = 0;
const ck = (name, cond, extra) => { if (cond) { pass++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra ?? ''); } };
const crash = e => { console.log('FAIL suite crashed:', e?.message || e); console.log(`CHAT: ${pass} passed, ${fail + 1} failed`); process.exit(1); };
process.on('uncaughtException', crash);
process.on('unhandledRejection', crash);
const tag = Date.now().toString(36).slice(-6);
const mkUser = async n => (await J('POST', '/api/login', { name: n + tag, token: 'dev-chat-' + n + tag })).user;

// A socket that keeps everything it's sent; hello = sign in.
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS + '/api/chat');
    const got = [];
    ws.onmessage = e => { try { got.push(JSON.parse(e.data)); } catch { /* ignore */ } };
    ws.onopen = () => resolve({
      got,
      hello: u => ws.send(JSON.stringify({ type: 'hello', name: u.name, token: u.token })),
      say: text => ws.send(JSON.stringify({ type: 'send', text })),
      async waitFor(pred, what, ms = 5000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const hit = got.find(pred);
          if (hit) return hit;
          await new Promise(s => setTimeout(s, 50));
        }
        throw new Error('timeout waiting for ' + what);
      },
      close: () => { try { ws.close(); } catch { /* ignore */ } },
    });
    ws.onerror = () => reject(new Error('chat socket error'));
  });
}
const sleep = ms => new Promise(s => setTimeout(s, ms));
const msgWith = (c, text) => c.waitFor(m => m.type === 'msg' && m.msg.text === text, 'msg ' + text.slice(0, 30));

const A = await mkUser('ChatA'), Bu = await mkUser('ChatB');
const Short = await mkUser('Mx');
// two names where one starts with the other: "@Ny<tag>Z" mustn't also tag "@Ny<tag>"
const Short2 = (await J('POST', '/api/login', { name: 'Ny' + tag, token: 'dev-chat-ny' + tag })).user;
const Long2 = (await J('POST', '/api/login', { name: 'Ny' + tag + 'Z', token: 'dev-chat-nyz' + tag })).user;
const AllU = await mkUser('All'); // "All<tag>": "@All<tag>" is them, not everyone
ck('test users created', !!(A?.token && Bu?.token && Short?.token && Short2?.token && Long2?.token && AllU?.token));
const key = u => u.name.toLowerCase();

// ---- not a socket ----
const plain = await fetch(B + '/api/chat');
ck('a plain GET gets 426 (it is a WebSocket endpoint)', plain.status === 426, plain.status);
await plain.text();

// ---- signing in ----
const anon = await connect();
anon.say('hi from nobody');
const e1 = await anon.waitFor(m => m.type === 'error', 'error for anon send');
ck('sending without hello is refused', e1.error === '先登录再聊天', JSON.stringify(e1));
anon.hello({ name: A.name, token: 'not-the-token' });
const e2 = await anon.waitFor(m => m.type === 'error' && m !== e1, 'error for bad token');
ck('a wrong token is refused', e2.error === '先登录再聊天', JSON.stringify(e2));
ck('and gets no history', !anon.got.some(m => m.type === 'history'));

const a = await connect(), b = await connect();
a.hello(A); b.hello(Bu);
const ha = await a.waitFor(m => m.type === 'history', 'A history');
await b.waitFor(m => m.type === 'history', 'B history');
ck('hello gets the history and who you are', Array.isArray(ha.msgs) && ha.you === key(A), JSON.stringify(ha).slice(0, 120));

// ---- a message and a mention ----
const t1 = `hey @${Bu.name} dinner at 7? ${tag}`;
a.say(t1);
const ma = await msgWith(a, t1), mb = await msgWith(b, t1);
ck('the sender sees their message', ma.msg.by === A.name && ma.msg.byKey === key(A) && typeof ma.msg.at === 'number' && !!ma.msg.id);
ck('others signed in see it too', mb.msg.id === ma.msg.id);
ck('@name is found by the server', JSON.stringify(mb.msg.mentions) === JSON.stringify([key(Bu)]), JSON.stringify(mb.msg.mentions));
await sleep(300);
ck('a socket that never signed in hears nothing', !anon.got.some(m => m.type === 'msg'));

const t2 = `@${Bu.name.toLowerCase()} lower case works ${tag}`;
b.say(t2);
ck('mentions ignore case, and you can’t tag yourself', JSON.stringify((await msgWith(a, t2)).msg.mentions) === '[]', 'B tagged themself');
const t3 = `@${A.name.toLowerCase()} lower case works ${tag}`;
b.say(t3);
ck('a lower-case @name still tags them', JSON.stringify((await msgWith(a, t3)).msg.mentions) === JSON.stringify([key(A)]));

const t4 = `@${Long2.name} only the long one ${tag}`;
a.say(t4);
ck('the longest name wins (@Ny…Z isn’t also @Ny…)', JSON.stringify((await msgWith(a, t4)).msg.mentions) === JSON.stringify([key(Long2)]), JSON.stringify((await msgWith(a, t4)).msg.mentions));
const t5 = `@${Long2.name} and @${Short2.name} ${tag}`;
a.say(t5);
const m5 = (await msgWith(a, t5)).msg.mentions;
ck('both when both are written', m5.length === 2 && m5.includes(key(Long2)) && m5.includes(key(Short2)), JSON.stringify(m5));
const t6 = `@NobodyCalledThis${tag} and @${Bu.name} and @${Short.name} ${tag}`;
a.say(t6);
const m6 = (await msgWith(a, t6)).msg.mentions;
ck('several people at once; an unknown @ is just text', m6.length === 2 && m6.includes(key(Bu)) && m6.includes(key(Short)), JSON.stringify(m6));

// ---- @all ----
const t7 = `@all dinner's ready ${tag}`;
a.say(t7);
const m7 = (await msgWith(b, t7)).msg;
ck('@all calls everyone but the sender', m7.all === true && [Bu, Short, Short2, Long2, AllU].every(u => m7.mentions.includes(key(u))) && !m7.mentions.includes(key(A)), JSON.stringify(m7).slice(0, 160));
const t8 = `@所有人 出发了 ${tag}`;
b.say(t8);
const m8 = (await msgWith(a, t8)).msg;
ck('@所有人 does too', m8.all === true && m8.mentions.includes(key(A)) && !m8.mentions.includes(key(Bu)), JSON.stringify(m8).slice(0, 160));
const t9 = `@${AllU.name} only you ${tag}`;
a.say(t9);
const m9 = (await msgWith(a, t9)).msg;
ck('a member called All… is just them', !m9.all && JSON.stringify(m9.mentions) === JSON.stringify([key(AllU)]), JSON.stringify(m9));
const t10 = `@alligator ${tag}`;
a.say(t10);
const m10 = (await msgWith(a, t10)).msg;
ck('@alligator isn’t @all', !m10.all && m10.mentions.length === 0, JSON.stringify(m10));

// ---- bad input ----
const errsBefore = a.got.filter(m => m.type === 'error').length;
a.say('   \n  ');
await a.waitFor(() => a.got.filter(m => m.type === 'error').length > errsBefore, 'empty error');
ck('an empty message is refused', a.got.filter(m => m.type === 'error').pop().error === '写点什么再发');
const long = tag + 'x'.repeat(700);
a.say(long);
const ml = await a.waitFor(m => m.type === 'msg' && m.msg.text.startsWith(tag + 'xxx'), 'long msg');
ck('an over-long message is cut to 500 characters', ml.msg.text.length === 500, ml.msg.text.length);
const ws2 = new WebSocket(WS + '/api/chat');
await new Promise(r => { ws2.onopen = r; });
ws2.send('not json at all');
ws2.send(JSON.stringify({ type: 'hello', name: A.name, token: A.token }));
const ok2 = await new Promise(r => { ws2.onmessage = e => r(JSON.parse(e.data)); setTimeout(() => r(null), 4000); });
ck('junk on the socket is ignored, it still works after', ok2?.type === 'history', JSON.stringify(ok2).slice(0, 80));
ws2.close();

// ---- keep the latest 100 ----
for (let i = 1; i <= 105; i++) a.say(`n${i} ${tag}`);
await msgWith(a, `n105 ${tag}`);
const c = await connect();
c.hello(Short);
const hc = await c.waitFor(m => m.type === 'history', 'history after 105');
const texts = hc.msgs.map(m => m.text);
ck('only the latest 100 are kept', hc.msgs.length === 100, hc.msgs.length);
ck('newest last, oldest dropped', texts[99] === `n105 ${tag}` && texts[0] === `n6 ${tag}` && !texts.includes(`n5 ${tag}`), texts[0] + ' … ' + texts[99]);

for (const s of [anon, a, b, c]) s.close();
console.log(`CHAT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
