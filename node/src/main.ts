import { MapView } from './scene/MapView.ts';
import { HUD } from './ui/HUD.js';

const container = document.getElementById('app');
if (!container) {
  throw new Error('Expected #app container element to exist.');
}

const mapView = new MapView({ container });

const worker = new Worker(new URL('./sim/sim.worker.ts', import.meta.url), {
  type: 'module',
});

const hud = new HUD({ scene: mapView, worker });

let latestSnapshot = null;

worker.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;
  if (message.type === 'SNAPSHOT' || message?.snapshot?.type === 'SNAPSHOT') {
    const snapshot = message.snapshot ?? message;
    latestSnapshot = snapshot;
    mapView.updateFromSnapshot(snapshot);
    hud.updateFromSnapshot(snapshot);
  }
});

worker.postMessage({ type: 'INIT', ticksPerUpdate: 1, intervalMs: 500 });

function handleResize() {
  mapView.resizeToDisplay();
  if (latestSnapshot) {
    mapView.updateFromSnapshot(latestSnapshot);
  }
}

window.addEventListener('resize', handleResize);
