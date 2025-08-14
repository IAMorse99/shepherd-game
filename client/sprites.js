// client/sprites.js
"use strict";

/** Minimal image loader with graceful fallback. */
function load(src){
  const img = new Image();
  const spr = { img, ready: false, w: 0, h: 0 };
  img.onload  = () => { spr.ready = true; spr.w = img.naturalWidth; spr.h = img.naturalHeight; };
  img.onerror = () => { spr.ready = false; };
  img.src = src;
  return spr;
}

export const Sprites = {
  player: load("assets/player.png"),
  sheep:  load("assets/sheep.png"),
};

/** Draws an image centered at (x, y) with the requested size.
 *  If not ready, returns false (caller can fallback). */
export function drawSpriteCentered(ctx, spr, x, y, w, h, alpha = 1){
  if (!spr?.ready || !spr.w || !spr.h) return false;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false; // crisp pixel art
  ctx.drawImage(spr.img, x - w/2, y - h/2, w, h);
  ctx.restore();
  return true;
}