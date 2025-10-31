import { describe, expect, it, vi } from 'vitest';
import { HUD } from '../src/ui/HUD.js';

function createHudTestDouble({
  selectedAgentId = 'agent-1',
  label = 'agent-1 (adult)',
}: {
  selectedAgentId?: string | null;
  label?: string;
} = {}) {
  const hud = Object.create(HUD.prototype) as HUD & {
    _populateAgentSelect: ReturnType<typeof vi.fn>;
    _agentOptionLabels: Map<string, string>;
    scene: { selectedAgentId: string | null; setSelectedAgent: ReturnType<typeof vi.fn> };
    agentSelect: { value: string };
  };

  hud.scene = {
    selectedAgentId,
    setSelectedAgent: vi.fn(),
  };

  hud.agentSelect = { value: selectedAgentId ?? '' };
  hud._agentOptionLabels = new Map();
  if (selectedAgentId) {
    hud._agentOptionLabels.set(selectedAgentId, label);
  }

  hud._populateAgentSelect = vi.fn();

  return hud;
}

describe('HUD agent select refresh', () => {
  it('rebuilds options when an agent life stage changes', () => {
    const hud = createHudTestDouble();

    const agents = [
      { id: 'agent-1', lifeStage: 'teen' },
      { id: 'agent-2', lifeStage: 'adult' },
    ];

    hud._agentOptionLabels.set('agent-2', 'agent-2 (adult)');

    hud._refreshAgentOptions(agents);

    expect(hud._populateAgentSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps selection when labels are unchanged', () => {
    const hud = createHudTestDouble({ selectedAgentId: 'agent-2', label: 'agent-2 (adult)' });

    hud._agentOptionLabels.set('agent-1', 'agent-1 (adult)');

    const agents = [
      { id: 'agent-1', lifeStage: 'adult' },
      { id: 'agent-2', lifeStage: 'adult' },
    ];

    hud._refreshAgentOptions(agents);

    expect(hud._populateAgentSelect).not.toHaveBeenCalled();
    expect(hud.scene.setSelectedAgent).not.toHaveBeenCalled();
    expect(hud.agentSelect.value).toBe('agent-2');
  });
});
