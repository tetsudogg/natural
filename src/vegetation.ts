// Trees, bushes, grass and rocks, drawn with instancing so thousands stay cheap.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HALF, brookEdgeDist, brooks, clearingFactor, forestDensity, waterDist, streamX, WATERFALL_Z } from './world';
import { groundHeight, groundSlope } from './terrain';
import { fbm, mulberry32 } from './noise';
import { NO_REFLECT_LAYER } from './water';
import { fernTexture, flowerAtlas, foliageTexture, grassAtlas, surface, FLOWER_KINDS, type FlowerKind } from './textures';

export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.5 },
  // Sun direction in view space and its colour, for light shining through leaves.
  uSunView: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  // Plants inside these circles (x, z, radius) are hidden: under the campfire and the tent.
  uClear: { value: new THREE.Vector3(0, 0, 0) },
  uClear2: { value: new THREE.Vector3(0, 0, 0) },
};

// 0 inside a cleared circle (grown by margin), 1 elsewhere.
export const CLEAR_GLSL = `
  uniform vec3 uClear;
  uniform vec3 uClear2;
  float clearMask(vec2 p, float margin) {
    float a = uClear.z > 0.0 ? step(uClear.z + margin, distance(p, uClear.xy)) : 1.0;
    float b = uClear2.z > 0.0 ? step(uClear2.z + margin, distance(p, uClear2.xy)) : 1.0;
    return a * b;
  }
`;

// Colours are written as they look on screen (sRGB) and converted for lighting.
export const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

// Wind. Gusts are a slow noise field drifting across the valley, so neighbouring plants
// move together but never in lockstep and never on a fixed beat.
// Plants bend from the base: nothing moves at the ground (or, for trees, below about the
// middle of the trunk), and the bend grows toward the tip. Big trees bend less.
export interface WindOptions {
  amount: number; // sideways movement at the tip, in metres, in a moderate breeze
  height: number; // height of the plant model (local units) where the tip is
  rigid?: number; // fraction of the height that stays still (trunks)
  foliage?: boolean; // leaves: flutter a little and glow with light from behind
  flutter?: boolean; // small plants: every stem sways on its own
  sizeDamp?: boolean; // larger instances bend less (trees)
}

const WIND_NOISE = /* glsl */ `
  float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y);
  }
`;

export function addWind(mat: THREE.Material, o: WindOptions) {
  const rigid = o.rigid ?? 0;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.uniforms.uClear = windUniforms.uClear;
    shader.uniforms.uClear2 = windUniforms.uClear2;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uWind;\n${CLEAR_GLSL}\n${WIND_NOISE}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz;
          float t = uTime;
          // 0 at the ground (or the still part of a trunk), 1 at the tip; bends as a curve.
          float k = clamp((position.y / ${o.height.toFixed(2)} - ${rigid.toFixed(2)}) / ${(1 - rigid).toFixed(2)}, 0.0, 1.0);
          k = k * k;
          float size = 1.0;
          ${o.sizeDamp ? 'size = clamp(pow(length(instanceMatrix[1].xyz), -1.5), 0.5, 1.3);' : ''}
          // Gusts roll across the land with the wind; lulls in between.
          vec2 wdir = vec2(0.8, 0.6);
          float gust = wNoise(ip.xz * 0.035 - wdir * t * 0.45) * 0.75 + wNoise(ip.xz * 0.11 - wdir * t * 1.1) * 0.35;
          gust = gust * gust * (0.35 + uWind);
          // A slow lean with the wind, plus an irregular back-and-forth.
          float own = ${o.flutter ? 'position.x * 5.3 + position.z * 4.1 + ' : ''}ip.x * 0.37 + ip.z * 0.53;
          float sway = wNoise(vec2(t * 0.9 + own * 3.1, own)) - 0.5;
          float cross = wNoise(vec2(t * 0.7 - own * 2.3, own + 17.0)) - 0.5;
          float amt = ${o.amount.toFixed(3)} * k * size;
          transformed.x += (wdir.x * (gust * 0.8 + sway * 0.9) - wdir.y * cross * 0.6) * amt;
          transformed.z += (wdir.y * (gust * 0.8 + sway * 0.9) + wdir.x * cross * 0.6) * amt;
          ${o.foliage ? `// Leaves tremble a little, more toward the tip.
          transformed += normal * ${(o.amount * 0.08).toFixed(4)} * k * (wNoise(vec2(t * 2.5 + position.x * 1.7, position.z * 1.3 + ip.z)) - 0.5) * (0.3 + uWind);` : ''}
          ${o.height < 5 ? '// Cleared ground (a campfire) has no small plants.\n          transformed *= clearMask(ip.xz, 0.0);' : ''}
        }`,
      );
    if (o.foliage) {
      shader.uniforms.uSunView = windUniforms.uSunView;
      shader.uniforms.uSunColor = windUniforms.uSunColor;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSunView;\nuniform vec3 uSunColor;')
        .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;')
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          {
            // Leaves glow when the sun is behind them.
            vec3 toFrag = normalize(-vViewPosition);
            float back = pow(max(dot(toFrag, uSunView), 0.0), 3.0);
            // Light through a leaf comes out a warmer, yellower green.
            vec3 through = diffuseColor.rgb * vec3(1.15, 1.2, 0.55);
            reflectedLight.directDiffuse += through * uSunColor * (back * 2.0 + 0.22);
          }`,
        );
    }
  };
  mat.customProgramCacheKey = () => `wind-${JSON.stringify(o)}`;
}

