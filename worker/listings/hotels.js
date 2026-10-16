// Hotels in the hunt, added from a Google Maps / Apple Maps link or a Google
// Travel hotel link (the add box takes those besides Airbnb rooms). A maps
// link gives the hotel's name, street address and location
// (worker/lib/maplink.js) and Google's place data gives photos; a Google
// Travel page carries all of that itself. Either way it lands in the right
// area and on the map.
//
// Price: a hotel prices a room per night, for the trip's own dates. Google
// ignores plain date params; the dates go in its `ts` param (searchState
// below). Two pages, both read with those dates:
//   - the hotel's Google Travel prices page (/travel/hotels/entity/<id>/prices)
//     lists every provider's offer — ["Hotels.com",…,["$187","$216",…,187,216]],
//     the nightly rate before and after taxes and fees. We keep the cheapest
//     after taxes, and which provider has it. The page also says which dates
//     it's for, so a page for other dates is never trusted.
//   - when there's no offer to read, the travel search's label for the hotel:
//     "$109 for dates Nov 26 – 29, Hyatt House Denver/Downtown", Google's
//     average nightly rate before taxes. The search page also gives the
//     hotel's entity id for the prices page, kept on the rate for next time.
// Anyone can type the real rate instead (POST /api/hotel-rate). Stored as
// rate: { nightly, source: 'google' | 'manual', taxes?, base?, provider?, offers?,
//   entity?, dates?, checkIn?, checkOut?, at }.
import { j, uid } from '../lib/http.js';
import { tripOf } from '../config/trips.js';
import { geocode, locatePlace } from '../lib/maplink.js';
import { placePhotos } from '../food/photos.js';
import { cleanName } from '../users/users.js';
import { getState, updateState } from './state.js';
import { pickArea } from './zones.js';
import { closedError, votingOpen } from './decision.js';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_PAGE = 4e6; // Google's hotel pages run about 3 MB; give up after this

// Words that say nothing about which hotel it is.
const FILLER = new Set(['the', 'a', 'an', 'by', 'and', 'at', 'of', 'hotel']);
const words = s => new Set((String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => !FILLER.has(w)));
// Same hotel? Most of the words shared, both ways (Hyatt House vs Hyatt Place is not).
export function sameHotel(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return false;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both) >= 0.75;
}

const unescape = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
// One aria-label: "$79 for dates Nov 24 – 25, Hyatt House Denver/Downtown DEAL 23% less than usual"
export function readRateLabel(label) {
  const m = unescape(label).match(/^\$([\d,]+) for dates ([^,]+), (.+)$/);
  if (!m) return null;
  const nightly = Number(m[1].replace(/,/g, ''));
  if (!(nightly >= 20 && nightly <= 5000)) return null;
  // Google now puts thin spaces around the dash ("Nov 26\u2009–\u200929"): keep plain ones
  return { nightly, dates: m[2].replace(/\s+/g, ' ').trim(), hotel: m[3].replace(/\s+(?:(?:GREAT|GOOD)\s+)?DEAL\b.*$/, '').trim() };
}
// Every price label in a piece of the page, in order.
export function rateLabels(html) {
  const out = [];
  for (const m of html.matchAll(/aria-label="(\$[\d,]+ for dates [^"]+)"/g)) { const r = readRateLabel(m[1]); if (r) out.push(r); }
  return out;
}

