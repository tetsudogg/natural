// Little life at the water's edge, kept near the player: freshwater crabs (sawagani)
// on the stones along the brooks and the stream, schools of tiny fry in the shallows,
// and the splashes your feet make when you wade.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HALF, brooks, streamX, waterLevel } from './world';
import { groundHeight, waterSurfaceAt } from './terrain';
import { mulberry32 } from './noise';
import { NO_REFLECT_LAYER } from './water';

const UP = new THREE.Vector3(0, 1, 0);

// Points along the water: every brook sample and the stream's centre every 2 m.
interface WaterPoint {
  x: number;
  z: number;
  nx: number; // across the channel (unit)
  nz: number;
  half: number; // half width of the water
}

function waterPoints(): WaterPoint[] {
  const pts: WaterPoint[] = [];
  for (const b of brooks()) {
    const n = b.x.length;
    for (let k = 1; k < n - 1; k++) {
      const tx = b.x[k + 1] - b.x[k - 1];
      const tz = b.z[k + 1] - b.z[k - 1];
      const l = Math.hypot(tx, tz) || 1;
      pts.push({ x: b.x[k], z: b.z[k], nx: -tz / l, nz: tx / l, half: b.width[k] });
    }
  }
  for (let z = -HALF + 10; z < HALF - 10; z += 2) {
    const x = streamX(z);
    let half = 0;
    while (half < 12 && groundHeight(x + half, z) < waterLevel(z)) half += 0.25;
    if (half > 0.5) pts.push({ x, z, nx: 1, nz: 0, half });
  }
  return pts;
}

// ---------- Crabs ----------

// A sawagani about 9 cm across the legs: a smooth rounded carapace, two claws (one a
// little bigger) and four legs a side. Faces -z; x is its sideways direction.
function crabGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const shell = new THREE.SphereGeometry(0.026, 12, 8);
  shell.scale(1.15, 0.45, 0.95);
  shell.translate(0, 0.018, 0);
  parts.push(shell);
  for (const side of [-1, 1]) {
    // Claws, held in front.
    const big = side > 0 ? 1.2 : 1;
    const arm = new THREE.CylinderGeometry(0.004, 0.005, 0.022, 5);
    arm.rotateX(Math.PI / 2);
    arm.rotateY(side * 0.5);
    arm.translate(side * 0.016, 0.014, -0.026);
    parts.push(arm);
    const claw = new THREE.SphereGeometry(0.009 * big, 8, 6);
    claw.scale(1, 0.75, 1.5);
    claw.translate(side * 0.022, 0.016, -0.04);
    parts.push(claw);
    // Legs: out to the side and down to the ground.
    for (let l = 0; l < 4; l++) {
      const a = (l - 1.5) * 0.38;
      const leg = new THREE.CylinderGeometry(0.0022, 0.0028, 0.042, 4);
      leg.rotateZ(side * (Math.PI / 2 - 0.55));
      leg.rotateY(a * side);
      const ox = Math.cos(a) * 0.036 * side;
      const oz = Math.sin(a) * 0.036;
      leg.translate(ox * 0.85, 0.011, oz * 0.85);
      parts.push(leg);
    }
  }
  const eyes = new THREE.SphereGeometry(0.0035, 6, 4);
  const e2 = eyes.clone();
  eyes.translate(-0.008, 0.03, -0.022);
  e2.translate(0.008, 0.03, -0.022);
  parts.push(eyes, e2);
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  g.computeVertexNormals();
  return g;
}

interface Crab {
  x: number;
  z: number;
  y: number;
  yaw: number;
  tx: number;
  tz: number;
  moving: number;
  hidden: number; // > 0 while tucked under a stone
}

// ---------- Fry ----------

// A tiny fish, 4 to 5 cm, nose toward -z.
function fryGeometry() {
  const g = new THREE.SphereGeometry(0.006, 8, 5);
  g.scale(0.8, 1, 4);
  const tail = new THREE.ConeGeometry(0.006, 0.014, 4);
  tail.rotateX(-Math.PI / 2);
  tail.scale(0.3, 1, 1);
  tail.translate(0, 0, 0.028);
  return mergeGeometries([g.toNonIndexed(), tail.toNonIndexed()])!;
}

interface School {
  x: number;
  z: number;
  vx: number;
  vz: number;
  scare: number;
  surface: number;
  bed: number;
  members: { ox: number; oz: number; ph: number; yaw: number }[];
}