function colored(geo: THREE.BufferGeometry, color: THREE.Color, jitter = 0, seed = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const rnd = mulberry32(seed);
  const pos = g.attributes.position as THREE.BufferAttribute;
  if (jitter > 0) {
    // Move shared corners together so jittered shapes stay closed.
    const moved = new Map<string, THREE.Vector3>();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      let off = moved.get(key);
      if (!off) {
        off = new THREE.Vector3((rnd() - 0.5) * jitter, (rnd() - 0.5) * jitter, (rnd() - 0.5) * jitter);
        moved.set(key, off);
      }
      pos.setXYZ(i, pos.getX(i) + off.x, pos.getY(i) + off.y, pos.getZ(i) + off.z);
    }
  }
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const shade = 0.85 + rnd() * 0.3;
    colors[i * 3] = color.r * shade;
    colors[i * 3 + 1] = color.g * shade;
    colors[i * 3 + 2] = color.b * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

const BARK = srgb(0.86, 0.85, 0.8);
const TRUNK_MOSS = srgb(0.3, 0.46, 0.12);
const CEDAR_BARK = srgb(0.66, 0.46, 0.34);

// One card: a square with the leaf texture. Normals point away from the crown's centre,
// and colour darkens toward the bottom and inside of the crown (cheap ambient occlusion).
function card(size: number, pos: THREE.Vector3, rot: THREE.Euler, center: THREE.Vector3, radius: THREE.Vector3, tint: THREE.Color) {
  const g = new THREE.PlaneGeometry(size, size);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
  g.translate(pos.x, pos.y, pos.z);
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(center).divide(radius);
    const depth = Math.min(1, v.length());
    v.y += 0.35;
    v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    const ao = (0.45 + 0.55 * depth) * (0.7 + 0.3 * THREE.MathUtils.clamp((p.getY(i) - center.y) / radius.y + 0.6, 0, 1));
    colors[i * 3] = tint.r * ao;
    colors[i * 3 + 1] = tint.g * ao;
    colors[i * 3 + 2] = tint.b * ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

interface TreeParts {
  wood: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
}

// Japanese cedar: tall straight trunk, narrow conical crown of drooping sprays.
function cedarGeometry(seed: number): TreeParts {
  const rnd = mulberry32(seed);
  const trunk = new THREE.CylinderGeometry(0.16, 0.36, 20, 12);
  trunk.translate(0, 10, 0);
  const cards: THREE.BufferGeometry[] = [];
  const center = new THREE.Vector3(0, 12.5, 0);
  const radius = new THREE.Vector3(2.6, 7, 2.6);
  const layers = 13;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const y = 5.5 + t * 14;
    const r = 2.7 * Math.pow(1 - t, 0.9) + 0.35;
    const count = Math.max(3, Math.round(3 + r * 3));
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + rnd() * 0.6 + i;
      const rr = r * (0.45 + rnd() * 0.35);
      const pos = new THREE.Vector3(Math.cos(a) * rr, y + (rnd() - 0.5) * 0.6, Math.sin(a) * rr);
      const rot = new THREE.Euler(-0.9 - rnd() * 0.4, -a + Math.PI / 2, 0, 'YXZ');
      cards.push(card(r * 1.25 + 0.9, pos, rot, center, radius, srgb(0.75 + rnd() * 0.2, 0.85 + rnd() * 0.15, 0.75)));
    }
  }
  return { wood: mossyBase(colored(trunk, CEDAR_BARK), 1.4, seed), leaves: mergeGeometries(cards)! };
}

// A tapered limb from a to b.
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 6, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return colored(g, BARK);
}

// Moss creeping up the base of a trunk, thicker on one side.
function mossyBase(geo: THREE.BufferGeometry, height: number, seed: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = geo.attributes.color as THREE.BufferAttribute;
  const c = new THREE.Color();
  const side = seed * 1.7;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const reach = height * (0.55 + 0.45 * Math.cos(a - side));
    const t = 1 - THREE.MathUtils.smoothstep(pos.getY(i), reach * 0.4, reach);
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(TRUNK_MOSS, t * 0.85);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  return geo;
}

