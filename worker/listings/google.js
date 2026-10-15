// Hotels pulled from Google Hotels (google.com/travel). Unlike
// Booking.com, Google serves its hotel pages to plain server fetches,
// and each page embeds dated offer records from many providers
// (official site, Booking, Expedia, Trip.com…). The catch: the dates
// ride in an opaque `ts` parameter that Google only accepts when it
// was assembled by a real browser session — hand-patched copies are
// ignored and the page falls back to default dates. So each trip
// carries a captured `googleTs` (config/trips.js), and every parse
// here VALIDATES that the returned offers are dated for the trip
// before trusting a single price.
import { j, uid } from '../lib/http.js';
import { tripOf } from '../config/trips.js';
import { getState, updateState } from './state.js';
import { pickArea } from './zones.js';
import { closedError, votingOpen } from './decision.js';
import { cleanName } from '../users/users.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
export const entityPage = id => 'https://www.google.com/travel/hotels/entity/' + id;
const pricesPage = (id, trip) => entityPage(id) + '/prices?hl=en&ts=' + trip.googleTs;

async function fetchText(url, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    return r.ok ? await r.text() : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

// A pasted Google Travel hotel link → its entity id.
export function googleEntityFrom(url) {
  const m = String(url || '').match(/google\.[a-z.]+\/travel\/hotels\/entity\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

// Lowest dated offer on a hotel's /prices page. Offer records look like
//   ["Traveluro",1073209370,"/travel/lodging/clk?pc=…", …,
//    ["$89","$103",88.97,102.98,89,103], …]
// (nightly, total incl. taxes/fees). Returns null unless the page is
// verifiably dated for the trip AND carries parseable offers.
export function parseGoogleOffers(html, trip) {
  if (!html || !html.includes(`["${trip.checkIn}","${trip.checkOut}"`)) return null;
  const best = new Map();
  for (const m of html.matchAll(/\["([^"]{1,40})",\d{6,},"\/travel\/lodging\/clk\?pc/g)) {
    const seg = html.slice(m.index, m.index + 2600);
    const pb = seg.match(/\["\$(\d[\d,]*)","\$(\d[\d,]*)",([\d.]+),([\d.]+),(\d+),(\d+)\]/);
    if (!pb) continue;
    const o = { provider: m[1], nightly: +pb[5], total: +pb[6] };
    if (!best.has(o.provider) || o.nightly < best.get(o.provider).nightly) best.set(o.provider, o);
  }
  if (!best.size) return null;
  const list = [...best.values()].sort((a, b) => a.nightly - b.nightly || a.total - b.total);
  return { nightly: list[0].nightly, total: list[0].total, provider: list[0].provider, offers: list.length };
}

// Title + gallery photos from a hotel page's HTML.
export function parseGoogleInfo(html) {
  const title = (html.match(/<title>([^<]+?)\s*-\s*Google [Hh]otels<\/title>/) || [])[1] || '';
  const seen = new Set(), photos = [];
  for (const m of html.matchAll(/https:\/\/lh3\.googleusercontent\.com\/p\/[A-Za-z0-9_-]+/g)) {
    if (!seen.has(m[0])) { seen.add(m[0]); photos.push(m[0]); if (photos.length >= 5) break; }
  }
  return { title: title.trim(), photos };
}

// Google rating (out of 5, shown ×2 to sit on the same /10 scale as the
// Booking numbers) from a travel search page's card labels:
// "4.3 out of 5 stars from 1,942 reviews, <Hotel Name>".
export function parseGoogleRating(searchHtml, title) {
  if (!searchHtml || !title) return null;
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = searchHtml.match(new RegExp('([\\d.]+) out of 5 stars from ([\\d,]+) reviews, ' + esc));
  if (!m) return null;
  return { rating: Math.round(parseFloat(m[1]) * 2 * 10) / 10, reviews: parseInt(m[2].replace(/,/g, ''), 10) };
}

const searchPage = (q, trip) => 'https://www.google.com/travel/search?q=' + encodeURIComponent(q) + '&hl=en&ts=' + trip.googleTs;

// A hotel name → its entity id, via the search page's card links.
async function resolveEntityByName(name, trip) {
  const html = await fetchText(searchPage(name, trip));
  if (!html) return null;
  const lower = name.toLowerCase();
  for (const m of html.matchAll(/aria-label="([^"]*)"[^>]*href="\/travel\/hotels\/entity\/([A-Za-z0-9_-]+)"/g)) {
    if (m[1].toLowerCase().includes(lower)) return { entity: m[2], searchHtml: html };
  }
  return null;
}

// Name hint from a pasted Google link without an entity id: a search
// link's q=, or a Maps place segment (short links are followed first).
async function nameFromGoogleUrl(url) {
  let u = String(url || '');
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(u)) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(u, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
      u = r.url || u;
      await r.text().catch(() => '');
    } catch (e) { /* keep the original */ } finally { clearTimeout(t); }
  }
  const place = u.match(/\/maps\/place\/([^/]+)/);
  if (place) return decodeURIComponent(place[1].replace(/\+/g, ' ')).trim();
  try {
    const q = new URL(u).searchParams.get('q');
    if (q && !/hotels?\s*(in|near)?\s*$/i.test(q.trim()) && !/^(denver|hotels?)$/i.test(q.trim())) return q.trim();
  } catch (e) { /* not a URL */ }
  return null;
}

