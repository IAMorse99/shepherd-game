// client/sheep.js
"use strict";

/**
 * Sheep manager:
 * - Follow the player (or previous sheep) with spacing
 * - Mosey gently when the player is idle
 * - Eat: external caller gives a sheep +1 meal when it stands on a food patch
 * - Multiply: when TWO sheep are full (>= MEALS_TO_BREED) and off cooldown, spawn a lamb
 */
export function createSheepManager(env) {
  const { TILE, WORLD, edges, radial } = env;

  const sheep = []; // [{x,y,vx,vy,idle,baseX,baseY,phase,full,cd}]
  const DESIRED = TILE * 2;     // preferred spacing to leader (you set this; keeping it)
  const MAX_SPEED = TILE * 10;  // px/sec follow speed (you set this; keeping it)
  const IDLE_SPEED = TILE * 1.5;// px/sec mosey speed
  const IDLE_RADIUS = TILE * 5; // mosey radius (you set this; keeping it)
  const SEPARATION = TILE * 1;  // minimal distance between sheep

  // Breeding balance
  const MEALS_TO_BREED = 3;        // meals a sheep needs to be “full”
  const BREED_COOLDOWN_MS = 8000;  // per-sheep cooldown after breeding (ms)

  function clampToPasture(x, y) {
    // keep inside the outer ring (safe pasture)
    if (radial(x / TILE, y / TILE) <= edges.pasture + 0.2) return { x, y };
    // pull back toward center linearly
    const cx = Math.floor(WORLD / 2) * TILE + TILE / 2;
    const cy = Math.floor(WORLD / 2) * TILE + TILE / 2;
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const maxR = (edges.pasture + 0.1) * TILE;
    return { x: cx + (dx / len) * maxR, y: cy + (dy / len) * maxR };
  }

  function addSheep(n, player) {
    for (let i = 0; i < n; i++) {
      // spawn slightly behind the player (stack a bit)
      const s = {
        x: (player.x * TILE) + TILE / 2 - (i + 1) * (DESIRED * 0.8),
        y: (player.y * TILE) + TILE / 2,
        vx: 0, vy: 0,
        idle: false,
        baseX: 0, baseY: 0,
        phase: Math.random() * Math.PI * 2,
        full: 0,    // meals eaten [0..MEALS_TO_BREED]
        cd: 0       // breeding cooldown (ms)
      };
      const c = clampToPasture(s.x, s.y);
      s.x = c.x; s.y = c.y;
      sheep.push(s);
    }
  }

  /** External hook: give a specific sheep some meals (called from main when on a patch). */
  function eat(s, meals = 1) {
    if (!s) return;
    s.full = Math.min(MEALS_TO_BREED, s.full + Math.max(0, meals));
  }

  function tryBreed(player, dtMs) {
    // tick down cooldowns
    for (const s of sheep) s.cd = Math.max(0, s.cd - dtMs);

    // find two eligible sheep (full & off cooldown)
    const ready = sheep.filter(s => s.full >= MEALS_TO_BREED && s.cd === 0);
    if (ready.length >= 2) {
      // consume their meals, set cooldowns, add a lamb
      ready[0].full = 0; ready[1].full = 0;
      ready[0].cd = BREED_COOLDOWN_MS;
      ready[1].cd = BREED_COOLDOWN_MS;
      addSheep(1, player);
    }
  }

  function update(now, dtMs, { player, moving }) {
    const dt = Math.max(0.001, dtMs / 1000); // seconds

    // leader position in pixels (player by default)
    const playerLeadX = player.x * TILE + TILE / 2;
    const playerLeadY = player.y * TILE + TILE / 2;

    for (let i = 0; i < sheep.length; i++) {
      const s = sheep[i];

      // leader for this sheep = player (first) or previous sheep
      const leadX = (i === 0) ? playerLeadX : sheep[i - 1].x;
      const leadY = (i === 0) ? playerLeadY : sheep[i - 1].y;

      // how far am I from my leader?
      const dxL = leadX - s.x, dyL = leadY - s.y;
      const distL = Math.hypot(dxL, dyL);

      // follow if player is moving OR I'm too far from my ideal spot
      const NEED_FOLLOW = moving || distL > DESIRED * 1.15;

      if (NEED_FOLLOW) {
        // target point DESIRED behind the leader along the segment
        const targetX = (distL > 1e-6) ? (leadX - (dxL / distL) * DESIRED) : s.x;
        const targetY = (distL > 1e-6) ? (leadY - (dyL / distL) * DESIRED) : s.y;
        const tx = targetX - s.x, ty = targetY - s.y;
        const tdist = Math.hypot(tx, ty);
        const maxStep = MAX_SPEED * dt;
        const step = Math.min(maxStep, tdist);
        if (tdist > 1e-6) { s.x += (tx / tdist) * step; s.y += (ty / tdist) * step; }
        s.idle = false;
      } else {
        // mosey gently around a base point near where I am now
        if (!s.idle) {
          s.idle = true;
          s.baseX = s.x; s.baseY = s.y;
          s.phase = Math.random() * Math.PI * 2;
        }
        s.phase += dt * 0.6;
        const r = IDLE_RADIUS * (0.6 + 0.4 * Math.sin(now * 0.001 + i));
        const targetX = s.baseX + Math.cos(s.phase) * r * 0.35;
        const targetY = s.baseY + Math.sin(s.phase * 0.9) * r * 0.25;
        const tx = targetX - s.x, ty = targetY - s.y;
        const tdist = Math.hypot(tx, ty);
        const step = Math.min(IDLE_SPEED * dt, tdist);
        if (tdist > 1e-6) { s.x += (tx / tdist) * step; s.y += (ty / tdist) * step; }
      }

      // simple separation so they don’t stack
      if (i > 0) {
        const prev = sheep[i - 1];
        const dx = s.x - prev.x, dy = s.y - prev.y;
        const d = Math.hypot(dx, dy);
        if (d < SEPARATION && d > 1e-6) {
          const push = (SEPARATION - d) * 0.5;
          s.x += (dx / d) * push;
          s.y += (dy / d) * push;
        }
      }

      // keep inside pasture
      const c = clampToPasture(s.x, s.y);
      s.x = c.x; s.y = c.y;
    }

    // breeding pass each tick (cooldowns pace it)
    tryBreed(player, dtMs);
  }

  function draw(ctx, cam) {
    for (let i = 0; i < sheep.length; i++) {
      const s = sheep[i];
      const sx = s.x - cam.x, sy = s.y - cam.y;
      // little wobble for cuteness
      const r = TILE * 0.28 + Math.sin((s.phase + i) * 0.8) * 0.5;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#1c1c1c"; ctx.stroke();

      // tiny fullness ring (subtle progress indicator)
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
    eat,       // <-- call this from main when a sheep stands on a patch
    update,
    draw,
    get count(){ return sheep.length; }
  };
}