// ---------- Splashes ----------

const dropVert = /* glsl */ `
  attribute vec4 vel; // velocity xyz, start time
  attribute float size;
  uniform float uTime;
  varying float vAlpha;
  void main() {
    float t = uTime - vel.w;
    float life = t / 0.7;
    vec3 p = position + vel.xyz * t + vec3(0.0, -4.9 * t * t, 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = (life >= 0.0 && life < 1.0 && p.y > position.y - 0.03) ? (1.0 - life) : 0.0;
    gl_PointSize = size * 300.0 / -mv.z;
  }
`;
const dropFrag = /* glsl */ `
  uniform float uLight;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25 || vAlpha <= 0.0) discard;
    gl_FragColor = vec4(vec3(0.92, 0.96, 1.0) * (uLight * 0.9 + 0.05), smoothstep(0.25, 0.05, d) * vAlpha * 0.85);
    #include <colorspace_fragment>
  }
`;
const ringVert = /* glsl */ `
  attribute float born;
  uniform float uTime;
  varying vec2 vUv;
  varying float vAge;
  void main() {
    vUv = uv;
    vAge = (uTime - born) / 1.4;
    float s = 0.15 + clamp(vAge, 0.0, 1.0) * 0.9;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position * s, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const ringFrag = /* glsl */ `
  uniform float uLight;
  varying vec2 vUv;
  varying float vAge;
  void main() {
    if (vAge < 0.0 || vAge > 1.0) discard;
    float r = length(vUv - 0.5) * 2.0;
    float ring = smoothstep(0.75, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r));
    float inner = (1.0 - smoothstep(0.0, 0.5, r)) * (1.0 - smoothstep(0.0, 0.3, vAge)) * 0.6;
    float a = (ring * 0.55 + inner) * (1.0 - vAge);
    gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * (uLight * 0.85 + 0.05), a);
    #include <colorspace_fragment>
  }
