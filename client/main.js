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

const NET_PLAYER_SEND_MS = 66;    // ~15 fps
const NET_WORLD_SEND_MS  = 200;   // ~5 fps (herds + patches + wolves)

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

/* Track other players' positions (tile coords), to drive their herd follow logic on host */
const players = new Map(); // id -> { id, name, x, y, prevX, prevY }
let myId = null;

net.onUpsert((p) => {
  // p: { id, name, x, y }
  if (!myId && p.self) myId = p.id;
  const prev = players.get(p.id);
  players.set(p.id, { id: p.id, name: p.name || "anon", x: p.x|0, y: p.y|0, prevX: prev?.x ?? p.x|0, prevY: prev?.y ?? p.y|0 });
  ensureHerd(p.id); // make sure they have a herd instance
});
net.onRemove((id) => {
  players.delete(id);
  // keep their herd around (spectator mode) or remove it:
  // if you want to remove: herds.delete(id);
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
    // spawn 2 for a new player; if host will simulate, else follower waits for snapshot
    if (id === myId) mgr.addSheep(2, player);
    herds.set(id, mgr);
  }
}

/* Create my own herd immediately; myId is known shortly after connect, but we can use a temp key */
let selfKey = "self";
ensureHerd(selfKey);

/* ===== WOLVES ===== */
const wolves = createWolvesManager({ TILE, WORLD, ringAt: world.ringAt });

/* ===== HOST ELECTION (first in room after a moment) ===== */
let isHost = false;
setTimeout(() => {
  isHost = (net.others.size === 0);          // first in becomes host
  // Set authority flags on all herds
  for (const [id, mgr] of herds) mgr.setAuthority(isHost);
}, 700);

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
  // show my herd count + total players
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

  // Send my position (everyone)
  if (now - lastPlayerSend > NET_PLAYER_SEND_MS) {
    net.setState(player.x, player.y, myName);
    lastPlayerSend = now;
  }

  // Update herds
  const cam = cameraRect();
  const movingSelf = (held.up || held.down || held.left || held.right);

  // ensure we have myId
  if (!myId && net.myId) myId = net.myId;
  if (myId && herds.has(selfKey) && !herds.has(myId)) {
    // rename temp herd key to my real id
    const mgr = herds.get(selfKey);
    herds.delete(selfKey);
    herds.set(myId, mgr);
  }
  // Always ensure we have our own entry in players map too
  if (myId && !players.has(myId)) {
    players.set(myId, { id: myId, name: myName, x: player.x, y: player.y, prevX: player.x, prevY: player.y });
  }

  // HOST: simulate all herds + wolves
  if (isHost) {
    // 1) Update player entries (host keeps latest self position)
    const me = players.get(myId);
    if (me) { me.prevX = me.x; me.prevY = me.y; me.x = player.x; me.y = player.y; }

    // 2) For each herd, compute moving flag by tile delta, then update
    for (const [pid, mgr] of herds) {
      // find leader (player position)
      const p = players.get(pid) || (pid === myId ? { x: player.x, y: player.y, prevX: player.x, prevY: player.y } : null);
      if (!p) continue;
      const moving = (p.x !== p.prevX || p.y !== p.prevY) || (pid === myId && movingSelf);
      const leaderProxy = (pid === myId)
        ? player
        : { x: p.x, y: p.y, moveCooldown: 0 }; // minimal shape used by sheepMgr

      mgr.update(now, dt, { player: leaderProxy, moving, seekFood: (x,y,maxT)=>nearestPatchInTiles(x,y,maxT) });

      // GRAZING (hungry first per herd)
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

      // Store back prev positions
      if (p) { p.prevX = p.x; p.prevY = p.y; }
    }

    // 3) Wolves: build a combined target list that includes herdId + index
    const targetList = [];
    for (const [pid, mgr] of herds) {
      for (let i = 0; i < mgr.list.length; i++) {
        targetList.push({ herdId: pid, idx: i, ref: mgr.list[i] });
      }
    }
    wolves.update(now, dt, targetList, (hitIndexInCombined) => {
      // remove that sheep from its originating herd
      const t = targetList[hitIndexInCombined];
      if (!t) return;
      const mgr = herds.get(t.herdId);
      if (mgr && mgr.list[t.idx]) {
        mgr.list.splice(t.idx, 1);
      }
    });

    // 4) Respawn patches
    foodRespawnTimer += dt;
    if (foodRespawnTimer >= FOOD_RESPAWN_EVERY_MS) {
      foodRespawnTimer = 0;
      if (foodPatches.size < FOOD_PATCH_COUNT) {
        const one = createFoodPatches({ WORLD, ringAt: world.ringAt }, 1);
        for (const k of one) foodPatches.add(k);
      }
    }

    // 5) Broadcast snapshot (all herds + patches + wolves)
    if (now - lastWorldSend > NET_WORLD_SEND_MS) {
      const herdsSnap = {};
      for (const [pid, mgr] of herds) herdsSnap[pid] = mgr.serialize();
      const patches = [...foodPatches];
      const wolfSnap = (wolves.serialize ? wolves.serialize() : []);
      net.sendSheepSnapshot({ herds: herdsSnap, patches, wolves: wolfSnap });
      lastWorldSend = now;
    }
  }
  else {
    // FOLLOWERS: keep my own herd locally responsive (visual feel) while still overwritten by snapshots
    const myMgr = herds.get(myId) || herds.get(selfKey);
    if (myMgr) {
      myMgr.update(now, dt, { player, moving: movingSelf, seekFood: (x,y,m)=>nearestPatchInTiles(x,y,m) });
    }
  }

  /* ==== RENDER ==== */
  // world + FX
  ctx.drawImage(world.mapLayer, cam.x, cam.y, cam.w, cam.h, 0, 0, canvas.width, canvas.height);
  drawVisibleFX(ctx, cam, now, { TILE, WORLD, ringAt: world.ringAt });

  // bridges + patches (under entities)
  drawBridges(ctx, cam, TILE, bridgeTiles);
  drawFoodPatches(ctx, cam, TILE, foodPatches);

  // wolves (draw above patches, below players)
  wolves.draw(ctx, cam, TILE);

  // draw all herds (draw mine last so it's on top)
  for (const [pid, mgr] of herds) {
    if (pid === myId) continue;
    mgr.draw(ctx, cam);
  }
  const myMgr = herds.get(myId) || herds.get(selfKey);
  if (myMgr) myMgr.draw(ctx, cam);

  // draw my player (you can also draw other players if you want — omitted for now)
  drawPlayer(ctx, player, TILE, cam);

  // UI
  drawMinimap(ctx, world.mapLayer, cam, player, { TILE, WORLD, worldPx: world.worldPx, MINIMAP });
  drawHUD();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);