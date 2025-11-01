export function createOverlayCanvas(container) {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '10';
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;

  container.appendChild(canvas);
  const context = canvas.getContext('2d');

  const resize = (width, height) => {
    canvas.width = width;
    canvas.height = height;
  };

  const draw = (snapshot) => {
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!snapshot) return;
    context.fillStyle = 'rgba(255,255,255,0.35)';
    context.font = '12px sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    let offsetY = 12;
    if (typeof snapshot.tick === 'number') {
      context.fillText(`Tick ${snapshot.tick}`, 12, offsetY);
      offsetY += 16;
    }
    if (snapshot.randomnessMode) {
      const intensity =
        typeof snapshot.randomnessIntensity === 'number'
          ? snapshot.randomnessIntensity.toFixed(2)
          : '—';
      context.fillText(
        `Randomness: ${snapshot.randomnessMode} (temp ${intensity})`,
        12,
        offsetY
      );
      offsetY += 16;
    }
    if (snapshot.seed !== undefined && snapshot.seed !== null) {
      context.fillText(`Seed: ${snapshot.seed}`, 12, offsetY);
    }
  };

  return { canvas, context, resize, draw };
}