// Broadleaf tree (oak, beech, maple): a trunk that forks into limbs, each limb carrying
// a few rounded clumps of leaves. Gaps between clumps let light and sky through.
function broadleafGeometry(seed: number): TreeParts {
  const rnd = mulberry32(seed);
  const wood: THREE.BufferGeometry[] = [];
  const trunkH = 7.5 + rnd() * 3.5;
  const trunk = new THREE.CylinderGeometry(0.17, 0.34, trunkH, 12, 6);
  trunk.translate(0, trunkH / 2, 0);
  // A slight lean and bend so trunks are not ruler-straight.
  const lean = (rnd() - 0.5) * 0.08;
  const tp = trunk.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) tp.setX(i, tp.getX(i) + lean * tp.getY(i) + Math.sin(tp.getY(i) * 0.5 + seed) * 0.08);
  wood.push(mossyBase(colored(trunk, BARK), 1.6 + rnd(), seed));
  const fork = new THREE.Vector3(lean * trunkH, trunkH, 0);
  const center = new THREE.Vector3(fork.x, trunkH + 2.8, 0);
  const radius = new THREE.Vector3(4 + rnd(), 3.8, 4 + rnd());

  // Main limbs spread out and up from the fork.
  const tips: THREE.Vector3[] = [];
  const limbs = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rnd() * 0.8;
    const tip = new THREE.Vector3(Math.cos(a) * radius.x * 0.45, trunkH + 1.6 + rnd() * 1.2, Math.sin(a) * radius.z * 0.45);
    wood.push(limb(fork, tip, 0.14, 0.07));
    tips.push(tip);
  }
  const lead = new THREE.Vector3(fork.x + (rnd() - 0.5) * 0.6, trunkH + 3.6, (rnd() - 0.5) * 0.6);
  wood.push(limb(fork, lead, 0.15, 0.07));
  tips.push(lead);

  const cards: THREE.BufferGeometry[] = [];
  const hue = rnd();
  const clumps = 18;
  for (let c = 0; c < clumps; c++) {
    const dir = new THREE.Vector3(rnd() * 2 - 1, rnd() * 1.6 - 0.5, rnd() * 2 - 1).normalize();
    const cc = dir.clone().multiply(radius).multiplyScalar(0.55 + rnd() * 0.3).add(center);
    // A branch from the nearest limb tip to this clump.
    let near = tips[0];
    for (const t of tips) if (t.distanceToSquared(cc) < near.distanceToSquared(cc)) near = t;
    wood.push(limb(near, cc, 0.05, 0.02));
    const clumpR = 1.3 + rnd() * 0.6;
    const shade = 0.9 + rnd() * 0.2;
    for (let i = 0; i < 11; i++) {
      const off = new THREE.Vector3(rnd() * 2 - 1, (rnd() * 2 - 1) * 0.7, rnd() * 2 - 1).normalize().multiplyScalar(clumpR * Math.sqrt(rnd()));
      const pos = cc.clone().add(off);
      const rot = new THREE.Euler(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI);
      const tint = srgb((0.8 + hue * 0.15 + rnd() * 0.1) * shade, (0.9 + rnd() * 0.1) * shade, (0.72 + rnd() * 0.12) * shade);
      cards.push(card(1.8 + rnd() * 0.8, pos, rot, center, radius, tint));
    }
  }
  return { wood: mergeGeometries(wood)!, leaves: mergeGeometries(cards)! };
}

// Undergrowth: a low mound of leaf cards.
function bushGeometry(): THREE.BufferGeometry {
  const rnd = mulberry32(99);
  const center = new THREE.Vector3(0, 0.5, 0);
  const radius = new THREE.Vector3(0.9, 0.6, 0.9);
  const cards: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const dir = new THREE.Vector3(rnd() * 2 - 1, rnd() * 0.8, rnd() * 2 - 1).normalize();
    const pos = dir.clone().multiply(radius).multiplyScalar(0.3 + rnd() * 0.6).add(center);
    cards.push(card(1 + rnd() * 0.5, pos, new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3), center, radius, srgb(0.85, 0.95, 0.8)));
  }
  return mergeGeometries(cards)!;
}

