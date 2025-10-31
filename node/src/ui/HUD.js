import { Inspector } from './Inspector.js';

const DEFAULT_TICK_INTERVAL = 500;
const MIN_TICK_INTERVAL = 50;
const MAX_TICK_INTERVAL = 4000;
const MIN_TICKS_PER_UPDATE = 1;
const MAX_TICKS_PER_UPDATE = 50;
const OVERLAY_LAYOUT_BREAKPOINT = 1200;

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

    this.host = document.createElement('div');
    this.host.className = 'hud-overlay-stack';
    this._applyHostStyles();
    this.container.appendChild(this.host);

    this.root = document.createElement('div');
    this.root.className = 'hud-overlay';
    this._applyRootStyles();
    this.host.appendChild(this.root);

    this.inspector = new Inspector({
      container: this.host,
      onRequestClose: () => {
        if (typeof this.scene.setSelectedAgent === 'function') {
          this.scene.setSelectedAgent(null);
        }
        if (typeof this.scene.setSelectedHouse === 'function') {
          this.scene.setSelectedHouse(null);
        }
        if (typeof this.scene.setSelectedCity === 'function') {
          this.scene.setSelectedCity(null);
        }
        this._handleSceneSelectionChange({ type: null, id: null, data: null });
      },
    });

    this._latestAgentsById = new Map();
    this._latestHousesById = new Map();
    this._latestCity = null;
    this._latestLeadership = null;
    this._currentSelection = { type: null, id: null, data: null };
    this.teleportButton = null;
    this.teleportHintEl = null;

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
    this.leadershipEl = document.createElement('div');
    this.leadershipEl.textContent = 'Leadership: –';
    this.statsEl.appendChild(this.leadershipEl);
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
    this._buildAgentActionControls();
    this._buildMapDisplayControls();
    this._buildHeatmapControls();
    this._buildCollectiveControls();

    this._handleResize = () => {
      this._updateOverlayLayout();
    };
    this._updateOverlayLayout();
    window.addEventListener('resize', this._handleResize);

    this._handleSceneSelectionChange = this._handleSceneSelectionChange.bind(this);
    if (typeof this.scene.onSelectionChange === 'function') {
      this._detachSceneSelectionListener = this.scene.onSelectionChange(
        this._handleSceneSelectionChange,
      );
    } else if (typeof this.scene.onSelectedAgentChange === 'function') {
      this._detachSceneSelectionListener = this.scene.onSelectedAgentChange(
        (agentId, agent) => {
          const selection = agentId
            ? { type: 'agent', id: agentId, data: agent ?? null }
            : { type: null, id: null, data: null };
          this._handleSceneSelectionChange(selection);
        },
      );
    }

    this._updateTeleportButtonState();
  }

  updateFromSnapshot(snapshot) {
    if (!snapshot || snapshot.type !== 'SNAPSHOT') {
      return;
    }

    if (typeof snapshot.tick === 'number') {
      this.tickValueEl.textContent = `Tick: ${snapshot.tick}`;
    }

    this.populationEl.textContent = formatStageStats(snapshot.stats);

    this._latestAgentsById = new Map();
    for (const agent of snapshot.agents ?? []) {
      if (agent?.id) {
        this._latestAgentsById.set(agent.id, agent);
      }
    }

    this._latestHousesById = new Map();
    for (const house of snapshot.houses ?? []) {
      if (house?.id) {
        this._latestHousesById.set(house.id, house);
      }
    }

    this._latestCity = snapshot.city ?? null;
    this._latestLeadership = snapshot.leadership ?? null;

    this._refreshAgentOptions(snapshot.agents ?? []);
    this._updateInspectorSelection();
    this._updateLeadershipSummary(snapshot);
  }

  _applyHostStyles() {
    Object.assign(this.host.style, {
      position: 'fixed',
      top: '16px',
      bottom: '16px',
      left: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      alignItems: 'stretch',
      overflowY: 'auto',
      paddingRight: '8px',
      zIndex: '100',
    });
  }

  _updateOverlayLayout() {
    if (typeof window === 'undefined') {
      return;
    }

    if (window.innerWidth >= OVERLAY_LAYOUT_BREAKPOINT) {
      this.host.style.flexDirection = 'row';
      this.host.style.alignItems = 'flex-start';
    } else {
      this.host.style.flexDirection = 'column';
      this.host.style.alignItems = 'stretch';
    }
  }

  _updateLeadershipSummary(snapshot) {
    if (!this.leadershipEl) {
      return;
    }
    const leadership = snapshot?.leadership ?? this._latestLeadership;
    const city = snapshot?.city ?? this._latestCity;
    const cityLeaders = Array.isArray(leadership?.city)
      ? leadership.city
      : Array.isArray(city?.leaders)
        ? city.leaders
        : [];
    const primaryCityId = city?.primaryLeaderId ?? (cityLeaders[0]?.agentId ?? null);
    const primaryCityLeader = cityLeaders.find((leader) => leader?.agentId === primaryCityId) ?? cityLeaders[0] ?? null;
    const cityLabel = primaryCityLeader
      ? `${primaryCityLeader.title ?? primaryCityLeader.role ?? 'Leader'} ${primaryCityLeader.agentId}`
      : 'None';
    const houseEntries = leadership?.houses ?? {};
    const totalHouses = Array.isArray(snapshot?.houses)
      ? snapshot.houses.length
      : Object.keys(houseEntries).length;
    let activeHouseLeaders = 0;
    for (const leaders of Object.values(houseEntries)) {
      if (Array.isArray(leaders) && leaders.length > 0) {
        activeHouseLeaders += 1;
      }
    }
    const stewardDetails = primaryCityLeader
      ? `${cityLabel} (${primaryCityLeader.method ?? 'temperament'}, score ${
          Number.isFinite(primaryCityLeader.score)
            ? Number(primaryCityLeader.score).toFixed(2)
            : '–'
        })`
      : cityLabel;
    this.leadershipEl.textContent = `City steward: ${stewardDetails} • Houses with leaders: ${activeHouseLeaders}/${totalHouses}`;
  }

  _applyRootStyles() {
    Object.assign(this.root.style, {
      padding: '12px',
      background: 'rgba(15, 23, 42, 0.85)',
      color: '#f8fafc',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '14px',
      borderRadius: '8px',
      boxShadow: '0 10px 30px rgba(2, 6, 23, 0.4)',
      minWidth: '240px',
      pointerEvents: 'auto',
      flex: '0 0 auto',
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

  _buildAgentActionControls() {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '6px';
    wrapper.style.marginTop = '4px';

    const label = document.createElement('span');
    label.textContent = 'Agent actions';
    label.style.fontWeight = '500';
    wrapper.appendChild(label);

    const spawnButton = document.createElement('button');
    spawnButton.type = 'button';
    spawnButton.textContent = 'Spawn test agent';
    this._styleButton(spawnButton);
    spawnButton.addEventListener('click', () => {
      this.worker.postMessage({ type: 'SPAWN_TEST' });
    });
    wrapper.appendChild(spawnButton);

    this.teleportButton = document.createElement('button');
    this.teleportButton.type = 'button';
    this.teleportButton.textContent = 'Teleport selected to center';
    this._styleButton(this.teleportButton);
    this.teleportButton.addEventListener('click', () => {
      this._teleportSelectedAgentToCenter();
    });
    wrapper.appendChild(this.teleportButton);

    this.teleportHintEl = document.createElement('span');
    this.teleportHintEl.textContent = 'Select an agent to enable teleport.';
    this.teleportHintEl.style.fontSize = '12px';
    this.teleportHintEl.style.color = 'rgba(248, 250, 252, 0.7)';
    this.teleportHintEl.style.lineHeight = '1.3';
    wrapper.appendChild(this.teleportHintEl);

    this.controlsEl.appendChild(wrapper);
  }

  _buildMapDisplayControls() {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';
    wrapper.style.marginTop = '4px';

    const label = document.createElement('span');
    label.textContent = 'Map display';
    label.style.fontWeight = '500';
    wrapper.appendChild(label);

    const gridToggle = this._createCheckboxToggle(
      'Pixel grid',
      typeof this.scene.isGridVisible === 'function' ? this.scene.isGridVisible() : true,
      (checked) => {
        if (typeof this.scene.setGridVisible === 'function') {
          this.scene.setGridVisible(checked);
        }
      },
    );
    wrapper.appendChild(gridToggle);

    if (typeof this.scene.setCollectiveLayerEnabled === 'function') {
      const dwellingsToggle = this._createCheckboxToggle(
        'Show dwellings',
        typeof this.scene.isCollectiveLayerEnabled === 'function'
          ? this.scene.isCollectiveLayerEnabled('dwellings')
          : true,
        (checked) => {
          if (typeof this.scene.setCollectiveLayerEnabled === 'function') {
            this.scene.setCollectiveLayerEnabled('dwellings', checked);
          }
        },
      );
      wrapper.appendChild(dwellingsToggle);
    }

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

  _buildCollectiveControls() {
    if (typeof this.scene.setCollectiveLayerEnabled !== 'function') {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '4px';
    wrapper.style.marginTop = '4px';

    const label = document.createElement('span');
    label.textContent = 'Collective markers';
    label.style.fontWeight = '500';
    wrapper.appendChild(label);

    const cityToggle = this._createCollectiveToggle('City', 'city');

    wrapper.appendChild(cityToggle);

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

  _createCollectiveToggle(labelText, layerId) {
    const row = document.createElement('label');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '6px';
    row.style.cursor = 'pointer';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = typeof this.scene.isCollectiveLayerEnabled === 'function'
      ? this.scene.isCollectiveLayerEnabled(layerId)
      : true;
    checkbox.addEventListener('change', () => {
      if (typeof this.scene.setCollectiveLayerEnabled === 'function') {
        this.scene.setCollectiveLayerEnabled(layerId, checkbox.checked);
      }
    });

    const span = document.createElement('span');
    span.textContent = labelText;

    row.appendChild(checkbox);
    row.appendChild(span);
    return row;
  }

  _createCheckboxToggle(labelText, checked, onChange) {
    const row = document.createElement('label');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '6px';
    row.style.cursor = 'pointer';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(checked);
    checkbox.addEventListener('change', () => {
      onChange(Boolean(checkbox.checked));
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

  _handleSceneSelectionChange(selection) {
    const normalized = this._normalizeSelection(selection);
    this._currentSelection = normalized;

    if (this.agentSelect) {
      if (
        normalized.type === 'agent' &&
        normalized.id &&
        this._agentOptionIds.has(normalized.id)
      ) {
        const nextValue = normalized.id;
        if (this.agentSelect.value !== nextValue) {
          this.agentSelect.value = nextValue;
        }
      } else if (this.agentSelect.value !== '') {
        this.agentSelect.value = '';
      }
    }

    this._updateInspectorSelection(normalized);
    this._updateTeleportButtonState();
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
      if (button.disabled) return;
      button.style.background = '#1d4ed8';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = button.disabled ? '#1e293b' : '#2563eb';
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

  _setButtonEnabled(button, enabled) {
    const isEnabled = Boolean(enabled);
    button.disabled = !isEnabled;
    button.style.opacity = isEnabled ? '1' : '0.55';
    button.style.cursor = isEnabled ? 'pointer' : 'not-allowed';
    button.style.background = isEnabled ? '#2563eb' : '#1e293b';
  }

  _updateTeleportButtonState() {
    if (!this.teleportButton) {
      return;
    }
    const hasAgentSelection = this._currentSelection.type === 'agent' && !!this._currentSelection.id;
    this._setButtonEnabled(this.teleportButton, hasAgentSelection);
    this.teleportButton.title = hasAgentSelection
      ? 'Teleport the selected agent to the map center'
      : 'Select an agent in the scene to enable teleport.';
    if (this.teleportHintEl) {
      this.teleportHintEl.style.display = hasAgentSelection ? 'none' : 'block';
    }
  }

  _teleportSelectedAgentToCenter() {
    if (!this._currentSelection || this._currentSelection.type !== 'agent' || !this._currentSelection.id) {
      return;
    }

    let targetX = 0;
    let targetY = 0;
    if (typeof this.scene.getWorldCenter === 'function') {
      const center = this.scene.getWorldCenter();
      if (center && Number.isFinite(center.x) && Number.isFinite(center.y)) {
        targetX = center.x;
        targetY = center.y;
      }
    }

    this.worker.postMessage({
      type: 'MOVE_AGENT',
      id: this._currentSelection.id,
      x: targetX,
      y: targetY,
    });
  }

  _normalizeSelection(selection) {
    if (selection && typeof selection === 'object' && 'type' in selection) {
      const type = selection.type ?? null;
      const data = selection.data ?? null;
      let id = selection.id ?? null;
      if (!id && type === 'city' && data && data.id) {
        id = data.id;
      }
      return { type, id, data };
    }
    if (typeof selection === 'string') {
      return { type: 'agent', id: selection, data: null };
    }
    return { type: null, id: null, data: null };
  }

  _resolveSelection(selection) {
    const normalized = this._normalizeSelection(selection);
    let { type, id } = normalized;
    let { data } = normalized;

    if (type === 'agent') {
      if (id && !data && this._latestAgentsById) {
        data = this._latestAgentsById.get(id) ?? null;
      }
    } else if (type === 'house') {
      if (id && !data && this._latestHousesById) {
        data = this._latestHousesById.get(id) ?? null;
      }
    } else if (type === 'city') {
      const city = this._latestCity;
      if (!data && city && (!id || city.id === id)) {
        data = city;
        id = city.id ?? id;
      } else if (data && !id && data.id) {
        id = data.id;
      } else if (id && city && city.id === id && !data) {
        data = city;
      }
    }

    if (!type || !data) {
      return { type: null, id: null, data: null };
    }

    return { type, id: id ?? null, data };
  }

  _updateInspectorSelection(selectionOverride) {
    if (!this.inspector) {
      return;
    }

    const baseSelection =
      selectionOverride !== undefined && selectionOverride !== null
        ? selectionOverride
        : this._currentSelection;

    const resolved = this._resolveSelection(baseSelection);
    this._currentSelection = resolved;

    if (!resolved.type) {
      this.inspector.setSelection(null);
      return;
    }

    this.inspector.setSelection(resolved);
  }
}
