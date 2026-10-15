// 导航用的线条图标：24 格、1.75 描边、跟着文字颜色走，换掉原来的 emoji，整条导航一个风格
const PATHS = {
  stays: <><path d="M3.5 10.5 12 4l8.5 6.5" /><path d="M5.5 9v10.5h13V9" /><path d="M10 19.5v-5h4v5" /></>,
  flights: <path d="M10.5 13.5 4 11l1.5-1.5 6.5 1L16.5 6a1.8 1.8 0 0 1 2.5 2.5L14.5 13l1 6.5L14 21l-2.5-6.5L8 18v2.5L6.5 22l-1-3.5L2 17.5 3.5 16H6l3.5-3.5" />,
  cars: <><path d="M4.5 16.5v-4l1.8-5a2 2 0 0 1 1.9-1.3h7.6a2 2 0 0 1 1.9 1.3l1.8 5v4" /><path d="M4.5 12.5h15M3.5 16.5h17" /><path d="M6 16.5v2.5M18 16.5v2.5" /><circle cx="8" cy="14.5" r=".6" fill="currentColor" /><circle cx="16" cy="14.5" r=".6" fill="currentColor" /></>,
  tasks: <><rect x="3.5" y="4" width="17" height="16.5" rx="3" /><path d="m7.5 9.5 1.5 1.5 3-3M7.5 15.5l1.5 1.5 3-3M14.5 10h2.5M14.5 16h2.5" /></>,
  schedule: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M8 14h3M8 17h6" /></>,
  dining: <><path d="M7 3v7.5a2 2 0 0 1-2 2v0a2 2 0 0 1-2-2V3M5 12.5V21M5 3v5" /><path d="M17 21V3c-2.2 1.2-3.5 3.6-3.5 7v3.5H17" /></>,
  activities: <><path d="M2.5 19.5 9 8l4 7 2.5-4 6 8.5Z" /><circle cx="17.5" cy="5.5" r="1.8" /></>,
  games: <><rect x="3.5" y="3.5" width="17" height="17" rx="3.5" /><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" /><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" /><circle cx="12" cy="12" r="1.1" fill="currentColor" /></>,
  gifts: <><rect x="3.5" y="8" width="17" height="4.5" rx="1" /><path d="M5 12.5v8h14v-8M12 8v12.5" /><path d="M12 8C10.5 4.5 7 4 7 6.2 7 8 12 8 12 8Zm0 0c1.5-3.5 5-4 5-1.8C17 8 12 8 12 8Z" /></>,
  expenses: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><path d="M7 15h3" /></>,
  // 三个组（手机底部的三个大标签）：行程是行李箱，去哪是指南针，一起是两个人
  trip: <><rect x="3.5" y="7" width="17" height="13" rx="2.5" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" /><path d="M3.5 12.5h17M10.5 12.5v2h3v-2" /></>,
  explore: <><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8Z" /></>,
  together: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" /><circle cx="16.5" cy="9.5" r="2.4" /><path d="M15.2 14.3a4.6 4.6 0 0 1 5.3 4.6" /></>,
};

export default function NavIcon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
