// 俯视的车身，车头朝上、左舵：每个级别一个样子——轿车、掀背、跑车（两座的是中置引擎，
// 2+2 的是溜背）、五座 / 三排 SUV（方正、车顶行李架）、MPV（短车头、滑门轨）、皮卡
// （驾驶室 + 露天车斗）、面包车（方盒子、一排侧窗）。都画在 200 宽的 viewBox 里；
// 座位的纵向位置（第一排 first、往后每排 gap）也由这里定，CarCard 按同样的数摆座位按钮。

const GEOM = {
  sedan: { first: 150, tail: 132 },
  hatch: { first: 142, tail: 104 },
  coupe: { first: 182, tail: 118 }, // 长车头；两座的车尾更长（中置引擎），见 carGeometry
  suv: { first: 146, tail: 126 },
  suv3: { first: 146, tail: 122 },
  mpv: { first: 124, tail: 116 },   // 车头短
  truck: { first: 146, tail: 212 }, // 驾驶室后面是车斗
  bus: { first: 118, tail: 108 },
};
export const bodyKinds = Object.keys(GEOM);

// first：第一排座位的 y；gap：排距；last：最后一排；H：整辆车的高度
export function carGeometry(kind, rows) {
  const g = GEOM[kind] || GEOM.sedan;
  const gap = kind === 'coupe' || rows.length >= 4 ? 70 : 79;
  const last = g.first + (rows.length - 1) * gap;
  const tail = kind === 'coupe' && rows.length === 1 ? 156 : g.tail;
  return { first: g.first, gap, last, H: last + tail };
}

// 车身轮廓：从车头 yF 到车尾 yB，中间一串 [y, 半宽]（右半边，左边对称），
// 用平滑曲线连起来。
const PROFILE = {
  sedan: (F, L, H) => ({ yF: 6, yB: H - 5, pts: [[24, 58], [58, 70], [100, 74], [H - 60, 74], [H - 28, 69]] }),
  hatch: (F, L, H) => ({ yF: 8, yB: H - 5, pts: [[24, 58], [58, 70], [100, 74], [H - 34, 74], [H - 14, 70]] }),
  coupe: (F, L, H) => ({ yF: 4, yB: H - 6, pts: [[14, 38], [34, 56], [64, 74], [102, 72], [F - 34, 65], [F + 8, 65], [L + 46, 76], [H - 48, 78], [H - 20, 72]] }),
  suv: (F, L, H) => ({ yF: 5, yB: H - 4, pts: [[14, 64], [36, 72], [80, 74], [H - 22, 74], [H - 10, 71]] }),
  suv3: (F, L, H) => ({ yF: 5, yB: H - 4, pts: [[14, 64], [36, 72], [80, 74], [H - 22, 74], [H - 10, 71]] }),
  mpv: (F, L, H) => ({ yF: 7, yB: H - 4, pts: [[20, 58], [48, 70], [86, 75], [H - 20, 75], [H - 9, 71]] }),
  truck: (F, L, H) => ({ yF: 5, yB: H - 4, pts: [[14, 64], [38, 73], [80, 74], [H - 14, 74], [H - 8, 72]] }),
  bus: (F, L, H) => ({ yF: 5, yB: H - 4, pts: [[12, 68], [30, 75], [H - 14, 75], [H - 7, 72]] }),
};

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

// 前挡风：上边往前拱；后窗：下边往后拱。a / b 是上 / 下边的半宽
const front = (y1, y2, a, b, k) => `M${f1(100 - a)} ${y1}C${f1(100 - a / 2)} ${y1 - k} ${f1(100 + a / 2)} ${y1 - k} ${f1(100 + a)} ${y1}L${f1(100 + b)} ${y2}C${f1(100 + b / 2)} ${f1(y2 - k * 0.7)} ${f1(100 - b / 2)} ${f1(y2 - k * 0.7)} ${f1(100 - b)} ${y2}Z`;
const rear = (y1, y2, a, b, k) => `M${f1(100 - a)} ${y1}C${f1(100 - a / 2)} ${y1 + k} ${f1(100 + a / 2)} ${y1 + k} ${f1(100 + a)} ${y1}L${f1(100 + b)} ${y2}C${f1(100 + b / 2)} ${f1(y2 + k * 1.2)} ${f1(100 - b / 2)} ${f1(y2 + k * 1.2)} ${f1(100 - b)} ${y2}Z`;

const GLASS = '#c9d3e6', LINE = '#d8dfeb', EDGE = '#cdd5e3', TIRE = '#4a5370', TRIM = '#97a3ba';

