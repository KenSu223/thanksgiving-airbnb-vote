// 行李的线条图标，和导航图标一个画法（24 格、描边跟文字颜色）。箱子越大画得越高
const PATHS = {
  backpack: <><path d="M9 6.5V5a3 3 0 0 1 6 0v1.5" /><rect x="5.5" y="6.5" width="13" height="14.5" rx="4" /><path d="M9 14h6v4H9zM5.5 12h13" /></>,
  carryon: <><path d="M10 4.5h4M12 4.5v5" /><rect x="7.5" y="9.5" width="9" height="10" rx="2" /><path d="M10.5 12v5M13.5 12v5" /><circle cx="9.5" cy="21" r=".8" /><circle cx="14.5" cy="21" r=".8" /></>,
  medium: <><path d="M10 2.5h4M12 2.5v4" /><rect x="6.5" y="6.5" width="11" height="13" rx="2.2" /><path d="M10 9.5v7M14 9.5v7" /><circle cx="9" cy="21.2" r=".8" /><circle cx="15" cy="21.2" r=".8" /></>,
  large: <><path d="M10 1.5h4M12 1.5v2.5" /><rect x="5.5" y="4" width="13" height="16" rx="2.4" /><path d="M9.5 7v10M14.5 7v10" /><circle cx="8.5" cy="21.6" r=".8" /><circle cx="15.5" cy="21.6" r=".8" /></>,
  duffel: <><path d="M9 9V7.5A1.5 1.5 0 0 1 10.5 6h3A1.5 1.5 0 0 1 15 7.5V9" /><path d="M3 12.5A3.5 3.5 0 0 1 6.5 9h11a3.5 3.5 0 0 1 3.5 3.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M3 14h18" /></>,
  skis: <><path d="M5 21.5 16.5 2.5M9 21.5 20.5 2.5" /><path d="M8.6 14.2l3 1.8M12.6 14.2l3 1.8" /></>,
};

export default function BagIcon({ id, size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[id]}
    </svg>
  );
}
