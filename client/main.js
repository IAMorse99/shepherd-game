// ---- CONFIG ----
const TILE = 20;                 // px per tile
const SIZE = 80;                 // 80x80 grid
const GRID_COLOR = "rgba(0,0,0,0.18)";
const STEP_MS = 90;              // time per tile when a key is held

// ring widths (in tiles)
const R_PASTURE = 20;
const R_WATER   = 7;
const R_GLEN    = 14;
// R_DARK is implied; it's whatever remains
const COLORS = {
  pasture: "#7ccf4f",
  water:   "#4aa7c9",
  glen:    "#4c8b41",
  dark:    "#234020"
};

// ---- CANVAS ----
const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
canvas.width  = SIZE * TILE;
canvas.height = SIZE * TILE;

const cx = Math.floor(SIZE/2);
const cy = Math.floor(SIZE/2);
const maxR = Math.min(cx, cy) - 1;

const edges = {
  pasture: maxR,
  water:   maxR - R_PASTURE,
  glen:    maxR - R_PASTURE - R_WATER,
  dark:    maxR - R_PASTURE - R_WATER - R_GLEN
};

// distance-from-center (tile coords -> float radius)
function radial(x,y){
  const dx = x - cx + 0.5, dy = y - cy + 0.5;
  return Math.sqrt(dx*dx + dy*dy);
}

// which ring a tile belongs to
function ringAt(x,y){
  const r = radial(x,y);
  if (r > edges.water) return "pasture";
  if (r > edges.glen)  return "water";
  if (r > edges.dark)  return "glen";
  return "dark";
}

// ---- STATIC MAP LAYER (draw once to an offscreen canvas) ----
const mapLayer = document.createElement("canvas");
mapLayer.width = canvas.width; mapLayer.height = canvas.height;
const mctx = mapLayer.getContext("2d");

// tiles
for (let y=0; y<SIZE; y++){
  for (let x=0; x<SIZE; x++){
    const r = ringAt(x,y);
    mctx.fillStyle = COLORS[r];
    mctx.fillRect(x*TILE, y*TILE, TILE, TILE);

    // tiny deterministic noise for texture
    const n = (Math.sin((x*97 + y*57)) + 1) * 0.08;
    mctx.fillStyle = `rgba(0,0,0,${n})`;
    mctx.fillRect(x*TILE, y*TILE, TILE, TILE);
  }
}
// darker, less welcoming center
mctx.fillStyle = "rgba(0,0,0,0.15)";
mctx.beginPath();
mctx.arc(cx*TILE, cy*TILE, (edges.dark+1)*TILE, 0, Math.PI*2);
mctx.fill();

// grid overlay
mctx.strokeStyle = GRID_COLOR; mctx.lineWidth = 1;
for (let y=0; y<=SIZE; y++){
  mctx.beginPath(); mctx.moveTo(0, y*TILE + 0.5);
  mctx.lineTo(SIZE*TILE, y*TILE + 0.5); mctx.stroke();
}
for (let x=0; x<=SIZE; x++){
  mctx.beginPath(); mctx.moveTo(x*TILE + 0.5, 0);
  mctx.lineTo(x*TILE + 0.5, SIZE*TILE); mctx.stroke();
}

// ---- PLAYER ----
const player = {
  x: cx,                 // start near center for now (change later to outer ring)
  y: edges.pasture - 2,  // slightly inside the pasture ring
  moveCooldown: 0
};

// continuous input state
const held = { up:false, down:false, left:false, right:false };
const keymap = {
  ArrowUp:   "up",    KeyW: "up",
  ArrowDown: "down",  KeyS: "down",
  ArrowLeft: "left",  KeyA: "left",
  ArrowRight:"right", KeyD: "right"
};
addEventListener("keydown", (e)=>{
  const k = keymap[e.code]; if (!k) return;
  held[k] = true; e.preventDefault();
});
addEventListener("keyup", (e)=>{
  const k = keymap[e.code]; if (!k) return;
  held[k] = false; e.preventDefault();
});

// only allow walking within the outer ring (feels like a big circle)
function canWalk(nx, ny){
  if (nx<0||ny<0||nx>=SIZE||ny>=SIZE) return false;
  // allow anywhere inside the outer pasture edge
  return radial(nx,ny) <= edges.pasture + 0.2;
}

// step one tile in the first pressed direction (UDLR priority)
function tryMove(){
  const dir = held.up ? [0,-1]
            : held.down ? [0, 1]
            : held.left ? [-1,0]
            : held.right? [1, 0]
            : null;
  if (!dir) return false;
  const nx = player.x + dir[0];
  const ny = player.y + dir[1];
  if (canWalk(nx, ny)){
    player.x = nx; player.y = ny;
    return true;
  }
  return false;
}

// ---- MAIN LOOP ----
let last = performance.now();
function loop(now){
  const dt = now - last; last = now;

  // movement cadence
  player.moveCooldown -= dt;
  if (player.moveCooldown <= 0){
    if (tryMove()){
      player.moveCooldown = STEP_MS;
    } else if (!held.up && !held.down && !held.left && !held.right){
      // no key held -> reset cooldown so first press is snappy
      player.moveCooldown = 0;
    } else {
      // blocked but key held: try again soon
      player.moveCooldown = STEP_MS;
    }
  }

  // draw
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(mapLayer, 0, 0);

  // player marker (simple circle with stroke)
  const px = player.x*TILE + TILE/2, py = player.y*TILE + TILE/2;
  ctx.beginPath(); ctx.arc(px, py, TILE*0.35, 0, Math.PI*2);
  ctx.fillStyle = "#fdfdfd"; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = "#1c1c1c"; ctx.stroke();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
