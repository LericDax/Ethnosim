precision mediump float;

varying vec2 vUv;

uniform float uAuthority;
uniform vec4 uMood; // trust, fear, loyalty, resentment

float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

void main() {
  vec2 centered = vUv - 0.5;
  float radialFalloff = 1.0 - saturate(length(centered) * 1.65);
  float authority = saturate(uAuthority);
  vec4 mood = clamp(uMood, 0.0, 1.0);

  // Blend between cool authority base and warm mood-driven highlights.
  vec3 authorityColor = mix(vec3(0.08, 0.18, 0.44), vec3(0.12, 0.38, 0.78), authority);
  vec3 moodWarmth = vec3(mood.x * 0.55 + mood.z * 0.35, mood.z * 0.45, mood.y * 0.45 + mood.w * 0.35);
  vec3 color = mix(authorityColor, vec3(0.94, 0.46, 0.26), moodWarmth.r);
  color += vec3(mood.z * 0.2, mood.x * 0.15, mood.y * 0.25);

  float alpha = saturate(authority * 0.65 + dot(mood.xyz, vec3(0.2, 0.25, 0.25)));
  alpha *= radialFalloff;
  alpha = saturate(alpha);

  if (alpha <= 0.001) {
    discard;
  }

  gl_FragColor = vec4(color, alpha);
}
