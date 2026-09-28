// Screen finishing: soft contact shadows (AO), sunbeams, bloom and colour grading.
// The scene is drawn into an HDR target first; the passes below read its colour and depth.

import * as THREE from 'three';

export type Quality = 'high' | 'medium' | 'low';

export const QUALITY_LABEL: Record<Quality, string> = {
  high: '画質：高（光の筋・接地の陰・にじみ）',
  medium: '画質：中（光の筋・にじみ）',
  low: '画質：低（軽さ優先）',
};

export const QUALITY_PIXEL_RATIO: Record<Quality, number> = { high: 1.75, medium: 1.25, low: 1 };

const fullVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Depth-only ambient occlusion: how much nearby geometry hides each point from the sky.
const aoFrag = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uProjInv;
  uniform vec2 uTexel;
  uniform float uRadius;
  uniform vec2 uScale; // projection scale into uv units
  varying vec2 vUv;

  vec3 viewPos(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    vec4 p = uProjInv * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
    vec3 p = viewPos(vUv);
    if (-p.z > 90.0) { gl_FragColor = vec4(1.0); return; }
    vec3 n = normalize(cross(viewPos(vUv + vec2(uTexel.x, 0.0)) - p, viewPos(vUv + vec2(0.0, uTexel.y)) - p));

    // Screen radius of a sphere of uRadius metres around the point.
    vec2 screenR = uScale * uRadius / -p.z;
    float ang = hash(gl_FragCoord.xy) * 6.2831;
    float occ = 0.0;
    const int DIRS = 8;
    for (int i = 0; i < DIRS; i++) {
      float a = ang + float(i) * 6.2831 / float(DIRS);
      vec2 dir = vec2(cos(a), sin(a));
      for (int s = 1; s <= 2; s++) {
        vec2 r = screenR * (float(s) * 0.5 - 0.2 + 0.15 * hash(gl_FragCoord.yx + float(i)));
        vec3 q = viewPos(vUv + dir * r);
        vec3 v = q - p;
        float dist = length(v);
        float h = max(dot(v, n) / max(dist, 1e-4) - 0.15, 0.0);
        occ += h * (1.0 - smoothstep(uRadius * 0.6, uRadius * 1.6, dist));
      }
    }
    occ /= float(DIRS * 2);
    float fade = 1.0 - smoothstep(50.0, 90.0, -p.z);
    gl_FragColor = vec4(vec3(1.0 - clamp(occ * 1.9, 0.0, 1.0) * fade), 1.0);
  }
`;

// Small blur that stops at depth edges so the shade stays tucked into corners.
const aoBlurFrag = /* glsl */ `
  uniform sampler2D tAO;
  uniform sampler2D tDepth;
  uniform vec2 uTexel;
  uniform vec2 uCam; // near, far
  varying vec2 vUv;
  float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uCam.x * uCam.y / (uCam.y + uCam.x - z * (uCam.y - uCam.x)); }
  void main() {
    float c = lin(texture2D(tDepth, vUv).x);
    float sum = 0.0, wsum = 0.0;
    for (int x = -2; x <= 2; x++) {
      for (int y = -2; y <= 2; y++) {
        vec2 uv = vUv + vec2(float(x), float(y)) * uTexel;
        float z = lin(texture2D(tDepth, uv).x);
        float w = 1.0 / (0.05 + abs(z - c) / max(c, 0.1) * 40.0);
        sum += texture2D(tAO, uv).r * w;
        wsum += w;
      }
    }
    gl_FragColor = vec4(vec3(sum / wsum), 1.0);
  }
`;

// Where the sky shows through, near the sun: the source of the light shafts.
const rayMaskFrag = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uSun;
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    float sky = step(0.99999, texture2D(tDepth, vUv).x);
    vec3 c = texture2D(tColor, vUv).rgb;
    float lum = min(dot(c, vec3(0.3, 0.5, 0.2)), 4.0);
    vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
    float near = exp(-dot(d, d) * 9.0);
    gl_FragColor = vec4(vec3(sky * lum * near), 1.0);
  }
`;

