const DEFAULT_TICK_INTERVAL = 500;
const MIN_TICK_INTERVAL = 50;
const MAX_TICK_INTERVAL = 4000;
const MIN_TICKS_PER_UPDATE = 1;
const MAX_TICKS_PER_UPDATE = 50;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatStageStats(stats) {
  if (!stats) {
    return 'Population: –';
  }
  const total = (stats.baby ?? 0) + (stats.child ?? 0) + (stats.teen ?? 0) + (stats.adult ?? 0);
  return `Population: ${total} (baby ${stats.baby ?? 0}, child ${stats.child ?? 0}, teen ${stats.teen ?? 0}, adult ${stats.adult ?? 0})`;
}

export class HUD {
  constructor({ container = document.body, scene, worker } = {}) {
    if (!scene) {
      throw new Error('HUD requires a MapScene instance.');
    }
    if (!worker) {
      throw new Error('HUD requires a simulation worker reference.');
    }

    this.container = container;
    this.scene = scene;
    this.worker = worker;

    this._isPaused = false;
    this._tickInterval = DEFAULT_TICK_INTERVAL;
    this._ticksPerUpdate = 1;
    this._agentOptionIds = new Set();
    this._detachSceneSelectionListener = null;

    this.root = document.createElement('div');
    this.root.className = 'hud-overlay';
    this._applyRootStyles();

    this.headerEl = document.createElement('div');
    this.headerEl.textContent = 'Simulation HUD';
    this.headerEl.style.fontWeight = '600';
    this.headerEl.style.marginBottom = '8px';
    this.root.appendChild(this.headerEl);

    this.statsEl = document.createElement('div');
    this.statsEl.style.marginBottom = '12px';
    this.statsEl.style.lineHeight = '1.4';
    this.tickValueEl = document.createElement('div');
    this.tickValueEl.textContent = 'Tick: –';
    this.populationEl = document.createElement('div');
    this.populationEl.textContent = 'Population: –';
    this.statsEl.appendChild(this.tickValueEl);
    this.statsEl.appendChild(this.populationEl);
    this.root.appendChild(this.statsEl);

    this.controlsEl = document.createElement('div');
    this.controlsEl.style.display = 'flex';
    this.controlsEl.style.flexDirection = 'column';
    this.controlsEl.style.gap = '8px';
    this.root.appendChild(this.controlsEl);

    this._buildPauseControl();
    this._buildTickIntervalControl();
    this._buildTicksPerUpdateControl();
    this._buildAgentSelect();
    this._buildHeatmapControls();

    if (typeof this.scene.onSelectedAgentChange === 'function') {
      this._handleSceneSelectionChange = this._handleSceneSelectionChange.bind(this);
      this._detachSceneSelectionListener = this.scene.onSelectedAgentChange(
        this._handleSceneSelectionChange,
      );
    }

    this.container.appendChild(this.root);
  }

  updateFromSnapshot(snapshot) {
    if (!snapshot || snapshot.type !== 'SNAPSHOT') {
      return;
    }

    if (typeof snapshot.tick === 'number') {
      this.tickValueEl.textContent = `Tick: ${snapshot.tick}`;
    }

    this.populationEl.textContent = formatStageStats(snapshot.stats);

    this._refreshAgentOptions(snapshot.agents ?? []);
  }

