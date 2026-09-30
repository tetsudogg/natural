// The untidy life of a mountain forest floor: fallen logs, big dead branches, stumps,
// roots snaking out from the trees, bamboo grass, butterbur, lilyturf, nettles and
// mushrooms. Logs, branches, nettles and weeds are photo-scanned CC0 models from
// Poly Haven (shrunk by scripts in the README); the rest is built here.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HALF, brookEdgeDist, clearingFactor, forestDensity, waterDist } from './world';
import { groundHeight, groundSlope } from './terrain';
import { fbm, mulberry32 } from './noise';
import { addWind, chunked, srgb, type Placement, type TreeSpot } from './vegetation';
import { surface } from './textures';
import { NO_REFLECT_LAYER } from './water';
import { fukiTexture, mushroomTexture, sasaTexture, MUSHROOM_CELLS } from './floortex';
import logBigUrl from './assets/models/dead_tree_trunk_02.glb?url';
import logThinUrl from './assets/models/dead_tree_trunk.glb?url';
import branchesUrl from './assets/models/dry_branches_medium_01.glb?url';
import nettleUrl from './assets/models/nettle_plant.glb?url';
import weedUrl from './assets/models/weed_plant_02.glb?url';

const UP = new THREE.Vector3(0, 1, 0);

// Ground normal, for laying things flat on a slope.
function groundNormal(x: number, z: number, out: THREE.Vector3) {
  const e = 0.6;
  const dx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const dz = groundHeight(x, z + e) - groundHeight(x, z - e);
  return out.set(-dx, 2 * e, -dz).normalize();
}

// A matrix standing on the ground at (x, z), tilted part of the way to the slope.
function onGround(x: number, z: number, yaw: number, scale: THREE.Vector3, tilt: number, sink: number) {
  const n = groundNormal(x, z, new THREE.Vector3()).lerp(UP, 1 - tilt).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, n).multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, groundHeight(x, z) - sink, z), q, scale);
}

// Is this a good bit of forest floor (not water, not a clearing, not a cliff)?
function floorOk(x: number, z: number, maxSlope = 0.9) {
  return waterDist(x, z) > 6 && clearingFactor(x, z) < 0.3 && groundSlope(x, z) < maxSlope;
}

// ---------- Procedural pieces ----------

