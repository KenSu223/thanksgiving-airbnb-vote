// Areas (zones) for listings: which tab a listing shows up under. A listing
// without an area gets one automatically from its location:
//   1. a configured zone of the trip it falls inside (the smallest, if several);
//   2. else the area of the nearest listing within NEIGHBOR_KM;
//   3. else its town name from OpenStreetMap, which makes a new tab.
// Areas people set by hand (areaManual) are never changed.
import { j } from '../lib/http.js';
import { tripOf } from '../config/trips.js';
import { getState, updateState } from './state.js';

const NEIGHBOR_KM = 25;
const MAX_PER_CALL = 8;
// Nominatim's usage policy: identify the app, at most one request a second.
const GEO_UA = 'thanksgiving-airbnb-vote/1.0 (https://github.com/KenSu223/thanksgiving-airbnb-vote)';

export function km(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180;
  const h = Math.sin((bLat - aLat) * r / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin((bLng - aLng) * r / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const hasGeo = l => l.lat != null && l.lng != null;
export const needsArea = l => !l.area && !l.areaManual && hasGeo(l);

function configuredZone(trip, l) {
  const inside = (trip.zones || []).filter(z => km(l.lat, l.lng, z.lat, z.lng) <= z.km);
  inside.sort((a, b) => a.km - b.km);
  return inside.length ? inside[0].name : null;
}

function neighborArea(listings, l) {
  let best = null, bestKm = NEIGHBOR_KM;
  for (const o of listings) {
    if (o.id === l.id || !o.area || !hasGeo(o)) continue;
    const d = km(l.lat, l.lng, o.lat, o.lng);
    if (d <= bestKm) { best = o.area; bestKm = d; }
  }
  return best;
}

// Town name for a point, '' if OpenStreetMap has none, null if the lookup failed.
async function townName(lat, lng) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=' + lat + '&lon=' + lng,
      { signal: ctrl.signal, headers: { 'User-Agent': GEO_UA } });
    if (!r.ok) return null;
    const a = (await r.json()).address || {};
    return String(a.city || a.town || a.village || a.hamlet || a.county || '').replace(/ County$/, '').slice(0, 30);
  } catch (e) { return null; }
  finally { clearTimeout(t); }
}

// The area for one listing; null when it can't be decided yet (no location,
// or the town lookup failed), so a later call tries again.
// Returns { area, geocoded } so callers can pace town lookups.
export async function pickArea(trip, listings, l) {
  if (!hasGeo(l)) return { area: null, geocoded: false };
  const zone = configuredZone(trip, l) || neighborArea(listings, l);
  if (zone) return { area: zone, geocoded: false };
  const town = await townName(l.lat, l.lng);
  return { area: town === null ? null : town || '其他', geocoded: true };
}

// Fill in areas for the trip's listings that have a location but no area.
// Lookups first, then fresh state is re-read and only `area` is written, so
// concurrent votes/adds aren't clobbered.
async function handleZones(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const trip = tripOf(body.trip, env);
  const peek = await getState(env, trip);
  const known = peek.listings.map(l => ({ ...l })); // assignments made below count as neighbors for the next ones
  const found = {};
  let lastGeo = 0;
  for (const l of known.filter(needsArea).slice(0, MAX_PER_CALL)) {
    const wait = lastGeo + 1100 - Date.now();
    if (wait > 0 && !configuredZone(trip, l) && !neighborArea(known, l)) await new Promise(r => setTimeout(r, wait));
    const { area, geocoded } = await pickArea(trip, known, l);
    if (geocoded) lastGeo = Date.now();
    if (area) { l.area = area; found[l.id] = area; }
  }
  const areas = await updateState(env, trip, state => {
    for (const l of state.listings) if (found[l.id] && !l.area && !l.areaManual) l.area = found[l.id];
    return Object.fromEntries(state.listings.map(l => [l.id, l.area || '']));
  });
  return j({ ok: true, areas });
}

// Set (or clear) a listing's area by hand. It won't be auto-assigned after that.
async function handleSetArea(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const trip = tripOf(body.trip, env);
  const out = await updateState(env, trip, state => {
    const listing = state.listings.find(l => l.id === body.id);
    if (!listing) return { error: '房源不存在' };
    listing.area = String(body.area || '').trim().slice(0, 30);
    listing.areaManual = true;
    return { listing };
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j({ ok: true, listing: out.listing });
}

export const routes = {
  'POST /api/zones': handleZones,
  'POST /api/area': handleSetArea,
};
