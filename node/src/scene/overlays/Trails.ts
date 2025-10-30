import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';

interface SnapshotAgent {
  id: string;
  x: number;
  y: number;
}

interface Snapshot {
  tick: number;
  agents?: SnapshotAgent[];
}

interface TrailsOverlayOptions {
  /** Maximum number of trail segments kept per agent. */
  maxSegmentsPerAgent?: number;
  /** Maximum age in ticks before a segment is discarded. */
  maxSegmentAge?: number;
  /** Width of the ribbon segment used to render trails. */
  segmentWidth?: number;
  /** Z offset to lift the trail above the terrain plane. */
  elevation?: number;
  /** Base color used for the trails. */
  color?: Color | string | number;
}

type AgentPosition = {
  x: number;
  y: number;
  tick: number;
};

type AgentTrail = {
  positions: AgentPosition[];
};

/**
 * TrailsOverlay tracks recent movement for agents and renders a ribbon trail
 * for the currently selected agent.
 */
export class TrailsOverlay extends Group {
  private readonly histories: Map<string, AgentTrail> = new Map();
  private readonly maxSegmentsPerAgent: number;
  private readonly maxPositionsPerAgent: number;
  private readonly maxSegmentAge: number;
  private readonly segmentWidth: number;
  private readonly elevation: number;
  private readonly baseColor: Color;
  private readonly trailMesh: InstancedMesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly tmpMatrix = new Matrix4();
  private readonly tmpQuaternion = new Quaternion();
  private readonly tmpScale = new Vector3();
  private readonly tmpStart = new Vector3();
  private readonly tmpEnd = new Vector3();
  private readonly tmpMid = new Vector3();
  private readonly zAxis = new Vector3(0, 0, 1);

  private enabled = false;
  private trackedAgentId: string | null = null;
  private geometryDirty = false;

  constructor(options: TrailsOverlayOptions = {}) {
    super();

    this.maxSegmentsPerAgent = Math.max(1, options.maxSegmentsPerAgent ?? 64);
    // We store one extra position so we can build N segments from N+1 samples.
    this.maxPositionsPerAgent = this.maxSegmentsPerAgent + 1;
    this.maxSegmentAge = Math.max(1, options.maxSegmentAge ?? 300);
    this.segmentWidth = options.segmentWidth ?? 0.2;
    this.elevation = options.elevation ?? 0.2;
    this.baseColor = options.color instanceof Color ? options.color.clone() : new Color(options.color ?? 0x38bdf8);

    const geometry = new PlaneGeometry(1, this.segmentWidth);
    const material = new MeshBasicMaterial({
      color: this.baseColor,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });

    this.trailMesh = new InstancedMesh(geometry, material, this.maxSegmentsPerAgent);
    this.trailMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.trailMesh.count = 0;
    this.trailMesh.visible = false;
    this.add(this.trailMesh);
  }

  /** Enables or disables trail rendering. */
  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.trailMesh.visible = enabled && this.trackedAgentId != null;
    this.geometryDirty = true;
    if (enabled) {
      this.updateGeometry();
    }
  }

  /** Specifies which agent's trail should be rendered. */
  setTrackedAgent(agentId: string | null) {
    if (this.trackedAgentId === agentId) return;
    this.trackedAgentId = agentId;
    this.trailMesh.visible = this.enabled && agentId != null;
    this.geometryDirty = true;
    if (this.enabled) {
      this.updateGeometry();
    } else if (agentId == null) {
      this.trailMesh.count = 0;
    }
  }

  /** Incorporates snapshot data into the trail history. */
  updateFromSnapshot(snapshot: Snapshot) {
    const tick = snapshot.tick ?? 0;
    const seenThisTick = new Set<string>();

    for (const agent of snapshot.agents ?? []) {
      if (!agent?.id) continue;
      const id = agent.id;
      seenThisTick.add(id);
      this.recordAgentPosition(id, agent.x ?? 0, agent.y ?? 0, tick);
    }

    // Remove trails for agents that vanished from the snapshot entirely.
    for (const id of this.histories.keys()) {
      if (!seenThisTick.has(id)) {
        this.histories.delete(id);
      }
    }

    this.geometryDirty = true;
    if (this.enabled) {
      this.updateGeometry();
    }
  }

  /** Clears mesh resources. */
  dispose() {
    this.trailMesh.geometry.dispose();
    this.trailMesh.material.dispose();
  }

  private recordAgentPosition(agentId: string, x: number, y: number, tick: number) {
    let trail = this.histories.get(agentId);
    if (!trail) {
      trail = { positions: [] };
      this.histories.set(agentId, trail);
    }

    const positions = trail.positions;
    const last = positions[positions.length - 1];

    if (last && last.x === x && last.y === y) {
      // Agent is stationary; update tick to extend lifetime of the final vertex.
      last.tick = tick;
    } else {
      positions.push({ x, y, tick });
    }

    this.prunePositions(positions, tick);

    if (positions.length < 2) {
      // Too short to render meaningful geometry.
      return;
    }
  }

  private prunePositions(positions: AgentPosition[], currentTick: number) {
    const cutoffTick = currentTick - this.maxSegmentAge;
    let removeCount = 0;
    while (removeCount < positions.length && positions[removeCount].tick < cutoffTick) {
      removeCount += 1;
    }
    if (removeCount > 0) {
      positions.splice(0, removeCount);
    }

    const excess = positions.length - this.maxPositionsPerAgent;
    if (excess > 0) {
      positions.splice(0, excess);
    }
  }

  private updateGeometry() {
    if (!this.geometryDirty) return;
    this.geometryDirty = false;

    if (!this.enabled || !this.trackedAgentId) {
      this.trailMesh.count = 0;
      this.trailMesh.instanceMatrix.needsUpdate = true;
      this.trailMesh.visible = false;
      return;
    }

    const trail = this.histories.get(this.trackedAgentId);
    if (!trail || trail.positions.length < 2) {
      this.trailMesh.count = 0;
      this.trailMesh.instanceMatrix.needsUpdate = true;
      this.trailMesh.visible = false;
      return;
    }

    const positions = trail.positions;
    const startIndex = Math.max(0, positions.length - 1 - this.maxSegmentsPerAgent);
    let instanceIndex = 0;

    for (let i = startIndex; i < positions.length - 1 && instanceIndex < this.maxSegmentsPerAgent; i += 1) {
      const start = positions[i];
      const end = positions[i + 1];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) {
        continue;
      }

      this.tmpStart.set(start.x, start.y, this.elevation);
      this.tmpEnd.set(end.x, end.y, this.elevation);
      this.tmpMid.lerpVectors(this.tmpStart, this.tmpEnd, 0.5);

      const angle = Math.atan2(dy, dx);
      this.tmpQuaternion.setFromAxisAngle(this.zAxis, angle);

      this.tmpScale.set(length, this.segmentWidth, 1);
      this.tmpMatrix.compose(this.tmpMid, this.tmpQuaternion, this.tmpScale);
      this.trailMesh.setMatrixAt(instanceIndex, this.tmpMatrix);
      if (this.trailMesh.instanceColor) {
        this.trailMesh.setColorAt(instanceIndex, this.baseColor);
      }
      instanceIndex += 1;
    }

    this.trailMesh.count = instanceIndex;
    this.trailMesh.visible = instanceIndex > 0;
    this.trailMesh.instanceMatrix.needsUpdate = true;
    if (this.trailMesh.instanceColor) {
      this.trailMesh.instanceColor.needsUpdate = true;
    }
  }
}
