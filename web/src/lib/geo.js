// 地图共用的几何：大圆航线、两点距离、开车路线的弧线
const R = Math.PI / 180;

// 大圆航线上的点（经度展开成连续的，跨太平洋的线不会绕地球另一边）
export function arc(a, b, n = 64) {
  const toV = p => [Math.cos(p.lat * R) * Math.cos(p.lng * R), Math.cos(p.lat * R) * Math.sin(p.lng * R), Math.sin(p.lat * R)];
  const A = toV(a), B = toV(b);
  const w = Math.acos(Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  const pts = [];
  let prevLng = a.lng;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s1 = w ? Math.sin((1 - t) * w) / Math.sin(w) : 1 - t, s2 = w ? Math.sin(t * w) / Math.sin(w) : t;
    const v = [0, 1, 2].map(k => s1 * A[k] + s2 * B[k]);
    let lng = Math.atan2(v[1], v[0]) / R;
    while (lng - prevLng > 180) lng -= 360;
    while (lng - prevLng < -180) lng += 360;
    prevLng = lng;
    pts.push([Math.atan2(v[2], Math.hypot(v[0], v[1])) / R, lng]);
  }
  return pts;
}

// 两点间的直线距离（公里）
export function km(a, b) {
  const dLat = (b.lat - a.lat) * R, dLng = (b.lng - a.lng) * R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// 开车的路：没有真实路线，画一条往旁边轻轻鼓出来的弧线（看得出是走地面，不是直线飞）
export function bend(a, b, n = 40) {
  const mx = (a.lat + b.lat) / 2, my = (a.lng + b.lng) / 2;
  const dx = b.lat - a.lat, dy = b.lng - a.lng;
  const c = { lat: mx - dy * 0.18, lng: my + dx * 0.18 };
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push([u * u * a.lat + 2 * u * t * c.lat + t * t * b.lat, u * u * a.lng + 2 * u * t * c.lng + t * t * b.lng]);
  }
  return pts;
}
