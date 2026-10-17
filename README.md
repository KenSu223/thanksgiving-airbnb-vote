# Thanksgiving Airbnb Vote

A tiny full-stack app for group trip planning. Share one public link, and anyone
with the link can paste Airbnb listing URLs into a shared shortlist, vote for
their favorites, and watch the live ranking.

Originally built for a ~10-person Thanksgiving trip to the Denver area, but it
works for any group picking a place together.

![stack](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20KV-orange) ![license](https://img.shields.io/badge/license-MIT-green)

## Features

- Paste any Airbnb listing link → title, photo, bedrooms/beds/baths, capacity,
  and rating are auto-filled
- Hotels: paste a hotel's Google Maps (or Apple Maps) link instead. Name,
  street address and location come from the link (so it lands in its area and
  on the map); the price is Google's reference rate per room per night (for a
  night Google picks, shown with it), or whatever you type — when adding or on
  the card. Cards show it per room per night plus a group estimate (rooms of 4
  × nights). Hotels added earlier from Booking.com keep their pulled totals.
- One-tap voting with voter names, toggle to unvote — casting a vote sets off a
  confetti celebration (banner only for people who prefer reduced motion)
- Separate tabs (and separate lists) for each leg of the trip — Nov 25–26 for
  9 people, Nov 26–29 for 14; "Go to Airbnb" opens each listing with that
  tab's dates and guest count
- Sort by votes or price, filter by area
- Anyone with the link can remove a listing (with a confirm dialog)
- Manual-add fallback when auto-scrape fails
- Restaurants: paste a link copied from Google Maps to add a place to the
  trip's list (name, street address and location come from the link — a share
  link from the Maps app carries the address but no coordinates, so the
  address is looked up; if it doesn't point to one place, you get "not
  found"); each card shows its address and up to 10 photos from the place
  page, like the Airbnb cards. Vote for the ones you want to try, open each in
  Google Maps or get directions. The link reading lives in
  `worker/lib/maplink.js`, shared with hotels and activities
- Gameroom: live Blackjack (one table, up to 6 seats), 斗地主 (叫地主 /
  抢地主), 掼蛋 (full 升级 with 进贡 / 还贡) and 川麻 (血战到底 with 换三张,
  no 番 cap), each with three tables and bots in empty seats, joined from
  everyone's own phone. Each game has its own leaderboard (chips / 豆子), play
  points only. On a phone held upright the cards / tiles are bigger and the
  hand wraps into rows; held sideways while seated, the table fills the screen
