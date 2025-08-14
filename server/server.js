// Authoritative Shepherd server (WebSocket, minimal)
// Run locally:
//   cd server && npm i && node server.js
// Deploy: provide PORT env (Railway sets PORT automatically)

import { WebSocketServer } from "ws";

/* ===== WORLD CONFIG (match client) ===== */
const TILE    = 20;
const WORLD   = 200;
const STEP_MS = 90;            // movement cadence
const TICK_MS = 100;           // server sim step (~10 fps)
const SNAP_MS = 100;           // snapshot rate (same as tick for now)

const cx = Math.floor(WORLD/2);
const cy = Math.floor(WORLD/2);
const maxR = Math.min(cx, cy) - 1;

let rPasture = Math.floor(maxR * 0.45);
let rWater   = Math.floor(maxR * 0.17);
let rGlen    = Math.floor(maxR * 0.25);
let rDark    = Math.max(2, maxR - (rPasture + rWater + rGlen));
while (rPasture + rWater + rGlen + rDark > maxR) {
  if (rPasture > 8) rPasture--;
  else if (rGlen > 6) rGlen--;
  else if (rWater > 4) rWater--;
  else { rDark = Math.max(2, rDark - 1); break; }
}
const edges = {
  pasture: maxR,
  water:   maxR - rPasture,
  glen:    maxR - rPasture - rWater,
  dark:    maxR - rPasture - rWater - rGlen
};

function radial(x, y){ const dx=x-cx+0.5, dy=y-cy+0.5; return Math.sqrt(dx*dx+dy*dy); }
function ringAt(x, y){
  const r = radial(x, y);
  if (r > edges.water) return "pasture";
  if (r > edges.glen)  return "water";
  if (r > edges.dark)  return "glen";
  return "dark";
}
const tileKey = (x,y)=>`${x},${y}`;

/* ===== BRIDGES (match client: full rays across the water ring) ===== */
function buildBridges(){
  const bridges = [];

  // walk outward from center; collect every WATER tile on a straight ray
  function addBridge(dx, dy) {
    // big enough to reach beyond the water band
    const maxSteps = Math.max(cx, cy) + 2;
    for (let i = 0; i <= maxSteps; i++) {
      const x = cx + dx * i;
      const y = cy + dy * i;
      const ring = ringAt(x, y);
      if (ring === "water") bridges.push({ x, y });
      // once we've gone past the water band back into pasture, stop this ray
      if (ring === "pasture" && i > 0) break;
    }
  }

  // N / E / S / W rays
  addBridge( 0, -1);
  addBridge( 1,  0);
  addBridge( 0,  1);
  addBridge(-1,  0);

  return bridges;
}

const bridges = buildBridges();
const bridgeSet = new Set(bridges.map(b=>tileKey(b.x,b.y)));

/* ===== FOOD ===== */
const FOOD_PATCH_COUNT = 140;
const FOOD_RESPAWN_EVERY_MS = 1500;
function createFoodPatches(n) {
  const set = new Set();
  let guard = 0;
  while (set.size < n && guard < n*50) {
    guard++;
    const x = Math.floor(Math.random()*WORLD);
    const y = Math.floor(Math.random()*WORLD);
    if (ringAt(x,y) !== "pasture") continue;
    set.add(tileKey(x,y));
  }
  return set;
}

/* ===== SHEEP / WOLVES SIM ===== */
const FOLLOW_SPEED   = TILE * 14.0;
const SEEK_SPEED     = TILE * 13.0;
const BLEND_RATE_S   = 9.0;
const STOP_DECAY_S   = 7.0;
const OFFSET_RADIUS  = TILE * 1.2;
const SEP_RADIUS     = TILE * 1.0;
const SEP_PUSH       = TILE * 60;
const SEEK_TILES     = 5;

const MEALS_TO_BREED    = 3;
const BREED_COOLDOWN_MS = 8000;

