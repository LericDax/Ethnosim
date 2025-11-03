import fs from 'node:fs/promises';
import path from 'node:path';

import type { BrainTelemetryPacket } from '@shared/types.ts';
import {
  createSimulationState,
  stepSimulationState,
  configureTelemetry,
  setTelemetryBuffer,
  setTrackedAgentId,
  type RandomnessMode,
  type SimulationConfig,
} from '../sim.worker.ts';
import { TelemetryRingBuffer } from '../telemetry.ts';

interface ObserveOptions {
  ticks: number;
  sampleInterval: number;
  trackedAgentId: string | null;
  scenarioId: string | null;
  seed: string | number | null;
  randomnessMode: RandomnessMode;
  outputDir: string;
}

function parseArguments(argv: string[]): ObserveOptions {
  let ticks = 1000;
  let sampleInterval = 60;
  let trackedAgentId: string | null = null;
  let scenarioId: string | null = null;
  let seed: string | number | null = null;
  let randomnessMode: RandomnessMode = 'deterministic';
  let outputDir = path.resolve(process.cwd(), 'out', 'runs');

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ticks' && i + 1 < argv.length) {
      const value = Number.parseInt(argv[i + 1] ?? '', 10);
      if (Number.isFinite(value) && value > 0) {
        ticks = Math.floor(value);
      }
      i += 1;
    } else if (arg === '--sample-interval' && i + 1 < argv.length) {
      const value = Number.parseInt(argv[i + 1] ?? '', 10);
      if (Number.isFinite(value) && value >= 0) {
        sampleInterval = Math.max(0, Math.floor(value));
      }
      i += 1;
    } else if (arg === '--agent' && i + 1 < argv.length) {
      const candidate = argv[i + 1];
      trackedAgentId = typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
      i += 1;
    } else if (arg === '--scenario' && i + 1 < argv.length) {
      const candidate = argv[i + 1];
      scenarioId = typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
      i += 1;
    } else if (arg === '--seed' && i + 1 < argv.length) {
      const candidate = argv[i + 1];
      seed = typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
      i += 1;
    } else if (arg === '--mode' && i + 1 < argv.length) {
      const candidate = argv[i + 1];
      if (candidate === 'deterministic' || candidate === 'chaotic') {
        randomnessMode = candidate;
      }
      i += 1;
    } else if (arg === '--output' && i + 1 < argv.length) {
      const candidate = argv[i + 1];
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        outputDir = path.resolve(candidate.trim());
      }
      i += 1;
    }
  }

  return {
    ticks,
    sampleInterval,
    trackedAgentId,
    scenarioId,
    seed,
    randomnessMode,
    outputDir,
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const bufferCapacity = Math.max(2048, options.ticks * 4);
  const telemetryBuffer = new TelemetryRingBuffer(bufferCapacity);
  setTelemetryBuffer(telemetryBuffer);
  configureTelemetry({
    sampleInterval: options.sampleInterval,
    autoFlush: false,
    flushBatchSize: bufferCapacity,
  });

  const simulationConfig: SimulationConfig = {
    scenarioId: options.scenarioId,
    randomnessMode: options.randomnessMode,
    seed: options.seed,
  };
  const simulation = createSimulationState(simulationConfig);
  if (options.trackedAgentId) {
    setTrackedAgentId(options.trackedAgentId, simulation);
  }

  const telemetryLog: BrainTelemetryPacket[] = [];
  for (let i = 0; i < options.ticks; i += 1) {
    stepSimulationState(simulation);
    const drained = telemetryBuffer.drain();
    if (drained.length > 0) {
      telemetryLog.push(...drained);
    }
  }
  const trailing = telemetryBuffer.drain();
  if (trailing.length > 0) {
    telemetryLog.push(...trailing);
  }

  const metadata = {
    run_id: simulation.randomnessMeta.runId,
    randomness_mode: simulation.randomnessMode,
    scenario_id: simulation.scenarioId,
    seed: simulation.seed,
    ticks_requested: options.ticks,
    ticks_completed: simulation.tick,
    sample_interval: options.sampleInterval,
    tracked_agent_id: options.trackedAgentId,
    buffer_capacity: bufferCapacity,
    generated_at: new Date().toISOString(),
  };

  await fs.mkdir(options.outputDir, { recursive: true });
  const safeRunId = metadata.run_id ? metadata.run_id.replace(/[^a-zA-Z0-9_-]/g, '-') : 'run';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `telemetry-${safeRunId}-${timestamp}.json`;
  const outputPath = path.join(options.outputDir, filename);
  const payload = {
    metadata,
    telemetry: telemetryLog,
  };
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  const summary = `Captured ${telemetryLog.length} packets across ${options.ticks} ticks.`;
  console.log(summary);
  console.log(`Output written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