- 鲁班七号躲技能 (in the Gameroom): a single-player dodge game. Enemy skills
  (钟馗's hook, 安琪拉's fireballs, 王昭君's ice, 小乔's fan, 后羿's arrow,
  姜子牙's beam) warn on the ground, then fire, more and faster as time goes
  on; one hit and the run is over. PC: right-click to move, F / D for 闪现.
  Phone: sideways full screen, joystick + drag-to-aim 闪现 (release to cast,
  drag far to cancel). Flash uses an 8-second training cooldown; Esc pauses
  on desktop. The 2D canvas uses an eight-direction 鲁班 sprite atlas with
  animated steps, a painted canyon river-and-stone arena, and brief skill
  warnings that end at release. Canvas-drawn art remains a loading fallback.
  钟馗's hook disappears at maximum range; only 小乔's fan returns.
  The start screen shows the same generated 鲁班 on the canyon art, skill
  cards carry a hero-name seal and the 闪现 button a drawn bolt; no official
  game images are included (the two generated images are WebP, about 0.7 MB;
  see `web/public/dodge/SOURCES.md`). Every skill has a sound for its
  warning and one for when it goes off, panned toward where it comes from,
  plus 闪现, the countdown and the hit; all synthesized in the browser (no
  audio files). 🔊 / M mutes (remembered); tapping a skill card on the start
  screen plays its sounds. Unit tests:
  `node --test web/src/features/dodge/*.test.js`. One all-time
  leaderboard of each person's longest survival
- Flights: everyone enters their arrival and departure flights; a route map
  (arrivals and departures separately), an airport pickup list people can
  claim, and suggested times to be at the airport for departures
- Secret Angel: flip through ten question cards and answer five (what you
  can't be given, plus fun ones like "if you opened a little shop, what would
  it be?") so a stranger can pick your gift, then anyone draws who secretly gives a gift to
  whom; everyone only sees their own match
- No passwords, no database server

## How it works

- **Frontend** (`web/`): React + Vite + Tailwind, one folder per feature
  (`web/src/features/hunt`, `food`, `split`, `games`, `blackjack`, `ddz`, `guandan`, `mahjong`, `dodge`). People log in by picking
  their name from the group's user list; votes are tied to that user's token.
- **Add to home screen** (`web/public/manifest.webmanifest`, the icons, the
  Apple tags in `web/index.html`): opened from a home-screen icon, the site
  runs without the browser bar. On iPhone that is the only way to get a true
  full screen (Safari and Chrome there can't hide their bar for a page), so
  the dodge game shows a tip about it when played in the browser.
- **Backend** (`worker/`): a Cloudflare Worker, one folder per feature, each
  exporting its own route table that `worker/index.js` merges. A small JSON API:
  `GET /api/state`, `POST /api/add`, `/api/add-manual`, `/api/vote`,
  `/api/enrich`, `/api/remove`. Every call names its tab (`?trip=` on the GET,
  `trip` in POST bodies: `nov25` or `nov26`); calls without one go to `nov26`.
- **Storage**: Cloudflare KV — one key per trip tab (`state:nov25:v1` for the
  9-person leg, the original `state:v1` for the 14-person leg), each holding
  that tab's listings array as JSON. Two keys are shared by the whole group
  rather than per tab: `users:v1` (the name list people log in with, which is
  also the Split-that-bill member list) and `split:v1` (one expense ledger).
  Restaurants are per trip again: `food:nov25:v1` and `food:nov26:v1`.
- **Blackjack** (`GET /api/bj`, a WebSocket): the table lives in one Durable
  Object, `BlackjackTable` (SQLite-backed, which the free plan requires). The
  game runs there and every seated or watching client gets the whole table
  after each change. Chips are saved in the object's own storage only when a
  player stands up or disconnects, not per hand, so play doesn't use the KV
  write budget.
- **斗地主 / 掼蛋 / 川麻** (`GET /api/ddz`, `/api/guandan`, `/api/mahjong`,
  WebSockets): one Durable Object per game (`DdzHall`, `GuandanHall`,
  `MahjongHall`), each running three tables. They share the hall code in
  `worker/games/hall.js` (rooms, sitting down with your login, saving 豆子,
  the leaderboard); each game folder has its rules, bots and table. Bots take
  any empty seat and stand in for anyone who times out twice or drops (托管).
  豆子 are saved the same way as Blackjack chips, in each hall's own storage,
  so every game's leaderboard is separate and play never touches the KV
  write budget. 斗地主: when it's your turn a bar above your buttons says so
  (with a chime and a phone buzz; the tab title flashes if the page is in the
  background; 🔔/🔕 turns the sound off), and the last 5 seconds turn it red
  with a tick each second (`web/src/features/games/turnAlert.js`). Time up
  while bidding counts as 不叫 / 不抢; three 不叫 reshuffle and deal again,
  and the table says so. 提示 lists every play that beats the table
  (`worker/ddz/hints.js`), one per press — not what the bot would do, which
  can be a deliberate pass.
- **鲁班七号躲技能** (`/api/dodge/start`, `/api/dodge/score`,
  `/api/dodge/board`, `/api/dodge/replay`): the game runs in the browser
  (`web/src/features/dodge/sim.js`), which is deterministic: the same seed
  and inputs always play out the same way. Starting a run gets a signed
  ticket with the seed from the `DodgeBoard` Durable Object; the page records
  every input, and when the run ends the server replays them
  (`verify.js`) and its own result is the score. A made-up time or an edited
  game doesn't survive the replay, and a run can't be longer than the time
  since its ticket. Each person's best run is kept with its inputs, so anyone
  can watch it again (▶ on the leaderboard, at 1× / 2× / 4×). The replay also
  times how fast the player gets out of danger; a run that does it faster
  than people can (median ≤ 133 ms) is marked 🤖 on the board — a flag, not a
  ban. Nothing is held between requests (the ticket carries the run), so a
  run of any length counts; if sending fails, the page keeps the run on the
  device and sends it again later. Records from before tickets stay as they
  were, without a replay.
- **Listing enrichment**: pasted Airbnb URLs are scraped server-side. Because
  Airbnb bot-blocks datacenter IPs, the scraper tries three levels: direct
  fetch → `airbnb.co.uk` (same listing, no bot wall) → the `r.jina.ai` reader
  proxy. Live prices for each trip's dates come from the same price request
  Airbnb's own listing page makes (`worker/listings/prices.js`), cached 6 hours.

## Develop

```bash
npm install
npm run dev:api   # terminal 1: the worker on :8787 (KV and the Gameroom run locally)
npm run dev       # terminal 2: the page on :5173 with hot reload, /api proxied to :8787
npm run check     # lint + build + bundle the worker, same as CI runs on every PR
```

`npm run dev:api` alone also works: it builds the page and serves everything on
:8787, just without hot reload.

## Deploy your own

You need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and
`wrangler`:

```bash
npm install
npx wrangler login
npx wrangler kv namespace create VOTES_KV
# put the printed namespace id into wrangler.toml under [[kv_namespaces]]
npx wrangler deploy   # builds the frontend first (wrangler.toml [build])
```

You'll get `https://<worker-name>.<your-subdomain>.workers.dev` — share it
with your group.

Notes:

- New Cloudflare accounts must verify their email address before Workers or
  API tokens work (the dashboard shows a blocking "Verify your account" modal
  until then).
- `wrangler.toml` must declare `[assets] binding = "ASSETS"` because the
  worker serves the frontend through `env.ASSETS` — without it the homepage
  throws Error 1101.
- Pushes to `main` deploy through the GitHub Action (`.github/workflows/deploy.yml`).
  There's no paste-into-Quick-Edit bundle anymore: the app has a build step.

## Project layout

| Path | What it is |
|---|---|
| `web/src/features/<feature>/` | One folder per page: components, hooks and CSS for that feature |
| `web/src/components/` | Shared UI: splash, nav, header, login, toast |
| `web/src/lib/`, `web/src/session/` | Shared helpers, trip/page config, the logged-in user |
| `worker/index.js` | Worker entry: merges the route tables, serves `dist/` |
| `worker/<feature>/` | `listings/`, `food/`, `users/`, `split/`, `blackjack/`, `games/` (shared game hall), `ddz/`, `guandan/`, `mahjong/`, `dodge/`: storage, logic and routes |
| `worker/config/` | Trips and seed listings |
| `wrangler.toml` | Deploy config (build step, KV, assets, Durable Objects) |
| `CONTRIBUTING.md` | Where new code goes, and how to keep PRs from colliding |
| `ARCHITECTURE.md` | Detailed technical notes (in Chinese) |

## License

MIT — see [LICENSE](LICENSE).
