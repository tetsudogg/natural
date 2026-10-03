// The pond at the valley's end: still water that mirrors the mountains, turquoise over
// the pale gravel of its shallows, dead trees standing in it, and larch woods on its
// shores beyond where you can walk.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HALF, POND, POND_LEVEL, heightAt, pondMask } from './world';
import { waterNormalTexture } from './textures';
import { fbm, mulberry32, smoothstep } from './noise';
import { createMirror } from './water';

const vert = /* glsl */ `
  uniform mat4 textureMatrix;
  attribute float depth;
  varying vec4 vMirrorCoord;
  varying vec3 vWorldPos;
  varying float vDepth;
  #include <fog_pars_vertex>
  void main() {
    vDepth = depth;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vMirrorCoord = textureMatrix * wp;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const frag = /* glsl */ `
  uniform sampler2D tReflection;
  uniform sampler2D tNormal;
  uniform float uTime;
  uniform float uReflect;
  uniform float uTexel;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uSky;
  uniform float uLight;
  varying vec4 vMirrorCoord;
  varying vec3 vWorldPos;
  varying float vDepth;
  #include <common>
  float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(vhash(i), vhash(i + vec2(1, 0)), u.x), mix(vhash(i + vec2(0, 1)), vhash(i + vec2(1, 1)), u.x), u.y);
  }
  #include <fog_pars_fragment>
  void main() {
    if (vDepth < -0.05) discard;
    vec2 p = vWorldPos.xz;
    // Mostly glassy; now and then a breath of wind roughens a patch that drifts across.
    float gust = smoothstep(0.62, 0.88, vnoise(p * 0.012 + vec2(uTime * 0.02, -uTime * 0.013)));
    float amp = 0.008 + gust * 0.045;
    vec3 n1 = texture2D(tNormal, p * 0.05 + vec2(uTime * 0.004, uTime * 0.003)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(tNormal, p * 0.13 - vec2(uTime * 0.006, -uTime * 0.005)).xyz * 2.0 - 1.0;
    vec3 n = normalize(vec3((n1.x + n2.x * 0.6) * amp, 1.0, (n1.y + n2.y * 0.6) * amp));

    vec3 view = normalize(cameraPosition - vWorldPos);
    float facing = max(dot(view, n), 0.0);
    float fresnel = 0.025 + 0.975 * pow(1.0 - facing, 5.0);

    vec4 mc = vMirrorCoord;
    // Ripples shift the reflection less far off: at the far shore any shift would
    // reach past the reflected shoreline into the clipped, empty part of the mirror.
    float far = clamp(40.0 / length(cameraPosition - vWorldPos), 0.0, 1.0);
    mc.xy += n.xz * mc.w * 0.6 * far;
    // The half-size mirror blends its row at the shoreline with the clipped-away sky beyond
    // it; reading a texel and a half lower keeps the far shore free of a bright seam.
    mc.y -= uTexel * 1.5 * mc.w;
    vec3 refl = texture2DProj(tReflection, mc).rgb;
    refl = mix(uSky * uLight, refl, uReflect);

    // Turquoise over the pale gravel of the shallows, deep blue-green further out.
    float d = clamp(vDepth / 4.0, 0.0, 1.0);
    vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 1.0, d)) * uLight;
    // Calm water mirrors strongly, even over the shallows and looking down: the pebbles
    // show faintly through the mountains' reflection.
    float r = max(fresnel, mix(0.6, 0.9, smoothstep(0.05, 1.5, vDepth)));
    vec3 col = mix(body, refl * 0.92, r);
    vec3 h = normalize(uSunDir + view);
    col += uSunColor * pow(max(dot(n, h), 0.0), 600.0) * 4.0;
    // The water's edge: clear enough to see the bottom.
    float alpha = mix(0.25, 1.0, smoothstep(0.0, 1.6, vDepth)) * (0.75 + 0.25 * r);
    alpha = max(alpha, max(fresnel, r * 0.85));
    alpha *= smoothstep(-0.05, 0.12, vDepth);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// A dead tree standing in the water: a pale, weathered trunk with a few broken limbs.