// A grass clump: a few upright cards, each showing one photographed tuft from the
// grass atlas, turned different ways so the clump looks full from every side.
function grassClumpGeometry() {
  const rnd = mulberry32(8);
  const parts: THREE.BufferGeometry[] = [];
  for (let c = 0; c < 7; c++) {
    const h = 0.5 + rnd() * 0.5;
    const g = new THREE.PlaneGeometry(h * 0.5, h, 1, 2);
    g.translate((rnd() - 0.5) * 0.25, h / 2, 0);
    g.rotateY(rnd() * Math.PI);
    g.translate(0, 0, (rnd() - 0.5) * 0.25);
    const cell = Math.floor(rnd() * 8);
    const u0 = (cell % 4) * 0.25;
    const v0 = cell < 4 ? 0.5 : 0; // row 0 of the image is the top of the texture
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const cols = new Float32Array(uv.count * 3);
    for (let k = 0; k < uv.count; k++) {
      const t = uv.getY(k);
      uv.setXY(k, u0 + uv.getX(k) * 0.25, v0 + t * 0.5);
      cols.fill(0.7 + 0.3 * t, k * 3, k * 3 + 3); // darker where blades crowd at the base
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    // Point normals up so blades are lit like the ground and don't flicker dark.
    const n = g.attributes.normal as THREE.BufferAttribute;
    for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

// Rocks are textured with photos projected from three sides in world space
// (no stretched seams on the lumpy shapes), stone below and moss where 'moss' says.
export function photoRock(mat: THREE.MeshStandardMaterial) {
  const rock = surface('rock');
  const moss = surface('moss');
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tRock: { value: rock.map },
      tRockN: { value: rock.normal },
      tMoss: { value: moss.map },
      tMossN: { value: moss.normal },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float moss;\nvarying float vMoss;\nvarying vec3 vRockW;\nvarying vec3 vRockN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 rw = vec4(transformed, 1.0);
          vec3 rn = objectNormal;
          #ifdef USE_INSTANCING
            rw = instanceMatrix * rw;
            rn = mat3(instanceMatrix) * rn;
          #endif
          vRockW = (modelMatrix * rw).xyz;
          vRockN = normalize(mat3(modelMatrix) * rn);
          vMoss = moss;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D tRock;\nuniform sampler2D tRockN;\nuniform sampler2D tMoss;\nuniform sampler2D tMossN;\nvarying float vMoss;\nvarying vec3 vRockW;\nvarying vec3 vRockN;',
      )
      .replace(
        '#include <map_fragment>',
        `vec3 rockWN;
        {
          vec3 N = normalize(vRockN);
          vec3 bw = pow(abs(N), vec3(4.0));
          bw /= bw.x + bw.y + bw.z;
          vec3 P = vRockW * 0.45;
          vec3 stone = texture2D(tRock, P.zy).rgb * bw.x + texture2D(tRock, P.xz).rgb * bw.y + texture2D(tRock, P.xy).rgb * bw.z;
          vec3 Q = vRockW * 0.6;
          vec3 green = texture2D(tMoss, Q.zy).rgb * bw.x + texture2D(tMoss, Q.xz).rgb * bw.y + texture2D(tMoss, Q.xy).rgb * bw.z;
          // Ragged moss edges: the moss photo's own brightness decides where it stops.
          float m = smoothstep(0.35, 0.6, vMoss + (dot(green, vec3(0.33)) - 0.35) * 0.8);
          diffuseColor.rgb *= mix(stone, green, m);
          // Whiteout-blended normal maps, one per projection.
          vec3 tx = mix(texture2D(tRockN, P.zy).xyz, texture2D(tMossN, Q.zy).xyz, m) * 2.0 - 1.0;
          vec3 ty = mix(texture2D(tRockN, P.xz).xyz, texture2D(tMossN, Q.xz).xyz, m) * 2.0 - 1.0;
          vec3 tz = mix(texture2D(tRockN, P.xy).xyz, texture2D(tMossN, Q.xy).xyz, m) * 2.0 - 1.0;
          tx = vec3(tx.xy + N.zy, abs(tx.z) * N.x);
          ty = vec3(ty.xy + N.xz, abs(ty.z) * N.y);
          tz = vec3(tz.xy + N.xy, abs(tz.z) * N.z);
          rockWN = normalize(tx.zyx * bw.x + ty.xzy * bw.y + tz * bw.z);
        }`,
      )
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(rockWN, 0.0)).xyz);');
  };
}

// A boulder: a lumpy sphere cut by a few flat fracture planes, with a flat underside.
// Mossy rocks get moss on their upward-facing parts ('moss' attribute).
export function rockGeometry(seed: number, mossy: boolean) {
  const rnd = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const cuts = Array.from({ length: 4 }, () => ({
    n: new THREE.Vector3(rnd() * 2 - 1, rnd() * 1.2 - 0.2, rnd() * 2 - 1).normalize(),
    d: 0.55 + rnd() * 0.3,
  }));
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const n = fbm(v.x * 1.6 + seed, v.y * 1.6 + v.z * 0.9, 4);
    v.multiplyScalar(0.8 + n * 0.45);
    for (const c of cuts) {
      const over = v.dot(c.n) - c.d;
      if (over > 0) v.addScaledVector(c.n, -over * 0.9);
    }
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.25;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const merged = mergeVertices(g, 1e-3);
  merged.computeVertexNormals();
  const count = merged.attributes.position.count;
  const nrm = merged.attributes.normal as THREE.BufferAttribute;
  const pos = merged.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(count * 3);
  const moss = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const up = nrm.getY(i);
    const ao = 0.7 + 0.3 * THREE.MathUtils.clamp(pos.getY(i) + 0.4, 0, 1);
    cols.fill(ao, i * 3, i * 3 + 3);
    moss[i] = mossy ? THREE.MathUtils.smoothstep(up, -0.1, 0.55) * (0.7 + 0.3 * fbm(pos.getX(i) * 3, pos.getZ(i) * 3, 2)) : 0;
  }
  merged.setAttribute('moss', new THREE.BufferAttribute(moss, 1));
  merged.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return merged;
}

// A water-worn cobble: a low-poly, smooth, slightly flattened pebble.
function cobbleGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.85 + 0.25 * fbm(x * 1.3 + 4, y * 1.3 + z, 2);
    p.setXYZ(i, x * k, Math.max(y * k, -0.3), z * k);
  }
  const merged = mergeVertices(g, 1e-3);
  merged.computeVertexNormals();
  const count = merged.attributes.position.count;
  merged.setAttribute('moss', new THREE.BufferAttribute(new Float32Array(count), 1));
  merged.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  return merged;
}

// Wildflowers: two crossed cards showing one quarter of the flower atlas.
function flowerGeometry(kind: FlowerKind) {
  const u0 = (kind % 4) * 0.25;
  const v0 = kind < 4 ? 0.5 : 0; // canvas row 0 is the top of the texture
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(0.6, 0.6);
    g.translate(0, 0.3, 0);
    g.rotateY((i * Math.PI) / 3);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * 0.25, v0 + uv.getY(k) * 0.5);
    const n = g.attributes.normal as THREE.BufferAttribute;
    for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

