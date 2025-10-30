import { MapScene } from './scene/MapScene.js';

const container = document.getElementById('app');
if (!container) {
  throw new Error('Expected #app container element to exist.');
}

const scene = new MapScene({ container });
scene.resizeToDisplay();

const worker = new Worker(new URL('./sim/sim.worker.ts', import.meta.url), {
  type: 'module',
});

worker.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;
  if (message.type === 'SNAPSHOT' || message?.snapshot?.type === 'SNAPSHOT') {
    const snapshot = message.snapshot ?? message;
    scene.updateFromSnapshot(snapshot);
  }
});

worker.postMessage({ type: 'INIT' });

function loop() {
  requestAnimationFrame(loop);
  scene.render();
}

loop();

window.addEventListener('resize', () => {
  scene.resizeToDisplay();
});
