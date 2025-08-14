// client/player.js
"use strict";
import { Sprites, drawSpriteCentered } from "./sprites.js";

/** Create player starting near outer pasture edge. */
export function createPlayer({ cx, edges }) {
  return {
    x: cx,
    y: edges.pasture - 4,
    moveCooldown: 0,
    lastDir: "down",  // "up" | "down" | "left" | "right"
  };
}

/** Blocked by water unless on a bridge. */
function canWalk(nx, ny, WORLD, ringAt, bridgeSet){
  if (nx < 0 || ny < 0 || nx >= WORLD || ny >= WORLD) return false;
  const ring = ringAt(nx, ny);
  if (ring === "water") {
    // allow only if tile is a bridge
    return bridgeSet.has(`${nx},${ny}`);
  }
  return true;
}

/** Try a single tile step from held keys. */
export function tryMove(player, held, { WORLD, ringAt, bridgeSet }){
  const dir =
      held.up    ? [0, -1, "up"]   :
      held.down  ? [0,  1, "down"] :
      held.left  ? [-1, 0, "left"] :
      held.right ? [1,  0, "right"]: null;

  if (!dir) return false;

  const nx = player.x + dir[0];
  const ny = player.y + dir[1];
  if (!canWalk(nx, ny, WORLD, ringAt, bridgeSet)) return false;

  player.x = nx; player.y = ny;
  player.lastDir = dir[2];
  return true;
}

/** Draw the player (sprite w/ fallback). */
export function drawPlayer(ctx, player, TILE, cam){
  const sx = player.x * TILE - cam.x + TILE/2;
  const sy = player.y * TILE - cam.y + TILE/2;

  // tiny shadow
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ctx.ellipse(sx, sy + TILE*0.22, TILE*0.28, TILE*0.16, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // sprite — bigger now (≈110% of a tile)
  const size = TILE * 1.10;
  const drawn = drawSpriteCentered(ctx, Sprites.player, sx, sy, size, size, 1);

  if (!drawn){
    // fallback: simple marker
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(6, TILE*0.35), 0, Math.PI*2);
    ctx.fillStyle = "#fdfdfd"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#1c1c1c"; ctx.stroke();
  }
}