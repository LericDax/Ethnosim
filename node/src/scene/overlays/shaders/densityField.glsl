precision mediump float;

varying vec2 vUv;

uniform float uDensityNormalized;
uniform float uPopulationTotal;
uniform vec2 uWorldSize;

float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

void main() {
  float normalizedDensity = saturate(uDensityNormalized);
  float gradient = smoothstep(0.0, 1.0, vUv.y);
  vec3 baseColor = mix(vec3(0.05, 0.17, 0.33), vec3(0.88, 0.85, 0.23), normalizedDensity);
  float pulse = 0.15 * sin((vUv.x + vUv.y) * 20.0 + normalizedDensity * 6.28318);
  vec3 color = baseColor + pulse;

  float alpha = saturate(normalizedDensity * 0.75 + gradient * 0.25);
  alpha *= 0.6;

  if (alpha <= 0.001) {
    discard;
  }

  gl_FragColor = vec4(color, alpha);
}
