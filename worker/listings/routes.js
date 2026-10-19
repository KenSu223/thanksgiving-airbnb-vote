// Listing routes: the trip's shortlist, adding (scraped or manual; Airbnb
// rooms, or hotels from a maps link — hotels.js), voting, removing, and
// filling in details the first scrape missed.
import { j, uid } from '../lib/http.js';
import { tripOf } from '../config/trips.js';
import { isMapLink } from '../lib/maplink.js';
import { fetchListingInfo, roomIdFrom } from './scrape.js';
import { getState, updateState } from './state.js';
import { handlePrices } from './prices.js';
import { addHotel, travelEntity, routes as hotelRoutes } from './hotels.js';
import { needsArea, pickArea, routes as zoneRoutes } from './zones.js';
import { closedError, voteView, votingOpen, routes as decisionRoutes } from './decision.js';
import { cleanName, getUsers } from '../users/users.js';
import { dedupeVotes, isVoteBy } from '../lib/votes.js';
import { getSplit } from '../split/store.js';
import { splitView } from '../split/ledger.js';

async function handleAdd(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const url = String(body.url || '').trim();
  if (isMapLink(url) || travelEntity(url)) return addHotel({ ...body, url }, env); // a hotel from a Google / Apple Maps or Google Travel link
  const roomId = roomIdFrom(url);
  if (!roomId) return j({ ok: false, error: '看起来不是 Airbnb 房源或地图链接（要 airbnb.com/rooms/123…，或者酒店在 Google 地图 / Google 酒店里的链接）' });
  const trip = tripOf(body.trip, env);
  if (!votingOpen(trip)) return closedError();
  // Fast-path dedupe check only — do NOT hold this snapshot across the scrape.
  const preState = await getState(env, trip);
  const preExisting = preState.listings.find(l => l.roomId === roomId);
  if (preExisting) return j({ ok: true, listing: preExisting, deduped: true });
  // Scrape first, read state after. Scraping can take up to ~35s
  // (10s direct + 10s .co.uk + 15s reader); holding a pre-scrape snapshot
  // and saving it afterwards would clobber any votes / adds / removes
  // that happened in that window (lost-update bug).
  const info = await fetchListingInfo(url);
  // Pick its area (may look up the town name) before re-reading state, for the same reason.
  const { area } = await pickArea(trip, preState.listings, { lat: info.lat, lng: info.lng });
  // Apply onto the freshest state inside a store transaction, and
  // re-check dedupe there: another request may have added this same
  // room meanwhile (the transaction re-runs this if a write lands
  // between our read and commit, so the check is authoritative).
  const listing = {
    id: uid(), roomId, url,
    title: (info.title || '').slice(0, 120) || '未命名房源',
    image: info.image || '', images: info.images || [], area: area || '', priceUSD: null,
    ...('lat' in info ? { lat: info.lat, lng: info.lng } : {}),
    sleeps: info.guests || null, bedrooms: info.bedrooms, beds: info.beds, bathrooms: info.bathrooms,
    rating: info.rating || null, reviews: info.reviews || null, note: '', addedBy: cleanName(body.addedBy), createdAt: Date.now(), votes: []
  };
  const out = await updateState(env, trip, state => {
    const existing = state.listings.find(l => l.roomId === roomId);
    if (existing) return { deduped: true, listing: existing };
    state.listings.unshift(listing);
    return { listing };
  });
  if (out.deduped) return j({ ok: true, listing: out.listing, deduped: true });
  return j({ ok: true, listing: out.listing, fetched: info.ok });
}

