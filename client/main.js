// ---- CONFIG ----
const TILE = 20;            // px per tile
const SIZE = 80;            // 80x80 grid (feels big)
const GRID_COLOR = "rgba(0,0,0,0.18)";

// ring widths (in tiles)
const R_PASTURE = 20;
const R_WATER   = 7;
const R_GLEN    = 14;
const R_DARK    = 19; // remaining center

// palette
const COLORS = {
  pasture: "#7ccf4f",
  water:   "#4aa7c9",
  glen:    "#4c8b41",
  dark:    "#234020"
};

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

// Make canvas the board size; scale down via CSS automatically
canvas.width  = SIZE * TILE;
canvas.height = SIZE * TILE;

const cx = Math.floor(SIZE/2);
const cy = Math.floor(SIZE/2);

// compute ring for each tile
function ringFor(x,y){
  const dx = x - cx + 0.5;
  const dy = y - cy + 0.5;
  const r  = Math.sqrt(dx*dx + dy*dy);
  return r;
}

const maxR = Math.min(cx, cy) - 1;
const edges = {
  pasture: maxR,
  water:   maxR - R_PASTURE,
  glen:    maxR - R_PASTURE - R_WATER,
  dark:    maxR - R_PASTURE - R_WATER - R_GLEN
};

// draw rings tile-by-tile for a gridded look
for (let y=0; y<SIZE; y++){
  for (let x=0; x<SIZE; x++){
    const r = ringFor(x,y);
    let color;
    if (r > edges.water) color = COLORS.pasture;
    else if (r > edges.glen) color = COLORS.water;
    else if (r > edges.dark) color = COLORS.glen;
    else color = COLORS.dark;

    // subtle texture: random tiny alpha noise
    ctx.fillStyle = color;
    ctx.fillRect(x*TILE, y*TILE, TILE, TILE);

    // noise overlay
    const n = (Math.sin((x*97 + y*57)) + 1) * 0.08; // deterministic variation
    ctx.fillStyle = `rgba(0,0,0,${n})`;
    ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
  }
}

// darker, less welcoming center
ctx.fillStyle = "rgba(0,0,0,0.15)";
ctx.beginPath();
ctx.arc(cx*TILE, cy*TILE, (edges.dark+1)*TILE, 0, Math.PI*2);
ctx.fill();

// grid overlay
ctx.strokeStyle = GRID_COLOR;
ctx.lineWidth = 1;
for (let y=0; y<=SIZE; y++){
  ctx.beginPath();
  ctx.moveTo(0, y*TILE + 0.5);
  ctx.lineTo(SIZE*TILE, y*TILE + 0.5);
  ctx.stroke();
}
for (let x=0; x<=SIZE; x++){
  ctx.beginPath();
  ctx.moveTo(x*TILE + 0.5, 0);
  ctx.lineTo(x*TILE + 0.5, SIZE*TILE);
  ctx.stroke();
}
