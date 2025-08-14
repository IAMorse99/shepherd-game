// client/main.js
"use strict";
import { buildMap, drawVisibleFX, drawMinimap } from "./map.js";
import { createPlayer, tryMove, drawPlayer } from "./player.js";
import { createSheepManager } from "./sheep.js";   // ← NEW

/* ===== CONFIG ===== */
const TILE = 20;
const WORLD = 200;
const STEP_MS = 90;
const MINIMAP = { size: 220, pad: 12 };

/* ===== CANVAS (unchanged) ===== */
const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d", { alpha: false });
ctx.imageSmoothingEnabled = false;
function resize(){ canvas.width = Math.min(window.innerWidth,1600); canvas.height = Math.min(window.innerHeight,1000); }
addEventListener("resize", resize); resize();

/* ===== MAP ===== */
const world = buildMap({ TILE, WORLD });

/* ===== PLAYER & INPUT ===== */
const player = createPlayer({ cx: world.cx, edges: world.edges });
const held = { up:false, down:false, left:false, right:false };
const keymap = { "ArrowUp":"up","KeyW":"up","ArrowDown":"down","KeyS":"down","ArrowLeft":"left","KeyA":"left","ArrowRight":"right","KeyD":"right" };
addEventListener("keydown", e => { const k = keymap[e.code]; if (!k) return; held[k]=true; e.preventDefault(); });
addEventListener("keyup",   e => { const k = keymap[e.code]; if (!k) return; held[k]=false; e.preventDefault(); });

/* ===== SHEEP ===== */
const sheepMgr = createSheepManager({ TILE, WORLD, edges: world.edges, radial: world.radial });
sheepMgr.addSheep(2, player);   // start with two trailing sheep

/* ===== CAMERA ===== */
function cameraRect(){
  const vw = canvas.width, vh = canvas.height;
  let camX = player.x*TILE + TILE/2 - vw/2;
  let camY = player.y*TILE + TILE/2 - vh/2;
  camX = Math.max(0, Math.min(camX, world.worldPx - vw));
  camY = Math.max(0, Math.min(camY, world.worldPx - vh));
  return { x: camX, y: camY, w: vw, h: vh };
}

/* ===== LOOP ===== */
let last = performance.now();
let prevPX = player.x, prevPY = player.y;

function loop(now){
  const dt = now - last; last = now;

  // movement cadence
  player.moveCooldown -= dt;
  let movedThisTick = false;
  if (player.moveCooldown <= 0) {
    if (tryMove(player, held, { WORLD, edges: world.edges, radial: world.radial })) {
      player.moveCooldown = STEP_MS;
      movedThisTick = true;
    } else if (!held.up && !held.down && !held.left && !held.right) {
      player.moveCooldown = 0;
    } else {
      player.moveCooldown = STEP_MS;
    }
  }
  // also detect movement by comparing tile changes
  const moving = movedThisTick || (player.x !== prevPX || player.y !== prevPY);
  prevPX = player.x; prevPY = player.y;

  // update sheep before drawing
  sheepMgr.update(now, dt, { player, moving });

  const cam = cameraRect();

  // draw world
  ctx.drawImage(world.mapLayer, cam.x, cam.y, cam.w, cam.h, 0, 0, canvas.width, canvas.height);
  drawVisibleFX(ctx, cam, now, { TILE, WORLD, ringAt: world.ringAt });

  // draw sheep first, then player on top
  sheepMgr.draw(ctx, cam);
  drawPlayer(ctx, player, TILE, cam);

  drawMinimap(ctx, world.mapLayer, cam, player, { TILE, WORLD, worldPx: world.worldPx, MINIMAP });
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);