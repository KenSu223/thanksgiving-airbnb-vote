import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useSession } from '../../session/SessionContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import CarCard from './CarCard.jsx';
import BagIcon from './BagIcon.jsx';
import ModelPicker from './ModelPicker.jsx';
import { BAGS, carName, seatName } from './bags.js';
import { layoutOf, modelTitle, seatCount, seatIds } from './models.js';
import './cars.css';

const POLL_MS = 5000; // 先到先得：开着这页时常常刷新，别人刚坐下的位子马上能看到
const MAX_CARS = 8;
const when = at => new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// 🚙 用车：大家的车（每辆是一个车型：几排几个座、后备箱多大），选座（先到先得，一人一个座，
// 换座就是从原来的座位挪过去）+ 每人带几件什么行李。谁都能换车型、加车、去掉车：先确认一下，
// 改动记在最下面，写着是谁改的。
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
      const where = carName(car, data.cars.indexOf(car)) + ' 的' + seatName(seat, car);
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

  // 换车型 / 加一辆车：先挑车型（picker），再确认。picker: { carId } 是换这辆，{} 是加一辆。
  // 存 id 不存车：页面每 5 秒刷新一次，挑车型的时候车（座位）可能已经变了
  const [picker, setPicker] = useState(null);
  const onModel = car => ensureName(() => setPicker({ carId: car.id }));
  const onAdd = () => ensureName(() => setPicker({}));
  const pickerIndex = picker?.carId ? data?.cars.findIndex(c => c.id === picker.carId) : -1;
  async function onPick(choice) {
    const i = pickerIndex, car = i >= 0 ? data.cars[i] : null, title = modelTitle(choice), me = { name, token };
    setPicker(null);
    if (picker.carId && !car) return toast('这辆车刚被别人去掉了');
    if (car) {
      const ids = seatIds(layoutOf(choice));
      const bumped = Object.entries(car.seats).filter(([s, w]) => w && !ids.includes(s)).map(([s, w]) => w + '（' + seatName(s, car) + '）');
      const ok = await confirm({
        title: '把 ' + carName(car, i) + ' 换成 ' + title + '？',
        message: '大家看到的这辆车都会变，改动会记在页面最下面。'
          + (bumped.length ? bumped.join('、') + ' 坐的位子新车型没有，会挪到这辆车的空位，没空位就要重新选座。' : ''),
        confirmText: '换',
      });
      if (!ok) return;
      const r = await api('/api/cars/model', 'POST', { ...me, car: car.id, ...choice }).catch(() => ({ ok: false }));
      if (r.cars) setData(r);
      if (!r.ok) return toast(r.error || '没换成，再试一次');
      toast('换好了：' + title + (r.moved?.length ? ' · 挪了座：' + r.moved.join('、') : '') + (r.unseated?.length ? ' · ' + r.unseated.join('、') + ' 要重新选座' : ''));
    } else {
      if (!await confirm({ title: '加一辆 ' + title + '？', message: '大家都会看到多出来的这辆车，改动会记在页面最下面。', confirmText: '加上' })) return;
      if (await post('/api/cars/add', choice, me)) toast('加好了：' + title);
    }
  }
  async function onRemove(car) {
    const i = data.cars.indexOf(car);
    const seated = Object.values(car.seats).filter(Boolean);
    const ok = await confirm({
      title: '去掉 ' + carName(car, i) + '？',
      message: (seated.length ? seated.join('、') + ' 坐在这辆车上，去掉后要重新选座。' : '这辆车上还没人。') + '改动会记在页面最下面。',
      confirmText: '去掉', danger: true,
    });
    if (ok && await post('/api/cars/remove', { car: car.id }, { name, token })) toast('去掉了 ' + carName(car, i));
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
  const mySeat = actingFor && data.cars.flatMap((c, i) => Object.entries(c.seats).filter(([, w]) => w === actingFor).map(([s]) => carName(c, i) + ' · ' + seatName(s, c)))[0];
  const free = data.cars.reduce((n, c) => n + seatCount(c.rows), 0) - seated.size;
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
          <CarCard key={c.id} car={c} index={i} me={name} actingFor={actingFor} bags={allBags} busy={busy} canRemove={data.cars.length > 1}
            onSeat={onSeat} onLabel={onLabel} onModel={onModel} onRemove={onRemove} />
        ))}
        {data.cars.length < MAX_CARS && (
          <button onClick={onAdd} className="car-add rounded-3xl">
            <span className="text-3xl leading-none">＋</span>
            <span className="font-bold">加一辆车</span>
            <span className="text-xs text-slate-400">挑车型：轿车、SUV、7/8 座、商务车、12–15 座面包车</span>
          </button>
        )}
      </section>
      {picker && <ModelPicker title={pickerIndex >= 0 ? '给 ' + carName(data.cars[pickerIndex], pickerIndex) + ' 换车型' : '加一辆车'}
        current={pickerIndex >= 0 ? data.cars[pickerIndex] : null} onPick={onPick} onClose={() => setPicker(null)} />}

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

      {data.log?.length > 0 && (
        <section className="px-1 text-xs text-slate-400">
          <div className="mb-1 font-semibold text-slate-500">最近的改动</div>
          <ul className="space-y-0.5">
            {data.log.slice(0, 5).map(l => <li key={l.at + l.what}><b className="font-semibold text-slate-500">{l.by}</b> {l.what} · {when(l.at)}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
