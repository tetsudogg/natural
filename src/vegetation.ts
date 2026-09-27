// Trees, bushes, grass and rocks, drawn with instancing so thousands stay cheap.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HALF, clearingFactor, forestDensity, streamDist, streamX, WATERFALL_Z } from './world';
import { groundHeight, groundSlope } from './terrain';
import { fbm, mulberry32 } from './noise';
import { foliageTexture } from './textures';

export const windUniforms = { uTime: { value: 0 }, uWind: { value: 0.5 } };

// Colours are written as they look on screen (sRGB) and converted for lighting.
export const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

// Bends vertices sideways by height above the instance's base.
// Foliage cards also keep their outward normals on both faces, so crowns shade like a volume.
function addWind(mat: THREE.Material, amount: number, stiffness: number, foliage = false) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz;
          float h = max(position.y, 0.0);
          float bend = pow(h, ${stiffness.toFixed(2)}) * ${amount.toFixed(5)} * (0.4 + uWind);
          float t = uTime;
          float w = sin(t * 1.3 + ip.x * 0.05 + ip.z * 0.07) + 0.5 * sin(t * 2.7 + ip.x * 0.2);
          transformed.x += w * bend;
          transformed.z += 0.6 * cos(t * 1.1 + ip.z * 0.06) * bend;
          ${foliage ? 'transformed += normal * 0.06 * sin(t * 3.1 + position.x * 2.0 + ip.z) * (0.3 + uWind);' : ''}
        }`,
      );
    if (foliage) {
      shader.fragmentShader = shader.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
    }
  };
  mat.customProgramCacheKey = () => `wind-${amount}-${stiffness}-${foliage}`;
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
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

const BARK = srgb(0.36, 0.29, 0.23);
const CEDAR_BARK = srgb(0.42, 0.28, 0.2);

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
  const trunk = new THREE.CylinderGeometry(0.16, 0.34, 20, 7);
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
  return { wood: colored(trunk, CEDAR_BARK), leaves: mergeGeometries(cards)! };
}

// Broadleaf tree (oak, maple): forked trunk and a rounded crown of leaf clusters.
function broadleafGeometry(seed: number): TreeParts {
  const rnd = mulberry32(seed);
  const wood: THREE.BufferGeometry[] = [];
  const trunkH = 5 + rnd() * 1.5;
  const trunk = new THREE.CylinderGeometry(0.2, 0.36, trunkH, 7);
  trunk.translate(0, trunkH / 2, 0);
  wood.push(colored(trunk, BARK));
  for (let i = 0; i < 4; i++) {
    const b = new THREE.CylinderGeometry(0.06, 0.15, 3.8, 5);
    b.translate(0, 1.9, 0);
    b.rotateZ(0.55 + rnd() * 0.35);
    b.rotateY((i / 4) * Math.PI * 2 + rnd());
    b.translate(0, trunkH - 0.8, 0);
    wood.push(colored(b, BARK));
  }
  const center = new THREE.Vector3(0, trunkH + 2.6, 0);
  const radius = new THREE.Vector3(3.6 + rnd(), 2.8, 3.6 + rnd());
  const cards: THREE.BufferGeometry[] = [];
  const count = 110;
  const hue = rnd();
  for (let i = 0; i < count; i++) {
    // Mostly near the crown's surface, some inside to fill it.
    const dir = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    const r = 0.35 + 0.65 * Math.sqrt(rnd());
    const pos = dir.clone().multiply(radius).multiplyScalar(r).add(center);
    pos.y += Math.sin(dir.x * 3 + dir.z * 2) * 0.4;
    const rot = new THREE.Euler(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI);
    const tint = srgb(0.8 + hue * 0.15 + rnd() * 0.1, 0.9 + rnd() * 0.1, 0.72 + rnd() * 0.12);
    cards.push(card(2.4 + rnd() * 1.1, pos, rot, center, radius, tint));
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

// A clump of tapered blades; bases are dark, tips are light.
function grassClumpGeometry() {
  const rnd = mulberry32(8);
  const verts: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  const blades = 5;
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2;
    const ox = (rnd() - 0.5) * 0.25;
    const oz = (rnd() - 0.5) * 0.25;
    const h = 0.7 + rnd() * 0.5;
    const lean = 0.1 + rnd() * 0.2;
    const w = 0.035 + rnd() * 0.02;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const pts = [
      [-w, 0, 0], [w, 0, 0],
      [-w * 0.6, h * 0.5, lean * 0.4], [w * 0.6, h * 0.5, lean * 0.4],
      [0, h, lean],
    ];
    const base = verts.length / 3;
    for (const [x, y, z] of pts) verts.push(ox + x * c + z * s, y, oz - x * s + z * c);
    [0.3, 0.3, 0.6, 0.6, 0.9].forEach((v) => cols.push(v, v, v));
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  // Point normals up so blades are lit like the ground and don't flicker dark.
  const normals = new Float32Array(verts.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return g;
}

// A boulder: a lumpy sphere with smooth shading.
function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const n = fbm(v.x * 1.3 + 5, v.y * 1.3 + v.z * 0.7, 3);
    v.multiplyScalar(0.75 + n * 0.5);
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3; // flatter underside
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const merged = mergeVertices(g);
  merged.computeVertexNormals();
  const cols = new Float32Array(merged.attributes.position.count * 3);
  const rnd = mulberry32(4);
  for (let i = 0; i < cols.length; i += 3) {
    const y = merged.attributes.position.getY(i / 3);
    const shade = (0.8 + rnd() * 0.2) * (0.75 + 0.25 * THREE.MathUtils.clamp(y + 0.5, 0, 1));
    cols[i] = cols[i + 1] = cols[i + 2] = shade;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return merged;
}

interface Placement {
  m: THREE.Matrix4;
  c: THREE.Color;
}

// Splits instances into square chunks so off-screen and far chunks are skipped.
function chunked(geo: THREE.BufferGeometry, mat: THREE.Material, items: Placement[], chunk: number, opts: { shadow?: boolean; maxDist?: number }) {
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

export interface TreeSpot {
  x: number;
  z: number;
}

export function createVegetation() {
  const rnd = mulberry32(2024);
  const group = new THREE.Group();
  const treeSpots: TreeSpot[] = [];

  // Trees
  const cedars: Placement[] = [];
  const broad: Placement[][] = [[], [], []];
  const bushes: Placement[] = [];
  const step = 5.5;
  for (let z = -HALF + 4; z < HALF - 4; z += step) {
    for (let x = -HALF + 4; x < HALF - 4; x += step) {
      const px = x + (rnd() - 0.5) * step * 0.9;
      const pz = z + (rnd() - 0.5) * step * 0.9;
      const dens = forestDensity(px, pz);
      const d = streamDist(px, pz);
      const slope = groundSlope(px, pz);
      // A thin line of trees along the banks, dense forest elsewhere.
      const bank = d > 7 && d < 14 ? 0.18 : 0;
      if (slope > 1.1) continue;
      if (rnd() < Math.max(dens * 0.85, bank)) {
        const cedarZone = fbm(px * 0.008 + 5, pz * 0.008, 2) > 0.5;
        const tint = new THREE.Color().setHSL(0, 0, 0.8 + rnd() * 0.2, THREE.SRGBColorSpace);
        if (cedarZone && d > 12) {
          cedars.push({ m: place(px, pz, 0.7 + rnd() * 0.7, rnd() * 6.28, 0.2), c: tint });
        } else {
          broad[Math.floor(rnd() * 3)].push({ m: place(px, pz, 0.7 + rnd() * 0.8, rnd() * 6.28, 0.2), c: tint });
        }
        treeSpots.push({ x: px, z: pz });
      } else if (rnd() < 0.25 + dens * 0.4 && d > 6 && clearingFactor(px, pz) < 0.5) {
        bushes.push({ m: place(px, pz, 0.6 + rnd() * 0.9, rnd() * 6.28, 0.1), c: new THREE.Color().setHSL(0, 0, 0.7 + rnd() * 0.3, THREE.SRGBColorSpace) });
      }
    }
  }

  const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  addWind(woodMat, 0.0005, 2);
  const leafMat = (kind: 'leaf' | 'needle', seed: number, sway = 0.0005, stiffness = 2) => {
    const m = new THREE.MeshStandardMaterial({
      map: foliageTexture(kind, seed),
      vertexColors: true,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.8,
    });
    addWind(m, sway, stiffness, true);
    return m;
  };
  const needleMat = leafMat('needle', 31);
  const broadMat = leafMat('leaf', 32);
  const addTree = (parts: TreeParts, leaves: THREE.Material, list: Placement[]) => {
    group.add(chunked(parts.wood, woodMat, list, 60, { shadow: true, maxDist: 420 }));
    group.add(chunked(parts.leaves, leaves, list, 60, { shadow: true }));
  };
  addTree(cedarGeometry(21), needleMat, cedars);
  broad.forEach((list, i) => addTree(broadleafGeometry(7 + i), broadMat, list));
  const bushMat = leafMat('leaf', 33, 0.06, 1.5);
  const bushGroup = chunked(bushGeometry(), bushMat, bushes, 50, { shadow: true, maxDist: 200 });
  group.add(bushGroup);

  // Grass
  const grass: Placement[] = [];
  const grassCandidates = 520000;
  for (let i = 0; i < grassCandidates; i++) {
    const x = (rnd() * 2 - 1) * (HALF - 3);
    const z = (rnd() * 2 - 1) * (HALF - 3);
    const d = streamDist(x, z);
    if (d < 4.2 || d > 90) continue;
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
    grass.push({ m, c: srgb(0.42, 0.56, 0.22).lerp(srgb(0.62, 0.6, 0.32), Math.max(0, dry - 0.45) * 1.5).multiplyScalar(0.85 + rnd() * 0.3) });
  }
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  addWind(grassMat, 0.12, 2);
  const grassGroup = chunked(grassClumpGeometry(), grassMat, grass, 30, { maxDist: 90 });
  group.add(grassGroup);

  // Rocks: pebbles in the stream, boulders on the banks and by the waterfall.
  const rocks: Placement[] = [];
  const addRock = (x: number, z: number, s: number, sink: number) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, groundHeight(x, z) - sink * s, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)),
      new THREE.Vector3(s * (0.8 + rnd() * 0.6), s * (0.5 + rnd() * 0.4), s * (0.8 + rnd() * 0.6)),
    );
    const moss = rnd() < 0.4;
    rocks.push({ m, c: moss ? srgb(0.42, 0.48, 0.32) : new THREE.Color().setHSL(0.08, 0.05, 0.42 + rnd() * 0.18, THREE.SRGBColorSpace) });
  };
  for (let i = 0; i < 700; i++) {
    const z = (rnd() * 2 - 1) * (HALF - 5);
    const side = rnd() < 0.5 ? -1 : 1;
    const off = rnd() * 7;
    addRock(streamX(z) + side * off, z, 0.25 + rnd() * (off < 3 ? 0.5 : 1.1), 0.35);
  }
  for (let i = 0; i < 40; i++) {
    const z = WATERFALL_Z + (rnd() - 0.5) * 10;
    addRock(streamX(z) + (rnd() - 0.5) * 12, z, 0.8 + rnd() * 1.6, 0.3);
  }
  for (let i = 0; i < 500; i++) {
    const x = (rnd() * 2 - 1) * (HALF - 5);
    const z = (rnd() * 2 - 1) * (HALF - 5);
    if (streamDist(x, z) < 5 || clearingFactor(x, z) > 0.3) continue;
    addRock(x, z, 0.3 + rnd() * rnd() * 2.5, 0.4);
  }
  const rockGeo = rockGeometry();
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const rockGroup = chunked(rockGeo, rockMat, rocks, 60, { shadow: true, maxDist: 260 });
  group.add(rockGroup);

  return { group, cullGroups: [grassGroup, bushGroup, rockGroup], treeSpots };
}
