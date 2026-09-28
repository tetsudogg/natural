import * as THREE from 'three';
import { HALF, streamX, waterLevel, WATERFALL_Z } from './world';
import { waterNormalTexture, glowTexture } from './textures';
import { mulberry32 } from './noise';

// Layer for small plants that are skipped when drawing the reflection (they are too
// small to matter in rippled water, and skipping them keeps the second render cheap).
export const NO_REFLECT_LAYER = 1;

const vertexShader = /* glsl */ `
  uniform mat4 textureMatrix;
  varying vec4 vMirrorCoord;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vMirrorCoord = textureMatrix * wp;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tReflection;
  uniform sampler2D tNormal;
  uniform float uTime;
  uniform float uReflect;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform float uLight;
  uniform float uFallZ;
  varying vec4 vMirrorCoord;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  #include <common>
  float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(vhash(i), vhash(i + vec2(1, 0)), u.x), mix(vhash(i + vec2(0, 1)), vhash(i + vec2(1, 1)), u.x), u.y);
  }
  #include <fog_pars_fragment>
  void main() {
    // Two layers of ripples drifting downstream at different speeds.
    vec2 flow = vec2(0.0, -uTime * 0.35);
    vec3 n1 = texture2D(tNormal, vUv + flow).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(tNormal, vUv * 2.3 + flow * 1.6 + vec2(uTime * 0.03, 0.0)).xyz * 2.0 - 1.0;
    vec3 n = normalize(vec3(n1.x + n2.x * 0.6, 5.0, n1.y + n2.y * 0.6));

    vec3 view = normalize(cameraPosition - vWorldPos);
    float facing = max(dot(view, n), 0.0);
    float fresnel = 0.03 + 0.97 * pow(1.0 - facing, 5.0);

    vec4 mc = vMirrorCoord;
    mc.xy += n.xz * 0.06 * mc.w;
    vec3 reflection = texture2DProj(tReflection, mc).rgb;

    // Shallow water near the banks is clearer; the middle is deeper and greener.
    float across = abs(vUv.x / 1.5 - 0.5) * 2.0;
    vec3 body = mix(uDeep, uShallow, smoothstep(0.3, 1.0, across)) * uLight;

    vec3 h = normalize(uSunDir + view);
    float spec = pow(max(dot(n, h), 0.0), 400.0) * 8.0 + pow(max(dot(n, h), 0.0), 40.0) * 0.15;

    vec3 color = mix(body, reflection, clamp(fresnel * uReflect + 0.08, 0.0, 1.0)) + uSunColor * spec;
    float alpha = mix(0.35, 0.97, fresnel) * mix(1.0, 0.75, smoothstep(0.6, 1.0, across)) + spec;

    // White water: some stretches run as rapids over the stones, and the pool under the
    // waterfall churns. Foam is drawn as streaks stretched along the flow.
    vec2 wp = vWorldPos.xz;
    float rapids = smoothstep(0.45, 0.75, vnoise(vec2(0.0, wp.y * 0.045) + 3.0) * 0.7 + vnoise(wp * 0.12) * 0.4);
    float fall = 1.0 - smoothstep(2.0, 12.0, abs(wp.y - uFallZ));
    float churn = max(rapids * 0.85, fall);
    vec2 fp = vec2(wp.x * 1.6, wp.y * 0.28 - uTime * 1.4);
    float streak = vnoise(fp) * 0.55 + vnoise(fp * 2.3 + 7.0) * 0.3 + vnoise(vec2(wp.x * 5.0, wp.y * 0.9 - uTime * 3.0)) * 0.25;
    float foam = smoothstep(1.0 - churn * 0.75, 1.05 - churn * 0.55, streak + n.x * 0.3) * churn;
    foam = max(foam, churn * 0.35); // milky, bubbly water all through the rapids
    vec3 foamCol = vec3(0.9, 0.95, 0.95) * (uLight * 0.9 + 0.02) + uSunColor * 0.08;
    color = mix(color, foamCol, clamp(foam, 0.0, 0.92));
    alpha = max(alpha, foam);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

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

  const target = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
  const normalMap = waterNormalTexture();
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
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uShallow: { value: new THREE.Color().setRGB(0.42, 0.52, 0.42, THREE.SRGBColorSpace) },
        uDeep: { value: new THREE.Color().setRGB(0.06, 0.3, 0.29, THREE.SRGBColorSpace) },
        uLight: { value: 1 },
        uFallZ: { value: WATERFALL_Z },
      },
    ]),
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  mat.uniforms.tReflection.value = target.texture;
  mat.uniforms.tNormal.value = normalMap;
  mat.uniforms.textureMatrix.value = textureMatrix;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;

  // Mirror camera for a flat water plane at the stream's level nearest the viewer.
  const mirror = new THREE.PerspectiveCamera();
  mirror.layers.set(0);
  const normal = new THREE.Vector3(0, 1, 0);
  const planePos = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const view = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const plane = new THREE.Plane();
  const clip = new THREE.Vector4();
  const q = new THREE.Vector4();
  const size = new THREE.Vector2();

  function renderReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    camPos.setFromMatrixPosition(camera.matrixWorld);
    // Too far from the stream to see it: skip the extra render.
    if (Math.abs(camPos.x - streamX(camPos.z)) > 140) {
      mat.uniforms.uReflect.value = 0;
      return;
    }
    mat.uniforms.uReflect.value = 1;
    planePos.set(camPos.x, waterLevel(camPos.z), camPos.z);
    view.subVectors(planePos, camPos);
    if (view.dot(normal) > 0) return;
    view.reflect(normal).negate().add(planePos);
    rot.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    aim.subVectors(planePos, lookAt).reflect(normal).negate().add(planePos);
    mirror.position.copy(view);
    mirror.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    mirror.lookAt(aim);
    mirror.far = camera.far;
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(camera.projectionMatrix);

    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

    // Clip away everything under the water (oblique near plane).
    plane.setFromNormalAndCoplanarPoint(normal, planePos).applyMatrix4(mirror.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = mirror.projectionMatrix;
    q.x = (Math.sign(clip.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1;
    q.w = (1 + pm.elements[10]) / pm.elements[14];
    clip.multiplyScalar(2 / clip.dot(q));
    pm.elements[2] = clip.x;
    pm.elements[6] = clip.y;
    pm.elements[10] = clip.z + 1 - 0.003;
    pm.elements[14] = clip.w;
    mirror.projectionMatrixInverse.copy(pm).invert();

    // Half the screen resolution is plenty under the ripples.
    renderer.getDrawingBufferSize(size);
    const w = Math.max(256, Math.round(size.x / 2));
    const h = Math.max(256, Math.round(size.y / 2));
    if (target.width !== w || target.height !== h) target.setSize(w, h);

    mesh.visible = false;
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, mirror);
    renderer.setRenderTarget(prevTarget);
    mesh.visible = true;
  }

  return {
    mesh,
    renderReflection,
    update(time: number, sunDir: THREE.Vector3, sunColor: THREE.Color, sunStrength: number, daylight: number) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uSunDir.value.copy(sunDir);
      mat.uniforms.uSunColor.value.copy(sunColor).multiplyScalar(sunStrength);
      mat.uniforms.uLight.value = 0.08 + 0.92 * daylight;
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
