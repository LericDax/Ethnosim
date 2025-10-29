import {
  AmbientLight,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  Scene,
  GridHelper,
} from 'three';
import { getAgentMaterial, getTerrainMaterial } from './materials.js';

const AGENT_GEOMETRY = new CircleGeometry(0.4, 24);
const TERRAIN_DEPTH = -0.01;

export class MapScene {
  constructor({ worldWidth = 100, worldHeight = 100 } = {}) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

    this.scene = new Scene();
    this.scene.background = new Color(0x05070a);

    this.root = new Group();
    this.scene.add(this.root);

    this._setupLighting();
    this._buildTerrain();
    this._buildOverlayPlaceholders();

    this.agentLayer = new Group();
    this.agentLayer.name = 'agents';
    this.root.add(this.agentLayer);
    this.agentMeshes = new Map();

    this.latestSnapshot = null;
  }

  _setupLighting() {
    const ambient = new AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
  }

  _buildTerrain() {
    const terrain = new Mesh(
      new PlaneGeometry(this.worldWidth, this.worldHeight, 1, 1),
      getTerrainMaterial()
    );
    terrain.position.set(
      this.worldWidth / 2,
      this.worldHeight / 2,
      TERRAIN_DEPTH
    );
    terrain.name = 'terrain-plane';
    this.root.add(terrain);

    const grid = new GridHelper(
      Math.max(this.worldWidth, this.worldHeight),
      Math.max(this.worldWidth, this.worldHeight)
    );
    grid.material.opacity = 0.25;
    grid.material.transparent = true;
    grid.rotation.x = Math.PI / 2;
    grid.position.set(this.worldWidth / 2, this.worldHeight / 2, TERRAIN_DEPTH);
    grid.name = 'terrain-grid';
    this.root.add(grid);
  }

  _buildOverlayPlaceholders() {
    this.overlayRoot = new Group();
    this.overlayRoot.name = 'overlays';
    this.root.add(this.overlayRoot);
  }

  _getOrCreateAgentMesh(agent) {
    let mesh = this.agentMeshes.get(agent.id);
    if (!mesh) {
      mesh = new Mesh(AGENT_GEOMETRY, getAgentMaterial(agent.lifeStage));
      mesh.name = `agent-${agent.id}`;
      mesh.position.set(0, 0, 0.1);
      mesh.userData.agentId = agent.id;
      this.agentMeshes.set(agent.id, mesh);
      this.agentLayer.add(mesh);
    }
    return mesh;
  }

  updateFromSnapshot(payload) {
    const snapshot = payload?.snapshot ?? payload;
    if (!snapshot || !Array.isArray(snapshot.agents)) {
      return;
    }

    this.latestSnapshot = snapshot;
    const seen = new Set();

    for (const agent of snapshot.agents) {
      if (!agent || typeof agent.id !== 'string') continue;
      const mesh = this._getOrCreateAgentMesh(agent);
      mesh.material = getAgentMaterial(agent.lifeStage);
      mesh.position.set(agent.x ?? 0, agent.y ?? 0, mesh.position.z);
      seen.add(agent.id);
    }

    for (const [id, mesh] of this.agentMeshes) {
      if (!seen.has(id)) {
        this.agentLayer.remove(mesh);
        this.agentMeshes.delete(id);
      }
    }
  }

  update(payload) {
    this.updateFromSnapshot(payload);
  }
}