// Smear the bright gaps towards the sun, which draws the shafts through the canopy.
const rayBlurFrag = /* glsl */ `
  uniform sampler2D tMask;
  uniform vec2 uSun;
  uniform float uLength;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    const int N = 48;
    vec2 step = (uSun - vUv) * uLength / float(N);
    vec2 uv = vUv + step * hash(gl_FragCoord.xy);
    float decay = 1.0, sum = 0.0;
    for (int i = 0; i < N; i++) {
      sum += texture2D(tMask, uv).r * decay;
      decay *= 0.965;
      uv += step;
    }
    gl_FragColor = vec4(vec3(sum / float(N)), 1.0);
  }
`;

const brightFrag = /* glsl */ `
  uniform sampler2D tColor;
  uniform float uExposure;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb * uExposure;
    float l = max(c.r, max(c.g, c.b));
    float k = max(l - 1.1, 0.0);
    k = k * k / (k + 0.6);
    gl_FragColor = vec4(min(c * (k / max(l, 1e-4)), vec3(20.0)), 1.0);
  }
`;

const blurFrag = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tInput, vUv).rgb * 0.227;
    c += texture2D(tInput, vUv + uDir * 1.385).rgb * 0.316;
    c += texture2D(tInput, vUv - uDir * 1.385).rgb * 0.316;
    c += texture2D(tInput, vUv + uDir * 3.231).rgb * 0.070;
    c += texture2D(tInput, vUv - uDir * 3.231).rgb * 0.070;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const finalFrag = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tAO;
  uniform sampler2D tRays;
  uniform sampler2D tBloom1;
  uniform sampler2D tBloom2;
  uniform sampler2D tBloom3;
  uniform float uAO;
  uniform float uRays;
  uniform float uBloom;
  uniform vec3 uRayColor;
  uniform float uSaturation;
  uniform float uContrast;
  uniform vec3 uLift;
  uniform float uVignette;
  uniform float uInvExposure;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;
    float sky = step(0.99999, texture2D(tDepth, vUv).x);
    if (uAO > 0.0) c *= mix(1.0, texture2D(tAO, vUv).r, uAO * (1.0 - sky));
    if (uRays > 0.0) c += uRayColor * texture2D(tRays, vUv).r * uRays;
    if (uBloom > 0.0) {
      vec3 b = texture2D(tBloom1, vUv).rgb * 0.5 + texture2D(tBloom2, vUv).rgb * 0.35 + texture2D(tBloom3, vUv).rgb * 0.3;
      c += b * uBloom * uInvExposure;
    }
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>

    // Photographic grade: gentle S-curve, a touch less saturation in the greens, warm highlights.
    vec3 g = gl_FragColor.rgb;
    float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
    g = mix(vec3(l), g, uSaturation);
    // Contrast that leaves the shadows alone, so night scenes keep their shapes.
    g += (g - 0.5) * (uContrast - 1.0) * smoothstep(0.0, 0.4, g);
    g += uLift * (1.0 - g);
    vec2 v = vUv - 0.5;
    g *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(v, v) * 2.0);
    gl_FragColor.rgb = max(g, 0.0);
    #include <colorspace_fragment>
    // A whisper of noise stops banding in the sky and the mist.
    gl_FragColor.rgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  }
