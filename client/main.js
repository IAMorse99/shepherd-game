"use strict";
import {
  buildMap,
  drawVisibleFX,
  drawMinimap,
  drawBridges,
  createFoodPatches, // not used now (server owns), but keeping import OK
  drawFoodPatches,
} from "./map.js";
import { createPlayer, drawPlayer } from "./player.js";
import { createSheepManager } from "./sheep.js";
import { buildBridges, toBridgeSet } from "./bridges.js";
import { createWolvesManager } from "./wolves.js";
import { createNetWS } from "./net.js";

/* ===== CONFIG ===== */
const TILE = 20;
const WORLD = 200;
const MINIMAP = { size: 220, pad: 12 };

/* ===== CANVAS ===== */
const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d", { alpha: false });
ctx.imageSmoothingEnabled = false;
function resize(){ canvas.width = Math.min(window.innerWidth,1600); canvas.height = Math.min(window.innerHeight,1000); }
addEventListener("resize", resize); resize();

/* ===== MAP & STATIC ===== */
const world = buildMap({ TILE, WORLD });
const bridgeTiles = buildBridges(world);

/* ===== INPUT (we still capture keys and send to server) ===== */
const held = { up:false, down:false, left:false, right:false };
const keymap = { "ArrowUp":"up","KeyW":"up","ArrowDown":"down","KeyS":"down","ArrowLeft":"left","KeyA":"left","ArrowRight":"right","KeyD":"right" };
addEventListener("keydown", e => { const k = keymap[e.code]; if (!k) return; held[k]=true; e.preventDefault(); });
addEventListener("keyup",   e => { const k = keymap[e.code]; if (!k) return; held[k]=false; e.preventDefault(); });

/* ===== PLAYER (local display only; server owns positions) ===== */
const player = createPlayer({ cx: world.cx, edges: world.edges }); // used only for camera + drawing my sprite
let myId = null;

/* ===== HERDS RENDERERS (one SheepManager per player for drawing only) ===== */
const herds = new Map(); // id -> SheepManager
function ensureHerd(id){
  if (!herds.has(id)) {
    const mgr = createSheepManager({ TILE, WORLD, edges: world.edges, radial: world.radial });
    // don’t auto-add sheep here; we’ll fill from snapshot
    herds.set(id, mgr);
  }
}
function applyHerdSnapshot(mgr, snap){
  // snap is [[x,y,full,cd],...]
  while (mgr.list.length < snap.length) mgr.addSheep(1, player);
  while (mgr.list.length > snap.length) mgr.list.pop();
  for (let i=0;i<snap.length;i++){
    const s = mgr.list[i];
    const [x,y,full,cd] = snap[i];
    s.x = x; s.y = y; s.full = full|0; s.cd = cd|0; s.vx = 0; s.vy = 0;
  }
}

/* ===== WOLVES (drawing only) ===== */
const wolves = createWolvesManager({ TILE, WORLD, ringAt: world.ringAt });
// Only handle snapshot; let wolves.js handle drawing sprites
wolves.applySnapshot = function(list){
  this._list = list.map(([x,y]) => ({ x, y }));
};

/* ===== NET (WS) ===== */
const params = new URLSearchParams(location.search);
const myName = params.get("n") || ("Shep_" + Math.random().toString(36).slice(2,6));
// Default to your Railway deployment; ?ws= can still override for testing.
const SERVER_WS_URL = params.get("ws") || "wss://shepherd-game-production.up.railway.app";

const net = createNetWS({ url: SERVER_WS_URL });
net.connect(myName);

/* ===== SNAPSHOT STATE FROM SERVER ===== */
let netPlayers = new Map(); // id -> {id,name,x,y}
let foodPatches = new Set();

net.onSnapshot((snap) => {
  // players
  const nextPlayers = new Map();
  for (const p of snap.players) {
    nextPlayers.set(p.id, p);
    ensureHerd(p.id);
  }
  netPlayers = nextPlayers;

  // figure out my id (first hello sets it; also infer by name match if needed)
  if (!myId && net.myId) myId = net.myId;

  // herds
  for (const pid in snap.herds) {
    ensureHerd(pid);
    applyHerdSnapshot(herds.get(pid), snap.herds[pid]);
  }

  // wolves
  if (Array.isArray(snap.wolves)) wolves.applySnapshot(snap.wolves);

  // patches
  foodPatches = new Set(snap.patches);

  // also move my local player to server coords for camera
  if (myId && netPlayers.has(myId)) {
    const me = netPlayers.get(myId);
    player.x = me.x; player.y = me.y;
  }
});

/* Send inputs at ~15 fps */
setInterval(() => {
  net.sendInput(held);
}, 66);

/* ===== CAMERA ===== */
function cameraRect(){
  const vw = canvas.width, vh = canvas.height;
  let camX = player.x*TILE + TILE/2 - vw/2;
  let camY = player.y*TILE + TILE/2 - vh/2;
  camX = Math.max(0, Math.min(camX, world.worldPx - vw));
  camY = Math.max(0, Math.min(camY, world.worldPx - vh));
  return { x: camX, y: camY, w: vw, h: vh };
}

/* ===== HUD ===== */
function drawHUD(){
  const mineCount = (myId && herds.get(myId)) ? herds.get(myId).count : 0;
  const text = `Sheep: ${mineCount} • Players: ${netPlayers.size}`;
  ctx.save();
  ctx.font = "14px system-ui, sans-serif";
  const w = ctx.measureText(text).width + 16;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(ctx.canvas.width - w - 12, 10, w, 28);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, ctx.canvas.width - w - 4, 28);
  ctx.restore();
}

/* ===== LOOP (render only) ===== */
function drawFoodPatchesFromSet(ctx, cam, TILE, set){
  if (!set || set.size===0) return;
  ctx.save();
  for (const key of set) {
    const [xs, ys] = key.split(",");
    const x = +xs, y = +ys;
    const sx = x*TILE - cam.x;
    const sy = y*TILE - cam.y;
    ctx.fillStyle = "#9bf07a";
    ctx.fillRect(sx + 3, sy + 3, TILE - 6, TILE - 6);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 3, sy + 3, TILE - 6, TILE - 6);
  }
  ctx.restore();
}

function loop(now){
  const cam = cameraRect();

  // world + FX
  ctx.drawImage(world.mapLayer, cam.x, cam.y, cam.w, cam.h, 0, 0, canvas.width, canvas.height);
  drawVisibleFX(ctx, cam, now, { TILE, WORLD, ringAt: world.ringAt });

  // bridges + patches from server
  drawBridges(ctx, cam, TILE, bridgeTiles);
  drawFoodPatchesFromSet(ctx, cam, TILE, foodPatches);

  // wolves
  wolves.draw(ctx, cam, TILE);

  // render herds (others first)
  for (const [pid, mgr] of herds) { if (pid !== myId) mgr.draw(ctx, cam); }
  if (myId && herds.get(myId)) herds.get(myId).draw(ctx, cam);

  // players
  for (const [, p] of netPlayers) { drawPlayer(ctx, { x:p.x, y:p.y }, TILE, cam); }

  // UI
  drawMinimap(ctx, world.mapLayer, cam, player, { TILE, WORLD, worldPx: world.worldPx, MINIMAP });
  drawHUD();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
