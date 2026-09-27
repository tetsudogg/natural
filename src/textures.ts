// Textures drawn at startup, so the game needs no image downloads.

import * as THREE from 'three';
import { mulberry32 } from './noise';

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

// Grey speckle that breaks up the flat vertex colours of the ground.
export function groundDetailTexture() {
  const size = 256;
  const rnd = mulberry32(11);
  const base = tileNoise(size, 3, 40, 24);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 0.72 + base[i] * 0.22 + (rnd() - 0.5) * 0.16;
    const c = Math.max(0, Math.min(255, v * 255));
    img.data[i * 4] = c;
    img.data[i * 4 + 1] = c;
    img.data[i * 4 + 2] = c;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
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
export function foliageTexture(kind: 'leaf' | 'needle', seed: number) {
  const size = 256;
  const rnd = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  if (kind === 'leaf') {
    // A few twigs, each carrying oval leaves.
    for (let b = 0; b < 7; b++) {
      const a = rnd() * Math.PI * 2;
      const len = size * (0.25 + rnd() * 0.2);
      ctx.strokeStyle = 'rgb(70,55,35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
      for (let i = 0; i < 16; i++) {
        const t = 0.15 + rnd() * 0.85;
        const px = cx + Math.cos(a) * len * t + (rnd() - 0.5) * 30;
        const py = cy + Math.sin(a) * len * t + (rnd() - 0.5) * 30;
        const l = 55 + rnd() * 45;
        const g = 110 + rnd() * 70;
        ctx.fillStyle = `rgb(${l * 0.8},${g},${l * 0.35})`;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a + (rnd() - 0.5) * 1.8);
        ctx.beginPath();
        ctx.ellipse(0, 0, 13 + rnd() * 6, 6 + rnd() * 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,220,0.12)';
        ctx.beginPath();
        ctx.ellipse(-3, -2, 7, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  } else {
    // Cedar sprays: dense short strokes along forking stems.
    for (let b = 0; b < 9; b++) {
      const a = rnd() * Math.PI * 2;
      const len = size * (0.28 + rnd() * 0.18);
      for (let i = 0; i < 140; i++) {
        const t = rnd();
        const px = cx + Math.cos(a) * len * t + (rnd() - 0.5) * 16 * (1 - t * 0.5);
        const py = cy + Math.sin(a) * len * t + (rnd() - 0.5) * 16 * (1 - t * 0.5);
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

// Four wildflowers in one texture, one per quarter:
// white fleabane, yellow buttercup, purple bellflower, blue dayflower.
export type FlowerKind = 0 | 1 | 2 | 3;
export function flowerAtlas() {
  const size = 512;
  const q = size / 2;
  const rnd = mulberry32(21);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const stem = (x: number, y0: number, y1: number, bend: number) => {
    ctx.strokeStyle = 'rgb(70,110,45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.quadraticCurveTo(x + bend, (y0 + y1) / 2, x + bend * 0.6, y1);
    ctx.stroke();
    // a couple of leaves
    ctx.fillStyle = 'rgb(80,125,50)';
    for (let i = 0; i < 2; i++) {
      const ly = y0 - (y0 - y1) * (0.2 + rnd() * 0.35);
      ctx.save();
      ctx.translate(x + bend * 0.3, ly);
      ctx.rotate((i ? 1 : -1) * (0.6 + rnd() * 0.4));
      ctx.beginPath();
      ctx.ellipse(0, -8, 3, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    return [x + bend * 0.6, y1] as const;
  };
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * q;
    const oy = Math.floor(k / 2) * q;
    const n = k === 2 ? 4 : 6;
    for (let i = 0; i < n; i++) {
      const x = ox + q * (0.15 + 0.7 * (i + rnd() * 0.6) / n);
      const top = oy + q * (0.15 + rnd() * 0.35);
      const [hx, hy] = stem(x, oy + q - 2, top, (rnd() - 0.5) * 20);
      ctx.save();
      ctx.translate(hx, hy);
      if (k === 0) {
        // many thin white petals around a yellow centre
        ctx.fillStyle = 'rgb(245,242,235)';
        for (let p = 0; p < 18; p++) {
          ctx.save();
          ctx.rotate((p / 18) * Math.PI * 2);
          ctx.fillRect(-1, 2, 2, 9);
          ctx.restore();
        }
        ctx.fillStyle = 'rgb(235,200,60)';
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (k === 1) {
        ctx.fillStyle = 'rgb(250,215,40)';
        for (let p = 0; p < 5; p++) {
          ctx.save();
          ctx.rotate((p / 5) * Math.PI * 2);
          ctx.beginPath();
          ctx.ellipse(0, 5, 4.5, 6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = 'rgb(200,160,30)';
        ctx.beginPath();
        ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (k === 2) {
        // hanging bells along the stem top
        for (let b = 0; b < 3; b++) {
          ctx.save();
          ctx.translate((b - 1) * 7, b * 12);
          ctx.fillStyle = 'rgb(140,110,200)';
          ctx.beginPath();
          ctx.moveTo(-6, 12);
          ctx.quadraticCurveTo(-6, 0, 0, 0);
          ctx.quadraticCurveTo(6, 0, 6, 12);
          ctx.lineTo(-6, 12);
          ctx.fill();
          ctx.restore();
        }
      } else {
        // two rounded blue petals
        ctx.fillStyle = 'rgb(60,110,230)';
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(s * 5, -2, 5, 6, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgb(240,210,60)';
        ctx.fillRect(-1, 2, 2, 5);
      }
      ctx.restore();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A single fern frond pointing up the texture: a stalk with paired leaflets.
export function fernTexture() {
  const w = 128;
  const h = 256;
  const rnd = mulberry32(12);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = 'rgb(60,90,35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2, h);
  ctx.lineTo(w / 2, 6);
  ctx.stroke();
  const pairs = 22;
  for (let i = 0; i < pairs; i++) {
    const t = i / pairs;
    const y = h - 20 - t * (h - 30);
    const len = (w / 2 - 6) * Math.sin(Math.PI * (0.15 + t * 0.85)) * (1 - t * 0.35);
    for (const s of [-1, 1]) {
      const g = 95 + rnd() * 50;
      ctx.fillStyle = `rgb(${g * 0.5},${g},${g * 0.35})`;
      ctx.save();
      ctx.translate(w / 2, y);
      ctx.rotate(s * (Math.PI / 2 - 0.35));
      // each leaflet is a row of small lobes
      const lobes = Math.max(2, Math.round(len / 5));
      for (let l = 0; l < lobes; l++) {
        const ly = -(l / lobes) * len;
        const lw = 3.2 * (1 - (l / lobes) * 0.6);
        ctx.beginPath();
        ctx.ellipse(0, ly - 2.5, lw, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Bark: vertical ridges and furrows, tiled around trunks.
export function barkTexture() {
  const w = 128;
  const h = 256;
  const rnd = mulberry32(17);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const cols = Array.from({ length: w }, (_, x) => 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 2 * 9 + Math.sin((x / w) * Math.PI * 2 * 3) * 2));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const wave = Math.sin((y / h) * Math.PI * 2 * 3 + x * 0.3) * 0.08;
      const v = 0.55 + cols[x] * 0.35 + wave + (rnd() - 0.5) * 0.18;
      const c = Math.max(0, Math.min(255, v * 255));
      const i = (y * w + x) * 4;
      img.data[i] = c;
      img.data[i + 1] = c * 0.96;
      img.data[i + 2] = c * 0.9;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Rock surface: grain, darker cracks and pale lichen patches.
export function rockTexture() {
  const size = 256;
  const rnd = mulberry32(19);
  const base = tileNoise(size, 23, 50, 20);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 0.6 + base[i] * 0.35 + (rnd() - 0.5) * 0.2;
    const c = Math.max(0, Math.min(255, v * 255));
    img.data[i * 4] = c;
    img.data[i * 4 + 1] = c;
    img.data[i * 4 + 2] = c * 0.97;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${200 + rnd() * 40},${205 + rnd() * 30},${170 + rnd() * 30},${0.25 + rnd() * 0.3})`;
    ctx.beginPath();
    ctx.arc(rnd() * size, rnd() * size, 2 + rnd() * 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(40,38,35,0.45)';
  for (let i = 0; i < 10; i++) {
    ctx.lineWidth = 0.8 + rnd();
    ctx.beginPath();
    let x = rnd() * size;
    let y = rnd() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (rnd() - 0.5) * 40;
      y += (rnd() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
