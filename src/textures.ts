// Textures: CC0 photos from Poly Haven (see scripts/fetch_textures.py) for surfaces
// and leaves, plus a few drawn at startup.

import * as THREE from 'three';
import { mulberry32 } from './noise';
import barkDiff from './assets/bark_diff.webp';
import barkNor from './assets/bark_nor.webp';
import cliffDiff from './assets/cliff_diff.webp';
import cliffNor from './assets/cliff_nor.webp';
import fernUrl from './assets/fern.webp';
import flowersUrl from './assets/flowers.webp';
import grassUrl from './assets/grass.webp';
import grassDiff from './assets/grass_diff.webp';
import grassNor from './assets/grass_nor.webp';
import gravelDiff from './assets/gravel_diff.webp';
import gravelNor from './assets/gravel_nor.webp';
import leavesUrl from './assets/leaves.webp';
import litterDiff from './assets/litter_diff.webp';
import litterNor from './assets/litter_nor.webp';
import mossDiff from './assets/moss_diff.webp';
import mossNor from './assets/moss_nor.webp';
import rockDiff from './assets/rock_diff.webp';
import rockNor from './assets/rock_nor.webp';

const loader = new THREE.TextureLoader();

function photo(url: string, color: boolean) {
  const tex = loader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export type Surface = { map: THREE.Texture; normal: THREE.Texture };
const SURFACE_URLS = {
  grass: [grassDiff, grassNor],
  litter: [litterDiff, litterNor],
  gravel: [gravelDiff, gravelNor],
  cliff: [cliffDiff, cliffNor],
  moss: [mossDiff, mossNor],
  rock: [rockDiff, rockNor],
  bark: [barkDiff, barkNor],
} as const;
const surfaces = new Map<string, Surface>();

// A tileable photo surface: colour and normal map. Shared, so each loads once.
export function surface(name: keyof typeof SURFACE_URLS): Surface {
  let s = surfaces.get(name);
  if (!s) {
    const [map, normal] = SURFACE_URLS[name];
    s = { map: photo(map, true), normal: photo(normal, false) };
    surfaces.set(name, s);
  }
  return s;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function image(url: string) {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

// Tileable noise built from sine waves so it repeats seamlessly.
function tileNoise(size: number, seed: number, waves: number, maxFreq: number) {
  const rnd = mulberry32(seed);
  const comps: { fx: number; fy: number; ph: number; a: number }[] = [];
  for (let i = 0; i < waves; i++) {
    const f = 1 + Math.floor(rnd() * maxFreq);
    const ang = rnd() * Math.PI * 2;
    comps.push({
      fx: Math.round(Math.cos(ang) * f),
      fy: Math.round(Math.sin(ang) * f),
      ph: rnd() * Math.PI * 2,
      a: 1 / f,
    });
  }
  const out = new Float32Array(size * size);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const c of comps) v += Math.sin(((c.fx * x + c.fy * y) / size) * Math.PI * 2 + c.ph) * c.a;
      out[y * size + x] = v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) / (max - min);
  return out;
}

// Normal map of small ripples for the stream.
export function waterNormalTexture() {
  const size = 256;
  const h = tileNoise(size, 7, 60, 12);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  const strength = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Soft round dot used for fireflies.
export function glowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Leaf sprays with transparent gaps, used on the cards that make up tree crowns.
// A drift of dead leaves on the ground: the photographed leaves turned brown,
// ochre and rust, lying every which way and fading out at the edges.
// The photographed leaves recoloured as dead leaves, one per cell of a 4x2 atlas.
export function deadLeafAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Tints (sRGB 0..255) for each leaf: browns, ochre, rust and a dark damp one.
  const tints = [
    [125, 70, 30],
    [175, 115, 40],
    [100, 55, 25],
    [150, 85, 35],
    [190, 130, 45],
    [130, 60, 28],
    [160, 100, 45],
    [95, 60, 30],
  ];
  image(leavesUrl).then((img) => {
    // Recolour by hand (not canvas filters) so every browser gives the same browns:
    // keep each leaf's light and shade, swap its colour for the tint.
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, 1024, 512);
    const d = data.data;
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 1024; x++) {
        const i = (y * 1024 + x) * 4;
        const t = tints[Math.floor(x / 256) + Math.floor(y / 256) * 4];
        const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
        const k = 0.3 + l * 1.2;
        d[i] = Math.min(255, t[0] * k);
        d[i + 1] = Math.min(255, t[1] * k);
        d[i + 2] = Math.min(255, t[2] * k);
      }
    }
    ctx.putImageData(data, 0, 0);
    tex.needsUpdate = true;
  });
  return tex;
}

