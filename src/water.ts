import * as THREE from 'three';
import { HALF, streamX, waterLevel } from './world';
import { waterNormalTexture, glowTexture } from './textures';
import { mulberry32 } from './noise';

export function createStream() {
  const halfWidth = 6;
  const across = 6;
  const rows = Math.round(HALF * 2);
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const z = -HALF + j;
    const cx = streamX(z);
    const y = waterLevel(z);
    for (let i = 0; i <= across; i++) {
      const t = i / across;
      verts.push(cx - halfWidth + t * halfWidth * 2, y, z);
      uvs.push(t * 1.5, z / 6);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < across; i++) {
      const a = j * (across + 1) + i;
      const b = a + across + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const normalMap = waterNormalTexture();
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.22, 0.34, 0.3, THREE.SRGBColorSpace),
    roughness: 0.06,
    metalness: 0,
    transparent: true,
    opacity: 0.42,
    normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    clearcoat: 0.5,
    clearcoatRoughness: 0.05,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;

  return {
    mesh,
    update(dt: number) {
      normalMap.offset.y -= dt * 0.35; // flows toward +z
      normalMap.offset.x += dt * 0.01;
    },
  };
}

// Fireflies that drift over the stream on summer nights.
export function createFireflies() {
  const count = 260;
  const rnd = mulberry32(77);
  const base = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const z = (rnd() * 2 - 1) * (HALF - 20);
    base[i * 3] = streamX(z) + (rnd() - 0.5) * 22;
    base[i * 3 + 1] = waterLevel(z) + 0.6 + rnd() * 2.2;
    base[i * 3 + 2] = z;
    phase[i] = rnd() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uMap: { value: glowTexture() } },
    vertexShader: `
      attribute float phase;
      uniform float uTime;
      varying float vGlow;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.3 + phase) * 1.2;
        p.y += sin(uTime * 0.5 + phase * 1.7) * 0.4;
        p.z += cos(uTime * 0.27 + phase) * 1.2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float blink = sin(uTime * 1.6 + phase * 3.0);
        vGlow = smoothstep(0.2, 0.9, blink);
        gl_PointSize = 140.0 / -mv.z;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uAlpha;
      varying float vGlow;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * 1.6, t.a * vGlow * uAlpha);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return {
    points,
    update(time: number, night: number) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uAlpha.value = night;
      points.visible = night > 0.01;
    },
  };
}
