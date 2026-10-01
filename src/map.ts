// The map: a small, see-through minimap with a compass in the corner while walking, and
// a full-screen map (M) where favourite places can be marked, given a short note and a
// colour, and jumped back to. North is -z, east is +x (the sun rises over +x).

import { HALF, brooks, clearingFactor, forestDensity, streamX, waterLevel } from './world';
import { groundHeight, groundSlope } from './terrain';

export interface Pin {
  id: number;
  x: number;
  z: number;
  yaw: number;
  color: number;
  note: string;
}

export const PIN_COLORS = ['#e8574a', '#f0a830', '#f2e14c', '#5cc46a', '#4aa3e8', '#b07ce8', '#f4f2ec'];
const PINS_KEY = 'natural.pins.v1';
const MINI_RANGE = 70; // metres from the centre to the edge of the minimap

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadPins(): Pin[] {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    return raw ? (JSON.parse(raw) as Pin[]) : [];
  } catch {
    return [];
  }
}

function savePins(pins: Pin[]) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    // No storage (private window): the marks last until the page closes.
  }
}

// A shaded relief of the world: forest and meadow colours and grey crags, painted on a
// coarse grid and drawn smoothed. Water and contour lines are vector paths on top, so
// they stay crisp at any zoom.
const GRID = 300; // 2 m per cell
function paintRelief(h: Float32Array) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = GRID;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(GRID, GRID);
  const m = (HALF * 2) / GRID;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = -HALF + (i + 0.5) * m;
      const z = -HALF + (j + 0.5) * m;
      const w = h[j * GRID + Math.max(0, i - 1)];
      const e = h[j * GRID + Math.min(GRID - 1, i + 1)];
      const n = h[Math.max(0, j - 1) * GRID + i];
      const s = h[Math.min(GRID - 1, j + 1) * GRID + i];
      // Light from the north-west.
      const shade = Math.max(0.5, Math.min(1.2, 0.92 - ((e - w) + (s - n)) * 0.18 / m));
      const dens = forestDensity(x, z);
      const open = clearingFactor(x, z);
      let r = 168 - dens * 62 + open * 12;
      let g = 180 - dens * 42 + open * 10;
      let b = 132 - dens * 40 + open * 4;
      const rock = Math.min(1, Math.max(0, (groundSlope(x, z) - 0.9) * 2));
      r += (150 - r) * rock;
      g += (146 - g) * rock;
      b += (136 - b) * rock;
      const k = (j * GRID + i) * 4;
      img.data[k] = r * shade;
      img.data[k + 1] = g * shade;
      img.data[k + 2] = b * shade;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Contour lines every 10 m (marching squares), with every fifth one heavier.
function contours(h: Float32Array) {
  const thin = new Path2D();
  const thick = new Path2D();
  const m = (HALF * 2) / GRID;
  const px = (i: number) => -HALF + (i + 0.5) * m;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let level = Math.ceil(lo / 10) * 10; level <= hi; level += 10) {
    const path = level % 50 === 0 ? thick : thin;
    for (let j = 0; j < GRID - 1; j++) {
      for (let i = 0; i < GRID - 1; i++) {
        const a = h[j * GRID + i] - level;
        const b = h[j * GRID + i + 1] - level;
        const c = h[(j + 1) * GRID + i + 1] - level;
        const d = h[(j + 1) * GRID + i] - level;
        const pts: number[] = [];
        const cut = (v0: number, v1: number, x0: number, z0: number, x1: number, z1: number) => {
          if (v0 < 0 !== v1 < 0) {
            const t = v0 / (v0 - v1);
            pts.push(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
          }
        };
        const x0 = px(i);
        const x1 = px(i + 1);
        const z0 = px(j);
        const z1 = px(j + 1);
        cut(a, b, x0, z0, x1, z0);
        cut(b, c, x1, z0, x1, z1);
        cut(c, d, x1, z1, x0, z1);
        cut(d, a, x0, z1, x0, z0);
        for (let k = 0; k + 3 < pts.length; k += 4) {
          path.moveTo(pts[k], pts[k + 1]);
          path.lineTo(pts[k + 2], pts[k + 3]);
        }
      }
    }
  }
  return { thin, thick };
}

