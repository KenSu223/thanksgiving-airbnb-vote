import { j } from '../lib/http.js';
import { tripOf } from '../config/trips.js';
import { SCRAPE_UA } from './scrape.js';
import { getState, updateState } from './state.js';
import { refreshHotelRates } from './hotels.js';

// ---------- live prices ----------
// Airbnb's listing page fetches its price box from this persisted GraphQL
// query; we call it the same way. If Airbnb rotates the hash or key, price
// lookups fail soft (the last known price stays, marked with its age).
const AIRBNB_API_KEY = 'd306zoyjsyarp7ifhu67rjxn52tv0t20';
const BOOKIT_HASH = '8c9165db910115bff8003e61f847ed907c9c51509ba043fa0610853d7c4de080';
const PRICE_TTL_MS = 6 * 60 * 60 * 1000;

async function queryBookIt(roomId, checkIn, checkOut, adults) {
  const variables = {
    id: btoa('DemandStayListing:' + roomId),
    dateRange: { startDate: checkIn, endDate: checkOut },
    guestCounts: { numberOfAdults: adults },
    includePdpMigrationBookItCalendarSheetFragment: false, includePdpMigrationBookItFloatingFooterFragment: false,
    includePdpMigrationBookItNavFragment: false, includePdpMigrationBookItSidebarFragment: true,
    includeGalleryBookItCtaFragment: false, includeOverviewMerchandisingTipsFragment: false,
    includeStaysPdpPriceHeatmapFragment: false, priceHeatmapDateRange: { startDate: checkIn, endDate: checkOut },
    p3ImpressionId: 'p3_0_vote', selectedCancellationPolicyId: null, causeId: null, selectedGuestOptionId: null,
  };
  const url = 'https://www.airbnb.com/api/v3/StaysPdpBookItQuery/' + BOOKIT_HASH
    + '?operationName=StaysPdpBookItQuery&locale=en&currency=USD'
    + '&variables=' + encodeURIComponent(JSON.stringify(variables))
    + '&extensions=' + encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: BOOKIT_HASH } }));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: {
      'X-Airbnb-API-Key': AIRBNB_API_KEY, 'User-Agent': SCRAPE_UA, 'Accept-Language': 'en-US,en;q=0.9', 'Content-Type': 'application/json' } });
    if (!r.ok) return null;
    const bookIt = (await r.json())?.data?.node?.pdpPresentation?.bookIt;
    if (!bookIt) return null;
    const line = bookIt.structuredDisplayPrice?.primaryLine;
    const money = s => { const m = String(s || '').replace(/,/g, '').match(/\$(\d+(?:\.\d+)?)/); return m ? Math.round(Number(m[1])) : null; };
    return {
      available: bookIt.availability?.isAvailable === true,
      reason: bookIt.availability?.unavailabilityReason || null,
      total: line ? money(line.discountedPrice || line.price) : null,
      original: line ? money(line.originalPrice) : null,
    };
  } catch (e) { return null; }
  finally { clearTimeout(t); }
}

// Price for the trip's dates and head count. When the group is bigger than
// the listing allows, price it at the listing's max so there's still a number.
async function fetchLivePrice(listing, trip) {
  // only Airbnb rooms (numeric ids) have Airbnb quotes; hotels (map:…, and the older bk:…) don't
  if (!/^\d+$/.test(String(listing.roomId || '')) || !trip.checkIn) return null;
  const nights = Math.round((Date.parse(trip.checkOut) - Date.parse(trip.checkIn)) / 86400000);
  let guests = trip.people;
  let r = await queryBookIt(listing.roomId, trip.checkIn, trip.checkOut, guests);
  if (r && r.reason === 'GUEST' && listing.sleeps && listing.sleeps < guests) {
    guests = listing.sleeps;
    r = await queryBookIt(listing.roomId, trip.checkIn, trip.checkOut, guests);
  }
  if (!r) return null;
  return { ...r, guests, nights, checkIn: trip.checkIn, checkOut: trip.checkOut, at: Date.now() };
}

// Refresh live prices for a trip's listings that are stale (or for one id):
// Airbnb quotes, and hotels' Google rates for the trip's dates (hotels.js).
// Lookups run first; then fresh state is re-read and only the `live`
// field is written, so concurrent votes/adds aren't clobbered.
export async function handlePrices(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const trip = tripOf(body.trip, env);
  const peek = await getState(env, trip);
  const fresh = l => l.live && l.live.at > Date.now() - PRICE_TTL_MS && l.live.checkIn === trip.checkIn && l.live.checkOut === trip.checkOut;
  const todo = peek.listings.filter(l => /^\d+$/.test(String(l.roomId || '')) && (body.id ? l.id === body.id : true) && (body.force || !fresh(l))).slice(0, 12);
  const results = {};
  const [rates] = await Promise.all([
    refreshHotelRates(peek.listings, trip, body),
    (async () => {
      for (let i = 0; i < todo.length; i += 4) { // a few at a time, to be gentle with Airbnb
        await Promise.all(todo.slice(i, i + 4).map(async l => { const p = await fetchLivePrice(l, trip); if (p) results[l.id] = p; }));
      }
    })(),
  ]);
  // Apply the fetched prices onto the freshest state in a transaction —
  // only the price fields are written, so concurrent votes/adds survive.
  // A rate someone typed in meanwhile wins over Google's.
  const now = Date.now();
  const { live, rate } = await updateState(env, trip, state => {
    for (const l of state.listings) {
      if (results[l.id]) l.live = results[l.id];
      if (l.id in rates) {
        l.rateTriedAt = now;
        if (rates[l.id] && l.rate?.source !== 'manual') l.rate = rates[l.id];
      }
    }
    return {
      live: Object.fromEntries(state.listings.filter(l => l.live).map(l => [l.id, l.live])),
      rate: Object.fromEntries(state.listings.filter(l => l.kind === 'hotel').map(l => [l.id, l.rate || null])),
    };
  });
  const updated = Object.keys(results).length + Object.values(rates).filter(Boolean).length;
  return j({ ok: true, updated, tried: todo.length + Object.keys(rates).length, live, rate });
}