// Roots spreading from the foot of a trunk, arching out of the soil and diving back in.
function rootsGeometry(seed: number) {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const count = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.7;
    const len = 0.9 + rnd() * 1.3;
    const pts: THREE.Vector3[] = [];
    const wig = rnd() * 6;
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const r = 0.18 + t * len;
      const side = Math.sin(t * 5 + wig) * 0.18 * t;
      // High where it leaves the trunk, then humping in and out of the ground.
      const y = 0.2 * (1 - t) ** 2 + 0.03 * Math.sin(t * 9 + wig) * t - 0.09 * t;
      pts.push(new THREE.Vector3(Math.cos(a) * r - Math.sin(a) * side, y, Math.sin(a) * r + Math.cos(a) * side));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 16, 1, 6, false);
    // Thick at the trunk, thin at the tip.
    const p = tube.attributes.position as THREE.BufferAttribute;
    const segs = 17;
    const ring = 7;
    for (let s = 0; s < segs; s++) {
      const t = s / (segs - 1);
      const c = curve.getPointAt(t);
      const r = 0.11 * (1 - t) ** 1.8 + 0.012;
      for (let j = 0; j < ring; j++) {
        const idx = s * ring + j;
        p.setXYZ(idx, c.x + (p.getX(idx) - c.x) * r, c.y + (p.getY(idx) - c.y) * r * 0.8, c.z + (p.getZ(idx) - c.z) * r);
      }
    }
    tube.computeVertexNormals();
    const uv = tube.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getY(k) * 0.3, uv.getX(k) * len * 1.5);
    parts.push(tube);
  }
  const g = mergeGeometries(parts)!;
  const cols = new Float32Array(g.attributes.position.count * 3);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    // Earthy and darker where roots meet the soil, a little moss on top.
    const y = pos.getY(i);
    const k = 0.55 + 0.45 * THREE.MathUtils.smoothstep(y, -0.02, 0.2);
    cols.set([k * 0.95, k * 0.9, k * 0.8], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

// A broken-off stump: jagged, splintered top of pale wood, bark round the sides.
function stumpGeometry(seed: number) {
  const rnd = mulberry32(seed);
  const g = new THREE.CylinderGeometry(0.3, 0.4, 0.7, 14, 4, false);
  g.translate(0, 0.35, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(p.count * 3);
  const phase = rnd() * 10;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const y = p.getY(i);
    const a = Math.atan2(z, x);
    if (y > 0.69) {
      // Splinters: the top is torn, high on one side.
      const jag = 0.12 * fbm(a * 2.5 + phase, phase, 3) + 0.14 * Math.abs(Math.sin(a * 13 + phase * 2)) * fbm(a * 4, phase + 3, 2) + 0.22 * (0.5 + 0.5 * Math.cos(a - phase));
      p.setY(i, y + jag - 0.2);
    }
    // A slight flare at the foot and uneven sides.
    const flare = 1 + 0.25 * (1 - THREE.MathUtils.smoothstep(y, 0, 0.3)) + 0.06 * Math.sin(a * 5 + phase);
    p.setX(i, x * flare);
    p.setZ(i, z * flare);
    const top = y > 0.69 ? 1 : 0;
    const moss = (1 - THREE.MathUtils.smoothstep(y, 0.05, 0.35)) * (0.5 + 0.5 * Math.cos(a - phase * 0.7));
    const c = top ? [0.8, 0.62, 0.42] : [0.46 - moss * 0.25, 0.4 - moss * 0.05, 0.33 - moss * 0.22];
    cols.set(c, i * 3);
  }
  g.computeVertexNormals();
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

// A clump of sasa (bamboo grass): thin culms with fans of long leaves near the top.
function sasaGeometry(seed: number) {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const culms = 7 + Math.floor(rnd() * 5);
  for (let c = 0; c < culms; c++) {
    const bx = (rnd() - 0.5) * 0.7;
    const bz = (rnd() - 0.5) * 0.7;
    const h = 0.55 + rnd() * 0.6;
    const lean = new THREE.Vector3((rnd() - 0.5) * 0.25, 1, (rnd() - 0.5) * 0.25).normalize();
    const top = new THREE.Vector3(bx, 0, bz).addScaledVector(lean, h);
    const stem = new THREE.CylinderGeometry(0.004, 0.006, h, 3);
    stem.translate(0, h / 2, 0);
    stem.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, lean));
    stem.translate(bx, 0, bz);
    setUv(stem, 0.5, 0.02);
    parts.push(stem);
    const leaves = 5 + Math.floor(rnd() * 3);
    for (let l = 0; l < leaves; l++) {
      const len = 0.2 + rnd() * 0.1;
      const leaf = new THREE.PlaneGeometry(0.06, len, 1, 4);
      leaf.translate(0, len / 2, 0);
      // Droop: the leaf arches down toward its tip.
      const lp = leaf.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < lp.count; i++) {
        const t = lp.getY(i) / len;
        lp.setZ(i, -t * t * len * 0.55);
      }
      leaf.rotateX(-Math.PI / 2 + 0.5 + rnd() * 0.5);
      leaf.rotateY((l / leaves) * Math.PI * 2 + rnd() * 0.6);
      const node = top.clone().addScaledVector(lean, -rnd() * 0.12);
      leaf.translate(node.x, node.y, node.z);
      const cell = Math.floor(rnd() * 4);
      const uv = leaf.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (cell + uv.getX(i)) / 4);
      parts.push(leaf);
    }
  }
  return upNormals(mergeGeometries(parts.map((g) => g.toNonIndexed()))!);
}

