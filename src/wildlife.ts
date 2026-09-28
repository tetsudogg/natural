// Small animals that make the valley feel lived in: fish holding in the current,
// butterflies over the meadows, now and then a flock of birds or a soaring hawk,
// and a fox that sometimes trots along the edge of the forest.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import foxUrl from './assets/fox.glb?url';
import { HALF, clearingFactor, forestDensity, streamDist, streamX, waterLevel } from './world';
import { groundHeight } from './terrain';
import { mulberry32 } from './noise';
import { NO_REFLECT_LAYER } from './water';

const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

// Adds a time uniform and lets `bend` (GLSL, may use uTime, phase, position) move vertices.
function animated(mat: THREE.Material, uniforms: { uTime: { value: number } }, bend: string) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float phase;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n{ ${bend} }`);
  };
}

// ---------- Fish ----------

// A trout-like fish, nose toward -z: a slim body and a forked tail.
function fishGeometry() {
  const body = new THREE.SphereGeometry(1, 12, 8);
  body.scale(0.045, 0.055, 0.16);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.13, 0, 0.05, 0.24, 0, -0.05, 0.24], 3));
  tail.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  tail.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2));
  const g = mergeGeometries([body.toNonIndexed(), tail])!;
  // Dark speckled back, pale belly.
  const pos = g.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  const back = srgb(0.16, 0.17, 0.12);
  const belly = srgb(0.62, 0.6, 0.5);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(back).lerp(belly, THREE.MathUtils.smoothstep(-pos.getY(i), -0.01, 0.04));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

interface Fish {
  hx: number; // home: offset across the stream
  hz: number;
  x: number;
  z: number;
  y: number;
  heading: number;
  dart: number; // time left in a quick dart
  tx: number;
  tz: number;
}

function createFish(rnd: () => number) {
  const fish: Fish[] = [];
  for (let tries = 0; fish.length < 150 && tries < 4000; tries++) {
    const z = (rnd() * 2 - 1) * (HALF - 20);
    const off = (rnd() - 0.5) * 5;
    const x = streamX(z) + off;
    const depth = waterLevel(z) - groundHeight(x, z);
    if (depth < 0.35) continue;
    fish.push({ hx: off, hz: z, x, z, y: 0, heading: 0, dart: 0, tx: x, tz: z });
  }
  const count = fish.length;
  const uniforms = { uTime: { value: 0 } };
  const geo = fishGeometry();
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) phase[i] = rnd() * 100;
  geo.setAttribute('phase', new THREE.InstancedBufferAttribute(phase, 1));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide });
  // The body swings more toward the tail, like a swimming fish.
  animated(mat, uniforms, 'float k = max(position.z + 0.08, 0.0); transformed.x += sin(uTime * 9.0 + phase - position.z * 18.0) * k * 0.28;');
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.layers.set(NO_REFLECT_LAYER);
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  return {
    mesh,
    update(time: number, dt: number) {
      uniforms.uTime.value = time;
      for (let i = 0; i < count; i++) {
        const f = fish[i];
        // Hold station facing upstream (-z), drifting a little; now and then dart off.
        if (f.dart <= 0 && rnd() < dt * 0.08) {
          f.dart = 0.6 + rnd() * 0.6;
          f.tz = f.hz + (rnd() - 0.5) * 8;
          f.tx = streamX(f.tz) + THREE.MathUtils.clamp(f.hx + (rnd() - 0.5) * 2, -2.5, 2.5);
        }
        const speed = f.dart > 0 ? 2.2 : 0.25;
        f.dart -= dt;
        const wob = Math.sin(time * 0.4 + phase[i]) * 0.6;
        const gx = f.dart > 0 ? f.tx : streamX(f.z) + f.hx + wob * 0.5;
        const gz = f.dart > 0 ? f.tz : f.hz + wob;
        const dx = gx - f.x;
        const dz = gz - f.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.02) {
          const step = Math.min(d, speed * dt);
          f.x += (dx / d) * step;
          f.z += (dz / d) * step;
        }
        // Face the way it is darting, otherwise into the current.
        const want = f.dart > 0 && d > 0.1 ? Math.atan2(-dx, -dz) : Math.sin(time * 0.3 + phase[i]) * 0.25;
        f.heading += Math.atan2(Math.sin(want - f.heading), Math.cos(want - f.heading)) * Math.min(1, dt * 4);
        const bed = groundHeight(f.x, f.z);
        const surf = waterLevel(f.z);
        f.y = THREE.MathUtils.clamp(bed + 0.25, bed + 0.08, surf - 0.12);
        q.setFromAxisAngle(up, f.heading);
        p.set(f.x, f.y, f.z);
        s.setScalar(0.8 + (phase[i] % 1) * 0.6);
        mesh.setMatrixAt(i, m.compose(p, q, s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- Butterflies ----------

function butterflyGeometry() {
  // Two wings hinged on the body line (x = 0); the shader flaps them.
  const wing = (side: number) => {
    const g = new THREE.BufferGeometry();
    const v = [0, 0, -0.02, side * 0.05, 0, -0.045, side * 0.055, 0, 0.0, 0, 0, 0.02, side * 0.04, 0, 0.035];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex([0, 1, 2, 0, 2, 3, 3, 2, 4]);
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    return g;
  };
  return mergeGeometries([wing(1), wing(-1)])!;
}

interface Butterfly {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  home: THREE.Vector2;
}

function createButterflies(rnd: () => number) {
  const list: Butterfly[] = [];
  for (let tries = 0; list.length < 60 && tries < 5000; tries++) {
    const x = (rnd() * 2 - 1) * (HALF - 20);
    const z = (rnd() * 2 - 1) * (HALF - 20);
    if (forestDensity(x, z) > 0.35 && clearingFactor(x, z) < 0.3) continue;
    if (streamDist(x, z) < 5) continue;
    list.push({ x, y: groundHeight(x, z) + 0.8, z, vx: 0, vz: 0, home: new THREE.Vector2(x, z) });
  }
  const count = list.length;
  const uniforms = { uTime: { value: 0 } };
  const geo = butterflyGeometry();
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) phase[i] = rnd() * 100;
  geo.setAttribute('phase', new THREE.InstancedBufferAttribute(phase, 1));
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7 });
  animated(mat, uniforms, 'float a = (0.25 + 0.95 * (0.5 + 0.5 * sin(uTime * 22.0 + phase))) * sign(position.x); float r = abs(position.x); transformed.x = cos(a) * position.x; transformed.y += sin(abs(a)) * r;');
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.layers.set(NO_REFLECT_LAYER);
  const palette = [srgb(0.98, 0.97, 0.9), srgb(0.98, 0.86, 0.3), srgb(0.95, 0.55, 0.15), srgb(0.55, 0.7, 0.98), srgb(0.95, 0.95, 0.75)];
  for (let i = 0; i < count; i++) mesh.setColorAt(i, palette[Math.floor(rnd() * palette.length)]);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  return {
    mesh,
    update(time: number, dt: number, daylight: number) {
      mesh.visible = daylight > 0.35;
      if (!mesh.visible) return;
      uniforms.uTime.value = time;
      for (let i = 0; i < count; i++) {
        const b = list[i];
        // Wandering flight that keeps coming back to its patch of flowers.
        const ph = phase[i];
        b.vx += (Math.sin(time * 1.3 + ph) + (b.home.x - b.x) * 0.08) * dt * 2;
        b.vz += (Math.cos(time * 1.1 + ph * 1.7) + (b.home.y - b.z) * 0.08) * dt * 2;
        const sp = Math.hypot(b.vx, b.vz);
        if (sp > 1.4) {
          b.vx *= 1.4 / sp;
          b.vz *= 1.4 / sp;
        }
        b.x += b.vx * dt;
        b.z += b.vz * dt;
        b.y = groundHeight(b.x, b.z) + 0.5 + 0.35 * (0.5 + 0.5 * Math.sin(time * 2.3 + ph)) + 0.08 * Math.sin(time * 9 + ph);
        q.setFromEuler(e.set(0.2 * Math.sin(time * 3 + ph), Math.atan2(-b.vx, -b.vz), 0));
        mesh.setMatrixAt(i, m.compose(p.set(b.x, b.y, b.z), q, one));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- Birds ----------

// A small bird seen from below: body and two long wings that flap from the shoulder.
function birdGeometry() {
  const v = [
    // body
    0, 0, -0.12, 0.02, 0, 0.0, 0, 0, 0.14, -0.02, 0, 0.0,
    // right wing
    0.015, 0, -0.03, 0.26, 0, 0.02, 0.2, 0, 0.07, 0.015, 0, 0.04,
    // left wing
    -0.015, 0, -0.03, -0.26, 0, 0.02, -0.2, 0, 0.07, -0.015, 0, 0.04,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 10, 9, 8, 11, 10]);
  g.computeVertexNormals();
  return g;
}

interface Bird {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  soar: boolean;
  center: THREE.Vector3;
  radius: number;
  t: number;
}

function createBirds(rnd: () => number) {
  const max = 16;
  const birds: Bird[] = Array.from({ length: max }, () => ({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), soar: false, center: new THREE.Vector3(), radius: 0, t: 0 }));
  const uniforms = { uTime: { value: 0 } };
  const geo = birdGeometry();
  const phase = new Float32Array(max);
  const flapRate = new Float32Array(max);
  for (let i = 0; i < max; i++) phase[i] = rnd() * 100;
  geo.setAttribute('phase', new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute('flap', new THREE.InstancedBufferAttribute(flapRate, 1));
  const mat = new THREE.MeshStandardMaterial({ color: srgb(0.14, 0.13, 0.12), roughness: 0.9, side: THREE.DoubleSide });
  animated(
    mat,
    uniforms,
    // Beat the wings in bursts; between bursts they glide with wings held out.
    'float r = abs(position.x); float burst = smoothstep(0.2, 0.6, sin(uTime * 0.9 + phase)); float a = sin(uTime * flap + phase * 7.0) * 0.8 * burst; transformed.y += sin(a) * r; transformed.x = sign(position.x) * cos(a) * r;',
  );
  mat.onBeforeCompile = ((prev) => (shader: Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0], renderer: THREE.WebGLRenderer) => {
    prev.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('attribute float phase;', 'attribute float phase;\nattribute float flap;');
  })(mat.onBeforeCompile);
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const look = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const origin = new THREE.Vector3();
  const scale = new THREE.Vector3();
  let nextFlock = SHOW_NOW ? 0 : 20 + rnd() * 30;
  let nextHawk = 60 + rnd() * 60;

  function spawnFlock(near: THREE.Vector3) {
    const n = 4 + Math.floor(rnd() * 6);
    const ang = rnd() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const start = near.clone().addScaledVector(dir, -220);
    start.x += (rnd() - 0.5) * 120;
    start.y = near.y + 25 + rnd() * 30;
    let made = 0;
    for (const b of birds) {
      if (b.alive || made >= n) continue;
      b.alive = true;
      b.soar = false;
      b.t = 0;
      b.pos.copy(start).add(new THREE.Vector3((rnd() - 0.5) * 12, (rnd() - 0.5) * 5, (rnd() - 0.5) * 12));
      b.vel.copy(dir).multiplyScalar(11 + rnd() * 2);
      made++;
    }
  }

  function spawnHawk(near: THREE.Vector3) {
    const b = birds.find((x) => !x.alive);
    if (!b) return;
    b.alive = true;
    b.soar = true;
    b.t = 0;
    b.center.set(near.x + (rnd() - 0.5) * 120, near.y + 55 + rnd() * 30, near.z + (rnd() - 0.5) * 120);
    b.radius = 25 + rnd() * 20;
  }

  return {
    mesh,
    update(time: number, dt: number, daylight: number, viewer: THREE.Vector3) {
      uniforms.uTime.value = time;
      if (daylight > 0.3) {
        if ((nextFlock -= dt) < 0) {
          spawnFlock(viewer);
          nextFlock = 50 + rnd() * 90;
        }
        if ((nextHawk -= dt) < 0) {
          spawnHawk(viewer);
          nextHawk = 150 + rnd() * 150;
        }
      }
      birds.forEach((b, i) => {
        if (!b.alive) {
          mesh.setMatrixAt(i, zero);
          return;
        }
        b.t += dt;
        if (b.soar) {
          // Wide, slow circles, then off and away after a couple of minutes.
          const a = b.t * 0.12 + phase[i];
          const leaving = Math.max(0, b.t - 110);
          b.pos.set(b.center.x + Math.cos(a) * b.radius + leaving * 8, b.center.y + leaving * 2, b.center.z + Math.sin(a) * b.radius);
          b.vel.set(-Math.sin(a), 0, Math.cos(a));
          flapRate[i] = 6;
          scale.setScalar(4);
          if (b.t > 160) b.alive = false;
        } else {
          b.vel.y = Math.sin(b.t * 0.7 + phase[i]) * 0.8;
          b.pos.addScaledVector(b.vel, dt);
          flapRate[i] = 16;
          scale.setScalar(1.3);
          if (b.t > 45) b.alive = false;
        }
        look.lookAt(origin, b.vel, up);
        q.setFromRotationMatrix(look);
        mesh.setMatrixAt(i, m.compose(b.pos, q, scale));
      });
      (geo.attributes.flap as THREE.InstancedBufferAttribute).needsUpdate = true;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- Fox ----------
// Model: "Fox" from the Khronos glTF sample assets. Mesh by PixelMannen (CC0),
// rigging and animation by tomkranis (CC BY 4.0), glTF by @AsoboStudio and @scurest (CC BY 4.0).

// ?wildlife=now brings the fox and a flock of birds out right away (for checking).
const SHOW_NOW = new URLSearchParams(location.search).get('wildlife') === 'now';

function createFox(rnd: () => number) {
  const root = new THREE.Group();
  root.visible = false;
  let mixer: THREE.AnimationMixer | null = null;
  const actions: Record<string, THREE.AnimationAction> = {};
  let current = '';
  new GLTFLoader().load(foxUrl, (gltf) => {
    const model = gltf.scene;
    // The model is in centimetre-like units and faces +z: scale it to a real fox,
    // about 45 cm at the shoulder.
    model.scale.setScalar(0.0072);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        const mesh = o as THREE.SkinnedMesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.roughness = 0.9;
        mat.metalness = 0;
        mesh.frustumCulled = false;
      }
    });
    root.add(model);
    mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  });
  function play(name: string) {
    if (current === name || !actions[name]) return;
    const next = actions[name];
    next.reset().play();
    if (current) actions[current].crossFadeTo(next, 0.4, false);
    current = name;
  }

  // A visit: appear some way off, trot along a path, stop to look around, trot on.
  let wait = SHOW_NOW ? 0 : 40 + rnd() * 60;
  let active = false;
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let pause = 0;
  let pausedOnce = false;
  let travelled = 0;
  let pathLength = 0;

  function start(viewer: THREE.Vector3, viewDir: THREE.Vector3) {
    // Somewhere in front of the viewer, off to one side, walking across the view.
    const side = rnd() < 0.5 ? -1 : 1;
    const ahead = SHOW_NOW ? 10 : 18 + rnd() * 18;
    const across = new THREE.Vector3(-viewDir.z, 0, viewDir.x).multiplyScalar(side);
    pos.copy(viewer).addScaledVector(viewDir, ahead).addScaledVector(across, SHOW_NOW ? 3 : 14 + rnd() * 6);
    if (streamDist(pos.x, pos.z) < 6) return false;
    dir.copy(across).negate().addScaledVector(viewDir, (rnd() - 0.5) * 0.6).setY(0).normalize();
    active = true;
    pause = 0;
    pausedOnce = false;
    travelled = 0;
    pathLength = 30 + rnd() * 20;
    root.visible = true;
    play('Walk');
    return true;
  }

  const viewDir = new THREE.Vector3();
  return {
    root,
    update(dt: number, daylight: number, viewer: THREE.Vector3, camera: THREE.Camera) {
      if (!mixer) return;
      if (!active) {
        root.visible = false;
        if (daylight < 0.15) return;
        wait -= dt;
        if (wait > 0) return;
        camera.getWorldDirection(viewDir).setY(0).normalize();
        if (!start(viewer, viewDir)) {
          wait = 5;
          return;
        }
      }
      mixer.update(dt);
      if (pause > 0) {
        pause -= dt;
        play('Survey');
      } else {
        // Halfway along it stops once to look around.
        if (!pausedOnce && travelled > pathLength * 0.45 && rnd() < dt * 0.8) {
          pausedOnce = true;
          pause = 3 + rnd() * 4;
        }
        // Trots off faster on the way out.
        const speed = travelled > pathLength * 0.7 ? 3.2 : 1.1;
        play(speed > 2 ? 'Run' : 'Walk');
        // Steer around the stream and gently wander.
        const ahead = pos.clone().addScaledVector(dir, 4);
        if (streamDist(ahead.x, ahead.z) < 6) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 1.5);
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(travelled * 0.3) * dt * 0.3);
        pos.addScaledVector(dir, speed * dt);
        travelled += speed * dt;
      }
      pos.y = groundHeight(pos.x, pos.z);
      root.position.copy(pos);
      root.rotation.y = Math.atan2(dir.x, dir.z);
      if (travelled > pathLength + 25 || Math.abs(pos.x) > HALF - 5 || Math.abs(pos.z) > HALF - 5) {
        active = false;
        root.visible = false;
        wait = 90 + rnd() * 120;
      }
    },
  };
}

export function createWildlife() {
  const rnd = mulberry32(99);
  const fish = createFish(rnd);
  const butterflies = createButterflies(rnd);
  const birds = createBirds(rnd);
  const fox = createFox(rnd);
  const group = new THREE.Group();
  group.add(fish.mesh, butterflies.mesh, birds.mesh, fox.root);
  return {
    group,
    update(time: number, dt: number, daylight: number, viewer: THREE.Vector3, camera: THREE.Camera) {
      fish.update(time, dt);
      fox.update(dt, daylight, viewer, camera);
      butterflies.update(time, dt, daylight);
      birds.update(time, dt, daylight, viewer);
    },
  };
}
