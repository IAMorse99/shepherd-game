// client/clouds.js
"use strict";

/** tiny loader */
function load(src){
  const img = new Image();
  const spr = { img, ready:false, w:0, h:0 };
  img.onload  = () => { spr.ready = true; spr.w = img.naturalWidth; spr.h = img.naturalHeight; };
  img.onerror = () => { spr.ready = false; };
  img.src = src;
  return spr;
}

/** World-space clouds with draw-time parallax. */
export function createClouds({
  canvas,
  count = 7,
  images = ["assets/cloud1.png","assets/cloud2.png","assets/cloud3.png"],
  speedRange = [12, 28],   // px/s
  scaleRange = [0.9, 1.7],
  alphaRange = [0.12, 0.22],
  parallax = 0.5           // 0..1; 0 = stuck to camera, 1 = world-tied
} = {}) {
  const sprs = images.map(load);

  const rand = (a,b)=> a + Math.random()*(b-a);
  const pick = () => {
    const ready = sprs.filter(s=>s.ready);
    return (ready.length ? ready : sprs)[Math.floor(Math.random()*sprs.length)];
  };

  // world-space cloud objects (x,y are in world pixels)
  const clouds = [];
  function spawn(offLeft = false){
    const spr = pick();
    const scl = rand(scaleRange[0], scaleRange[1]);
    const w = (spr?.w || 260) * scl;
    const h = (spr?.h || 160) * scl;
    return {
      spr, w, h, scale:scl,
      x: offLeft ? -w - rand(200,800) : rand(-200, canvas.width + 200), // world coords near origin
      y: rand(-400, canvas.height + 200), // broad vertical band
      v: rand(speedRange[0], speedRange[1]),
      a: rand(alphaRange[0], alphaRange[1])
    };
  }
  for (let i=0;i<count;i++) clouds.push(spawn(false));

  function update(now, dtMs){
    const dt = Math.max(0.001, dtMs/1000);
    for (const c of clouds){
      c.x += c.v * dt;                 // drift east in world space
      if (c.x > canvas.width + 2000) { // recycle far to the left
        const spr = pick();
        const scl = rand(scaleRange[0], scaleRange[1]);
        c.spr = spr; c.scale = scl;
        c.w = (spr?.w || 260) * scl; c.h = (spr?.h || 160) * scl;
        c.x = -c.w - rand(800, 1600);
        c.y = rand(-400, canvas.height + 200);
        c.v = rand(speedRange[0], speedRange[1]);
        c.a = rand(alphaRange[0], alphaRange[1]);
      }
    }
  }

  function draw(ctx, cam = {x:0,y:0}){
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const c of clouds){
      const sx = c.x - cam.x * parallax; // parallax applied here
      const sy = c.y - cam.y * parallax;
      if (c.spr?.ready) {
        ctx.globalAlpha = c.a;
        ctx.drawImage(c.spr.img, sx, sy, c.w, c.h);
      } else {
        // visible fallback blob
        const r = Math.max(90, Math.min(ctx.canvas.width, ctx.canvas.height) * 0.10);
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = "#0b140f";
        ctx.beginPath(); ctx.arc(sx + r, sy + r*0.6, r, 0, Math.PI*2); ctx.fill();
      }
    }
    ctx.restore();
  }

  return { update, draw };
}