// A butterbur clump: a few big round leaves held on stalks, gently cupped.
function fukiGeometry(seed: number) {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 0.1 + rnd() * 0.3;
    const h = 0.25 + rnd() * 0.35;
    const r = 0.16 + rnd() * 0.12;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const stalk = new THREE.CylinderGeometry(0.006, 0.009, h, 4);
    stalk.translate(x, h / 2, z);
    setUv(stalk, 0.5, 0.35);
    parts.push(stalk);
    const leaf = new THREE.CircleGeometry(r, 18, 0, Math.PI * 2);
    leaf.rotateX(-Math.PI / 2);
    const lp = leaf.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < lp.count; k++) {
      const dist = Math.hypot(lp.getX(k), lp.getZ(k)) / r;
      lp.setY(k, dist * dist * r * 0.25 - dist * r * 0.05);
    }
    // Tip the leaf a little away from the clump's centre.
    leaf.rotateZ((rnd() - 0.5) * 0.4);
    leaf.rotateY(-a + Math.PI / 2);
    leaf.translate(x, h, z);
    parts.push(leaf);
  }
  return upNormals(mergeGeometries(parts.map((g) => g.toNonIndexed()))!);
}

// Lilyturf (yaburan / janohige): a fountain of narrow, dark, glossy leaves.
function lilyturfGeometry(seed: number) {
  const rnd = mulberry32(seed);
  const pos: number[] = [];
  const cols: number[] = [];
  const blades = 22;
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2;
    const len = 0.25 + rnd() * 0.22;
    const arch = 0.4 + rnd() * 0.6;
    const w = 0.007;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      const out = t * len * (0.35 + arch * 0.6);
      const up = len * (t - arch * t * t * 0.9);
      pts.push(new THREE.Vector3(Math.cos(a) * out, Math.max(0, up), Math.sin(a) * out));
    }
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(w);
    for (let k = 0; k < 5; k++) {
      const p0 = pts[k];
      const p1 = pts[k + 1];
      const s0 = side.clone().multiplyScalar(1 - (k / 5) * 0.8);
      const s1 = side.clone().multiplyScalar(1 - ((k + 1) / 5) * 0.8);
      const quad = [p0.clone().sub(s0), p0.clone().add(s0), p1.clone().add(s1), p0.clone().sub(s0), p1.clone().add(s1), p1.clone().sub(s1)];
      for (const q of quad) pos.push(q.x, q.y, q.z);
      const g0 = 0.55 + 0.45 * (k / 5);
      for (let q = 0; q < 6; q++) cols.push(0.1 * g0, 0.22 * g0, 0.08 * g0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return upNormals(g);
}

// Foliage lit like a leaf canopy: normals point up and out so both sides light evenly.
function upNormals(g: THREE.BufferGeometry) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i) * 0.6, 1, p.getZ(i) * 0.6).normalize();
    n.set([v.x, v.y, v.z], i * 3);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

function setUv(g: THREE.BufferGeometry, u: number, v: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
}

// ---------- Mushrooms ----------

// One mushroom: a stem and a cap, with the cap textured from one cell of the atlas.
function mushroom(cell: number, capR: number, capH: number, stemH: number, stemR: number, x = 0, z = 0, tilt = 0) {
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    prof.push(new THREE.Vector2(Math.sin(t * Math.PI * 0.5) * capR, Math.cos(t * Math.PI * 0.5) * capH));
  }
  prof.push(new THREE.Vector2(capR * 0.85, -capH * 0.12), new THREE.Vector2(stemR, -capH * 0.1));
  const cap = new THREE.LatheGeometry(prof, 12);
  // Map the cap from above onto its cell (the underside samples the pale rim).
  const p = cap.attributes.position as THREE.BufferAttribute;
  const uv = cap.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = 0.5 + (p.getX(i) / capR) * 0.48;
    const v = 0.5 + (p.getZ(i) / capR) * 0.48;
    uv.setXY(i, (cell + u) / MUSHROOM_CELLS, v);
  }
  cap.translate(0, stemH, 0);
  const stem = new THREE.CylinderGeometry(stemR * 0.85, stemR, stemH, 6);
  stem.translate(0, stemH / 2, 0);
  const suv = stem.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < suv.count; i++) suv.setXY(i, (4 + 0.2 + suv.getX(i) * 0.6) / MUSHROOM_CELLS, 0.3 + suv.getY(i) * 0.4);
  const g = mergeGeometries([cap.toNonIndexed(), stem.toNonIndexed()])!;
  g.rotateZ(tilt);
  g.translate(x, 0, z);
  return g;
}

