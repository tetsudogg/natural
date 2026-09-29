// Branches lying on the forest floor, and a campfire built from them.
// Pick up branches with E, build a fire with B once you have five, and feed it with E.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HALF, waterDist } from './world';
import { groundHeight, groundSlope } from './terrain';
import { mulberry32 } from './noise';
import { deadLeafAtlas, fallenLeavesTexture, surface } from './textures';
import { CLEAR_GLSL, chunked, photoRock, rockGeometry, windUniforms, type Placement } from './vegetation';

// Leaves on the ground are kept out of the fire pit and from under the tent.
function clearUnderFire(shader: THREE.WebGLProgramParametersWithUniforms, margin: number) {
  shader.uniforms.uClear = windUniforms.uClear;
  shader.uniforms.uClear2 = windUniforms.uClear2;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${CLEAR_GLSL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n      transformed *= clearMask(instanceMatrix[3].xz, ${margin.toFixed(2)});`);
}

export const BRANCHES_TO_BUILD = 5;
export const PACK_MAX = 20;
const FIRE_MAX_FUEL = 8; // game hours of fuel the fire can hold
const HOURS_PER_BRANCH = 0.75; // one branch burns about 45 game minutes
const EMBER_HOURS = 1; // embers glow this long after the flames die

// ---------- Branches on the ground ----------

// A fallen branch: a crooked stick with a side twig or two.
function branchGeometry(seed: number) {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const len = 1.0 + rnd() * 0.7;
  const main = new THREE.CylinderGeometry(0.03, 0.05, len, 7, 5);
  main.rotateZ(Math.PI / 2);
  const p = main.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + Math.sin(p.getX(i) * 3 + seed) * 0.04);
  parts.push(main);
  for (let t = 0; t < 2 + Math.floor(rnd() * 2); t++) {
    const tl = 0.25 + rnd() * 0.3;
    const twig = new THREE.CylinderGeometry(0.01, 0.02, tl, 5);
    twig.translate(0, tl / 2, 0);
    twig.rotateZ(-Math.PI / 2 + 0.6 + rnd() * 0.4);
    twig.rotateY((rnd() - 0.5) * 1.2);
    twig.translate((rnd() - 0.5) * len * 0.6, 0, 0);
    parts.push(twig);
  }
  const g = mergeGeometries(parts.map((x) => x.toNonIndexed()))!;
  g.translate(0, 0.04, 0);
  return g;
}

interface Branch {
  x: number;
  z: number;
  taken: boolean;
}

// A small heap of loose dead leaves: many single leaves, tilted every which way,
// piled highest in the middle so the drift has real depth.
function leafPileGeometry(seed: number) {
  const rnd = mulberry32(seed);
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const R = 0.55;
  const H = 0.24;
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  for (let i = 0; i < 240; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.8) * R;
    const h = H * Math.pow(1 - r / R, 1.2) * rnd() + 0.01;
    const s = 0.06 + rnd() * 0.06;
    // Leaves buried deeper in the heap get less light.
    const shade = 0.6 + 0.4 * Math.min(1, h / (H * Math.pow(1 - r / R, 1.2) + 0.02));
    q.setFromEuler(e.set((rnd() - 0.5) * 1.1, rnd() * Math.PI * 2, (rnd() - 0.5) * 1.1, 'YXZ'));
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const cell = Math.floor(rnd() * 8);
    const u0 = (cell % 4) / 4;
    const v0 = 1 - Math.floor(cell / 4) / 2;
    const base = pos.length / 3;
    const corners = [
      [-0.5, -0.5, u0, v0 - 0.5],
      [0.5, -0.5, u0 + 0.25, v0 - 0.5],
      [0.5, 0.5, u0 + 0.25, v0],
      [-0.5, 0.5, u0, v0],
    ];
    for (const [x, z, cu, cv] of corners) {
      // A slight curl: the leaf's edges lift a little.
      v.set(x * s, Math.abs(x) * s * 0.25, z * s).applyQuaternion(q);
      pos.push(cx + v.x, h + v.y, cz + v.z);
      uv.push(cu, cv);
      // Lit as if facing up, so tilted leaves shade softly instead of flipping dark.
      nor.push(0, 1, 0);
      col.push(shade, shade, shade);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function createLeafPiles(spots: { x: number; z: number; r: number }[]) {
  const rnd = mulberry32(606);
  const mat = new THREE.MeshStandardMaterial({ map: deadLeafAtlas(), color: 0xffe6cc, vertexColors: true, alphaTest: 0.5, roughness: 1, envMapIntensity: 0.25, side: THREE.DoubleSide });
  // Both sides of a leaf are lit as its top, so flipped leaves don't turn grey-blue.
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
    clearUnderFire(shader, 0.9);
  };
  const kinds: Placement[][] = [[], [], []];
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  for (const p of spots) {
    n.set(groundHeight(p.x - 0.3, p.z) - groundHeight(p.x + 0.3, p.z), 0.6, groundHeight(p.x, p.z - 0.3) - groundHeight(p.x, p.z + 0.3)).normalize();
    q.setFromUnitVectors(up, n).multiply(spin.setFromAxisAngle(up, rnd() * Math.PI * 2));
    const sc = p.r * (0.8 + rnd() * 0.5);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, groundHeight(p.x, p.z) - 0.01, p.z), q, new THREE.Vector3(sc, 0.7 + rnd() * 0.6, sc));
    const v = 0.65 + rnd() * 0.3;
    kinds[Math.floor(rnd() * 3)].push({ m, c: new THREE.Color(v, v * 0.97, v * 0.92) });
  }
  const group = new THREE.Group();
  kinds.forEach((list, i) => group.add(chunked(leafPileGeometry(700 + i), mat, list, 30, { maxDist: 60 })));
  return group;
}

// Drifts of dead leaves around each fallen branch and tree foot, partly covering
// the branches so they settle into the forest floor instead of standing out.
function createLeafLitter(spots: { x: number; z: number; r: number }[]) {
  const rnd = mulberry32(505);
  const textures = [fallenLeavesTexture(61), fallenLeavesTexture(62)];
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3();
  const spin = new THREE.Quaternion();
  const col = new THREE.Color();
  textures.forEach((map, k) => {
    const mine = spots.filter((_, i) => i % 2 === k);
    const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, roughness: 0.95, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => clearUnderFire(shader, 0.8);
    const mesh = new THREE.InstancedMesh(geo, mat, mine.length);
    mine.forEach((p, i) => {
      const y = groundHeight(p.x, p.z);
      // Lie along the ground's slope.
      n.set(groundHeight(p.x - 0.3, p.z) - groundHeight(p.x + 0.3, p.z), 0.6, groundHeight(p.x, p.z - 0.3) - groundHeight(p.x, p.z + 0.3)).normalize();
      q.setFromUnitVectors(up, n).multiply(spin.setFromAxisAngle(up, rnd() * Math.PI * 2));
      const sc = p.r * (0.8 + rnd() * 0.4);
      m.compose(new THREE.Vector3(p.x, y + 0.012 + rnd() * 0.03, p.z), q, new THREE.Vector3(sc, 1, sc));
      mesh.setMatrixAt(i, m);
      const v = 0.75 + rnd() * 0.3;
      mesh.setColorAt(i, col.setRGB(v, v * 0.97, v * 0.92));
    });
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}

const chunkedChildren = (g: THREE.Group) => g.children as THREE.Group[];

// Branches have fallen from the trees, so they lie around each trunk.
function createBranches(barkMat: THREE.Material, trees: { x: number; z: number }[]) {
  const rnd = mulberry32(404);
  const list: Branch[] = [];
  for (const t of trees) {
    const n = 2 + Math.floor(rnd() * 4);
    for (let j = 0; j < n; j++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.9 + Math.pow(rnd(), 1.5) * 3;
      const x = t.x + Math.cos(a) * r;
      const z = t.z + Math.sin(a) * r;
      if (Math.abs(x) > HALF - 6 || Math.abs(z) > HALF - 6 || waterDist(x, z) < 6 || groundSlope(x, z) > 0.8) continue;
      list.push({ x, z, taken: false });
    }
  }
  // Leaves drift against each branch and gather at the foot of each tree.
  const litter: { x: number; z: number; r: number }[] = [];
  for (const b of list) {
    for (let j = 0; j < 3; j++) litter.push({ x: b.x + (rnd() - 0.5) * 1.4, z: b.z + (rnd() - 0.5) * 1.4, r: 0.6 + rnd() * 0.6 });
  }
  for (const t of trees) {
    for (let j = 0; j < 3; j++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.6 + rnd() * 1.8;
      const x = t.x + Math.cos(a) * r;
      const z = t.z + Math.sin(a) * r;
      if (waterDist(x, z) > 6) litter.push({ x, z, r: 0.8 + rnd() * 0.8 });
    }
  }
  const piles: { x: number; z: number; r: number }[] = [];
  for (const b of list) {
    // One heap against the branch, one a little way off.
    piles.push({ x: b.x + (rnd() - 0.5) * 0.5, z: b.z + (rnd() - 0.5) * 0.5, r: 1 + rnd() * 0.6 });
    piles.push({ x: b.x + (rnd() - 0.5) * 2, z: b.z + (rnd() - 0.5) * 2, r: 0.8 + rnd() * 0.6 });
  }
  for (const t of trees) {
    for (let j = 0; j < 3; j++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.5 + rnd() * 1.4;
      const x = t.x + Math.cos(a) * r;
      const z = t.z + Math.sin(a) * r;
      if (waterDist(x, z) > 6) piles.push({ x, z, r: 1 + rnd() * 0.8 });
    }
  }
  const pileGroups = chunkedChildren(createLeafPiles(piles));
  const kinds = [branchGeometry(1), branchGeometry(2), branchGeometry(3), branchGeometry(4)];
  const meshes = kinds.map((g) => new THREE.InstancedMesh(g, barkMat, list.length));
  const slot: { mesh: number; index: number }[] = [];
  const counts = [0, 0, 0, 0];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  const shades: number[] = [];
  let glowing = -1;
  list.forEach((b, i) => {
    const k = i % 4;
    const y = groundHeight(b.x, b.z);
    q.setFromEuler(e.set((rnd() - 0.5) * 0.12, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.12));
    const shade = 0.8 + rnd() * 0.35;
    shades.push(shade);
    meshes[k].setColorAt(counts[k], col.setRGB(shade, shade, shade));
    meshes[k].setMatrixAt(counts[k], m.compose(new THREE.Vector3(b.x, y, b.z), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.85 + rnd() * 0.4)));
    slot.push({ mesh: k, index: counts[k]++ });
  });
  meshes.forEach((mesh, k) => {
    mesh.count = counts[k];
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  const group = new THREE.Group();
  group.add(...meshes, createLeafLitter(litter), ...pileGroups);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  return {
    group,
    cullGroups: pileGroups,
    // The nearest branch still lying within reach, or -1.
    nearest(pos: THREE.Vector3, reach: number) {
      let best = -1;
      let bestD = reach;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.taken) continue;
        const d = Math.hypot(b.x - pos.x, b.z - pos.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    // Brighten the branch E would pick up, so it is easy to spot in the grass.
    highlight(i: number) {
      if (i === glowing) return;
      for (const [j, c] of [[glowing, 1], [i, 1.7]] as const) {
        if (j < 0) continue;
        const s = slot[j];
        meshes[s.mesh].setColorAt(s.index, col.setRGB(shades[j] * c, shades[j] * c * 0.97, shades[j] * c * 0.9));
        meshes[s.mesh].instanceColor!.needsUpdate = true;
      }
      glowing = i;
    },
    take(i: number) {
      list[i].taken = true;
      const s = slot[i];
      meshes[s.mesh].setMatrixAt(s.index, hidden);
      meshes[s.mesh].instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- Fire ----------

const FLAME_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A flame drawn from rising, stretched noise: hot white-yellow at the core,
// orange and red toward the ragged edges and tip.
const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }
`;

// A tongue of flame. Turbulent noise rushes upward through a narrowing shape, so
// the flame licks, splits and throws off wisps at the top. Colour follows the
// temperature: a white-yellow core, orange body, deep red at the ragged tips,
// and a faint blue where it leaves the wood.
const FLAME_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  uniform float uSeed;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    vec2 uv = vUv;
    float t = uTime + uSeed * 31.0;
    float x = (uv.x - 0.5) * 2.0;
    // Rising turbulence bends the flame more the higher it goes.
    float n1 = fbm(vec2(x * 1.6 + uSeed * 9.0, uv.y * 2.0 - t * 2.4));
    float n2 = fbm(vec2(x * 4.0 - uSeed * 5.0, uv.y * 5.0 - t * 4.6));
    x += ((n1 - 0.5) * 0.9 + (n2 - 0.5) * 0.35) * uv.y;
    float w = mix(0.95, 0.08, pow(uv.y, 0.65));
    float body = 1.0 - abs(x) / w;
    // Pockets of cooler gas break the flame apart as they rise.
    float holes = fbm(vec2(x * 2.5 + uSeed * 3.0, uv.y * 3.2 - t * 3.4));
    float f = body * 1.45 - uv.y * 0.85 + (holes - 0.5) * 1.1;
    f *= smoothstep(0.0, 0.1, uv.y) * smoothstep(0.0, 0.12, 1.0 - uv.y);
    float a = smoothstep(0.0, 0.22, f);
    float heat = clamp(f * 1.5, 0.0, 1.0);
    vec3 col = mix(vec3(0.55, 0.06, 0.01), vec3(1.0, 0.32, 0.04), smoothstep(0.0, 0.35, heat));
    col = mix(col, vec3(1.0, 0.68, 0.22), smoothstep(0.35, 0.7, heat));
    col = mix(col, vec3(1.0, 0.82, 0.48), smoothstep(0.75, 1.0, heat));
    col += vec3(0.08, 0.12, 0.45) * (1.0 - smoothstep(0.02, 0.14, uv.y)) * smoothstep(0.1, 0.5, body);
    a *= uPower;
    gl_FragColor = vec4(col * (0.8 + heat * 1.4) * a, a);
  }
`;

// A bed of glowing coals: dark charcoal lumps split by cracks that glow and breathe.
const COALS_VERT = /* glsl */ `
  varying vec2 vP;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vP = position.xz;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const COALS_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uGlow;
  uniform vec3 uAmbient;
  varying vec2 vP;
  varying vec3 vN;
  varying vec3 vView;
  ${NOISE_GLSL}
  vec2 cell(vec2 p) {
    // Distance to the nearest and second-nearest lump centre.
    vec2 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash(i + g), hash(i + g + 7.3));
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return vec2(d1, d2);
  }
  void main() {
    // Warp the lumps so they are irregular, not a tiled pattern.
    vec2 w = vP * 11.0 + (vec2(fbm(vP * 6.0), fbm(vP * 6.0 + 4.3)) - 0.5) * 2.2;
    vec2 c = cell(w);
    float crack = 1.0 - smoothstep(0.0, 0.06 + fbm(vP * 20.0) * 0.12, c.y - c.x);
    // Only some cracks glow at any moment.
    crack *= smoothstep(0.35, 0.65, fbm(vP * 7.0 + uTime * 0.15));
    float r = length(vP) / 0.36;
    // Hottest in the middle, breathing slowly in patches.
    float breathe = 0.55 + 0.45 * sin(uTime * 1.3 + fbm(vP * 9.0) * 12.0);
    float heat = uGlow * (1.0 - smoothstep(0.2, 0.95, r)) * breathe;
    float surface = fbm(vP * 40.0);
    vec3 charcoal = vec3(0.035, 0.03, 0.028) * (0.6 + surface * 0.8);
    // Grey ash on the cooler lumps.
    charcoal = mix(charcoal, vec3(0.2, 0.19, 0.18), smoothstep(0.5, 0.75, surface) * (1.0 - heat));
    vec3 lit = charcoal * (uAmbient + vec3(1.0, 0.45, 0.15) * uGlow * 1.5) ;
    vec3 glowCol = mix(vec3(0.7, 0.08, 0.01), vec3(1.0, 0.45, 0.08), heat);
    vec3 col = lit + glowCol * heat * (crack * 2.6 + smoothstep(0.45, 0.1, c.x) * 0.6 * surface);
    float edge = 1.0 - smoothstep(0.8, 1.0, r);
    if (edge <= 0.0) discard;
    gl_FragColor = vec4(col, edge);
  }