`;

function pass(frag: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({ vertexShader: fullVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

function target(type: THREE.TextureDataType = THREE.HalfFloatType) {
  return new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false });
}

export function createPost(renderer: THREE.WebGLRenderer) {
  const depth = new THREE.DepthTexture(1, 1);
  depth.type = THREE.UnsignedIntType;
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: depth });

  const aoRT = target(THREE.UnsignedByteType);
  const aoBlurRT = target(THREE.UnsignedByteType);
  const maskRT = target();
  const raysRT = target();
  const bloomA = [target(), target(), target()];
  const bloomB = [target(), target(), target()];
  const brightRT = target();

  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);

  const aoMat = pass(aoFrag, {
    tDepth: { value: depth },
    uProjInv: { value: new THREE.Matrix4() },
    uTexel: { value: new THREE.Vector2() },
    uRadius: { value: 0.9 },
    uScale: { value: new THREE.Vector2() },
  });
  const aoBlurMat = pass(aoBlurFrag, {
    tAO: { value: aoRT.texture },
    tDepth: { value: depth },
    uTexel: { value: new THREE.Vector2() },
    uCam: { value: new THREE.Vector2() },
  });
  const maskMat = pass(rayMaskFrag, {
    tColor: { value: sceneRT.texture },
    tDepth: { value: depth },
    uSun: { value: new THREE.Vector2() },
    uAspect: { value: 1 },
  });
  const rayMat = pass(rayBlurFrag, { tMask: { value: maskRT.texture }, uSun: { value: new THREE.Vector2() }, uLength: { value: 0.9 } });
  const brightMat = pass(brightFrag, { tColor: { value: sceneRT.texture }, uExposure: { value: 1 } });
  const blurMat = pass(blurFrag, { tInput: { value: null }, uDir: { value: new THREE.Vector2() } });
  const finalMat = pass(finalFrag, {
    tColor: { value: sceneRT.texture },
    tDepth: { value: depth },
    tAO: { value: aoBlurRT.texture },
    tRays: { value: raysRT.texture },
    tBloom1: { value: bloomA[0].texture },
    tBloom2: { value: bloomA[1].texture },
    tBloom3: { value: bloomA[2].texture },
    uAO: { value: 1 },
    uRays: { value: 0 },
    uBloom: { value: 0.5 },
    uRayColor: { value: new THREE.Color() },
    uSaturation: { value: 0.95 },
    uContrast: { value: 1.06 },
    uLift: { value: new THREE.Color() },
    uVignette: { value: 0.28 },
    uInvExposure: { value: 1 },
  });
  finalMat.toneMapped = true;

  let quality: Quality = 'high';
  const size = new THREE.Vector2();
  const sunNdc = new THREE.Vector3();
  const forward = new THREE.Vector3();

  function draw(mat: THREE.ShaderMaterial, rt: THREE.WebGLRenderTarget | null) {
    quad.material = mat;
    renderer.setRenderTarget(rt);
    renderer.render(quadScene, quadCam);
  }

  function setSize() {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, size.x);
    const h = Math.max(1, size.y);
    sceneRT.setSize(w, h);
    const hw = Math.ceil(w / 2);
    const hh = Math.ceil(h / 2);
    aoRT.setSize(hw, hh);
    aoBlurRT.setSize(hw, hh);
    maskRT.setSize(Math.ceil(w / 3), Math.ceil(h / 3));
    raysRT.setSize(Math.ceil(w / 3), Math.ceil(h / 3));
    brightRT.setSize(hw, hh);
    for (let i = 0; i < 3; i++) {
      const s = 2 ** (i + 2);
      bloomA[i].setSize(Math.ceil(w / s), Math.ceil(h / s));
      bloomB[i].setSize(Math.ceil(w / s), Math.ceil(h / s));
    }
    aoMat.uniforms.uTexel.value.set(1 / hw, 1 / hh);
    aoBlurMat.uniforms.uTexel.value.set(1 / hw, 1 / hh);
  }

  function blur(src: THREE.WebGLRenderTarget, tmp: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget) {
    blurMat.uniforms.tInput.value = src.texture;
    blurMat.uniforms.uDir.value.set(1 / src.width, 0);
    draw(blurMat, tmp);
    blurMat.uniforms.tInput.value = tmp.texture;
    blurMat.uniforms.uDir.value.set(0, 1 / tmp.height);
    draw(blurMat, dst);
  }

  /** Sunlight state for the finishing passes. */
  interface Light {
    sunDir: THREE.Vector3;
    sunColor: THREE.Color;
    daylight: number;
    mist: number;
    warm: number;
  }

  function render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, light: Light) {
    const prevAutoClear = renderer.autoClear;
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);
    renderer.autoClear = true;

    const useAO = quality === 'high';
    const useRays = quality !== 'low';
    const useBloom = quality !== 'low';

    if (useAO) {
      aoMat.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
      aoMat.uniforms.uScale.value.set(camera.projectionMatrix.elements[0] * 0.5, camera.projectionMatrix.elements[5] * 0.5);
      draw(aoMat, aoRT);
      aoBlurMat.uniforms.uCam.value.set(camera.near, camera.far);
      draw(aoBlurMat, aoBlurRT);
    }
    finalMat.uniforms.uAO.value = useAO ? 0.65 : 0;

    // Light shafts only when the sun is up and roughly in front of the camera.
    let rays = 0;
    if (useRays && light.daylight > 0.02) {
      camera.getWorldDirection(forward);
      const facing = forward.dot(light.sunDir);
      sunNdc.copy(camera.position).addScaledVector(light.sunDir, 1000).project(camera);
      const sx = sunNdc.x * 0.5 + 0.5;
      const sy = sunNdc.y * 0.5 + 0.5;
      const off = Math.max(Math.abs(sunNdc.x), Math.abs(sunNdc.y));
      rays = THREE.MathUtils.smoothstep(facing, 0.0, 0.45) * (1 - THREE.MathUtils.smoothstep(off, 1.1, 2.2)) * light.daylight;
      if (rays > 0.001) {
        maskMat.uniforms.uSun.value.set(sx, sy);
        maskMat.uniforms.uAspect.value = camera.aspect;
        rayMat.uniforms.uSun.value.set(sx, sy);
        draw(maskMat, maskRT);
        draw(rayMat, raysRT);
        // Stronger shafts in the morning mist and at golden hour.
        rays *= 0.18 + 0.35 * light.mist + 0.15 * light.warm;
      }
    }
    finalMat.uniforms.uRays.value = rays > 0.001 ? rays : 0;
    finalMat.uniforms.uRayColor.value.copy(light.sunColor).multiplyScalar(1.4);

    if (useBloom) {
      brightMat.uniforms.uExposure.value = renderer.toneMappingExposure;
      draw(brightMat, brightRT);
      blur(brightRT, bloomB[0], bloomA[0]);
      blur(bloomA[0], bloomB[1], bloomA[1]);
      blur(bloomA[1], bloomB[2], bloomA[2]);
    }
    finalMat.uniforms.uBloom.value = useBloom ? 0.4 : 0;
    finalMat.uniforms.uInvExposure.value = 1 / renderer.toneMappingExposure;

    // Warmer highlights at golden hour, cooler in the mist, flatter at night.
    const warm = light.warm * light.daylight;
    const d = light.daylight;
    finalMat.uniforms.uLift.value.setRGB(
      0.012 * d + 0.02 * warm + 0.001,
      0.01 * d + 0.006 * warm + 0.002,
      0.012 * d - 0.008 * warm + 0.006 * light.mist + 0.005,
    );
    finalMat.uniforms.uSaturation.value = 0.93 + 0.1 * warm - 0.08 * light.mist;
    finalMat.uniforms.uContrast.value = 1.0 + 0.1 * light.daylight - 0.04 * light.mist;

    draw(finalMat, null);
    renderer.autoClear = prevAutoClear;
  }

  return {
    render,
    setSize,
    get quality() {
      return quality;
    },
    setQuality(q: Quality) {
      quality = q;
      const samples = q === 'low' ? 2 : 4;
      if (sceneRT.samples !== samples) {
        sceneRT.samples = samples;
        sceneRT.dispose();
      }
    },
  };
}
