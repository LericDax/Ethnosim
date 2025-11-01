import { OrthographicCamera, WebGLRenderer } from 'three';
import { MapScene } from './scene/MapScene.js';
import { createOverlayCanvas } from './scene/ui-overlay.js';
import { onSnapshot, sendInit } from './util/messageBus.js';

/** @typedef {import('./util/snapshotTypes.js').Snapshot} Snapshot */

const DEFAULT_WORLD = { width: 100, height: 100 };
const BASE_INIT_CONFIG = {
  worldSize: [DEFAULT_WORLD.width, DEFAULT_WORLD.height],
  adults: 6,
  ticksPerUpdate: 4,
  randomnessMode: 'deterministic',
  randomnessIntensity: 0,
};

const DEFAULT_INIT_CONFIG = {
  ...BASE_INIT_CONFIG,
  seed: 42,
};

function parseNumber(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseUrlConfig() {
  const params = new URLSearchParams(window.location.search);
  /** @type {Record<string, unknown>} */
  const overrides = {};
  if (params.has('seed')) {
    const value = params.get('seed');
    if (value !== null && value !== '') {
      overrides.seed = value;
    }
  }
  if (params.has('mode')) {
    const mode = params.get('mode');
    if (mode === 'chaotic' || mode === 'deterministic') {
      overrides.randomnessMode = mode;
    }
  }
  if (params.has('intensity')) {
    const raw = params.get('intensity');
    if (raw !== null) {
      const parsed = parseFloat(raw);
      if (Number.isFinite(parsed)) {
        overrides.randomnessIntensity = clamp(parsed, 0, 1);
      }
    }
  }
  return overrides;
}

function buildInitPayload(config) {
  const payload = {
    ...BASE_INIT_CONFIG,
    randomnessMode: config.randomnessMode || 'deterministic',
    randomnessIntensity: parseNumber(
      config.randomnessIntensity,
      BASE_INIT_CONFIG.randomnessIntensity
    ),
  };
  if (Array.isArray(config.worldSize) && config.worldSize.length === 2) {
    payload.worldSize = config.worldSize;
  }
  payload.adults = parseNumber(config.adults, BASE_INIT_CONFIG.adults);
  payload.ticksPerUpdate = parseNumber(
    config.ticksPerUpdate,
    BASE_INIT_CONFIG.ticksPerUpdate
  );

  if (
    payload.randomnessMode !== 'chaotic' ||
    (config.seed !== undefined && config.seed !== null && config.seed !== '')
  ) {
    if (config.seed !== undefined && config.seed !== null && config.seed !== '') {
      payload.seed = config.seed;
    } else if (payload.randomnessMode !== 'chaotic' && DEFAULT_INIT_CONFIG.seed !== undefined) {
      payload.seed = DEFAULT_INIT_CONFIG.seed;
    }
  }

  if (payload.randomnessMode === 'chaotic') {
    payload.randomnessIntensity = clamp(
      typeof config.randomnessIntensity === 'number'
        ? config.randomnessIntensity
        : parseNumber(config.randomnessIntensity, 1),
      0,
      1
    );
  } else {
    payload.randomnessIntensity = 0;
  }

  return payload;
}

function updateUrlFromConfig(config) {
  const params = new URLSearchParams(window.location.search);
  if (config.seed !== undefined && config.seed !== null && config.seed !== '') {
    params.set('seed', String(config.seed));
  } else {
    params.delete('seed');
  }
  if (config.randomnessMode && config.randomnessMode !== 'deterministic') {
    params.set('mode', config.randomnessMode);
  } else {
    params.delete('mode');
  }
  if (
    config.randomnessMode === 'chaotic' &&
    typeof config.randomnessIntensity === 'number'
  ) {
    params.set('intensity', String(config.randomnessIntensity));
  } else {
    params.delete('intensity');
  }
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState({}, document.title, nextUrl);
}

function createControlPanel(container, initialConfig, onApply) {
  const form = document.createElement('form');
  form.style.position = 'absolute';
  form.style.top = '12px';
  form.style.right = '12px';
  form.style.padding = '12px';
  form.style.background = 'rgba(5, 7, 10, 0.75)';
  form.style.color = '#f4f4f8';
  form.style.font = '12px/1.4 sans-serif';
  form.style.borderRadius = '6px';
  form.style.display = 'grid';
  form.style.gap = '8px';
  form.style.minWidth = '220px';
  form.style.pointerEvents = 'auto';
  form.style.zIndex = '20';

  const heading = document.createElement('div');
  heading.textContent = 'Simulation Controls';
  heading.style.fontWeight = '600';
  form.appendChild(heading);

  const seedLabel = document.createElement('label');
  seedLabel.textContent = 'Seed';
  const seedInput = document.createElement('input');
  seedInput.type = 'text';
  seedInput.name = 'seed';
  seedInput.placeholder = 'e.g. 42 or my-seed';
  seedInput.value = initialConfig.seed !== undefined ? String(initialConfig.seed) : '';
  seedInput.style.width = '100%';
  seedInput.style.boxSizing = 'border-box';
  seedLabel.appendChild(seedInput);
  form.appendChild(seedLabel);

  const modeLabel = document.createElement('label');
  modeLabel.textContent = 'Randomness Mode';
  const modeSelect = document.createElement('select');
  modeSelect.name = 'randomnessMode';
  modeSelect.style.width = '100%';
  const deterministicOption = document.createElement('option');
  deterministicOption.value = 'deterministic';
  deterministicOption.textContent = 'Deterministic';
  const chaoticOption = document.createElement('option');
  chaoticOption.value = 'chaotic';
  chaoticOption.textContent = 'Chaotic';
  modeSelect.appendChild(deterministicOption);
  modeSelect.appendChild(chaoticOption);
  modeSelect.value = initialConfig.randomnessMode || 'deterministic';
  modeLabel.appendChild(modeSelect);
  form.appendChild(modeLabel);

  const intensityWrapper = document.createElement('label');
  intensityWrapper.textContent = 'Randomness Temp';
  const intensityInput = document.createElement('input');
  intensityInput.type = 'range';
  intensityInput.min = '0';
  intensityInput.max = '1';
  intensityInput.step = '0.05';
  intensityInput.name = 'randomnessIntensity';
  intensityInput.value = String(
    typeof initialConfig.randomnessIntensity === 'number'
      ? clamp(initialConfig.randomnessIntensity, 0, 1)
      : 1
  );
  intensityInput.style.width = '100%';
  const intensityValue = document.createElement('div');
  intensityValue.style.display = 'flex';
  intensityValue.style.justifyContent = 'space-between';
  intensityValue.style.fontSize = '11px';
  const intensityReadout = document.createElement('span');
  intensityReadout.textContent = Number.parseFloat(intensityInput.value).toFixed(2);
  const intensityHint = document.createElement('span');
  intensityHint.textContent = '0 = stable, 1 = wild';
  intensityValue.appendChild(intensityReadout);
  intensityValue.appendChild(intensityHint);
  intensityWrapper.appendChild(intensityInput);
  intensityWrapper.appendChild(intensityValue);
  form.appendChild(intensityWrapper);

  const applyButton = document.createElement('button');
  applyButton.type = 'submit';
  applyButton.textContent = 'Apply & Restart';
  applyButton.style.padding = '6px 8px';
  applyButton.style.border = '1px solid rgba(244,244,248,0.2)';
  applyButton.style.background = 'rgba(15,18,24,0.8)';
  applyButton.style.color = '#f4f4f8';
  applyButton.style.cursor = 'pointer';
  form.appendChild(applyButton);

  const syncControls = () => {
    const mode = modeSelect.value === 'chaotic' ? 'chaotic' : 'deterministic';
    const isChaotic = mode === 'chaotic';
    intensityInput.disabled = !isChaotic;
    intensityInput.style.opacity = isChaotic ? '1' : '0.5';
    intensityHint.textContent = isChaotic
      ? '0 = seed-biased, 1 = wild'
      : 'Locked in deterministic mode';
    if (!isChaotic) {
      intensityInput.value = '0';
    }
    intensityReadout.textContent = Number.parseFloat(intensityInput.value).toFixed(2);
  };

  intensityInput.addEventListener('input', () => {
    intensityReadout.textContent = Number.parseFloat(intensityInput.value).toFixed(2);
  });
  modeSelect.addEventListener('change', () => {
    syncControls();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const mode = modeSelect.value === 'chaotic' ? 'chaotic' : 'deterministic';
    const intensity = Number.parseFloat(intensityInput.value);
    /** @type {Record<string, unknown>} */
    const nextConfig = {
      randomnessMode: mode,
      randomnessIntensity: Number.isFinite(intensity) ? clamp(intensity, 0, 1) : undefined,
    };
    const trimmedSeed = seedInput.value.trim();
    nextConfig.seed = trimmedSeed === '' ? null : trimmedSeed;
    onApply(nextConfig);
  });

  syncControls();
  container.appendChild(form);

  return {
    form,
    seedInput,
    modeSelect,
    intensityInput,
  };
}

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

const urlConfig = parseUrlConfig();
const initialConfig = {
  ...DEFAULT_INIT_CONFIG,
  ...urlConfig,
};

if (initialConfig.randomnessMode === 'chaotic' && !('seed' in urlConfig)) {
  delete initialConfig.seed;
}

let currentConfig = { ...initialConfig };
createControlPanel(container, initialConfig, (config) => {
  if (config.seed === null) {
    delete currentConfig.seed;
  }
  currentConfig = {
    ...currentConfig,
    ...config,
  };
  if (config.seed === null) {
    delete currentConfig.seed;
  }
  const payload = buildInitPayload(currentConfig);
  currentConfig.randomnessMode = payload.randomnessMode;
  currentConfig.randomnessIntensity = payload.randomnessMode === 'chaotic' ? payload.randomnessIntensity : 0;
  if (payload.seed !== undefined) {
    currentConfig.seed = payload.seed;
  } else {
    delete currentConfig.seed;
  }
  updateUrlFromConfig(currentConfig);
  sendInit(worker, payload);
});

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

const initialPayload = buildInitPayload(initialConfig);
updateUrlFromConfig(initialConfig);
sendInit(worker, initialPayload);

function renderLoop() {
  requestAnimationFrame(renderLoop);
  renderer.render(mapScene.scene, camera);
}

renderLoop();
