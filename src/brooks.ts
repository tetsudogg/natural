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
  varying float vH;
  attribute vec2 layer;
  attribute float height;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vLayer = layer.x;
    vEdge = layer.y;
    vH = height;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// uv.x across the curtain (scaled to metres), uv.y down it in metres.
// layer.x: 0 the core sheet, 1 the wider veil behind it; layer.y: -1..1 across.
const fallFrag = /* glsl */ `
  uniform float uTime;
  uniform float uLight;
  uniform vec3 uSunColor;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying float vLayer;
  varying float vEdge;
  varying float vH;
  #include <common>
  ${NOISE}
  #include <fog_pars_fragment>
  void main() {
    float y = vUv.y;
    float x = vUv.x + vLayer * 3.7;
    // Water speeds up as it falls (v = sqrt(2 g h)), so its texture streams faster below.
    float speed = 1.6 + sqrt(y) * 4.4;
    float fy = y * 1.2 - uTime * speed;
    // Ropes: where the lip lets more water through. They wander slowly across the fall.
    float band = vnoise(vec2(x * 3.2 + uTime * 0.07, y * 0.25 + 2.0)) * 0.65 + vnoise(vec2(x * 8.0, y * 0.5 - uTime * 0.1)) * 0.35;
    float rope = smoothstep(0.3, 0.7, band);
    // Long, fine streaks running down, and lumps of aerated water tumbling in them.
    float fine = vnoise(vec2(x * 46.0, fy * 0.9)) * 0.5 + vnoise(vec2(x * 90.0 + 7.0, fy * 1.6)) * 0.3 + vnoise(vec2(x * 20.0, fy * 0.5)) * 0.2;
    float lumps = vnoise(vec2(x * 9.0, fy * 2.2)) * vnoise(vec2(x * 4.0 + 3.0, fy * 1.1 + 5.0));
    // Glassy and green at the lip, turning white as air gets into it.
    float glass = 1.0 - smoothstep(0.0, 0.25 + 0.1 * vH, y);
    float aer = clamp(smoothstep(0.0, 0.9, y) * 0.8 + rope * 0.3, 0.0, 1.0);
    float white = clamp(smoothstep(0.32, 0.75, fine * (0.7 + aer * 0.6) + lumps * 0.5) * (0.35 + aer * 0.65), 0.0, 1.0);
    white *= 1.0 - glass * 0.75;
    // A tall fall comes apart toward the bottom: the sheet frays into falling drops.
    float frayStart = 0.6 * vH;
    float fray = smoothstep(frayStart, vH + 0.3, y) * step(2.0, vH);
    float drops = smoothstep(0.45 + fray * 0.3, 0.75 + fray * 0.2, vnoise(vec2(x * 30.0, fy * 2.5)) * 0.6 + vnoise(vec2(x * 70.0, fy * 4.0)) * 0.4 + 0.25);
    float coverage = mix(1.0, drops, fray * (1.0 - rope * 0.5));
    // Ragged sides.
    float edge = 1.0 - smoothstep(0.55, 1.0, abs(vEdge) + (band - 0.5) * 0.5 + (fine - 0.5) * 0.25);

    vec3 water = uTint * (0.55 + 0.45 * rope) * uLight;
    vec3 foamCol = vec3(0.95, 0.97, 0.98) * (uLight * 0.92 + 0.04) + uSunColor * 0.08;
    // The lip catches the sky in a bright line.
    float lipLine = smoothstep(0.08, 0.0, y) * 0.6;
    vec3 col = mix(water, foamCol, white) + lipLine * uLight * 0.4;
    float a = mix(0.18, 0.45, glass) * (0.6 + rope * 0.6) + white * mix(0.55, 0.92, rope);
    a = clamp(a, 0.0, 0.95) * coverage * edge * mix(1.0, 0.45, vLayer);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// Spray thrown up where the water hits the pool: bright drops on short arcs.
// Churned white water where a fall lands: boiling foam that spreads and fades.
const boilVert = /* glsl */ `
  attribute float strength;
  varying vec2 vUv;
  varying float vStrength;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vStrength = strength;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const boilFrag = /* glsl */ `
  uniform float uTime;
  uniform float uLight;
  varying vec2 vUv;
  varying float vStrength;
  #include <common>
  ${NOISE}
  #include <fog_pars_fragment>
  void main() {
    vec2 c = (vUv - 0.5) * 2.0;
    float r = length(c);
    // Foam pushed outward from the impact, broken into curds.
    float t = uTime * 0.6;
    vec2 q = c * 4.0;
    float n = vnoise(q * 1.3 + vec2(t, -t * 0.7)) * 0.5 + vnoise(q * 3.1 - vec2(t * 1.6, t)) * 0.3 + vnoise(vec2(r * 9.0 - uTime * 2.2, atan(c.y, c.x) * 3.0)) * 0.35;
    float core = 1.0 - smoothstep(0.0, 0.55, r);
    float field = (1.0 - smoothstep(0.35, 1.0, r)) * smoothstep(0.35 - core * 0.3, 0.7, n + core * 0.4);
    float a = clamp(field * (0.55 + 0.45 * vStrength) + core * 0.35 * vStrength, 0.0, 0.92);
    gl_FragColor = vec4(vec3(0.94, 0.97, 0.98) * (uLight * 0.9 + 0.05), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const sprayVert = /* glsl */ `
  attribute vec4 seed; // phase, angle, speed, size
  attribute vec3 dir; // the fall's downstream direction (xz) and its height
  uniform float uTime;
  varying float vAlpha;
  void main() {
    float H = dir.z;
    float rate = 0.9 + seed.x * 0.6;
    float life = fract(uTime * rate + seed.x * 7.0);
    float t = life * (0.5 + 0.3 * sqrt(H));
    float a = seed.y;
    vec2 out2 = vec2(cos(a), sin(a)) * 0.6 + dir.xy * 0.9;
    float v = seed.z * (1.0 + 0.45 * sqrt(H));
    vec3 p = position + vec3(out2.x * v * t, v * 1.1 * t - 4.9 * t * t, out2.y * v * t);
    p.y = max(p.y, position.y - 0.05);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = (1.0 - life) * smoothstep(0.0, 0.08, life);
    gl_PointSize = seed.w * 260.0 / -mv.z;
  }
