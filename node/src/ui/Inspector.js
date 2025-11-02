import { BrainViewer } from './BrainViewer.js';
import adultMindRaw from '@shared/brains/AdultMind_v1.json?raw';
import babyMindRaw from '@shared/brains/BabyMind_v1.json?raw';
import childMindRaw from '@shared/brains/ChildMind_v1.json?raw';
import teenMindRaw from '@shared/brains/TeenMind_v1.json?raw';
import houseMindRaw from '@shared/brains/HouseMind_v1.json?raw';
import urbanMindRaw from '@shared/brains/UrbanMind_v1.json?raw';

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

function formatResourceBundleDisplay(bundle) {
  if (!bundle || typeof bundle !== 'object') {
    return '0';
  }
  const entries = Object.entries(bundle)
    .filter(([, value]) => Number.isFinite(value))
    .map(([key, value]) => `${key}: ${Number(value).toFixed(1)}`);
  return entries.length > 0 ? entries.join(', ') : '0';
}

function formatResourceActivityDisplay(activity) {
  if (!activity || typeof activity !== 'object') {
    return '–';
  }
  const parts = [];
  if (activity.harvested) {
    const harvested = formatResourceBundleDisplay(activity.harvested);
    if (harvested !== '0') {
      parts.push(`Harvested ${harvested}`);
    }
  }
  if (activity.delivered) {
    const delivered = formatResourceBundleDisplay(activity.delivered);
    if (delivered !== '0') {
      parts.push(`Delivered ${delivered}`);
    }
  }
  return parts.length > 0 ? parts.join(' • ') : '–';
}

function formatBuildProgressDisplay(construction) {
  if (!construction || typeof construction !== 'object') {
    return '0% (0.0 / 0.0)';
  }
  const progress = Number(construction.progress ?? 0);
  const required = Math.max(1, Number(construction.required ?? 1));
  const ratio = Math.max(0, Math.min(1, progress / required));
  return `${Math.round(ratio * 100)}% (${progress.toFixed(1)} / ${required.toFixed(1)})`;
}

function formatDirectiveMapDisplay(directives) {
  if (!directives || typeof directives !== 'object') {
    return '–';
  }
  const entries = Object.entries(directives)
    .filter(([, value]) => Number.isFinite(value))
    .map(([key, value]) => `${key}: ${Number(value).toFixed(2)}`);
  return entries.length > 0 ? entries.join(', ') : '–';
}

export class Inspector {
  constructor({ container = document.body, onRequestClose = null } = {}) {
    this.container = container;
    this.agent = null;
    this.house = null;
    this.city = null;
    this.selection = { type: null, data: null };
    this._moodBars = new Map();
    this._temperamentBars = new Map();
    this.onRequestClose = typeof onRequestClose === 'function' ? onRequestClose : null;

    this.root = document.createElement('div');
    this.root.className = 'hud-inspector';
    this._applyRootStyles();

    this.headerEl = document.createElement('div');
    Object.assign(this.headerEl.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      marginBottom: '8px',
    });
    this.root.appendChild(this.headerEl);

    this.titleEl = document.createElement('div');
    this.titleEl.textContent = 'Agent Inspector';
    Object.assign(this.titleEl.style, {
      fontWeight: '600',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color: PRIMARY_TEXT_COLOR,
    });
    this.headerEl.appendChild(this.titleEl);

