
self.onmessage = (event) => {
  const { width, height, data, strength = 50 } = event.data || {};
  if (!width || !height || !data) return;
  const src = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(src.length);
  const amount = Math.max(0, Math.min(100, Number(strength))) / 100;
  const center = 1 + (4 * amount);
  const side = -amount;
  const kernel = [0, side, 0, side, center, side, 0, side, 0];

  for (let y = 0; y < height; y++) {
    if (y % 250 === 0) self.postMessage({ type: "progress", progress: Math.round((y / height) * 100) });
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        let ki = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++, ki++) {
            const xx = Math.min(width - 1, Math.max(0, x + ox));
            const yy = Math.min(height - 1, Math.max(0, y + oy));
            sum += src[(yy * width + xx) * 4 + ch] * kernel[ki];
          }
        }
        out[idx + ch] = Math.max(0, Math.min(255, sum));
      }
      out[idx + 3] = src[idx + 3];
    }
  }

  self.postMessage({ type: "done", width, height, data: out.buffer }, [out.buffer]);
};