export function fallenLeavesTexture(seed: number) {
  const size = 512;
  const rnd = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  image(leavesUrl).then((img) => {
    const leaves: { x: number; y: number; rot: number; s: number; cell: number; f: string; d: number }[] = [];
    for (let i = 0; i < 170; i++) {
      // Denser in the middle, sparse toward the edge.
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * size * 0.44;
      const kind = rnd();
      // Mostly dull browns, some ochre, a few dark damp ones.
      const f =
        kind < 0.55
          ? `sepia(1) saturate(${0.7 + rnd() * 0.5}) hue-rotate(${rnd() * 10}deg) brightness(${0.35 + rnd() * 0.25})`
          : kind < 0.8
            ? `sepia(1) saturate(${1 + rnd() * 0.6}) hue-rotate(${5 + rnd() * 10}deg) brightness(${0.5 + rnd() * 0.2})`
            : `sepia(1) saturate(0.5) brightness(${0.22 + rnd() * 0.15})`;
      leaves.push({ x: size / 2 + Math.cos(a) * r, y: size / 2 + Math.sin(a) * r, rot: rnd() * Math.PI * 2, s: 26 + rnd() * 22, cell: Math.floor(rnd() * 8), f, d: r });
    }
    // Outer leaves first so the heap sits on top in the middle.
    leaves.sort((a, b) => b.d - a.d);
    for (const l of leaves) {
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.rot);
      ctx.filter = l.f;
      ctx.drawImage(img, (l.cell % 4) * 256, Math.floor(l.cell / 4) * 256, 256, 256, -l.s / 2, -l.s / 2, l.s, l.s);
      ctx.restore();
    }
    tex.needsUpdate = true;
  });
  return tex;
}

export function foliageTexture(kind: 'leaf' | 'needle' | 'maple', seed: number) {
  const size = 1024;
  const rnd = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const S = size / 256; // drawing below is in 256-unit space
  ctx.scale(S, S);
  const half = 128;
  if (kind !== 'needle') {
    // Twigs carrying real leaves photographed for Poly Haven. 'leaf' mixes broad
    // heart-shaped and oval leaves; 'maple' uses smaller, denser serrated ones.
    const maple = kind === 'maple';
    const twigs: { a: number; len: number }[] = [];
    const leaves: { x: number; y: number; rot: number; s: number; cell: number; shade: number }[] = [];
    for (let b = 0; b < (maple ? 7 : 8); b++) {
      const a = rnd() * Math.PI * 2;
      const len = 256 * (0.24 + rnd() * 0.2);
      twigs.push({ a, len });
      for (let i = 0; i < (maple ? 24 : 20); i++) {
        const t = 0.15 + rnd() * 0.85;
        leaves.push({
          x: half + Math.cos(a) * len * t + (rnd() - 0.5) * 20,
          y: half + Math.sin(a) * len * t + (rnd() - 0.5) * 20,
          rot: a + Math.PI / 2 + (rnd() - 0.5) * 1.6,
          s: maple ? 18 + rnd() * 10 : 22 + rnd() * 14,
          cell: maple ? Math.floor(rnd() * 6) : Math.floor(rnd() * 8),
          shade: 0.55 + rnd() * 0.6,
        });
      }
    }
    image(leavesUrl).then((img) => {
      ctx.strokeStyle = 'rgb(88,70,48)';
      ctx.lineWidth = 1.5;
      for (const { a, len } of twigs) {
        ctx.beginPath();
        ctx.moveTo(half, half);
        ctx.lineTo(half + Math.cos(a) * len, half + Math.sin(a) * len);
        ctx.stroke();
      }
      // Shaded leaves deep in the spray first, sunlit ones on top: gives the card depth.
      leaves.sort((a, b) => a.shade - b.shade);
      for (const l of leaves) {
        ctx.save();
        ctx.translate(l.x, l.y);
        ctx.rotate(l.rot);
        ctx.filter = `brightness(${l.shade.toFixed(2)})`;
        // Each atlas cell holds one leaf, tip up and stalk at the bottom.
        ctx.drawImage(img, (l.cell % 4) * 256, Math.floor(l.cell / 4) * 256, 256, 256, -l.s / 2, -l.s * 0.95, l.s, l.s);
        ctx.restore();
      }
      tex.needsUpdate = true;
    });
  } else {
    // Cedar sprays: dense short strokes along forking stems.
    for (let b = 0; b < 9; b++) {
      const a = rnd() * Math.PI * 2;
      const len = 256 * (0.28 + rnd() * 0.18);
      for (let i = 0; i < 140; i++) {
        const t = rnd();
        const px = half + Math.cos(a) * len * t + (rnd() - 0.5) * 16 * (1 - t * 0.5);
        const py = half + Math.sin(a) * len * t + (rnd() - 0.5) * 16 * (1 - t * 0.5);
        const ang = a + (rnd() - 0.5) * 2.2;
        const l = 6 + rnd() * 8;
        const g = 70 + rnd() * 60;
        ctx.strokeStyle = `rgb(${g * 0.45},${g},${g * 0.4})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(ang) * l, py + Math.sin(ang) * l);
        ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Eight wild plants in one texture, four per row, assembled from photographed parts
// by scripts/fetch_textures.py:
// top row: white daisy, yellow buttercup, purple and blue five-petalled flowers;
// bottom row: pink flowers, dandelion, silver grass, clover.
export type FlowerKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const FLOWER_KINDS = 8;
export function flowerAtlas() {
  const tex = loader.load(flowersUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Eight photographed grass tufts, four per row, each standing on the bottom of its cell.
export function grassAtlas() {
  const tex = loader.load(grassUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A single fern frond pointing up the texture, stalk at the bottom (photo, with alpha).
export function fernTexture() {
  const tex = loader.load(fernUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