// The stream and the brooks as filled shapes.
function waterPath() {
  const path = new Path2D();
  const left: number[] = [];
  const right: number[] = [];
  for (let z = -HALF; z <= HALF; z += 2) {
    const cx = streamX(z);
    const lvl = waterLevel(z);
    const edge = (side: number) => {
      let o = 0;
      while (o < 14 && groundHeight(cx + side * o, z) < lvl) o += 0.25;
      return Math.max(1.2, o);
    };
    left.push(cx - edge(-1), z);
    right.push(cx + edge(1), z);
  }
  path.moveTo(left[0], left[1]);
  for (let k = 2; k < left.length; k += 2) path.lineTo(left[k], left[k + 1]);
  for (let k = right.length - 2; k >= 0; k -= 2) path.lineTo(right[k], right[k + 1]);
  path.closePath();
  for (const b of brooks()) {
    const n = b.x.length;
    const l: number[] = [];
    const r: number[] = [];
    for (let k = 0; k < n; k++) {
      const k0 = Math.max(0, k - 1);
      const k1 = Math.min(n - 1, k + 1);
      let tx = b.x[k1] - b.x[k0];
      let tz = b.z[k1] - b.z[k0];
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const w = Math.max(0.6, b.width[k]);
      l.push(b.x[k] - tz * w, b.z[k] + tx * w);
      r.push(b.x[k] + tz * w, b.z[k] - tx * w);
    }
    path.moveTo(l[0], l[1]);
    for (let k = 2; k < l.length; k += 2) path.lineTo(l[k], l[k + 1]);
    for (let k = r.length - 2; k >= 0; k -= 2) path.lineTo(r[k], r[k + 1]);
    path.closePath();
  }
  return path;
}

interface WorldArt {
  relief: HTMLCanvasElement;
  water: Path2D;
  thin: Path2D;
  thick: Path2D;
}

// Draws the world with the context already set up in world metres; k = pixels per metre.
function drawWorld(ctx: CanvasRenderingContext2D, art: WorldArt, k: number) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(art.relief, -HALF, -HALF, HALF * 2, HALF * 2);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(60, 50, 30, 0.28)';
  ctx.lineWidth = 0.8 / k;
  ctx.stroke(art.thin);
  ctx.strokeStyle = 'rgba(60, 50, 30, 0.45)';
  ctx.lineWidth = 1.4 / k;
  ctx.stroke(art.thick);
  ctx.fillStyle = 'rgb(86, 156, 200)';
  ctx.fill(art.water);
  ctx.strokeStyle = 'rgba(40, 100, 150, 0.6)';
  ctx.lineWidth = 0.8 / k;
  ctx.stroke(art.water);
}

// The whole world drawn once at 2 px per metre, for the minimap.
function paintWorld(art: WorldArt) {
  const canvas = document.createElement('canvas');
  const k = 2;
  canvas.width = canvas.height = HALF * 2 * k;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, HALF * k, HALF * k);
  drawWorld(ctx, art, k);
  return canvas;
}

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, scale: number, selected: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-3, -6, -8, -10, -8, -15);
  ctx.arc(0, -15, 8, Math.PI, 0);
  ctx.bezierCurveTo(8, -10, 3, -6, 0, 0);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.55)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -15, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.restore();
}

function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, size * 0.75);
  ctx.lineTo(0, size * 0.35);
  ctx.lineTo(-size * 0.7, size * 0.75);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();
  ctx.restore();
}

export interface MapHandlers {
  player: () => { x: number; z: number; yaw: number };
  jump: (pin: Pin) => void;
  opened: () => void;
  closed: () => void;
}

