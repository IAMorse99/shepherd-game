// client/player.js
"use strict";

/** Create a player starting near the pasture edge. */
export function createPlayer({ cx, edges }) {
  return { x: cx, y: edges.pasture - 4, moveCooldown: 0 };
}

/** Tile passability rules:
 * - Water is blocked unless (x,y) is one of the bridge tiles.
 * - All other terrain is walkable.
 */
export function canWalk(nx, ny, env) {
  const { WORLD, ringAt, bridgeSet } = env;
  if (nx < 0 || ny < 0 || nx >= WORLD || ny >= WORLD) return false;

  const t = ringAt(nx, ny);
  if (t === "water") {
    return bridgeSet?.has?.(`${nx},${ny}`) || false;
  }
  return true; // pasture, glen, dark are fine
}

export function tryMove(player, held, env) {
  const dir =
    held.up ? [0,-1] :
    held.down ? [0, 1] :
    held.left ? [-1,0] :
    held.right ? [1, 0] :
    null;
  if (!dir) return false;
  const nx = player.x + dir[0], ny = player.y + dir[1];
  if (canWalk(nx, ny, env)) { player.x = nx; player.y = ny; return true; }
  return false;
}

/** Draw player at world→screen coords using camera rect. */
export function drawPlayer(ctx, player, TILE, cam) {
  const sx = player.x*TILE - cam.x + TILE/2;
  const sy = player.y*TILE - cam.y + TILE/2;
  ctx.beginPath(); ctx.arc(sx, sy, Math.max(6, TILE*0.35), 0, Math.PI*2);
  ctx.fillStyle = "#fdfdfd"; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "#1c1c1c"; ctx.stroke();
}