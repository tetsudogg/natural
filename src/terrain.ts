import * as THREE from 'three';
import { HALF, forestDensity, heightAt, waterDist } from './world';
import { fbm, lerp, smoothstep } from './noise';
import { surface } from './textures';

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
  const d = waterDist(x, z);
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
    // The detailed ground is painted with photo textures. Each layer covers the ones
    // before it: meadow grass, then fallen leaves, moss, stream gravel and bare rock.
    // 'splat' holds how much of each covering layer shows; the vertex colour becomes a
    // gentle tint that keeps large areas from looking tiled.
    const splat = new Float32Array(pos.count * 4);
    const layer = [0, 0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const ny = nrm.getY(i);
      const slope = Math.sqrt(Math.max(0, 1 - ny * ny)) / Math.max(ny, 0.05);
      const d = waterDist(x, z);
      const forest = forestDensity(x, z);
      const n = fbm(x * 0.07 - 4, z * 0.07 + 9, 3);
      const m = fbm(x * 0.11 + 17, z * 0.11 - 5, 3);
      const cover = [
        smoothstep(0.25, 0.65, forest) * smoothstep(6, 11, d) * smoothstep(0.25, 0.5, n + 0.1),
        Math.max(smoothstep(0.45, 0.85, forest) * smoothstep(0.5, 0.68, m), (1 - smoothstep(5, 8, d)) * smoothstep(0.45, 0.6, m) * 0.9),
        1 - smoothstep(3.2, 5.2, d),
        smoothstep(0.55, 0.95, slope),
      ];
      layer.fill(0);
      for (let k = 0; k < 4; k++) {
        for (let j = 0; j < k; j++) layer[j] *= 1 - cover[k];
        layer[k] = cover[k];
      }
      splat.set(layer, i * 4);
      const dry = smoothstep(0.45, 0.75, fbm(x * 0.05 + 3, z * 0.05 - 8, 3));
      const bright = 0.85 + 0.3 * fbm(x * 0.02 - 11, z * 0.02 + 4, 3);
      const mud = 1 - 0.3 * (1 - smoothstep(4.5, 7.5, d)) * smoothstep(3.5, 4.5, d);
      c.setRGB(bright * mud * (1 + dry * 0.12), bright * mud, bright * mud * (1 - dry * 0.15));
      // Wet stones under the water are darker and a little green.
      const wet = 1 - smoothstep(3.8, 5.2, d);
      c.multiply(new THREE.Color(1 - wet * 0.5, 1 - wet * 0.4, 1 - wet * 0.42));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  }
  return geo;
}

// Layer textures and how many metres one tile of each covers.
const LAYERS = [
  { name: 'grass', size: 3.2 },
  { name: 'litter', size: 2.4 },
  { name: 'moss', size: 2.2 },
  { name: 'gravel', size: 2.6 },
  { name: 'cliff', size: 9 },
] as const;

export function createTerrain() {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    // Any normal map turns on three's tangent-space normal code; the shader below
    // replaces what it samples with the blend of the layers' normal maps.
    normalMap: surface('grass').normal,
    normalScale: new THREE.Vector2(1, 1),
  });
  mat.onBeforeCompile = (shader) => {
    LAYERS.forEach((l, i) => {
      shader.uniforms[`tDiff${i}`] = { value: surface(l.name).map };
      shader.uniforms[`tNor${i}`] = { value: surface(l.name).normal };
    });
    const samplers = LAYERS.map((_, i) => `uniform sampler2D tDiff${i};\nuniform sampler2D tNor${i};`).join('\n');
    const sizes = LAYERS.map((l) => (1 / l.size).toFixed(4));
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vGroundP;\nvarying vec3 vGroundNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvGroundP = position;\nvGroundNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${samplers}\nvarying vec4 vSplat;\nvarying vec3 vGroundP;\nvarying vec3 vGroundNrm;`)
      .replace(
        '#include <map_fragment>',
        `vec3 groundN = vec3(0.0);
        {
          // Same orientation as the mesh uv, so three's tangent frame fits these normals.
          vec2 p = vec2(vGroundP.x, -vGroundP.z);
          float w[5];
          w[1] = vSplat.x; w[2] = vSplat.y; w[3] = vSplat.z; w[4] = vSplat.w;
          w[0] = max(0.0, 1.0 - w[1] - w[2] - w[3] - w[4]);
          vec3 col = vec3(0.0);
          // Grass and leaves cover big areas: mixing in a much larger copy hides the tiling.
          col += w[0] * mix(texture2D(tDiff0, p * ${sizes[0]}).rgb, texture2D(tDiff0, p * ${sizes[0]} * 0.21).rgb, 0.4);
          groundN += w[0] * (texture2D(tNor0, p * ${sizes[0]}).xyz * 2.0 - 1.0);
          if (w[1] > 0.01) {
            col += w[1] * mix(texture2D(tDiff1, p * ${sizes[1]}).rgb, texture2D(tDiff1, p * ${sizes[1]} * 0.23).rgb, 0.35);
            groundN += w[1] * (texture2D(tNor1, p * ${sizes[1]}).xyz * 2.0 - 1.0);
          }
          if (w[2] > 0.01) {
            col += w[2] * texture2D(tDiff2, p * ${sizes[2]}).rgb;
            groundN += w[2] * (texture2D(tNor2, p * ${sizes[2]}).xyz * 2.0 - 1.0);
          }
          if (w[3] > 0.01) {
            col += w[3] * texture2D(tDiff3, p * ${sizes[3]}).rgb;
            groundN += w[3] * (texture2D(tNor3, p * ${sizes[3]}).xyz * 2.0 - 1.0);
          }
          if (w[4] > 0.01) {
            // Cliffs and gorge walls: projected from the sides too, so the rock is not smeared.
            vec3 bw = pow(abs(normalize(vGroundNrm)), vec3(4.0));
            bw /= bw.x + bw.y + bw.z;
            vec3 q = vGroundP * ${sizes[4]};
            col += w[4] * (texture2D(tDiff4, q.zy).rgb * bw.x + texture2D(tDiff4, p * ${sizes[4]}).rgb * bw.y + texture2D(tDiff4, q.xy).rgb * bw.z);
            groundN += w[4] * (texture2D(tNor4, p * ${sizes[4]}).xyz * 2.0 - 1.0);
          }
          diffuseColor.rgb *= col;
          groundN = normalize(groundN + vec3(0.0, 0.0, 0.05));
        }`,
      )
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = groundN;');
  };
  const main = new THREE.Mesh(buildGrid(HALF * 2, 560, false), mat);
  main.receiveShadow = true;

  const farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const far = new THREE.Mesh(buildGrid(3200, 160, true), farMat);

  const group = new THREE.Group();
  group.add(main, far);
  return group;
}

// Fast lookups on the built grid, used for placing plants and walking.
const GRID = 561;
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
