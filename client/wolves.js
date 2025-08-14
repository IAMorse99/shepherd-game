// client/wolves.js
"use strict";

/**
 * Wolves manager
 * - Spawns packs from glen/dark at random intervals
 * - Each wolf targets nearest sheep, snatches exactly one, then despawns
 * - If a wolf can't catch anything in time, it despawns
 */
export function createWolvesManager(env) {
  const { TILE, WORLD, ringAt } = env;

  // Tunables
  const SPEED_PX_S        = TILE * 8;     // wolf run speed
  const RETARGET_EVERY_MS = 400;           // how often to retarget nearest sheep
  const WOLF_LIFETIME_MS  = 18000;         // max chase time before despawn
  const PACK_MIN          = 1;
  const PACK_MAX          = 2;
  const SPAWN_MIN_MS      = 8000;          // random interval
  const SPAWN_MAX_MS      = 16000;

  const wolves = []; // [{x,y,vx,vy,targetId?,ttl,retimer,gotOne}]
  let spawnTimer = randMs(SPAWN_MIN_MS, SPAWN_MAX_MS);
  let lastSpawnFlashAt = 0;

  function randMs(a,b){ return Math.floor(a + Math.random()*(b-a)); }

  // pick a random tile in glen/dark rings
  function randomHostileTile() {
    for (let guard=0; guard<200; guard++){
      const x = Math.floor(Math.random()*WORLD);
      const y = Math.floor(Math.random()*WORLD);
      const r = ringAt(x,y);
      if (r === "glen" || r === "dark") return { x, y };
    }
    // fallback: anywhere
    return { x: Math.floor(Math.random()*WORLD), y: Math.floor(Math.random()*WORLD) };
  }

  function spawnPack(now) {
    const n = Math.floor(PACK_MIN + Math.random()*(PACK_MAX-PACK_MIN+1));
    for (let i=0;i<n;i++){
      const t = randomHostileTile();
      const x = t.x*TILE + TILE/2, y = t.y*TILE + TILE/2;
      wolves.push({
        x, y, vx:0, vy:0,
        retimer: 0,
        ttl: WOLF_LIFETIME_MS,
        gotOne: false
      });
    }
    lastSpawnFlashAt = now;
  }

  function nearestSheepTo(x,y,sheepList){
    if (!sheepList || sheepList.length === 0) return null;
    let best=null, bD2=Infinity, bi=-1;
    for (let i=0;i<sheepList.length;i++){
      const s = sheepList[i];
      const dx = s.x - x, dy = s.y - y;
      const d2 = dx*dx + dy*dy;
      if (d2 < bD2){ bD2 = d2; best = s; bi = i; }
    }
    return best ? { sheep: best, idx: bi, d2: bD2 } : null;
  }

  function update(now, dtMs, sheepList){
    // spawn logic
    spawnTimer -= dtMs;
    if (spawnTimer <= 0){
      spawnPack(now);
      spawnTimer = randMs(SPAWN_MIN_MS, SPAWN_MAX_MS);
    }

    // wolves move
    const dt = Math.max(0.001, dtMs/1000);
    for (let i=wolves.length-1;i>=0;i--){
      const w = wolves[i];
      w.ttl -= dtMs;
      if (w.ttl <= 0){ wolves.splice(i,1); continue; }

      // retarget
      w.retimer -= dtMs;
      if (w.retimer <= 0){
        w.retimer = RETARGET_EVERY_MS;
        const t = nearestSheepTo(w.x, w.y, sheepList);
        if (t) {
          const d = Math.sqrt(t.d2) || 1;
          w.vx = (t.sheep.x - w.x) / d * SPEED_PX_S;
          w.vy = (t.sheep.y - w.y) / d * SPEED_PX_S;
        } else {
          // no sheep; wander a bit
          const ang = Math.random()*Math.PI*2;
          w.vx = Math.cos(ang)*SPEED_PX_S*0.5;
          w.vy = Math.sin(ang)*SPEED_PX_S*0.5;
        }
      }

      // integrate
      w.x += w.vx * dt;
      w.y += w.vy * dt;

      // collision with sheep (exactly one capture)
      if (!w.gotOne && sheepList && sheepList.length){
        // find closest sheep again and check distance threshold
        const t = nearestSheepTo(w.x, w.y, sheepList);
        if (t){
          const capDist = TILE * 0.6;
          if (t.d2 <= capDist*capDist){
            // remove that sheep
            const idx = sheepList.indexOf(t.sheep);
            if (idx >= 0) sheepList.splice(idx,1);
            w.gotOne = true;
            // brief linger then despawn fast
            w.ttl = Math.min(w.ttl, 400);
          }
        }
      }

      // if captured, slow down a bit (visual)
      if (w.gotOne){ w.vx *= 0.95; w.vy *= 0.95; }
    }
  }

  function draw(ctx, cam, TILE){
    // spawn flash banner
    if (performance.now() - lastSpawnFlashAt < 1200){
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      const w = 200, h = 32;
      const x = (ctx.canvas.width - w)/2, y = 16;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#ffdddd";
      ctx.font = "16px system-ui, sans-serif";
      ctx.fillText("WOLVES!", x+60, y+22);
      ctx.restore();
    }

    // wolves
    for (const w of wolves){
      const sx = w.x - cam.x, sy = w.y - cam.y;
      ctx.save();
      // body
      ctx.fillStyle = w.gotOne ? "#5a2b2b" : "#333333";
      ctx.beginPath();
      ctx.arc(sx, sy, TILE*0.35, 0, Math.PI*2);
      ctx.fill();
      // head / direction
      const ang = Math.atan2(w.vy, w.vx);
      const hx = sx + Math.cos(ang)*TILE*0.45;
      const hy = sy + Math.sin(ang)*TILE*0.45;
      ctx.beginPath();
      ctx.arc(hx, hy, TILE*0.2, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  return {
    update,
    draw
  };
}