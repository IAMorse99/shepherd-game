// client/map.js
"use strict";

/** Build the world, prerendered map layer, and helpers. */
export function buildMap({ TILE, WORLD }) {
  const cx = Math.floor(WORLD / 2);
  const cy = Math.floor(WORLD / 2);
  const maxR = Math.min(cx, cy) - 1;

  // auto-fit ring widths
  let rPasture = Math.floor(maxR * 0.45);
  let rWater   = Math.floor(maxR * 0.17);
  let rGlen    = Math.floor(maxR * 0.25);
  let rDark    = Math.max(2, maxR - (rPasture + rWater + rGlen));
  while (rPasture + rWater + rGlen + rDark > maxR) {
    if (rPasture > 8) rPasture--;
    else if (rGlen > 6) rGlen--;
    else if (rWater > 4) rWater--;
    else { rDark = Math.max(2, rDark - 1); break; }
  }
  const edges = {
    pasture: maxR,
    water:   maxR - rPasture,
    glen:    maxR - rPasture - rWater,
    dark:    maxR - rPasture - rWater - rGlen
  };

  function radial(x, y) {
    const dx = x - cx + 0.5, dy = y - cy + 0.5;
    return Math.sqrt(dx*dx + dy*dy);
  }
  function ringAt(x, y) {
    const r = radial(x, y);
    if (r > edges.water) return "pasture";
    if (r > edges.glen)  return "water";
    if (r > edges.dark)  return "glen";
    return "dark";
  }

  const COLORS = {
    pasture: "#7ccf4f",
    water:   "#4aa7c9",
    glen:    "#4c8b41",
    dark:    "#234020"
  };

  // prerender to an offscreen canvas
  const worldPx = WORLD * TILE;
  const mapLayer = document.createElement("canvas");
  mapLayer.width = worldPx; mapLayer.height = worldPx;
  const mctx = mapLayer.getContext("2d");
  mctx.imageSmoothingEnabled = false;

  for (let y = 0; y < WORLD; y++) {
    for (let x = 0; x < WORLD; x++) {
      const ring = ringAt(x, y);
      mctx.fillStyle = COLORS[ring];
      mctx.fillRect(x*TILE, y*TILE, TILE, TILE);

      // tiny variation
      const n = (Math.sin((x*97 + y*57)) + 1) * 0.08;
      mctx.fillStyle = `rgba(0,0,0,${n})`;
      mctx.fillRect(x*TILE, y*TILE, TILE, TILE);
    }
  }
  // darker, less‑welcoming center
  const centerRadius = Math.max(0, (edges.dark+1) * TILE);
  if (centerRadius > 0) {
    mctx.fillStyle = "rgba(0,0,0,0.16)";
    mctx.beginPath();
    mctx.arc(cx*TILE, cy*TILE, centerRadius, 0, Math.PI*2);
    mctx.fill();
  }
  // grid overlay
  mctx.strokeStyle = "rgba(0,0,0,0.18)";
  mctx.lineWidth = 1;
  for (let y = 0; y <= WORLD; y++) {
    mctx.beginPath(); mctx.moveTo(0, y*TILE + 0.5); mctx.lineTo(worldPx, y*TILE + 0.5); mctx.stroke();
  }
  for (let x = 0; x <= WORLD; x++) {
    mctx.beginPath(); mctx.moveTo(x*TILE + 0.5, 0); mctx.lineTo(x*TILE + 0.5, worldPx); mctx.stroke();
  }

  return { cx, cy, edges, radial, ringAt, mapLayer, worldPx };
}

/** Extra ambient FX drawn over the visible area only. */
export function drawVisibleFX(ctx, cam, now, { TILE, WORLD, ringAt }) {
  const x0 = Math.max(0, Math.floor(cam.x / TILE));
  const y0 = Math.max(0, Math.floor(cam.y / TILE));
  const x1 = Math.min(WORLD-1, Math.ceil((cam.x + cam.w) / TILE));
  const y1 = Math.min(WORLD-1, Math.ceil((cam.y + cam.h) / TILE));

  // water shimmer
  for (let y=y0; y<=y1; y++){
    for (let x=x0; x<=x1; x++){
      if (ringAt(x,y) !== "water") continue;
      const sx = x*TILE - cam.x, sy = y*TILE - cam.y;
      const phase = (x*0.6 + y*0.3) + now*0.002;
      const a = 0.08 + 0.06*Math.sin(phase*6.28);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(sx, sy, TILE, TILE*0.15);
      ctx.fillRect(sx, sy + TILE*0.55, TILE, TILE*0.1);
    }
  }

  // glen dappled light
  for (let y=y0; y<=y1; y++){
    for (let x=x0; x<=x1; x++){
      if (ringAt(x,y) !== "glen") continue;
      const sx = x*TILE - cam.x, sy = y*TILE - cam.y;
      const p = (Math.sin((x*0.7 + now*0.0015)) + Math.cos((y*0.9 - now*0.0012)))*0.5;
      const a = 0.05 + 0.05*Math.max(0, p);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(sx, sy, TILE, TILE);
    }
  }

  // dark forest fireflies
  function hash2(x,y){ let h = x*374761393 + y*668265263; h = (h ^ (h>>>13)) >>> 0; return (h % 1000) / 1000; }
  for (let y=y0; y<=y1; y++){
    for (let x=x0; x<=x1; x++){
      if (ringAt(x,y) !== "dark") continue;
      const r = hash2(x,y);
      if (r < 0.02) {
        const sx = x*TILE - cam.x, sy = y*TILE - cam.y;
        const j = (now*0.002 + r*10);
        const fx = sx + (TILE/2 + Math.sin(j)*TILE*0.25);
        const fy = sy + (TILE/2 + Math.cos(j*1.3)*TILE*0.2);
        const glow = 0.35 + 0.35*Math.sin(j*3.0);
        ctx.fillStyle = `rgba(255,245,160,${glow})`;
        ctx.beginPath(); ctx.arc(fx, fy, 2.2, 0, Math.PI*2); ctx.fill();
      }
    }
  }
}

/** Minimap renderer. */
export function drawMinimap(ctx, mapLayer, cam, player, { TILE, WORLD, worldPx, MINIMAP }) {
  const { size, pad } = MINIMAP;
  const mmW = size, mmH = size;
  const mmX = ctx.canvas.width - mmW - pad;
  const mmY = ctx.canvas.height - mmH - pad;

  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(mmX-6, mmY-6, mmW+12, mmH+12);

  ctx.drawImage(mapLayer, 0, 0, worldPx, worldPx, mmX, mmY, mmW, mmH);

  const px = mmX + (player.x*TILE + TILE/2) / worldPx * mmW;
  const py = mmY + (player.y*TILE + TILE/2) / worldPx * mmH;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();

  const bx = mmX + cam.x / worldPx * mmW;
  const by = mmY + cam.y / worldPx * mmH;
  const bw = cam.w / worldPx * mmW;
  const bh = cam.h / worldPx * mmH;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, bw, bh);
}

/** Bridges drawing (simple wood tiles). */
export function drawBridges(ctx, cam, TILE, bridges) {
  if (!bridges || !bridges.length) return;
  ctx.fillStyle = "#c2a35d"; // wood plank color
  for (const b of bridges) {
    const sx = b.x * TILE - cam.x;
    const sy = b.y * TILE - cam.y;
    ctx.fillRect(sx, sy, TILE, TILE);
  }
}