import { SEED } from './seed.js';

// ---- Trips: each leg has its own shortlist under its own KV key ----
// nov26 keeps the original 'state:v1' key so the existing list carries over.
// voteEndsAt: when voting closes (12:00 AM Pacific time on that date, as UTC).
//   After it, votes/adds/removes are refused and the group's pick is shown.
// zones: the trip's named areas, each a center and a radius in km. A new
// listing inside one gets that area (see listings/zones.js). Names must match
// `areas` in web/src/lib/config.js, which sets their tab order.
export const TRIPS = {
  nov25: { kvKey: 'state:nov25:v1', seed: [], checkIn: '2026-11-25', checkOut: '2026-11-26', people: 9,
    // Google Hotels search context (dates + 2 guests/1 room + USD) for the
    // price pull; captured from a real browser session — Google rejects
    // hand-assembled ones. See listings/google.js.
    googleTs: 'CAEaIAoCGgASGhIUCgcI6g8QCxgZEgcI6g8QCxgaGAEyAggBKgkKBToDVVNEGgA',
    voteEndsAt: '2026-10-15T07:00:00Z', // 10/15 00:00 PDT
    zones: [
      { name: 'Denver 市区', lat: 39.7392, lng: -104.9903, km: 10 },
      { name: 'Denver 周边', lat: 39.7392, lng: -104.9903, km: 50 },
    ], },
  nov26: { kvKey: 'state:v1', seed: SEED, checkIn: '2026-11-26', checkOut: '2026-11-29', people: 14,
    googleTs: 'CAEaIAoCGgASGhIUCgcI6g8QCxgaEgcI6g8QCxgdGAMyAggBKgkKBToDVVNEGgA',
    voteEndsAt: '2026-10-18T07:00:00Z', // 10/18 00:00 PDT
    zones: [
      { name: '大沙丘区域', lat: 37.7326, lng: -105.5122, km: 60 },
      { name: '落基山 · Estes Park', lat: 40.3772, lng: -105.5217, km: 30 },
    ], },
};
export const DEFAULT_TRIP = 'nov26'; // requests without a trip (old cached pages) hit the original list
export const tripOf = t => TRIPS[t] || TRIPS[DEFAULT_TRIP];
