import { useEffect, useRef } from 'react';
import { paintKind, fitKind } from './draw.js';

// One kind drawn on its own (the same drawing as in the water), for the 图鉴,
// the catch list and the intro. Still by default; `swim` keeps it moving.
export default function KindIcon({ kind, w = 56, h = 40, swim = false, className = '', label }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    const { r, x, y } = fitKind(kind, w * 0.92, h * 0.92);
    let raf = 0;
    const paint = now => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(x + w * 0.04, y + h * 0.04);
      paintKind(ctx, kind, r, now / 1000, 3);
      if (swim) raf = requestAnimationFrame(paint);
    };
    paint(swim ? performance.now() : 600);
    return () => cancelAnimationFrame(raf);
  }, [kind, w, h, swim]);
  return <canvas ref={ref} className={className} style={{ width: w, height: h }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