// Google keeps the hotel search's dates in a base64 protobuf, the `ts` param:
// { 1: 1, 2: {}, 3: { 1: { 3: {} }, 2: { 2: { 1: checkIn, 2: checkOut, 3: nights }, 6: { 2: 0 } },
//   5: { 1: { 7: 'USD' } } } }, a date being { 1: year, 2: month, 3: day }.
const varint = n => { const out = []; while (n > 127) { out.push((n & 127) | 128); n >>>= 7; } out.push(n); return out; };
const pbInt = (f, n) => [...varint(f << 3), ...varint(n)];
const pbMsg = (f, bytes) => [...varint((f << 3) | 2), ...varint(bytes.length), ...bytes];
const pbDate = (f, iso) => { const [y, m, d] = iso.split('-').map(Number); return pbMsg(f, [...pbInt(1, y), ...pbInt(2, m), ...pbInt(3, d)]); };
export function searchState(checkIn, checkOut) {
  const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000);
  const usd = [...new TextEncoder().encode('USD')];
  const bytes = [...pbInt(1, 1), ...pbMsg(2, []), ...pbMsg(3, [
    ...pbMsg(1, pbMsg(3, [])),
    ...pbMsg(2, [...pbMsg(2, [...pbDate(1, checkIn), ...pbDate(2, checkOut), ...pbInt(3, nights)]), ...pbMsg(6, pbInt(2, 0))]),
    ...pbMsg(5, pbMsg(1, pbMsg(7, usd))),
  ])];
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A Google Travel hotel link -> the hotel's entity id.
const TRAVEL_ENTITY = /^https?:\/\/(?:www\.)?google\.[a-z.]+\/travel\/hotels\/entity\/([A-Za-z0-9_-]+)/i;
export const travelEntity = u => (String(u || '').trim().match(TRAVEL_ENTITY) || [])[1] || null;
const entityUrl = id => 'https://www.google.com/travel/hotels/entity/' + id;
const dated = (url, trip) => url + (url.includes('?') ? '&' : '?') + 'hl=en-US&gl=us&curr=USD'
  + (trip && trip.checkIn && trip.checkOut ? '&ts=' + searchState(trip.checkIn, trip.checkOut) : '');

// A Google page as text. They're large (3 MB); stop reading after MAX_PAGE.
async function fetchPage(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    if (!r.ok || !r.body) return null;
    const reader = r.body.getReader(), dec = new TextDecoder();
    let out = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
      if (out.length > MAX_PAGE) { reader.cancel().catch(() => {}); break; }
    }
    return out;
  } catch (e) { return null; }
  finally { clearTimeout(t); }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// '2026-11-26', '2026-11-29' -> 'Nov 26 – 29' (as Google writes it; 'Nov 30 – Dec 2' across months)
export function stayLabel(checkIn, checkOut) {
  const [, m1, d1] = checkIn.split('-').map(Number), [, m2, d2] = checkOut.split('-').map(Number);
  return MONTHS[m1 - 1] + ' ' + d1 + ' – ' + (m1 === m2 ? '' : MONTHS[m2 - 1] + ' ') + d2;
}

// The cheapest offer on a prices page, by the nightly rate after taxes and
// fees. null unless the page is for the trip's dates and has offers.
export function bestOffer(html, trip) {
  if (!html || !html.includes('["' + trip.checkIn + '","' + trip.checkOut + '"')) return null;
  const best = new Map();
  for (const m of html.matchAll(/\["([^"]{1,40})",\d{6,},"\/travel\/lodging\/clk\?pc/g)) {
    const pb = html.slice(m.index, m.index + 2600).match(/\["\$[\d,]+","\$[\d,]+",[\d.]+,[\d.]+,(\d+),(\d+)\]/);
    if (!pb) continue;
    const o = { provider: m[1], base: +pb[1], nightly: +pb[2] };
    if (!(o.nightly >= 20 && o.nightly <= 5000)) continue;
    if (!best.has(o.provider) || o.nightly < best.get(o.provider).nightly) best.set(o.provider, o);
  }
  if (!best.size) return null;
  const list = [...best.values()].sort((a, b) => a.nightly - b.nightly);
  return { ...list[0], offers: list.length };
}

