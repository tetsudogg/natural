// Walking, looking around, and first/third person views.

import * as THREE from 'three';
import { groundHeight } from './terrain';
import { WALK_LIMIT, streamDist, forestDensity } from './world';

const EYE = 1.6;
const WALK = 1.7;
const RUN = 5.3;

export type ViewMode = 'first' | 'third';

export class Player {
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  view: ViewMode = 'first';
  readonly body: THREE.Group;
  private keys = new Set<string>();
  private velocity = new THREE.Vector3();
  private stepPhase = 0;
  private bob = 0;
  private camDist = 4.2;
  // Something solid (the tent) that can't be walked into.
  blocker: ((x: number, z: number) => boolean) | null = null;
  onStep: ((ground: 'grass' | 'gravel' | 'forest', running: boolean) => void) | null = null;

  constructor(x: number, z: number, yaw: number) {
    this.position.set(x, groundHeight(x, z), z);
    this.yaw = yaw;
    this.body = makeBody();
    this.body.visible = false;
  }

  keyDown(code: string) {
    this.keys.add(code);
  }
  keyUp(code: string) {
    this.keys.delete(code);
  }
  releaseKeys() {
    this.keys.clear();
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.35, 1.35);
  }

  setView(v: ViewMode) {
    this.view = v;
    this.body.visible = v === 'third';
  }

  update(dt: number, canMove: boolean) {
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    const want = new THREE.Vector3();
    if (canMove && (fwd || side)) {
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      want.set(-sin * fwd + cos * side, 0, -cos * fwd - sin * side).normalize().multiplyScalar(running ? RUN : WALK);
    }
    this.velocity.lerp(want, Math.min(1, dt * 6));
    const speed = this.velocity.length();

    const next = this.position.clone().addScaledVector(this.velocity, dt);
    next.x = THREE.MathUtils.clamp(next.x, -WALK_LIMIT, WALK_LIMIT);
    next.z = THREE.MathUtils.clamp(next.z, -WALK_LIMIT, WALK_LIMIT);
    // Too steep to climb: stay put.
    const rise = groundHeight(next.x, next.z) - groundHeight(this.position.x, this.position.z);
    const run = Math.hypot(next.x - this.position.x, next.z - this.position.z);
    if (run > 0 && rise / run < 1.4 && !this.blocker?.(next.x, next.z)) {
      this.position.x = next.x;
      this.position.z = next.z;
    }
    const gy = groundHeight(this.position.x, this.position.z);
    this.position.y += (gy - this.position.y) * Math.min(1, dt * 12);

    // Footsteps and a gentle head bob.
    if (speed > 0.3) {
      const prev = this.stepPhase;
      // Longer strides when running: about 0.9 m a step walking, 1.4 m at full run.
      const stride = THREE.MathUtils.mapLinear(THREE.MathUtils.clamp(speed, WALK, RUN), WALK, RUN, 0.87, 1.4);
      this.stepPhase += (dt * speed) / stride;
      if (Math.floor(prev) !== Math.floor(this.stepPhase) && this.onStep) {
        const d = streamDist(this.position.x, this.position.z);
        const ground = d < 5.5 ? 'gravel' : forestDensity(this.position.x, this.position.z) > 0.5 ? 'forest' : 'grass';
        this.onStep(ground, running);
      }
    }
    const targetBob = speed > 0.3 ? Math.sin(this.stepPhase * Math.PI * 2) * 0.035 * Math.min(1, speed / WALK) : 0;
    this.bob += (targetBob - this.bob) * Math.min(1, dt * 10);

    this.body.position.copy(this.position);
    if (speed > 0.2) {
      const face = Math.atan2(-this.velocity.x, -this.velocity.z);
      this.body.rotation.y = lerpAngle(this.body.rotation.y, face, Math.min(1, dt * 8));
    }
    const legs = this.body.userData.legs as THREE.Object3D[];
    const swing = speed > 0.2 ? Math.sin(this.stepPhase * Math.PI) * Math.min(0.5, 0.5 * speed / WALK) * (1 + 0.6 * THREE.MathUtils.smoothstep(speed, WALK, RUN)) : 0;
    legs[0].rotation.x = swing;
    legs[1].rotation.x = -swing;
  }

  applyCamera(cam: THREE.PerspectiveCamera) {
    const eye = new THREE.Vector3(this.position.x, this.position.y + EYE + this.bob, this.position.z);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    if (this.view === 'first') {
      cam.position.copy(eye);
      cam.lookAt(eye.clone().add(dir));
      return;
    }
    const target = eye.clone().add(new THREE.Vector3(0, 0.25, 0));
    const pos = target.clone().addScaledVector(dir, -this.camDist);
    pos.y = Math.max(pos.y, groundHeight(pos.x, pos.z) + 1.3);
    cam.position.copy(pos);
    cam.lookAt(target);
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// A simple hiker: jacket, trousers, hat and a backpack.
function makeBody() {
  const g = new THREE.Group();
  const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
  const jacket = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 4, 10), mat(0x5a6b4a));
  jacket.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mat(0xd9b99a));
  head.position.y = 1.62;
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 20), mat(0xb49a6a));
  hat.position.y = 1.72;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.1, 16), mat(0xb49a6a));
  crown.position.y = 1.77;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.2), mat(0x8a4a2a));
  pack.position.set(0, 1.25, 0.24);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.42, 12), mat(0x3d5a6b));
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, 1.55, 0.26);
  const legs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.1 * s, 0.85, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 4, 8), mat(0x3b3a36));
    leg.position.y = -0.4;
    pivot.add(leg);
    legs.push(pivot);
    g.add(pivot);
  }
  g.add(jacket, head, hat, crown, pack, roll);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  g.userData.legs = legs;
  return g;
}
