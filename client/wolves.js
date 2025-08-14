// client/wolves.js
"use strict";
import { Sprites, drawSpriteCentered } from "./sprites.js";

/**
 * Wolves manager (multi‑herd aware via callback):
 * - Host: spawns in glen/dark, chases nearest sheep across ALL herds.
 * - update(now, dtMs, targetList, onKillIndex)
 *     targetList: [{ herdId, idx, ref:{x,y,...} }, ...]
 *     onKillIndex(k): host removes targetList[k] from its herd.
 * - Followers: applySnapshot() from host; no spawning logic used.
 */
export function createWolvesManager({ TILE, WORLD, ringAt }) {
  const packs = []; // each wolf: { x, y, vx, vy, life }

  // Tunables
  const SPEED = TILE * 9.5;
  const LIFE_MS = 8000;
  const SPAWN_EVERY_MS = 4500;
  const MAX_ACTIVE = 5;

  let spawnTimer = 0;

  function randomSpawnTile() {
    let tries = 0;
    while (tries++ < 200) {
      const x = Math.floor(Math.random() * WORLD);
      const y = Math.floor(Math.random() * WORLD);
      const r = ringAt(x, y);
      if (r === "glen" || r === "dark") return { x: x*TILE + TILE/2, y: y*TILE + TILE/2 };
    }
    return { x: (WORLD/2)*TILE, y: (WORLD/2)*TILE };
  }

  function update(now, dtMs, targetList, onKillIndex) {
    const dt = Math.max(0.001, dtMs/1000);

    // Host-only spawns: if targetList exists/has sheep
    spawnTimer += dtMs;
    if (targetList && targetList.length && packs.length < MAX_ACTIVE && spawnTimer >= SPAWN_EVERY_MS) {
      spawnTimer = 0;
      const pos = randomSpawnTile();
      packs.push({ x: pos.x, y: pos.y, vx: 0, vy: 0, life: LIFE_MS });
    }

    // Move/seek & lifetime
    for (let i = packs.length - 1; i >= 0; i--) {
      const w = packs[i];
      w.life -= dtMs;
      if (w.life <= 0) { packs.splice(i,1); continue; }

      // Find nearest sheep across all herds
      let nearestIdx = -1, nd2 = Infinity;
      if (targetList) {
        for (let k = 0; k < targetList.length; k++) {
          const s = targetList[k].ref;
          const dx = s.x - w.x, dy = s.y - w.y;
          const d2 = dx*dx + dy*dy;
          if (d2 < nd2) { nd2 = d2; nearestIdx = k; }
        }
      }

      // Chase
      if (nearestIdx >= 0) {
        const s = targetList[nearestIdx].ref;
        const dx = s.x - w.x, dy = s.y - w.y;
        const d  = Math.hypot(dx, dy) || 1;
        const sps = SPEED;
        w.vx = (dx/d) * sps;
        w.vy = (dy/d) * sps;

        // If very close, kill callback & despawn
        if (Math.hypot(dx, dy) < TILE * 0.6) {
          if (typeof onKillIndex === "function") onKillIndex(nearestIdx);
          packs.splice(i,1);
          continue;
        }
      } else {
        // idle drift
        w.vx *= 0.96; w.vy *= 0.96;
      }

      w.x += w.vx * dt;
      w.y += w.vy * dt;
    }
  }

  function draw(ctx, cam, TILE) {
    for (const w of packs) {
      const sx = w.x - cam.x, sy = w.y - cam.y;

      // shadow
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath(); ctx.ellipse(sx, sy + TILE*0.18, TILE*0.30, TILE*0.16, 0, 0, Math.PI*2);
      ctx.fill(); ctx.restore();

      if (!drawSpriteCentered(ctx, Sprites.wolf, sx, sy, TILE*1.1, TILE*1.1, 1)) {
        // fallback
        ctx.beginPath(); ctx.arc(sx, sy, TILE*0.38, 0, Math.PI*2);
        ctx.fillStyle = "#444"; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = "#1c1c1c"; ctx.stroke();
      }
    }
  }

  function serialize() {
    return packs.map(w => [Math.round(w.x), Math.round(w.y), Math.round(w.vx), Math.round(w.vy), Math.max(0, Math.round(w.life))]);
  }
  function applySnapshot(arr) {
    while (packs.length < arr.length) packs.push({ x:0,y:0,vx:0,vy:0,life:LIFE_MS });
    while (packs.length > arr.length) packs.pop();
    for (let i=0;i<arr.length;i++){
      const [x,y,vx,vy,life] = arr[i];
      const w = packs[i];
      w.x = x; w.y = y; w.vx = vx; w.vy = vy; w.life = life;
    }
  }

  return { update, draw, serialize, applySnapshot };
}