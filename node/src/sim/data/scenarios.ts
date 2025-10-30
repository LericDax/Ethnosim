import baselineSmall from '../../../../shared/scenarios/baseline_small.json' assert { type: 'json' };
import type { ScenarioConfig } from '../../../../shared/types';

export type ScenarioId = string;

const SCENARIOS = new Map<ScenarioId, ScenarioConfig>([
  ['baseline_small', sanitizeScenario(baselineSmall as ScenarioConfig)],
]);

function sanitizeScenario(input: ScenarioConfig): ScenarioConfig {
  return JSON.parse(JSON.stringify(input));
}

export function listScenarioIds(): ScenarioId[] {
  return Array.from(SCENARIOS.keys());
}

export function getScenarioById(id: ScenarioId): ScenarioConfig {
  if (!SCENARIOS.has(id)) {
    throw new Error(`Unknown scenario: ${id}`);
  }
  const scenario = SCENARIOS.get(id)!;
  return sanitizeScenario(scenario);
}

export function getDefaultScenarioId(): ScenarioId {
  return 'baseline_small';
}

export function resolveScenario(id?: ScenarioId | null): { id: ScenarioId; config: ScenarioConfig } {
  const scenarioId = id && SCENARIOS.has(id) ? id : getDefaultScenarioId();
  const config = getScenarioById(scenarioId);
  return { id: scenarioId, config };
}

export function scenarioToSimulationDefaults(
  scenario: ScenarioConfig,
): { worldSize: [number, number]; agentCount: number } {
  const width = Math.max(1, Math.floor(scenario.world?.width ?? 100));
  const height = Math.max(1, Math.floor(scenario.world?.height ?? 100));
  const agentCount = Math.max(1, Math.floor(scenario.population?.initial_adults ?? 8));
  return { worldSize: [width, height], agentCount };
}