// A fern: fronds arching out and down from the centre.
function fernGeometry() {
  const rnd = mulberry32(61);
  const parts: THREE.BufferGeometry[] = [];
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const len = 0.9 + rnd() * 0.4;
    const g = new THREE.PlaneGeometry(0.45, len, 1, 4);
    g.translate(0, len / 2, 0);
    const p = g.attributes.position as THREE.BufferAttribute;
    // Arch: the frond leaves the ground steeply and bends outward toward its tip.
    const arc = (t: number) => {
      let y = 0;
      let z = 0;
      const steps = 20;
      for (let k = 0; k < steps; k++) {
        const ang = 0.3 + ((k + 0.5) / steps) * t * 1.1;
        y += (Math.cos(ang) * len * t) / steps;
        z += (Math.sin(ang) * len * t) / steps;
      }
      return [y, z];
    };
    for (let k = 0; k < p.count; k++) {
      const [y, z] = arc(p.getY(k) / len);
      p.setXYZ(k, p.getX(k), y, z);
    }
    g.rotateY((i / fronds) * Math.PI * 2 + rnd() * 0.5);
    const n = g.attributes.normal as THREE.BufferAttribute;
    for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

export interface Placement {
  m: THREE.Matrix4;
  c: THREE.Color;
}

// Splits instances into square chunks so off-screen and far chunks are skipped.
export function chunked(geo: THREE.BufferGeometry, mat: THREE.Material, items: Placement[], chunk: number, opts: { shadow?: boolean; maxDist?: number }) {
  const group = new THREE.Group();
  const buckets = new Map<string, Placement[]>();
  const p = new THREE.Vector3();
  for (const it of items) {
    p.setFromMatrixPosition(it.m);
    const key = `${Math.floor(p.x / chunk)},${Math.floor(p.z / chunk)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(it);
  }
  for (const [key, list] of buckets) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      mesh.setColorAt(i, it.c);
    });
    mesh.castShadow = !!opts.shadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    const [cx, cz] = key.split(',').map(Number);
    mesh.userData.center = new THREE.Vector3((cx + 0.5) * chunk, 0, (cz + 0.5) * chunk);
    mesh.userData.maxDist = opts.maxDist ?? Infinity;
    group.add(mesh);
  }
  return group;
}

// Hides chunks that are farther than their draw distance.
export function updateDistanceCulling(group: THREE.Object3D, camPos: THREE.Vector3) {
  for (const child of group.children) {
    const c = child.userData.center as THREE.Vector3 | undefined;
    if (!c) continue;
    const dx = c.x - camPos.x;
    const dz = c.z - camPos.z;
    child.visible = dx * dx + dz * dz < child.userData.maxDist * child.userData.maxDist;
  }
}

function place(x: number, z: number, scale: number, yaw: number, sink = 0) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  m.compose(new THREE.Vector3(x, groundHeight(x, z) - sink, z), q, new THREE.Vector3(scale, scale, scale));
  return m;
}

// Where a rock lies, and roughly how far it reaches.
export interface RockSpot {
  x: number;
  z: number;
  r: number;
}

export interface TreeSpot {
  x: number;
  z: number;
  s?: number; // size of the tree (1 = trunk about 0.34 m in radius at the foot)
  cedar?: boolean;
}

export function createVegetation() {
  const rnd = mulberry32(2024);
  const group = new THREE.Group();
  const treeSpots: TreeSpot[] = [];

  // Trees
  const cedars: Placement[] = [];
  const broad: Placement[][] = [[], [], []];
  const bushes: Placement[] = [];
  const saplings: Placement[] = [];
  const step = 5.5;
  for (let z = -HALF + 4; z < HALF - 4; z += step) {
    for (let x = -HALF + 4; x < HALF - 4; x += step) {
      const px = x + (rnd() - 0.5) * step * 0.9;
      const pz = z + (rnd() - 0.5) * step * 0.9;
      const dens = forestDensity(px, pz);
      const d = waterDist(px, pz);
      const slope = groundSlope(px, pz);
      // A thin line of trees along the banks, dense forest elsewhere.
      const bank = d > 7 && d < 14 ? 0.18 : 0;
      if (slope > 1.1 || d < 5.5) continue;
      if (rnd() < Math.max(dens * 0.85, bank)) {
        const cedarZone = fbm(px * 0.008 + 5, pz * 0.008, 2) > 0.6;
        const tint = new THREE.Color().setHSL(0, 0, 0.8 + rnd() * 0.2, THREE.SRGBColorSpace);
        const cedar = cedarZone && d > 12;
        const size = 0.7 + rnd() * (cedar ? 0.7 : 0.8);
        if (cedar) {
          cedars.push({ m: place(px, pz, size, rnd() * 6.28, 0.2), c: tint });
        } else {
          broad[Math.floor(rnd() * 3)].push({ m: place(px, pz, size, rnd() * 6.28, 0.2), c: tint });
        }
        treeSpots.push({ x: px, z: pz, s: size, cedar });
      } else if (dens > 0.35 && d > 8 && rnd() < 0.35) {
        // Young trees fill the space under the canopy.
        saplings.push({ m: place(px + (rnd() - 0.5) * 2, pz + (rnd() - 0.5) * 2, 0.28 + rnd() * 0.2, rnd() * 6.28, 0.1), c: new THREE.Color().setHSL(0, 0, 0.85 + rnd() * 0.15, THREE.SRGBColorSpace) });
      } else if (rnd() < 0.3 + dens * 0.5 && d > 6 && clearingFactor(px, pz) < 0.5) {
        bushes.push({ m: place(px, pz, 0.6 + rnd() * 0.9, rnd() * 6.28, 0.1), c: new THREE.Color().setHSL(0, 0, 0.7 + rnd() * 0.3, THREE.SRGBColorSpace) });
      }
    }
  }

  const bark = surface('bark');
  bark.map.repeat.set(1, 4);
  bark.normal.repeat.set(1, 4);
  const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: bark.map, normalMap: bark.normal, roughness: 0.95 });
  // Trees: the lower half of the trunk stays still; the crown moves a little.
  const TREE_WIND: WindOptions = { amount: 0.2, height: 16, rigid: 0.45, sizeDamp: true };
  addWind(woodMat, TREE_WIND);
  const leafMat = (kind: 'leaf' | 'needle' | 'maple', seed: number, wind: WindOptions = TREE_WIND) => {
    const m = new THREE.MeshStandardMaterial({
      map: foliageTexture(kind, seed),
      vertexColors: true,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.8,
    });
    addWind(m, { ...wind, foliage: true });
    return m;
  };
  const needleMat = leafMat('needle', 31);
  const broadMat = leafMat('leaf', 32);
  const mapleMat = leafMat('maple', 34);
  const addTree = (parts: TreeParts, leaves: THREE.Material, list: Placement[]) => {
    group.add(chunked(parts.wood, woodMat, list, 60, { shadow: true, maxDist: 420 }));
    group.add(chunked(parts.leaves, leaves, list, 60, { shadow: true }));
  };
  addTree(cedarGeometry(21), needleMat, cedars);
  broad.forEach((list, i) => addTree(broadleafGeometry(7 + i), i === 2 ? mapleMat : broadMat, list));
  const sapling = broadleafGeometry(11);
  group.add(chunked(sapling.leaves, broadMat, saplings, 50, { shadow: true, maxDist: 220 }));
  group.add(chunked(sapling.wood, woodMat, saplings, 50, { maxDist: 160 }));
  const bushMat = leafMat('leaf', 33, { amount: 0.08, height: 1.6, rigid: 0.1 });
  const bushGroup = chunked(bushGeometry(), bushMat, bushes, 50, { shadow: true, maxDist: 200 });
  group.add(bushGroup);

  // Grass
  const grass: Placement[] = [];
  const grassCandidates = 800000;
  for (let i = 0; i < grassCandidates; i++) {
    const x = (rnd() * 2 - 1) * (HALF - 3);
    const z = (rnd() * 2 - 1) * (HALF - 3);
    const d = waterDist(x, z);
    if (d < 4.2 || d > 110) continue;
    const open = 1 - forestDensity(x, z);
    if (rnd() > open * open * (d < 30 ? 1 : 0.5)) continue;
    if (groundSlope(x, z) > 0.6) continue;
    const s = 0.35 + rnd() * 0.5;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, groundHeight(x, z) - 0.02, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28),
      new THREE.Vector3(1, s, 1),
    );
    const dry = fbm(x * 0.05 + 3, z * 0.05 - 8, 2);
    // The tuft photos carry the colour; instances only nudge it drier or brighter.
    grass.push({ m, c: srgb(1, 1, 1).lerp(srgb(1.1, 1.0, 0.8), Math.max(0, dry - 0.45) * 1.5).multiplyScalar(0.9 + rnd() * 0.3) });
  }
  const grassMat = new THREE.MeshStandardMaterial({ map: grassAtlas(), vertexColors: true, alphaTest: 0.45, roughness: 0.85, side: THREE.DoubleSide });
  addWind(grassMat, { amount: 0.1, height: 1, foliage: true, flutter: true });
  const grassGroup = chunked(grassClumpGeometry(), grassMat, grass, 30, { maxDist: 90 });
  group.add(grassGroup);

  // Rocks: pebbles in the stream, boulders on the banks and by the waterfall.
  const rocks: Placement[][] = [[], [], [], []];
  const rockSpots: RockSpot[] = [];
  const addRock = (x: number, z: number, s: number, sink: number) => {
    rockSpots.push({ x, z, r: s * 1.3 });
    const m = new THREE.Matrix4().compose(
      // On a slope the downhill side would hang in the air: bed the rock in deeper.
      new THREE.Vector3(x, groundHeight(x, z) - sink * s - Math.min(1.2, groundSlope(x, z)) * s * 0.7, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.4, rnd() * 6.28, (rnd() - 0.5) * 0.4)),
      new THREE.Vector3(s * (0.8 + rnd() * 0.6), s * (0.55 + rnd() * 0.4), s * (0.8 + rnd() * 0.6)),
    );
    // Rocks away from the water are more often mossy.
    const wet = waterDist(x, z) < 4;
    const shape = Math.floor(rnd() * 2) + (rnd() < (wet ? 0.6 : 0.8) ? 2 : 0);
    rocks[shape].push({ m, c: new THREE.Color().setHSL(0.08, 0.06, 0.75 + rnd() * 0.25, THREE.SRGBColorSpace) });
  };
  for (let i = 0; i < 700; i++) {
    const z = (rnd() * 2 - 1) * (HALF - 5);
    const side = rnd() < 0.5 ? -1 : 1;
    const off = rnd() * 7;
    addRock(streamX(z) + side * off, z, 0.25 + rnd() * (off < 3 ? 0.5 : 1.1), 0.35);
  }
  // Big mossy boulders standing in the current, the water breaking white around them.
  for (let i = 0; i < 160; i++) {
    const z = (rnd() * 2 - 1) * (HALF - 5);
    addRock(streamX(z) + (rnd() - 0.5) * 9, z, 0.7 + rnd() * 1.3, 0.35);
  }
  for (let i = 0; i < 40; i++) {
    const z = WATERFALL_Z + (rnd() - 0.5) * 10;
    addRock(streamX(z) + (rnd() - 0.5) * 12, z, 0.8 + rnd() * 1.6, 0.3);
  }
  for (let i = 0; i < 500; i++) {
    const x = (rnd() * 2 - 1) * (HALF - 5);
    const z = (rnd() * 2 - 1) * (HALF - 5);
    if (waterDist(x, z) < 5 || clearingFactor(x, z) > 0.3) continue;
    addRock(x, z, 0.3 + rnd() * rnd() * 2.5, 0.4);
  }
  // The brooks: a bed of rounded cobbles and gravel, a few stones breaking the surface,
  // big mossy boulders on the banks, and rocks framing the lip of every small fall.
  const cobbles: Placement[] = [];
  const cobbleTint = [srgb(0.95, 0.95, 0.93), srgb(0.78, 0.8, 0.82), srgb(1.05, 0.9, 0.72), srgb(0.95, 0.72, 0.55), srgb(0.6, 0.62, 0.62)];
  const addCobble = (x: number, z: number, s: number) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, groundHeight(x, z) - s * 0.25, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.5, rnd() * 6.28, (rnd() - 0.5) * 0.5)),
      new THREE.Vector3(s * (0.9 + rnd() * 0.6), s * (0.45 + rnd() * 0.3), s * (0.8 + rnd() * 0.4)),
    );
    cobbles.push({ m, c: cobbleTint[Math.floor(rnd() * cobbleTint.length)].clone().multiplyScalar(0.8 + rnd() * 0.35) });
  };
  for (const b of brooks()) {
    const n = b.x.length;
    for (let k = 2; k < n; k++) {
      const tx = b.x[Math.min(n - 1, k + 1)] - b.x[k - 1];
      const tz = b.z[Math.min(n - 1, k + 1)] - b.z[k - 1];
      const l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l;
      const nz = tx / l;
      const w = b.width[k];
      // Gravel bars spill out over the banks in places.
      const bar = 0.6 + 2.2 * Math.max(0, fbm(k * 0.09, b.x[0] * 0.1, 2) - 0.4);
      for (let i = 0; i < 16; i++) {
        const o = (rnd() - 0.5) * 2 * (w + bar);
        const along = rnd() - 0.5;
        addCobble(b.x[k] + nx * o + (tx / l) * along, b.z[k] + nz * o + (tz / l) * along, 0.05 + rnd() * rnd() * 0.22);
      }
      if (rnd() < 0.3) {
        const o = (rnd() - 0.5) * 2 * w;
        addRock(b.x[k] + nx * o, b.z[k] + nz * o, 0.18 + rnd() * rnd() * 0.45, 0.4);
      }
      for (const side of [-1, 1]) {
        if (rnd() < 0.4) {
          const o = side * (w + 0.4 + rnd() * rnd() * 3);
          const x = b.x[k] + nx * o;
          const z = b.z[k] + nz * o;
          // Big boulders only where the bank is not too steep to hold them.
          const big = groundSlope(x, z) < 0.7 ? 1.6 : 0.5;
          addRock(x, z, 0.35 + rnd() * rnd() * big, 0.3);
        }
      }
    }
    for (const f of b.falls) {
      const H = f.top - f.bottom;
      const sx = -f.dirZ;
      const sz = f.dirX;
      const lx = f.x - f.dirX * 0.5;
      const lz = f.z - f.dirZ * 0.5;
      // Rocks on both sides of the lip squeeze the water into the fall.
      for (const side of [-1, 1]) {
        for (let i = 0; i < 2; i++) {
          const o = side * (f.width + 0.25 + rnd() * 0.5 + i * 0.6);
          addRock(lx + sx * o - f.dirX * (0.2 + rnd() * 0.6), lz + sz * o - f.dirZ * (0.2 + rnd() * 0.6), 0.45 + rnd() * 0.35 + H * 0.12, 0.35);
        }
        // and a block down the face of the step beside the water.
        const o = side * (f.width + 0.4 + rnd() * 0.4);
        // (below a tall fall it rests on the pool floor instead, not halfway up the cliff)
        if (H > 2.5) addRock(f.x + f.dirX * 1.2 + sx * (o + side * 0.6), f.z + f.dirZ * 1.2 + sz * (o + side * 0.6), 0.5 + H * 0.12, 0.4);
        else addRock(f.x + sx * o, f.z + sz * o, 0.4 + H * 0.2, 0.4);
      }
      // A stone or two sitting in the pool below.
      for (let i = 0; i < 2; i++) {
        const o = (rnd() - 0.5) * 2 * f.width;
        addRock(f.x + f.dirX * (1.5 + rnd() * 2) + sx * o, f.z + f.dirZ * (1.5 + rnd() * 2) + sz * o, 0.2 + rnd() * 0.3, 0.45);
      }
    }
  }
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  photoRock(rockMat);
  const rockGroups = rocks.map((list, i) => chunked(rockGeometry(40 + (i % 2) * 7, i >= 2), rockMat, list, 60, { shadow: true, maxDist: 260 }));
  group.add(...rockGroups);
  const cobbleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  photoRock(cobbleMat);
  const cobbleGroup = chunked(cobbleGeometry(), cobbleMat, cobbles, 30, { maxDist: 55 });
  group.add(cobbleGroup);

  // Wildflowers grow in drifts on open ground; each kind prefers its own patches.
  // Size, how many, and where differ by kind (silver grass is tall; clover is low and common).
  const kindScale = [1, 1, 1.1, 0.8, 1, 1.6, 2.6, 0.55];
  const kindWeight = [1, 1, 0.8, 0.8, 0.7, 0.6, 0.45, 1.3];
  const flowers: Placement[][] = Array.from({ length: FLOWER_KINDS }, () => []);
  for (let i = 0; i < 520000; i++) {
    const x = (rnd() * 2 - 1) * (HALF - 3);
    const z = (rnd() * 2 - 1) * (HALF - 3);
    const d = waterDist(x, z);
    if (d < 4.5 || d > 120) continue;
    const kind = Math.floor(rnd() * FLOWER_KINDS) as FlowerKind;
    const patch = fbm(x * 0.035 + kind * 31, z * 0.035 - kind * 17, 2);
    const open = 1 - forestDensity(x, z);
    const wetLover = kind === 3 ? 1 - THREE.MathUtils.smoothstep(d, 6, 25) : 1; // dayflowers near water
    const chance = THREE.MathUtils.smoothstep(patch, 0.48, 0.62) * open * wetLover * kindWeight[kind];
    if (rnd() > chance + clearingFactor(x, z) * 0.06) continue;
    if (groundSlope(x, z) > 0.55) continue;
    const s = kindScale[kind] * (0.85 + rnd() * 0.4);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, groundHeight(x, z) - 0.03, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28),
      new THREE.Vector3(s, s, s),
    );
    flowers[kind].push({ m, c: new THREE.Color().setHSL(0, 0, 0.85 + rnd() * 0.15, THREE.SRGBColorSpace) });
  }
  const flowerMat = new THREE.MeshStandardMaterial({ map: flowerAtlas(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  addWind(flowerMat, { amount: 0.07, height: 0.6, foliage: true, flutter: true });
  const flowerGroups = flowers.map((list, k) => chunked(flowerGeometry(k as FlowerKind), flowerMat, list, 30, { maxDist: 75 }));
  group.add(...flowerGroups);

  // Ferns cover the forest floor and shady banks.
  const ferns: Placement[] = [];
  for (let i = 0; i < 120000; i++) {
    const x = (rnd() * 2 - 1) * (HALF - 3);
    const z = (rnd() * 2 - 1) * (HALF - 3);
    const dens = forestDensity(x, z);
    const brookBank = brookEdgeDist(x, z);
    const damp = brookBank > 1.2 ? 1 - THREE.MathUtils.smoothstep(brookBank, 1, 9) : 0;
    if (brookBank < 1.2 || rnd() > Math.max(THREE.MathUtils.smoothstep(dens, 0.2, 0.7) * 0.5, damp * 0.9)) continue;
    if (waterDist(x, z) < 4.5) continue;
    if (groundSlope(x, z) > (damp > 0 ? 1.4 : 0.8)) continue;
    const s = 0.6 + rnd() * 0.7;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, groundHeight(x, z) - 0.05, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28),
      new THREE.Vector3(s, s, s),
    );
    ferns.push({ m, c: new THREE.Color().setHSL(0.26, 0.5, 0.4 + rnd() * 0.15, THREE.SRGBColorSpace) });
  }
  const fernMat = new THREE.MeshStandardMaterial({ map: fernTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
  addWind(fernMat, { amount: 0.06, height: 1.2, foliage: true, flutter: true });
  const fernGroup = chunked(fernGeometry(), fernMat, ferns, 30, { maxDist: 85, shadow: false });
  group.add(fernGroup);

  // Small plants are left out of the water reflection.
  for (const g of [grassGroup, bushGroup, fernGroup, ...flowerGroups]) g.traverse((o) => o.layers.set(NO_REFLECT_LAYER));

  return { group, cullGroups: [grassGroup, bushGroup, fernGroup, cobbleGroup, ...rockGroups, ...flowerGroups], treeSpots, rockSpots };
}
