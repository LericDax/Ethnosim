import { BrainViewer } from './BrainViewer.js';
import adultMindRaw from '../sim/data/AdultMind_v1.json?raw';
import babyMindRaw from '../sim/data/BabyMind_v1.json?raw';
import childMindRaw from '../sim/data/ChildMind_v1.json?raw';
import teenMindRaw from '../sim/data/TeenMind_v1.json?raw';
import houseMindRaw from '../sim/data/HouseMind_v1.json?raw';
import urbanMindRaw from '../sim/data/UrbanMind_v1.json?raw';

const SECTION_GAP = '12px';
const MUTED_TEXT_COLOR = 'rgba(226, 232, 240, 0.68)';
const PRIMARY_TEXT_COLOR = '#f8fafc';
const PANEL_BACKGROUND = 'rgba(15, 23, 42, 0.82)';
const BORDER_COLOR = 'rgba(148, 163, 184, 0.25)';
const BAR_TRACK_COLOR = 'rgba(51, 65, 85, 0.6)';
const BAR_FILL_COLOR = '#38bdf8';

const RAW_BRAINS = [
  adultMindRaw,
  babyMindRaw,
  childMindRaw,
  teenMindRaw,
  houseMindRaw,
  urbanMindRaw,
];

const BRAIN_LIBRARY = buildBrainLibrary();

function buildBrainLibrary() {
  const library = new Map();
  for (const raw of RAW_BRAINS) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed?.name) continue;
      const nodes = Array.isArray(parsed.nodes)
        ? parsed.nodes.map((node) => ({
            id: node.id,
            label: node.id,
            baseFrequency: Number(node.base_freq ?? 0),
            duration: Number(node.duration ?? 0),
            tags: Array.isArray(node.tags) ? [...node.tags] : [],
          }))
        : [];
      const edges = Array.isArray(parsed.edges)
        ? parsed.edges
            .map((edge) => ({
              from: edge?.[0],
              to: edge?.[1],
              weight: Number(edge?.[2] ?? 0),
            }))
            .filter((edge) => edge.from && edge.to)
        : [];
      library.set(parsed.name, Object.freeze({ id: parsed.name, nodes, edges }));
    } catch (error) {
      console.warn('Failed to parse brain definition for inspector', error);
    }
  }
  return library;
}

function getBrainGraph(brainId) {
  if (!brainId) return null;
  return BRAIN_LIBRARY.get(brainId) ?? null;
}

function formatValue(value) {
  if (value === null || value === undefined) {
    return '–';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : '–';
  }
  return String(value);
}

