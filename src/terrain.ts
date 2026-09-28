import * as THREE from 'three';
import { HALF, forestDensity, heightAt, streamDist } from './world';
import { fbm, lerp, smoothstep } from './noise';
import { groundDetailTexture, leafLitterTexture } from './textures';

const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

const GRAVEL = srgb(0.5, 0.48, 0.44);
const MUD = srgb(0.36, 0.32, 0.25);
const GRASS = srgb(0.32, 0.5, 0.13);
const GRASS_DRY = srgb(0.44, 0.5, 0.2);
const FOREST_FLOOR = srgb(0.22, 0.2, 0.13);
const MOSS = srgb(0.26, 0.42, 0.1);
const ROCK = srgb(0.4, 0.39, 0.36);
const FAR_FOREST = srgb(0.1, 0.24, 0.07);

function colorAt(x: number, z: number, slope: number, out: THREE.Color, far: boolean) {
  const d = streamDist(x, z);
  const n = fbm(x * 0.05 + 3, z * 0.05 - 8, 3);
  const forest = forestDensity(x, z);
  out.copy(GRASS).lerp(GRASS_DRY, smoothstep(0.45, 0.75, n) * 0.7);
  out.lerp(forest > 0.5 ? MOSS : FOREST_FLOOR, smoothstep(0.1, 0.7, forest) * lerp(0.6, 1, n));
  out.lerp(MUD, 1 - smoothstep(4.5, 7.5, d));
  out.lerp(GRAVEL, 1 - smoothstep(3.2, 5.2, d));
  out.lerp(ROCK, smoothstep(0.55, 0.95, slope));
  if (far) {
    const edge = smoothstep(HALF, HALF + 200, Math.max(Math.abs(x), Math.abs(z)));
    out.lerp(FAR_FOREST, edge * (1 - smoothstep(0.8, 1.2, slope) * 0.5));
  }
  return out;
}

function buildGrid(size: number, segs: number, far: boolean) {
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let y = heightAt(x, z);
    // The far ring tucks under the detailed centre so the two never fight.
    // 3200 / 160 puts a far vertex exactly on the centre's edge, so there is no gap.
    if (far && Math.abs(x) < HALF - 2 && Math.abs(z) < HALF - 2) y -= 30;
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);
    const slope = Math.sqrt(Math.max(0, 1 - ny * ny)) / Math.max(ny, 0.05);
    colorAt(pos.getX(i), pos.getZ(i), slope, c, far);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (!far) {
    // How much of the ground is covered by fallen leaves: most of the forest floor,
    // but not the wet banks or the open meadows.
    const litter = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const n = fbm(x * 0.07 - 4, z * 0.07 + 9, 3);
      litter[i] = smoothstep(0.25, 0.65, forestDensity(x, z)) * smoothstep(6, 11, streamDist(x, z)) * smoothstep(0.25, 0.5, n + 0.1);
    }
    geo.setAttribute('litter', new THREE.BufferAttribute(litter, 1));
  }
  return geo;
}

export function createTerrain() {
  const detail = groundDetailTexture();
  detail.repeat.set(160, 160);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: detail,
    roughness: 0.95,
    metalness: 0,
  });
  const litterTex = leafLitterTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tLitter = { value: litterTex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float litter;\nvarying float vLitter;\nvarying vec2 vGroundXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLitter = litter;\nvGroundXZ = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tLitter;\nvarying float vLitter;\nvarying vec2 vGroundXZ;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 leaves = texture2D(tLitter, vGroundXZ / 2.2).rgb * 0.8;
          diffuseColor.rgb = mix(diffuseColor.rgb, leaves, vLitter);
        }`,
      );
  };
  const main = new THREE.Mesh(buildGrid(HALF * 2, 400, false), mat);
  main.receiveShadow = true;

  const farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const far = new THREE.Mesh(buildGrid(3200, 160, true), farMat);

  const group = new THREE.Group();
  group.add(main, far);
  return group;
}

// Fast lookups on the built grid, used for placing plants and walking.
const GRID = 401;
const STEP = (HALF * 2) / (GRID - 1);
let heights: Float32Array | null = null;

function ensureHeights() {
  if (heights) return heights;
  heights = new Float32Array(GRID * GRID);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) heights[j * GRID + i] = heightAt(-HALF + i * STEP, -HALF + j * STEP);
  }
  return heights;
}

export function groundHeight(x: number, z: number) {
  const h = ensureHeights();
  const fx = Math.min(GRID - 1.001, Math.max(0, (x + HALF) / STEP));
  const fz = Math.min(GRID - 1.001, Math.max(0, (z + HALF) / STEP));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const a = h[j * GRID + i];
  const b = h[j * GRID + i + 1];
  const c = h[(j + 1) * GRID + i];
  const d = h[(j + 1) * GRID + i + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

export function groundSlope(x: number, z: number) {
  const e = STEP;
  const dx = groundHeight(x + e, z) - groundHeight(x - e, z);
  const dz = groundHeight(x, z + e) - groundHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}
