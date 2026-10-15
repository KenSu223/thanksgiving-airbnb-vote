Follow-up to #141: the autopilot used to run in the page, so it stopped the moment the tab was hidden, another game was opened, or the phone was locked (the page's autoplay loop and socket both stand down when not visible — by design, to save quota). Now the bot plays where the board already lives: on the server.

## What changes

**Server (`worker/g2048/board.js`)**
- `{ type: 'bot', on }` over the existing socket starts/stops an autopilot session. Starting one checks the same grants as before (PM always; anyone else needs PM's grant) — an ungranted account gets `没有外挂授权，先找 PM 开` and nothing starts.
- Sessions are stored in the object's storage (`bots`), and the Durable Object's alarm keeps the game going — about a batch of 8 moves a second — with every tab closed. If the object sleeps or is evicted, the stored session + alarm pick it back up; a safety re-arm runs on connect if a session exists without an alarm queued.
- Bot moves go through a new shared `applyMove` (the page-move path was refactored onto it), so sliding, spawning, best bookkeeping and the 🤖 marking can't drift between human and bot moves. The server marks bot games itself now — it doesn't rely on the client flag (a page-sent move can still declare `bot: true`, same marking as before).
- A session ends when the game ends, when the account turns it off, or when that account makes a manual move / starts a new game — grabbing the wheel stops the bot (a per-move liveness check inside the batch makes the stop immediate). Reaching 2048 auto-keeps, like the in-page bot did.
- Every `state` now carries `botOn` for the receiving account, so any tab/device opening 2048 shows whether the bot is running and the current board.

**Client (`G2048View`)**
- The 🤖 switch now just sends the server toggle; its state comes from `botOn` in state (no more localStorage toggle). The in-page autoplay loop and solver import are gone — manual play is unchanged, and if a tab is open it simply watches the bot's moves arrive like moves from another tab.

`bot.js` itself is unchanged apart from its header comment — the worker imports `plan2048` from it, same as it already imported `logic.js`.

## Verified

- `tests/robustness/g2048.mjs` grows a server-bot section (suite 39 → 47 checks): ungranted bot-on is refused and that game doesn't advance; PM turns it on and the game advances with no moves sent by the test; the game and the record are marked bot; a manual move turns it off and the game then stays put.
- Extra probe against a throwaway dev server: turned the bot on, **closed the socket**, waited 6 s, reconnected — the game had gone from 1 → 56 moves on its own, still `botOn`, still marked.
- Full robustness suite passes; `npm run check` passes. (One earlier full run flaked in the werewolf end-of-game reveal check in `party.mjs` — untouched by this PR; the party suite passes standalone and in the final full run.)
