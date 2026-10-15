import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { addLightGray, GRAY_ATTR } from '../../lib/tiles.js';
import { addHomeButton } from '../../lib/mapTools.js';
import { esc } from '../../lib/format.js';
import { reduceMotion } from '../../lib/motion.js';
import NavIcon from '../../components/NavIcon.jsx';
import { buildJourney } from './journey.js';
import { ALL } from './agenda.js';
import './journey.css';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
// 一段路走多久：飞行 2.6 秒，开车 1.8 秒（按步播放，整趟十几秒）
const LEG_MS = { flight: 2600, drive: 1800 };
const PLANE = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" stroke="#fff" stroke-width="1.2" stroke-linejoin="round" d="M12 1.5c.9 0 1.6 1 1.6 2.3v5.7l7.9 4.6v2.2l-7.9-2.3v4.6l2.3 1.7v1.8L12 21l-3.9 1.1v-1.8l2.3-1.7v-4.6l-7.9 2.3v-2.2l7.9-4.6V3.8c0-1.3.7-2.3 1.6-2.3z"/></svg>';
const CAR = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5v-4l1.8-5a2 2 0 0 1 1.9-1.3h7.6a2 2 0 0 1 1.9 1.3l1.8 5v4M4.5 12.5h15M3.5 16.5h17"/></svg>';

// 某个点在折线上走到 t（0..1）时的位置和走过的部分
function along(pts, t) {
  const k = t * (pts.length - 1), i = Math.min(Math.floor(k), pts.length - 2), f = k - i;
  const a = pts[i], b = pts[i + 1];
  const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  return { p, done: pts.slice(0, i + 1).concat([p]) };
}