function deadTreeGeometry(seed: number) {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const h = 7 + rnd() * 5;
  const trunk = new THREE.CylinderGeometry(0.09, 0.24, h, 7, 6);
  const tp = trunk.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i) / h + 0.5;
    tp.setX(i, tp.getX(i) + Math.sin(y * 3 + seed) * 0.15 * y);
    tp.setZ(i, tp.getZ(i) + Math.cos(y * 2.3 + seed) * 0.12 * y);
  }
  trunk.translate(0, h / 2 - 1, 0);
  parts.push(trunk);
  const limbs = 2 + Math.floor(rnd() * 4);
  for (let l = 0; l < limbs; l++) {
    const len = 0.4 + rnd() * 1.6;
    const limb = new THREE.CylinderGeometry(0.02, 0.06, len, 5);
    limb.translate(0, len / 2, 0);
    limb.rotateZ(0.6 + rnd() * 0.7);
    limb.rotateY(rnd() * Math.PI * 2);
    const y = h * (0.45 + rnd() * 0.45) - 1;
    limb.translate(Math.sin((y + 1) / h * 3 + seed) * 0.15 * ((y + 1) / h), y, 0);
    parts.push(limb);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  g.computeVertexNormals();
  return g;
}

// A larch: a slim, airy spire of soft green tiers. A spruce: a darker, denser cone.
export function coniferGeometry(seed: number, tiers: number, width: number, height: number) {
  const rnd = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.22, height * 0.5, 5);
  trunk.translate(0, height * 0.25, 0);
  parts.push(trunk);
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const r = width * (1 - f * 0.85) * (0.85 + rnd() * 0.3);
    const tier = new THREE.ConeGeometry(r, (height / tiers) * 1.9, 7, 1, true);
    // Ragged tiers: each one nudged and tilted a little.
    tier.rotateX((rnd() - 0.5) * 0.12);
    tier.translate((rnd() - 0.5) * 0.3, height * 0.22 + f * height * 0.72, (rnd() - 0.5) * 0.3);
    parts.push(tier);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  g.computeVertexNormals();
  return g;
}

