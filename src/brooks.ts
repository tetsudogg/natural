// Side brooks in the ravines: clear water running over stones, waterfalls where the
// bed steps down, and mist rising from the plunge pools below them.

import * as THREE from 'three';
import { brooks, type BrookFall } from './world';
import { waterNormalTexture, glowTexture } from './textures';
import { mulberry32 } from './noise';

const NOISE = /* glsl */ `
  float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(vhash(i), vhash(i + vec2(1, 0)), u.x), mix(vhash(i + vec2(0, 1)), vhash(i + vec2(1, 1)), u.x), u.y);
  }
`;

const ribbonVert = /* glsl */ `
  attribute float foam;
  attribute float speed;
  varying vec2 vUv;
  varying float vFoam;
  varying float vSpeed;
  varying vec3 vWorldPos;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vFoam = foam;
    vSpeed = speed;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const ribbonFrag = /* glsl */ `
  uniform sampler2D tNormal;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSky;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform float uLight;
  varying vec2 vUv;
  varying float vFoam;
  varying float vSpeed;
  varying vec3 vWorldPos;
  #include <common>
  ${NOISE}
  #include <fog_pars_fragment>
  void main() {
    // uv.y runs up the brook in metres, so the ripples slide down it.
    float t = uTime * (0.5 + vSpeed * 1.5);
    vec2 uv = vec2(vUv.x * 0.6, vUv.y * 0.25);
    vec3 n1 = texture2D(tNormal, uv + vec2(0.0, t * 0.35)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(tNormal, uv * 2.1 + vec2(0.13, t * 0.6)).xyz * 2.0 - 1.0;
    vec3 n = normalize(vec3(n1.x + n2.x * 0.7, 3.0 - vSpeed, n1.y + n2.y * 0.7));

    vec3 view = normalize(cameraPosition - vWorldPos);
    float facing = max(dot(view, n), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);

    // Glass-clear at the edges, turquoise where it is deeper in the middle and in pools.
    float across = abs(vUv.x - 0.5) * 2.0;
    float depth = (1.0 - smoothstep(0.15, 0.9, across)) * (0.35 + vFoam * 0.65);
    vec3 body = mix(uShallow, uDeep, depth) * uLight;
    vec3 h = normalize(uSunDir + view);
    float spec = pow(max(dot(n, h), 0.0), 300.0) * 6.0;
    vec3 color = mix(body, uSky, clamp(fresnel * 0.7, 0.0, 1.0)) + uSunColor * spec;
    // Shallow and clear: the cobbles on the bed show through almost everywhere.
    float alpha = mix(0.1, 0.62, depth) + fresnel * 0.45;
    alpha *= 1.0 - smoothstep(0.82, 1.0, across);

    // White water: thin streaks and bubbles stretched along the flow, only where it runs
    // fast over stones or churns at the foot of a fall. Most of the brook stays clear.
    vec2 fp = vec2(vUv.x * 9.0, vUv.y * 1.4 - uTime * (1.2 + vSpeed * 2.5));
    float streak = vnoise(fp) * 0.55 + vnoise(fp * 2.7 + 5.0) * 0.3 + vnoise(vec2(vUv.x * 22.0, vUv.y * 4.0 - uTime * 4.0)) * 0.25;
    float churn = clamp(vFoam * 0.35 + vSpeed * 0.8, 0.0, 1.0);
    float foam = smoothstep(1.0 - churn * 0.45, 1.1 - churn * 0.4, streak + n.x * 0.2) * churn;
    // A fizz of fine bubbles right under a fall.
    foam += smoothstep(0.7, 1.0, vFoam) * smoothstep(0.55, 0.9, vnoise(vec2(vUv.x * 30.0, vUv.y * 12.0 - uTime * 2.0))) * 0.18;
    vec3 foamCol = vec3(0.92, 0.96, 0.96) * (uLight * 0.85 + 0.03) + uSunColor * 0.06;
    color = mix(color, foamCol, clamp(foam, 0.0, 0.85));
    alpha = max(alpha, foam * 0.85 * (1.0 - smoothstep(0.7, 1.0, across)));
    gl_FragColor = vec4(color, clamp(alpha + spec, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const fallVert = /* glsl */ `
  varying vec2 vUv;
  varying float vLayer;
  varying float vEdge;
  attribute vec2 layer;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vLayer = layer.x;
    vEdge = layer.y;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// uv.x across the curtain (scaled to metres), uv.y down it in metres.
const fallFrag = /* glsl */ `
  uniform float uTime;
  uniform float uLight;
  uniform vec3 uSunColor;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying float vLayer;
  varying float vEdge;
  #include <common>
  ${NOISE}
  #include <fog_pars_fragment>
  void main() {
    float y = vUv.y;
    float speed = 2.5 + sqrt(y) * 2.5;
    // The sheet splits into ropes of water between the stones of the lip: bands across
    // the fall that barely drift, each full of fast streaks and bubbles running down.
    float band = vnoise(vec2(vUv.x * 5.0 + vLayer * 7.0, y * 0.35 + 3.0)) * 0.7 + vnoise(vec2(vUv.x * 13.0 - vLayer * 3.0, y * 0.6)) * 0.3;
    float rope = smoothstep(0.38, 0.62, band);
    vec2 p = vec2(vUv.x * 26.0 + vLayer * 17.0, y * 3.0 - uTime * speed);
    float streak = vnoise(p) * 0.6 + vnoise(p * vec2(2.1, 1.7) + 3.0) * 0.4;
    float white = smoothstep(0.35, 0.8, streak * 0.8 + y * 0.35 + rope * 0.2);
    // Right at the lip the water is still glassy and green; it whitens as it falls.
    float glass = 1.0 - smoothstep(0.0, 0.3, y);
    float edge = 1.0 - smoothstep(0.5, 1.0, abs(vEdge) + (band - 0.5) * 0.6);
    vec3 foamCol = vec3(0.93, 0.96, 0.97) * (uLight * 0.9 + 0.04) + uSunColor * 0.05;
    vec3 col = mix(uTint * uLight, foamCol, clamp(white * (1.0 - glass * 0.7), 0.0, 1.0));
    float a = mix(0.12, 0.35, glass) + rope * mix(0.25, 0.75, white) * (1.0 - glass * 0.5);
    a *= mix(1.0, 0.5, vLayer) * edge;
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const mistVert = /* glsl */ `
  attribute float phase;
  attribute float size;
  uniform float uTime;
  varying float vAlpha;
  void main() {
    float life = fract(uTime * 0.18 + phase);
    vec3 p = position;
    p.y += life * 1.2;
    p.x += sin(phase * 40.0) * life * 0.8;
    p.z += cos(phase * 40.0) * life * 0.8;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = smoothstep(0.0, 0.15, life) * (1.0 - life);
    gl_PointSize = size * (0.4 + life) * 200.0 / -mv.z;
  }
`;

const mistFrag = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uLight;
  uniform float uAlpha;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a;
    gl_FragColor = vec4(vec3(0.9, 0.94, 0.95) * (uLight * 0.8 + 0.05), a * vAlpha * uAlpha);
    #include <colorspace_fragment>
  }
`;

function ribbonGeometry() {
  const pos: number[] = [];
  const uvs: number[] = [];
  const foam: number[] = [];
  const speed: number[] = [];
  const idx: number[] = [];
  const ACROSS = 4;
  for (const b of brooks()) {
    const n = b.x.length;
    // How churned the water is at each sample: pools below falls, and rapids.
    const churn = new Float32Array(n);
    const fast = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      // Riffles where the run climbs, and white water pouring down each step.
      const up = (b.water[Math.min(n - 1, k + 2)] - b.water[Math.max(0, k - 2)]) / 4;
      const step = Math.max(b.water[Math.min(n - 1, k + 1)] - b.water[k], k > 0 ? b.water[k] - b.water[k - 1] : 0);
      fast[k] = Math.max(THREE.MathUtils.smoothstep(up, 0.02, 0.12) * 0.5, THREE.MathUtils.smoothstep(step, 0.2, 0.5) * 0.6);
      for (const f of b.falls) {
        const d = Math.hypot(b.x[k] - f.x, b.z[k] - f.z);
        const below = (b.x[k] - f.x) * f.dirX + (b.z[k] - f.z) * f.dirZ > -0.6;
        const size = Math.min(1, (f.top - f.bottom) / 1.5);
        if (below) churn[k] = Math.max(churn[k], (1 - THREE.MathUtils.smoothstep(d, 0.5, 2 + 3 * size)) * (0.5 + 0.5 * size));
        else churn[k] = Math.max(churn[k], (1 - THREE.MathUtils.smoothstep(d, 0.5, 3)) * 0.5);
      }
    }
    const base = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const k0 = Math.max(0, k - 1);
      const k1 = Math.min(n - 1, k + 1);
      let tx = b.x[k1] - b.x[k0];
      let tz = b.z[k1] - b.z[k0];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const hw = b.width[k] + 0.45;
      for (let i = 0; i <= ACROSS; i++) {
        const s = i / ACROSS;
        const o = (s - 0.5) * 2 * hw;
        pos.push(b.x[k] - tz * o, b.water[k], b.z[k] + tx * o);
        uvs.push(s, k);
        foam.push(churn[k]);
        speed.push(fast[k]);
      }
    }
    for (let k = 0; k < n - 1; k++) {
      // Each little fall gets its own sheet of water; the ribbon breaks there.
      if (Math.abs(b.water[k + 1] - b.water[k]) > 0.35) continue;
      for (let i = 0; i < ACROSS; i++) {
        const a = base + k * (ACROSS + 1) + i;
        const c = a + ACROSS + 1;
        idx.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('foam', new THREE.Float32BufferAttribute(foam, 1));
  geo.setAttribute('speed', new THREE.Float32BufferAttribute(speed, 1));
  geo.setIndex(idx);
  return geo;
}

// A small fall: a sheet of white water pouring off the lip, sliding down the rock step
// and leaping a little clear of it at the bottom. Two layers, the back one wider and fainter.
function curtainGeometry(falls: BrookFall[]) {
  const pos: number[] = [];
  const uvs: number[] = [];
  const layer: number[] = [];
  const idx: number[] = [];
  const ROWS = 14;
  const COLS = 6;
  for (const f of falls) {
    const H = f.top - f.bottom;
    const throwDist = Math.min(1.4, 0.7 + 0.25 * H);
    const sx = -f.dirZ;
    const sz = f.dirX;
    // The lip sits half a metre upstream of the fall's midpoint.
    const lx = f.x - f.dirX * 0.5;
    const lz = f.z - f.dirZ * 0.5;
    for (let L = 0; L < 2; L++) {
      const base = pos.length / 3;
      const w0 = f.width * (L === 0 ? 1 : 1.15);
      for (let r = 0; r <= ROWS; r++) {
        const t = r / ROWS;
        const drop = t * t * 0.3 + t * 0.7; // denser rows near the lip, where it curves
        const out = 0.1 + throwDist * Math.sqrt(drop) * (L === 0 ? 1 : 1.1);
        const w = w0 * (1 + drop * 0.3);
        for (let c = 0; c <= COLS; c++) {
          const s = (c / COLS - 0.5) * 2;
          // A slight bulge: the middle carries more water and throws further.
          const bulge = (1 - s * s) * 0.06;
          pos.push(lx + f.dirX * (out + bulge) + sx * s * w, f.top + 0.03 - drop * (H + 0.05), lz + f.dirZ * (out + bulge) + sz * s * w);
          uvs.push(s * w, drop * H);
          layer.push(L, s);
        }
      }
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const a = base + r * (COLS + 1) + c;
          const d = a + COLS + 1;
          idx.push(a, d, a + 1, a + 1, d, d + 1);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('layer', new THREE.Float32BufferAttribute(layer, 2));
  geo.setIndex(idx);
  return geo;
}

function mistGeometry(falls: BrookFall[]) {
  const rnd = mulberry32(91);
  const pos: number[] = [];
  const phase: number[] = [];
  const size: number[] = [];
  for (const f of falls) {
    const H = f.top - f.bottom;
    if (H < 1.2) continue;
    const count = Math.round(H * 4);
    const reach = Math.min(1.4, 0.7 + 0.25 * H) + 0.1;
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd() * f.width * 1.3;
      pos.push(f.x + f.dirX * (reach - 0.5) + Math.cos(a) * r, f.bottom + 0.05, f.z + f.dirZ * (reach - 0.5) + Math.sin(a) * r);
      phase.push(rnd());
      size.push(0.6 + rnd() * 0.8 + H * 0.08);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('phase', new THREE.Float32BufferAttribute(phase, 1));
  geo.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
  return geo;
}

export function createBrooks() {
  const falls = brooks().flatMap((b) => b.falls);
  const group = new THREE.Group();

  const water = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        tNormal: { value: null },
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSky: { value: new THREE.Color(0.6, 0.7, 0.8) },
        uShallow: { value: new THREE.Color().setRGB(0.5, 0.62, 0.52, THREE.SRGBColorSpace) },
        uDeep: { value: new THREE.Color().setRGB(0.05, 0.36, 0.36, THREE.SRGBColorSpace) },
        uLight: { value: 1 },
      },
    ]),
    vertexShader: ribbonVert,
    fragmentShader: ribbonFrag,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  water.uniforms.tNormal.value = waterNormalTexture();
  const ribbon = new THREE.Mesh(ribbonGeometry(), water);
  ribbon.renderOrder = 1;
  group.add(ribbon);

  const curtainMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uLight: { value: 1 },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uTint: { value: new THREE.Color().setRGB(0.35, 0.55, 0.52, THREE.SRGBColorSpace) },
      },
    ]),
    vertexShader: fallVert,
    fragmentShader: fallFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const curtains = new THREE.Mesh(curtainGeometry(falls), curtainMat);
  curtains.renderOrder = 2;
  group.add(curtains);

  const mistMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLight: { value: 1 }, uAlpha: { value: 0.22 }, uMap: { value: glowTexture() } },
    vertexShader: mistVert,
    fragmentShader: mistFrag,
    transparent: true,
    depthWrite: false,
  });
  const mist = new THREE.Points(mistGeometry(falls), mistMat);
  mist.renderOrder = 3;
  group.add(mist);

  return {
    group,
    falls,
    update(time: number, sunDir: THREE.Vector3, sunColor: THREE.Color, sunStrength: number, daylight: number, sky: THREE.Color) {
      const light = 0.08 + 0.92 * daylight;
      water.uniforms.uTime.value = time;
      water.uniforms.uSunDir.value.copy(sunDir);
      water.uniforms.uSunColor.value.copy(sunColor).multiplyScalar(sunStrength);
      water.uniforms.uLight.value = light;
      water.uniforms.uSky.value.copy(sky);
      curtainMat.uniforms.uTime.value = time;
      curtainMat.uniforms.uLight.value = light;
      curtainMat.uniforms.uSunColor.value.copy(sunColor).multiplyScalar(sunStrength);
      mistMat.uniforms.uTime.value = time;
      mistMat.uniforms.uLight.value = light;
    },
  };
}
