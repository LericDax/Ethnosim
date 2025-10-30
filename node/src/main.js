import { MapScene } from './scene/MapScene.js';
import { HUD } from './ui/HUD.js';

const container = document.getElementById('app');
if (!container) {
  throw new Error('Expected #app container element to exist.');
}

const scene = new MapScene({ container });
scene.resizeToDisplay();

const worker = new Worker(new URL('./sim/sim.worker.ts', import.meta.url), {
  type: 'module',
});

const hud = new HUD({ scene, worker });

worker.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;
  if (message.type === 'SNAPSHOT' || message?.snapshot?.type === 'SNAPSHOT') {
    const snapshot = message.snapshot ?? message;
    scene.updateFromSnapshot(snapshot);
    hud.updateFromSnapshot(snapshot);
  }
});

worker.postMessage({ type: 'INIT', ticksPerUpdate: 1, intervalMs: 500 });

function loop() {
  requestAnimationFrame(loop);
  scene.render();
}

loop();

window.addEventListener('resize', () => {
  scene.resizeToDisplay();
});