export function createMap(h: MapHandlers) {
  const m = (HALF * 2) / GRID;
  const heights = new Float32Array(GRID * GRID);
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) heights[j * GRID + i] = groundHeight(-HALF + (i + 0.5) * m, -HALF + (j + 0.5) * m);
  const art: WorldArt = { relief: paintRelief(heights), water: waterPath(), ...contours(heights) };
  const world = paintWorld(art);
  const pins = loadPins();
  let nextId = pins.reduce((a, p) => Math.max(a, p.id), 0) + 1;

  // ---------- Minimap ----------
  const mini = $<HTMLCanvasElement>('mini');
  const mctx = mini.getContext('2d')!;
  const needle = $('needle');
  function drawMini() {
    const p = h.player();
    const W = mini.width;
    const scale = W / 2 / MINI_RANGE; // canvas px per metre
    mctx.clearRect(0, 0, W, W);
    mctx.save();
    mctx.beginPath();
    mctx.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    mctx.clip();
    // Heading up: turn the world so the way you face points up.
    mctx.translate(W / 2, W / 2);
    mctx.rotate(p.yaw);
    mctx.scale(scale, scale);
    mctx.translate(-p.x, -p.z);
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(world, -HALF, -HALF, HALF * 2, HALF * 2);
    mctx.restore();
    // Marks, kept upright.
    for (const pin of pins) {
      const dx = pin.x - p.x;
      const dz = pin.z - p.z;
      const c = Math.cos(p.yaw);
      const s = Math.sin(p.yaw);
      let sx = (dx * c - dz * s) * scale;
      let sy = (dx * s + dz * c) * scale;
      const l = Math.hypot(sx, sy);
      const R = W / 2 - 14;
      if (l > R) {
        sx *= R / l;
        sy *= R / l;
      }
      drawPin(mctx, W / 2 + sx, W / 2 + sy + 8, PIN_COLORS[pin.color], 1.1, false);
    }
    drawPlayer(mctx, W / 2, W / 2, 0, 11);
    // The compass needle points north, turning as you turn.
    needle.style.transform = `rotate(${p.yaw}rad)`;
  }

  // ---------- Full map ----------
  const mapEl = $('map');
  const canvas = $<HTMLCanvasElement>('map-canvas');
  const ctx = canvas.getContext('2d')!;
  const pop = $('pin-pop');
  const note = $<HTMLInputElement>('pin-note');
  const swatches = $('pin-swatches');
  let open = false;
  let zoom = 1;
  let cx = 0; // world point at the centre of the view
  let cz = 0;
  let selected: Pin | null = null;
  let base = 1; // px per metre at zoom 1

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    base = Math.min(canvas.width, canvas.height) / (HALF * 2);
  }
  const toScreen = (x: number, z: number) => {
    const k = base * zoom;
    return [canvas.width / 2 + (x - cx) * k, canvas.height / 2 + (z - cz) * k];
  };
  const toWorld = (sx: number, sy: number) => {
    const k = base * zoom;
    return [cx + (sx - canvas.width / 2) / k, cz + (sy - canvas.height / 2) / k];
  };
  const clampView = () => {
    const lim = HALF * (1 - 1 / zoom);
    cx = Math.max(-lim, Math.min(lim, cx));
    cz = Math.max(-lim, Math.min(lim, cz));
  };

  function draw() {
    if (!open) return;
    const dpr = canvas.width / canvas.getBoundingClientRect().width || 1;
    ctx.fillStyle = '#18201a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const k = base * zoom;
    ctx.save();
    ctx.setTransform(k, 0, 0, k, canvas.width / 2 - cx * k, canvas.height / 2 - cz * k);
    drawWorld(ctx, art, k);
    ctx.restore();
    // A compass rose in the corner: north is up on this map.
    ctx.save();
    ctx.translate(canvas.width - 40 * dpr, 40 * dpr);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = 'rgba(10,14,10,0.45)';
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(6, 0);
    ctx.lineTo(-6, 0);
    ctx.fillStyle = '#e8574a';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.lineTo(6, 0);
    ctx.lineTo(-6, 0);
    ctx.fillStyle = '#f2f1ea';
    ctx.fill();
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('N', 0, -27);
    ctx.restore();
    // Marks with their notes.
    ctx.font = `${12 * dpr}px 'Hiragino Sans','Noto Sans JP',system-ui,sans-serif`;
    ctx.textAlign = 'left';
    for (const pin of pins) {
      const [sx, sy] = toScreen(pin.x, pin.z);
      drawPin(ctx, sx, sy, PIN_COLORS[pin.color], 1.2 * dpr, pin === selected);
      if (pin.note) {
        ctx.lineWidth = 3 * dpr;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.strokeText(pin.note, sx + 12 * dpr, sy - 14 * dpr);
        ctx.fillStyle = '#fff';
        ctx.fillText(pin.note, sx + 12 * dpr, sy - 14 * dpr);
      }
    }
    const p = h.player();
    const [px, py] = toScreen(p.x, p.z);
    // Facing (-sin yaw, -cos yaw) in world; on the map that is the angle -yaw from up.
    drawPlayer(ctx, px, py, -p.yaw, 10 * dpr);
    if (selected) placePop();
  }

  function placePop() {
    if (!selected) return;
    const dpr = canvas.width / canvas.getBoundingClientRect().width || 1;
    const [sx, sy] = toScreen(selected.x, selected.z);
    const r = canvas.getBoundingClientRect();
    const fr = mapEl.querySelector('.map-frame')!.getBoundingClientRect();
    const left = Math.min(fr.width - pop.offsetWidth - 8, Math.max(8, r.left - fr.left + sx / dpr - pop.offsetWidth / 2));
    let top = r.top - fr.top + sy / dpr + 10;
    if (top + pop.offsetHeight > fr.height - 8) top = r.top - fr.top + sy / dpr - 40 - pop.offsetHeight;
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.max(8, top)}px`;
  }

  function select(pin: Pin | null) {
    selected = pin;
    pop.hidden = !pin;
    swatches.hidden = true;
    if (pin) {
      note.value = pin.note;
      placePop();
    }
    draw();
  }

  function addHere() {
    const p = h.player();
    const pin: Pin = { id: nextId++, x: p.x, z: p.z, yaw: p.yaw, color: pins.length % PIN_COLORS.length, note: '' };
    pins.push(pin);
    savePins(pins);
    select(pin);
    note.focus();
  }

  // Swatches for picking a colour.
  PIN_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c;
    b.title = `色 ${i + 1}`;
    b.addEventListener('click', () => {
      if (!selected) return;
      selected.color = i;
      savePins(pins);
      swatches.hidden = true;
      draw();
    });
    swatches.appendChild(b);
  });

  note.addEventListener('input', () => {
    if (!selected) return;
    selected.note = note.value.slice(0, 12);
    savePins(pins);
    draw();
  });
  note.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') note.blur();
  });
  $('pin-go').addEventListener('click', () => {
    if (!selected) return;
    const pin = selected;
    close();
    h.jump(pin);
  });
  $('pin-color').addEventListener('click', () => {
    swatches.hidden = !swatches.hidden;
    placePop();
  });
  $('pin-del').addEventListener('click', () => {
    if (!selected) return;
    pins.splice(pins.indexOf(selected), 1);
    savePins(pins);
    select(null);
  });
  $('map-add').addEventListener('click', addHere);
  $('map-close').addEventListener('click', () => close());

  // Mouse and touch: drag to pan, wheel to zoom, tap a mark to select it.
  let drag: { id: number; x: number; y: number; moved: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dpr = canvas.width / canvas.getBoundingClientRect().width || 1;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    cx -= (dx * dpr) / (base * zoom);
    cz -= (dy * dpr) / (base * zoom);
    clampView();
    draw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const moved = drag.moved;
    drag = null;
    if (moved > 6) return;
    const r = canvas.getBoundingClientRect();
    const dpr = canvas.width / r.width || 1;
    const sx = (e.clientX - r.left) * dpr;
    const sy = (e.clientY - r.top) * dpr;
    let best: Pin | null = null;
    let bd = 22 * dpr;
    for (const pin of pins) {
      const [px, py] = toScreen(pin.x, pin.z);
      const d = Math.hypot(px - sx, py - 15 * dpr - sy);
      if (d < bd) {
        bd = d;
        best = pin;
      }
    }
    select(best);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const dpr = canvas.width / r.width || 1;
      const [wx, wz] = toWorld((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
      zoom = Math.max(1, Math.min(8, zoom * Math.exp(-e.deltaY * 0.0015)));
      // Keep the point under the mouse where it is.
      const k = base * zoom;
      cx = wx - ((e.clientX - r.left) * dpr - canvas.width / 2) / k;
      cz = wz - ((e.clientY - r.top) * dpr - canvas.height / 2) / k;
      clampView();
      draw();
    },
    { passive: false },
  );
  window.addEventListener('resize', () => {
    if (!open) return;
    resize();
    draw();
  });

  function show() {
    if (open) return;
    open = true;
    mapEl.hidden = false;
    document.body.classList.add('map-open');
    const p = h.player();
    zoom = 2;
    cx = p.x;
    cz = p.z;
    resize();
    clampView();
    select(null);
    h.opened();
  }

  function close() {
    if (!open) return;
    open = false;
    note.blur();
    mapEl.hidden = true;
    document.body.classList.remove('map-open');
    select(null);
    h.closed();
  }

  return {
    get open() {
      return open;
    },
    toggle() {
      if (open) close();
      else show();
    },
    close,
    update() {
      drawMini();
      draw();
    },
  };
}
