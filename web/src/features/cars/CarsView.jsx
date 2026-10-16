import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useSession } from '../../session/SessionContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import CarCard from './CarCard.jsx';
import BagIcon from './BagIcon.jsx';
import { BAGS, carName, seatName } from './bags.js';
import './cars.css';

const POLL_MS = 5000; // 先到先得：开着这页时常常刷新，别人刚坐下的位子马上能看到

// 🚙 用车：三辆 X5 选座（先到先得，一人一个座，换座就是从原来的座位挪过去）+ 每人带几件什么行李
export default function CarsView({ active }) {
  const { name, token, ensureName } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const actingFor = name; // 每个人只管自己的座位和行李

  const load = useCallback(async () => {
    try { const r = await api('/api/cars'); if (r.ok) setData(r); } catch (e) {}
  }, []);
  useEffect(() => {
    if (!active) return;
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [active, load]);

  async function post(path, payload, me) {
    setBusy(true);
    try {
      const r = await api(path, 'POST', { name: me.name, token: me.token, ...payload });
      if (r.cars) setData(r);
      if (!r.ok) toast(r.error || '没成功，再试一次');
      return r.ok;
    } finally { setBusy(false); }
  }

  function onSeat(car, seat, who) {
    ensureName(async me => {
      const forWho = me.name;
      const where = carName(car, data.cars.indexOf(car)) + ' 的' + seatName(seat);
      if (who && who === forWho) {
        if (!await confirm({ title: '让出这个座位？', message: '你会离开' + where + '，别人就可以坐了。', confirmText: '让出' })) return;
        post('/api/cars/seat', { seat: null }, me);
      } else if (who) {
        toast(who + ' 已经坐在' + where + '了');
      } else {
        const ok = await post('/api/cars/seat', { car: car.id, seat }, me);
        if (ok) toast('坐好了：' + where + (seat === 'driver' ? ' · 记得带驾照 🪪' : ''));
      }
    });
  }

  // 谁都可以给车起名（租车公司、颜色、车牌…），空着就用默认的
  function onLabel(car, label) {
    if (label !== (car.label || '')) post('/api/cars/label', { car: car.id, label }, { name, token });
  }

  // 行李：本地先改，停手 600ms 后一起存（连点 + 不会发一串请求）。draftRef 存最新的草稿，
  // 同一帧里连点两下时第二下也是在第一下的基础上加
  const mineBags = (data && data.bags[actingFor]) || {};
  const [draft, setDraft] = useState(null);
  const draftRef = useRef(null);
  const saveTimer = useRef(null);
  useEffect(() => { draftRef.current = null; setDraft(null); }, [actingFor]);
  const bags = draft || mineBags;
  function bump(id, d) {
    ensureName(me => {
      const forWho = me.name;
      const cur = draftRef.current || (data && data.bags[forWho]) || {};
      const next = { ...cur, [id]: Math.max(0, Math.min(6, (cur[id] || 0) + d)) };
      draftRef.current = next;
      setDraft(next);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await post('/api/cars/bags', { bags: next }, me);
        if (draftRef.current === next) { draftRef.current = null; setDraft(null); }
      }, 600);
    });
  }
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  if (!data) return <div className="glass-card rounded-2xl p-6 text-slate-400">加载中…</div>;

  // 大家的数据里用的是行李的最新草稿（自己刚点的马上反映到车上的后备箱）
  const allBags = draft && actingFor ? { ...data.bags, [actingFor]: draft } : data.bags;
  const seated = new Set(data.cars.flatMap(c => Object.values(c.seats).filter(Boolean)));
  const mySeat = actingFor && data.cars.flatMap((c, i) => Object.entries(c.seats).filter(([, w]) => w === actingFor).map(([s]) => carName(c, i) + ' · ' + seatName(s)))[0];
  const free = 15 - seated.size;
  const waiting = data.people.filter(p => !seated.has(p));
  const pieces = Object.values(bags).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      <section className="glass-card rounded-2xl p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="text-sm">
          {actingFor
            ? mySeat ? <><span className="text-slate-500">{actingFor === name ? '你的座位' : actingFor + ' 的座位'}</span> <b className="ml-1">{mySeat}</b></>
              : <span className="text-slate-600">{actingFor === name ? '你还没选座' : actingFor + ' 还没选座'} · 点下面任意一个空位就坐下了</span>
            : <span className="text-slate-600">登录后点空位就能坐下，先到先得</span>}
        </div>
        <span className="text-sm text-slate-400">还剩 <b className="text-slate-700 tabular-nums">{free}</b> 个空位</span>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {data.cars.map((c, i) => (
          <CarCard key={c.id} car={c} index={i} me={name} actingFor={actingFor} bags={allBags} busy={busy} onSeat={onSeat} onLabel={onLabel} />
        ))}
      </section>

      <section className="glass-card rounded-2xl p-5">
        <div className="flex flex-wrap items-baseline gap-2 mb-4">
          <h2 className="font-bold text-lg tracking-tight">{actingFor && actingFor !== name ? actingFor + ' 的行李' : '我的行李'}</h2>
          <span className="text-sm text-slate-500">{pieces ? '一共 ' + pieces + ' 件 · 算进' + (mySeat ? '所坐那辆车' : '坐的那辆车') + '的后备箱' : '点 + 加上你要带的'}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {BAGS.map(b => {
            const n = bags[b.id] || 0;
            return (
              <div key={b.id} className={'bag-tile' + (n ? ' on' : '')}>
                <div className="bag-ico"><BagIcon id={b.id} size={30} /></div>
                <div className="font-semibold text-sm">{b.name}</div>
                <div className="text-xs text-slate-400 mb-2">{b.hint}</div>
                <div className="stepper">
                  <button onClick={() => bump(b.id, -1)} disabled={!n} aria-label={'少一个' + b.name}>−</button>
                  <span className="tabular-nums">{n}</span>
                  <button onClick={() => bump(b.id, 1)} disabled={n >= 6} aria-label={'多一个' + b.name}>+</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {waiting.length > 0 && (
        <section className="text-sm text-slate-500 px-1">
          还没选座：{waiting.map(p => <span key={p} className="chip">{p}</span>)}
        </section>
      )}
    </div>
  );
}
