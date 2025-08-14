// client/clouds.js
export function createClouds({ canvas, count = 5, parallax = 0.2, images = [] }) {
  const clouds = [];
  const imgEls = [];

  // Load all cloud images
  for (const src of images) {
    const img = new Image();
    img.src = src;
    imgEls.push(img);
  }

  // Make random cloud objects
  function spawnCloud() {
    const img = imgEls[Math.floor(Math.random() * imgEls.length)];
    return {
      img,
      x: Math.random() * (canvas.width * 2), // start spread wider than screen
      y: Math.random() * (canvas.height / 2),
      speed: 10 + Math.random() * 20, // px/sec
      scale: 0.8 + Math.random() * 0.4,
    };
  }

  for (let i = 0; i < count; i++) {
    clouds.push(spawnCloud());
  }

  return {
    update(now, dt, cam) {
      const seconds = dt / 1000;
      for (const c of clouds) {
        c.x -= c.speed * seconds;
        // recycle cloud to the right if it leaves left side
        if (c.x + (c.img.width * c.scale) < -50) {
          const newCloud = spawnCloud();
          newCloud.x = canvas.width + Math.random() * canvas.width;
          newCloud.y = Math.random() * (canvas.height / 2);
          Object.assign(c, newCloud);
        }
      }
    },
    draw(ctx) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      for (const c of clouds) {
        if (!c.img.complete) continue;
        ctx.drawImage(
          c.img,
          c.x,
          c.y,
          c.img.width * c.scale,
          c.img.height * c.scale
        );
      }
      ctx.restore();
    }
  };
}