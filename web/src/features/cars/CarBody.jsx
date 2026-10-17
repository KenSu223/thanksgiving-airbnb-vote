// 俯视的车，车头朝上、左舵，像租车 App 选座那样「掀了车顶」：车漆是带金属光泽的渐变，
// 前挡风 / 后窗是深色玻璃（带一道反光），LED 大灯、贯穿式红尾灯，车里看得见仪表台、
// 中控和座位（座位按钮由 CarCard 摆上去），四个轮胎带胎纹露在车身外。每个级别一个样子：
// 轿车、掀背、跑车（两座的是中置引擎：进气口、百叶引擎盖、尾翼；2+2 的是溜背）、
// 五座 / 三排 SUV（方正、黑色护杠）、MPV（短车头、滑门）、皮卡（驾驶室 + 车斗）、
// 面包车（方盒子）。都画在 200 宽的 viewBox 里；座位的纵向位置（第一排 first、往后每排
// gap）也由这里定，CarCard 按同样的数摆座位按钮。车漆颜色按第几辆车轮换（tone）。

const GEOM = {
  sedan: { first: 160, tail: 130 },
  hatch: { first: 152, tail: 100 },
  coupe: { first: 190, tail: 120 }, // 长车头；两座的车尾更长（中置引擎），见 carGeometry
  suv: { first: 156, tail: 128 },
  suv3: { first: 156, tail: 122 },
  mpv: { first: 136, tail: 116 },   // 车头短
  truck: { first: 154, tail: 214 }, // 驾驶室后面是车斗
  bus: { first: 128, tail: 104 },
};
export const bodyKinds = Object.keys(GEOM);

// first：第一排座位的 y；gap：排距；last：最后一排；H：整辆车的高度
export function carGeometry(kind, rows) {
  const g = GEOM[kind] || GEOM.sedan;
  const gap = kind === 'coupe' || rows.length >= 4 ? 70 : 79;
  const last = g.first + (rows.length - 1) * gap;
  const tail = kind === 'coupe' && rows.length === 1 ? 158 : g.tail;
  return { first: g.first, gap, last, H: last + tail };
}

// 车身轮廓：从车头 yF 到车尾 yB，中间一串 [y, 半宽]（右半边，左边对称）
const PROFILE = {
  sedan: (F, L, H) => ({ yF: 6, yB: H - 5, pts: [[24, 58], [60, 70], [104, 74], [H - 62, 74], [H - 28, 69]] }),
  hatch: (F, L, H) => ({ yF: 8, yB: H - 5, pts: [[24, 58], [58, 70], [100, 74], [H - 34, 74], [H - 14, 70]] }),
  coupe: (F, L, H) => ({ yF: 4, yB: H - 6, pts: [[14, 38], [34, 56], [64, 74], [104, 72], [F - 36, 65], [F + 8, 65], [L + 46, 76], [H - 48, 78], [H - 20, 72]] }),
  suv: (F, L, H) => ({ yF: 5, yB: H - 4, pts: [[14, 64], [36, 72], [80, 74], [H - 22, 74], [H - 10, 71]] }),
  suv3: (F, L, H) => ({ yF: 5, yB: H - 4, pts: [[14, 64], [36, 72], [80, 74], [H - 22, 74], [H - 10, 71]] }),
  mpv: (F, L, H) => ({ yF: 7, yB: H - 4, pts: [[20, 58], [48, 70], [86, 75], [H - 20, 75], [H - 9, 71]] }),
  truck: (F, L, H) => ({ yF: 5, yB: H - 4, pts: [[14, 64], [38, 73], [80, 74], [H - 14, 74], [H - 8, 72]] }),
  bus: (F, L, H) => ({ yF: 5, yB: H - 4, pts: [[12, 68], [30, 75], [H - 14, 75], [H - 7, 72]] }),
};

