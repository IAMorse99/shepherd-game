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
import { createNet } from "./net.js";

/* ===== CONFIG ===== */
const TILE = 20;
const WORLD = 200;
const STEP_MS = 90;
const MINIMAP = { size: 220, pad: 12 };

const FOOD_PATCH_COUNT = 140;
const FOOD_RESPAWN_EVERY_MS = 1500;

const NET_PLAYER_SEND_MS = 66;    // ~15 fps for player positions
const NET_WORLD_SEND_MS  = 200;   // ~5 fps for world snapshots (herds+patches+wolves)

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

/* ===== MULTI: Supabase presence ===== */
const params = new URLSearchParams(location.search);
const myName = params.get("n") || ("Shep_" + Math.random().toString(36).slice(2,6));

const SUPABASE_URL  = "https://YOUR-PROJECT.supabase.co";   // <-- paste yours
const SUPABASE_ANON = "YOUR-ANON-PUBLIC-KEY";               // <-- paste yours

const net = createNet({ url: SUPABASE_URL, anonKey: SUPABASE_ANON, room: "shepherd-room-1" });
net.connect(myName);

/* Track all players (tile coords) for herd follow + rendering */
const players = new Map(); // id -> { id, name, x, y, prevX, prevY }
let myId = null;

net.onUpsert((p) => {
  // p: { id, name, x, y, self? }
  if (!myId && p.self) myId = p.id;
  const prev = players.get(p.id);
  players.set(p.id, {
    id: p.id,
    name: p.name || "anon",
    x: p.x|0,
    y: p.y|0,
    prevX: prev?.x ?? (p.x|0),
    prevY: prev?.y ?? (p.y|0)
  });
  ensureHerd(p.id);
});
net.onRemove((id) => {
  players.delete(id);
  // Optionally remove their herd: herds.delete(id);
});

/* ===== HERDS: one SheepManager per player ===== */
const herds = new Map(); // id -> sheepMgr
function makeSheepMgr() {
  const mgr = createSheepManager({ TILE, WORLD, edges: world.edges, radial: world.radial });
  return mgr;
}
function ensureHerd(id) {
  if (!herds.has(id)) {
    const mgr = makeSheepMgr();
    if (id === myId) mgr.addSheep(2, player); // start with 2 for yourself
    herds.set(id, mgr);
  }
}

/* Create my own herd immediately under a temp key; rename once myId is known */
let selfKey = "self";
ensureHerd(selfKey);

/* ===== WOLVES ===== */
const wolves = createWolvesManager({ TILE, WORLD, ringAt: world.ringAt });

/* ===== HOST ELECTION (first in room) ===== */
let isHost = false;
setTimeout(() => {
  isHost = (net.others.size === 0);
  for (const [, mgr] of herds) mgr.setAuthority(isHost);
}, 700);

/* Followers apply host snapshots */
net.onSheep((payload) => {
  if (isHost) return; // host ignores snapshots
  // payload: { herds: { playerId: flock[] }, patches: ["x,y",...], wolves: [...] }
  if (payload?.herds && typeof payload.herds === "object") {
    for (const pid in payload.herds) {
      if (!herds.has(pid)) herds.set(pid, makeSheepMgr());
      herds.get(pid).applySnapshot(payload.herds[pid], player);
    }
  }
  if (Array.isArray(payload.patches)) foodPatches = new Set(payload.patches);
  if (Array.isArray(payload.wolves) && wolves.applySnapshot) wolves.applySnapshot(payload.wolves);
});

/* ===== CAMERA ===== */
function cameraRect(){
  const vw = canvas.width, vh = canvas.height;
  let camX = player.x*TILE + TILE/2 - vw/2;
  let camY = player.y*TILE + TILE/2 - vh/2;
  camX = Math.max(0, Math.min(camX, world.worldPx - vw));
  camY = Math.max(0, Math.min(camY, world.worldPx - vh));
  return { x: camX, y: camY, w: vw, h: vh };
}

/* ===== FOOD SEEK HELPER ===== */
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
  const myMgr = herds.get(myId) || herds.get(selfKey);
  const mine = myMgr ? myMgr.count : 0;
  const text = `Sheep: ${mine} • Players: ${players.size + 1}${isHost ? " (host)" : ""}`;
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
let lastPlayerSend = 0;
let lastWorldSend  = 0;

