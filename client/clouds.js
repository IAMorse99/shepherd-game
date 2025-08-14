// client/main.js
"use strict";
import {
  buildMap,
  drawVisibleFX,
  drawMinimap,
  drawBridges,
  createFoodPatches,
  drawFoodPatches,
} from "./map.js";
import { createPlayer, tryMove, drawPlayer } from "./player.js";
import { createSheepManager } from "./sheep.js";
import { buildBridges, toBridgeSet } from "./bridges.js";
import { createWolvesManager } from "./wolves.js";

/* ===== CONFIG ===== */
const TILE = 20;
const WORLD = 200;
const STEP_MS = 90;
const MINIMAP = { size: 220, pad: 12 };

// Food patches
const FOOD_PATCH_COUNT = 140;
const FOOD_RESPAWN_EVERY_MS = 1500;

/* ===== CANVAS ===== */
const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d", { alpha: false });
ctx.imageSmoothingEnabled = false;
function resize(){ canvas.width = Math.min(window.innerWidth,1600); canvas.height = Math.min(window.innerHeight,1000); }
addEventListener("resize", resize); resize();

/* ===== MAP ===== */
const world = buildMap({ TILE, WORLD });

/* ===== BRIDGES ===== */
const bridgeTiles = buildBridges(world);
const bridgeSet   = toBridgeSet(bridgeTiles);

/* ===== FOOD PATCHES ===== */
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

/* ===== WOLVES ===== */
const wolves = createWolvesManager({ TILE, WORLD, ringAt: world.ringAt });

/* ===== CAMERA ===== */
function cameraRect(){
  const vw = canvas.width, vh = canvas.height;
  let camX = player.x*TILE + TILE/2 - vw/2;
  let camY = player.y*TILE + TILE/2 - vh/2;
  camX = Math.max(0, Math.min(camX, world.worldPx - vw));
  camY = Math.max(0, Math.min(camY, world.worldPx - vh));
  return { x: camX, y: camY, w: vw, h: vh };
}

/* ===== FOOD SEEK HELPER (for sheep) ===== */
function nearestPatchInTiles(xPx, yPx, maxTiles){
  const tx0 = Math.floor(xPx / TILE);
  const ty0 = Math.floor(yPx / TILE);
  let best = null;
  for (const key of foodPatches) {
    const [xs, ys] = key.split(",");
    const tx = +xs, ty = +ys;
    const dx = tx - tx0, dy = ty - ty0;
    const d2 = dx*dx + dy*dy;
    if (d2 <= maxTiles*maxTiles) {
      if (!best || d2 < best.d2) best = { tx, ty, d2 };
    }
  }
  if (!best) return null;
  return { tx: best.tx, ty: best.ty, distTiles: Math.sqrt(best.d2) };
}

/* ===== HUD ===== */
function drawHUD(){
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(10, 10, 220, 52);
  ctx.fillStyle = "#fff";
  ctx.font = "14px system-ui, sans-serif";
  const movingNow = (held.up||held.down||held.left||held.right) ? "yes" : "no";
  ctx.fillText(`Sheep: ${sheepMgr.count}  |  Moving: ${movingNow}`, 18, 32);
  ctx.fillText(`Patches: ${foodPatches.size}`, 18, 50);
  ctx.restore();
}

/* ===== LOOP ===== */
let last = performance.now();

function loop(now){
  const dt = now - last; last = now;

  // movement cadence (grid step); player still uses STEP_MS to advance tiles
  player.moveCooldown -= dt;
  if (player.moveCooldown <= 0) {
    if (tryMove(player, held, { WORLD, ringAt: world.ringAt, bridgeSet })) {
      player.moveCooldown = STEP_MS;
    } else if (!held.up && !held.down && !held.right && !held.left) {
      player.moveCooldown = 0;
    } else {
      player.moveCooldown = STEP_MS;
    }
  }

  // 🔑 KEY CHANGE: treat "moving" as "any movement key is held"
  const moving = (held.up || held.down || held.left || held.right);

  // update sheep (follow + food seeking)
  sheepMgr.update(now, dt, {
    player,
    moving,
    seekFood: (x,y,maxTiles) => nearestPatchInTiles(x,y,maxTiles)
  });

  // Hungry-first grazing
  const hungryFirst = [...sheepMgr.list].sort((a,b)=>a.full - b.full);
  for (const s of hungryFirst) {
    if (s.full >= sheepMgr.mealsToBreed) continue;
    const tx = Math.floor(s.x / TILE);
    const ty = Math.floor(s.y / TILE);
    const key = tileKey(tx, ty);
    if (foodPatches.has(key)) {
      foodPatches.delete(key);
      sheepMgr.eat(s, 1);
    }
  }

  // Wolves (can remove sheep directly from the manager's list)
  wolves.update(now, dt, sheepMgr.list);

  // Respawn patches to maintain count
  foodRespawnTimer += dt;
  if (foodRespawnTimer >= FOOD_RESPAWN_EVERY_MS) {
    foodRespawnTimer = 0;
    if (foodPatches.size < FOOD_PATCH_COUNT) {
      const one = createFoodPatches({ WORLD, ringAt: world.ringAt }, 1);
      for (const k of one) foodPatches.add(k);
    }
  }

  // camera
  const cam = cameraRect();

  // world + FX
  ctx.drawImage(world.mapLayer, cam.x, cam.y, cam.w, cam.h, 0, 0, canvas.width, canvas.height);
  drawVisibleFX(ctx, cam, now, { TILE, WORLD, ringAt: world.ringAt });

  // bridges + patches (under entities)
  drawBridges(ctx, cam, TILE, bridgeTiles);
  drawFoodPatches(ctx, cam, TILE, foodPatches);

  // wolves (draw above patches, below player)
  wolves.draw(ctx, cam, TILE);

  // entities
  sheepMgr.draw(ctx, cam);
  drawPlayer(ctx, player, TILE, cam);

  // UI
  drawMinimap(ctx, world.mapLayer, cam, player, { TILE, WORLD, worldPx: world.worldPx, MINIMAP });
  drawHUD();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);