function formatLabel(key) {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w|\s\w/g, (match) => match.toUpperCase());
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export class Inspector {
  constructor({ container = document.body } = {}) {
    this.container = container;
    this.agent = null;
    this._moodBars = new Map();
    this._temperamentBars = new Map();

    this.root = document.createElement('div');
    this.root.className = 'hud-inspector';
    this._applyRootStyles();

    this.titleEl = document.createElement('div');
    this.titleEl.textContent = 'Agent Inspector';
    Object.assign(this.titleEl.style, {
      fontWeight: '600',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color: PRIMARY_TEXT_COLOR,
      marginBottom: '8px',
    });
    this.root.appendChild(this.titleEl);

    this.placeholderEl = document.createElement('div');
    this.placeholderEl.textContent = 'Select an agent on the map or from the list to inspect their state.';
    Object.assign(this.placeholderEl.style, {
      color: MUTED_TEXT_COLOR,
      fontSize: '13px',
      lineHeight: '1.5',
      padding: '6px 0',
    });
    this.root.appendChild(this.placeholderEl);

    this.bodyEl = document.createElement('div');
    Object.assign(this.bodyEl.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: SECTION_GAP,
    });
    this.root.appendChild(this.bodyEl);

    this.brainSection = this._createSection('Brain Activity');
    Object.assign(this.brainSection.content.style, {
      display: 'flex',
      padding: '8px',
    });
    this.brainViewer = new BrainViewer({ minHeight: 220 });
    this.brainSection.content.appendChild(this.brainViewer.element);
    this.brainSection.root.style.display = 'none';

    this.identitySection = this._createInfoSection('Identity');
    this.statusSection = this._createInfoSection('Status');
    this.moodSection = this._createBarSection('Moods');
    this.temperamentSection = this._createBarSection('Temperament');

    this.bodyEl.appendChild(this.brainSection.root);
    this.bodyEl.appendChild(this.identitySection.root);
    this.bodyEl.appendChild(this.statusSection.root);
    this.bodyEl.appendChild(this.moodSection.root);
    this.bodyEl.appendChild(this.temperamentSection.root);

    this.setAgent(null);

    this.container.appendChild(this.root);
  }

  setAgent(agent) {
    this.agent = agent ?? null;

    if (!this.agent) {
      this.placeholderEl.style.display = 'block';
      this.bodyEl.style.display = 'none';
      this.titleEl.textContent = 'Agent Inspector';
      this.brainViewer.setData(null);
      this.brainSection.root.style.display = 'none';
      return;
    }

    this.placeholderEl.style.display = 'none';
    this.bodyEl.style.display = 'flex';
    this.titleEl.textContent = `Agent ${this.agent.id ?? ''}`.trim();

    const brainSummary = this.agent.brain?.summary ?? null;
    this._updateBrainSection(brainSummary);

    const identityData = {
      'Agent ID': this.agent.id ?? '–',
      'Life stage': this.agent.lifeStage ?? this.agent.ageStage ?? '–',
      'Body sex': this.agent.sexBody ?? this.agent.sex_body ?? '–',
      'Gender identity': this.agent.genderIdentity ?? this.agent.gender_identity ?? '–',
      Brain: brainSummary?.brainId ?? this.agent.brain_name ?? '–',
      'Current node': brainSummary?.nodeId ?? this.agent.brainNode ?? this.agent.current_node ?? '–',
    };
    this._updateInfoSection(this.identitySection, identityData);

    let pregnancyDisplay = 'Unknown';
    if (typeof this.agent.pregnant === 'boolean') {
      pregnancyDisplay = this.agent.pregnant ? 'Yes' : 'No';
    } else if (this.agent.pregnancy && typeof this.agent.pregnancy === 'object') {
      const ticksRemaining = Number(this.agent.pregnancy.timeRemaining);
      pregnancyDisplay = Number.isFinite(ticksRemaining)
        ? `Yes (${Math.max(0, Math.round(ticksRemaining))} ticks remaining)`
        : 'Yes';
    } else {
      pregnancyDisplay = 'No';
    }

    const statusData = {
      Dwelling: this.agent.houseId ?? this.agent.dwelling_id ?? '–',
      Pregnancy: pregnancyDisplay,
      'Bond partner': this.agent.bondPartnerId ?? this.agent.bond_partner_id ?? '–',
      Parents: this.agent.parents ?? this.agent.parent_ids ?? [],
      Fertility: typeof this.agent.fertility === 'number' ? this.agent.fertility.toFixed(2) : '–',
    };
    this._updateInfoSection(this.statusSection, statusData);

    this._updateBarSection(this.moodSection, this.agent.moods);
    this._updateBarSection(this.temperamentSection, this.agent.temperament, this.agent.pregnancy?.fetusTemperament);
  }

  _updateBrainSection(brainSummary) {
    const brainId =
      brainSummary?.brainId ??
      this.agent?.brain_name ??
      this.agent?.brainId ??
      this.agent?.brain?.state?.brainId ??
      null;
    const graph = getBrainGraph(brainId);
    if (!graph) {
      this.brainViewer.setData(null);
      this.brainSection.root.style.display = 'none';
      return;
    }

    const currentNodeId =
      brainSummary?.nodeId ?? this.agent?.brainNode ?? this.agent?.current_node ?? this.agent?.brain?.state?.currentNodeId ?? null;
    const decision = brainSummary?.decision ?? this.agent?.brainDecision ?? this.agent?.brain?.state?.lastDecision ?? null;

    this.brainViewer.setData({
      nodes: graph.nodes.map((node) => ({ ...node })),
      edges: graph.edges.map((edge) => ({ ...edge })),
      currentNodeId,
      decision,
    });
    this.brainSection.root.style.display = 'flex';
  }

  _applyRootStyles() {
    Object.assign(this.root.style, {
      background: PANEL_BACKGROUND,
      border: `1px solid ${BORDER_COLOR}`,
      borderRadius: '8px',
      color: PRIMARY_TEXT_COLOR,
      padding: '12px',
      minWidth: '260px',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '13px',
      lineHeight: '1.5',
      boxShadow: '0 12px 32px rgba(2, 6, 23, 0.45)',
      pointerEvents: 'auto',
    });
  }

  _createInfoSection(title) {
    const section = this._createSection(title);
    Object.assign(section.content.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '6px 12px',
    });
    section.rows = new Map();
    return section;
  }

  _createBarSection(title) {
    const section = this._createSection(title);
    Object.assign(section.content.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    });
    const emptyEl = document.createElement('div');
    emptyEl.textContent = 'No data available.';
    Object.assign(emptyEl.style, {
      color: MUTED_TEXT_COLOR,
      fontSize: '12px',
    });
    section.emptyEl = emptyEl;
    section.content.appendChild(emptyEl);
    return section;
  }

  _createSection(title) {
    const root = document.createElement('section');
    Object.assign(root.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      background: 'rgba(15, 23, 42, 0.65)',
      border: `1px solid ${BORDER_COLOR}`,
      borderRadius: '6px',
      padding: '10px',
    });

    const header = document.createElement('div');
    header.textContent = title;
    Object.assign(header.style, {
      fontSize: '12px',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: MUTED_TEXT_COLOR,
    });
    root.appendChild(header);

    const content = document.createElement('div');
    root.appendChild(content);

    return { root, content };
  }

  _updateInfoSection(section, data) {
    const seen = new Set();
    for (const [label, rawValue] of Object.entries(data)) {
      const key = label;
      seen.add(key);
      let row = section.rows.get(key);
      if (!row) {
        row = this._createInfoRow(label);
        section.rows.set(key, row);
        section.content.appendChild(row.element);
      }
      row.valueEl.textContent = formatValue(rawValue);
    }

    for (const [key, row] of section.rows) {
      if (!seen.has(key)) {
        section.content.removeChild(row.element);
        section.rows.delete(key);
      }
    }
  }

  _createInfoRow(label) {
    const element = document.createElement('div');
    Object.assign(element.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      padding: '2px 0',
      background: 'rgba(30, 41, 59, 0.35)',
      borderRadius: '4px',
      paddingLeft: '6px',
      paddingRight: '6px',
      paddingTop: '4px',
      paddingBottom: '4px',
    });

    const labelEl = document.createElement('span');
    labelEl.textContent = formatLabel(label);
    Object.assign(labelEl.style, {
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      color: MUTED_TEXT_COLOR,
    });
    element.appendChild(labelEl);

    const valueEl = document.createElement('span');
    Object.assign(valueEl.style, {
      fontSize: '13px',
      color: PRIMARY_TEXT_COLOR,
      wordBreak: 'break-word',
    });
    element.appendChild(valueEl);

    return { element, valueEl };
  }

  _updateBarSection(section, primaryData, secondaryData) {
    const entries = [];
    if (primaryData && typeof primaryData === 'object') {
      for (const [key, value] of Object.entries(primaryData)) {
        entries.push({ key, value });
      }
    }

    const secondaryEntries = [];
    if (secondaryData && typeof secondaryData === 'object') {
      for (const [key, value] of Object.entries(secondaryData)) {
        secondaryEntries.push({ key, value, secondary: true });
      }
    }

    entries.sort((a, b) => a.key.localeCompare(b.key));
    secondaryEntries.sort((a, b) => a.key.localeCompare(b.key));

    const combined = [...entries, ...secondaryEntries];
    const map = section === this.moodSection ? this._moodBars : this._temperamentBars;

    if (combined.length === 0) {
      section.emptyEl.style.display = 'block';
      section.content.style.display = 'flex';
      for (const [, row] of map) {
        section.content.removeChild(row.element);
      }
      map.clear();
      return;
    }

    section.emptyEl.style.display = 'none';

    const seen = new Set();

    for (const entry of combined) {
      const label = entry.secondary ? `${formatLabel(entry.key)} (fetus)` : formatLabel(entry.key);
      const key = entry.secondary ? `secondary-${entry.key}` : entry.key;
      seen.add(key);
      let row = map.get(key);
      if (!row) {
        row = this._createBarRow(label);
        map.set(key, row);
        section.content.appendChild(row.element);
      }
      const value = Number(entry.value);
      if (Number.isFinite(value)) {
        const clamped = clamp01(value);
        row.fillEl.style.width = `${Math.round(clamped * 100)}%`;
        row.valueEl.textContent = clamped.toFixed(2);
        row.fillEl.style.opacity = '1';
      } else {
        row.fillEl.style.width = '0%';
        row.valueEl.textContent = '–';
        row.fillEl.style.opacity = '0.2';
      }
    }

    for (const [key, row] of map) {
      if (!seen.has(key)) {
        section.content.removeChild(row.element);
        map.delete(key);
      }
    }
  }

  _createBarRow(label) {
    const element = document.createElement('div');
    Object.assign(element.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: '12px',
      color: PRIMARY_TEXT_COLOR,
    });

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    Object.assign(labelEl.style, {
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      color: MUTED_TEXT_COLOR,
      fontSize: '11px',
    });

    const valueEl = document.createElement('span');
    Object.assign(valueEl.style, {
      fontVariantNumeric: 'tabular-nums',
      fontSize: '12px',
    });

    header.appendChild(labelEl);
    header.appendChild(valueEl);

    const track = document.createElement('div');
    Object.assign(track.style, {
      position: 'relative',
      width: '100%',
      height: '10px',
      background: BAR_TRACK_COLOR,
      borderRadius: '6px',
      overflow: 'hidden',
      border: `1px solid ${BORDER_COLOR}`,
    });

    const fill = document.createElement('div');
    Object.assign(fill.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      bottom: '0',
      width: '0%',
      background: BAR_FILL_COLOR,
      borderRight: '1px solid rgba(15, 23, 42, 0.6)',
      transition: 'width 120ms ease-out',
    });
    track.appendChild(fill);

    element.appendChild(header);
    element.appendChild(track);

    return { element, valueEl, fillEl: fill };
  }
}
