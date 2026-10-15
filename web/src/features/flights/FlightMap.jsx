import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { addLightGray, GRAY_ATTR } from '../../lib/tiles.js';
import { addHomeButton } from '../../lib/mapTools.js';
import { esc } from '../../lib/format.js';
import { reduceMotion } from '../../lib/motion.js';
import { duration, localTime } from './plan.js';
import { arc } from '../../lib/geo.js';

const COLORS = ['#4f46e5', '#e11d48', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#2563eb'];

// 机头朝上的小飞机，转到航向
const PLANE = color => '<div class="fl-plane"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="' + color + '" stroke="#fff" stroke-width="1.2" stroke-linejoin="round" '
  + 'd="M12 1.5c.9 0 1.6 1 1.6 2.3v5.7l7.9 4.6v2.2l-7.9-2.3v4.6l2.3 1.7v1.8L12 21l-3.9 1.1v-1.8l2.3-1.7v-4.6l-7.9 2.3v-2.2l7.9-4.6V3.8c0-1.3.7-2.3 1.6-2.3z"/></svg></div>';

// 动起来：每条航线先顺着飞行方向画出来（到达从外地画进丹佛，离开从丹佛画出去），
// 然后线上的虚线一直往前流，小飞机沿着航线慢慢绕圈飞。系统开了「减少动态效果」就不动。
// instant=true 时不重播画线动画。phases 是跨重画保留的进度表（key -> 0..1）：
// 重画时每架飞机从它刚才的位置接着飞，不回起点，免得一刷新就满图瞬移。
function animate(m, group, drawn, instant, phases) {
  const timers = [], planes = [];
  const spawn = (d, i) => {
    const { flow, pts, color, minutes } = d;
    flow.addTo(group);
    const plane = L.marker(pts[0], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'pin-wrap', html: PLANE(color), iconSize: [0, 0] }) }).addTo(m);
    // 飞得慢一点、稳一点：时长按真实飞行时间拉长（2 小时约 13 秒一圈，13 小时封顶 30 秒），
    // 每架错开相位起飞，不会齐刷刷从起点排队出发
    const period = Math.min(30000, Math.max(9000, 6000 + minutes * 45));
    const saved = phases.get(d.key);
    const start = performance.now() - (saved != null ? saved : (i * 0.37 % 1)) * period;
    planes.push({ plane, pts, period, start, key: d.key });
  };
  drawn.forEach((d, i) => {
    if (instant) { spawn(d, i); return; }
    const el = d.line.getElement();
    if (!el) { spawn(d, i); return; }
    const len = el.getTotalLength();
    const delay = i * 250;
    el.style.strokeDasharray = len; el.style.strokeDashoffset = len;
    void el.getBoundingClientRect();
    el.style.transition = 'stroke-dashoffset 1.3s ease-in-out ' + delay + 'ms';
    el.style.strokeDashoffset = 0;
    timers.push(setTimeout(() => {
      el.style.transition = ''; el.style.strokeDasharray = ''; el.style.strokeDashoffset = '';
      spawn(d, i);
    }, delay + 1300));
  });
  // 航线某一点的经纬度（t 是 0..1 的进度）
  const at = (pts, t) => {
    const x = t * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(x)), f = x - k;
    const [a, b] = [pts[k], pts[k + 1]];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
  let raf = 0;
  const tick = now => {
    const zoom = m.getZoom(), origin = m.getPixelOrigin(), crs = m.options.crs;
    // 不取整的图层坐标：抖动的根源是 Leaflet 内部坐标全是整像素——
    // setLatLng 把位置取整（慢飞机一帧挪不到 1px，只能一格一格跳），
    // 朝向又是从取整后的两点算的（向量才几 px 长，角度每帧乱跳好几度，机头直晃）
    const exact = (pts, t) => crs.latLngToPoint(L.latLng(at(pts, t)), zoom).subtract(origin);
    for (const p of planes) {
      // rAF 给的时间可能比加飞机那一刻还早一点，别让进度变成负数
      const t = (Math.max(0, now - p.start) % p.period) / p.period;
      const ll = L.latLng(at(p.pts, t));
      p.plane.setLatLng(ll);
      const el = p.plane.getElement();
      if (!el) continue;
      const glyph = el.firstChild;
      if (glyph) {
        // 位置的小数尾巴补到图标上：标记本体站在整像素点，图标再滑那不到半像素，移动就连续了
        const ex = exact(p.pts, t), placed = m.latLngToLayerPoint(ll);
        const fx = ex.x - placed.x, fy = ex.y - placed.y;
        // 朝向用未取整坐标、看前后一小段的平均方向：转弯平滑，机头不抖
        const pa = exact(p.pts, Math.max(0, t - 0.015)), pb = exact(p.pts, Math.min(1, t + 0.015));
        const deg = Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180 / Math.PI + 90;
        glyph.style.transform = 'translate(calc(-50% + ' + fx.toFixed(2) + 'px), calc(-50% + ' + fy.toFixed(2) + 'px)) rotate(' + deg.toFixed(2) + 'deg)';
      }
      // 一圈的头尾各淡入淡出一下：飞到终点先淡出、回到起点再淡入，不会「啪」地瞬移回去
      const fade = Math.min(1, t / 0.07, (1 - t) / 0.07);
      el.style.opacity = String(Math.max(0, fade));
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    timers.forEach(clearTimeout);
    cancelAnimationFrame(raf);
    // 拆之前把每架飞机的进度记下来，下次重画接着飞
    const now = performance.now();
    for (const p of planes) {
      phases.set(p.key, (Math.max(0, now - p.start) % p.period) / p.period);
      p.plane.remove();
    }
  };
}

