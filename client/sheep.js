// client/sheep.js
"use strict";
import { Sprites, drawSpriteCentered } from "./sprites.js";

/**
 * Sheep manager:
 * - Follow player with personal offsets
 * - Seek nearby food when idle & hungry
 * - Smooth velocity blending + separation
 * - Sprite render with hunger ring
 * - ✅ Clamp uses the SAME tile-space circle as player (no more lopsided rim)
 */
export function createSheepManager(env) {
  const { TILE, WORLD, edges, radial } = env; // keep radial from map (uses +0.5 center)

  /* ===== Tunables ===== */
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

  const sheep = []; // {x,y,vx,vy,phase,full,cd,ox,oy}

  /* ===== Helpers ===== */
  const cx = Math.floor(WORLD/2);
  const cy = Math.floor(WORLD/2);

  // EXACT same limit the player uses
  const LIMIT_TILES = edges.pasture + 0.2;

  // Clamp a PIXEL position by doing the math in TILE space (matching player)
  function clampToPasturePx(xPx, yPx) {
    const xT = xPx / TILE;
    const yT = yPx / TILE;
    const dx = xT - cx + 0.5;
    const dy = yT - cy + 0.5;
    const d  = Math.hypot(dx, dy);
    if (d <= LIMIT_TILES || d < 1e-6) return { x: xPx, y: yPx };
    const s = LIMIT_TILES / d;
    const clampedXT = (cx - 0.5) + dx * s;
    const clampedYT = (cy - 0.5) + dy * s;
    return { x: clampedXT * TILE, y: clampedYT * TILE };
  }

  const lerp = (a,b,t)=> a + (b-a)*t;
  const blendFactor = (k, dt)=> 1 - Math.exp(-Math.max(0,k)*dt);
  function normTo(vx, vy, mag){
    const d = Math.hypot(vx, vy);
    if (d < 1e-6) return { vx: 0, vy: 0 };
    const s = mag / d;
    return { vx: vx * s, vy: vy * s };
  }

  // Shrink offsets as the player nears the rim to keep targets inside the same circle
  function shrinkedOffset(px, py, ox, oy){
    // compute how much room (in tiles) remains at player's tile-space radius
    const pXT = px / TILE, pYT = py / TILE;
    const dPlayer = radial(pXT, pYT); // same +0.5 bias as map
    const roomTiles = Math.max(0, LIMIT_TILES - dPlayer - 0.15); // small buffer
    const wantTiles = (Math.hypot(ox, oy) / TILE) || 1;
    const scale = Math.min(1, roomTiles / wantTiles);
    return { ox: ox * scale, oy: oy * scale };
  }

  /* ===== API ===== */
  function addSheep(n, player) {
    const px = player.x * TILE + TILE / 2;
    const py = player.y * TILE + TILE / 2;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r   = OFFSET_RADIUS * (0.6 + Math.random() * 0.8);
      const ox  = Math.cos(ang) * r;
      const oy  = Math.sin(ang) * r;
      const spawn = clampToPasturePx(px + ox, py + oy);
      sheep.push({
        x: spawn.x, y: spawn.y,
        vx: 0, vy: 0,
        phase: Math.random() * Math.PI * 2,
        full: 0, cd: 0,
        ox, oy
      });
    }
  }

  function eat(s, meals = 1) {
    if (!s) return;
    s.full = Math.min(MEALS_TO_BREED, s.full + Math.max(0, meals));
  }

  function tryBreed(player, dtMs) {
    for (const s of sheep) s.cd = Math.max(0, s.cd - dtMs);
    const ready = sheep.filter(s => s.full >= MEALS_TO_BREED && s.cd === 0);
    if (ready.length >= 2) {
      ready[0].full = 0; ready[1].full = 0;
      ready[0].cd = BREED_COOLDOWN_MS;
      ready[1].cd = BREED_COOLDOWN_MS;
      addSheep(1, player);
    }
  }

  function update(now, dtMs, { player, moving, seekFood }) {
    const dt = Math.max(0.001, dtMs / 1000);
    const px = player.x * TILE + TILE / 2;
    const py = player.y * TILE + TILE / 2;

    const alpha = blendFactor(BLEND_RATE_S, dt);
    const brake = Math.exp(-STOP_DECAY_S * dt);

    for (let i = 0; i < sheep.length; i++) {
      const s = sheep[i];

      // desired velocity
      let dvx = 0, dvy = 0;

      if (moving) {
        // clamp the TARGET (player + offset) in the same circle
        const off = shrinkedOffset(px, py, s.ox, s.oy);
        let tx = px + off.ox, ty = py + off.oy;
        ({ x: tx, y: ty } = clampToPasturePx(tx, ty));
        const toT = normTo(tx - s.x, ty - s.y, FOLLOW_SPEED);
        dvx = toT.vx; dvy = toT.vy;

      } else if (s.full < MEALS_TO_BREED && typeof seekFood === "function") {
        const found = seekFood(s.x, s.y, SEEK_TILES);
        if (found) {
          const fx = found.tx * TILE + TILE/2;
          const fy = found.ty * TILE + TILE/2;
          const tgt = clampToPasturePx(fx, fy);
          const toF = normTo(tgt.x - s.x, tgt.y - s.y, SEEK_SPEED);
          dvx = toF.vx; dvy = toF.vy;
        }
      }

      // separation
      for (let j = 0; j < sheep.length; j++) {
        if (j === i) continue;
        const o = sheep[j];
        const dx = s.x - o.x, dy = s.y - o.y;
        const d  = Math.hypot(dx, dy);
        if (d > 1e-6 && d < SEP_RADIUS) {
          const push = (SEP_RADIUS - d) / SEP_RADIUS;
          dvx += (dx / d) * SEP_PUSH * push * dt;
          dvy += (dy / d) * SEP_PUSH * push * dt;
        }
      }

      // blend velocity
      s.vx = lerp(s.vx, dvx, alpha);
      s.vy = lerp(s.vy, dvy, alpha);

      if (dvx === 0 && dvy === 0) {
        s.vx *= brake; s.vy *= brake;
        if (Math.abs(s.vx) < 0.02) s.vx = 0;
        if (Math.abs(s.vy) < 0.02) s.vy = 0;
      }

      s.x += s.vx * dt;
      s.y += s.vy * dt;

      // final safety clamp — same circle as player
      const c = clampToPasturePx(s.x, s.y);
      s.x = c.x; s.y = c.y;

      s.phase += dt * 0.9;
    }

    tryBreed(player, dtMs);
  }

  function draw(ctx, cam) {
    for (let i = 0; i < sheep.length; i++) {
      const s = sheep[i];
      const sx = s.x - cam.x, sy = s.y - cam.y;

      // shadow
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath(); ctx.ellipse(sx, sy + TILE*0.18, TILE*0.26, TILE*0.14, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();

      // sprite — slightly bigger than a tile
      const size = TILE * 1.05;
      const drawn = drawSpriteCentered(ctx, Sprites.sheep, sx, sy, size, size, 1);

      if (!drawn){
        // fallback: cute circle
        const r = TILE * 0.28 + Math.sin((s.phase + i) * 0.8) * 0.5;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = "#1c1c1c"; ctx.stroke();
      }

      // HUNGER RING
      if (s.full > 0) {
        const portion = s.full / MEALS_TO_BREED;
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        const ringR = TILE * 0.38;
        ctx.beginPath();
        ctx.arc(sx, sy, ringR, -Math.PI/2, -Math.PI/2 + Math.PI*2*portion);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  return {
    list: sheep,
    addSheep,
    eat,
    update,
    draw,
    get count(){ return sheep.length; },
    get mealsToBreed(){ return MEALS_TO_BREED; }
  };
}