// 车里各部分的位置：前挡风 ws、车厢到哪 cab、后窗 rg、前后轴 axles
function layout(k, F, L, H, oneRow) {
  switch (k) {
    case 'hatch': return { ws: [F - 78, F - 40], cab: L + 40, rg: [L + 40, L + 68], axles: [F - 82, L + 50] };
    case 'coupe': return oneRow
      ? { ws: [F - 98, F - 42], cab: L + 28, rg: [L + 28, L + 38], axles: [66, L + 104] }
      : { ws: [F - 98, F - 42], cab: L + 30, rg: [L + 30, L + 74], axles: [66, L + 62] };
    case 'suv': case 'suv3': return { ws: [F - 74, F - 40], cab: H - 62, rg: [H - 62, H - 34], axles: [F - 88, L + (k === 'suv' ? 56 : 52)] };
    case 'mpv': return { ws: [F - 80, F - 40], cab: H - 58, rg: [H - 58, H - 28], axles: [F - 84, L + 62] };
    case 'truck': return { ws: [F - 74, F - 40], cab: L + 34, rg: [L + 34, L + 44], axles: [F - 90, L + 158] };
    case 'bus': return { ws: [F - 66, F - 40], cab: H - 42, rg: [H - 42, H - 20], axles: [F - 78, L + 50] };
    default: return { ws: [F - 80, F - 40], cab: L + 44, rg: [L + 44, L + 72], axles: [F - 86, L + 56] };
  }
}

// 车漆：[边、中间、高光、描边]
const PAINTS = [
  ['#2b3d6b', '#46609f', '#7f98d4', '#1f2d52'], // 午夜蓝
  ['#c9d0dc', '#eef1f6', '#ffffff', '#aeb7c6'], // 珍珠白
  ['#8e1f2c', '#c83443', '#ef7a85', '#6d1621'], // 赛道红
  ['#3d4350', '#626a7a', '#97a0b1', '#2b3039'], // 石墨灰
  ['#8d97a8', '#c3cad6', '#eef1f6', '#77818f'], // 银
  ['#245e66', '#3f8790', '#86c3c8', '#1a464c'], // 湖蓝
];
const GLASS_TOP = '#46577a', GLASS_BOTTOM = '#1b2438', INTERIOR = '#eef0f5', DASH = '#d6dbe4', TRIM = '#262c38', TIRE = '#1d222d';

