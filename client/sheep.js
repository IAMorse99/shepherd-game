// client/sheep.js
"use strict";

/**
 * Sheep manager: follow-the-leader when player moves;
 * gentle mosey near where they stopped when player is idle.
 */
export function createSheepManager(env) {
  const { TILE, WORLD, edges, radial } = env;

  const sheep = []; // [{x,y,vx,vy,idle,baseX,baseY,phase}]
  const DESIRED = TILE * 0.9;           // preferred spacing to leader
  const MAX_SPEED = TILE * 6;           // px/sec (follow speed)
  const IDLE_SPEED = TILE * 1.5;        // px/sec (mosey speed)
  const IDLE_RADIUS = TILE * 0.6;       // how far they wander when idle
  const SEPARATION = TILE * 0.6;        // minimal distance between sheep

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
        phase: Math.random() * Math.PI * 2
      };
      const c = clampToPasture(s.x, s.y);
      s.x = c.x; s.y = c.y;
      sheep.push(s);
    }
  }

  function update(now, dtMs, { player, moving }) {
    const dt = Math.max(0.001, dtMs / 1000); // seconds

    // leader position in pixels
    let leadX = player.x * TILE + TILE / 2;
    let leadY = player.y * TILE + TILE / 2;

    for (let i = 0; i < sheep.length; i++) {
      const s = sheep[i];
      // leader for this sheep = player (first) or previous sheep
      if (i > 0) {
        const p = sheep[i - 1];
        leadX = p.x; leadY = p.y;
      }

      if (moving) {
        // follow the leader, keep distance DESIRED
        const dx = leadX - s.x, dy = leadY - s.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1e-6) {
          // desired point DESIRED behind the leader along the segment
          const targetX = leadX - (dx / dist) * DESIRED;
          const targetY = leadY - (dy / dist) * DESIRED;
          const tx = targetX - s.x, ty = targetY - s.y;
          const tdist = Math.hypot(tx, ty);
          const maxStep = MAX_SPEED * dt;
          const step = Math.min(maxStep, tdist);
          if (tdist > 1e-6) { s.x += (tx / tdist) * step; s.y += (ty / tdist) * step; }
        }
        s.idle = false;
      } else {
        // mosey gently around a base point
        if (!s.idle) {
          s.idle = true;
          s.baseX = s.x; s.baseY = s.y;
          s.phase = Math.random() * Math.PI * 2;
        }
        s.phase += dt * 0.6; // slow orbit
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

      // tiny ear dot
      ctx.beginPath(); ctx.arc(sx + r * 0.4, sy - r * 0.3, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#1c1c1c"; ctx.fill();
    }
  }

  return { addSheep, update, draw, list: sheep };
}