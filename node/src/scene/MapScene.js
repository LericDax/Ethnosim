import {
  AmbientLight,
  CircleGeometry,
  Color,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';

const DEFAULT_WORLD_SIZE = 100;
const AGENT_GEOMETRY = new CircleGeometry(0.4, 24);
const LIFE_STAGE_COLORS = {
  baby: 0xfde68a,
  child: 0x60a5fa,
  teen: 0xf97316,
  adult: 0x22c55e,
};
const DEFAULT_AGENT_COLOR = 0xffffff;

function materialForLifeStage(stage) {
  const hex = LIFE_STAGE_COLORS[stage] ?? DEFAULT_AGENT_COLOR;
  return new MeshBasicMaterial({ color: hex });
}

export class MapScene {
  constructor({ container, worldWidth = DEFAULT_WORLD_SIZE, worldHeight = DEFAULT_WORLD_SIZE } = {}) {
    if (!container) {
      throw new Error('MapScene requires a host container element.');
    }
    this.container = container;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

    this.scene = new Scene();
    this.scene.background = new Color(0x04070a);

    this.camera = new OrthographicCamera(0, this.worldWidth, this.worldHeight, 0, -100, 100);
    this.camera.position.set(this.worldWidth / 2, this.worldHeight / 2, 50);
    this.camera.lookAt(new Vector3(this.worldWidth / 2, this.worldHeight / 2, 0));

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio ?? 1);
    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    this.root = new Group();
    this.scene.add(this.root);

    this._agentMaterials = new Map();
    this.agentMeshes = new Map();
    this.agentLayer = new Group();

    this._buildTerrain();
    this._setupLights();

    this.root.add(this.agentLayer);
    this.latestSnapshot = null;
  }

  _setupLights() {
    const ambient = new AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
  }

  _buildTerrain() {
    const planeGeometry = new PlaneGeometry(this.worldWidth, this.worldHeight, 1, 1);
    const planeMaterial = new MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.95 });
    const plane = new Mesh(planeGeometry, planeMaterial);
    plane.position.set(this.worldWidth / 2, this.worldHeight / 2, -0.5);
    plane.rotation.x = Math.PI;
    this.root.add(plane);

    const gridSize = Math.max(this.worldWidth, this.worldHeight);
    const divisions = gridSize;
    const grid = new GridHelper(gridSize, divisions, 0x1f2937, 0x1f2937);
    grid.material.transparent = true;
    grid.material.opacity = 0.2;
    grid.rotation.x = Math.PI / 2;
    grid.position.set(this.worldWidth / 2, this.worldHeight / 2, -0.25);
    this.root.add(grid);
  }

  resizeToDisplay() {
    const width = this.container.clientWidth || window.innerWidth || this.worldWidth;
    const height = this.container.clientHeight || window.innerHeight || this.worldHeight;
    this.renderer.setSize(width, height, false);
    this._updateCamera();
  }

  _updateCamera() {
    this.camera.left = 0;
    this.camera.right = this.worldWidth;
    this.camera.top = this.worldHeight;
    this.camera.bottom = 0;
    this.camera.position.set(this.worldWidth / 2, this.worldHeight / 2, 50);
    this.camera.lookAt(new Vector3(this.worldWidth / 2, this.worldHeight / 2, 0));
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  _materialForStage(stage) {
    if (!this._agentMaterials.has(stage)) {
      this._agentMaterials.set(stage, materialForLifeStage(stage));
    }
    return this._agentMaterials.get(stage);
  }

  _getOrCreateAgentMesh(agent) {
    let mesh = this.agentMeshes.get(agent.id);
    if (!mesh) {
      mesh = new Mesh(AGENT_GEOMETRY, this._materialForStage(agent.lifeStage));
      mesh.position.set(agent.x ?? 0, agent.y ?? 0, 1);
      this.agentMeshes.set(agent.id, mesh);
      this.agentLayer.add(mesh);
    }
    return mesh;
  }

  updateFromSnapshot(snapshot) {
    if (!snapshot || snapshot.type !== 'SNAPSHOT') {
      return;
    }

    if (snapshot.world) {
      const { width = this.worldWidth, height = this.worldHeight } = snapshot.world;
      if (width !== this.worldWidth || height !== this.worldHeight) {
        this.worldWidth = width;
        this.worldHeight = height;
        this._updateCamera();
      }
    }

    this.latestSnapshot = snapshot;

    const seen = new Set();
    for (const agent of snapshot.agents ?? []) {
      if (!agent?.id) continue;
      const mesh = this._getOrCreateAgentMesh(agent);
      mesh.material = this._materialForStage(agent.lifeStage);
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
}