function mushroomKinds() {
  const rnd = mulberry32(55);
  // Fly agaric: tall, red, alone.
  const agaric = mushroom(0, 0.065, 0.045, 0.13, 0.012);
  // A clump of small brown ones of different ages.
  const brown = mergeGeometries(
    Array.from({ length: 6 }, (_, i) => {
      const s = 0.6 + rnd() * 0.6;
      return mushroom(1, 0.035 * s, 0.022 * s, 0.05 + rnd() * 0.05, 0.006 * s, (rnd() - 0.5) * 0.14, (rnd() - 0.5) * 0.14, (rnd() - 0.5) * 0.4);
    }),
  )!;
  // Nameko: a tight cluster of tiny glossy orange caps.
  const nameko = mergeGeometries(
    Array.from({ length: 10 }, () => {
      const s = 0.5 + rnd() * 0.6;
      return mushroom(2, 0.02 * s, 0.014 * s, 0.015 + rnd() * 0.025, 0.004, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.6);
    }),
  )!;
  // A pair of slender white ones.
  const white = mergeGeometries([mushroom(4, 0.045, 0.03, 0.16, 0.009), mushroom(4, 0.03, 0.022, 0.1, 0.007, 0.06, 0.03, 0.2)])!;
  // Shelf fungus: layered half discs sticking out of wood (+x is away from the bark).
  const shelf = mergeGeometries(
    [0, 1, 2].map((i) => {
      const r = 0.1 - i * 0.022;
      const d = new THREE.CircleGeometry(r, 12, -Math.PI / 2, Math.PI);
      d.rotateX(-Math.PI / 2);
      const dp = d.attributes.position as THREE.BufferAttribute;
      const duv = d.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < dp.count; k++) {
        const x = dp.getX(k);
        const z = dp.getZ(k);
        dp.setY(k, 0.02 - (Math.hypot(x, z) / r) ** 2 * 0.02);
        duv.setXY(k, (3 + 0.5 + (x / r) * 0.48) / MUSHROOM_CELLS, 0.5 + (z / r) * 0.48);
      }
      d.translate(0, i * 0.08, (i - 1) * 0.04);
      return d.toNonIndexed();
    }),
  )!;
  return { agaric, brown, nameko, white, shelf };
}

// ---------- glTF models ----------

interface ModelPart {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
}

// Loads a model and returns each mesh as its own geometry, placed at the origin with
// its base on y = 0 (the scanned props sit in a row in their files).
async function loadParts(url: string, separate: boolean, flat = false): Promise<ModelPart[]> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const parts: ModelPart[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    geo.deleteAttribute('color');
    parts.push({ geo, mat: mesh.material as THREE.MeshStandardMaterial });
  });
  const center = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    const b = g.boundingBox!;
    g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    g.computeBoundingSphere();
  };
  // Lying props (logs, branches): turn the longest side along x, flat on the ground.
  const lay = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    const size = g.boundingBox!.getSize(new THREE.Vector3());
    if (size.y > size.x && size.y > size.z) g.rotateZ(Math.PI / 2);
    else if (size.z > size.x) g.rotateY(Math.PI / 2);
  };
  if (flat) parts.forEach((p) => lay(p.geo));
  if (separate) {
    parts.forEach((p) => center(p.geo));
    return parts;
  }
  const geo = mergeGeometries(parts.map((p) => p.geo))!;
  center(geo);
  return [{ geo, mat: parts[0].mat }];
}

// ---------- Placement ----------

// ?floor=x,z,yaw lines up one of everything in front of that spot (for checking).
const DEMO = (() => {
  const v = new URLSearchParams(location.search).get('floor')?.split(',').map(Number);
  if (!v || v.length < 3) return null;
  const [x, z, yaw] = v;
  return (i: number) => {
    const row = Math.floor(i / 6);
    const col = (i % 6) - 2.5;
    const f = 2 + row * 1.8;
    return [x - Math.sin(yaw) * f + Math.cos(yaw) * col * 1.0, z - Math.cos(yaw) * f - Math.sin(yaw) * col * 1.0] as const;
  };
})();

