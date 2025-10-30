import {
  AdditiveBlending,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector4,
} from 'three';
import influenceFragmentShader from './shaders/influenceField.glsl?raw';
import densityFragmentShader from './shaders/densityField.glsl?raw';

const PLANE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export type HeatmapLayer = 'influence' | 'density';

export interface HeatmapMoodIntensities {
  trust?: number;
  fear?: number;
  loyalty?: number;
  resentment?: number;
}

export interface HeatmapDensityStats {
  /** Expected to be in the [0, 1] range. */
  normalized?: number;
  /** Total simulated population, used for textual overlays later. */
  total?: number;
}

export interface HeatmapAggregatedStats {
  authority?: number;
  moodIntensities?: HeatmapMoodIntensities;
  density?: HeatmapDensityStats;
}

interface HeatmapOverlayOptions {
  width?: number;
  height?: number;
  elevation?: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * HeatmapOverlay renders simulated authority / mood and density fields as
 * transparent planes over the terrain. The shaders are placeholders that can be
 * replaced with richer data-driven versions later.
 */
export class HeatmapOverlay extends Group {
  private readonly influenceUniforms = {
    uAuthority: { value: 0 },
    uMood: { value: new Vector4(0, 0, 0, 0) },
    uWorldSize: { value: new Vector2(1, 1) },
  };

  private readonly densityUniforms = {
    uDensityNormalized: { value: 0 },
    uPopulationTotal: { value: 0 },
    uWorldSize: { value: new Vector2(1, 1) },
  };

  private readonly geometry = new PlaneGeometry(1, 1, 1, 1);
  private readonly influenceMaterial: ShaderMaterial;
  private readonly densityMaterial: ShaderMaterial;
  private readonly influenceMesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly densityMesh: Mesh<PlaneGeometry, ShaderMaterial>;

  private width: number;
  private height: number;
  private elevation: number;

  constructor(options: HeatmapOverlayOptions = {}) {
    super();

    this.width = options.width ?? 100;
    this.height = options.height ?? 100;
    this.elevation = options.elevation ?? 0.05;

    this.influenceMaterial = new ShaderMaterial({
      vertexShader: PLANE_VERTEX_SHADER,
      fragmentShader: influenceFragmentShader,
      uniforms: this.influenceUniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.densityMaterial = new ShaderMaterial({
      vertexShader: PLANE_VERTEX_SHADER,
      fragmentShader: densityFragmentShader,
      uniforms: this.densityUniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    this.influenceMesh = new Mesh(this.geometry, this.influenceMaterial);
    this.influenceMesh.renderOrder = 10;
    this.influenceMesh.visible = false;
    this.add(this.influenceMesh);

    this.densityMesh = new Mesh(this.geometry, this.densityMaterial);
    this.densityMesh.renderOrder = 11;
    this.densityMesh.visible = false;
    this.add(this.densityMesh);

    this.setWorldSize(this.width, this.height);
    this.applyElevation();
  }

  /** Clean up geometry and materials. */
  dispose() {
    this.geometry.dispose();
    this.influenceMaterial.dispose();
    this.densityMaterial.dispose();
  }

  /** Update overlay world size to match the simulation terrain. */
  setWorldSize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.influenceMesh.scale.set(this.width, this.height, 1);
    this.densityMesh.scale.set(this.width, this.height, 1);
    this.influenceMesh.rotation.x = Math.PI;
    this.densityMesh.rotation.x = Math.PI;
    this.influenceUniforms.uWorldSize.value.set(this.width, this.height);
    this.densityUniforms.uWorldSize.value.set(this.width, this.height);
    this.applyElevation();
  }

  /** Specify base elevation offset for the overlay planes. */
  setElevation(elevation: number) {
    this.elevation = elevation;
    this.applyElevation();
  }

  private applyElevation() {
    this.influenceMesh.position.set(this.width / 2, this.height / 2, this.elevation);
    this.densityMesh.position.set(this.width / 2, this.height / 2, this.elevation + 0.01);
  }

  /** Enables or disables a specific heatmap layer. */
  setLayerEnabled(layer: HeatmapLayer, enabled: boolean) {
    const visible = Boolean(enabled);
    if (layer === 'influence') {
      this.influenceMesh.visible = visible;
    } else if (layer === 'density') {
      this.densityMesh.visible = visible;
    }
  }

  isLayerEnabled(layer: HeatmapLayer) {
    if (layer === 'influence') return this.influenceMesh.visible;
    if (layer === 'density') return this.densityMesh.visible;
    return false;
  }

  /** Updates shader uniforms using aggregated scene statistics. */
  updateAggregatedStats(stats: HeatmapAggregatedStats = {}) {
    if (typeof stats.authority === 'number') {
      this.influenceUniforms.uAuthority.value = clamp01(stats.authority);
    }

    if (stats.moodIntensities) {
      const mood = this.influenceUniforms.uMood.value;
      if (typeof stats.moodIntensities.trust === 'number') {
        mood.x = clamp01(stats.moodIntensities.trust);
      }
      if (typeof stats.moodIntensities.fear === 'number') {
        mood.y = clamp01(stats.moodIntensities.fear);
      }
      if (typeof stats.moodIntensities.loyalty === 'number') {
        mood.z = clamp01(stats.moodIntensities.loyalty);
      }
      if (typeof stats.moodIntensities.resentment === 'number') {
        mood.w = clamp01(stats.moodIntensities.resentment);
      }
      this.influenceUniforms.uMood.value = mood;
    }

    if (stats.density) {
      if (typeof stats.density.normalized === 'number') {
        this.densityUniforms.uDensityNormalized.value = clamp01(stats.density.normalized);
      }
      if (typeof stats.density.total === 'number') {
        this.densityUniforms.uPopulationTotal.value = Math.max(0, stats.density.total);
      }
    }
  }
}