function loop(now){
  const dt = now - last; last = now;

  // movement cadence
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

  // ensure myId when net provides it; rename temp herd
  if (!myId && net.myId) myId = net.myId;
  if (myId && herds.has(selfKey) && !herds.has(myId)) {
    const mgr = herds.get(selfKey);
    herds.delete(selfKey);
    herds.set(myId, mgr);
  }
  if (myId && !players.has(myId)) {
    players.set(myId, { id: myId, name: myName, x: player.x, y: player.y, prevX: player.x, prevY: player.y });
  }

  // broadcast my position
  if (now - lastPlayerSend > NET_PLAYER_SEND_MS) {
    net.setState(player.x, player.y, myName);
    lastPlayerSend = now;
  }

  const movingSelf = (held.up || held.down || held.left || held.right);

  if (isHost) {
    // update host's own entry
    const me = players.get(myId);
    if (me) { me.prevX = me.x; me.prevY = me.y; me.x = player.x; me.y = player.y; }

    // simulate each herd using its player's position
    for (const [pid, mgr] of herds) {
      const p = players.get(pid) || (pid === myId ? { x: player.x, y: player.y, prevX: player.x, prevY: player.y } : null);
      if (!p) continue;
      const moving = (p.x !== p.prevX || p.y !== p.prevY) || (pid === myId && movingSelf);
      const leaderProxy = (pid === myId) ? player : { x: p.x, y: p.y, moveCooldown: 0 };

      mgr.update(now, dt, { player: leaderProxy, moving, seekFood: (x,y,m)=>nearestPatchInTiles(x,y,m) });

      // grazing per herd
      const hungryFirst = [...mgr.list].sort((a,b)=>a.full - b.full);
      for (const s of hungryFirst) {
        if (s.full >= mgr.mealsToBreed) continue;
        const tx = Math.floor(s.x / TILE);
        const ty = Math.floor(s.y / TILE);
        const key = tileKey(tx, ty);
        if (foodPatches.has(key)) {
          foodPatches.delete(key);
          mgr.eat(s, 1);
        }
      }

      p.prevX = p.x; p.prevY = p.y;
    }

    // wolves: build combined target list across all herds
    const targets = [];
    for (const [pid, mgr] of herds) {
      for (let i = 0; i < mgr.list.length; i++) {
        targets.push({ herdId: pid, idx: i, ref: mgr.list[i] });
      }
    }
    wolves.update(now, dt, targets, (k) => {
      const t = targets[k];
      if (!t) return;
      const m = herds.get(t.herdId);
      if (m && m.list[t.idx]) m.list.splice(t.idx, 1);
    });

    // respawn patches
    foodRespawnTimer += dt;
    if (foodRespawnTimer >= FOOD_RESPAWN_EVERY_MS) {
      foodRespawnTimer = 0;
      if (foodPatches.size < FOOD_PATCH_COUNT) {
        const one = createFoodPatches({ WORLD, ringAt: world.ringAt }, 1);
        for (const k of one) foodPatches.add(k);
      }
    }

    // broadcast world snapshot
    if (now - lastWorldSend > NET_WORLD_SEND_MS) {
      const herdsSnap = {};
      for (const [pid, mgr] of herds) herdsSnap[pid] = mgr.serialize();
      const patches = [...foodPatches];
      const wolfSnap = (wolves.serialize ? wolves.serialize() : []);
      net.sendSheepSnapshot({ herds: herdsSnap, patches, wolves: wolfSnap });
      lastWorldSend = now;
    }
  } else {
    // followers: keep my own herd responsive locally (visual feel)
    const myMgr = herds.get(myId) || herds.get(selfKey);
    if (myMgr) {
      myMgr.update(now, dt, { player, moving: movingSelf, seekFood: (x,y,m)=>nearestPatchInTiles(x,y,m) });
    }
  }

  /* ===== RENDER ===== */
  const cam = cameraRect();

  // world + FX
  ctx.drawImage(world.mapLayer, cam.x, cam.y, cam.w, cam.h, 0, 0, canvas.width, canvas.height);
  drawVisibleFX(ctx, cam, now, { TILE, WORLD, ringAt: world.ringAt });

  // bridges + patches
  drawBridges(ctx, cam, TILE, bridgeTiles);
  drawFoodPatches(ctx, cam, TILE, foodPatches);

  // wolves
  wolves.draw(ctx, cam, TILE);

  // draw all herds (draw others first)
  for (const [pid, mgr] of herds) {
    if (pid === myId) continue;
    mgr.draw(ctx, cam);
  }

  // draw other players' shepherd sprites (same look as yours)
  for (const [pid, info] of players) {
    if (pid === myId) continue;
    drawPlayer(ctx, { x: info.x, y: info.y }, TILE, cam);
  }

  // draw my herd and then me on top
  const myMgr = herds.get(myId) || herds.get(selfKey);
  if (myMgr) myMgr.draw(ctx, cam);
  drawPlayer(ctx, player, TILE, cam);

  // UI
  drawMinimap(ctx, world.mapLayer, cam, player, { TILE, WORLD, worldPx: world.worldPx, MINIMAP });
  drawHUD();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);