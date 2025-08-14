// client/sheep.js
"use strict";

/**
 * Sheep manager (flocking edition):
 * - Flocking: separation + cohesion(to player) + alignment
 * - Hungry sheep seek nearby food (seekFood callback from main)
 * - Eat via sheepMgr.eat(s, n), capped at mealsToBreed
 * - Breed: two full sheep off cooldown spawn a lamb
 */
export function createSheepManager(env) {
  const { TILE, WORLD, edges, radial } = env;

  // -------- Tunables (feel free to tweak) --------
  const MAX_SPEED       = TILE * 15;     // px/s cap
  const MAX_FORCE       = TILE * 30;     // px/s^2 steering cap
  const VIEW_RADIUS     = TILE * 2;      // neighbor awareness radius (px)
  const SEP_RADIUS      = TILE * 10.0;    // separation radius (px)
  const ALIGN_RADIUS    = TILE * 2.0;    // alignment radius (px)
  const COHESION_RADIUS = TILE * 8.0;    // cohesion "feels" player up to this

  // Weights for steering components
  const W_SEP       = 1.8;
  const W_ALIGN     = 0.6;
  const W_COHESION  = 1.1;
  const W_FOOD      = 1.7;  // hungry drift → food

  // Food seeking
  const IDLE_SEEK_TILES =  Math.ceil((TILE * 5) / TILE); // ≈5 tiles
  const SEEK_SPEED      =  TILE * 8;   // speed toward food target

  // Breeding balance
  const MEALS_TO_BREED     = 3;
  const BREED_COOLDOWN_MS  = 8000;

  // ------------------------------------------------

  const sheep = []; // [{x,y,vx,vy,phase,full,cd}]

  function clampToPasture(x, y) {
    if (radial(x / TILE, y / TILE) <= edges.pasture + 0.2) return { x, y };
    // pull back toward center on the pasture boundary
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
      const angle = Math.random() * Math.PI * 2;
      const dist  = TILE * (1.2 + Math.random() * 1.2);
      const s = {
        x: px + Math.cos(angle) * dist,
        y: py + Math.sin(angle) * dist,
        vx: (Math.random()-0.5) * TILE * 2,
        vy: (Math.random()-0.5) * TILE * 2,
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
    const s = Math.hypot(vx, vy);
    if (s > max && s > 1e-6) {
      const k = max / s; return { vx: vx * k, vy: vy * k };
    }
    return { vx, vy };
  }

  function steerToward(sx, sy, tx, ty, speed = MAX_SPEED) {
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

    // Precompute neighbors (naive O(n^2) works fine for small herds)
    for (let i = 0; i < sheep.length; i++) {
      const s = sheep[i];

      // --- Flocking forces ---
      let sepX = 0, sepY = 0, sepCount = 0;
      let alignX = 0, alignY = 0, alignCount = 0;

      for (let j = 0; j < sheep.length; j++) {
        if (j === i) continue;
        const o = sheep[j];
        const dx = s.x - o.x, dy = s.y - o.y;
        const d  = Math.hypot(dx, dy);
        if (d < 1e-6 || d > VIEW_RADIUS) continue;

        // Separation
        if (d < SEP_RADIUS) {
          const inv = 1 / Math.max(d, 0.001);
          sepX += (dx * inv);
          sepY += (dy * inv);
          sepCount++;
        }

        // Alignment
        if (d < ALIGN_RADIUS) {
          alignX += o.vx; alignY += o.vy;
          alignCount++;
        }
      }

      // Normalize separation
      if (sepCount > 0) {
        const mag = Math.hypot(sepX, sepY) || 1e-6;
        sepX = (sepX / mag) * MAX_SPEED - s.vx;
        sepY = (sepY / mag) * MAX_SPEED - s.vy;
      }

      // Alignment steer
      if (alignCount > 0) {
        alignX = (alignX / alignCount);
        alignY = (alignY / alignCount);
        const lim = limit(alignX, alignY, MAX_SPEED);
        alignX = lim.vx - s.vx;
        alignY = lim.vy - s.vy;
      }

      // Cohesion toward player (stronger when player is moving)
      let cohX = 0, cohY = 0;
      {
        const { ax, ay } = steerToward(s.x, s.y, px, py, MAX_SPEED * 0.8);
        cohX = ax - s.vx; cohY = ay - s.vy;

        // fade cohesion when far from player beyond radius to avoid yanking
        const dp = Math.hypot(s.x - px, s.y - py);
        const falloff = Math.max(0.15, Math.min(1, 1 - Math.max(0, dp - COHESION_RADIUS) / (COHESION_RADIUS*0.75)));
        const moveBoost = moving ? 1.2 : 1.0;
        cohX *= falloff * moveBoost;
        cohY *= falloff * moveBoost;
      }

      // Food seeking (only if hungry)
      let foodX = 0, foodY = 0;
      if (s.full < MEALS_TO_BREED && typeof seekFood === "function") {
        const found = seekFood(s.x, s.y, IDLE_SEEK_TILES);
        if (found) {
          const fx = found.tx * TILE + TILE/2;
          const fy = found.ty * TILE + TILE/2;
          const desire = steerToward(s.x, s.y, fx, fy, SEEK_SPEED);
          foodX = (desire.ax - s.vx);
          foodY = (desire.ay - s.vy);
        }
      }

      // Combine forces
      let ax = 0, ay = 0;
      ax += sepX * W_SEP;
      ay += sepY * W_SEP;
      ax += alignX * W_ALIGN;
      ay += alignY * W_ALIGN;
      ax += cohX * W_COHESION;
      ay += cohY * W_COHESION;
      ax += foodX * W_FOOD;
      ay += foodY * W_FOOD;

      // Clamp steering
      const limF = limit(ax, ay, MAX_FORCE);
      ax = limF.vx; ay = limF.vy;

      // Integrate velocity
      s.vx += ax * dt;
      s.vy += ay * dt;

      // Clamp speed
      const limV = limit(s.vx, s.vy, MAX_SPEED);
      s.vx = limV.vx; s.vy = limV.vy;

      // Integrate position
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      // Keep inside pasture
      const c = clampToPasture(s.x, s.y);
      s.x = c.x; s.y = c.y;

      // Cute wobble phase
      s.phase += dt * 0.9;
    }

    // Breeding pass
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