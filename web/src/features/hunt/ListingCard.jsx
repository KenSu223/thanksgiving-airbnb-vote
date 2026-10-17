import { statsLine } from '../../lib/format.js';
import Carousel from '../../components/Carousel.jsx';
import PriceBlock from './PriceBlock.jsx';
import AreaBadge from './AreaBadge.jsx';
import { isBooked } from './price.js';
import { useSession } from '../../session/SessionContext.jsx';

// 按当前行程的日期和人数打开 Airbnb，直接看到实时总价
const airbnbLink = (l, T) => 'https://www.airbnb.com/rooms/' + l.roomId + '?adults=' + T.people + '&check_in=' + T.checkIn + '&check_out=' + T.checkOut;
// 酒店（从地图链接加的，或者之前从 Booking.com 加的）：打开原来的链接
const isMapUrl = u => /(^https?:\/\/)?((www|maps)\.google\.|maps\.app\.goo\.gl|maps\.apple\.com)/i.test(String(u || ''));

// closed：投票已截止（不能投、不能删）；chosen：大家选定的这间；onChoose：截止后改选（谁都可以）
export default function ListingCard({ l, T, token, glow, pop, cardRef, zones, closed, chosen, onChoose, onVote, onRemove, onSetArea, onSetRate }) {
  const hotel = l.kind === 'hotel';
  const votes = l.votes || [];
  const { name: myName } = useSession();
  // A vote is mine by token OR by account name — tokens rotate (setting a PIN).
  const voted = votes.some(v => v.token === token || (!!myName && String(v.name || '').toLowerCase() === myName.toLowerCase()));
  const pics = l.images && l.images.length ? l.images : l.image ? [l.image] : [];
  return (
    <article ref={cardRef} data-id={l.id}
      className={'glass-card rounded-2xl overflow-hidden flex flex-col ' + (hotel ? 'is-hotel' : 'is-airbnb') + (chosen ? ' ring-4 ring-amber-400' : '') + (isBooked(l, T) ? ' opacity-60 grayscale-[40%] hover:opacity-100 hover:grayscale-0 transition' : '') + (glow ? ' just-voted' : '')}>
      <div className="relative car-wrap">
        <Carousel pics={pics} />
        <span className={'kind-tag ' + (hotel ? 'hotel' : 'airbnb')}>{hotel ? '🏨 酒店' : '🏠 Airbnb'}</span>
        <AreaBadge area={l.area} zones={zones} onChange={a => onSetArea(l, a)} />
        {!closed && <button onClick={() => onRemove(l)} title="删除这个房源" className="absolute top-3 right-3 bg-black/60 hover:bg-red-600 text-white text-xs px-2 py-1 rounded-full">✕</button>}
        {chosen && <span className="absolute top-3 right-3 bg-amber-400 text-amber-950 text-xs font-black px-2 py-1 rounded-full shadow">🏆 我们选了这间</span>}
      </div>
      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-bold leading-snug mb-1">{hotel ? '🏨 ' : ''}{l.title || '未命名房源'}</h3>
        {hotel && l.address && <p className="text-sm text-slate-600 mb-1">📍 {l.address}</p>}
        <p className="text-sm text-slate-500 mb-2">{hotel ? '酒店' : statsLine(l)}{l.addedBy ? ' · 由 ' + l.addedBy + ' 添加' : ''}</p>
        {l.sleeps && l.sleeps < T.people ? <p className="text-sm text-amber-600 mb-2">⚠️ 最多住 {l.sleeps} 人，不够 {T.people} 人</p> : null}
        <div className="mb-1"><PriceBlock l={l} T={T} closed={closed} onSetRate={onSetRate} /></div>
        <div className="mb-2">{l.rating ? <span className="text-sm">⭐ {l.rating}{l.reviews ? '（' + l.reviews + '条评价）' : ''}</span> : null}</div>
        {l.note && <p className="text-sm text-slate-600 mb-2">💡 {l.note}</p>}
        {votes.length
          ? <div className="mb-3">{votes.map(v => <span key={v.token} className="chip">{v.name || '匿名'}</span>)}</div>
          : <div className="mb-3 text-xs text-slate-400">还没有人投票，来当第一个吧</div>}
        <div className="mt-auto flex gap-2">
          {closed
            ? <span className="flex-1 text-center border-2 border-slate-200 text-slate-500 font-bold rounded-xl py-2">🔒 {votes.length} 票{voted ? ' · 你投了' : ''}</span>
            : <button onClick={e => onVote(l, e.currentTarget)} className={'vote-btn flex-1 border-2 border-rose-500 text-rose-600 font-bold rounded-xl py-2' + (voted ? ' voted' : '') + (pop ? ' vote-pop' : '')}>
                {(voted ? '❤️ 已投 · ' : '🤍 投票 · ') + votes.length}
              </button>}
          {hotel
            ? <a href={l.url} target="_blank" rel="noopener" title="打开原来的链接，看位置、价格和预订"
                className="border-2 border-slate-200 rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:border-indigo-400">{isMapUrl(l.url) ? '看地图 ↗' : /booking\.com/i.test(l.url) ? '去 Booking ↗' : '打开链接 ↗'}</a>
            : <a href={airbnbLink(l, T)} target="_blank" rel="noopener" title={'按 ' + T.date + ' · ' + T.people + '人查看实时价格'}
                className="border-2 border-slate-200 rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:border-indigo-400">去 Airbnb ↗</a>}
        </div>
        {onChoose && !chosen && <button onClick={() => onChoose(l)} className="mt-2 text-sm font-bold text-amber-700 border-2 border-amber-200 hover:border-amber-400 rounded-xl py-1.5">改选这间</button>}
      </div>
    </article>
  );
}
