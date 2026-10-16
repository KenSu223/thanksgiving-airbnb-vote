import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { TRIPS } from '../../lib/config.js';
import { load, save } from '../../lib/storage.js';
import { reduceMotion } from '../../lib/motion.js';
import { useSession } from '../../session/SessionContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import AddListingForm from './AddListingForm.jsx';
import VoteBanner from './VoteBanner.jsx';
import DecisionPanel from './DecisionPanel.jsx';
import Toolbar, { KINDS } from './Toolbar.jsx';
import ListingMap from './ListingMap.jsx';
import ListingGrid from './ListingGrid.jsx';
import { celebrateVote } from '../../lib/celebrate.js';
import { isHotel, sortListings } from './price.js';
import { inZone, NO_AREA, zoneTabs } from './zones.js';
import { useListings } from './useListings.js';
import WeatherStrip from '../weather/WeatherStrip.jsx';
import './hunt.css';

const REORDER_DELAY = 700; // 投票后先在原位更新，过一会儿再按新票数重排

export default function HuntView({ trip, active }) {
  const T = TRIPS[trip];
  const { token, name, ensureName } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const { listings, refresh, patch, vote: voteInfo, setVote, loaded } = useListings(trip, token);
  const closed = !!voteInfo && !voteInfo.open;
  // 页面开着的时候到了截止时间：重新拉一次，切到结果面板
  useEffect(() => {
    if (!voteInfo || !voteInfo.open || !voteInfo.voteEndsAt) return;
    const ms = Date.parse(voteInfo.voteEndsAt) - Date.now() + 1500;
    if (ms > 2147483647) return; // setTimeout 等不了那么久，下次打开页面再说
    const id = setTimeout(refresh, Math.max(0, ms));
    return () => clearTimeout(id);
  }, [voteInfo, refresh]);
  const [filter, setFilter] = useState('all');
  const [kind, setKind] = useState(() => (KINDS.some(([k]) => k === load('huntKind')) ? load('huntKind') : 'all'));
  const [sortBy, setSortBy] = useState('votes');
  const [showMap, setShowMap] = useState(() => load('showMap') !== '0');
  const [hotId, setHotId] = useState(null);
  const [frozen, setFrozen] = useState(null); // 投票后暂时保持的顺序
  const [anchorId, setAnchorId] = useState(null);
  const [glowId, setGlowId] = useState(null);
  const [popId, setPopId] = useState(null); // 刚投票的按钮弹一下
  const timers = useRef([]);
  const gridBox = useRef(null);
  const tripRef = useRef(trip); // 投票请求回来时用来判断是不是已经切到别的行程了
  tripRef.current = trip;

  useEffect(() => { setFilter('all'); setFrozen(null); timers.current.forEach(clearTimeout); }, [trip]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  // 锚点只用一次：网格（子组件的 layout effect 先跑）重排完就清掉，免得之后换排序时又跳回这间
  useEffect(() => { if (anchorId) setAnchorId(null); }, [anchorId]);

  const ofKind = useMemo(() => (kind === 'all' ? listings : listings.filter(l => isHotel(l) === (kind === 'hotel'))), [listings, kind]);
  const kindCounts = useMemo(() => {
    const hotels = listings.filter(isHotel).length;
    return { all: listings.length, airbnb: listings.length - hotels, hotel: hotels };
  }, [listings]);
  function pickKind(k) { save('huntKind', k); setKind(k); setFrozen(null); }

  const visible = useMemo(() => {
    return sortListings(ofKind.filter(l => inZone(l, filter)), sortBy, T);
  }, [ofKind, filter, sortBy, T]);

  // 冻结期间按冻结时的顺序显示（新出现的房源排在后面），数据照常更新
  const items = useMemo(() => {
    if (!frozen) return visible;
    const byId = new Map(visible.map(l => [l.id, l]));
    const kept = frozen.filter(id => byId.has(id)).map(id => byId.get(id));
    return kept.concat(visible.filter(l => !frozen.includes(l.id)));
  }, [visible, frozen]);

  const tabs = useMemo(() => zoneTabs(T, ofKind), [T, ofKind]);
  const zoneNames = tabs.map(t => t.name).filter(n => n !== NO_AREA);
  // 选中的区域标签没了（比如最后一间被改到别的区域）：回到「全部」
  useEffect(() => { if (filter !== 'all' && ofKind.length && !tabs.some(t => t.name === filter)) setFilter('all'); }, [tabs, filter, ofKind.length]);

  async function setArea(l, area) {
    const r = await api('/api/area', 'POST', { trip, id: l.id, area });
    if (r.ok) patch(l.id, () => r.listing); else toast('改区域失败：' + (r.error || ''));
  }
  // 酒店：手填每间每晚的价格（空着就是清掉）
  async function setRate(l, nightly) {
    const r = await api('/api/hotel-rate', 'POST', { trip, id: l.id, nightly, name });
    if (r.ok) patch(l.id, () => r.listing); else toast('改价格失败：' + (r.error || ''));
    return r.ok;
  }

  function afterVote(id, votes) {
    if (sortBy === 'votes') setFrozen(f => f || items.map(l => l.id));
    patch(id, l => ({ ...l, votes }));
    timers.current.forEach(clearTimeout);
    timers.current = [setTimeout(() => {
      setAnchorId(id); setFrozen(null); setGlowId(id);
      timers.current.push(setTimeout(() => setGlowId(null), 1200));
    }, sortBy === 'votes' ? REORDER_DELAY : 0)];
  }

  async function vote(l, btn) {
    const t = trip;
    if ((l.votes || []).some(v => v.token === token)) {
      const r = await api('/api/vote', 'POST', { trip: t, id: l.id, token, name: null });
      if (r.ok && t === tripRef.current) afterVote(l.id, r.votes);
      return;
    }
    ensureName(async me => {
      const r = await api('/api/vote', 'POST', { trip: t, id: l.id, token: me.token, name: me.name });
      if (!r.ok) { if (r.error) { toast(r.error); refresh(); } return; }
      if (t !== tripRef.current) return; // 等待期间切了行程：这间已经不在页面上了
      afterVote(l.id, r.votes);
      toast('🎉 投票成功！给「' + (l.title || '未命名房源') + '」+1');
      if (!reduceMotion) { setPopId(l.id); timers.current.push(setTimeout(() => setPopId(null), 450)); }
      celebrateVote(btn);
    });
  }

  async function remove(l) {
    if (!await confirm({ title: '删除这个房源？', message: '确定要删除「' + (l.title || '未命名房源') + '」吗？删掉后大家就看不到了。', confirmText: '删除', danger: true })) return;
    const r = await api('/api/remove', 'POST', { trip, id: l.id });
    if (r.ok) await refresh(); else toast('删除失败：' + (r.error || '稍后再试'));
  }

  async function choose(l) {
    if (!await confirm({ title: '就定这间？', message: '把「' + (l.title || '未命名房源') + '」定为 ' + T.date + ' 的房子？会写明是你改选的。', confirmText: '就定这间' })) return;
    ensureName(async me => {
      const r = await api('/api/decision', 'POST', { trip, name: me.name, token: me.token, listingId: l.id });
      if (r.ok) { setVote(r.vote); window.scrollTo({ top: 0, behavior: 'smooth' }); } else toast(r.error || '没成功');
    });
  }

  function focusCard(id) {
    const el = gridBox.current?.querySelector('article[data-id="' + CSS.escape(id) + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  // 选了某个区域时，在地图上方显示那里的天气（地点 = 这个区域房源位置的平均值）；「全部」「未分区」不显示
  const region = useMemo(() => {
    if (filter === 'all' || filter === NO_AREA) return null;
    const pts = visible.filter(l => l.lat != null && l.lng != null);
    if (!pts.length) return null;
    const avg = f => pts.reduce((t, l) => t + l[f], 0) / pts.length;
    return { name: filter, lat: Math.round(avg('lat') * 10) / 10, lng: Math.round(avg('lng') * 10) / 10 };
  }, [filter, visible]);

  // 「全部类型」不分酒店和 Airbnb：一份列表按所选排序交错排（价格已统一成
  // 全团总价口径，见 price.js 的 hotelTotal），卡上的类型标签足够区分。
  const emptyText = (kind === 'hotel' ? '还没有酒店' : kind === 'airbnb' ? '还没有 Airbnb' : '还没有候选') + (filter === 'all' ? '' : '（这个区域）')
    + '，贴个 ' + (kind === 'hotel' ? 'Google 地图酒店' : kind === 'airbnb' ? 'Airbnb' : 'Airbnb 或 Google 地图酒店') + '链接进来吧 👆';
  const sections = [{ key: 'one', items }];

  const fitKey = trip + '|' + kind + '|' + filter + '|' + visible.map(l => l.id + (l.lat != null ? '@' : '')).sort().join(',');
  return (
    <>
      {/* 切行程转场的分工（见 styles.css）：顶部小块 .trip-blur 带模糊，
          地图和房源网格 .trip-fade 只淡入，不参与模糊渲染。
          横幅是一个常驻的「槽」：投票数据要等 /api/state 回来才能知道
          显示倒计时还是结果面板，要是等数据到了才把整块挂上去，它会
          比不依赖数据的表单/工具条晚一拍单独动画着插进来（就是那种
          「别人都渲染好了它才出现」的感觉）。所以加载中先放一块同高
          的占位，槽从第一帧就在、动画只跑一次，数据到了原地换内容。 */}
      <div className="trip-blur">
        {!loaded ? (
          // 高度写死 164px：真横幅在手机上的实测高度（内边距 32 + 标题区
          // 三行 76 + 段落三行 48 + 间距 8）。加载框和真横幅同高，数据
          // 到了原地替换，下面的内容不会被顶动。
          <section className="rounded-2xl p-4 mb-5 h-[164px] flex items-center bg-white/40 border border-white/50 text-slate-400 text-sm" aria-hidden="true">
            🗳️ 投票倒计时加载中…
          </section>
        ) : voteInfo && voteInfo.open && voteInfo.voteEndsAt ? (
          <VoteBanner vote={voteInfo} listings={listings} T={T} />
        ) : closed ? (
          <DecisionPanel trip={trip} T={T} vote={voteInfo} listings={listings} onVote={setVote} />
        ) : null}
      </div>
      <div className="trip-blur"><AddListingForm trip={trip} T={T} zones={zoneNames} closed={closed} onAdded={refresh} /></div>
      <div className="trip-blur">
        <Toolbar kind={kind} onKind={pickKind} kindCounts={kindCounts} tabs={tabs} filter={filter} onFilter={setFilter} sortBy={sortBy} onSort={setSortBy} count={listings.length}
          showMap={showMap} onToggleMap={() => { save('showMap', showMap ? '0' : '1'); setShowMap(!showMap); }} />
        {region && <WeatherStrip trip={trip} name={region.name} lat={region.lat} lng={region.lng} />}
      </div>
      {showMap && <div className="trip-fade"><ListingMap items={visible} T={T} token={token} fitKey={fitKey} visible={active} hotId={hotId} onFocus={focusCard} /></div>}
      <div ref={gridBox} className="trip-fade">
        {sections.map(sec => (
          <div key={sec.key} className={sec.title ? 'kind-section kind-section-' + sec.key : ''}>
            {sec.title && <h2 className="kind-heading">{sec.title}<span className="kind-heading-n">{sec.items.length}</span><span className="kind-heading-sub">{sec.sub}</span></h2>}
            <ListingGrid items={sec.items} T={T} token={token} glowId={glowId} popId={popId} anchorId={anchorId}
              emptyText={emptyText}
              zones={zoneNames} closed={closed} chosenId={voteInfo?.chosenId} onChoose={closed ? choose : null}
              onVote={vote} onRemove={remove} onSetArea={setArea} onSetRate={setRate} onHover={setHotId} />
          </div>
        ))}
      </div>
    </>
  );
}