const f1 = n => Math.round(n * 10) / 10;
// 一圈平滑的轮廓：车头中点 → 右边 → 车尾中点 → 左边，每个点的切线顺着前后两个点
// （车头、车尾中点是横的），手柄是这一段的三分之一（车头车尾两段更圆一些）——
// 这样车头车尾和两侧接得顺，也不会冲出去；手柄不超出车头 / 车尾。
function outline({ yF, yB, pts }) {
  const R = pts.map(([y, w]) => [100 + w, y]);
  const loop = [[100, yF], ...R, [100, yB], ...R.slice().reverse().map(([x, y]) => [200 - x, y])];
  const n = loop.length, back = R.length + 1;
  const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1; return [dx / m, dy / m]; };
  const tan = i => (i === 0 ? [1, 0] : i === back ? [-1, 0] : unit(loop[(i - 1 + n) % n], loop[(i + 1) % n]));
  const clampY = y => Math.min(yB, Math.max(yF, y));
  let d = `M100 ${yF}`;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = loop[i], b = loop[j], ta = tan(i), tb = tan(j);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * (i === 0 || j === 0 || i === back || j === back ? 0.55 : 1 / 3);
    d += ` C${f1(a[0] + ta[0] * len)} ${f1(clampY(a[1] + ta[1] * len))} ${f1(b[0] - tb[0] * len)} ${f1(clampY(b[1] - tb[1] * len))} ${f1(b[0])} ${f1(b[1])}`;
  }
  return d + 'Z';
}
// 某个 y 处车身的半宽（按轮廓点线性插值）
const halfWidth = (pts, y) => {
  if (y <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (y <= pts[i][0]) { const [y0, w0] = pts[i - 1], [y1, w1] = pts[i]; return w0 + (w1 - w0) * (y - y0) / (y1 - y0); }
  return pts[pts.length - 1][1];
};

// 一块横跨车身的板（玻璃、车厢）：上下两条边各自往外拱 k1 / k2，左右两边顺着半宽 w(y)
function band(y1, y2, w, k1, k2, steps = 6) {
  const side = [];
  for (let i = 0; i <= steps; i++) { const y = y1 + (y2 - y1) * i / steps; side.push([f1(100 + w(y)), f1(y)]); }
  const [x1] = side[0], [x2] = side[side.length - 1];
  return `M${f1(200 - x1)} ${f1(y1)}C${f1(100 - (x1 - 100) / 2)} ${f1(y1 - k1)} ${f1(100 + (x1 - 100) / 2)} ${f1(y1 - k1)} ${x1} ${f1(y1)}`
    + side.slice(1).map(([x, y]) => `L${x} ${y}`).join('')
    + `C${f1(100 + (x2 - 100) / 2)} ${f1(y2 + k2)} ${f1(100 - (x2 - 100) / 2)} ${f1(y2 + k2)} ${f1(200 - x2)} ${f1(y2)}`
    + side.slice(0, -1).reverse().map(([x, y]) => `L${f1(200 - x)} ${y}`).join('') + 'Z';
}

export default function CarBody({ kind, rows, id, tone = 0 }) {
  const k = GEOM[kind] ? kind : 'sedan';
  const { first: F, gap, last: L, H } = carGeometry(k, rows);
  const shape = PROFILE[k](F, L, H);
  const hw = y => halfWidth(shape.pts, y);
  const oneRow = rows.length === 1;
  const P = layout(k, F, L, H, oneRow);
  const [edge, mid, light, line] = PAINTS[((tone % PAINTS.length) + PAINTS.length) % PAINTS.length];
  const uid = 'cb' + String(id).replace(/[^\w-]/g, '');
  const body = outline(shape);
  const SILL = k === 'bus' || k === 'mpv' ? 9 : 11; // 车门的厚度（车身到车厢）
  const out = [];
  const add = el => out.push(el);

  // 轮胎：前后两个轴，从车身两侧露出一点；胎纹三道
  const [tw, th] = k === 'coupe' ? [14, 38] : k === 'bus' || k === 'truck' ? [13, 34] : [12, 32];
  for (const y of P.axles) for (const s of [-1, 1]) {
    const x = f1(100 + s * (hw(y) - 3) - tw / 2);
    add(<g key={'t' + y + s}>
      <rect x={x} y={y - th / 2} width={tw} height={th} rx="4.5" fill={TIRE} />
      <path d={`M${x + 2} ${y - th / 4}h${tw - 4}M${x + 2} ${y}h${tw - 4}M${x + 2} ${y + th / 4}h${tw - 4}`} stroke="#3a4152" strokeWidth="1.6" />
    </g>);
  }

  // 车身 + 金属光泽
  add(<path key="body" d={body} fill={`url(#${uid}p)`} stroke={line} strokeWidth="1.6" />);
  add(<g key="sheen" clipPath={`url(#${uid}c)`}>
    <ellipse cx="100" cy={f1(P.ws[0] / 2 + 4)} rx={f1(hw(P.ws[0] / 2) * 0.2)} ry={f1(P.ws[0] / 2 - 10)} fill="#fff" opacity=".14" />
    {!(k === 'coupe' && oneRow) && <ellipse cx="100" cy={f1((P.rg[1] + H) / 2)} rx={f1(hw(H - 30) * 0.22)} ry={f1(Math.max(5, (H - P.rg[1]) / 2 - 9))} fill="#fff" opacity=".1" />}
  </g>);

  // 灯：车头 LED（贴着车头的两角），车尾一条贯穿的红灯
  const lampDepth = { coupe: 40, suv: 18, suv3: 18, truck: 16, bus: 14, mpv: 22 }[k] || 22;
  const tailCorners = k === 'truck' || k === 'bus';
  add(<g key="lamps">
    <path d={body} fill="none" stroke="#e9f3ff" strokeWidth="6" clipPath={`url(#${uid}hl)`} />
    <path d={body} fill="none" stroke="#7fb4ff" strokeWidth="1.6" clipPath={`url(#${uid}hl)`} />
    <path d={body} fill="none" stroke="#d92f3f" strokeWidth="6" clipPath={`url(#${uid}tl)`} />
    <path d={body} fill="none" stroke="#ff8f99" strokeWidth="1.4" clipPath={`url(#${uid}tl)`} />
  </g>);
  // 越野感：SUV / 皮卡车头一块黑色格栅（带三道横条），SUV 车尾一道黑色护杠
  if (k === 'suv' || k === 'suv3' || k === 'truck') {
    add(<rect key="grille" x="68" y={shape.yF + 4} width="64" height="9" rx="3.5" fill={TRIM} />);
    add(<path key="grillebars" d={`M74 ${shape.yF + 7}h52M74 ${shape.yF + 10}h52`} stroke="#4a5266" strokeWidth="1" />);
  }
  if (k === 'suv' || k === 'suv3') add(<rect key="rearbumper" x="66" y={H - 11} width="68" height="5" rx="2.5" fill={TRIM} />);

  // 引擎盖：两道棱
  const [w1, w2] = P.ws;
  add(<path key="hood" d={`M${f1(100 - hw(w1) + 22)} ${w1 - 6}C${f1(100 - hw(30) + 26)} ${f1(w1 * 0.6)} ${f1(100 - hw(30) + 26)} 34 ${f1(100 - hw(24) + 30)} 22M${f1(100 + hw(w1) - 22)} ${w1 - 6}C${f1(100 + hw(30) - 26)} ${f1(w1 * 0.6)} ${f1(100 + hw(30) - 26)} 34 ${f1(100 + hw(24) - 30)} 22`} stroke={line} strokeOpacity=".35" strokeWidth="1.4" fill="none" />);

  // 前挡风：深色玻璃 + 一道反光
  const wsInset = k === 'coupe' ? [28, 13] : k === 'bus' ? [9, 9] : [15, 12];
  const wsTop = hw(w1) - wsInset[0], wsBot = hw(w2) - wsInset[1];
  add(<path key="ws" d={band(w1, w2, y => wsTop + (wsBot - wsTop) * (y - w1) / (w2 - w1), k === 'bus' ? 4 : 12, k === 'bus' ? -2 : -8)} fill={`url(#${uid}g)`} />);
  add(<path key="wsr" d={`M${f1(100 - wsTop * 0.55)} ${w1 + 6}l${f1(wsTop * 0.35)} 0l-14 ${f1(w2 - w1 - 12)}h-10Z`} fill="#fff" opacity=".13" />);

  // 车厢（掀了车顶）：内饰底色、仪表台 + 中控屏、两侧车门的接缝、前排中间的扶手
  const cabW = y => hw(y) - SILL;
  add(<path key="cab" d={band(w2, P.cab, cabW, -8, 6)} fill={INTERIOR} stroke={line} strokeOpacity=".45" strokeWidth="1.2" />);
  add(<path key="dash" d={band(w2, w2 + 11, cabW, -8, -4)} fill={DASH} />);
  add(<rect key="screen" x="84" y={w2 + 2.5} width="32" height="5.5" rx="2.5" fill="#222b40" />);
  if (rows[0] === 2 && k !== 'bus' && k !== 'mpv') add(<rect key="console" x="94.5" y={F - 16} width="11" height={k === 'coupe' && oneRow ? 36 : 42} rx="5.5" fill={DASH} />);
  for (let r = 0; r < rows.length - 1; r++) {
    const y = f1(F + r * gap + gap / 2 + 4);
    add(<path key={'seam' + r} d={`M${f1(100 - hw(y) + 2)} ${y}h${SILL - 3}M${f1(100 + hw(y) - 2)} ${y}h-${SILL - 3}`} stroke={line} strokeOpacity=".5" strokeWidth="1.4" strokeLinecap="round" />);
  }

  // 后窗
  if (P.rg) {
    const [r1, r2] = P.rg, top = cabW(r1), bot = hw(r2) - (k === 'coupe' ? 30 : 17);
    add(<path key="rg" d={band(r1, r2, y => top + (bot - top) * (y - r1) / (r2 - r1), -6, 6)} fill={`url(#${uid}g)`} />);
    add(<path key="rgr" d={`M${f1(100 + top * 0.3)} ${r1 + 4}h${f1(top * 0.3)}l-8 ${f1(r2 - r1 - 8)}h-8Z`} fill="#fff" opacity=".1" />);
  }

  // 后视镜
  const my = w2 - 2;
  add(<path key="mirrors" d={`M${f1(100 - hw(my) + 1)} ${my}l-13 -4q-4 0 -3.5 5l15.5 4.5ZM${f1(100 + hw(my) - 1)} ${my}l13 -4q4 0 3.5 5l-15.5 4.5Z`} fill={mid} stroke={line} strokeWidth="1.2" strokeLinejoin="round" />);

  // ---- 各级别的细节 ----
  if (k === 'sedan') add(<path key="trunk" d={`M${f1(100 - hw(H - 32) + 16)} ${H - 32}C80 ${H - 26} 120 ${H - 26} ${f1(100 + hw(H - 32) - 16)} ${H - 32}`} stroke={line} strokeOpacity=".4" strokeWidth="1.4" fill="none" />);
  if (k === 'hatch') add(<path key="lip" d={band(P.rg[0] - 5, P.rg[0], cabW, -6, 6)} fill={TRIM} />);

  if (k === 'coupe') {
    add(<rect key="hoodvent" x="84" y={w1 - 34} width="32" height="12" rx="4" fill={TRIM} opacity=".85" />);
    add(<path key="hoodslat" d={`M88 ${w1 - 28}h24`} stroke="#4a5266" strokeWidth="1.5" />);
    if (oneRow) {
      const e1 = L + 46, e2 = H - 40;
      add(<path key="intake" d={`M${f1(100 - hw(L + 24) + 3)} ${L + 18}l11 8v22l-11-5ZM${f1(100 + hw(L + 24) - 3)} ${L + 18}l-11 8v22l11-5Z`} fill={TRIM} />);
      for (let i = 0; i < 5; i++) {
        const y = f1(e1 + i * (e2 - e1) / 4);
        add(<path key={'louvre' + i} d={`M${f1(100 - hw(y) + 30)} ${y}h${f1(2 * hw(y) - 60)}`} stroke={TRIM} strokeWidth="3.2" strokeLinecap="round" opacity=".85" />);
      }
      add(<rect key="wing" x="30" y={H - 27} width="140" height="9" rx="3" fill={TRIM} />);
      add(<path key="plates" d={`M33 ${H - 31}v16M167 ${H - 31}v16`} stroke={TRIM} strokeWidth="4" strokeLinecap="round" />);
      add(<path key="exhaust" d={`M93 ${H - 6}h0.1M107 ${H - 6}h0.1`} stroke="#aab2c0" strokeWidth="6" strokeLinecap="round" />);
    } else {
      add(<path key="duck" d={`M${f1(100 - hw(H - 18) + 12)} ${H - 18}C80 ${H - 12} 120 ${H - 12} ${f1(100 + hw(H - 18) - 12)} ${H - 18}`} stroke={TRIM} strokeWidth="3" strokeLinecap="round" fill="none" />);
      add(<path key="exhaust" d={`M78 ${H - 6}h4M118 ${H - 6}h4`} stroke="#aab2c0" strokeWidth="5" strokeLinecap="round" />);
    }
  }

  if (k === 'mpv') {
    const y1 = F + 26, y2 = F + gap + 14;
    add(<path key="slide" d={`M${f1(100 - hw(y1) + 4)} ${y1}V${y2}M${f1(100 + hw(y1) - 4)} ${y1}V${y2}`} stroke={TRIM} strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round" />);
  }

  if (k === 'truck') {
    const b1 = L + 54, b2 = H - 16, bw = hw(b1) - 10;
    add(<rect key="bed" x={f1(100 - bw)} y={b1} width={f1(2 * bw)} height={b2 - b1} rx="5" fill="#363d4c" stroke={line} strokeWidth="1.4" />);
    for (const dx of [-30, -10, 10, 30]) add(<path key={'rib' + dx} d={`M${100 + dx} ${b1 + 8}V${b2 - 8}`} stroke="#4b5467" strokeWidth="2.4" strokeLinecap="round" />);
    add(<rect key="handle" x="90" y={H - 12} width="20" height="4" rx="2" fill={TRIM} />);
  }

  if (k === 'bus') {
    const y = F + gap + 6;
    add(<path key="door" d={`M${f1(100 + hw(y) - 3)} ${y}V${y + gap - 8}`} stroke={TRIM} strokeOpacity=".5" strokeWidth="1.6" strokeLinecap="round" />);
  }

  return (
    <svg viewBox={'0 0 200 ' + H} className="car-body" aria-hidden="true">
      <defs>
        <linearGradient id={uid + 'p'} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={edge} /><stop offset=".2" stopColor={mid} /><stop offset=".5" stopColor={light} /><stop offset=".8" stopColor={mid} /><stop offset="1" stopColor={edge} />
        </linearGradient>
        <linearGradient id={uid + 'g'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={GLASS_TOP} /><stop offset="1" stopColor={GLASS_BOTTOM} />
        </linearGradient>
        <clipPath id={uid + 'c'}><path d={body} /></clipPath>
        <clipPath id={uid + 'hl'}><rect x="0" y="0" width="74" height={lampDepth} /><rect x="126" y="0" width="74" height={lampDepth} /></clipPath>
        <clipPath id={uid + 'tl'}>{tailCorners
          ? <><rect x="0" y={H - 14} width="62" height="14" /><rect x="138" y={H - 14} width="62" height="14" /></>
          : <rect x="0" y={H - (k === 'coupe' ? 22 : 16)} width="200" height="22" />}</clipPath>
      </defs>
      {out}
    </svg>
  );
}
