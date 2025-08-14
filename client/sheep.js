// client/sheep.js
"use strict";

/**
 * Sheep manager (snappy + simple):
 * - Stationary by default
 * - Follow player in a loose ring ONLY while player moves
 * - If hungry AND a nearby patch exists, bee-line to it
 * - Velocities blend directly toward a desired vector (frame-rate aware)
 * - Same API: list, addSheep, eat, update, draw, count, mealsToBreed
 */
export function createSheepManager(env) {
  const { TILE, WORLD, edges, radial } = env;

  /* ===== Tunables ===== */
  // Player ≈ 1 tile / 90ms ≈ 11.11 tiles/s → ~222 px/s with TILE=20
  const FOLLOW_SPEED   = TILE * 13.5;   // ~270 px/s (catch-up > player)
  const SEEK_SPEED     = TILE * 13.0;   // toward food
  const STOP_DECAY_S   = 6.0;           // how fast we brake to 0 (per second)
  const BLEND_RATE_S   = 7.5;           // how fast we adopt desired vel (per second)

  const FORMATION_RADIUS = TILE * 2.0;  // ring radius around player while moving
  const SEP_RADIUS       = TILE * 1.2;  // tiny push so they don't overlap
  const SEP_PUSH         = TILE * 50;   // instantaneous push strength

  const SEEK_TILES       = 5;           // only chase patches within this many tiles

  const MEALS_TO_BREED    = 3;
  const BREED_COOLDOWN_MS = 8000;

  /* ===== State ===== */
  const sheep = []; // [{x,y,vx,vy,phase,full,cd,slot}]
  let slotCounter = 0;

  /* ===== Helpers ===== */
  function clampToPasture(x, y) {
    if (radial(x / TILE, y / TILE) <= edges.pasture + 0.2) return { x, y };
    const cx = Math.floor(WORLD / 2) * TILE + TILE / 2;
    const cy = Math.floor(WORLD / 2) * TILE + TILE / 2;
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const maxR = (edges.pasture + 0.1) * TILE;
    return { x: cx + (dx / len) * maxR, y: cy + (dy / len) * maxR };
  }
  function lerp(a, b, t){ return a + (b - a) * t; }
  function blendFactor(ratePerSec, dt){ // dt in seconds
    // convert a per-second responsiveness into a per-frame alpha
    // alpha = 1 - e^(-k * dt)
    const k = Math.max(0, ratePerSec);
    return 1 - Math.exp(-k * dt);
  }
  function normTo(vx, vy, mag){
    const d = Math.hypot(vx, vy);
    if (d < 1e-6) return { vx: 0, vy: 0 };
    const k = mag / d;
    return { vx: vx * k, vy: vy * k };
  }
  function slotAngleFor(index){
    // golden-angle spacing around the player
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    return (index * GOLDEN) % (Math.PI * 2);
  }

  /* ===== API ===== */
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
        slot: slotCounter++
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
    const brake = Math.exp(-STOP_DECAY_S * dt); // multiply current velocity by this when stopping

    for (let i = 0; i < sheep.length; i++) {
      const s = sheep[i];

      // Decide desired velocity
      let desiredVx = 0, desiredVy = 0;

      if (moving) {
        // follow ring target
        const ang = slotAngleFor(s.slot);
        const tx = px + Math.cos(ang) * FORMATION_RADIUS;
        const ty = py + Math.sin(ang) * FORMATION_RADIUS;
        const toT = normTo(tx - s.x, ty - s.y, FOLLOW_SPEED);
        desiredVx = toT.vx; desiredVy = toT.vy;
      } else if (s.full < MEALS_TO_BREED && typeof seekFood === "function") {
        // hungry: only move if a patch is close enough
        const found = seekFood(s.x, s.y, SEEK_TILES);
        if (found) {
          const fx = found.tx * TILE + TILE/2;
          const fy = found.ty * TILE + TILE/2;
          const toF = normTo(fx - s.x, fy - s.y, SEEK_SPEED);
          desiredVx = toF.vx; desiredVy = toF.vy;
        }
      }
      // else: desired velocity stays at 0 → we’ll brake

      // Tiny separation so they don't overlap when multiple share close slots
      for (let j = 0; j < sheep.length; j++) {
        if (j === i) continue;
        const o = sheep[j];
        const dx = s.x - o.x, dy = s.y - o.y;
        const d  = Math.hypot(dx, dy);
        if (d > 1e-6 && d < SEP_RADIUS) {
          const push = (SEP_RADIUS - d) / SEP_RADIUS; // 0..1
          desiredVx += (dx / d) * SEP_PUSH * push * dt;
          desiredVy += (dy / d) * SEP_PUSH * push * dt;
        }
      }

      // Blend toward desired velocity (frame-rate aware)
      s.vx = lerp(s.vx, desiredVx, alpha);
      s.vy = lerp(s.vy, desiredVy, alpha);

      // If desired is zero (idle), brake velocity smoothly
      if (desiredVx === 0 && desiredVy === 0) {
        s.vx *= brake;
        s.vy *= brake;
        if (Math.abs(s.vx) < 0.02) s.vx = 0;
        if (Math.abs(s.vy) < 0.02) s.vy = 0;
      }

      // Integrate
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      // Keep inside pasture
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