// 🗺️ 旅程地图：按日程把这个人（或所有人）走过的路画出来，▶ 播放时镜头从全国跟到科罗拉多，
// 飞机、汽车一段段走过去；下面的站点条点一下就跳到那一段
export default function JourneyMap({ people, who, listings, votes, visible }) {
  const box = useRef(null), map = useRef(null), layer = useRef(null), run = useRef(0);
  const [step, setStep] = useState(-1); // 正在 / 刚刚播到第几步（-1 = 全景）
  const [playing, setPlaying] = useState(false);
  const journey = useMemo(() => buildJourney(people, who, listings, votes), [people, who, listings, votes]);
  const sig = who + '|' + journey.steps.map(s => s.title + s.when + s.legs.length).join('|');
  const scene = useRef(null); // 当前画好的线、车、站点
  const home = useRef(null); // ⌂ 按钮用最新一次渲染的取景（建图时的闭包会过时）

  useEffect(() => {
    if (!visible || map.current) return;
    const m = L.map(box.current, { scrollWheelZoom: false, zoomSnap: 0.25, worldCopyJump: true });
    addLightGray(m, { maxZoom: 13, attribution: GRAY_ATTR });
    m.setView([39.5, -100], 4);
    m.on('click', () => m.scrollWheelZoom.enable());
    m.on('mouseout', () => m.scrollWheelZoom.disable());
    addHomeButton(m, () => home.current());
    layer.current = L.layerGroup().addTo(m);
    // 拉远看全国时站点只留编号（名字会叠成一团），放大到州的尺度再显示名字
    const compact = () => m.getContainer().classList.toggle('jm-compact', m.getZoom() < 7);
    m.on('zoomend', compact); compact();
    map.current = m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  useEffect(() => () => { run.current++; map.current?.remove(); map.current = null; }, []);

  const boundsOf = steps => L.latLngBounds(steps.flatMap(s => (s.legs.length ? s.legs.flatMap(l => l.pts) : s.to ? [[s.to.lat, s.to.lng]] : [])));
  function overview(animate) {
    const m = map.current, b = boundsOf(journey.steps);
    if (m && b.isValid()) m.flyToBounds(b, { padding: [40, 40], maxZoom: 9, duration: animate && !reduceMotion ? 1 : 0.01 });
  }

  // 画底图：整条路线淡淡地铺着，站点钉上去，每段路一条「走过的」亮线（先空着）和一辆车/一架飞机
  useEffect(() => {
    const m = map.current;
    if (!m || !visible) return;
    run.current++; setPlaying(false); setStep(-1);
    layer.current.clearLayers();
    const legs = [];
    journey.steps.forEach((s, si) => s.legs.forEach(l => {
      const flight = l.kind === 'flight';
      L.polyline(l.pts, { color: l.color, weight: flight ? 1.5 : 3, opacity: flight ? 0.28 : 0.22, dashArray: flight ? '4 6' : null, interactive: false }).addTo(layer.current);
      const lit = L.polyline([], { color: l.color, weight: flight ? 2.5 : 4, opacity: 0.95, lineCap: 'round', interactive: false }).addTo(layer.current);
      const icon = L.divIcon({ className: 'pin-wrap', iconSize: [0, 0], html: flight ? '<div class="jm-plane" style="color:' + l.color + '">' + PLANE + '</div>' : '<div class="jm-car">' + CAR + '</div>' });
      const car = L.marker(l.pts[0], { icon, interactive: false, keyboard: false, opacity: 0 }).addTo(layer.current);
      legs.push({ ...l, step: si, lit, car });
    }));
    const main = new Set(journey.steps.filter(s => s.to).map(s => s.to.id));
    let n = 0;
    for (const s of journey.stops) {
      const big = main.has(s.id) || s.kind === 'stay';
      const html = big
        ? '<div class="jm-stop ' + s.kind + '"><b>' + (++n) + '</b><span>' + esc(s.kind === 'stay' ? s.name : s.label) + '</span></div>'
        : '<div class="jm-dot" title="' + esc(s.label) + '"></div>';
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'pin-wrap', iconSize: [0, 0], html }), keyboard: false, zIndexOffset: big ? 500 : 0 })
        .bindTooltip(esc(s.kind === 'stay' ? s.name + (s.area ? ' · ' + s.area : '') : s.label + ' · ' + s.name), { direction: 'top', offset: [0, -14] })
        .addTo(layer.current);
    }
    scene.current = { legs };
    m.invalidateSize();
    overview(false);
    // 第一次看到、或者换了人：自动播一遍（系统要求减少动态效果时不播）
    if (!reduceMotion && journey.steps.some(s => s.legs.length)) play(0);
    else showUpTo(journey.steps.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, visible]);

  // 把第 i 步之前（含）的路都点亮，车停在终点
  function showUpTo(i) {
    for (const l of scene.current?.legs || []) {
      if (l.step <= i) { l.lit.setLatLngs(l.pts); place(l, 1); l.car.setOpacity(l.step === i || i === journey.steps.length - 1 ? 1 : 0); }
      else { l.lit.setLatLngs([]); l.car.setOpacity(0); }
    }
  }
  function place(l, t) {
    const m = map.current, { p } = along(l.pts, t);
    l.car.setLatLng(p);
    if (l.kind !== 'flight') return;
    const a = m.latLngToContainerPoint(along(l.pts, Math.max(0, t - 0.02)).p), b = m.latLngToContainerPoint(along(l.pts, Math.min(1, t + 0.02)).p);
    const el = l.car.getElement()?.firstChild;
    if (el) el.style.transform = 'translate(-50%,-50%) rotate(' + (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90) + 'deg)';
  }
  function stop() { run.current++; setPlaying(false); }
  home.current = () => { stop(); overview(true); };

  async function play(from = 0) {
    const m = map.current, id = ++run.current;
    if (!m || !scene.current) return;
    setPlaying(true);
    showUpTo(from - 1);
    for (let i = from; i < journey.steps.length; i++) {
      const s = journey.steps[i], legs = scene.current.legs.filter(l => l.step === i);
      setStep(i);
      const b = boundsOf([s]);
      m.invalidateSize(); // 量一下真实尺寸再取景（旋转屏幕、侧栏变化之后）
      if (b.isValid()) {
        m.flyToBounds(b, { padding: [50, 50], maxZoom: s.kind === 'flight' ? 6 : 10, duration: 1.1 });
        await new Promise(r => { m.once('moveend', r); setTimeout(r, 1600); });
      }
      if (id !== run.current) return;
      for (const l of scene.current.legs) if (l.step < i) l.car.setOpacity(0);
      legs.forEach(l => l.car.setOpacity(1));
      const dur = LEG_MS[s.kind] || 1500, t0 = performance.now();
      await new Promise(done => {
        const frame = now => {
          if (id !== run.current) return done();
          const t = ease(Math.min(1, (now - t0) / dur));
          for (const l of legs) { l.lit.setLatLngs(along(l.pts, t).done); place(l, t); }
          if (t < 1) requestAnimationFrame(frame); else done();
        };
        requestAnimationFrame(frame);
      });
      if (id !== run.current) return;
      await sleep(450);
      if (id !== run.current) return;
    }
    setPlaying(false);
    overview(true);
  }

  function jump(i) {
    stop(); setStep(i); showUpTo(i);
    const b = boundsOf([journey.steps[i]]);
    if (b.isValid()) map.current?.flyToBounds(b, { padding: [50, 50], maxZoom: journey.steps[i].kind === 'flight' ? 6 : 11, duration: reduceMotion ? 0.01 : 0.9 });
  }

  const empty = !journey.steps.length;
  return (
    <section className="glass-card rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3">
        <h2 className="font-bold text-lg tracking-tight">旅程地图</h2>
        <span className="text-sm text-slate-500">{who === ALL ? '所有人' : who} · 按日程走一遍</span>
        {!empty && (
          <button onClick={() => (playing ? stop() : play(step >= 0 && step < journey.steps.length - 1 ? step + 1 : 0))} className="jm-play ml-auto" aria-label={playing ? '暂停' : '播放旅程'}>
            {playing ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12-7.5z" /></svg>}
            {playing ? '暂停' : '播放旅程'}
          </button>
        )}
      </div>
      <div className="jm-map-wrap">
        <div ref={box} className="jm-map" />
        {empty && <div className="jm-empty">{who === ALL ? '还没有航班和定下的住处，填好之后这里会画出整趟旅程' : who + ' 还没填航班，住处也还没定，填好之后这里会画出 ta 的路线'}</div>}
      </div>
      {!empty && (
        <ol className="jm-steps">
          {journey.steps.map((s, i) => (
            <li key={i}>
              <button onClick={() => jump(i)} className={'jm-step' + (i === step ? ' active' : '') + (step >= 0 && i < step ? ' past' : '')}>
                <span className="jm-step-ico"><NavIcon name={s.kind === 'flight' ? 'flights' : s.kind === 'drive' ? 'cars' : 'stays'} size={16} /></span>
                <span className="min-w-0">
                  <span className="jm-step-title">{s.title}</span>
                  <span className="jm-step-when">{s.when}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
