import { Color, LineBasicMaterial, MeshBasicMaterial } from 'three';

const terrainMaterial = new MeshBasicMaterial({
  color: new Color(0x1b2735),
  transparent: true,
  opacity: 0.95,
});

const terrainBorderMaterial = new LineBasicMaterial({
  color: new Color(0x3a5169),
  transparent: true,
  opacity: 0.35,
});

const agentPalette = new Map([
  ['baby', new Color(0xff00ff)],
  ['child', new Color(0xffff00)],
  ['teen', new Color(0x00ffff)],
  ['adult', new Color(0xffffff)],
  ['elder', new Color(0xffa500)],
]);

const agentMaterialCache = new Map();

export function getTerrainMaterial() {
  return terrainMaterial;
}

export function getTerrainBorderMaterial() {
  return terrainBorderMaterial;
}

export function getAgentMaterial(stage = 'adult') {
  if (!agentMaterialCache.has(stage)) {
    const color = agentPalette.get(stage) ?? new Color(0xffffff);
    agentMaterialCache.set(
      stage,
      new MeshBasicMaterial({ color, depthTest: true, depthWrite: true })
    );
  }
  return agentMaterialCache.get(stage);
}

export function setAgentStageColor(stage, color) {
  const resolved = color instanceof Color ? color : new Color(color);
  agentPalette.set(stage, resolved);
  agentMaterialCache.delete(stage);
}
