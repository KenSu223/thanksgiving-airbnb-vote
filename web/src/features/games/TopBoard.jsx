// 排行榜只给大家看前三名（服务器只发前三，worker/lib/board.js）；你不在前三时，
// 最下面隔一下是你自己的名次，只有你看得到。row(r, i, isMe) 画一行，i 是名次 - 1。
export const TOP_NOTE = '只显示前三名，你自己的名次只有你看得到';

export const place = i => (i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1) + '.');

export function BoardRows({ rows, me, row, empty = '还没人玩过' }) {
  if (!rows.length && !me) return <p className="text-sm text-slate-400">{empty}</p>;
  return (
    <>
      {rows.map((r, i) => row(r, i, false))}
      {me && (
        <>
          <div className="pt-1 text-center text-xs leading-none text-slate-300" aria-hidden="true">⋯</div>
          {row(me, me.rank - 1, true)}
        </>
      )}
    </>
  );
}