export default function CarBody({ kind, rows, id }) {
  const k = GEOM[kind] ? kind : 'sedan';
  const { first: F, last: L, H } = carGeometry(k, rows);
  const shape = PROFILE[k](F, L, H);
  const hw = y => halfWidth(shape.pts, y);
  const oneRow = rows.length === 1;

  // 车轮：前后两个轴，轮胎从车身两侧露出一点
  const axles = {
    sedan: [F - 80, L + 56], hatch: [F - 76, L + 50], suv: [F - 82, L + 54], suv3: [F - 82, L + 52],
    mpv: [F - 76, L + 60], truck: [F - 84, L + 156], bus: [F - 72, L + 48],
    coupe: [64, oneRow ? L + 98 : L + 60],
  }[k];
  const [tw, th] = k === 'coupe' ? [13, 36] : k === 'bus' || k === 'truck' ? [12, 32] : [11, 30];
  const tires = axles.flatMap(y => [-1, 1].map(s => (
    <rect key={y + ':' + s} x={f1(100 + s * (hw(y) - 3) - tw / 2)} y={y - th / 2} width={tw} height={th} rx="4" fill={TIRE} />
  )));

  // 前挡风（跑车更斜更长，面包车平）和后视镜
  const [w1, w2, wk] = k === 'coupe' ? [F - 82, F - 26, 16] : k === 'bus' ? [F - 54, F - 28, 6] : k === 'mpv' ? [F - 64, F - 24, 12] : [F - 58, F - 22, k === 'sedan' || k === 'hatch' ? 12 : 8];
  const inset = k === 'bus' ? [9, 11] : k === 'coupe' ? [30, 24] : [16, 22];
  const mirrorY = w2 - 6;
  const detail = [];
  detail.push(<path key="ws" d={front(w1, w2, hw(w1) - inset[0], hw(w2) - inset[1], wk)} fill={GLASS} />);
  detail.push(<path key="mir" d={`M${f1(100 - hw(mirrorY))} ${mirrorY}l-12 4M${f1(100 + hw(mirrorY))} ${mirrorY}l12 4`} stroke={EDGE} strokeWidth="5" strokeLinecap="round" />);

  if (k === 'sedan' || k === 'hatch') {
    const [g1, g2] = k === 'sedan' ? [L + 44, L + 74] : [L + 44, L + 76];
    detail.push(<path key="rg" d={rear(g1, g2, hw(g1) - 24, hw(g2) - 20, 8)} fill={GLASS} />);
    detail.push(<path key="grille" d="M70 20h60" stroke={LINE} strokeWidth="2" strokeLinecap="round" />);
    if (k === 'sedan') detail.push(<path key="trunk" d={`M${f1(100 - hw(H - 30) + 18)} ${H - 30}C80 ${H - 25} 120 ${H - 25} ${f1(100 + hw(H - 30) - 18)} ${H - 30}`} stroke={LINE} strokeWidth="2" fill="none" />);
    else detail.push(<path key="lip" d={`M${f1(100 - hw(L + 40) + 18)} ${L + 39}h${f1(2 * hw(L + 40) - 36)}`} stroke={TRIM} strokeWidth="3" strokeLinecap="round" />);
  }

  if (k === 'coupe') {
    // 前大灯、引擎盖上两道棱
    detail.push(<path key="lamps" d="M49 44Q54 29 72 21L75 27Q61 33 54 47ZM151 44Q146 29 128 21L125 27Q139 33 146 47Z" fill={TRIM} />);
    detail.push(<path key="crease" d={`M88 30L80 ${w1 - 12}M112 30L120 ${w1 - 12}`} stroke={LINE} strokeWidth="2" strokeLinecap="round" />);
    detail.push(<path key="hoodvent" d={`M88 ${w1 - 40}h24M90 ${w1 - 32}h20`} stroke={GLASS} strokeWidth="2.5" strokeLinecap="round" />);
    if (oneRow) {
      // 中置引擎：座位后面是引擎盖（百叶）、两侧进气口，车尾一道尾翼
      const e1 = L + 40, e2 = H - 40;
      detail.push(<path key="intake" d={`M${f1(100 - hw(L + 24) + 3)} ${L + 20}l10 7v22l-10-5ZM${f1(100 + hw(L + 24) - 3)} ${L + 20}l-10 7v22l10-5Z`} fill={TRIM} />);
      detail.push(<path key="engine" d={rear(e1, e2, hw(e1) - 30, hw(e2) - 28, 6)} fill="#dfe5ef" stroke={EDGE} strokeWidth="1.5" />);
      for (let i = 0; i < 4; i++) {
        const y = e1 + 12 + i * ((e2 - e1 - 18) / 3);
        detail.push(<path key={'vent' + i} d={`M${f1(100 - hw(y) + 42)} ${f1(y)}h${f1(2 * hw(y) - 84)}`} stroke={GLASS} strokeWidth="3" strokeLinecap="round" />);
      }
      detail.push(<rect key="wing" x="34" y={H - 26} width="132" height="8" rx="4" fill={TRIM} />);
    } else {
      // 2+2：溜背的长后窗、鸭尾
      const g1 = L + 40, g2 = L + 76;
      detail.push(<path key="rg" d={rear(g1, g2, hw(g1) - 30, hw(g2) - 40, 8)} fill={GLASS} />);
      detail.push(<path key="duck" d={`M${f1(100 - hw(H - 16) + 14)} ${H - 16}C80 ${H - 10} 120 ${H - 10} ${f1(100 + hw(H - 16) - 14)} ${H - 16}`} stroke={TRIM} strokeWidth="4" strokeLinecap="round" fill="none" />);
    }
  }

  if (k === 'suv' || k === 'suv3') {
    const g1 = H - 64, g2 = H - 32;
    detail.push(<path key="rails" d={`M${f1(100 - hw(F) + 15)} ${w2 + 8}V${g1 - 8}M${f1(100 + hw(F) - 15)} ${w2 + 8}V${g1 - 8}`} stroke="#c3ccdb" strokeWidth="3" strokeLinecap="round" />);
    detail.push(<path key="rg" d={rear(g1, g2, hw(g1) - 22, hw(g2) - 20, 4)} fill={GLASS} />);
    detail.push(<path key="grille" d="M64 15h72" stroke={LINE} strokeWidth="2.5" strokeLinecap="round" />);
  }

  if (k === 'mpv') {
    const g1 = H - 58, g2 = H - 24;
    detail.push(<path key="track" d={`M${f1(100 - hw(F + 40) + 3)} ${F + 34}V${F + 112}M${f1(100 + hw(F + 40) - 3)} ${F + 34}V${F + 112}`} stroke={LINE} strokeWidth="2.5" strokeLinecap="round" />);
    detail.push(<path key="rg" d={rear(g1, g2, hw(g1) - 18, hw(g2) - 16, 5)} fill={GLASS} />);
  }

  if (k === 'truck') {
    // 驾驶室后窗；车斗：开口的箱子、底板棱、尾门
    const b1 = L + 52, b2 = H - 14, bw = hw(b1) - 9;
    detail.push(<path key="cabglass" d={rear(L + 26, L + 40, hw(L + 26) - 24, hw(L + 40) - 24, 3)} fill={GLASS} />);
    detail.push(<rect key="bed" x={f1(100 - bw)} y={b1} width={f1(2 * bw)} height={b2 - b1} rx="6" fill="#dde3ee" stroke={EDGE} strokeWidth="1.5" />);
    for (const dx of [-26, 0, 26]) detail.push(<path key={'rib' + dx} d={`M${100 + dx} ${b1 + 10}V${b2 - 10}`} stroke="#cfd7e4" strokeWidth="2.5" strokeLinecap="round" />);
    detail.push(<path key="gate" d={`M${f1(100 - bw + 6)} ${H - 9}h${f1(2 * bw - 12)}`} stroke={TRIM} strokeWidth="3" strokeLinecap="round" />);
    detail.push(<path key="grille" d="M64 14h72" stroke={LINE} strokeWidth="2.5" strokeLinecap="round" />);
  }

  if (k === 'bus') {
    // 两侧一长条窗、后窗
    detail.push(<path key="sides" d={`M${f1(100 - hw(F) + 7)} ${w2 + 14}V${H - 46}M${f1(100 + hw(F) - 7)} ${w2 + 14}V${H - 46}`} stroke={GLASS} strokeWidth="6" strokeLinecap="round" />);
    detail.push(<path key="rg" d={rear(H - 38, H - 18, hw(H - 38) - 14, hw(H - 18) - 14, 3)} fill={GLASS} />);
    detail.push(<path key="grille" d="M62 13h76" stroke={LINE} strokeWidth="2.5" strokeLinecap="round" />);
  }

  return (
    <svg viewBox={'0 0 200 ' + H} className="car-body" aria-hidden="true">
      <defs>
        <linearGradient id={'paint' + id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e7ebf3" /><stop offset=".5" stopColor="#ffffff" /><stop offset="1" stopColor="#e7ebf3" />
        </linearGradient>
      </defs>
      {tires}
      <path d={outline(shape)} fill={'url(#paint' + id + ')'} stroke={EDGE} strokeWidth="2" />
      {detail}
    </svg>
  );
}
