// client/sheep.js
"use strict";

/**
 * Sheep manager (smooth flocking, tight follow):
 * - Smooth steering (lerped velocity, capped force)
 * - Stay with player; catch-up boost when far behind
 * - Only wander when hungry AND a food patch is within seek range
 * - Hungry sheep drift to nearby food (seekFood callback from main)
 * - Breed: two full sheep off cooldown spawn a lamb
 */
export function createSheepManager(env) {
  const { TILE, WORLD, edges, radial } = env;

  // ====== Tunables ======
  // Speeds
  const BASE_MAX_SPEED   = TILE * 10;   // normal top speed
  const RUN_SPEED        = TILE * 14;   // when player is moving
  const CATCHUP_SPEED    = TILE * 18;   // when far from player anchor

  // Steering / smoothing
  const MAX_FORCE        = TILE * 40;   // px/s^2 cap on steering force
  const VEL_LERP         = 0.18;        // 0..1 how much of new vel we keep each tick

  // Flocking radii
  const VIEW_RADIUS      = TILE * 5;    // neighbor awareness
  const SEP_RADIUS       = TILE * 1.7;  // keep a bit of “personal space”
  const ALIGN_RADIUS     = TILE * 3.6;

  // Weights
  const W_SEP            = 1.9;
  const W_ALIGN          = 0.55;
  const W_COHESION       = 1.6;         // pull toward player anchor
  const W_FOOD           = 1.9;         // hungry drift → food

  // Player anchor handling
  const ANCHOR_RADIUS    = TILE * 6;    // “close enough” to player
  const CATCHUP_RADIUS   = TILE * 14;   // beyond this, use catch-up speed

  // Food seeking (only if hungry)
  const IDLE_SEEK_TILES  = 5;           // search radius in tiles
  const SEEK_SPEED       = TILE * 10;   // approach speed to a patch

  // Breeding balance
  const MEALS_TO_BREED   = 3;
  const BREED_COOLDOWN_MS= 8000;

  // ======================

  const sheep = []; // [{x,y,vx,vy,phase,full,cd}]

  function clampToPasture(x, y) {
    if (radial(x / TILE, y / TILE) <= edges.pasture + 0.2) return { x, y };
    const cx = Math.floor(WORLD / 2) * TILE + TILE / 2;
    const cy = Math.floor(WORLD / 2) * TILE + TILE / 2;
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const maxR = (edges.pasture + 0.1) * TILE;
    return { x: cx + (dx / len) * maxR, y: cy + (dy / len) * maxR };
  }

  function addSheep(n, player) {
    for (let i = 0; i < n; i++) {
      const px = player.x * TILE + TILE / 2;
      const py = player.y * TILE + TILE / 2;
      const ang = Math.random() * Math.PI * 2;
      const dist = TILE * (1 + Math.random() * 1.5);
      const s = {
        x: px + Math.cos(ang) * dist,
        y: py + Math.sin(ang) * dist,
        vx: 0, vy: 0,
        phase: Math.random() * Math.PI * 2,
        full: 0,
        cd: 0
      };
      const c = clampToPasture(s.x, s.y);
      s.x = c.x; s.y = c.y;
      sheep.push(s);
    }
  }

  function eat(s, meals = 1) {
    if (!s) return;
    s.full = Math.min(MEALS_TO_BREED, s.full + Math.max(0, meals));
  }

  function limit(vx, vy, max) {
    const m = Math.hypot(vx, vy);
    if (m > max && m > 1e-6) {
      const k = max / m;
      return { vx: vx * k, vy: vy * k };
    }
    return { vx, vy };
  }

  function steerToward(sx, sy, tx, ty, speed) {
    const dx = tx - sx, dy = ty - sy;
    const d  = Math.hypot(dx, dy) || 1e-6;
    const desiredX = (dx / d) * speed;
    const desiredY = (dy / d) * speed;
    return { ax: desiredX, ay: desiredY };
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

    for (let i = 0; i < sheep.length; i++) {
      const s = sheep[i];

      // Neighbor forces (simple O(n^2) – OK for small flocks)
      let sepX = 0, sepY = 0, sepCount = 0;
      let alignX = 0, alignY = 0, alignCount = 0;

      for (let j = 0; j < sheep.length; j++) {
        if (j === i) continue;
        const o = sheep[j];
        const dx = s.x - o.x, dy = s.y - o.y;
        const d  = Math.hypot(dx, dy);
        if (d < 1e-6 || d > VIEW_RADIUS) continue;

        if (d < SEP_RADIUS) {
          const inv = 1 / Math.max(d, 0.001);
          sepX += dx * inv; sepY += dy * inv; sepCount++;
        }
        if (d < ALIGN_RADIUS) {
          alignX += o.vx; alignY += o.vy; alignCount++;
        }
      }

      if (sepCount > 0) {
        const mag = Math.hypot(sepX, sepY) || 1e-6;
        sepX = (sepX / mag) * BASE_MAX_SPEED - s.vx;
        sepY = (sepY / mag) * BASE_MAX_SPEED - s.vy;
      }

      if (alignCount > 0) {
        alignX = alignX / alignCount;
        alignY = alignY / alignCount;
        const lim = limit(alignX, alignY, BASE_MAX_SPEED);
        alignX = lim.vx - s.vx;
        alignY = lim.vy - s.vy;
      }

      // Cohesion toward player (strong; ensures they keep up)
      const distToPlayer = Math.hypot(s.x - px, s.y - py);
      let followSpeed = BASE_MAX_SPEED;
      if (moving) followSpeed = RUN_SPEED;
      if (distToPlayer > CATCHUP_RADIUS) followSpeed = CATCHUP_SPEED;

      const coh = steerToward(s.x, s.y, px, py, followSpeed);
      let cohX = coh.ax - s.vx;
      let cohY = coh.ay - s.vy;

      // Only wander if hungry AND there’s food in reach
      let foodX = 0, foodY = 0;
      if (s.full < MEALS_TO_BREED && typeof seekFood === "function") {
        const found = seekFood(s.x, s.y, IDLE_SEEK_TILES);
        if (found) {
          const fx = found.tx * TILE + TILE/2;
          const fy = found.ty * TILE + TILE/2;
          const desire = steerToward(s.x, s.y, fx, fy, SEEK_SPEED);
          foodX = desire.ax - s.vx;
          foodY = desire.ay - s.vy;
        }
      }
      // If no food target and player isn’t moving, do NOT roam:
      // cohesion keeps them hovering near the player.

      // Combine forces
      let ax = 0, ay = 0;
      ax += sepX * W_SEP;      ay += sepY * W_SEP;
      ax += alignX * W_ALIGN;  ay += alignY * W_ALIGN;
      ax += cohX * W_COHESION; ay += cohY * W_COHESION;
      ax += foodX * W_FOOD;    ay += foodY * W_FOOD;

      // Clamp steering, integrate velocity with smoothing
      const limA = limit(ax, ay, MAX_FORCE);
      const targetVx = s.vx + limA.vx * dt;
      const targetVy = s.vy + limA.vy * dt;

      // Smooth velocity (lerp) to avoid jitter/sharp turns
      s.vx = s.vx + (targetVx - s.vx) * VEL_LERP;
      s.vy = s.vy + (targetVy - s.vy) * VEL_LERP;

      // Cap final speed (use the same speed cap we chose above)
      const speedCap = followSpeed; // dynamic cap based on context
      const limV = limit(s.vx, s.vy, speedCap);
      s.vx = limV.vx; s.vy = limV.vy;

      // Integrate position
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      // Keep inside pasture boundary
      const c = clampToPasture(s.x, s.y);
      s.x = c.x; s.y = c.y;

      s.phase += dt * 0.9;
    }

    tryBreed(player, dtMs);
  }

  function draw(ctx, cam) {
    for (let i = 0; i < sheep.length; i++) {
      const s = sheep[i];
      const sx = s.x - cam.x, sy = s.y - cam.y;
      const r = TILE * 0.28 + Math.sin((s.phase + i) * 0.8) * 0.5;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#1c1c1c"; ctx.stroke();

      // fullness ring
      if (s.full > 0) {
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        const portion = s.full / MEALS_TO_BREED;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 3, -Math.PI/2, -Math.PI/2 + Math.PI*2*portion);
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