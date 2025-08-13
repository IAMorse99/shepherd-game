// client/main.js
"use strict";

/* ===== CONFIG ===== */
const TILE = 20;                 // px per tile
const WORLD = 200;               // 200x200 tiles (way bigger)
const GRID_COLOR = "rgba(0,0,0,0.18)";
const STEP_MS = 90;              // ms per tile when holding a key
const MINIMAP_SIZE = 220;        // px square
const MINIMAP_PAD = 12;

const COLORS = {
  pasture: "#7ccf4f",
  water:   "#4aa7c9",
  glen:    "#4c8b41",
  dark:    "#234020"
};

/* ===== CANVAS ===== */
const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d", { alpha: false });
ctx.imageSmoothingEnabled = false;

function resize() {
  canvas.width  = Math.min(window.innerWidth, 1600); // cap if you want
  canvas.height = Math.min(window.innerHeight, 1000);
}
window.addEventListener("resize", resize);
resize();

/* ===== WORLD & RINGS ===== */
const cx = Math.floor(WORLD/2);
const cy = Math.floor(WORLD/2);
const maxR = Math.min(cx, cy) - 1;

// auto-fit ring widths (percentages of radius)
let rPasture = Math.floor(maxR * 0.45);
let rWater   = Math.floor(maxR * 0.17);
let rGlen    = Math.floor(maxR * 0.25);
let rDark    = Math.max(2, maxR - (rPasture + rWater + rGlen));
while (rPasture + rWater + rGlen + rDark > maxR) {
  if (rPasture > 8) rPasture--; else if (rGlen > 6) rGlen--; else if (rWater > 4) rWater--; else { rDark = Math.max(2, rDark-1); break; }
}
const edges = {
  pasture: maxR,
  water:   maxR - rPasture,
  glen:    maxR - rPasture - rWater,
  dark:    maxR - rPasture - rWater - rGlen
};

function radial(x, y) {
  const dx = x - cx + 0.5, dy = y - cy + 0.5;
  return Math.sqrt(dx*dx + dy*dy);
}
function ringAt(x, y) {
  const r = radial(x, y);
  if (r > edges.water) return "pasture";
  if (r > edges.glen)  return "water";
  if (r > edges.dark)  return "glen";
  return "dark";
}

/* ===== PRE-RENDER MAP to offscreen ===== */
const worldPx = WORLD * TILE;
const mapLayer = document.createElement("canvas");
mapLayer.width = worldPx; mapLayer.height = worldPx;
const mctx = mapLayer.getContext("2d");
mctx.imageSmoothingEnabled = false;

// tiles + subtle texture
for (let y = 0; y < WORLD; y++) {
  for (let x = 0; x < WORLD; x++) {
    const ring = ringAt(x, y);
    mctx.fillStyle = COLORS[ring];
    mctx.fillRect(x*TILE, y*TILE, TILE, TILE);

    const n = (Math.sin((x*97 + y*57)) + 1) * 0.08; // tiny variation
    mctx.fillStyle = `rgba(0,0,0,${n})`;
    mctx.fillRect(x*TILE, y*TILE, TILE, TILE);
  }
}
// darker center
const centerRadius = Math.max(0, (edges.dark+1)*TILE);
if (centerRadius > 0) {
  mctx.fillStyle = "rgba(0,0,0,0.16)";
  mctx.beginPath();
  mctx.arc(cx*TILE, cy*TILE, centerRadius, 0, Math.PI*2);
  mctx.fill();
}
// grid overlay
mctx.strokeStyle = GRID_COLOR; mctx.lineWidth = 1;
for (let y = 0; y <= WORLD; y++) {
  mctx.beginPath(); mctx.moveTo(0, y*TILE + 0.5); mctx.lineTo(worldPx, y*TILE + 0.5); mctx.stroke();
}
for (let x = 0; x <= WORLD; x++) {
  mctx.beginPath(); mctx.moveTo(x*TILE + 0.5, 0); mctx.lineTo(x*TILE + 0.5, worldPx); mctx.stroke();
}

/* ===== PLAYER ===== */
const player = { x: cx, y: edges.pasture - 4, moveCooldown: 0 };
const held = { up:false, down:false, left:false, right:false };
const keymap = {
  "ArrowUp":"up","KeyW":"up",
  "ArrowDown":"down","KeyS":"down",
  "ArrowLeft":"left","KeyA":"left",
  "ArrowRight":"right","KeyD":"right"
};
addEventListener("keydown", e => { const k = keymap[e.code]; if (!k) return; held[k]=true; e.preventDefault(); });
addEventListener("keyup",   e => { const k = keymap[e.code]; if (!k) return; held[k]=false; e.preventDefault(); });

function canWalk(nx, ny) {
  if (nx<0||ny<0||nx>=WORLD||ny>=WORLD) return false;
  return radial(nx, ny) <= edges.pasture + 0.2; // inside outer edge
}
function tryMove() {
  const dir = held.up?[0,-1] : held.down?[0,1] : held.left?[-1,0] : held.right?[1,0] : null;
  if (!dir) return false;
  const nx = player.x + dir[0], ny = player.y + dir[1];
  if (canWalk(nx, ny)) { player.x = nx; player.y = ny; return true; }
  return false;
}

/* ===== CAMERA (close view) ===== */
function cameraRect() {
  const vw = canvas.width, vh = canvas.height;
  let camX = player.x*TILE + TILE/2 - vw/2;
  let camY = player.y*TILE + TILE/2 - vh/2;
  camX = Math.max(0, Math.min(camX, worldPx - vw));
  camY = Math.max(0, Math.min(camY, worldPx - vh));
  return { x: camX, y: camY, w: vw, h: vh };
}

/* ===== MINIMAP ===== */
function drawMinimap(cam) {
  const mmW = MINIMAP_SIZE, mmH = MINIMAP_SIZE;
  const mmX = canvas.width - mmW - MINIMAP_PAD;
  const mmY = canvas.height - mmH - MINIMAP_PAD;

  // background
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(mmX-6, mmY-6, mmW+12, mmH+12);

  // scaled world
  ctx.drawImage(mapLayer, 0, 0, worldPx, worldPx, mmX, mmY, mmW, mmH);

  // player dot
  const px = mmX + (player.x*TILE + TILE/2) / worldPx * mmW;
  const py = mmY + (player.y*TILE + TILE/2) / worldPx * mmH;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();

  // camera box
  const bx = mmX + cam.x / worldPx * mmW;
  const by = mmY + cam.y / worldPx * mmH;
  const bw = cam.w / worldPx * mmW;
  const bh = cam.h / worldPx * mmH;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);
}

/* ===== LOOP ===== */
let last = performance.now();
function loop(now){
  const dt = now - last; last = now;

  player.moveCooldown -= dt;
  if (player.moveCooldown <= 0) {
    if (tryMove()) player.moveCooldown = STEP_MS;
    else if (!held.up && !held.down && !held.left && !held.right) player.moveCooldown = 0;
    else player.moveCooldown = STEP_MS;
  }

  const cam = cameraRect();

  // main view: draw the source rect of the big map to the canvas
  ctx.drawImage(mapLayer, cam.x, cam.y, cam.w, cam.h, 0, 0, canvas.width, canvas.height);

  // player marker in view space
  const sx = player.x*TILE - cam.x + TILE/2;
  const sy = player.y*TILE - cam.y + TILE/2;
  ctx.beginPath();
  ctx.arc(sx, sy, Math.max(6, TILE*0.35), 0, Math.PI*2);
  ctx.fillStyle = "#fdfdfd"; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "#1c1c1c"; ctx.stroke();

  // minimap
  drawMinimap(cam);

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