`;

const PARTICLE_VERT = /* glsl */ `
  attribute float seed;
  uniform float uTime;
  uniform float uPower;
  uniform float uSmoke;
  varying float vLife;
  varying float vSeed;
  void main() {
    // Each particle loops: rises from the fire, drifts, fades, and starts again.
    float life = fract(uTime * (uSmoke > 0.5 ? 0.07 : 0.45) * (0.7 + seed * 0.6) + seed * 13.7);
    vLife = life;
    vSeed = seed;
    vec3 p = position;
    float rise = uSmoke > 0.5 ? 0.9 + life * 7.0 : life * (1.4 + seed * 1.6);
    p.y += rise;
    // Wander and a steady drift with the breeze.
    p.x += sin(life * 6.0 + seed * 40.0) * (uSmoke > 0.5 ? 0.5 : 0.25) * life + life * life * (uSmoke > 0.5 ? 2.5 : 0.3);
    p.z += cos(life * 5.0 + seed * 27.0) * (uSmoke > 0.5 ? 0.5 : 0.25) * life + life * life * (uSmoke > 0.5 ? 1.6 : 0.2);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = uSmoke > 0.5 ? (0.6 + life * 3.0) : 0.03 * (1.0 - life * 0.6);
    gl_PointSize = size * 600.0 / -mv.z * (uSmoke > 0.5 ? 1.0 : uPower);
  }
