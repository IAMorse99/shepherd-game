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
import { createNet } from "./net.js";       // ⬅️ NEW (Supabase presence)

/* ===== CONFIG ===== */
const TILE = 20;
const WORLD = 200;
const STEP_MS = 90;
const MINIMAP = { size: 220, pad: 12 };

// Food patches
const FOOD_PATCH_COUNT = 140;
const FOOD_RESPAWN_EVERY_MS = 1500;

// Multiplayer (throttle)
const NET_SEND_MS = 66; // ~15fps to the network

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
const keymap = {
  "ArrowUp":"up","KeyW":"up",
  "ArrowDown":"down","KeyS":"down",
  "ArrowLeft":"left","KeyA":"left",
  "ArrowRight":"right","KeyD":"right"
};
addEventListener("keydown", e => { const k = keymap[e.code]; if (!k) return; held[k]=true; e.preventDefault(); });
addEventListener("keyup",   e => { const k = keymap[e.code]; if (!k) return; held[k]=false; e.preventDefault(); });

/* ===== SHEEP ===== */
const sheepMgr = createSheepManager({ TILE, WORLD, edges: world.edges, radial: world.radial });
sheepMgr.addSheep(2, player);

/* ===== WOLVES ===== */
const wolves = createWolvesManager({ TILE, WORLD, ringAt: world.ringAt });

/* ===== MULTI (Supabase Realtime presence) ===== */
const params = new URLSearchParams(location.search);
const myName = params.get("n") || ("Shep_" + Math.random().toString(36).slice(2,6));

// ⬇️ Paste your values:
const SUPABASE_URL  = "https://keyrkzjqxhzhznltsjmp.supabase.co";   // <-- replace
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtleXJrempxeGh6aHpubHRzam1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNDM3MzksImV4cCI6MjA3MDcxOTczOX0.02TM31EamVlKzYVYaWQLysuVHL36H3ng5_d90mT8sIk";               // <-- replace

const net = createNet({ url: SUPABASE_URL, anonKey: SUPABASE_ANON, room: "shepherd-room-1" });
net.connect(myName);

// remote players we render (id -> {id,name,x,y,ts})
const others = new Map();
net.onUpsert((p) => {
  if (p.id === net.id) return; // ignore self
  others.set(p.id, p);
});
net.onRemove((id) => others.delete(id));

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
  // top-right sheep count only
  const text = `Sheep: ${sheepMgr.count}`;
  ctx.save();
  ctx.font = "14px system-ui, sans-serif";
  const w = ctx.measureText(text).width + 16;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(ctx.canvas.width - w - 12, 10, w, 28);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, ctx.canvas.width - w - 4, 28);
  ctx.restore();
}

/* ===== LOOP ===== */
let last = performance.now();
let lastNet = 0;

function loop(now){
  const dt = now - last; last = now;

  // movement cadence (grid step)
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

  // consider "moving" = keys held (for sheep follow logic)
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

  // Wolves
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

  // network: send my position on a throttle
  if (now - lastNet > NET_SEND_MS) {
    net.setState(player.x, player.y);
    lastNet = now;
  }

  // camera
  const cam = cameraRect();

  // world + FX
  ctx.drawImage(world.mapLayer, cam.x, cam.y, cam.w, cam.h, 0, 0, canvas.width, canvas.height);
  drawVisibleFX(ctx, cam, now, { TILE, WORLD, ringAt: world.ringAt });

  // bridges + patches (under entities)
  drawBridges(ctx, cam, TILE, bridgeTiles);
  drawFoodPatches(ctx, cam, TILE, foodPatches);

  // wolves (above patches, below players)
  wolves.draw(ctx, cam, TILE);

  // other players (simple markers for now)
  for (const p of others.values()) {
    const sx = p.x * TILE + TILE/2 - cam.x;
    const sy = p.y * TILE + TILE/2 - cam.y;

    // shadow
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath(); ctx.ellipse(sx, sy + TILE*0.18, TILE*0.28, TILE*0.14, 0, 0, Math.PI*2);
    ctx.fill(); ctx.restore();

    // marker
    ctx.beginPath(); ctx.arc(sx, sy, TILE*0.35, 0, Math.PI*2);
    ctx.fillStyle = "#d1f"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#1c1c1c"; ctx.stroke();

    // name tag
    ctx.save();
    ctx.font = "12px system-ui, sans-serif";
    const w = ctx.measureText(p.name).width;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(sx - w/2 - 6, sy - TILE*0.9 - 14, w + 12, 16);
    ctx.fillStyle = "#fff";
    ctx.fillText(p.name, sx - w/2, sy - TILE*0.9 - 2);
    ctx.restore();
  }

  // local entities
  sheepMgr.draw(ctx, cam);
  drawPlayer(ctx, player, TILE, cam);

  // UI
  drawMinimap(ctx, world.mapLayer, cam, player, { TILE, WORLD, worldPx: world.worldPx, MINIMAP });
  drawHUD();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
