// client/bridges.js
"use strict";

/**
 * Build four 1‑tile‑wide bridges that cross ONLY the water ring
 * at the cardinal directions (N/E/S/W).
 * We include every water tile along a straight line so it spans
 * the full water band.
 */
export function buildBridges(world) {
  const { cx, cy, edges, ringAt } = world;
  const out = [];

  // Helper to push all consecutive WATER tiles between glen..water along a ray
  function addBridge(dx, dy) {
    // start just outside the dark/glen boundary and walk outward until pasture
    // collect only tiles whose ringAt === "water"
    let x = cx, y = cy;
    // step outward until we reach the outer edge of the water band
    // we’ll scan within a generous radius
    const maxSteps = Math.ceil(edges.pasture + 2);
    for (let i = 0; i <= maxSteps; i++) {
      const tx = cx + dx * i;
      const ty = cy + dy * i;
      const ring = ringAt(tx, ty);
      if (ring === "water") out.push({ x: tx, y: ty });
      // stop after we’ve passed pasture again
      if (ring === "pasture" && i > edges.water + 1) break;
    }
  }

  // N/E/S/W rays in tile steps
  addBridge( 0, -1); // north
  addBridge( 1,  0); // east
  addBridge( 0,  1); // south
  addBridge(-1,  0); // west

  return out;
}

/** O(1) lookup set for bridge tiles. */
export function toBridgeSet(bridgeTiles) {
  const s = new Set();
  for (const b of bridgeTiles) s.add(`${b.x},${b.y}`);
  return s;
}