export function createForestFloor(trees: TreeSpot[]) {
  const rnd = mulberry32(777);
  const one = new THREE.Vector3(1, 1, 1);
  const group = new THREE.Group();
  const cullGroups: THREE.Object3D[] = [];
  const add = (g: THREE.Object3D) => {
    // Too small to matter in the stream's reflection.
    g.traverse((o) => o.layers.set(NO_REFLECT_LAYER));
    group.add(g);
    cullGroups.push(g);
  };
  const white = new THREE.Color(1, 1, 1);
  const tint = (lo: number, hi: number) => white.clone().multiplyScalar(lo + rnd() * (hi - lo));

  const bark = surface('bark');
  const barkMap = bark.map;
  const barkNormal = bark.normal;

  // Roots at the foot of many trees, more of them on slopes where soil washes away.
  const roots: Placement[][] = [[], []];
  for (const t of trees) {
    const slope = groundSlope(t.x, t.z);
    if (rnd() > 0.35 + slope * 0.8) continue;
    const s = (t.s ?? 1) * (0.9 + rnd() * 0.3);
    roots[Math.floor(rnd() * 2)].push({ m: onGround(t.x, t.z, rnd() * 6.28, new THREE.Vector3(s, s, s), 0.85, 0.04), c: t.cedar ? srgb(0.75, 0.55, 0.45) : tint(0.75, 1) });
  }
  if (DEMO) {
    const [x, z] = DEMO(0);
    roots[0].push({ m: onGround(x, z, 0, one, 0.85, 0.04), c: white });
  }
  const rootMat = new THREE.MeshStandardMaterial({ map: barkMap, normalMap: barkNormal, vertexColors: true, roughness: 0.95 });
  roots.forEach((list, i) => add(chunked(rootsGeometry(300 + i), rootMat, list, 50, { shadow: true, maxDist: 110 })));

  // Stumps of trees that broke long ago, some with shelf fungi.
  const stumps: Placement[] = [];
  const shelves: Placement[] = [];
  const logSpots: { x: number; z: number }[] = [];
  for (let i = 0; i < 9000 && stumps.length < 260; i++) {
    const x = (rnd() * 2 - 1) * (HALF - 8);
    const z = (rnd() * 2 - 1) * (HALF - 8);
    if (forestDensity(x, z) < 0.35 || !floorOk(x, z)) continue;
    const s = 0.6 + rnd() * 0.8;
    const yaw = rnd() * 6.28;
    stumps.push({ m: onGround(x, z, yaw, new THREE.Vector3(s, s * (0.6 + rnd() * 0.9), s), 0.3, 0.05), c: tint(0.7, 1) });
    logSpots.push({ x, z });
    if (rnd() < 0.5) {
      const a = rnd() * 6.28;
      const r = 0.38 * s;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x + Math.cos(a) * r, groundHeight(x, z) + 0.12 + rnd() * 0.25 * s, z + Math.sin(a) * r),
        new THREE.Quaternion().setFromAxisAngle(UP, -a),
        new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + rnd() * 0.8),
      );
      shelves.push({ m, c: tint(0.8, 1.05) });
    }
  }
  if (DEMO) {
    const [x, z] = DEMO(1);
    stumps.push({ m: onGround(x, z, 0, one, 0.3, 0.05), c: white });
    shelves.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x + 0.38, groundHeight(x, z) + 0.3, z), new THREE.Quaternion(), one), c: white });
  }
  const stumpMat = new THREE.MeshStandardMaterial({ map: barkMap, normalMap: barkNormal, vertexColors: true, roughness: 0.95 });
  add(chunked(stumpGeometry(41), stumpMat, stumps, 60, { shadow: true, maxDist: 160 }));

  // Shelf fungi on some tree trunks too.
  for (const t of trees) {
    if (t.cedar || rnd() > 0.06) continue;
    const a = rnd() * 6.28;
    const r = 0.3 * (t.s ?? 1);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(t.x + Math.cos(a) * r, groundHeight(t.x, t.z) + 0.3 + rnd() * 0.9, t.z + Math.sin(a) * r),
      new THREE.Quaternion().setFromAxisAngle(UP, -a),
      new THREE.Vector3(1, 1, 1).multiplyScalar(0.9 + rnd() * 0.9),
    );
    shelves.push({ m, c: tint(0.8, 1.05) });
  }

  // Ground plants.
  const sasa: Placement[][] = [[], []];
  const fuki: Placement[] = [];
  const turf: Placement[][] = [[], []];
  for (let i = 0; i < 260000; i++) {
    const x = (rnd() * 2 - 1) * (HALF - 3);
    const z = (rnd() * 2 - 1) * (HALF - 3);
    const dens = forestDensity(x, z);
    const wd = waterDist(x, z);
    if (wd < 4.8 || clearingFactor(x, z) > 0.5) continue;
    const slope = groundSlope(x, z);
    if (slope > 1.1) continue;
    const pick = rnd();
    // Sasa grows in thick colonies under the trees and over the slopes.
    const colony = THREE.MathUtils.smoothstep(fbm(x * 0.022 + 7, z * 0.022 - 3, 3), 0.45, 0.57);
    if (pick < 0.55) {
      if (rnd() > colony * (0.25 + dens * 0.75)) continue;
      const s = 0.8 + rnd() * 0.6;
      sasa[Math.floor(rnd() * 2)].push({ m: onGround(x, z, rnd() * 6.28, new THREE.Vector3(s, s * (0.8 + rnd() * 0.5), s), 0.3, 0.02), c: tint(0.8, 1.1) });
    } else if (pick < 0.7) {
      // Butterbur likes damp ground beside water.
      const brook = brookEdgeDist(x, z);
      const damp = Math.max(1 - THREE.MathUtils.smoothstep(wd, 5, 16), brook > 1 ? 1 - THREE.MathUtils.smoothstep(brook, 1.5, 8) : 0);
      if (rnd() > damp * 0.7) continue;
      const s = 0.8 + rnd() * 0.7;
      fuki.push({ m: onGround(x, z, rnd() * 6.28, new THREE.Vector3(s, s, s), 0.4, 0.01), c: tint(0.85, 1.1) });
    } else {
      // Lilyturf dots the shady forest floor.
      if (rnd() > dens * 0.35 * (1 - colony)) continue;
      const s = 0.8 + rnd() * 0.5;
      turf[Math.floor(rnd() * 2)].push({ m: onGround(x, z, rnd() * 6.28, new THREE.Vector3(s, s, s), 0.5, 0.01), c: tint(0.8, 1.15) });
    }
  }
  if (DEMO) {
    const put = (list: Placement[], i: number) => {
      const [x, z] = DEMO(i);
      list.push({ m: onGround(x, z, 0, one, 0.3, 0.01), c: white });
    };
    put(sasa[0], 2);
    put(sasa[1], 3);
    put(fuki, 4);
    put(turf[0], 5);
  }
  const sasaMat = new THREE.MeshStandardMaterial({ map: sasaTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
  addWind(sasaMat, { amount: 0.05, height: 1, foliage: true, flutter: true });
  sasa.forEach((list, i) => add(chunked(sasaGeometry(60 + i), sasaMat, list, 30, { maxDist: 75 })));
  const fukiMat = new THREE.MeshStandardMaterial({ map: fukiTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, color: srgb(0.8, 0.85, 0.75) });
  addWind(fukiMat, { amount: 0.04, height: 0.6, foliage: true, flutter: true });
  add(chunked(fukiGeometry(70), fukiMat, fuki, 30, { maxDist: 70 }));
  const turfMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
  addWind(turfMat, { amount: 0.04, height: 0.45, foliage: true, flutter: true });
  turf.forEach((list, i) => add(chunked(lilyturfGeometry(80 + i), turfMat, list, 30, { maxDist: 50 })));

  // Mushrooms: at the feet of trees, beside stumps and logs, a few out on their own.
  const kinds = mushroomKinds();
  const shrooms: Record<keyof typeof kinds, Placement[]> = { agaric: [], brown: [], nameko: [], white: [], shelf: shelves };
  const near = (x: number, z: number, r0: number, r1: number) => {
    const a = rnd() * 6.28;
    const r = r0 + rnd() * (r1 - r0);
    return [x + Math.cos(a) * r, z + Math.sin(a) * r];
  };
  const drop = (kind: 'agaric' | 'brown' | 'nameko' | 'white', x: number, z: number, s: number) => {
    if (!floorOk(x, z, 1)) return;
    shrooms[kind].push({ m: onGround(x, z, rnd() * 6.28, new THREE.Vector3(s, s, s), 0.5, 0.005), c: tint(0.85, 1.1) });
  };
  for (const t of trees) {
    if (rnd() > 0.22) continue;
    const [x, z] = near(t.x, t.z, 0.4 * (t.s ?? 1), 1.6);
    const k = rnd();
    drop(k < 0.12 ? 'agaric' : k < 0.75 ? 'brown' : 'white', x, z, 0.8 + rnd() * 0.7);
  }
  for (const sp of logSpots) {
    if (rnd() < 0.6) {
      const [x, z] = near(sp.x, sp.z, 0.35, 0.6);
      drop('nameko', x, z, 1 + rnd() * 0.6);
    }
  }
  for (let i = 0; i < 1500; i++) {
    const x = (rnd() * 2 - 1) * (HALF - 5);
    const z = (rnd() * 2 - 1) * (HALF - 5);
    if (forestDensity(x, z) < 0.3) continue;
    drop(rnd() < 0.2 ? 'agaric' : rnd() < 0.7 ? 'brown' : 'white', x, z, 0.8 + rnd() * 0.6);
  }
  if (DEMO) {
    (['agaric', 'brown', 'nameko', 'white'] as const).forEach((k, i) => {
      const [x, z] = DEMO(6 + i);
      shrooms[k].push({ m: onGround(x, z, 0, new THREE.Vector3(2, 2, 2), 0.5, 0), c: white });
    });
  }
  const shroomMat = new THREE.MeshStandardMaterial({ map: mushroomTexture(), roughness: 0.6, side: THREE.DoubleSide });
  for (const key of Object.keys(kinds) as (keyof typeof kinds)[]) add(chunked(kinds[key], shroomMat, shrooms[key], 40, { maxDist: key === 'shelf' ? 60 : 40 }));

  // The scanned props arrive a moment later.
  void (async () => {
    const [logBig, logThin, branches, nettles, weeds] = await Promise.all([
      loadParts(logBigUrl, false, true),
      loadParts(logThinUrl, false, true),
      loadParts(branchesUrl, true, true),
      loadParts(nettleUrl, true),
      loadParts(weedUrl, true),
    ]);
    const r2 = mulberry32(4242);
    const t2 = (lo: number, hi: number) => white.clone().multiplyScalar(lo + r2() * (hi - lo));

    // Fallen logs lie along the ground, following the slope end to end.
    const logs: Placement[][] = [[], []];
    const laid: { x: number; z: number }[] = [];
    for (let i = 0; i < 20000 && laid.length < 520; i++) {
      const x = (r2() * 2 - 1) * (HALF - 10);
      const z = (r2() * 2 - 1) * (HALF - 10);
      if (forestDensity(x, z) < 0.3 + r2() * 0.3 || !floorOk(x, z, 0.8)) continue;
      const big = r2() < 0.5;
      const len = big ? 4.05 * (0.9 + r2() * 0.8) : 3.05 * (1 + r2() * 1.2);
      const yaw = r2() * 6.28;
      const dx = Math.cos(yaw) * len * 0.5;
      const dz = -Math.sin(yaw) * len * 0.5;
      const h1 = groundHeight(x - dx, z - dz);
      const h2 = groundHeight(x + dx, z + dz);
      const hm = groundHeight(x, z);
      // Skip spots where the log would bridge a dip or bury itself in a hump.
      if (Math.abs(hm - (h1 + h2) / 2) > 0.25 || !floorOk(x - dx, z - dz, 1.2) || !floorOk(x + dx, z + dz, 1.2)) continue;
      const pitch = Math.atan2(h2 - h1, len);
      const sx = len / (big ? 4.05 : 3.05);
      const r = big ? 0.55 + r2() * 0.45 : 1 + r2() * 0.9;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, pitch, 'YZX')).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), r2() * 6.28));
      // Bedded into the leaf litter a little.
      const y = (h1 + h2) / 2 - (big ? 0.12 * r : 0.03 * r);
      logs[big ? 0 : 1].push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, r, r)), c: t2(0.8, 1.05) });
      laid.push({ x, z });
    }
    if (DEMO) {
      [0, 1].forEach((k) => {
        const [x, z] = DEMO(12 + k * 3);
        logs[k].push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, groundHeight(x, z), z), new THREE.Quaternion(), new THREE.Vector3(0.6, 0.8, 0.8)), c: white });
      });
    }
    // Mushrooms and moss-loving plants along the logs.
    const extra: Placement[] = [];
    for (const l of laid) {
      if (r2() < 0.5) {
        const a = r2() * 6.28;
        const x = l.x + Math.cos(a) * 0.5;
        const z = l.z + Math.sin(a) * 0.5;
        if (floorOk(x, z, 1)) extra.push({ m: onGround(x, z, r2() * 6.28, new THREE.Vector3(1, 1, 1).multiplyScalar(1 + r2() * 0.6), 0.5, 0), c: t2(0.85, 1.1) });
      }
    }
    add(chunked(kinds.nameko, shroomMat, extra, 40, { maxDist: 40 }));
    const logMats = [logBig[0].mat, logThin[0].mat];
    logMats.forEach((m) => {
      m.roughness = 0.95;
      m.color.setScalar(1.35);
    });
    add(chunked(logBig[0].geo, logMats[0], logs[0], 60, { shadow: true, maxDist: 180 }));
    add(chunked(logThin[0].geo, logMats[1], logs[1], 60, { shadow: true, maxDist: 150 }));

    // Big dead branches scattered under the trees.
    const br: Placement[][] = branches.map(() => []);
    for (let i = 0; i < 30000 && br.flat().length < 2600; i++) {
      const x = (r2() * 2 - 1) * (HALF - 5);
      const z = (r2() * 2 - 1) * (HALF - 5);
      if (r2() > forestDensity(x, z) || !floorOk(x, z)) continue;
      const s = 1.2 + r2() * 1.4;
      br[Math.floor(r2() * branches.length)].push({ m: onGround(x, z, r2() * 6.28, new THREE.Vector3(s, s, s), 1, 0.03 * s), c: t2(0.7, 1) });
    }
    if (DEMO) {
      br.forEach((list, i) => {
        const [x, z] = DEMO(10 + i * 0.5);
        list.push({ m: onGround(x, z, 0, new THREE.Vector3(1.5, 1.5, 1.5), 1, 0), c: white });
      });
    }
    branches.forEach((p) => p.mat.color.setScalar(1.3));
    branches.forEach((p, i) => add(chunked(p.geo, p.mat, br[i], 40, { shadow: true, maxDist: 90 })));

    // Nettles and other leafy weeds in the gaps and along forest edges.
    const weedParts = [...nettles, ...weeds];
    const wl: Placement[][] = weedParts.map(() => []);
    for (let i = 0; i < 90000; i++) {
      const x = (r2() * 2 - 1) * (HALF - 3);
      const z = (r2() * 2 - 1) * (HALF - 3);
      const dens = forestDensity(x, z);
      const edge = 1 - Math.abs(dens - 0.45) * 2;
      if (r2() > edge * 0.5 || !floorOk(x, z, 0.8)) continue;
      const k = Math.floor(r2() * weedParts.length);
      const nettle = k < nettles.length;
      const s = nettle ? 3.5 + r2() * 2.5 : 3 + r2() * 2;
      wl[k].push({ m: onGround(x, z, r2() * 6.28, new THREE.Vector3(s, s, s), 0.4, 0.01), c: t2(0.8, 1.1) });
    }
    if (DEMO) {
      wl.forEach((list, i) => {
        const [x, z] = DEMO(18 + i);
        list.push({ m: onGround(x, z, 0, new THREE.Vector3(4, 4, 4), 0.4, 0), c: white });
      });
    }
    const weedMats = new Set(weedParts.map((p) => p.mat));
    for (const m of weedMats) {
      m.side = THREE.DoubleSide;
      m.alphaTest = 0.5;
      addWind(m, { amount: 0.03, height: 0.25, foliage: true, flutter: true });
    }
    weedParts.forEach((p, i) => add(chunked(p.geo, p.mat, wl[i], 30, { maxDist: 60 })));
  })();

  return { group, cullGroups };
}
