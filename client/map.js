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

  /* ---------- helpers ---------- */
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

  // Palette
  const COLORS = {
    pasture1: "#77c94b",
    pasture2: "#8edd5b",
    water:    "#4aa7c9",
    glen:     "#4c8b41",
    dark:     "#234020",
    grid:     "rgba(0,0,0,0.18)"
  };

  // deterministic noise
  function h2i(x, y) {
    let h = (x * 374761393 + y * 668265263) ^ 0x9e3779b9;
    h ^= h >>> 13; h = (h * 1274126177) >>> 0;
    return h;
  }
  function r01(x, y, s=1) { return ((h2i(x*s, y*s) % 1000) / 1000); }

  // color utils
  function hexToRgb(hex) {
    const s = hex.replace("#", "");
    const n = parseInt(s.length === 3 ? s.split("").map(c=>c+c).join("") : s, 16);
    return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 };
  }
  function lerpC(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    const r = Math.round(A.r + (B.r - A.r) * t);
    const g = Math.round(A.g + (B.g - A.g) * t);
    const bC = Math.round(A.b + (B.b - A.b) * t);
    return `rgb(${r},${g},${bC})`;
  }

  // prerender to an offscreen canvas
  const worldPx = WORLD * TILE;
  const mapLayer = document.createElement("canvas");
  mapLayer.width = worldPx; mapLayer.height = worldPx;
  const mctx = mapLayer.getContext("2d");
  mctx.imageSmoothingEnabled = false;

  /* ---------- BASE TILES (very gentle tonal drift) ---------- */
  for (let y = 0; y < WORLD; y++) {
    for (let x = 0; x < WORLD; x++) {
      const ring = ringAt(x, y);

      if (ring === "pasture") {
        // keep base contrast low so animation is faint
        const r = radial(x, y);
        const tRad = Math.max(0, Math.min(1, (r - edges.glen) / Math.max(1, (edges.pasture - edges.glen))));
        const micro = r01(x, y, 2) * 0.06 + r01(x+11, y-7, 5) * 0.10; // smaller drift
        const mix = Math.min(1, Math.max(0, 0.33 + tRad*0.30 + (micro-0.08)*0.18));
        mctx.fillStyle = lerpC(COLORS.pasture1, COLORS.pasture2, mix);
      } else if (ring === "water") {
        mctx.fillStyle = COLORS.water;
      } else if (ring === "glen") {
        mctx.fillStyle = COLORS.glen;
      } else {
        mctx.fillStyle = COLORS.dark;
      }
      mctx.fillRect(x*TILE, y*TILE, TILE, TILE);

      // faint depth everywhere (subtle)
      const n2 = (Math.sin((x*71 + y*53)) + 1) * 0.025;
      mctx.fillStyle = `rgba(0,0,0,${n2})`;
      mctx.fillRect(x*TILE, y*TILE, TILE, TILE);
    }
  }

  /* ---------- PASTURE DETAILS (speckles, dirt, rare flowers) ---------- */
  for (let y = 0; y < WORLD; y++) {
    for (let x = 0; x < WORLD; x++) {
      if (ringAt(x,y) !== "pasture") continue;
      const sx = x*TILE, sy = y*TILE;

      const n = r01(x, y, 3);

      // speckles (tiny, sparse)
      if (n > 0.955) { // ~4.5% tiles
        const px = sx + 4 + Math.floor(r01(x+99, y+11, 9) * (TILE-8));
        const py = sy + 4 + Math.floor(r01(x-51, y-7, 9) * (TILE-8));
        const a  = 0.22 + (n-0.955)*0.6; // 0.22..~0.58
        mctx.fillStyle = `rgba(30,70,30,${a})`;
        mctx.fillRect(px, py, 1, 1);
        if (n > 0.990) mctx.fillRect(px+1, py, 1, 1); // rarer 2px
      }

      // rare flowers
      if (n > 0.988) {
        const px = sx + 5 + Math.floor(r01(x+199, y+17, 9) * (TILE-10));
        const py = sy + 5 + Math.floor(r01(x-151, y-13, 9) * (TILE-10));
        mctx.fillStyle = (n > 0.996) ? "#fff3a8" : "#ffd1e3";
        mctx.beginPath(); mctx.arc(px, py, 2, 0, Math.PI*2); mctx.fill();
        mctx.fillStyle = "rgba(0,0,0,0.22)";
        mctx.beginPath(); mctx.arc(px, py, 0.8, 0, Math.PI*2); mctx.fill();
      }

      // dirt flecks nearer the water edge
      const r = radial(x, y);
      if (r > edges.glen && r < edges.pasture && r01(x-3,y+7,4) > 0.94) {
        mctx.fillStyle = "rgba(120,90,50,0.16)";
        mctx.fillRect(sx + 6, sy + 6, 3, 3);
      }
    }
  }

  /* ---------- darker, less‑welcoming center ---------- */
  const centerRadius = Math.max(0, (edges.dark+1) * TILE);
  if (centerRadius > 0) {
    mctx.fillStyle = "rgba(0,0,0,0.16)";
    mctx.beginPath();
    mctx.arc(cx*TILE, cy*TILE, centerRadius, 0, Math.PI*2);
    mctx.fill();
  }

  /* ---------- grid overlay ---------- */
  mctx.strokeStyle = COLORS.grid;
  mctx.lineWidth = 1;
  for (let y = 0; y <= WORLD; y++) {
    mctx.beginPath(); mctx.moveTo(0, y*TILE + 0.5); mctx.lineTo(worldPx, y*TILE + 0.5); mctx.stroke();
  }
  for (let x = 0; x <= WORLD; x++) {
    mctx.beginPath(); mctx.moveTo(x*TILE + 0.5, 0); mctx.lineTo(x*TILE + 0.5, worldPx); mctx.stroke();
  }

  return { cx, cy, edges, radial, ringAt, mapLayer, worldPx };
}