`;

const SPARK_FRAG = /* glsl */ `
  uniform float uPower;
  varying float vLife;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, r) * (1.0 - vLife) * uPower;
    gl_FragColor = vec4(mix(vec3(1.0, 0.75, 0.35), vec3(1.0, 0.35, 0.08), vLife) * 3.0 * a, a);
  }
`;

const SMOKE_FRAG = /* glsl */ `
  uniform float uPower;
  uniform float uFire;
  uniform vec3 uColor;
  varying float vLife;
  varying float vSeed;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    float wisp = 0.75 + 0.25 * sin(atan(c.y, c.x) * 3.0 + vSeed * 20.0);
    float a = smoothstep(0.5 * wisp, 0.0, r) * smoothstep(0.08, 0.4, vLife) * (1.0 - vLife) * 0.14 * uPower;
    // Low smoke catches the firelight.
    vec3 col = uColor + vec3(0.25, 0.1, 0.03) * (1.0 - smoothstep(0.1, 0.5, vLife)) * uFire;
    gl_FragColor = vec4(col, a);
  }
`;

interface FireState {
  x: number;
  z: number;
  fuel: number; // game hours of flame left
  ember: number; // game hours of glowing embers left once the flames are out
}

function createFirePit() {
  const group = new THREE.Group();
  const rnd = mulberry32(77);
  // A ring of real, uneven stones, blackened with soot on the side facing the fire.
  const stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  photoRock(stoneMat);
  const stones: THREE.BufferGeometry[] = [];
  const count = 11;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
    const g = rockGeometry(900 + i, false);
    const s = 0.12 + rnd() * 0.07;
    g.scale(s * (1.1 + rnd() * 0.4), s * (0.8 + rnd() * 0.4), s);
    g.rotateY(a + (rnd() - 0.5) * 0.6);
    const ox = Math.cos(a) * (0.6 + rnd() * 0.05);
    const oz = Math.sin(a) * (0.6 + rnd() * 0.05);
    g.translate(ox, s * 0.12, oz);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const col = g.attributes.color as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      // Soot where the stone faces the fire and low down.
      const inward = -(nor.getX(v) * Math.cos(a) + nor.getZ(v) * Math.sin(a));
      const soot = THREE.MathUtils.smoothstep(inward, -0.2, 0.7) * 0.8;
      const k = col.getX(v) * (1 - soot * 0.85);
      col.setXYZ(v, k, k * 0.97, k * 0.94);
    }
    stones.push(g.index ? g.toNonIndexed() : g);
  }
  const ring = new THREE.Mesh(mergeGeometries(stones)!, stoneMat);
  ring.castShadow = true;
  ring.receiveShadow = true;
  group.add(ring);

  // Scorched earth and ash inside the ring.
  const ashCanvas = document.createElement('canvas');
  ashCanvas.width = ashCanvas.height = 256;
  const ctx = ashCanvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  grad.addColorStop(0, 'rgba(22,20,18,1)');
  grad.addColorStop(0.55, 'rgba(38,35,32,0.95)');
  grad.addColorStop(0.8, 'rgba(30,26,22,0.6)');
  grad.addColorStop(1, 'rgba(30,26,22,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const g = 70 + rnd() * 110;
    ctx.fillStyle = `rgba(${g},${g * 0.97},${g * 0.93},${0.15 + rnd() * 0.35})`;
    const r = Math.pow(rnd(), 0.7) * 100;
    const a = rnd() * Math.PI * 2;
    ctx.fillRect(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
  }
  const ashTex = new THREE.CanvasTexture(ashCanvas);
  ashTex.colorSpace = THREE.SRGBColorSpace;
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.85, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: ashTex, transparent: true, depthWrite: false, roughness: 1 }));
  ash.position.y = 0.015;
  ash.receiveShadow = true;
  group.add(ash);

  // A low heap of glowing coals in the middle.
  const coalGeo = new THREE.PlaneGeometry(0.8, 0.8, 28, 28);
  coalGeo.rotateX(-Math.PI / 2);
  {
    const p = coalGeo.attributes.position as THREE.BufferAttribute;
    const crnd = mulberry32(5);
    for (let i = 0; i < p.count; i++) {
      const r = Math.min(1, Math.hypot(p.getX(i), p.getZ(i)) / 0.4);
      p.setY(i, 0.02 + 0.07 * Math.pow(1 - r, 1.5) + crnd() * 0.012 * (1 - r));
    }
    coalGeo.computeVertexNormals();
  }
  const glow = { value: 0 };
  const coalMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uGlow: glow, uAmbient: { value: new THREE.Color(0.05, 0.05, 0.06) } },
    vertexShader: COALS_VERT,
    fragmentShader: COALS_FRAG,
    transparent: true,
  });
  const coals = new THREE.Mesh(coalGeo, coalMat);
  group.add(coals);

  // Split logs leaning together over the coals: bark outside, charred and glowing
  // cracks where the fire has eaten into them, black burnt ends.
  const woodMat = new THREE.MeshStandardMaterial({ map: surface('bark').map, normalMap: surface('bark').normal, color: 0x8a7866, roughness: 0.95 });
  woodMat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow;
    shader.uniforms.uTime = coalMat.uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float burn;\nvarying float vBurn;\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBurn = burn;\nvLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uGlow;\nuniform float uTime;\nvarying float vBurn;\nvarying vec3 vLocal;\n${NOISE_GLSL}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // Charring creeps up from the hot end in a ragged line.
          float edge = vBurn + (fbm(vLocal.xz * 30.0 + vLocal.y * 12.0) - 0.5) * 0.35;
          float char = smoothstep(0.35, 0.6, edge);
          // Charcoal splits into a checker of blocks; the cracks glow.
          vec2 q = vec2(atan(vLocal.x, vLocal.z) * 4.0, vLocal.y * 38.0);
          float n = fbm(q * 1.5);
          // Thin ridges of a noise field make a web of fine cracks.
          float rn = (noise(q * 2.0) + 0.5 * noise(q * 4.3 + 3.1)) / 1.5;
          float cracks = smoothstep(0.94, 1.0, 1.0 - abs(rn * 2.0 - 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.011, 0.01) * (0.6 + n), char);
          float hot = smoothstep(0.55, 0.95, edge) * uGlow * (0.7 + 0.3 * sin(uTime * 2.0 + n * 20.0));
          totalEmissiveRadiance += mix(vec3(0.8, 0.1, 0.01), vec3(1.0, 0.42, 0.07), hot) * hot * (0.015 + clamp(cracks, 0.0, 1.0) * 0.8);
        }`,
      );
  };
  const logs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.4;
    const l = 0.62 + rnd() * 0.2;
    const r = 0.04 + rnd() * 0.022;
    const g = new THREE.CylinderGeometry(r * 0.85, r, l, 9, 8);
    // Slightly crooked, not a perfect pipe.
    const p = g.attributes.position as THREE.BufferAttribute;
    const bend = (rnd() - 0.5) * 0.06;
    const burn = new Float32Array(p.count);
    for (let v = 0; v < p.count; v++) {
      const y = THREE.MathUtils.clamp(p.getY(v) / l + 0.5, 0, 1); // 0 at the foot, 1 at the top
      p.setX(v, p.getX(v) + Math.sin(y * Math.PI) * bend);
      // The upper end sits in the fire, so it burns most.
      burn[v] = Math.pow(y, 1.3);
    }
    g.setAttribute('burn', new THREE.BufferAttribute(burn, 1));
    g.computeVertexNormals();
    g.translate(0, l / 2, 0);
    // Lean inward so the tops meet above the coals.
    g.rotateX(-(0.62 + rnd() * 0.12));
    g.rotateY(a);
    g.translate(Math.sin(a) * 0.36, 0.03, Math.cos(a) * 0.36);
    logs.push(g.toNonIndexed());
  }
  // A couple of short lengths lying in the coals.
  for (let i = 0; i < 2; i++) {
    const l = 0.35 + rnd() * 0.1;
    const g = new THREE.CylinderGeometry(0.035, 0.04, l, 8, 4);
    const p = g.attributes.position as THREE.BufferAttribute;
    const burn = new Float32Array(p.count).fill(0.85);
    g.setAttribute('burn', new THREE.BufferAttribute(burn, 1));
    g.rotateZ(Math.PI / 2);
    g.rotateY(rnd() * Math.PI);
    g.translate((rnd() - 0.5) * 0.15, 0.07, (rnd() - 0.5) * 0.15);
    logs.push(g.toNonIndexed());
  }
  const wood = new THREE.Mesh(mergeGeometries(logs)!, woodMat);
  wood.castShadow = true;
  wood.receiveShadow = true;
  group.add(wood);

  // Flames: many tongues of different sizes, each a card turned to the camera around
  // the upright axis. A few tall ones rise from the middle; smaller ones lick along
  // the logs and coals.
  const flames = new THREE.Group();
  const flameMats: THREE.ShaderMaterial[] = [];
  for (let i = 0; i < 11; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uSeed: { value: rnd() } },
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    flameMats.push(mat);
    const big = i < 3;
    const w = big ? 0.6 + rnd() * 0.15 : 0.32 + rnd() * 0.16;
    const h = big ? 0.85 + rnd() * 0.3 : 0.35 + rnd() * 0.3;
    const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), mat);
    const a = rnd() * Math.PI * 2;
    const r = big ? rnd() * 0.08 : 0.08 + rnd() * 0.2;
    card.position.set(Math.cos(a) * r, big ? 0.06 : 0.04 + rnd() * 0.1, Math.sin(a) * r);
    card.userData.phase = rnd() * 10;
    card.renderOrder = 3;
    flames.add(card);
  }
  group.add(flames);

  // Sparks and smoke.
  const particles = (count: number, frag: string, smoke: boolean) => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([(rnd() - 0.5) * 0.35, 0.3, (rnd() - 0.5) * 0.35], i * 3);
      seed[i] = rnd();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uSmoke: { value: smoke ? 1 : 0 }, uFire: { value: 0 }, uColor: { value: new THREE.Color(0.55, 0.55, 0.55) } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.renderOrder = smoke ? 2 : 4;
    return pts;
  };
  const sparks = particles(70, SPARK_FRAG, false);
  const smoke = particles(36, SMOKE_FRAG, true);
  group.add(sparks, smoke);

  // Warm, flickering light. It stays in the scene at zero strength when there is no
  // fire, so lighting a fire never forces every material to recompile.
  const light = new THREE.PointLight(0xff8a3a, 0, 14, 1.6);
  light.position.set(0, 0.7, 0);

  return { group, light, flames, flameMats, sparks, smoke, glow, coalMat };
}