`;

const sprayFrag = /* glsl */ `
  uniform float uLight;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    float a = smoothstep(0.25, 0.05, d) * vAlpha * 0.8;
    gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * (uLight * 0.9 + 0.05), a);
    #include <colorspace_fragment>
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
    const breaks = new Set(b.falls.map((f) => f.at - 1));
    for (let k = 0; k < n - 1; k++) {
      // Each fall gets its own sheet of water; the ribbon breaks there.
      if (breaks.has(k)) continue;
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

// A fall: a sheet of water pouring off the lip. Small ones slide down the rock step and
// leap a little clear at the bottom; big ones arc out over the pool in free fall.
// Two layers, the back one a wider, fainter veil.
function curtainGeometry(falls: BrookFall[]) {
  const pos: number[] = [];
  const uvs: number[] = [];
  const layer: number[] = [];
  const height: number[] = [];
  const idx: number[] = [];
  for (const f of falls) {
    const H = f.top - f.bottom;
    const big = H > 2.5;
    const ROWS = big ? 28 : 16;
    const COLS = big ? 10 : 6;
    // How far the water is thrown: a big fall leaves the lip at about 1.3 m/s.
    const throwDist = big ? 1.3 * Math.sqrt((2 * H) / 9.8) + 0.2 : Math.min(1.4, 0.7 + 0.25 * H);
    const sx = -f.dirZ;
    const sz = f.dirX;
    // The lip sits half a metre upstream of the fall's midpoint.
    const lx = f.x - f.dirX * 0.5;
    const lz = f.z - f.dirZ * 0.5;
    for (let L = 0; L < 2; L++) {
      const base = pos.length / 3;
      const w0 = f.width * (L === 0 ? 1 : 1.18);
      for (let r = 0; r <= ROWS; r++) {
        const t = r / ROWS;
        const drop = t * t * 0.3 + t * 0.7; // denser rows near the lip, where it curves
        const out = 0.1 + throwDist * Math.sqrt(drop) * (L === 0 ? 1 : 0.92);
        // A big fall spreads as it drops.
        const w = w0 * (1 + drop * (big ? 0.45 : 0.3));
        for (let c = 0; c <= COLS; c++) {
          const s = (c / COLS - 0.5) * 2;
          // A slight bulge: the middle carries more water and throws further.
          const bulge = (1 - s * s) * (big ? 0.15 : 0.06);
          pos.push(lx + f.dirX * (out + bulge) + sx * s * w, f.top + 0.03 - drop * (H + 0.08), lz + f.dirZ * (out + bulge) + sz * s * w);
          uvs.push(s * w, drop * H);
          layer.push(L, s);
          height.push(H);
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
  geo.setAttribute('height', new THREE.Float32BufferAttribute(height, 1));
  geo.setIndex(idx);
  return geo;
}

// Where each fall lands: the bottom of its sheet.
function landing(f: BrookFall) {
  const H = f.top - f.bottom;
  const throwDist = H > 2.5 ? 1.3 * Math.sqrt((2 * H) / 9.8) + 0.2 : Math.min(1.4, 0.7 + 0.25 * H);
  return { x: f.x + f.dirX * (throwDist - 0.4), z: f.z + f.dirZ * (throwDist - 0.4), H };
}

function boilGeometry(falls: BrookFall[]) {
  const pos: number[] = [];
  const uvs: number[] = [];
  const str: number[] = [];
  const idx: number[] = [];
  for (const f of falls) {
    const { x, z, H } = landing(f);
    if (H < 0.5) continue;
    const r = f.width * (1.1 + Math.min(1.5, H * 0.35));
    const base = pos.length / 3;
    const y = f.bottom + 0.015;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      pos.push(x + (u - 0.5) * 2 * r, y, z + (v - 0.5) * 2 * r);
      uvs.push(u, v);
      str.push(Math.min(1, H / 3));
    }
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('strength', new THREE.Float32BufferAttribute(str, 1));
  geo.setIndex(idx);
  return geo;
}

function sprayGeometry(falls: BrookFall[]) {
  const rnd = mulberry32(57);
  const pos: number[] = [];
  const seed: number[] = [];
  const dir: number[] = [];
  for (const f of falls) {
    const { x, z, H } = landing(f);
    const count = Math.round(f.width * (10 + H * 22));
    const sx = -f.dirZ;
    const sz = f.dirX;
    for (let i = 0; i < count; i++) {
      const o = (rnd() * 2 - 1) * f.width * 1.1;
      pos.push(x + sx * o + (rnd() - 0.5) * 0.3, f.bottom + 0.02, z + sz * o + (rnd() - 0.5) * 0.3);
      seed.push(rnd(), rnd() * Math.PI * 2, 0.6 + rnd() * 1.6, 0.025 + rnd() * 0.04 + (H > 2.5 ? 0.02 : 0));
      dir.push(f.dirX, f.dirZ, H);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 4));
  geo.setAttribute('dir', new THREE.Float32BufferAttribute(dir, 3));
  return geo;
}

function mistGeometry(falls: BrookFall[]) {
  const rnd = mulberry32(91);
  const pos: number[] = [];
  const phase: number[] = [];
  const size: number[] = [];
  for (const f of falls) {
    const { x, z, H } = landing(f);
    if (H < 1) continue;
    // Big falls breathe out a cloud of spray that drifts over their pool.
    const count = Math.round(H > 2.5 ? H * 14 : H * 4);
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd() * f.width * (H > 2.5 ? 1.6 : 1.3);
      pos.push(x + Math.cos(a) * r, f.bottom + 0.05, z + Math.sin(a) * r);
      phase.push(rnd());
      size.push(0.6 + rnd() * 0.8 + H * (H > 2.5 ? 0.22 : 0.08));
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
    uniforms: { uTime: { value: 0 }, uLight: { value: 1 }, uAlpha: { value: 0.3 }, uMap: { value: glowTexture() } },
    vertexShader: mistVert,
    fragmentShader: mistFrag,
    transparent: true,
    depthWrite: false,
  });
  const mist = new THREE.Points(mistGeometry(falls), mistMat);
  mist.renderOrder = 3;
  group.add(mist);

  const boilMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uLight: { value: 1 } }]),
    vertexShader: boilVert,
    fragmentShader: boilFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const boil = new THREE.Mesh(boilGeometry(falls), boilMat);
  boil.renderOrder = 2;
  group.add(boil);

  const sprayMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLight: { value: 1 } },
    vertexShader: sprayVert,
    fragmentShader: sprayFrag,
    transparent: true,
    depthWrite: false,
  });
  const spray = new THREE.Points(sprayGeometry(falls), sprayMat);
  spray.renderOrder = 3;
  spray.frustumCulled = false;
  group.add(spray);

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
      sprayMat.uniforms.uTime.value = time;
      boilMat.uniforms.uTime.value = time;
      boilMat.uniforms.uLight.value = light;
      sprayMat.uniforms.uLight.value = light;
      mistMat.uniforms.uLight.value = light;
    },
  };
}