async function handleAddManual(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const url = String(body.url || '').trim();
  const title = String(body.title || '').trim().slice(0, 120);
  const roomId = roomIdFrom(url);
  if (!roomId || !title) return j({ ok: false, error: '链接和标题是必填的' });
  const trip = tripOf(body.trip, env);
  if (!votingOpen(trip)) return closedError();
  const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? null : Number(v);
  const listing = { id: uid(), roomId, url, title,
    image: String(body.image || '').trim().slice(0, 500), area: String(body.area || '').slice(0, 40),
    priceUSD: num(body.priceUSD), priceNights: num(body.priceNights), sleeps: num(body.sleeps), bedrooms: num(body.bedrooms),
    beds: num(body.beds), bathrooms: num(body.bathrooms),
    rating: null, reviews: null, note: String(body.note || '').slice(0, 200),
    addedBy: cleanName(body.addedBy), createdAt: Date.now(), votes: [] };
  const out = await updateState(env, trip, state => {
    if (state.listings.find(l => l.roomId === roomId)) return { error: '这间已经在清单里了' };
    state.listings.unshift(listing);
    return { listing };
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j({ ok: true, listing: out.listing });
}

async function handleVote(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const { id, token, name } = body;
  if (!id || !token) return j({ ok: false, error: '缺少参数' });
  const trip = tripOf(body.trip, env);
  if (!votingOpen(trip)) return closedError();
  // The voter is the account: resolve its name from the token as well, so
  // an unvote (no name sent) still finds votes left under an older token.
  const me = (await getUsers(env).catch(() => [])).find(u => u.token === token);
  const voterName = name || (me && me.name) || null;
  const out = await updateState(env, trip, state => {
    const listing = state.listings.find(l => l.id === id);
    if (!listing) return { error: '房源不存在' };
    listing.votes = dedupeVotes((listing.votes || []).filter(v => !isVoteBy(v, token, voterName)));
    let voted = false;
    if (name) {
      listing.votes.push({ token: String(token).slice(0, 80), name: String(name).slice(0, 20), at: Date.now() });
      voted = true;
    }
    return { votes: listing.votes, voted };
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j({ ok: true, votes: out.votes, voted: out.voted });
}

async function handleRemove(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const trip = tripOf(body.trip, env);
  if (!votingOpen(trip)) return closedError();
  const out = await updateState(env, trip, state => {
    const i = state.listings.findIndex(l => l.id === body.id);
    if (i < 0) return { error: '房源不存在' };
    state.listings.splice(i, 1);
    return {};
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j({ ok: true });
}

async function handleEnrich(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const trip = tripOf(body.trip, env);
  // Peek only to get the URL to scrape — do NOT hold this snapshot
  // across the scrape (see handleAdd: it can take up to ~35s, and
  // saving a stale snapshot would clobber concurrent changes).
  const peekState = await getState(env, trip);
  const peek = peekState.listings.find(l => l.id === body.id);
  if (!peek || peek.kind === 'hotel') return j({ ok: false }); // hotels aren't Airbnb rooms: nothing to scrape
  const info = await fetchListingInfo(peek.url);
  if (!info.ok) return j({ ok: false });
  const located = { ...peek, lat: peek.lat ?? info.lat, lng: peek.lng ?? info.lng };
  const { area } = needsArea(located) ? await pickArea(trip, peekState.listings, located) : { area: null };
  // Merge onto the live listing inside a transaction, after scraping.
  // If it was removed while we were scraping, don't resurrect it.
  const out = await updateState(env, trip, state => {
    const listing = state.listings.find(l => l.id === body.id);
    if (!listing) return { gone: true };
    if ((!listing.title || listing.title === '未命名房源') && info.title) listing.title = info.title.slice(0, 120);
    if (!listing.image && info.image) listing.image = info.image;
    if ((info.images || []).length > (listing.images || []).length) listing.images = info.images;
    if ('lat' in info && listing.lat == null) { listing.lat = info.lat; listing.lng = info.lng; }
    if (area && !listing.area && !listing.areaManual) listing.area = area;
    if (listing.bedrooms == null && info.bedrooms != null) listing.bedrooms = info.bedrooms;
    if (listing.bathrooms == null && info.bathrooms != null) listing.bathrooms = info.bathrooms;
    if (listing.beds == null && info.beds != null) listing.beds = info.beds;
    if (listing.sleeps == null && info.guests != null) listing.sleeps = info.guests;
    if (listing.rating == null && info.rating != null) listing.rating = info.rating;
    if (listing.reviews == null && info.reviews != null) listing.reviews = info.reviews;
    return { listing };
  });
  if (out.gone) return j({ ok: false });
  return j({ ok: true, listing: out.listing });
}

// The trip's listings plus the whole group's ledger. members/expenses
// inside trip state are pre-merge leftovers, kept in KV but not served.
async function handleState(req, env, url) {
  const trip = tripOf(url.searchParams.get('trip'), env);
  const { members, expenses, decision, booking, ...state } = await getState(env, trip);
  state.listings = (state.listings || []).map(l => ({ ...l, votes: dedupeVotes(l.votes) }));
  return j({ ...state, vote: voteView({ ...state, decision, booking }, trip), ...splitView(await getSplit(env)) });
}

export const routes = {
  'GET /api/state': handleState,
  'POST /api/add': handleAdd,
  'POST /api/add-manual': handleAddManual,
  'POST /api/vote': handleVote,
  'POST /api/remove': handleRemove,
  'POST /api/enrich': handleEnrich,
  'POST /api/prices': handlePrices,
  ...hotelRoutes,
  ...zoneRoutes,
  ...decisionRoutes,
};
