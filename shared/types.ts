export interface BrainNode {
  id: string;
  base_freq: number;
  duration: number;
  tags: string[];
}

export type BrainEdge = [source: string, target: string, weight: number];

export interface BrainGraph {
  version: number;
  name: string;
  nodes: BrainNode[];
  edges: BrainEdge[];
  start_node: string;
}

export interface Temperament {
  trust_bias: number;
  fear_bias: number;
  loyalty_bias: number;
  resentment_bias: number;
  territorial_bias: number;
  zeal_bias: number;
}

export interface ScenarioTerrain {
  town_radius: number;
  plain_radius: number;
}

export interface ScenarioWorld {
  width: number;
  height: number;
  terrain: ScenarioTerrain;
}

export interface ScenarioTickConfig {
  minutes_per_tick: number;
}

export interface ScenarioHouseAuthority {
  id: string;
  authority: number;
}

export interface ScenarioCityAuthority {
  id: string;
  authority: number;
}

export interface ScenarioConfig {
  version: number;
  name: string;
  world: ScenarioWorld;
  tick: ScenarioTickConfig;
  population: {
    initial_adults: number;
  };
  authorities: {
    houses: ScenarioHouseAuthority[];
    city: ScenarioCityAuthority | null;
  };
}

export interface SnapshotWorldSize {
  w: number;
  h: number;
}

export type SnapshotAgeStage = 'baby' | 'child' | 'teen' | 'adult';

export interface SnapshotAgent {
  id: string;
  x: number;
  y: number;
  age_stage: SnapshotAgeStage;
  brain_node: string | null;
  house_id: string;
  pregnant: boolean;
}

export interface SnapshotHouse {
  id: string;
  x: number;
  y: number;
  authority: number;
  members: string[];
  brain_node: string | null;
}

export interface SnapshotCity {
  id: string;
  x: number;
  y: number;
  authority: number;
  brain_node: string | null;
}

export type DemandScope = 'agent' | 'house' | 'city' | 'terrain';

export interface SnapshotDemand {
  source_id: string;
  scope: DemandScope;
  origin: [number, number];
  radius: number;
  targets: string[];
  multiplier: number;
  expires_at_tick: number;
}

export interface SnapshotStageStats {
  baby: number;
  child: number;
  teen: number;
  adult: number;
}

export interface SnapshotMetadata {
  type: 'SNAPSHOT';
  seed: number;
  tick: number;
  world: SnapshotWorldSize;
  agents: SnapshotAgent[];
  houses: SnapshotHouse[];
  city: SnapshotCity | null;
  demands: SnapshotDemand[];
  stats: SnapshotStageStats;
}