async function geocode(name) {
  for (const q of [name, name + ', Colorado']) {
    const html = await fetchText('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), 8000);
    try {
      const d = JSON.parse(html || '[]');
      if (d[0]) return { lat: Number(d[0].lat), lng: Number(d[0].lon) };
    } catch (e) { /* try the next form */ }
  }
  return null;
}

// The Google price for one hotel for the trip's dates, or null.
// Shape mirrors what PriceBlock needs; `total` is per room (2 guests)
// for the whole stay, taxes/fees included, from the cheapest provider.
export async function fetchGooglePrice(entityId, trip) {
  if (!entityId || !trip.googleTs) return null;
  const html = await fetchText(pricesPage(entityId, trip));
  const o = parseGoogleOffers(html, trip);
  if (!o) return null;
  const nights = Math.round((Date.parse(trip.checkOut) - Date.parse(trip.checkIn)) / 86400000);
  return { ...o, nights, checkIn: trip.checkIn, checkOut: trip.checkOut, at: Date.now() };
}

async function handleAddGoogle(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const url = String(body.url || '').trim().slice(0, 1000);
  const trip = tripOf(body.trip);
  if (!votingOpen(trip)) return closedError();
  let entity = googleEntityFrom(url);
  let searchHtml = null;
  if (!entity) {
    const name = await nameFromGoogleUrl(url);
    const found = name ? await resolveEntityByName(name, trip) : null;
    if (!found) return j({ ok: false, error: '没认出这是哪家酒店 — 请贴 Google 酒店页的链接（在 Google 地图/旅行里打开酒店，复制链接）' });
    entity = found.entity;
    searchHtml = found.searchHtml;
  }
  const roomId = 'g:' + entity;
  // Pull the hotel page (title, photos, dated offers) — one fetch.
  const html = await fetchText(pricesPage(entity, trip));
  const info = html ? parseGoogleInfo(html) : { title: '', photos: [] };
  const offers = html ? parseGoogleOffers(html, trip) : null;
  if (!info.title && !offers) return j({ ok: false, error: 'Google 暂时拉不到这家酒店的信息，稍后再试一次' });
  const title = info.title || 'Google 酒店';
  // Rating (from the search card) and coordinates, in parallel.
  const [rating, coords] = await Promise.all([
    (async () => parseGoogleRating(searchHtml || await fetchText(searchPage(title, trip)), title))(),
    geocode(title),
  ]);
  const nights = Math.round((Date.parse(trip.checkOut) - Date.parse(trip.checkIn)) / 86400000);
  const gPrice = offers ? { ...offers, nights, checkIn: trip.checkIn, checkOut: trip.checkOut, at: Date.now() } : null;
  let area = '';
  if (coords) {
    const pre = await getState(env, trip);
    area = (await pickArea(trip, pre.listings, coords)).area || '';
  }
  const out = await updateState(env, trip, state => {
    const existing = state.listings.find(l => l.roomId === roomId);
    if (existing) {
      // A re-paste is a re-pull: refresh data, keep id + votes.
      if (info.title) existing.title = info.title;
      if (info.photos.length) { existing.images = info.photos; existing.image = info.photos[0]; }
      if (rating) { existing.rating = rating.rating; existing.reviews = rating.reviews; }
      if (gPrice) {
        existing.gPrice = gPrice;
        existing.priceUSD = gPrice.total; existing.priceNights = gPrice.nights; existing.priceAt = gPrice.at;
      }
      if (coords && existing.lat == null) { existing.lat = coords.lat; existing.lng = coords.lng; }
      if (area && !existing.area) existing.area = area;
      return { listing: existing, updated: true };
    }
    const listing = {
      id: uid(), roomId, kind: 'hotel', source: 'google', url: entityPage(entity),
      title, image: info.photos[0] || '', images: info.photos, area,
      ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
      rating: rating ? rating.rating : null, reviews: rating ? rating.reviews : null,
      priceUSD: gPrice ? gPrice.total : null, priceNights: gPrice ? gPrice.nights : null,
      priceAt: gPrice ? gPrice.at : null, gPrice,
      sleeps: null, bedrooms: null, beds: null, bathrooms: null, note: '',
      addedBy: cleanName(body.addedBy), createdAt: Date.now(), votes: [],
    };
    state.listings.unshift(listing);
    return { listing };
  });
  return j({ ok: true, listing: out.listing, ...(out.updated ? { updated: true } : {}) });
}

export const routes = { 'POST /api/add-google': handleAddGoogle };
