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
export function foliageTexture(kind: 'leaf' | 'needle' | 'maple', seed: number) {
  const size = 512;
  const rnd = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const S = size / 256; // drawing below is in 256-unit space
  ctx.scale(S, S);
  const half = 128;
  if (kind === 'leaf') {
    // Twigs carrying oval leaves, each with a lit side, a shaded side and a midrib.
    for (let b = 0; b < 8; b++) {
      const a = rnd() * Math.PI * 2;
      const len = 256 * (0.25 + rnd() * 0.2);
      ctx.strokeStyle = 'rgb(80,62,40)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(half, half);
      ctx.lineTo(half + Math.cos(a) * len, half + Math.sin(a) * len);
      ctx.stroke();
      for (let i = 0; i < 18; i++) {
        const t = 0.12 + rnd() * 0.88;
        const px = half + Math.cos(a) * len * t + (rnd() - 0.5) * 28;
        const py = half + Math.sin(a) * len * t + (rnd() - 0.5) * 28;
        const light = rnd();
        const r = 88 + light * 72;
        const g = 145 + light * 90;
        const bl = 30 + light * 36;
        const lw = 12 + rnd() * 6;
        const lh = 5.5 + rnd() * 2.5;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a + (rnd() - 0.5) * 1.8);
        const grad = ctx.createLinearGradient(0, -lh, 0, lh);
        grad.addColorStop(0, `rgb(${r * 1.15},${g * 1.12},${bl * 1.1})`);
        grad.addColorStop(1, `rgb(${r * 0.7},${g * 0.72},${bl * 0.7})`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-lw, 0);
        ctx.quadraticCurveTo(-lw * 0.2, -lh * 1.6, lw, 0);
        ctx.quadraticCurveTo(-lw * 0.2, lh * 1.6, -lw, 0);
        ctx.fill();
        ctx.strokeStyle = `rgba(230,240,190,0.35)`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(-lw * 0.9, 0);
        ctx.lineTo(lw * 0.9, 0);
        ctx.stroke();
        ctx.restore();
      }
    }
  } else if (kind === 'maple') {
    // Palmate five-lobed leaves on long stalks, like a Japanese maple in summer.
    const lobe = (r: number) => {
      ctx.beginPath();
      for (let k = 0; k <= 10; k++) {
        const ang = -Math.PI / 2 + ((k / 10) * Math.PI * 2 * 5) / 5;
        const rr = k % 2 === 0 ? r : r * 0.38;
        const x = Math.cos(ang - Math.PI * 0.1) * rr;
        const y = Math.sin(ang - Math.PI * 0.1) * rr;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    };
    for (let b = 0; b < 7; b++) {
      const a = rnd() * Math.PI * 2;
      const len = 256 * (0.22 + rnd() * 0.2);
      ctx.strokeStyle = 'rgb(110,70,50)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(half, half);
      ctx.lineTo(half + Math.cos(a) * len, half + Math.sin(a) * len);
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const t = 0.2 + rnd() * 0.8;
        const px = half + Math.cos(a) * len * t + (rnd() - 0.5) * 30;
        const py = half + Math.sin(a) * len * t + (rnd() - 0.5) * 30;
        const light = rnd();
        ctx.fillStyle = `rgb(${95 + light * 70},${150 + light * 85},${35 + light * 30})`;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a + Math.PI / 2 + (rnd() - 0.5) * 1.2);
        lobe(9 + rnd() * 4);
        ctx.restore();
      }
    }
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

