// The group's decision for a trip: voting closes at trip.voteEndsAt, then
// the pick is the most-voted listing Airbnb still shows as available for the
// trip's dates (ties: cheaper live total, then the one added first). The
// admin can override the pick, and someone claims and records the booking.
import { j } from '../lib/http.js';
import { tripOf } from '../config/trips.js';
import { cleanName, getUsers, sameName } from '../users/users.js';
import { updateState } from './state.js';

const ADMIN = 'aster';

export const votingOpen = trip => !trip.voteEndsAt || Date.now() < Date.parse(trip.voteEndsAt);
export const closedError = () => j({ ok: false, error: '投票已经截止，房源和票数都锁定了' });

const liveFor = (l, trip) => (l.live && l.live.checkIn === trip.checkIn && l.live.checkOut === trip.checkOut ? l.live : null);
const unavailable = (l, trip) => { const v = liveFor(l, trip); return !!(v && !v.available); };

// A Google hotel's pulled price is per room (2 guests); scale it to a
// whole-group estimate so it ranks fairly against whole-house totals.
const googleTotal = (l, trip) => (l.gPrice && l.gPrice.checkIn === trip.checkIn && l.gPrice.checkOut === trip.checkOut
  ? l.gPrice.total * Math.ceil(trip.people / 2) : undefined);

// Listings in decision order; unavailable ones last.
export function ranking(state, trip) {
  const total = l => liveFor(l, trip)?.total ?? googleTotal(l, trip) ?? l.priceUSD ?? Infinity;
  return state.listings.slice().sort((a, b) =>
    unavailable(a, trip) - unavailable(b, trip)
    || (b.votes || []).length - (a.votes || []).length
    || total(a) - total(b)
    || (a.createdAt || 0) - (b.createdAt || 0));
}

// What the page needs: deadline, whether it's open, the pick, top of the ranking, booking.
export function voteView(state, trip) {
  const open = votingOpen(trip);
  const ranked = open ? [] : ranking(state, trip).filter(l => (l.votes || []).length && !unavailable(l, trip));
  const override = state.decision && state.listings.some(l => l.id === state.decision.listingId) ? state.decision : null;
  const chosenId = open ? null : override ? override.listingId : ranked[0]?.id || null;
  const booking = state.booking && state.booking.listingId === chosenId ? state.booking : null;
  return { voteEndsAt: trip.voteEndsAt || null, open, chosenId, override: override ? { by: override.by, at: override.at } : null,
    ranking: ranked.slice(0, 5).map(l => l.id), booking };
}

async function caller(env, name, token) {
  const users = await getUsers(env);
  const user = users.find(u => sameName(u.name, cleanName(name)));
  return user && token && user.token === token ? user : null;
}

// Admin: pick a different listing (or listingId null to go back to the vote result).
async function handleDecision(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const trip = tripOf(body.trip);
  const user = await caller(env, body.name, body.token);
  if (!user || user.name.toLowerCase() !== ADMIN) return j({ ok: false, error: '只有管理员可以改选' });
  if (votingOpen(trip)) return j({ ok: false, error: '投票还没截止' });
  const out = await updateState(env, trip, state => {
    if (body.listingId && !state.listings.some(l => l.id === body.listingId)) return { error: '房源不存在' };
    state.decision = body.listingId ? { listingId: body.listingId, by: user.name, at: Date.now() } : null;
    return { vote: voteView(state, trip) };
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j({ ok: true, vote: out.vote });
}

// Booking the pick: claim ("I'll book it"), release, or mark booked with details.
async function handleBooking(req, env) {
  let body = {};
  try { body = await req.json() || {}; } catch (e) { /* ignore */ }
  const trip = tripOf(body.trip);
  const user = await caller(env, body.name, body.token);
  if (!user) return j({ ok: false, error: '先登录' });
  const out = await updateState(env, trip, state => {
    const view = voteView(state, trip);
    if (!view.chosenId) return { error: '还没有选定的房源' };
    const cur = view.booking;
    const mayEdit = !cur || sameName(cur.by, user.name) || user.name.toLowerCase() === ADMIN;
    if (body.action === 'claim') {
      if (cur && !sameName(cur.by, user.name)) return { error: cur.by + ' 已经在负责订了' };
      state.booking = { listingId: view.chosenId, by: user.name, status: 'claimed', at: Date.now() };
    } else if (body.action === 'release') {
      if (!mayEdit) return { error: '只有负责的人或管理员可以取消' };
      state.booking = null;
    } else if (body.action === 'booked') {
      if (!mayEdit) return { error: '只有负责的人或管理员可以标记已订' };
      const total = Number(body.totalUSD);
      state.booking = { listingId: view.chosenId, by: cur ? cur.by : user.name, status: 'booked', at: Date.now(),
        confirmation: String(body.confirmation || '').trim().slice(0, 40), totalUSD: isFinite(total) && total > 0 ? Math.round(total) : null };
    } else return { error: '不认识的操作' };
    return { vote: voteView(state, trip) };
  });
  if (out.error) return j({ ok: false, error: out.error });
  return j({ ok: true, vote: out.vote });
}

export const routes = {
  'POST /api/decision': handleDecision,
  'POST /api/booking': handleBooking,
};
