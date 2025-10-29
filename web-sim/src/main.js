import { OrthographicCamera, WebGLRenderer } from 'three';
import { MapScene } from './scene/MapScene.js';
import { createOverlayCanvas } from './scene/ui-overlay.js';
import { onSnapshot, sendInit } from './util/messageBus.js';

/** @typedef {import('./util/snapshotTypes.js').Snapshot} Snapshot */

const DEFAULT_WORLD = { width: 100, height: 100 };
const INIT_MESSAGE = {
  seed: 42,
  worldSize: [DEFAULT_WORLD.width, DEFAULT_WORLD.height],
  adults: 6,
  ticksPerUpdate: 4,
};

const container = document.getElementById('app');
if (!container) {
  throw new Error('Missing #app container for renderer.');
}
container.innerHTML = '';
container.style.position = 'relative';

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio ?? 1);
container.appendChild(renderer.domElement);

const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);

const mapScene = new MapScene({
  worldWidth: DEFAULT_WORLD.width,
  worldHeight: DEFAULT_WORLD.height,
});

const overlay = createOverlayCanvas(container);

function updateCameraView() {
  const width = container.clientWidth || window.innerWidth || DEFAULT_WORLD.width;
  const height = container.clientHeight || window.innerHeight || DEFAULT_WORLD.height;
  const aspect = width / height;
  const frustum = Math.max(DEFAULT_WORLD.width, DEFAULT_WORLD.height);
  camera.left = (-frustum * aspect) / 2;
  camera.right = (frustum * aspect) / 2;
  camera.top = frustum / 2;
  camera.bottom = -frustum / 2;
  camera.position.set(DEFAULT_WORLD.width / 2, DEFAULT_WORLD.height / 2, 100);
  camera.lookAt(DEFAULT_WORLD.width / 2, DEFAULT_WORLD.height / 2, 0);
  camera.updateProjectionMatrix();

  renderer.setSize(width, height, false);
  overlay.resize(width, height);
}

updateCameraView();
window.addEventListener('resize', updateCameraView);

const worker = new Worker(new URL('./sim/sim.worker.js', import.meta.url), {
  type: 'module',
});

onSnapshot(
  worker,
  /** @param {Snapshot} snapshot */ (snapshot) => {
    mapScene.updateFromSnapshot(snapshot);
    overlay.draw(mapScene.latestSnapshot);
  }
);

sendInit(worker, INIT_MESSAGE);

function renderLoop() {
  requestAnimationFrame(renderLoop);
  renderer.render(mapScene.scene, camera);
}

renderLoop();
