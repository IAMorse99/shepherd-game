// client/sheep.js
"use strict";

/**
 * Sheep manager (simple + snappy):
 * - Stationary by default.
 * - If player moves → follow in a loose ring formation (not single file).
 * - If hungry and a patch is within seek radius → run to it, else stay put.
 * - Slightly faster than player to keep up.
 * - Same API: list, addSheep, eat, update, draw, count, mealsToBreed.
 */
export function createSheepManager(env) {
  const { TILE, WORLD, edges, radial } = env;

  // ===== Tunables =====
  // Player ~ 1 tile / 90ms => ~11.11 tiles/s => ~222 px/s with TILE=20
  // Make sheep a hair faster so they can catch up.
  const FOLLOW_SPEED    = TILE * 11.8;   // ≈ 236 px/s (slightly > player)
  const SEEK_SPEED      = TILE * 11.2;   // speed toward food
  const MAX_FORCE       = TILE * 45;     // steering cap (px/s^2)
  const VEL_LERP        = 0.22;          // smoothing 0..1 (higher = snappier)

  const FORMATION_RADIUS = TILE * 2.2;   // ring around player when following
  const SEP_RADIUS       = TILE * 1.3;   // tiny separation to avoid overlap

  // Food / breeding
  const SEEK_TILES        = 5;           // only wander if patch within this many tiles
  const MEALS_TO_BREED    = 3;
  const BREED_COOLDOWN_MS = 8000;

  const sheep = []; // [{x,y,vx,vy,phase,full,cd,slot}]
  let slotCounter = 0;

  // ---------- helpers ----------
  function clampToPasture(x, y) {
    if (radial(x / TILE, y / TILE) <= edges.pasture + 0.2) return { x, y };
    const cx = Math.floor(WORLD / 2) * TILE + TILE / 2;
    const cy = Math.floor(WORLD / 2) * TILE + TILE / 2;
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const maxR = (edges.pasture + 0.1) * TILE;
    return { x: cx + (dx / len) * maxR, y: cy + (dy / len) * maxR };
  }
  function limit(vx, vy, max) {
    const m = Math.hypot(vx, vy);
    if (m > max && m > 1e-6) {
      const k = max / m; return { vx: vx * k, vy: vy * k };
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

  // Allocates an angular slot on the follow ring so they don't single-file.
  function slotAngleFor(index){
    // Distribute around 360° using golden-angle spacing for nice distribution
    const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~2.39996
    return (index * GOLDEN) % (Math.PI * 2);
  }

  // ---------- API ----------
  function addSheep(n, player) {
    const px = player.x * TILE + TILE / 2;
    const py = player.y * TILE + TILE / 2;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = TILE * (0.8 + Math.random() * 1.2);
      sheep.push({
        x: px + Math.cos(ang) * dist,
        y: py + Math.sin(ang) * dist,
        vx: 0, vy: 0,
        phase: Math.random() * Math.PI * 2,
        full: 0,
        cd: 0,
        slot: slotCounter++   // unique slot id
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

    for (let i = 0; i < sheep.length; i++) {
      const s = sheep[i];

      // --- Decide goal for this tick ---
      let goalX = s.x, goalY = s.y, goalSpeed = 0;

      if (moving) {
        // FOLLOW FORMATION: each sheep has a ring slot around the player
        const ang = slotAngleFor(s.slot);
        goalX = px + Math.cos(ang) * FORMATION_RADIUS;
        goalY = py + Math.sin(ang) * FORMATION_RADIUS;
        goalSpeed = FOLLOW_SPEED;
      } else if (s.full < MEALS_TO_BREED && typeof seekFood === "function") {
        // Only wander if there's food close enough
        const found = seekFood(s.x, s.y, SEEK_TILES);
        if (found) {
          goalX = found.tx * TILE + TILE/2;
          goalY = found.ty * TILE + TILE/2;
          goalSpeed = SEEK_SPEED;
        } else {
          // No food in range → stay put
          goalSpeed = 0;
        }
      } else {
        // Full or not hungry or no food → stay put
        goalSpeed = 0;
      }

      // --- Steering toward goal (or stop) ---
      let ax = 0, ay = 0;
      if (goalSpeed > 0) {
        const desire = steerToward(s.x, s.y, goalX, goalY, goalSpeed);
        ax += (desire.ax - s.vx);
        ay += (desire.ay - s.vy);
      } else {
        // brake to stop smoothly
        ax += -s.vx;
        ay += -s.vy;
      }

      // Minimal separation to avoid overlap (especially in formation)
      for (let j = 0; j < sheep.length; j++) {
        if (j === i) continue;
        const o = sheep[j];
        const dx = s.x - o.x, dy = s.y - o.y;
        const d  = Math.hypot(dx, dy);
        if (d > 1e-6 && d < SEP_RADIUS) {
          const push = (SEP_RADIUS - d) / SEP_RADIUS; // 0..1
          ax += (dx / d) * push * TILE * 4;
          ay += (dy / d) * push * TILE * 4;
        }
      }

      // Cap steering force
      const limA = limit(ax, ay, MAX_FORCE);
      const targetVx = s.vx + limA.vx * dt;
      const targetVy = s.vy + limA.vy * dt;

      // Smooth velocity (lerp)
      s.vx = s.vx + (targetVx - s.vx) * VEL_LERP;
      s.vy = s.vy + (targetVy - s.vy) * VEL_LERP;

      // Cap speed to the current context
      const speedCap = (goalSpeed > 0 ? goalSpeed : TILE * 6); // small cap while braking
      const limV = limit(s.vx, s.vy, speedCap);
      s.vx = limV.vx; s.vy = limV.vy;

      // Integrate
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      // Keep inside pasture
      const c = clampToPasture(s.x, s.y);
      s.x = c.x; s.y = c.y;

      // Cute wobble
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