export function createPond() {
  const group = new THREE.Group();
  const rnd = mulberry32(4711);

  // The water: a grid over the basin; each vertex knows how deep the water is there.
  const x0 = POND.x - POND.rx * 1.25;
  const x1 = POND.x + POND.rx * 1.25;
  const z0 = 200;
  const z1 = POND.z + POND.rz * 1.25;
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 180, 180);
  geo.rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, POND_LEVEL, (z0 + z1) / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = POND_LEVEL - heightAt(pos.getX(i), pos.getZ(i));
  geo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));

  const target = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
  const textureMatrix = new THREE.Matrix4();
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        tReflection: { value: null },
        tNormal: { value: null },
        textureMatrix: { value: null },
        uTime: { value: 0 },
        uReflect: { value: 1 },
        uTexel: { value: 1 / 256 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uShallow: { value: new THREE.Color().setRGB(0.34, 0.7, 0.62, THREE.SRGBColorSpace) },
        uDeep: { value: new THREE.Color().setRGB(0.04, 0.24, 0.34, THREE.SRGBColorSpace) },
        uSky: { value: new THREE.Color(0.5, 0.65, 0.85) },
        uLight: { value: 1 },
      },
    ]),
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  mat.uniforms.tReflection.value = target.texture;
  mat.uniforms.tNormal.value = waterNormalTexture();
  mat.uniforms.textureMatrix.value = textureMatrix;
  const water = new THREE.Mesh(geo, mat);
  water.renderOrder = 1;
  group.add(water);
  geo.computeBoundingBox();
  const box = geo.boundingBox!.clone().expandByScalar(5);

  // Dead trees standing in the shallows.
  const deadParts = [deadTreeGeometry(1), deadTreeGeometry(2), deadTreeGeometry(3)];
  const deadLists: THREE.Matrix4[][] = deadParts.map(() => []);
  for (let tries = 0; deadLists.flat().length < 34 && tries < 6000; tries++) {
    const x = x0 + rnd() * (x1 - x0);
    const z = 225 + rnd() * (z1 - 225) * 0.7;
    const d = POND_LEVEL - heightAt(x, z);
    // In shallow water, clustered along the near half of the pond like Taisho-ike's.
    if (d < 0.2 || d > 2.2 || fbm(x * 0.02, z * 0.02 + 9, 2) < 0.48) continue;
    const s = 0.7 + rnd() * 0.6;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, heightAt(x, z), z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.08, rnd() * 6.28, (rnd() - 0.5) * 0.08)),
      new THREE.Vector3(s, s * (0.8 + rnd() * 0.5), s),
    );
    deadLists[Math.floor(rnd() * deadParts.length)].push(m);
  }
  const deadMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.62, 0.6, 0.56, THREE.SRGBColorSpace), roughness: 0.95 });
  deadParts.forEach((g, i) => {
    const mesh = new THREE.InstancedMesh(g, deadMat, deadLists[i].length);
    deadLists[i].forEach((m, k) => mesh.setMatrixAt(k, m));
    mesh.castShadow = true;
    group.add(mesh);
  });

  // Larch woods on the shores beyond the walkable valley, with dark spruces among them.
  const kinds = [coniferGeometry(11, 5, 1.7, 13), coniferGeometry(12, 6, 2.3, 12)];
  const lists: { m: THREE.Matrix4; c: THREE.Color }[][] = [[], []];
  for (let tries = 0; lists[0].length + lists[1].length < 9000 && tries < 600000; tries++) {
    const x = POND.x + (rnd() * 2 - 1) * 700;
    const z = 240 + rnd() * 900;
    // Only outside the detailed map, where the normal forest is not drawn.
    if (Math.abs(x) < HALF - 2 && Math.abs(z) < HALF - 2) continue;
    const h = heightAt(x, z);
    const above = h - POND_LEVEL;
    if (above < 0.6 || above > 45) continue;
    // Thickest near the water, thinning up the slopes, in loose stands.
    // Only the lower slopes nearest the water; above them the baked forest texture takes over.
    const keep = (0.55 + pondMask(x, z) * 0.35) * (1 - smoothstep(20, 45, above));
    if (rnd() > keep || fbm(x * 0.01, z * 0.01, 2) < 0.3) continue;
    const spruce = rnd() < 0.2 + Math.min(0.55, above / 200) ? 1 : 0;
    const s = 0.55 + rnd() * 0.9;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.3, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), new THREE.Vector3(s, s * (0.85 + rnd() * 0.4), s));
    const v = 0.8 + rnd() * 0.35;
    const c = spruce
      ? new THREE.Color().setRGB(0.1, 0.19, 0.12, THREE.SRGBColorSpace).multiplyScalar(v)
      : new THREE.Color().setRGB(0.3 + rnd() * 0.06, 0.42 + rnd() * 0.06, 0.16, THREE.SRGBColorSpace).multiplyScalar(v);
    lists[spruce].push({ m, c });
  }
  const coniferMat = new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide });
  kinds.forEach((g, i) => {
    const mesh = new THREE.InstancedMesh(g, coniferMat, lists[i].length);
    lists[i].forEach(({ m, c }, k) => {
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, c);
    });
    group.add(mesh);
  });

  const mirror = createMirror(target, textureMatrix, 0.5, 0.00005);
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();

  return {
    group,
    renderReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
      // Only when the pond is in view.
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      if (!frustum.intersectsBox(box)) return;
      mirror.render(renderer, scene, camera, POND_LEVEL, water);
      mat.uniforms.uTexel.value = 1 / target.height;
    },
    update(time: number, sunDir: THREE.Vector3, sunColor: THREE.Color, sunStrength: number, daylight: number, sky: THREE.Color) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uSunDir.value.copy(sunDir);
      mat.uniforms.uSunColor.value.copy(sunColor).multiplyScalar(sunStrength);
      mat.uniforms.uLight.value = 0.08 + 0.92 * daylight;
      mat.uniforms.uSky.value.copy(sky);
    },
  };
}
