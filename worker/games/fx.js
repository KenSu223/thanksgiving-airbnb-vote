// What just happened at a table, for the page's sounds and callouts (web/src/features/games/
// tableSfx.js): the last few events, numbered so a page plays each one once. Only things everyone
// at the table can see anyway — never a card or tile that's still hidden.
// The list rides along in the game's snapshot, so the numbering carries over a deploy.
export const FX_KEEP = 8;
export function note(game, e) {
  game.fxN = (game.fxN || 0) + 1;
  (game.fx ||= []).push({ n: game.fxN, ...e });
  if (game.fx.length > FX_KEEP) game.fx.shift();
}