// The hotel a Google Travel page is about: name, street address, coordinates, photos.
export function readHotelPage(html) {
  const m = String(html || '').match(/key: 'ds:1', hash: '\d+', data:\[\[null,"((?:[^"\\]|\\.)+)",\[\[(-?[\d.]+),(-?[\d.]+)\],\[\[\["((?:[^"\\]|\\.)*)"/);
  const title = m ? m[1] : ((String(html || '').match(/<title>([^<]+?)\s*-\s*Google [Hh]otels<\/title>/) || [])[1] || '');
  // the hotel's own gallery: photos in its data block (ds:1), not the nearby hotels further down
  const at = String(html || '').indexOf("key: 'ds:1'"), block = at < 0 ? '' : html.slice(at, html.indexOf('</script>', at));
  const photos = [...new Set([...block.matchAll(/https:\/\/lh3\.googleusercontent\.com\/(?:hrppk|p)\/[A-Za-z0-9_-]+/g)].map(x => x[0]))].slice(0, 8).map(u => u + '=w1000');
  return {
    name: unescape(title).trim(), address: m ? unescape(m[4]).trim() : '',
    ...(m && isFinite(+m[2]) && isFinite(+m[3]) ? { lat: +m[2], lng: +m[3] } : {}), photos,
  };
}

// The entity id of the hotel named `name` on a travel search page:
// its card's link reads aria-label="Open <name> in a new tab." … href="/travel/hotels/entity/<id>".
export function entityOn(html, name) {
  for (const m of String(html || '').matchAll(/aria-label="Open ([^"]{1,150}) in a new tab\."[\s\S]{0,600}?href="\/travel\/hotels\/entity\/([A-Za-z0-9_-]+)/g)) {
    if (sameHotel(unescape(m[1]), name)) return m[2];
  }
  return null;
}

const offerRate = (o, trip, entity) => ({
  nightly: o.nightly, taxes: true, base: o.base, provider: o.provider, offers: o.offers, entity, source: 'google',
  dates: stayLabel(trip.checkIn, trip.checkOut), checkIn: trip.checkIn, checkOut: trip.checkOut, at: Date.now(),
});

// Google's nightly rate for this hotel over the trip's dates, or null: the
// cheapest offer after taxes when the prices page has one, else the search
// label's average before taxes. `entity` (when known) skips the search.
export async function googleRate(name, address, trip, entity) {
  if (!trip || !trip.checkIn || !trip.checkOut) return null;
  let hit = null;
  if (!entity) {
    const html = await fetchPage(dated('https://www.google.com/travel/search?q=' + encodeURIComponent([name, address].filter(Boolean).join(', ')), trip));
    hit = rateLabels(html || '').find(x => sameHotel(x.hotel, name)) || null;
    entity = entityOn(html, name);
  }
  if (entity) {
    const o = bestOffer(await fetchPage(dated(entityUrl(entity) + '/prices', trip)), trip);
    if (o) return offerRate(o, trip, entity);
  }
  if (!hit) return null;
  return { nightly: hit.nightly, dates: hit.dates, ...(entity ? { entity } : {}), source: 'google', checkIn: trip.checkIn, checkOut: trip.checkOut, at: Date.now() };
}

// A Google Travel hotel link -> the same shape locatePlace gives for a maps
// link, plus photos and the trip-dated rate read off the same page.
async function locateTravelHotel(entity, trip) {
  const html = await fetchPage(dated(entityUrl(entity) + '/prices', trip));
  const h = readHotelPage(html);
  if (!h.name) return { ok: false };
  if (h.lat == null && h.address) Object.assign(h, (await geocode(h.address)) || {});
  const o = bestOffer(html, trip);
  return { ok: true, ...h, placeId: 'g:' + entity, url: entityUrl(entity), rate: o ? offerRate(o, trip, entity) : null };
}

// A hotel's identity: Google's place id when the link has one, else name + rounded spot,
// so the same hotel shared through different links lands on one card.
function hotelId(p) {
  if (p.placeId) return p.placeId.startsWith('g:') ? p.placeId : 'map:' + p.placeId;
  const raw = p.name.toLowerCase() + '|' + (p.lat != null ? p.lat.toFixed(4) + ',' + p.lng.toFixed(4) : p.url);
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) >>> 0;
  return 'map:' + h.toString(36);
}
const nightlyOf = v => { const n = Math.round(Number(v)); return n >= 1 && n <= 20000 ? n : null; };