`;

const DROPS = 360;
const RINGS = 10;

export function createCritters() {
  const rnd = mulberry32(2024);
  const group = new THREE.Group();
  const points = waterPoints();

  // Crabs.
  const CRABS = 22;
  const crabs: Crab[] = [];
  const crabMat = new THREE.MeshStandardMaterial({ roughness: 0.45 });
  const crabMesh = new THREE.InstancedMesh(crabGeometry(), crabMat, CRABS);
  crabMesh.frustumCulled = false;
  crabMesh.layers.set(NO_REFLECT_LAYER);
  const crabTints = [
    [0.62, 0.2, 0.1],
    [0.5, 0.26, 0.16],
    [0.36, 0.24, 0.3],
    [0.68, 0.32, 0.12],
  ];
  for (let i = 0; i < CRABS; i++) {
    crabs.push({ x: 1e5, z: 1e5, y: 0, yaw: 0, tx: 0, tz: 0, moving: 0, hidden: 0 });
    const c = crabTints[i % crabTints.length];
    crabMesh.setColorAt(i, new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace));
  }
  group.add(crabMesh);

  // Fry.
  const SCHOOLS = 7;
  const PER = 9;
  const schools: School[] = [];
  const fryMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.6, 0.58, 0.48, THREE.SRGBColorSpace), roughness: 0.4, transparent: true, opacity: 0.9 });
  const fryMesh = new THREE.InstancedMesh(fryGeometry(), fryMat, SCHOOLS * PER);
  fryMesh.frustumCulled = false;
  fryMesh.layers.set(NO_REFLECT_LAYER);
  for (let s = 0; s < SCHOOLS; s++) {
    const members = [];
    for (let i = 0; i < PER; i++) members.push({ ox: (rnd() - 0.5) * 0.5, oz: (rnd() - 0.5) * 0.5, ph: rnd() * 10, yaw: 0 });
    schools.push({ x: 1e5, z: 1e5, vx: 0, vz: 0, scare: 0, surface: 0, bed: 0, members });
  }
  group.add(fryMesh);

  // Splashes: droplets and spreading rings.
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(DROPS * 3), 3));
  dropGeo.setAttribute('vel', new THREE.Float32BufferAttribute(new Float32Array(DROPS * 4).fill(-100), 4));
  dropGeo.setAttribute('size', new THREE.Float32BufferAttribute(new Float32Array(DROPS), 1));
  const dropMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uLight: { value: 1 } }, vertexShader: dropVert, fragmentShader: dropFrag, transparent: true, depthWrite: false });
  const drops = new THREE.Points(dropGeo, dropMat);
  drops.frustumCulled = false;
  drops.renderOrder = 4;
  group.add(drops);
  const ringGeo = new THREE.PlaneGeometry(1, 1);
  ringGeo.rotateX(-Math.PI / 2);
  ringGeo.setAttribute('born', new THREE.InstancedBufferAttribute(new Float32Array(RINGS).fill(-100), 1));
  const ringMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uLight: { value: 1 } }, vertexShader: ringVert, fragmentShader: ringFrag, transparent: true, depthWrite: false });
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, RINGS);
  rings.frustumCulled = false;
  rings.renderOrder = 4;
  group.add(rings);
  let nextDrop = 0;
  let nextRing = 0;
  let clock = 0;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();

  const nearPoint = (px: number, pz: number, r0: number, r1: number) => {
    for (let tries = 0; tries < 30; tries++) {
      const w = points[Math.floor(rnd() * points.length)];
      const d = Math.hypot(w.x - px, w.z - pz);
      if (d > r0 && d < r1) return w;
    }
    return null;
  };

  function placeCrab(c: Crab, px: number, pz: number, near: number) {
    const w = nearPoint(px, pz, near, 26);
    if (!w) return;
    // On the bank just above the water, or on a stone at its edge.
    const side = rnd() < 0.5 ? -1 : 1;
    const o = w.half + 0.1 + rnd() * 0.9;
    c.x = w.x + w.nx * o * side;
    c.z = w.z + w.nz * o * side;
    c.tx = c.x;
    c.tz = c.z;
    c.yaw = rnd() * 6.28;
    c.hidden = 0;
    c.moving = 0;
  }

  function placeSchool(s: School, px: number, pz: number, near: number) {
    for (let tries = 0; tries < 10; tries++) {
      const w = nearPoint(px, pz, near, 24);
      if (!w) return;
      const o = (rnd() - 0.5) * w.half;
      const x = w.x + w.nx * o;
      const z = w.z + w.nz * o;
      const surf = waterSurfaceAt(x, z);
      if (surf === null || surf - groundHeight(x, z) < 0.07) continue;
      s.x = x;
      s.z = z;
      s.vx = s.vz = 0;
      s.scare = 0;
      return;
    }
  }

  return {
    group,
    debug: { crabs, schools },
    // A footstep in the water: droplets kicked up and a ring spreading on the surface.
    splash(x: number, y: number, z: number, strength: number) {
      const pos = dropGeo.attributes.position as THREE.BufferAttribute;
      const vel = dropGeo.attributes.vel as THREE.BufferAttribute;
      const size = dropGeo.attributes.size as THREE.BufferAttribute;
      const n = Math.round(14 + strength * 16);
      for (let i = 0; i < n; i++) {
        const k = nextDrop;
        nextDrop = (nextDrop + 1) % DROPS;
        const a = rnd() * Math.PI * 2;
        const r = rnd() * 0.12;
        pos.setXYZ(k, x + Math.cos(a) * r, y, z + Math.sin(a) * r);
        const h = 0.4 + rnd() * 0.9 * (0.7 + strength * 0.5);
        vel.setXYZW(k, Math.cos(a) * h * 0.7, 1.0 + rnd() * 1.2 * (0.7 + strength * 0.4), Math.sin(a) * h * 0.7, clock);
        size.setX(k, 0.012 + rnd() * 0.02);
      }
      pos.needsUpdate = vel.needsUpdate = size.needsUpdate = true;
      const born = ringGeo.attributes.born as THREE.InstancedBufferAttribute;
      born.setX(nextRing, clock);
      born.needsUpdate = true;
      rings.setMatrixAt(nextRing, m.compose(p.set(x, y + 0.01, z), q.identity(), sc.setScalar(0.5 + strength * 0.3)));
      rings.instanceMatrix.needsUpdate = true;
      nextRing = (nextRing + 1) % RINGS;
    },
    update(time: number, dt: number, viewer: THREE.Vector3, daylight: number) {
      clock = time;
      const light = 0.08 + 0.92 * daylight;
      dropMat.uniforms.uTime.value = time;
      dropMat.uniforms.uLight.value = light;
      ringMat.uniforms.uTime.value = time;
      ringMat.uniforms.uLight.value = light;

      // Crabs: sit, now and then scuttle sideways; hide when someone comes close.
      for (let i = 0; i < CRABS; i++) {
        const c = crabs[i];
        const d = Math.hypot(c.x - viewer.x, c.z - viewer.z);
        if (d > 30) placeCrab(c, viewer.x, viewer.z, 8);
        if (c.hidden > 0) {
          c.hidden -= dt;
          if (c.hidden <= 0) {
            if (d < 4) c.hidden = 2;
            else placeCrab(c, viewer.x, viewer.z, 6);
          }
        } else if (d < 1.6 && c.moving <= 0) {
          // Startled: dash sideways toward the water, then tuck under a stone.
          const sx = Math.cos(c.yaw);
          const sz = -Math.sin(c.yaw);
          const away = (c.x - viewer.x) * sx + (c.z - viewer.z) * sz > 0 ? 1 : -1;
          c.tx = c.x + sx * away * 0.6;
          c.tz = c.z + sz * away * 0.6;
          c.moving = 0.5;
          c.hidden = -1; // hide after this dash
        } else if (c.moving <= 0 && rnd() < dt * 0.25) {
          const sx = Math.cos(c.yaw);
          const sz = -Math.sin(c.yaw);
          const step = (rnd() - 0.5) * 0.8;
          c.tx = c.x + sx * step;
          c.tz = c.z + sz * step;
          c.moving = 0.6;
          c.yaw += (rnd() - 0.5) * 0.6;
        }
        if (c.moving > 0) {
          c.moving -= dt;
          const k = Math.min(1, dt * 6);
          c.x += (c.tx - c.x) * k;
          c.z += (c.tz - c.z) * k;
          if (c.moving <= 0 && c.hidden < 0) c.hidden = 3 + rnd() * 4;
        }
        const g = groundHeight(c.x, c.z);
        const hiddenNow = c.hidden > 0;
        c.y = g + (c.moving > 0 ? Math.abs(Math.sin(time * 40 + i)) * 0.004 : 0);
        q.setFromAxisAngle(UP, c.yaw);
        crabMesh.setMatrixAt(i, m.compose(p.set(c.x, hiddenNow ? -1000 : c.y, c.z), q, sc.setScalar(1)));
      }
      crabMesh.instanceMatrix.needsUpdate = true;

      // Fry: schools drift and turn together; scatter when you wade close.
      let idx = 0;
      for (const s of schools) {
        const d = Math.hypot(s.x - viewer.x, s.z - viewer.z);
        if (d > 28) placeSchool(s, viewer.x, viewer.z, 6);
        if (d < 2.2) s.scare = 1;
        s.scare = Math.max(0, s.scare - dt * 0.8);
        const wander = 0.12 + s.scare * 1.2;
        s.vx += (Math.sin(time * 0.7 + idx) * wander - s.vx) * Math.min(1, dt * 2);
        s.vz += (Math.cos(time * 0.53 + idx * 1.7) * wander - s.vz) * Math.min(1, dt * 2);
        if (s.scare > 0.5 && d > 0.01) {
          s.vx += ((s.x - viewer.x) / d) * dt * 6;
          s.vz += ((s.z - viewer.z) / d) * dt * 6;
        }
        const nx = s.x + s.vx * dt;
        const nz = s.z + s.vz * dt;
        const surf = waterSurfaceAt(nx, nz);
        if (surf !== null && surf - groundHeight(nx, nz) > 0.06) {
          s.x = nx;
          s.z = nz;
          s.surface = surf;
          s.bed = groundHeight(nx, nz);
        } else {
          s.vx *= -0.5;
          s.vz *= -0.5;
        }
        const heading = Math.atan2(-s.vx, -s.vz);
        const y = Math.max(s.bed + 0.03, s.surface - 0.06);
        for (const f of s.members) {
          const jx = Math.sin(time * 2.3 + f.ph) * 0.06;
          const jz = Math.cos(time * 1.9 + f.ph * 1.3) * 0.06;
          const spread = 1 + s.scare * 2;
          const want = heading + Math.sin(time * 3 + f.ph) * 0.4;
          f.yaw += Math.atan2(Math.sin(want - f.yaw), Math.cos(want - f.yaw)) * Math.min(1, dt * 5);
          q.setFromAxisAngle(UP, f.yaw);
          fryMesh.setMatrixAt(idx++, m.compose(p.set(s.x + f.ox * spread + jx, y + Math.sin(f.ph) * 0.015, s.z + f.oz * spread + jz), q, sc.setScalar(1.1 + (f.ph % 1) * 0.5)));
        }
      }
      fryMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
