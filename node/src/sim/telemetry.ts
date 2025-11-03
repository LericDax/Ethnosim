import type { BrainTickTelemetryCapture } from './engine/brain.ts';
import type { BrainTelemetryEntityType, BrainTelemetryPacket } from '@shared/types.ts';

export interface BrainTelemetryRequest {
  entityId: string;
  entityType: BrainTelemetryEntityType;
  tick: number;
  runId?: string | null;
  reason?: string | null;
}

export class TelemetryRingBuffer {
  private readonly capacity: number;

  private buffer: (BrainTelemetryPacket | undefined)[];

  private start = 0;

  private count = 0;

  constructor(capacity = 512) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      this.capacity = 0;
      this.buffer = [];
      return;
    }
    this.capacity = Math.floor(capacity);
    this.buffer = new Array(this.capacity);
  }

  get size(): number {
    return this.count;
  }

  push(packet: BrainTelemetryPacket): void {
    if (this.capacity <= 0) {
      return;
    }
    const index = (this.start + this.count) % this.capacity;
    this.buffer[index] = packet;
    if (this.count < this.capacity) {
      this.count += 1;
    } else {
      this.start = (this.start + 1) % this.capacity;
    }
  }

  drain(maxCount?: number): BrainTelemetryPacket[] {
    if (this.count === 0 || this.capacity <= 0) {
      return [];
    }
    const limit = this.resolveLimit(maxCount);
    if (limit <= 0) {
      return [];
    }
    const result: BrainTelemetryPacket[] = [];
    for (let i = 0; i < limit; i += 1) {
      const index = (this.start + i) % this.capacity;
      const entry = this.buffer[index];
      if (entry) {
        result.push(entry);
      }
      this.buffer[index] = undefined;
    }
    this.start = (this.start + limit) % this.capacity;
    this.count -= limit;
    if (this.count < 0) {
      this.count = 0;
    }
    return result;
  }

  snapshot(): BrainTelemetryPacket[] {
    if (this.count === 0 || this.capacity <= 0) {
      return [];
    }
    const copy: BrainTelemetryPacket[] = [];
    for (let i = 0; i < this.count; i += 1) {
      const index = (this.start + i) % this.capacity;
      const entry = this.buffer[index];
      if (entry) {
        copy.push(entry);
      }
    }
    return copy;
  }

  clear(): void {
    if (this.capacity <= 0) {
      return;
    }
    this.buffer.fill(undefined);
    this.start = 0;
    this.count = 0;
  }

  private resolveLimit(maxCount?: number): number {
    if (!Number.isFinite(maxCount) || maxCount === undefined || maxCount === null) {
      return this.count;
    }
    if (maxCount <= 0) {
      return 0;
    }
    return Math.min(this.count, Math.floor(maxCount));
  }
}

export function createBrainTelemetryCapture(
  buffer: TelemetryRingBuffer | null,
  request: BrainTelemetryRequest,
): BrainTickTelemetryCapture | null {
  if (!buffer) {
    return null;
  }

  const capture: BrainTickTelemetryCapture = {
    targetId: request.entityId,
    targetType: request.entityType,
    tick: request.tick,
    runId: request.runId ?? null,
    reason: request.reason ?? null,
    record: (packet: BrainTelemetryPacket) => {
      buffer.push({
        ...packet,
        tick: request.tick,
        entity_id: request.entityId,
        entity_type: request.entityType,
        run_id: request.runId ?? null,
        reason: request.reason ?? null,
      });
    },
  };

  return capture;
}