// Eight wild plants in one texture, four per row:
// top row: white fleabane, yellow buttercup, purple bellflower, blue dayflower;
// bottom row: pink fringed pink (nadeshiko), yellow patrinia (ominaeshi),
// silver grass (susuki), white clover.
export type FlowerKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const FLOWER_KINDS = 8;
export function flowerAtlas() {
  const q = 256;
  const rnd = mulberry32(21);
  const canvas = document.createElement('canvas');
  canvas.width = q * 4;
  canvas.height = q * 2;
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
    const ox = k * q;
    const oy = 0;
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

  // Nadeshiko: five pink petals with finely fringed edges.
  for (let i = 0; i < 5; i++) {
    const x = q * (0.15 + 0.7 * (i + rnd() * 0.6) / 5);
    const [hx, hy] = stem(x, q * 2 - 2, q + q * (0.2 + rnd() * 0.3), (rnd() - 0.5) * 20);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(rnd());
    for (let p = 0; p < 5; p++) {
      ctx.save();
      ctx.rotate((p / 5) * Math.PI * 2);
      ctx.fillStyle = 'rgb(236,150,190)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-4, 8);
      for (let f = 0; f <= 6; f++) ctx.lineTo(-4 + (f / 6) * 8, f % 2 ? 11 : 15);
      ctx.lineTo(4, 8);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = 'rgb(200,90,130)';
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Ominaeshi: tall stems topped with flat sprays of tiny yellow flowers.
  for (let i = 0; i < 4; i++) {
    const x = q + q * (0.15 + 0.7 * (i + rnd() * 0.6) / 4);
    const [hx, hy] = stem(x, q * 2 - 2, q + q * (0.1 + rnd() * 0.15), (rnd() - 0.5) * 16);
    ctx.fillStyle = 'rgb(240,210,50)';
    for (let d = 0; d < 60; d++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 16;
      ctx.beginPath();
      ctx.arc(hx + Math.cos(a) * r, hy + Math.sin(a) * r * 0.35, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Susuki: arching leaves and silky plumes bending with the wind.
  {
    const ox = q * 2;
    ctx.strokeStyle = 'rgb(110,130,70)';
    ctx.lineWidth = 2.2;
    for (let i = 0; i < 14; i++) {
      const x = ox + q * 0.5 + (rnd() - 0.5) * 30;
      const lean = (rnd() - 0.5) * 220;
      ctx.beginPath();
      ctx.moveTo(x, q * 2);
      ctx.quadraticCurveTo(x + lean * 0.2, q * 1.3, x + lean * 0.5, q * 1.2 + rnd() * 90);
      ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const x = ox + q * 0.5 + (i - 2) * 12 + (rnd() - 0.5) * 8;
      const tx = x + 30 + rnd() * 30;
      const ty = q + 20 + rnd() * 40;
      ctx.strokeStyle = 'rgb(150,140,100)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, q * 2);
      ctx.quadraticCurveTo(x, ty + 60, tx, ty);
      ctx.stroke();
      // plume: many fine hairs sweeping down to one side
      for (let h = 0; h < 40; h++) {
        const t2 = rnd();
        const sx = tx - 10 * t2;
        const sy = ty + t2 * 50;
        ctx.strokeStyle = `rgba(${225 + rnd() * 20},${210 + rnd() * 20},${180 + rnd() * 20},0.9)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + 10, sy + 6, sx + 14 + rnd() * 10, sy + 14 + rnd() * 10);
        ctx.stroke();
      }
    }
  }

  // White clover: low round heads and three-part leaves.
  {
    const ox = q * 3;
    for (let i = 0; i < 12; i++) {
      const x = ox + 20 + rnd() * (q - 40);
      const y = q * 2 - 10 - rnd() * 40;
      ctx.fillStyle = 'rgb(70,120,50)';
      for (let l = 0; l < 3; l++) {
        ctx.beginPath();
        ctx.arc(x + Math.cos(l * 2.1) * 5, y + Math.sin(l * 2.1) * 5, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let i = 0; i < 6; i++) {
      const x = ox + 30 + rnd() * (q - 60);
      const [hx, hy] = stem(x, q * 2 - 2, q * 2 - 70 - rnd() * 50, (rnd() - 0.5) * 10);
      for (let d = 0; d < 36; d++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * 9;
        ctx.fillStyle = rnd() < 0.2 ? 'rgb(235,200,210)' : 'rgb(250,248,240)';
        ctx.beginPath();
        ctx.ellipse(hx + Math.cos(a) * r, hy + Math.sin(a) * r, 1.6, 2.6, a, 0, Math.PI * 2);
        ctx.fill();
      }
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
  // Pale lichen and dark damp patches, like the mottled trunks of beech trees.
  for (let i = 0; i < 70; i++) {
    const pale = rnd() < 0.6;
    ctx.fillStyle = pale ? `rgba(${225 + rnd() * 25},${228 + rnd() * 25},${215 + rnd() * 25},${0.25 + rnd() * 0.35})` : `rgba(40,45,35,${0.15 + rnd() * 0.2})`;
    ctx.beginPath();
    const x = rnd() * w;
    const y = rnd() * h;
    ctx.ellipse(x, y, 3 + rnd() * 10, 2 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Fallen leaves covering the forest floor: browns, tans and a few fresh greens.
export function leafLitterTexture() {
  const size = 512;
  const rnd = mulberry32(29);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(78,62,46)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const l = 5 + rnd() * 9;
    const tone = rnd();
    const r = tone < 0.08 ? 120 : 115 + tone * 75;
    const g = tone < 0.08 ? 140 : 85 + tone * 60;
    const b = tone < 0.08 ? 60 : 50 + tone * 38;
    const dark = 0.55 + rnd() * 0.5;
    const rot = rnd() * Math.PI * 2;
    ctx.fillStyle = `rgb(${r * dark},${g * dark},${b * dark})`;
    // Draw each leaf wrapped around the edges so the texture tiles.
    for (const ox of [0, -size, size]) {
      for (const oy of [0, -size, size]) {
        if (x + ox < -20 || x + ox > size + 20 || y + oy < -20 || y + oy > size + 20) continue;
        ctx.save();
        ctx.translate(x + ox, y + oy);
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, l, l * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
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
