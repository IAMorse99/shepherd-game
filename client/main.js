// client/main.js
"use strict";
import { buildMap, drawVisibleFX, drawMinimap } from "./map.js";
import { createPlayer, tryMove, drawPlayer } from "./player.js";

/* ===== CONFIG ===== */
const TILE = 20;
const WORLD = 200;
const STEP_MS = 90;
const MINIMAP = { size: 220, pad: 12 };

/* ===== CANVAS ===== */
const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d", { alpha: false });
ctx.imageSmoothingEnabled = false;

function resize() {
  canvas.width  = Math.min(window.innerWidth, 1600);
  canvas.height = Math.min(window.innerHeight, 1000);
}
addEventListener("resize", resize);
resize();

/* ===== MAP ===== */
const world = buildMap({ TILE, WORLD });
// world: { cx, cy, edges, radial, ringAt, mapLayer, worldPx }

/* ===== PLAYER & INPUT ===== */
const player = createPlayer({ cx: world.cx, edges: world.edges });
const held = { up:false, down:false, left:false, right:false };
const keymap = {
  "ArrowUp":"up","KeyW":"up",
  "ArrowDown":"down","KeyS":"down",
  "ArrowLeft":"left","KeyA":"left",
  "ArrowRight":"right","KeyD":"right"
};
addEventListener("keydown", e => { const k = keymap[e.code]; if (!k) return; held[k]=true; e.preventDefault(); });
addEventListener("keyup",   e => { const k = keymap[e.code]; if (!k) return; held[k]=false; e.preventDefault(); });

/* ===== CAMERA ===== */
function cameraRect() {
  const vw = canvas.width, vh = canvas.height;
  let camX = player.x*TILE + TILE/2 - vw/2;
  let camY = player.y*TILE + TILE/2 - vh/2;
  camX = Math.max(0, Math.min(camX, world.worldPx - vw));
  camY = Math.max(0, Math.min(camY, world.worldPx - vh));
  return { x: camX, y: camY, w: vw, h: vh };
}

/* ===== LOOP ===== */
let last = performance.now();
function loop(now){
  const dt = now - last; last = now;

  // movement cadence
  player.moveCooldown -= dt;
  if (player.moveCooldown <= 0) {
    if (tryMove(player, held, { WORLD, edges: world.edges, radial: world.radial })) {
      player.moveCooldown = STEP_MS;
    } else if (!held.up && !held.down && !held.left && !held.right) {
      player.moveCooldown = 0;
    } else {
      player.moveCooldown = STEP_MS;
    }
  }

  const cam = cameraRect();

  // main view (copy visible slice from prerendered layer)
  ctx.drawImage(world.mapLayer, cam.x, cam.y, cam.w, cam.h, 0, 0, canvas.width, canvas.height);

  // ambient FX over visible tiles
  drawVisibleFX(ctx, cam, now, { TILE, WORLD, ringAt: world.ringAt });

  // player
  drawPlayer(ctx, player, TILE, cam);

  // minimap
  drawMinimap(ctx, world.mapLayer, cam, player, { TILE, WORLD, worldPx: world.worldPx, MINIMAP });

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);