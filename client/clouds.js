// client/clouds.js
"use strict";

/** Loader that tracks readiness and logs failures. */
function load(src){
  const img = new Image();
  const spr = { img, ready: false, w: 0, h: 0, src };
  img.onload  = () => { spr.ready = true; spr.w = img.naturalWidth; spr.h = img.naturalHeight; };
  img.onerror = () => { spr.ready = false; console.warn("[clouds] failed to load:", src); };
  img.src = src;
  return spr;
}

/** Drifting cloud layer with debug badge + fallbacks. */
export function createClouds({
  canvas,
  count = 7,
  images = ["assets/cloud1.png", "assets/cloud2.png", "assets/cloud3.png"],
  speedRange = [12, 28],   // px/s
  scaleRange = [0.9, 1.7],
  alphaRange = [0.12, 0.22],
  parallax = 0.18          // 0..1 (0 = screen-space)
} = {}) {
  const sprs = images.map(load);
  const clouds = [];

  const rand = (a,b)=> a + Math.random()*(b-a);
  const pickSprite = () => {
    const ready = sprs.filter(s => s.ready);
    return (ready.length ? ready : sprs)[Math.floor(Math.random()*sprs.length)];
  };

  function spawn(offscreenLeft = false){
    const spr = pickSprite();
    const scl = rand(scaleRange[0], scaleRange[1]);
    const w = (spr?.w || 260) * scl;
    const h = (spr?.h || 160) * scl;
    return {
      spr, w, h, scale: scl,
      x: offscreenLeft ? -w - rand(60,240) : rand(-200, canvas.width + 200),
      y: rand(-80, canvas.height - h + 80),
      v: rand(speedRange[0], speedRange[1]),
      a: rand(alphaRange[0], alphaRange[1])
    };
  }

  // scatter some clouds across the screen
  for (let i=0;i<count;i++) clouds.push(spawn(false));

  let lastCam = { x: 0, y: 0 };

  function update(now, dtMs, cam = {x:0,y:0}){
    const dt = Math.max(0.001, dtMs / 1000);

    // parallax: move opposite to camera motion
    if (parallax !== 0){
      const dx = cam.x - lastCam.x;
      const dy = cam.y - lastCam.y;
      for (const c of clouds){ c.x -= dx * parallax; c.y -= dy * parallax; }
      lastCam = { x: cam.x, y: cam.y };
    }

    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x > canvas.width + 140) {
        // recycle to left with new sprite/params
        const spr = pickSprite();
        const scl = rand(scaleRange[0], scaleRange[1]);
        c.spr = spr;
        c.scale = scl;
        c.w = (spr?.w || 260) * scl;
        c.h = (spr?.h || 160) * scl;
        c.x = -c.w - rand(60,240);
        c.y = rand(-80, canvas.height - c.h + 80);
        c.v = rand(speedRange[0], speedRange[1]);
        c.a = rand(alphaRange[0], alphaRange[1]);
      }
    }
  }

  function draw(ctx){
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const c of clouds){
      if (c.spr?.ready && c.w > 0 && c.h > 0){
        ctx.globalAlpha = c.a;
        ctx.drawImage(c.spr.img, c.x, c.y, c.w, c.h);
      } else {
        // visible fallback blob so you see clouds even if images didn't load
        const r = Math.max(90, Math.min(ctx.canvas.width, ctx.canvas.height) * 0.10);
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = "#0b140f";
        ctx.beginPath(); ctx.arc(c.x + r, c.y + r*0.6, r, 0, Math.PI*2); ctx.fill();
      }
    }
    ctx.restore();

    // Debug badge: how many images are ready?
    const ready = sprs.filter(s=>s.ready).length;
    if (ready !== sprs.length){
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(10, 70, 130, 22);
      ctx.fillStyle = "#fff";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(`CLOUDS: ${ready}/${sprs.length}`, 18, 86);
      ctx.restore();
    }
  }

  return { update, draw };
}