    this.closeButton = document.createElement('button');
    this.closeButton.type = 'button';
    this.closeButton.textContent = 'Back';
    Object.assign(this.closeButton.style, {
      padding: '4px 10px',
      borderRadius: '9999px',
      border: `1px solid ${BORDER_COLOR}`,
      background: 'rgba(15, 23, 42, 0.35)',
      color: PRIMARY_TEXT_COLOR,
      fontSize: '11px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'background 120ms ease-out, color 120ms ease-out',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'inherit',
    });
    this.closeButton.addEventListener('mouseenter', () => {
      if (this.closeButton.disabled) return;
      this.closeButton.style.background = 'rgba(30, 41, 59, 0.65)';
    });
    this.closeButton.addEventListener('mouseleave', () => {
      this.closeButton.style.background = 'rgba(15, 23, 42, 0.35)';
    });
    this.closeButton.addEventListener('click', () => {
      if (typeof this.onRequestClose === 'function') {
        this.onRequestClose(this.selection);
      }
      if (this.selection?.type) {
        this.setSelection(null);
      }
    });
    this.headerEl.appendChild(this.closeButton);

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
      width: '100%',
      flex: '1 0 auto',
      boxSizing: 'border-box',
      flexDirection: 'column',
      gap: '12px',
    });
    this.brainViewer = new BrainViewer({
      minHeight: 220,
      viewportClamp: { min: 220, viewport: 55, max: 420 },
    });
    this.brainSection.content.appendChild(this.brainViewer.element);
    this.brainAttentionContainer = document.createElement('div');
    Object.assign(this.brainAttentionContainer.style, {
      display: 'none',
      flexDirection: 'column',
      gap: '6px',
      padding: '8px',
      borderRadius: '6px',
      background: 'rgba(15, 23, 42, 0.55)',
      border: '1px solid rgba(148, 163, 184, 0.25)',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: 'rgba(226, 232, 240, 0.9)',
      fontSize: '12px',
    });
    this.brainAttentionHeading = document.createElement('div');
    this.brainAttentionHeading.textContent = 'Attention Focus';
    Object.assign(this.brainAttentionHeading.style, {
      fontSize: '12px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'rgba(224, 242, 254, 0.85)',
    });
    this.brainAttentionContext = document.createElement('div');
    Object.assign(this.brainAttentionContext.style, {
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: '11px',
      color: 'rgba(226, 232, 240, 0.85)',
      whiteSpace: 'pre-wrap',
    });
    this.brainAttentionList = document.createElement('div');
    Object.assign(this.brainAttentionList.style, {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, auto) minmax(0, auto)',
      gap: '4px 12px',
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: '11px',
      color: 'rgba(226, 232, 240, 0.92)',
    });
    this.brainAttentionEmpty = document.createElement('div');
    this.brainAttentionEmpty.textContent = 'No active candidates';
    Object.assign(this.brainAttentionEmpty.style, {
      fontSize: '11px',
      color: 'rgba(148, 163, 184, 0.75)',
    });
    this.brainAttentionContainer.appendChild(this.brainAttentionHeading);
    this.brainAttentionContainer.appendChild(this.brainAttentionContext);
    this.brainAttentionContainer.appendChild(this.brainAttentionList);
    this.brainAttentionContainer.appendChild(this.brainAttentionEmpty);
    this.brainSection.content.appendChild(this.brainAttentionContainer);
    this.brainPlasticityContainer = document.createElement('div');
    Object.assign(this.brainPlasticityContainer.style, {
      display: 'none',
      flexDirection: 'column',
      gap: '6px',
      padding: '8px',
      borderRadius: '6px',
      background: 'rgba(15, 23, 42, 0.55)',
      border: '1px solid rgba(148, 163, 184, 0.25)',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: 'rgba(226, 232, 240, 0.9)',
      fontSize: '12px',
    });
    this.brainPlasticityHeading = document.createElement('div');
    this.brainPlasticityHeading.textContent = 'Plasticity Adjustments';
    Object.assign(this.brainPlasticityHeading.style, {
      fontSize: '12px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'rgba(224, 242, 254, 0.85)',
    });
    this.brainPlasticityLegend = document.createElement('div');
    this.brainPlasticityLegend.textContent = 'Teal edges are potentiated; rose edges are suppressed.';
    Object.assign(this.brainPlasticityLegend.style, {
      fontSize: '11px',
      color: 'rgba(148, 163, 184, 0.8)',
    });
    this.brainPlasticityLegendDefault = this.brainPlasticityLegend.textContent;
    this.brainPlasticityList = document.createElement('div');
    Object.assign(this.brainPlasticityList.style, {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, auto) minmax(0, auto)',
      gap: '4px 12px',
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: '11px',
      color: 'rgba(226, 232, 240, 0.92)',
    });
    this.brainPlasticityEmpty = document.createElement('div');
    this.brainPlasticityEmpty.textContent = 'No active adjustments';
    Object.assign(this.brainPlasticityEmpty.style, {
      fontSize: '11px',
      color: 'rgba(148, 163, 184, 0.75)',
    });
    this.brainPlasticityContainer.appendChild(this.brainPlasticityHeading);
    this.brainPlasticityContainer.appendChild(this.brainPlasticityLegend);
    this.brainPlasticityContainer.appendChild(this.brainPlasticityList);
    this.brainPlasticityContainer.appendChild(this.brainPlasticityEmpty);
    this.brainPlasticityEmpty.style.display = 'none';
    this.brainSection.content.appendChild(this.brainPlasticityContainer);
    this.brainAssociationsContainer = document.createElement('div');
    Object.assign(this.brainAssociationsContainer.style, {
      display: 'none',
      flexDirection: 'column',
      gap: '6px',
      padding: '8px',
      borderRadius: '6px',
      background: 'rgba(15, 23, 42, 0.55)',
      border: '1px solid rgba(148, 163, 184, 0.25)',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: 'rgba(226, 232, 240, 0.9)',
      fontSize: '12px',
    });
    this.brainAssociationsHeading = document.createElement('div');
    this.brainAssociationsHeading.textContent = 'Recent Associations';
    Object.assign(this.brainAssociationsHeading.style, {
      fontSize: '12px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'rgba(224, 242, 254, 0.85)',
    });
    this.brainAssociationsList = document.createElement('div');
    Object.assign(this.brainAssociationsList.style, {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, auto) minmax(0, auto)',
      gap: '4px 12px',
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: '11px',
      color: 'rgba(226, 232, 240, 0.92)',
    });
    this.brainAssociationsEmpty = document.createElement('div');
    this.brainAssociationsEmpty.textContent = 'No transient associations';
    Object.assign(this.brainAssociationsEmpty.style, {
      fontSize: '11px',
      color: 'rgba(148, 163, 184, 0.75)',
    });
    this.brainAssociationsContainer.appendChild(this.brainAssociationsHeading);
    this.brainAssociationsContainer.appendChild(this.brainAssociationsList);
    this.brainAssociationsContainer.appendChild(this.brainAssociationsEmpty);
    this.brainAssociationsList.style.display = 'none';
    this.brainSection.content.appendChild(this.brainAssociationsContainer);
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

    this.setSelection(null);

    this.container.appendChild(this.root);
  }

  setPaused(isPaused) {
    if (this.brainViewer && typeof this.brainViewer.setPaused === 'function') {
      this.brainViewer.setPaused(isPaused);
    }
  }

  setAgent(agent) {
    if (!agent) {
      this.setSelection(null);
      return;
    }
    this.setSelection({ type: 'agent', id: agent.id ?? null, data: agent });
  }

  setSelection(selection) {
    const type = selection?.type ?? null;
    const data = selection?.data ?? null;

    this.selection = { type, data };
    this.agent = type === 'agent' ? data ?? null : null;
    this.house = type === 'house' ? data ?? null : null;
    this.city = type === 'city' ? data ?? null : null;

    if (!type || !data) {
      this.placeholderEl.style.display = 'block';
      this.bodyEl.style.display = 'none';
      this.titleEl.textContent = 'Agent Inspector';
      this.brainViewer.setData(null);
      if (typeof this.brainViewer.setLabel === 'function') {
        this.brainViewer.setLabel(null);
      }
      this.brainSection.root.style.display = 'none';
      if (this.brainAssociationsContainer) {
        this.brainAssociationsContainer.style.display = 'none';
      }
      this._configureSectionsForType(null);
      if (this.closeButton) {
        this.closeButton.style.display = 'none';
      }
      return;
    }

    this.placeholderEl.style.display = 'none';
    this.bodyEl.style.display = 'flex';
    if (this.closeButton) {
      this.closeButton.style.display = 'inline-flex';
    }

    if (type === 'agent') {
      this.titleEl.textContent = `Agent ${data.id ?? ''}`.trim();
      this._configureSectionsForType('agent');
      this._renderAgent(data);
    } else if (type === 'house') {
      this.titleEl.textContent = data.id ? `Dwelling ${data.id}` : 'Dwelling';
      this._configureSectionsForType('house');
      this._renderHouse(data);
    } else if (type === 'city') {
      this.titleEl.textContent = data.id ? `City ${data.id}` : 'City';
      this._configureSectionsForType('city');
      this._renderCity(data);
    }
  }

  _configureSectionsForType(type) {
    const showIdentity = type === 'agent' || type === 'house' || type === 'city';
    const showStatus = showIdentity;
    const showMood = type === 'agent' || type === 'house' || type === 'city';
    const showTemperament = type === 'agent';

    this.identitySection.root.style.display = showIdentity ? 'flex' : 'none';
    this.statusSection.root.style.display = showStatus ? 'flex' : 'none';
    this.moodSection.root.style.display = showMood ? 'flex' : 'none';
    this.temperamentSection.root.style.display = showTemperament ? 'flex' : 'none';

    if (this.moodSection.header) {
      this.moodSection.header.textContent = type === 'agent' ? 'Moods' : 'Active Demands';
    }
    if (this.temperamentSection.header) {
      this.temperamentSection.header.textContent = 'Temperament';
    }
  }

  _renderAgent(agent) {
    const brainData = agent?.brain ?? null;
    const brainSummary = brainData?.summary ?? null;
    const fallbackBrainId =
      brainSummary?.brainId ?? agent?.brain_name ?? agent?.brainId ?? agent?.brain?.state?.brainId ?? null;
    const fallbackNodeId =
      brainSummary?.nodeId ?? agent?.brainNode ?? agent?.current_node ?? agent?.brain?.state?.currentNodeId ?? null;
    const fallbackDecision =
      brainSummary?.decision ?? agent?.brainDecision ?? agent?.brain?.state?.lastDecision ?? null;

    this._updateBrainSection(brainData, {
      fallbackBrainId,
      fallbackNodeId,
      fallbackDecision,
      label: brainSummary?.brainId ?? fallbackBrainId ?? 'AgentMind',
    });

    const identityData = {
      'Agent ID': agent?.id ?? '–',
      'Life stage': agent?.lifeStage ?? agent?.ageStage ?? '–',
      Chromosomes: this._formatChromosomes(agent),
      'Reproductive roles': this._formatReproductiveRoles(agent),
      'Gender identity': agent?.genderIdentity ?? agent?.gender_identity ?? '–',
      Brain: brainSummary?.brainId ?? agent?.brain_name ?? fallbackBrainId ?? '–',
      'Current node':
        brainSummary?.nodeId ?? agent?.brainNode ?? agent?.current_node ?? brainData?.state?.currentNodeId ?? '–',
    };
    this._updateInfoSection(this.identitySection, identityData);

    let pregnancyDisplay = 'Unknown';
    if (typeof agent?.pregnant === 'boolean') {
      pregnancyDisplay = agent.pregnant ? 'Yes' : 'No';
    } else if (agent?.pregnancy && typeof agent.pregnancy === 'object') {
      const ticksRemaining = Number(agent.pregnancy.timeRemaining);
      pregnancyDisplay = Number.isFinite(ticksRemaining)
        ? `Yes (${Math.max(0, Math.round(ticksRemaining))} ticks remaining)`
        : 'Yes';
    } else {
      pregnancyDisplay = 'No';
    }

    const statusData = {
      Dwelling: agent?.houseId ?? agent?.dwelling_id ?? '–',
      Pregnancy: pregnancyDisplay,
      'Bond partner': agent?.bondPartnerId ?? agent?.bond_partner_id ?? '–',
      Parents: agent?.parents ?? agent?.parent_ids ?? [],
      Fertility: typeof agent?.fertility === 'number' ? agent.fertility.toFixed(2) : '–',
      'Carrying resources': formatResourceBundleDisplay(agent?.carriedResources),
      'Resource activity': formatResourceActivityDisplay(agent?.resourceActivity),
    };
    this._updateInfoSection(this.statusSection, statusData);

    this._updateBarSection(this.moodSection, agent?.moods);
    this._updateBarSection(
      this.temperamentSection,
      agent?.temperament,
      agent?.pregnancy?.fetusTemperament,
    );
  }

  _formatChromosomes(agent) {
    if (!agent) {
      return '–';
    }
    const source =
      agent.chromosomes ??
      agent.chromosome ??
      agent.chromosomeDescriptor ??
      agent.chromosome_descriptor ??
      null;

    let label = null;
    let code = null;

    if (source && typeof source === 'object') {
      const display = typeof source.display === 'string' ? source.display.trim() : '';
      const candidateLabel =
        typeof source.label === 'string' && source.label.trim().length > 0
          ? source.label.trim()
          : display.length > 0
          ? display
          : null;
      const candidateCode =
        typeof source.code === 'string' && source.code.trim().length > 0
          ? source.code.trim()
          : typeof source.id === 'string' && source.id.trim().length > 0
          ? source.id.trim()
          : typeof source.name === 'string' && source.name.trim().length > 0
          ? source.name.trim()
          : null;
      label = candidateLabel ?? candidateCode;
      code = candidateCode;
    } else if (typeof source === 'string' && source.trim().length > 0) {
      label = source.trim();
    }

    if (!label) {
      const legacy = agent.sexBody ?? agent.sex_body ?? null;
      if (typeof legacy === 'string' && legacy.trim().length > 0) {
        label = legacy.trim();
      }
    }

    if (!label) {
      return '–';
    }
    if (code && label !== code) {
      return `${label} (${code})`;
    }
    return label;
  }

  _formatReproductiveRoles(agent) {
    const roleSources = [
      Array.isArray(agent?.reproductiveRoles) ? agent.reproductiveRoles : null,
      Array.isArray(agent?.reproductive_roles) ? agent.reproductive_roles : null,
      Array.isArray(agent?.chromosomes?.roles) ? agent.chromosomes.roles : null,
      Array.isArray(agent?.chromosome?.roles) ? agent.chromosome.roles : null,
    ];

    const roles = roleSources.find((list) => Array.isArray(list) && list.length > 0) ?? [];
    if (roles.length === 0) {
      const legacy = agent?.sexBody ?? agent?.sex_body ?? null;
      if (typeof legacy === 'string' && legacy.trim().length > 0) {
        return legacy.charAt(0).toUpperCase() + legacy.slice(1);
      }
      return '–';
    }

    const formatted = roles
      .map((role) => this._formatRoleLabel(role))
      .filter((value) => typeof value === 'string' && value.length > 0);

    return formatted.length > 0 ? formatted.join(', ') : '–';
  }

  _formatRoleLabel(role) {
    if (typeof role !== 'string') {
      return null;
    }
    const trimmed = role.trim();
    if (!trimmed) {
      return null;
    }
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }

  _formatPrimaryLeader(leaders, primaryId) {
    if (!Array.isArray(leaders) || leaders.length === 0) {
      return '–';
    }
    const primary = leaders.find((leader) => leader?.agentId === primaryId) ?? leaders[0];
    if (!primary) {
      return '–';
    }
    const roleLabel = primary.title ?? primary.role ?? 'Leader';
    const method = typeof primary.method === 'string' ? primary.method : 'temperament';
    const score = Number.isFinite(primary.score) ? Number(primary.score).toFixed(2) : '–';
    const support = Number.isFinite(primary.support) ? Number(primary.support).toFixed(2) : '–';
    return `${roleLabel}: ${primary.agentId} (${method}, score ${score}, support ${support})`;
  }

  _formatLeaderRoster(leaders) {
    if (!Array.isArray(leaders) || leaders.length === 0) {
      return '–';
    }
    const entries = leaders.map((leader) => this._formatLeaderEntry(leader));
    return entries.filter(Boolean).join(' • ') || '–';
  }

  _formatLeaderEntry(leader) {
    if (!leader || typeof leader !== 'object') {
      return null;
    }
    const roleLabel = leader.title ?? leader.role ?? 'Leader';
    const method = typeof leader.method === 'string' ? leader.method : 'temperament';
    const support = Number.isFinite(leader.support) ? Number(leader.support).toFixed(2) : '–';
    const score = Number.isFinite(leader.score) ? Number(leader.score).toFixed(2) : '–';
    const notes = typeof leader.notes === 'string' && leader.notes.length > 0 ? ` – ${leader.notes}` : '';
    return `${roleLabel}: ${leader.agentId} (${method}, score ${score}, support ${support})${notes}`;
  }

  _formatLeaderDirectives(directives) {
    return formatDirectiveMapDisplay(directives);
  }

  _renderHouse(house) {
    const brainData = house?.brain ?? null;
    const brainSummary = brainData?.summary ?? null;
    const fallbackBrainId = brainSummary?.brainId ?? 'HouseMind_v1';
    const fallbackNodeId = brainSummary?.nodeId ?? brainData?.state?.currentNodeId ?? null;
    const fallbackDecision = brainSummary?.decision ?? brainData?.state?.lastDecision ?? null;

    this._updateBrainSection(brainData, {
      fallbackBrainId,
      fallbackNodeId,
      fallbackDecision,
      label: brainSummary?.brainId ?? 'HouseMind',
    });

    const members = Array.isArray(house?.members) ? house.members : [];
    const identityData = {
      'Entity type': 'Dwelling',
      'Dwelling ID': house?.id ?? '–',
      Brain: brainSummary?.brainId ?? fallbackBrainId ?? '–',
      'Current node': fallbackNodeId ?? '–',
      'Member count': members.length,
      Members: members,
      'Primary leader': this._formatPrimaryLeader(house?.leaders, house?.primaryLeaderId),
      'Leadership council': this._formatLeaderRoster(house?.leaders),
    };
    this._updateInfoSection(this.identitySection, identityData);

    const statusData = {
      Radius: typeof house?.radius === 'number' ? house.radius.toFixed(1) : '–',
      Authority: typeof house?.authority === 'number' ? house.authority.toFixed(2) : '–',
      'Wood stockpile': formatResourceBundleDisplay(house?.stockpiles),
      'Build progress': formatBuildProgressDisplay(house?.construction),
      'Construction active':
        typeof house?.construction?.active === 'boolean'
          ? house.construction.active
            ? 'Yes'
            : 'No'
          : 'Unknown',
      'Build cooldown':
        typeof house?.construction?.cooldownUntil === 'number'
          ? Math.max(0, Math.round(house.construction.cooldownUntil))
          : '–',
      'Leader directives': this._formatLeaderDirectives(house?.leaderDirectives),
    };
    this._updateInfoSection(this.statusSection, statusData);

    this._updateBarSection(this.moodSection, house?.demand);
    this._updateBarSection(this.temperamentSection, null);
  }

  _renderCity(city) {
    const brainData = city?.brain ?? null;
    const brainSummary = brainData?.summary ?? null;
    const fallbackBrainId = brainSummary?.brainId ?? 'UrbanMind_v1';
    const fallbackNodeId = brainSummary?.nodeId ?? brainData?.state?.currentNodeId ?? null;
    const fallbackDecision = brainSummary?.decision ?? brainData?.state?.lastDecision ?? null;

    this._updateBrainSection(brainData, {
      fallbackBrainId,
      fallbackNodeId,
      fallbackDecision,
      label: brainSummary?.brainId ?? 'UrbanMind',
    });

    const identityData = {
      'Entity type': 'City',
      'City ID': city?.id ?? '–',
      Brain: brainSummary?.brainId ?? fallbackBrainId ?? '–',
      'Current node': fallbackNodeId ?? '–',
      'Primary steward': this._formatPrimaryLeader(city?.leaders, city?.primaryLeaderId),
      'Civic council': this._formatLeaderRoster(city?.leaders),
    };
    this._updateInfoSection(this.identitySection, identityData);

    const statusData = {
      Radius: typeof city?.radius === 'number' ? city.radius.toFixed(1) : '–',
      Authority: typeof city?.authority === 'number' ? city.authority.toFixed(2) : '–',
      'Demand expires at':
        typeof city?.demandExpiresAt === 'number' ? Math.max(0, Math.round(city.demandExpiresAt)) : '–',
      'Wood stockpile': formatResourceBundleDisplay(city?.stockpiles),
      'Leader directives': this._formatLeaderDirectives(city?.leaderDirectives),
    };
    this._updateInfoSection(this.statusSection, statusData);

    this._updateBarSection(this.moodSection, city?.demand);
    this._updateBarSection(this.temperamentSection, null);
  }

  _updateBrainSection(brainData, options = {}) {
    const summary = brainData?.summary ?? null;
    const state = brainData?.state ?? null;
    const fallbackBrainId = options.fallbackBrainId ?? null;
    const brainId = summary?.brainId ?? state?.brainId ?? fallbackBrainId ?? null;
    const graph = getBrainGraph(brainId);
    if (!graph) {
      this.brainViewer.setData(null);
      if (typeof this.brainViewer.setLabel === 'function') {
        this.brainViewer.setLabel(options.label ?? null);
      }
      this.brainSection.root.style.display = 'none';
      if (this.brainAssociationsContainer) {
        this.brainAssociationsContainer.style.display = 'none';
      }
      if (this.brainAttentionContainer) {
        this.brainAttentionContainer.style.display = 'none';
      }
      return;
    }

    const currentNodeId =
      summary?.nodeId ??
      state?.currentNodeId ??
      options.fallbackNodeId ??
      null;
    const decision = summary?.decision ?? state?.lastDecision ?? options.fallbackDecision ?? null;

    if (typeof this.brainViewer.setLabel === 'function') {
      this.brainViewer.setLabel(options.label ?? brainId ?? null);
    }

    const pulses = Array.isArray(brainData?.pulses) ? brainData.pulses : [];
    const nodeFill =
      (brainData && typeof brainData.nodeFill === 'object' ? brainData.nodeFill : null) ??
      (brainData && typeof brainData.fillRatios === 'object' ? brainData.fillRatios : null);
    const plasticitySnapshot = this._resolvePlasticitySnapshot(brainData);
    const viewerEdges = this._buildViewerEdges(graph, plasticitySnapshot.edges);
    const transientEdges = Array.isArray(brainData?.transientEdges) ? brainData.transientEdges : [];

    this.brainViewer.setData({
      nodes: graph.nodes.map((node) => ({ ...node })),
      edges: viewerEdges,
      transientEdges,
      currentNodeId,
      decision,
      transition: summary?.transition ?? null,
      pulses,
      nodeFill,
      plasticity: plasticitySnapshot,
      contextEmbedding:
        brainData?.contextEmbedding ?? summary?.contextEmbedding ?? state?.contextEmbedding ?? null,
    });
    this._updatePlasticityDetails(plasticitySnapshot);
    this._updateAttentionDiagnostics(brainData, graph);
    this._updateRecentAssociationsList(transientEdges, graph);
    this.brainSection.root.style.display = 'flex';
  }

  _resolvePlasticitySnapshot(brainData) {
    const snapshot = { tick: 0, edges: [] };
    if (!brainData || typeof brainData !== 'object') {
      return snapshot;
    }

    const direct = brainData.plasticity;
    const fallback = brainData.state?.plasticity ?? null;
    const edges = [];

    if (direct && Array.isArray(direct.edges)) {
      const tick = Number(direct.tick);
      snapshot.tick = Number.isFinite(tick) ? tick : Number(fallback?.tick ?? snapshot.tick);
      for (const entry of direct.edges) {
        const normalized = this._normalizePlasticityEntry(entry?.from, entry?.to, entry);
        if (normalized) {
          edges.push(normalized);
        }
      }
    } else if (fallback && typeof fallback === 'object') {
      const tick = Number(fallback.tick);
      snapshot.tick = Number.isFinite(tick) ? tick : snapshot.tick;
      const records = fallback.edges ?? {};
      for (const [fromId, targets] of Object.entries(records)) {
        if (!targets || typeof targets !== 'object') {
          continue;
        }
        for (const [toId, entry] of Object.entries(targets)) {
          const normalized = this._normalizePlasticityEntry(fromId, toId, entry);
          if (normalized) {
            edges.push(normalized);
          }
        }
      }
    }

    edges.sort((a, b) => {
      const diff = Math.abs(b.adjustment) - Math.abs(a.adjustment);
      if (Math.abs(diff) > 1e-6) {
        return diff;
      }
      const fromCompare = a.from.localeCompare(b.from);
      if (fromCompare !== 0) {
        return fromCompare;
      }
      return a.to.localeCompare(b.to);
    });

    snapshot.edges = edges;
    return snapshot;
  }

  _normalizePlasticityEntry(fromId, toId, entry) {
    if (!fromId || !toId) {
      return null;
    }
    const adjustment = Number(entry?.adjustment ?? 0);
    if (!Number.isFinite(adjustment) || Math.abs(adjustment) < 1e-6) {
      return null;
    }
    const usageCount = Number(entry?.usageCount ?? 0);
    const nextDecayTick = Number(entry?.nextDecayTick ?? 0);
    return {
      from: String(fromId),
      to: String(toId),
      adjustment,
      usageCount: Number.isFinite(usageCount) ? usageCount : 0,
      nextDecayTick: Number.isFinite(nextDecayTick) ? nextDecayTick : 0,
    };
  }

  _buildViewerEdges(graph, plasticityEdges) {
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph.edges) ? graph.edges : [];
    const nodeSet = new Set(nodes.map((node) => node.id));
    const adjustmentMap = new Map();
    for (const entry of plasticityEdges) {
      const key = `${entry.from}->${entry.to}`;
      adjustmentMap.set(key, entry);
    }

    const viewerEdges = edges.map((edge) => {
      const key = `${edge.from}->${edge.to}`;
      const adjustment = adjustmentMap.has(key) ? adjustmentMap.get(key).adjustment : 0;
      const usageCount = adjustmentMap.has(key) ? adjustmentMap.get(key).usageCount : 0;
      const baseWeight = Number(edge.weight ?? 0) || 0;
      const weight = Math.max(0, baseWeight + adjustment);
      adjustmentMap.delete(key);
      return {
        ...edge,
        baseWeight,
        weight,
        adjustment,
        usageCount,
      };
    });

    for (const entry of adjustmentMap.values()) {
      if (!nodeSet.has(entry.from) || !nodeSet.has(entry.to)) {
        continue;
      }
      const baseWeight = 0;
      const weight = Math.max(0, baseWeight + entry.adjustment);
      viewerEdges.push({
        from: entry.from,
        to: entry.to,
        weight,
        baseWeight,
        adjustment: entry.adjustment,
        usageCount: entry.usageCount ?? 0,
      });
    }

    return viewerEdges;
  }

  _updatePlasticityDetails(plasticitySnapshot) {
    if (!this.brainPlasticityContainer) {
      return;
    }
    const edges = Array.isArray(plasticitySnapshot?.edges) ? plasticitySnapshot.edges : [];
    const legendText = this.brainPlasticityLegendDefault ?? this.brainPlasticityLegend?.textContent ?? '';
    const tick = Number(plasticitySnapshot?.tick ?? 0);

    if (!edges.length) {
      this.brainPlasticityContainer.style.display = 'flex';
      this.brainPlasticityList.style.display = 'none';
      this.brainPlasticityList.innerHTML = '';
      this.brainPlasticityEmpty.style.display = 'block';
      if (this.brainPlasticityLegend) {
        this.brainPlasticityLegend.textContent = legendText;
      }
      this.brainPlasticityContainer.title = 'No active synaptic adjustments recorded.';
      return;
    }

    const summaryTick = Number.isFinite(tick) ? Math.max(0, Math.round(tick)) : null;
    const sorted = edges
      .slice()
      .sort((a, b) => Math.abs(b.adjustment) - Math.abs(a.adjustment))
      .slice(0, 6);

    this.brainPlasticityContainer.style.display = 'flex';
    this.brainPlasticityList.style.display = 'grid';
    this.brainPlasticityList.innerHTML = '';
    this.brainPlasticityEmpty.style.display = 'none';

    for (const entry of sorted) {
      const edgeLabel = document.createElement('div');
      edgeLabel.textContent = `${entry.from} → ${entry.to}`;
      const delta = document.createElement('div');
      const formatted = `${entry.adjustment >= 0 ? '+' : ''}${entry.adjustment.toFixed(3)}`;
      delta.textContent = formatted;
      delta.style.textAlign = 'right';
      delta.style.color = entry.adjustment >= 0 ? '#38bdf8' : '#fb7185';
      delta.style.fontWeight = '600';
      const usage = document.createElement('div');
      const usageValue = Number.isFinite(entry.usageCount) ? Math.max(0, Math.round(entry.usageCount)) : 0;
      usage.textContent = `×${usageValue}`;
      usage.style.textAlign = 'right';
      usage.style.color = 'rgba(226, 232, 240, 0.75)';
      const decayTick = Number.isFinite(entry.nextDecayTick) ? entry.nextDecayTick : null;
      const tooltip = decayTick != null ? `Next decay at tick ${decayTick}` : 'No decay scheduled';
      edgeLabel.title = tooltip;
      delta.title = tooltip;
      usage.title = tooltip;
      this.brainPlasticityList.appendChild(edgeLabel);
      this.brainPlasticityList.appendChild(delta);
      this.brainPlasticityList.appendChild(usage);
    }

    if (this.brainPlasticityLegend) {
      this.brainPlasticityLegend.textContent =
        summaryTick != null ? `${legendText} (tick ${summaryTick})` : legendText;
    }
    this.brainPlasticityContainer.title = `${sorted.length} plastic edge adjustments shown.`;
  }

  _updateRecentAssociationsList(transientEdges, graph) {
    if (!this.brainAssociationsContainer || !this.brainAssociationsList || !this.brainAssociationsEmpty) {
      return;
    }

    const traceEdges = Array.isArray(transientEdges)
      ? transientEdges
          .filter((edge) => edge && (edge.kind ?? 'trace') === 'trace')
          .map((edge) => ({
            from: edge.from ?? null,
            to: edge.to ?? null,
            weight: Number(edge.weight ?? 0),
            ttl: Number(edge.remainingTicks ?? edge.ttl ?? 0),
          }))
          .filter((edge) => edge.from && edge.to && edge.weight > 0)
      : [];

    if (!traceEdges.length) {
      this.brainAssociationsContainer.style.display = 'none';
      this.brainAssociationsList.style.display = 'none';
      this.brainAssociationsList.innerHTML = '';
      this.brainAssociationsEmpty.style.display = 'block';
      return;
    }

    const labelMap = new Map();
    if (graph && Array.isArray(graph.nodes)) {
      for (const node of graph.nodes) {
        if (node && node.id) {
          labelMap.set(node.id, node.label ?? node.id);
        }
      }
    }

    const sorted = traceEdges
      .map((edge) => ({
        ...edge,
        fromLabel: labelMap.get(edge.from) ?? edge.from,
        toLabel: labelMap.get(edge.to) ?? edge.to,
      }))
      .sort((a, b) => b.weight - a.weight || String(a.toLabel).localeCompare(String(b.toLabel)))
      .slice(0, 5);

    this.brainAssociationsContainer.style.display = 'flex';
    this.brainAssociationsList.style.display = 'grid';
    this.brainAssociationsList.innerHTML = '';
    this.brainAssociationsEmpty.style.display = 'none';

    for (const entry of sorted) {
      const pairLabel = document.createElement('div');
      pairLabel.textContent = `${entry.fromLabel} → ${entry.toLabel}`;
      const weightEl = document.createElement('div');
      weightEl.textContent = entry.weight.toFixed(2);
      weightEl.style.textAlign = 'right';
      weightEl.style.color = '#fde68a';
      weightEl.title = 'Association weight';
      const ttlValue = Number.isFinite(entry.ttl) ? Math.max(0, Math.round(entry.ttl)) : 0;
      const ttlEl = document.createElement('div');
      ttlEl.textContent = ttlValue > 0 ? `${ttlValue} ticks` : 'fading';
      ttlEl.style.textAlign = 'right';
      ttlEl.style.color = 'rgba(226, 232, 240, 0.75)';
      ttlEl.title = 'Remaining association lifetime';
      this.brainAssociationsList.appendChild(pairLabel);
      this.brainAssociationsList.appendChild(weightEl);
      this.brainAssociationsList.appendChild(ttlEl);
    }
  }

  _updateAttentionDiagnostics(brainData, graph) {
    if (
      !this.brainAttentionContainer ||
      !this.brainAttentionList ||
      !this.brainAttentionEmpty ||
      !this.brainAttentionContext
    ) {
      return;
    }

    const contextEmbedding = Array.isArray(brainData?.contextEmbedding)
      ? brainData.contextEmbedding
      : Array.isArray(brainData?.summary?.contextEmbedding)
        ? brainData.summary.contextEmbedding
        : Array.isArray(brainData?.state?.contextEmbedding)
          ? brainData.state.contextEmbedding
          : null;
    const decision = brainData?.summary?.decision ?? brainData?.state?.lastDecision ?? null;
    const candidates = Array.isArray(decision?.candidates) ? decision.candidates : [];
    const hasContext = Array.isArray(contextEmbedding) && contextEmbedding.length > 0;
    const hasCandidates = candidates.length > 0;

    if (!hasContext && !hasCandidates) {
      this.brainAttentionContainer.style.display = 'none';
      this.brainAttentionContext.textContent = 'Context vector unavailable.';
      this.brainAttentionList.innerHTML = '';
      this.brainAttentionEmpty.style.display = 'block';
      return;
    }

    this.brainAttentionContainer.style.display = 'flex';
    if (hasContext) {
      const formatted = contextEmbedding
        .slice(0, 8)
        .map((value) => Number(value ?? 0).toFixed(2))
        .join('  ');
      this.brainAttentionContext.textContent = `Context ${formatted}`;
    } else {
      this.brainAttentionContext.textContent = 'Context vector unavailable.';
    }

    if (!hasCandidates) {
      this.brainAttentionList.style.display = 'none';
      this.brainAttentionEmpty.style.display = 'block';
      this.brainAttentionList.innerHTML = '';
      return;
    }

    const labelMap = new Map();
    if (graph && Array.isArray(graph.nodes)) {
      for (const node of graph.nodes) {
        if (node && node.id) {
          labelMap.set(node.id, node.label ?? node.id);
        }
      }
    }

    const chosenNodeId = decision?.chosenNodeId ?? null;
    const sorted = candidates
      .slice()
      .sort((a, b) => (Number(b.desirability) || 0) - (Number(a.desirability) || 0))
      .slice(0, 6);

    this.brainAttentionList.style.display = 'grid';
    this.brainAttentionEmpty.style.display = 'none';
    this.brainAttentionList.innerHTML = '';

    for (const candidate of sorted) {
      const rowLabel = document.createElement('div');
      const label = labelMap.get(candidate.nodeId) ?? candidate.nodeId;
      rowLabel.textContent = String(label);
      if (candidate.nodeId === chosenNodeId) {
        rowLabel.style.color = '#fde68a';
        rowLabel.style.fontWeight = '600';
      }

      const attentionEl = document.createElement('div');
      const attention = Number.isFinite(candidate.attentionScore)
        ? Number(candidate.attentionScore)
        : Number(candidate.totalMultiplier ?? 0);
      attentionEl.textContent = attention.toFixed(3);
      attentionEl.style.textAlign = 'right';
      attentionEl.style.color = '#38bdf8';

      const desirabilityEl = document.createElement('div');
      const desirability = Number(candidate.desirability);
      desirabilityEl.textContent = Number.isFinite(desirability) ? desirability.toFixed(3) : '–';
      desirabilityEl.style.textAlign = 'right';
      desirabilityEl.style.color = 'rgba(226, 232, 240, 0.85)';

      this.brainAttentionList.appendChild(rowLabel);
      this.brainAttentionList.appendChild(attentionEl);
      this.brainAttentionList.appendChild(desirabilityEl);
    }
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

    return { root, content, header };
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