export interface CampfireSave {
  pack: number;
  fire: FireState | null;
}

export function createCampfire(saved: CampfireSave | undefined, trees: { x: number; z: number }[]) {
  const bark = surface('bark');
  const branchMat = new THREE.MeshStandardMaterial({ map: bark.map, color: 0x9c8e7e, roughness: 0.95 });
  const branches = createBranches(branchMat, trees);
  const pit = createFirePit();
  pit.group.visible = false;
  const group = new THREE.Group();
  group.add(branches.group, pit.group);
  // The light is added to the scene separately and always present.
  const light = pit.light;

  let pack = saved?.pack ?? 0;
  let fire: FireState | null = saved?.fire ?? null;
  let power = 0; // how big the flames are right now, 0..1
  let lit = 0; // flames grow for a little while after lighting
  const tmp = new THREE.Vector3();

  function placePit() {
    if (!fire) return;
    pit.group.visible = true;
    pit.group.position.set(fire.x, groundHeight(fire.x, fire.z), fire.z);
    light.position.set(fire.x, pit.group.position.y + 0.7, fire.z);
  }
  placePit();
  if (fire) lit = 1;

  return {
    group,
    cullGroups: branches.cullGroups,
    light,
    get pack() {
      return pack;
    },
    get firePosition() {
      return fire && (fire.fuel > 0 || fire.ember > 0) ? pit.group.position : null;
    },
    // Where the fire pit sits (burning or not), so plants can be kept out of it.
    get clearing() {
      return fire ? { x: fire.x, z: fire.z } : null;
    },
    get power() {
      return power;
    },
    debugGive(n: number) {
      pack = Math.min(PACK_MAX, pack + n);
    },
    // Skip the slow catch so a test frame shows full flames.
    debugBlaze() {
      lit = 1;
      power = 1;
    },
    save(): CampfireSave {
      return { pack, fire };
    },
    // What E would do from here, for the on-screen hint.
    hint(pos: THREE.Vector3): string | null {
      if (fire && fire.fuel + fire.ember > 0 && tmp.set(fire.x, 0, fire.z).distanceTo(new THREE.Vector3(pos.x, 0, pos.z)) < 2.6) {
        if (pack > 0 && fire.fuel < FIRE_MAX_FUEL - HOURS_PER_BRANCH) return 'E：枝をくべる';
        if (pack === 0) return null;
      }
      const near = pack < PACK_MAX ? branches.nearest(pos, 2.2) : -1;
      branches.highlight(near);
      if (near >= 0) return 'E：枝を拾う';
      if (pack >= BRANCHES_TO_BUILD && !(fire && fire.fuel > 0)) return 'B：焚き火を組む';
      return null;
    },
    // E: feed the fire if standing by it, otherwise pick up the nearest branch.
    interact(pos: THREE.Vector3): string | null {
      if (fire && fire.fuel + fire.ember > 0 && Math.hypot(fire.x - pos.x, fire.z - pos.z) < 2.6 && pack > 0) {
        if (fire.fuel >= FIRE_MAX_FUEL - HOURS_PER_BRANCH) return 'これ以上くべると燃えすぎます';
        pack--;
        const wasOut = fire.fuel <= 0;
        fire.fuel += HOURS_PER_BRANCH;
        fire.ember = 0;
        if (wasOut) lit = 0.4; // embers catch again
        return `枝をくべました（残り ${pack} 本）`;
      }
      if (pack >= PACK_MAX) return 'リュックがいっぱいです';
      const i = branches.nearest(pos, 2.2);
      if (i < 0) return null;
      branches.take(i);
      pack++;
      return `枝を拾いました（${pack} 本）`;
    },
    // B: build and light a fire in front of the player.
    build(pos: THREE.Vector3, yaw: number, tooClose?: (x: number, z: number) => boolean): string {
      if (fire && fire.fuel > 0) return 'もう焚き火があります（E で枝をくべる）';
      if (pack < BRANCHES_TO_BUILD) return `焚き火には枝が ${BRANCHES_TO_BUILD} 本いります（今 ${pack} 本）`;
      const x = pos.x - Math.sin(yaw) * 1.8;
      const z = pos.z - Math.cos(yaw) * 1.8;
      if (waterDist(x, z) < 6) return '水辺からもう少し離れてください';
      if (groundSlope(x, z) > 0.35) return 'もう少し平らな場所を選んでください';
      if (tooClose?.(x, z)) return 'テントから少し離してください';
      pack -= BRANCHES_TO_BUILD;
      fire = { x, z, fuel: BRANCHES_TO_BUILD * HOURS_PER_BRANCH, ember: 0 };
      lit = 0;
      placePit();
      return '焚き火に火をつけました';
    },
    // gameHours: how much game time passed this frame.
    update(time: number, dt: number, gameHours: number, camera: THREE.Camera, wind: number, daylight: number) {
      if (!fire) {
        light.intensity = 0;
        return;
      }
      const smokeU = (pit.smoke.material as THREE.ShaderMaterial).uniforms;
      smokeU.uColor.value.setScalar(0.06 + daylight * 0.5);
      smokeU.uFire.value = power;
      if (fire.fuel > 0) {
        fire.fuel = Math.max(0, fire.fuel - gameHours);
        if (fire.fuel === 0) fire.ember = EMBER_HOURS;
      } else if (fire.ember > 0) {
        fire.ember = Math.max(0, fire.ember - gameHours);
      }
      lit = Math.min(1, lit + dt / 12); // flames take a few seconds to catch
      // Big while there is plenty of fuel, dying down over the last hour.
      const flame = fire.fuel > 0 ? THREE.MathUtils.smoothstep(fire.fuel, 0, 1) * 0.75 + 0.25 : 0;
      const target = flame * THREE.MathUtils.smoothstep(lit, 0, 1);
      power += (target - power) * Math.min(1, dt * 1.5);
      const embers = fire.fuel > 0 ? 1 : fire.ember / EMBER_HOURS;

      // Face the flame cards to the camera around the upright axis.
      camera.getWorldPosition(tmp);
      pit.flames.children.forEach((c, i) => {
        c.lookAt(tmp.x, c.getWorldPosition(new THREE.Vector3()).y, tmp.z);
        const ph = c.userData.phase as number;
        const size = 0.3 + power * 0.75;
        // Each tongue grows and shrinks on its own irregular rhythm.
        const surge = 1 + 0.12 * Math.sin(time * 5.3 + ph) + 0.08 * Math.sin(time * 8.9 + ph * 2.1);
        c.scale.set(size, size * surge, size);
        c.visible = power > 0.01 && (i < 3 || power > 0.25);
      });
      for (const m of pit.flameMats) {
        m.uniforms.uTime.value = time;
        m.uniforms.uPower.value = power;
      }
      for (const p of [pit.sparks, pit.smoke]) {
        const u = (p.material as THREE.ShaderMaterial).uniforms;
        u.uTime.value = time;
        u.uPower.value = p === pit.smoke ? Math.max(power, embers * 0.5) * (0.6 + wind * 0.4) : power;
      }
      pit.sparks.visible = power > 0.05;
      pit.smoke.visible = power > 0.01 || embers > 0.02;
      pit.glow.value = Math.max(power, embers * 0.6);
      pit.coalMat.uniforms.uTime.value = time;
      pit.coalMat.uniforms.uAmbient.value.setScalar(0.02 + daylight * 0.35);
      // Flicker: a few layered wobbles so it never repeats.
      const flick = 0.82 + 0.1 * Math.sin(time * 11.3) + 0.06 * Math.sin(time * 23.7 + 1.3) + 0.05 * Math.sin(time * 5.1 + 0.4);
      light.intensity = (power * 9 + embers * 0.8) * flick;
      light.position.y = pit.group.position.y + 0.85 + power * 0.25;
    },
  };
}