  _applyRootStyles() {
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '16px',
      left: '16px',
      padding: '12px',
      background: 'rgba(15, 23, 42, 0.85)',
      color: '#f8fafc',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '14px',
      borderRadius: '8px',
      boxShadow: '0 10px 30px rgba(2, 6, 23, 0.4)',
      zIndex: '100',
      minWidth: '240px',
      pointerEvents: 'auto',
    });
  }

  _buildPauseControl() {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.gap = '8px';
    wrapper.style.alignItems = 'center';

    this.pauseButton = document.createElement('button');
    this.pauseButton.type = 'button';
    this.pauseButton.textContent = 'Pause';
    this._styleButton(this.pauseButton);
    this.pauseButton.addEventListener('click', () => {
      if (this._isPaused) {
        this.worker.postMessage({ type: 'RESUME' });
        this._isPaused = false;
        this.pauseButton.textContent = 'Pause';
      } else {
        this.worker.postMessage({ type: 'PAUSE' });
        this._isPaused = true;
        this.pauseButton.textContent = 'Resume';
      }
      this.worker.postMessage({ type: 'REQUEST_SNAPSHOT' });
    });

    wrapper.appendChild(this.pauseButton);
    this.controlsEl.appendChild(wrapper);
  }

  _buildTickIntervalControl() {
    const wrapper = document.createElement('label');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';

    const label = document.createElement('span');
    label.textContent = 'Tick interval (ms)';

    this.tickIntervalInput = document.createElement('input');
    this.tickIntervalInput.type = 'number';
    this.tickIntervalInput.min = String(MIN_TICK_INTERVAL);
    this.tickIntervalInput.max = String(MAX_TICK_INTERVAL);
    this.tickIntervalInput.step = '50';
    this.tickIntervalInput.value = String(this._tickInterval);
    this._styleInput(this.tickIntervalInput);
    this.tickIntervalInput.addEventListener('change', () => {
      const value = clamp(parseInt(this.tickIntervalInput.value, 10), MIN_TICK_INTERVAL, MAX_TICK_INTERVAL);
      this._tickInterval = value;
      this.tickIntervalInput.value = String(value);
      this.worker.postMessage({ type: 'SET_TICK_INTERVAL', intervalMs: value });
    });

    wrapper.appendChild(label);
    wrapper.appendChild(this.tickIntervalInput);
    this.controlsEl.appendChild(wrapper);
  }

  _buildTicksPerUpdateControl() {
    const wrapper = document.createElement('label');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';

    const label = document.createElement('span');
    label.textContent = 'Ticks per update';

    this.ticksPerUpdateInput = document.createElement('input');
    this.ticksPerUpdateInput.type = 'number';
    this.ticksPerUpdateInput.min = String(MIN_TICKS_PER_UPDATE);
    this.ticksPerUpdateInput.max = String(MAX_TICKS_PER_UPDATE);
    this.ticksPerUpdateInput.step = '1';
    this.ticksPerUpdateInput.value = String(this._ticksPerUpdate);
    this._styleInput(this.ticksPerUpdateInput);
    this.ticksPerUpdateInput.addEventListener('change', () => {
      const value = clamp(parseInt(this.ticksPerUpdateInput.value, 10), MIN_TICKS_PER_UPDATE, MAX_TICKS_PER_UPDATE);
      this._ticksPerUpdate = value;
      this.ticksPerUpdateInput.value = String(value);
      this.worker.postMessage({ type: 'SET_TICKS_PER_UPDATE', ticksPerUpdate: value });
    });

    wrapper.appendChild(label);
    wrapper.appendChild(this.ticksPerUpdateInput);
    this.controlsEl.appendChild(wrapper);
  }

  _buildAgentSelect() {
    const wrapper = document.createElement('label');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';

    const label = document.createElement('span');
    label.textContent = 'Tracked agent';

    this.agentSelect = document.createElement('select');
    this.agentSelect.name = 'agent-selection';
    this._styleSelect(this.agentSelect);
    this._populateAgentSelect([]);

    this.agentSelect.addEventListener('change', () => {
      const agentId = this.agentSelect.value || null;
      this.scene.setSelectedAgent(agentId);
    });

    wrapper.appendChild(label);
    wrapper.appendChild(this.agentSelect);
    this.controlsEl.appendChild(wrapper);
  }

  _buildHeatmapControls() {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';
    wrapper.style.marginTop = '4px';

    const label = document.createElement('span');
    label.textContent = 'Heatmap layers';
    label.style.fontWeight = '500';
    wrapper.appendChild(label);

    const influenceToggle = this._createHeatmapToggle('Influence field', 'influence');
    const densityToggle = this._createHeatmapToggle('Population density', 'density');

    wrapper.appendChild(influenceToggle);
    wrapper.appendChild(densityToggle);

    this.controlsEl.appendChild(wrapper);
  }

  _createHeatmapToggle(labelText, layerId) {
    const row = document.createElement('label');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '6px';
    row.style.cursor = 'pointer';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = typeof this.scene.isHeatmapLayerEnabled === 'function'
      ? this.scene.isHeatmapLayerEnabled(layerId)
      : false;
    checkbox.addEventListener('change', () => {
      if (typeof this.scene.setHeatmapLayerEnabled === 'function') {
        this.scene.setHeatmapLayerEnabled(layerId, checkbox.checked);
      }
    });

    const span = document.createElement('span');
    span.textContent = labelText;

    row.appendChild(checkbox);
    row.appendChild(span);
    return row;
  }

  _populateAgentSelect(agents) {
    this.agentSelect.innerHTML = '';
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'None';
    this.agentSelect.appendChild(noneOption);

    const currentSelection = this.scene.selectedAgentId ?? '';
    this._agentOptionIds = new Set();

    for (const agent of agents) {
      if (!agent || !agent.id) continue;
      this._agentOptionIds.add(agent.id);
      const option = document.createElement('option');
      option.value = agent.id;
      const lifeStage = agent.lifeStage ? ` (${agent.lifeStage})` : '';
      option.textContent = `${agent.id}${lifeStage}`;
      this.agentSelect.appendChild(option);
    }

    if (currentSelection && this._agentOptionIds.has(currentSelection)) {
      this.agentSelect.value = currentSelection;
    } else {
      this.agentSelect.value = '';
      if (currentSelection) {
        this.scene.setSelectedAgent(null);
      }
    }
  }

  _refreshAgentOptions(agents) {
    const ids = new Set();
    for (const agent of agents) {
      if (agent && agent.id) {
        ids.add(agent.id);
      }
    }

    if (ids.size !== this._agentOptionIds.size) {
      this._populateAgentSelect(agents);
      return;
    }

    for (const id of ids) {
      if (!this._agentOptionIds.has(id)) {
        this._populateAgentSelect(agents);
        return;
      }
    }

    const currentSelection = this.scene.selectedAgentId;
    if (currentSelection && !ids.has(currentSelection)) {
      this.scene.setSelectedAgent(null);
      this.agentSelect.value = '';
    }
  }

  _handleSceneSelectionChange(agentId) {
    if (!this.agentSelect) {
      return;
    }

    if (agentId && !this._agentOptionIds.has(agentId)) {
      return;
    }

    const nextValue = agentId ?? '';
    if (this.agentSelect.value !== nextValue) {
      this.agentSelect.value = nextValue;
    }
  }

  _styleButton(button) {
    Object.assign(button.style, {
      background: '#2563eb',
      border: 'none',
      color: '#f8fafc',
      padding: '6px 10px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '500',
    });
    button.addEventListener('mouseenter', () => {
      button.style.background = '#1d4ed8';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = '#2563eb';
    });
  }

  _styleInput(input) {
    Object.assign(input.style, {
      background: 'rgba(15, 23, 42, 0.6)',
      border: '1px solid rgba(148, 163, 184, 0.4)',
      color: '#f8fafc',
      padding: '4px 6px',
      borderRadius: '6px',
    });
  }

  _styleSelect(select) {
    this._styleInput(select);
    select.style.cursor = 'pointer';
  }
}