const blendFactor = (k, dt)=> 1 - Math.exp(-Math.max(0,k)*dt);
function normTo(vx,vy,mag){ const d=Math.hypot(vx,vy)||1; const s=mag/d; return {vx:vx*s,vy:vy*s}; }

function nearestPatchInTiles(foodPatches, xPx, yPx, maxTiles){
  const tx0 = Math.floor(xPx / TILE), ty0 = Math.floor(yPx / TILE);
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

/* ===== Authoritative State ===== */
const players = new Map(); // id -> {id,name,x,y,held,moveCooldown}
const herds   = new Map(); // id -> [{x,y,vx,vy,full,cd,ox,oy,phase}]
let wolves    = [];        // [{x,y,vx,vy,target|null,lifeMs}]
let foodPatches = createFoodPatches(FOOD_PATCH_COUNT);
let foodRespawnTimer = 0;

/* Helpers */
function spawnOnPasture(){
  // near outer pasture ring
  for (let g=0; g<2000; g++){
    const x = Math.floor(Math.random()*WORLD);
    const y = Math.floor(Math.random()*WORLD);
    if (ringAt(x,y)==="pasture") return {x,y};
  }
  return {x:cx, y:edges.pasture-2};
}
function ensureHerd(id){
  if (herds.has(id)) return;
  const p = players.get(id);
  const px = p.x*TILE + TILE/2, py = p.y*TILE + TILE/2;
  const flock = [];
  for (let i=0;i<2;i++){
    const ang = Math.random()*Math.PI*2;
    const r   = OFFSET_RADIUS*(0.6+Math.random()*0.8);
    const ox  = Math.cos(ang)*r, oy = Math.sin(ang)*r;
    flock.push({ x:px+ox, y:py+oy, vx:0, vy:0, full:0, cd:0, ox, oy, phase:Math.random()*6.28 });
  }
  herds.set(id, flock);
}
function canWalk(nx,ny){
  if (nx<0||ny<0||nx>=WORLD||ny>=WORLD) return false;
  const r = ringAt(nx,ny);
  if (r === "water") return bridgeSet.has(tileKey(nx,ny));
  return r !== "dark"; // block dark forest for now
}

/* ===== Wolves tuning (NEW) ===== */
const WOLF_MAX = 5;                // soft cap (was 6)
const WOLF_SPAWN_CHANCE = 0.05;   // ~0.4% per tick (was 2%) ⇒ ~1 every ~25s on average
const WOLF_LIFE_MS = 30000;        // wolves despawn after 15 seconds if still around

/* Wolves: spawn in glen/dark and roam; if nearby any sheep, chase */
function spawnWolf(){
  // try to place in glen or dark
  for (let g=0; g<1000; g++){
    const x = Math.floor(Math.random()*WORLD);
    const y = Math.floor(Math.random()*WORLD);
    const r = ringAt(x,y);
    if (r==="glen" || r==="dark") {
      wolves.push({
        x:x*TILE+TILE/2,
        y:y*TILE+TILE/2,
        vx:0, vy:0,
        target:null,
        life: WOLF_LIFE_MS,   // NEW: lifetime countdown in ms
      });
      return;
    }
  }
}

function updateWolves(dt, allTargets){
  // spawn with lower chance up to lower cap
  if (wolves.length < WOLF_MAX && Math.random() < WOLF_SPAWN_CHANCE) spawnWolf();

  const SPEED = TILE*9.5;
  const DRIFT = TILE*2.0;

  // iterate backwards so we can remove wolves that expire
  for (let i = wolves.length - 1; i >= 0; i--) {
    const w = wolves[i];

    // NEW: lifetime countdown & despawn
    w.life = (w.life ?? WOLF_LIFE_MS) - TICK_MS;
    if (w.life <= 0) { wolves.splice(i, 1); continue; }

    let tx = null, ty = null;

    // pick closest target sheep
    let best = null;
    for (const t of allTargets) {
      const dx = t.ref.x - w.x, dy = t.ref.y - w.y;
      const d2 = dx*dx + dy*dy;
      if (!best || d2 < best.d2) best = { d2, t };
    }
    if (best && Math.random()<0.9) {
      w.target = { id: best.t.herdId, idx: best.t.idx };
      tx = best.t.ref.x; ty = best.t.ref.y;
    } else {
      // drift randomly
      tx = w.x + (Math.random()-0.5)*DRIFT*TICK_MS/1000;
      ty = w.y + (Math.random()-0.5)*DRIFT*TICK_MS/1000;
    }

    const to = normTo(tx - w.x, ty - w.y, SPEED);
    w.vx = to.vx; w.vy = to.vy;

    w.x += w.vx * dt;
    w.y += w.vy * dt;
  }
}

/* ===== WS server ===== */
const PORT = process.env.PORT || 8787;
const wss = new WebSocketServer({ port: PORT });
console.log("Shepherd server listening on", PORT);

function send(ws, obj){ try { ws.send(JSON.stringify(obj)); } catch {} }

function broadcast(obj){
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) { try { client.send(data); } catch {} }
  }
}

