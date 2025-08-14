// client/sheep.js
"use strict";
import { Sprites, drawSpriteCentered } from "./sprites.js";

/**
 * Sheep manager — NO map bounds. Sheep are only constrained to stay
 * within a radius of the PLAYER (a moving “herd circle”).
 *
 * Behavior:
 * - When movement keys are held: follow player with a small personal offset.
 * - When idle & hungry: seek the nearest food patch within a few tiles.
 * - Otherwise: stay put (no random wandering).
 * - Smooth velocity + light separation so they don’t stack.
 * - Sprites with a simple hunger ring.
 */
export function createSheepManager(env) {
  const { TILE, WORLD } = env; // edges/radial not needed anymore

  /* ===== Tunables ===== */
  const HERD_RADIUS_TILES = 10;             // how far sheep may stray from player
  const HERD_RADIUS_PX    = HERD_RADIUS_TILES * TILE;

  const FOLLOW_SPEED   = TILE * 14.0;       // keep up with player
  const SEEK_SPEED     = TILE * 13.0;
  const BLEND_RATE_S   = 9.0;               // velocity smoothing
  const STOP_DECAY_S   = 7.0;

  const OFFSET_RADIUS  = TILE * 1.2;        // personal offset radius
  const SEP_RADIUS     = TILE * 1.0;        // separation distance
  const SEP_PUSH       = TILE * 60;         // separation strength

  const SEEK_TILES     = 5;                 // how far to look for food (in tiles)

  const MEALS_TO_BREED    = 3;
  const BREED_COOLDOWN_MS = 8000;

  const sheep = []; // {x,y,vx,vy,phase,full,cd,ox,oy}

  /* ===== Math helpers ===== */
  const lerp = (a,b,t)=> a + (b-a)*t;
  const blendFactor = (k, dt)=> 1 - Math.exp(-Math.max(0,k)*dt);
  function normTo(vx, vy, mag){
    const d = Math.hypot(vx, vy);
    if (d < 1e-6) return { vx: 0, vy: 0 };
    const s = mag / d;
    return { vx: vx * s, vy: vy * s };
  }

  // Keep a point within herd circle around (px,py)
  function clampToHerd(x, y, px, py) {
    const dx = x - px, dy = y - py;
    const d  = Math.hypot(dx, dy);
    if (d <= HERD_RADIUS_PX || d < 1e-6) return { x, y };
    const s = HERD_RADIUS_PX / d;
    return { x: px + dx * s, y: py + dy * s };
  }

  // Clamp a TARGET point into herd circle (prevents “unreachable” targets)
  function clampTargetToHerd(tx, ty, px, py) {
    return clampToHerd(tx, ty, px, py);
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
      const spawn = clampToHerd(px + ox, py + oy, px, py);
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

  /**
   * update(now, dtMs, { player, moving, seekFood })
   * - moving: boolean — keys held (from main)
   * - seekFood(xPx, yPx, maxTiles) => {tx,ty,distTiles} | null
   */
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
        // follow target = player + personal offset (clamped to herd circle)
        let tx = px + s.ox, ty = py + s.oy;
        ({ x: tx, y: ty } = clampTargetToHerd(tx, ty, px, py));
        const toT = normTo(tx - s.x, ty - s.y, FOLLOW_SPEED);
        dvx = toT.vx; dvy = toT.vy;

      } else if (s.full < MEALS_TO_BREED && typeof seekFood === "function") {
        // seek food only if within a few tiles
        const found = seekFood(s.x, s.y, SEEK_TILES);
        if (found) {
          let fx = found.tx * TILE + TILE/2;
          let fy = found.ty * TILE + TILE/2;
          ({ x: fx, y: fy } = clampTargetToHerd(fx, fy, px, py)); // keep goal inside herd circle
          const toF = normTo(fx - s.x, fy - s.y, SEEK_SPEED);
          dvx = toF.vx; dvy = toF.vy;
        }
      }
      // else: no target → stand still (unless separation pushes a bit)

      // separation (light)
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

      // final clamp to the HERD circle (only player-relative)
      ({ x: s.x, y: s.y } = clampToHerd(s.x, s.y, px, py));

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