// POST /api/add with a maps link lands here (routes.js).
export async function addHotel(body, env) {
  const trip = tripOf(body.trip);
  if (!votingOpen(trip)) return closedError();
  // Slow work (link, lookups, Google) before reading the list, like Airbnb adds.
  const entity = travelEntity(body.url);
  const p = entity ? await locateTravelHotel(entity, trip) : await locatePlace(body.url, trip.zones);
  if (!p.ok) return j({ ok: false, error: entity ? 'Google 暂时读不出这家酒店，稍后再试一次' : '读不出这个地图链接是哪家。在地图里打开那家酒店，点「分享」复制链接再试' });
  const roomId = hotelId(p);
  const pre = await getState(env, trip);
  const preExisting = pre.listings.find(l => l.roomId === roomId);
  if (preExisting) return j({ ok: true, listing: preExisting, deduped: true });
  const typed = nightlyOf(body.nightly);
  const [rate, images, zone] = await Promise.all([
    typed ? { nightly: typed, source: 'manual', at: Date.now() } : p.rate || googleRate(p.name, p.address, trip),
    p.photos && p.photos.length ? p.photos : placePhotos(p.url).catch(() => []),
    pickArea(trip, pre.listings, p),
  ]);
  const listing = {
    id: uid(), roomId, kind: 'hotel', url: p.url, title: p.name, address: p.address,
    ...(p.lat != null ? { lat: p.lat, lng: p.lng } : {}),
    image: images[0] || '', images, area: zone.area || '', priceUSD: null, rate: rate || null,
    rating: null, reviews: null, note: '', addedBy: cleanName(body.addedBy), createdAt: Date.now(), votes: [],
  };
  const out = await updateState(env, trip, state => {
    const existing = state.listings.find(l => l.roomId === roomId);
    if (existing) return { deduped: true, listing: existing };
    state.listings.unshift(listing);
    return { listing };
  });
  return j({ ok: true, listing: out.listing, ...(out.deduped ? { deduped: true } : {}) });
}

// Type in a hotel's real nightly rate (or clear it with an empty value).
async function handleRate(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const trip = tripOf(body.trip);
  if (!votingOpen(trip)) return closedError();
  const nightly = nightlyOf(body.nightly);
  if (body.nightly !== '' && body.nightly != null && !nightly) return j({ ok: false, error: '价格要是 1 到 20000 之间的数字' });
  const out = await updateState(env, trip, state => {
    const l = state.listings.find(x => x.id === body.id);
    if (!l || l.kind !== 'hotel') return { error: '酒店不存在' };
    l.rate = nightly ? { nightly, source: 'manual', by: cleanName(body.name), at: Date.now() } : null;
    return { listing: l };
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j({ ok: true, listing: out.listing });
}

// Google rates for the trip's dates: hotels with no rate, a rate for other dates
// (older adds got whatever night Google picked), or one older than a day.
// Typed-in rates are left alone. Called from /api/prices (prices.js), which
// writes the results back; returns { [listing id]: rate }.
const RATE_TTL_MS = 24 * 60 * 60 * 1000;
export const rateFresh = (l, trip) => !!(l.rate && (l.rate.source === 'manual'
  || (l.rate.checkIn === trip.checkIn && l.rate.checkOut === trip.checkOut && l.rate.at > Date.now() - RATE_TTL_MS)));
export async function refreshHotelRates(listings, trip, { id, force } = {}) {
  const todo = listings.filter(l => l.kind === 'hotel' && (id ? l.id === id : true) && (force ? l.rate?.source !== 'manual' : !rateFresh(l, trip))
    && !(l.rateTriedAt > Date.now() - 6 * 60 * 60 * 1000 && !force)).slice(0, 4);
  const out = {};
  await Promise.all(todo.map(async l => { out[l.id] = await googleRate(l.title, l.address, trip, l.rate?.entity || travelEntity(l.url)); }));
  return out; // null for a hotel Google had no price for (so it isn't retried for a while)
}

export const routes = {
  'POST /api/hotel-rate': handleRate,
};
