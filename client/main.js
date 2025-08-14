// client/main.js
"use strict";
import {
  buildMap,
  drawVisibleFX,
  drawMinimap,
  drawBridges,
  createFoodPatches,   // from map.js
  drawFoodPatches,     // from map.js
} from "./map.js";
import { createPlayer, tryMove, drawPlayer } from "./player.js";
import { createSheepManager } from "./sheep.js";
import { buildBridges, toBridgeSet } from "./bridges.js";

/* ===== CONFIG ===== */
const TILE = 20;
const WORLD = 200;
const STEP_MS = 90;
const MINIMAP = { size: 220, pad: 12 };

// Food patches config
const FOOD_PATCH_COUNT = 140;        // how many patches exist at once
const FOOD_RESPAWN_EVERY_MS = 1500;  // try to respawn a patch periodically

/* ===== CANVAS ===== */
const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d", { alpha: false });
ctx.imageSmoothingEnabled = false;
function resize(){ canvas.width = Math.min(window.innerWidth,1600); canvas.height = Math.min(window.innerHeight,1000); }
addEventListener("resize", resize); resize();

/* ===== MAP ===== */
const world = buildMap({ TILE, WORLD });

/* ===== BRIDGES ===== */
const bridgeTiles = buildBridges(world);      // array of {x,y}
const bridgeSet   = toBridgeSet(bridgeTiles); // Set("x,y")

/* ===== FOOD PATCHES ===== */
// 🔧 FIX: pass { WORLD, ringAt } instead of the whole world object
let foodPatches = createFoodPatches({ WORLD, ringAt: world.ringAt }, FOOD_PATCH_COUNT); // Set("x,y")
let foodRespawnTimer = 0;
const tileKey = (x,y) => `${x},${y}`;

/* ===== PLAYER & INPUT ===== */
const player = createPlayer({ cx: world.cx, edges: world.edges });
const held = { up:false, down:false, left:false, right:false };
const keymap = { "ArrowUp":"up","KeyW":"up","ArrowDown":"down","KeyS":"down","ArrowLeft":"left","KeyA":"left","ArrowRight":"right","KeyD":"right" };
addEventListener("keydown", e => { const k = keymap[e.code]; if (!k) return; held[k]=true; e.preventDefault(); });
addEventListener("keyup",   e => { const k = keymap[e.code]; if (!k) return; held[k]=false; e.preventDefault(); });

/* ===== SHEEP ===== */
const sheepMgr = createSheepManager({ TILE, WORLD, edges: world.edges, radial: world.radial });
sheepMgr.addSheep(2, player);

/* ===== CAMERA ===== */
function cameraRect(){
  const vw = canvas.width, vh = canvas.height;
  let camX = player.x*TILE + TILE/2 - vw/2;
  let camY = player.y*TILE + TILE/2 - vh/2;
  camX = Math.max(0, Math.min(camX, world.worldPx - vw));
  camY = Math.max(0, Math.min(camY, world.worldPx - vh));
  return { x: camX, y: camY, w: vw, h: vh };
}

/* ===== HUD (sheep + patch count) ===== */
function drawHUD(){
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(10, 10, 160, 52);
  ctx.fillStyle = "#fff";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText(`Sheep: ${sheepMgr.count}`, 18, 32);
  ctx.fillText(`Patches: ${foodPatches.size}`, 18, 50);
  ctx.restore();
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
    if (tryMove(player, held, { WORLD, ringAt: world.ringAt, bridgeSet })) {
      player.moveCooldown = STEP_MS;
      movedThisTick = true;
    } else if (!held.up && !held.down && !held.left && !held.right) {
      player.moveCooldown = 0;
    } else {
      player.moveCooldown = STEP_MS;
    }
  }
  const moving = movedThisTick || (player.x !== prevPX || player.y !== prevPY);
  prevPX = player.x; prevPY = player.y;

  // update sheep (follow/mosey/breed)
  sheepMgr.update(now, dt, { player, moving });

  // SHEEP GRAZING: any sheep standing on a food patch eats it
  for (const s of sheepMgr.list) {
    const tx = Math.floor(s.x / TILE);
    const ty = Math.floor(s.y / TILE);
    const key = tileKey(tx, ty);
    if (foodPatches.has(key)) {
      foodPatches.delete(key);
      if (typeof sheepMgr.eat === "function") sheepMgr.eat(s, 1); // +1 meal to that sheep
    }
  }

  // Respawn patches gradually to maintain target count
  foodRespawnTimer += dt;
  if (foodRespawnTimer >= FOOD_RESPAWN_EVERY_MS) {
    foodRespawnTimer = 0;
    if (foodPatches.size < FOOD_PATCH_COUNT) {
      // 🔧 FIX: also pass { WORLD, ringAt } here
      const one = createFoodPatches({ WORLD, ringAt: world.ringAt }, 1);
      for (const k of one) foodPatches.add(k);
    }
  }

  // camera
  const cam = cameraRect();

  // world + FX
  ctx.drawImage(world.mapLayer, cam.x, cam.y, cam.w, cam.h, 0, 0, canvas.width, canvas.height);
  drawVisibleFX(ctx, cam, now, { TILE, WORLD, ringAt: world.ringAt });

  // bridges (under entities)
  drawBridges(ctx, cam, TILE, bridgeTiles);

  // food patches (under entities)
  drawFoodPatches(ctx, cam, TILE, foodPatches);

  // entities
  sheepMgr.draw(ctx, cam);
  drawPlayer(ctx, player, TILE, cam);

  // UI
  drawMinimap(ctx, world.mapLayer, cam, player, { TILE, WORLD, worldPx: world.worldPx, MINIMAP });
  drawHUD();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);