// 大家的航线：到达 / 离开分开看。同一条航线的人合成一条线，线越粗人越多
export default function FlightMap({ people, mode, visible }) {
  const box = useRef(null), map = useRef(null), layer = useRef(null);
  const shownMode = useRef(null); // 画线动画只在第一次看这个模式时播，之后的数据刷新直接到位
  const phases = useRef(new Map()); // 每条航线的飞机进度，跨重画保留
  const latest = useRef({ people, mode });
  latest.current = { people, mode };
  const homeBounds = useRef([]); // 最近一次取景的范围，「默认视角」按钮回到这里
  // 内容签名：上层每次渲染都给新数组（travelers 是现 filter 的），只认对象身份的话
  // 任何一次重渲染都会把地图推倒重来——线重画、飞机回起点、视图重新 fit。
  // 改成只看内容：航班没变，地图一个像素都不许动。
  const sig = mode + '|' + people.map(p => {
    const f = mode === 'arrival' ? p.arrival : p.departure;
    return f ? [p.name, f.flight, f.from.iata, f.to.iata, f.depUtc, f.arrUtc].join(':') : p.name + ':-';
  }).join('|');

  // 第一次看得见的时候才建地图（和房源/餐厅/活动地图同一套规矩）：
  // 所有页面都是挂着藏起来的，藏着建图 Leaflet 量到的尺寸是 0，之后
  // 瓦片按错尺寸铺、取景也算错 — 进航班页有时候整张图灰着错位就是它。
  useEffect(() => {
    if (!visible || map.current) return;
    // 视图中心锁死：不许拖动平移（dragging 关掉后手机上滑过地图也不会被地图抢走滚动），
    // 方向键平移也关掉；缩放保留（滚轮/双指都是绕中心缩，中心不会跑）
    const m = L.map(box.current, { scrollWheelZoom: false, worldCopyJump: true, zoomSnap: 0.25, dragging: false, keyboard: false });
    addLightGray(m, { maxZoom: 12, attribution: GRAY_ATTR + ' · 机场数据 <a href="https://openflights.org/data">OpenFlights</a>' });
    m.setView([39.86, -104.67], 4);
    m.on('click', () => m.scrollWheelZoom.enable());
    m.on('mouseout', () => m.scrollWheelZoom.disable());
    // 地图保持锁死（不加手势协作），但给一个回默认视角：缩放漂了能一键回到航线全景
    addHomeButton(m, () => { if (homeBounds.current.length) m.fitBounds(homeBounds.current, { padding: [30, 30], maxZoom: 6 }); });
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  useEffect(() => () => { map.current?.remove(); map.current = null; }, []);

  useEffect(() => {
    const m = map.current;
    // 藏着的时候不画：尺寸是错的，画了也白画。等页面亮出来，这一轮会
    // 以真实尺寸重跑（visible 在依赖里），取景和瓦片一次到位。
    if (!m || !visible) return;
    const { people, mode } = latest.current;
    layer.current.clearLayers();
    const legs = people.map(p => ({ name: p.name, f: mode === 'arrival' ? p.arrival : p.departure })).filter(x => x.f);
    const routes = new Map();
    for (const x of legs) {
      const k = x.f.from.iata + '-' + x.f.to.iata;
      if (!routes.has(k)) routes.set(k, { from: x.f.from, to: x.f.to, legs: [] });
      routes.get(k).legs.push(x);
    }
    const bounds = [];
    const airports = new Map();
    const drawn = [];
    [...routes.values()].forEach((rt, i) => {
      // 让「我们这头」（到达看落地机场，离开看起飞机场）落在 -180°~180° 的主地图上，
      // 所有航线在丹佛这边汇合，跨太平洋的从左边飞进来，而不是画到右边另一个世界副本里
      let pts = arc(rt.from, rt.to);
      const homeLng = mode === 'arrival' ? pts[pts.length - 1][1] : pts[0][1];
      const shift = Math.round(homeLng / 360) * 360;
      if (shift) pts = pts.map(([la, lo]) => [la, lo - shift]);
      bounds.push(...pts);
      const tip = '<b>' + rt.from.iata + ' → ' + rt.to.iata + '</b><br>' + rt.legs.map(x => esc(x.name) + ' · ' + esc(x.f.flight) + ' · '
        + localTime(x.f.depUtc, rt.from.tz) + ' → ' + localTime(x.f.arrUtc, rt.to.tz, false) + '（' + duration(x.f.minutes) + '）').join('<br>');
      const color = COLORS[i % COLORS.length], weight = 2 + Math.min(4, rt.legs.length);
      const line = L.polyline(pts, { color, weight, opacity: 0.85 }).bindTooltip(tip, { sticky: true }).addTo(layer.current);
      // 往前流的白色虚线（线画完之后才加进图层组，切换时跟着一起清掉），方向就是飞行方向
      const flow = L.polyline(pts, { color: '#fff', weight: Math.max(1.5, weight - 2), opacity: 0.9, className: 'fl-flow', interactive: false });
      drawn.push({ line, flow, pts, color, key: mode + ':' + rt.from.iata + '-' + rt.to.iata, minutes: Math.max(...rt.legs.map(x => x.f.minutes)) });
      // 端点：一个机场只画一个点，记下在这儿上下飞机的人
      for (const [ap, end] of [[rt.from, pts[0]], [rt.to, pts[pts.length - 1]]]) {
        const a = airports.get(ap.iata) || { ap, at: end, names: new Set() };
        rt.legs.forEach(x => a.names.add(x.name));
        airports.set(ap.iata, a);
      }
    });
    // 人最多的那个机场（一般是 DEN）是汇合点：换个颜色，画在最上面
    const hub = [...airports.values()].sort((a, b) => b.names.size - a.names.size)[0];
    for (const a of airports.values()) {
      const { ap, at, names } = a;
      L.marker(at, { zIndexOffset: a === hub ? 1000 : 0, icon: L.divIcon({ className: 'pin-wrap', html: '<div class="ap-pin' + (a === hub ? ' hub' : '') + '">' + ap.iata + '</div>', iconSize: [0, 0] }) })
        .bindTooltip('<b>' + esc(ap.iata) + '</b> ' + esc(ap.city) + '<br>' + [...names].map(esc).join('、'), { direction: 'top' }).addTo(layer.current);
    }
    m.invalidateSize();
    homeBounds.current = bounds;
    if (bounds.length) m.fitBounds(bounds, { padding: [30, 30], maxZoom: 6, animate: false });
    if (reduceMotion) { drawn.forEach(d => d.flow.addTo(layer.current)); return; }
    const instant = shownMode.current === mode;
    shownMode.current = mode;
    return animate(m, layer.current, drawn, instant, phases.current);
    // 内容签名之外还认 visible：签名不变时数组身份变化不会重跑（地图不
    // 重 fit、飞机不重启）；但页面从藏到亮必须重跑一轮，把建图时错过的
    // 正确尺寸补回来。重画时飞机接着原来的进度飞（phases 还在）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, visible]);

  return <div ref={box} className="flight-map"></div>;
}