/* Connection lifecycle */
wss.on("connection", (ws) => {
  ws.id = Math.random().toString(36).slice(2,10);
  ws.held = {up:false,down:false,left:false,right:false};
  ws.name = "Shep_" + ws.id.slice(0,4);

  const spawn = spawnOnPasture();
  players.set(ws.id, { id: ws.id, name: ws.name, x: spawn.x, y: spawn.y, held: ws.held, moveCooldown: 0 });
  ensureHerd(ws.id);

  // greet with a tiny hello
  send(ws, { type: "hello", id: ws.id, name: ws.name });

  ws.on("message", (buf) => {
    let msg = null;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "join" && typeof msg.name === "string" && msg.name.trim()) {
      ws.name = msg.name.trim().slice(0,24);
      const p = players.get(ws.id);
      if (p) p.name = ws.name;
    }
    if (msg.type === "input" && msg.held) {
      ws.held = {
        up: !!msg.held.up,
        down: !!msg.held.down,
        left: !!msg.held.left,
        right: !!msg.held.right
      };
      const p = players.get(ws.id);
      if (p) p.held = ws.held;
    }
  });

  ws.on("close", () => {
    players.delete(ws.id);
    herds.delete(ws.id);
  });
});

/* ===== Server simulation loop ===== */
let last = Date.now();
let accumSnap = 0;
setInterval(() => {
  const now = Date.now();
  const dtMs = now - last;
  last = now;
  const dt = Math.max(0.001, dtMs/1000);
  accumSnap += dtMs;

  // advance players on a cadence (grid)
  for (const [id, p] of players) {
    p.moveCooldown -= dtMs;
    if (p.moveCooldown <= 0) {
      const dir = p.held.up ? [0,-1] : p.held.down ? [0,1] : p.held.left ? [-1,0] : p.held.right ? [1,0] : null;
      if (dir) {
        const nx = p.x + dir[0], ny = p.y + dir[1];
        if (canWalk(nx, ny)) { p.x = nx; p.y = ny; }
        p.moveCooldown = STEP_MS;
      }
    }
  }

  // simulate each herd (follow + seek + graze + breed)
  for (const [id, flock] of herds) {
    const p = players.get(id);
    if (!p) continue;
    const px = p.x*TILE + TILE/2, py = p.y*TILE + TILE/2;

    const alpha = blendFactor(BLEND_RATE_S, dt);
    const brake = Math.exp(-STOP_DECAY_S * dt);

    for (let i=0;i<flock.length;i++) {
      const s = flock[i];
      let dvx=0, dvy=0;
      const moving = p.held.up||p.held.down||p.held.left||p.held.right;

      if (moving) {
        const to = normTo(px + s.ox - s.x, py + s.oy - s.y, FOLLOW_SPEED);
        dvx = to.vx; dvy = to.vy;
      } else if (s.full < MEALS_TO_BREED) {
        const found = nearestPatchInTiles(foodPatches, s.x, s.y, SEEK_TILES);
        if (found) {
          const fx = found.tx*TILE + TILE/2, fy = found.ty*TILE + TILE/2;
          const to = normTo(fx - s.x, fy - s.y, SEEK_SPEED);
          dvx = to.vx; dvy = to.vy;
        }
      }

      // separation
      for (let j=0;j<flock.length;j++){
        if (i===j) continue;
        const o = flock[j];
        const dx = s.x - o.x, dy = s.y - o.y;
        const d  = Math.hypot(dx,dy);
        if (d>1e-6 && d<SEP_RADIUS) {
          const push = (SEP_RADIUS - d) / SEP_RADIUS;
          dvx += (dx/d) * SEP_PUSH * push * dt;
          dvy += (dy/d) * SEP_PUSH * push * dt;
        }
      }

      // blend velocity + stop decay
      s.vx = s.vx + (dvx - s.vx) * alpha;
      s.vy = s.vy + (dvy - s.vy) * alpha;
      if (dvx===0 && dvy===0) { s.vx *= brake; s.vy *= brake; }

      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.phase += dt * 0.9;

      // grazing
      const tx = Math.floor(s.x / TILE), ty = Math.floor(s.y / TILE);
      const key = tileKey(tx,ty);
      if (s.full < MEALS_TO_BREED && foodPatches.has(key)) {
        foodPatches.delete(key);
        s.full = Math.min(MEALS_TO_BREED, s.full + 1);
      }

      // cooldown tick
      s.cd = Math.max(0, (s.cd||0) - dtMs);
    }

    // breed if 2 ready
    const ready = flock.filter(s => s.full >= MEALS_TO_BREED && s.cd === 0);
    if (ready.length >= 2) {
      ready[0].full = 0; ready[1].full = 0;
      ready[0].cd = BREED_COOLDOWN_MS;
      ready[1].cd = BREED_COOLDOWN_MS;
      // new lamb near player
      const ang = Math.random()*Math.PI*2;
      const r   = OFFSET_RADIUS*(0.6+Math.random()*0.8);
      const ox  = Math.cos(ang)*r, oy = Math.sin(ang)*r;
      flock.push({ x:px+ox, y:py+oy, vx:0, vy:0, full:0, cd:0, ox, oy, phase:Math.random()*6.28 });
    }
  }

  // wolves vs sheep
  const allTargets = [];
  for (const [id, flock] of herds) {
    for (let i=0;i<flock.length;i++) allTargets.push({ herdId:id, idx:i, ref:flock[i] });
  }
  updateWolves(dt, allTargets);

  // wolf capture check
  for (const w of wolves) {
    for (const t of allTargets) {
      const d = Math.hypot(w.x - t.ref.x, w.y - t.ref.y);
      if (d < TILE*0.6) {
        const flock = herds.get(t.herdId);
        if (flock) flock.splice(t.idx, 1);
        break;
      }
    }
  }

  // respawn patches
  foodRespawnTimer += dtMs;
  if (foodRespawnTimer >= FOOD_RESPAWN_EVERY_MS) {
    foodRespawnTimer = 0;
    if (foodPatches.size < FOOD_PATCH_COUNT) {
      const one = createFoodPatches(1);
      for (const k of one) foodPatches.add(k);
    }
  }

  // broadcast snapshot
  if (accumSnap >= SNAP_MS) {
    accumSnap = 0;

    const playersSnap = [];
    for (const [id,p] of players) playersSnap.push({ id, name:p.name, x:p.x, y:p.y });

    const herdsSnap = {};
    for (const [id,flock] of herds) {
      herdsSnap[id] = flock.map(s => [Math.round(s.x), Math.round(s.y), s.full|0, Math.max(0, s.cd|0)]);
    }

    // keep wolves snapshot as [x,y] pairs so the client code stays unchanged
    const wolvesSnap = wolves.map(w => [Math.round(w.x), Math.round(w.y)]);



    broadcast({
      type: "snapshot",
      players: playersSnap,
      herds: herdsSnap,
      wolves: wolvesSnap,
      patches: [...foodPatches]
    });
  }

}, TICK_MS);
