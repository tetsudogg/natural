// Clouds with depth, and ground mist that pools in the valley.

import * as THREE from 'three';

// Height fog for every material that uses fog. The scene's THREE.Fog carries the mist:
// fog.near is the mist density at its base, fog.far is the height of that base.
// A light distance haze is always added on top so far ridges fade into the air.
THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif
`;
THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogWorldPos = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif
`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vFogWorldPos;
  float fogPatch(vec2 p) {
    // Soft, uneven banks of mist that never move with the camera.
    float a = sin(p.x * 0.021 + sin(p.y * 0.017) * 2.1) * sin(p.y * 0.026 + sin(p.x * 0.013) * 1.7);
    float b = sin(p.x * 0.057 - p.y * 0.043 + 1.3) * sin(p.y * 0.061 + p.x * 0.029);
    return clamp(0.7 + 0.45 * a + 0.2 * b, 0.15, 1.3);
  }
#endif
`;
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  {
    vec3 ray = vFogWorldPos - cameraPosition;
    float dist = length(ray);
    const float k = 0.09;
    float h0 = max(cameraPosition.y - fogFar, -25.0);
    float h1 = max(vFogWorldPos.y - fogFar, -25.0);
    float dh = h1 - h0;
    float e0 = exp(-k * h0);
    float mean = abs(dh) > 0.05 ? (e0 - exp(-k * h1)) / (k * dh) : e0;
    float mist = fogNear * mean * fogPatch(vFogWorldPos.xz);
    float optical = dist * (mist + 0.0012);
    float fogFactor = 1.0 - exp(-optical);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  }
#endif
`;

const cloudVert = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const cloudFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uHorizon;
  uniform float uCover;
  uniform float uLight;
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 6; i++) { v += a * noise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }
  float density(vec2 p) {
    float shape = fbm(p * 0.00055 + vec2(uTime * 0.004, uTime * 0.0015));
    float detail = fbm(p * 0.0023 - vec2(uTime * 0.01, 0.0));
    return smoothstep(uCover, uCover + 0.3, shape * 0.8 + detail * 0.3);
  }
  void main() {
    vec3 view = vWorld - cameraPosition;
    float dist = length(view);
    vec3 dir = view / dist;
    float d = density(vWorld.xz);
    if (d < 0.003) discard;
    // Light reaching this point: less when more cloud lies towards the sun.
    vec2 toSun = normalize(uSunDir.xz + 1e-4) * 140.0;
    float shadow = density(vWorld.xz + toSun) * 0.7 + density(vWorld.xz + toSun * 2.2) * 0.4;
    float lit = exp(-shadow * 1.8) * (0.55 + 0.45 * (1.0 - d));
    float forward = pow(max(dot(dir, uSunDir), 0.0), 6.0);
    vec3 col = uSkyColor * (0.55 + 0.25 * (1.0 - d)) + uSunColor * (lit * 1.1 + forward * (1.2 + 2.5 * (1.0 - d)));
    col *= uLight * 2.2;
    // Far clouds sink into the haze near the horizon.
    float far = smoothstep(900.0, 4200.0, dist);
    col = mix(col, uHorizon, far * 0.75);
    float alpha = d * (1.0 - smoothstep(3200.0, 4800.0, dist)) * 0.92;
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createClouds() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSkyColor: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uCover: { value: 0.5 },
      uLight: { value: 1 },
    },
    vertexShader: cloudVert,
    fragmentShader: cloudFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10000, 10000), mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.renderOrder = -0.5;
  mesh.frustumCulled = false;
  const skyTmp = new THREE.Color();

  return {
    mesh,
    update(time: number, focus: THREE.Vector3, sunDir: THREE.Vector3, sunColor: THREE.Color, daylight: number, night: number, horizon: THREE.Color) {
      mesh.position.set(focus.x, 620, focus.z);
      const u = mat.uniforms;
      u.uTime.value = time;
      u.uSunDir.value.copy(sunDir);
      // Sunlight on the clouds keeps its colour a little after the ground is in shade.
      const glow = THREE.MathUtils.smoothstep(sunDir.y, -0.12, 0.1);
      u.uSunColor.value.copy(sunColor).multiplyScalar(1.3 * glow);
      skyTmp.setRGB(0.45, 0.52, 0.64).multiplyScalar(0.25 + 0.75 * daylight);
      u.uSkyColor.value.copy(skyTmp);
      u.uHorizon.value.copy(horizon);
      u.uLight.value = 0.9 * (0.05 + 0.95 * Math.max(daylight, glow * 0.8)) + 0.03 * night;
      // Clouds slowly come and go over the hours.
      u.uCover.value = 0.46 + 0.1 * Math.sin(time * 0.0021) * Math.sin(time * 0.0013 + 1);
    },
  };
}