/** Extra ambient FX drawn over the visible area only (wavy pasture bands). */
export function drawVisibleFX(ctx, cam, now, { TILE, WORLD, ringAt }) {
  const x0 = Math.max(0, Math.floor(cam.x / TILE));
  const y0 = Math.max(0, Math.floor(cam.y / TILE));
  const x1 = Math.min(WORLD-1, Math.ceil((cam.x + cam.w) / TILE));
  const y1 = Math.min(WORLD-1, Math.ceil((cam.y + cam.h) / TILE));

  /* ---------- water shimmer (unchanged) ---------- */
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

  /* ---------- glen dappled light (unchanged) ---------- */
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

  /* ---------- PASTURE SHIMMER (wavy): dark band + thin light trail ---------- */
  const speed = 0.00125;            // motion speed
  const freqX = 0.40, freqY = 0.28; // base direction
  const trailShift = 0.55;          // distance between dark band and highlight

  // time scalers for wiggle
  const t1 = now * 0.0009;
  const t2 = now * 0.0013;
  const wiggle = (x, y) =>
    Math.sin(x*0.10 + y*0.05 + t1) * 0.50 +
    Math.sin(x*0.07 - y*0.08 - t2) * 0.40 +
    Math.sin(y*0.06 + t1*0.7)      * 0.28;


  // Dark lead band (faint)
  for (let y=y0; y<=y1; y++){
    for (let x=x0; x<=x1; x++){
      if (ringAt(x,y) !== "pasture") continue;
      const sx = x*TILE - cam.x, sy = y*TILE - cam.y;

      const base = (x*freqX + y*freqY) - now*speed;
      const k = base + wiggle(x, y);
      const wave = Math.sin(k);

      if (wave > 0.60) {
        const t = (wave - 0.60) / 0.40;   // 0..1 across crest
        const a = 0.02 + 0.04*t;          // max 0.06
        ctx.fillStyle = `rgba(0,0,0,${a})`;
        ctx.fillRect(sx, sy, TILE, TILE);
      }
    }
  }

  // Thin bright trail (also wavy, slightly behind)
  for (let y=y0; y<=y1; y++){
    for (let x=x0; x<=x1; x++){
      if (ringAt(x,y) !== "pasture") continue;
      const sx = x*TILE - cam.x, sy = y*TILE - cam.y;

      const base2 = (x*freqX + y*freqY) - now*speed + trailShift;
      const k2 = base2 + wiggle(x+17, y-23); // offset so it’s not identical
      const wave2 = Math.sin(k2);

      if (wave2 > 0.75) {
        const t2c = (wave2 - 0.75) / 0.25; // thin crest
        const a2 = 0.025 + 0.045*t2c;      // max ~0.07
        ctx.fillStyle = `rgba(255,255,255,${a2})`;
        ctx.fillRect(sx, sy, TILE, TILE);
      }
    }
  }

  /* ---------- dark forest fireflies (unchanged) ---------- */
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

/* ================== FOOD PATCHES ================== */
export function createFoodPatches(world, count) {
  const { WORLD, ringAt } = world;
  const set = new Set();
  let guard = 0;
  while (set.size < count && guard < count * 50) {
    guard++;
    const x = Math.floor(Math.random() * WORLD);
    const y = Math.floor(Math.random() * WORLD);
    if (ringAt(x, y) !== "pasture") continue;
    set.add(`${x},${y}`);
  }
  return set;
}

export function drawFoodPatches(ctx, cam, TILE, patchSet) {
  if (!patchSet || patchSet.size === 0) return;
  ctx.save();
  for (const key of patchSet) {
    const [xs, ys] = key.split(",");
    const x = +xs, y = +ys;
    const sx = x * TILE - cam.x;
    const sy = y * TILE - cam.y;
    ctx.fillStyle = "#9bf07a";
    ctx.fillRect(sx + 3, sy + 3, TILE - 6, TILE - 6);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 3, sy + 3, TILE - 6, TILE - 6);
  }
  ctx.restore();
}