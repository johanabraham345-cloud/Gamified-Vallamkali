// The 3D race view shown on the laptop.
// - Real models (boat, boatman, palm) load from /public/models; placeholders show until they arrive.
// - A "camera director" runs the cinematic intro, the race chase cam, TV-style cuts and the finish.
//   When the boats are far apart, the main camera follows the leader and a picture-in-picture
//   window follows the boat behind.
// - Boatmen grip their paddles: the hands are solved onto the paddle every frame (simple arm IK).
// - Water ripples, sky, foam wakes, bow spray and paddle splashes make it feel alive.
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import {
  RACE_LENGTH, TEAMS, COUNTDOWN_MS, RIVER_HALF, LANE_Z, BOAT_HALF_LEN, CINEMATIC_CUTS,
} from './config.js';

const BOAT_LEN = BOAT_HALF_LEN * 2;
const ROWER_SCALE = 1.4;        // boatman size (1 = model's own size)
const STROKE_ANIM_MS = 760;     // how long one paddle stroke takes on screen
const PALM_COUNT = 260;         // full 3D palms along the riverbanks
const FOREST_COUNT = 1400;      // cheap "cutout" palms making the forest behind
const CROWD_COUNT = 2600;
const PIP_GAP = 55;             // metres between boats before the picture-in-picture view kicks in
const FRONT_ROW_X = 8;          // where the front row sits (metres ahead of the boat's middle)
const ROW_SPACING = 2.6;

// Debug: host.html?cam=top gives the old flat top view for the whole race.
const params = new URLSearchParams(location.search);
const FORCE_TOP = params.get('cam') === 'top';
const FORCE_CLOSE = params.get('cam') === 'close';   // debug: stay close on the Red crew

const MODEL_URL = (name) => `${import.meta.env.BASE_URL}models/${name}.glb`;
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;

// Seat 0,2,4… sit on the left side, 1,3,5… on the right, front to back, packed like a real crew.
export function seatOffset(seat) {
  const row = Math.floor(seat / 2);
  const side = seat % 2 === 0 ? -1 : 1;
  return { x: FRONT_ROW_X - row * ROW_SPACING, z: side * 0.95, side };
}

// Meshy exports leave "metal" at its default (fully metal), which renders near-black.
function fixMaterials(root, anisotropy = 1) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const mat of [].concat(o.material)) {
      mat.metalness = 0;
      mat.metalnessMap = null;
      for (const k of ['map', 'normalMap', 'roughnessMap']) if (mat[k]) mat[k].anisotropy = anisotropy;
      mat.needsUpdate = true;
    }
  });
}

// ---------- Simple noise for procedural textures ----------
function makeNoise(seed = 1) {
  const perm = new Uint8Array(512);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const p = Array.from({ length: 256 }, (_, i) => i).sort(() => rnd() - 0.5);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  // Tileable 2D gradient noise with period `per`.
  return (x, y, per = 256) => {
    const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y;
    const ix = ((X % per) + per) % per, iy = ((Y % per) + per) % per;
    const ix1 = (ix + 1) % per, iy1 = (iy + 1) % per;
    const h = (a, b) => perm[perm[a & 255] + (b & 255)];
    const u = fade(xf), v = fade(yf);
    const n00 = grad(h(ix, iy), xf, yf), n10 = grad(h(ix1, iy), xf - 1, yf);
    const n01 = grad(h(ix, iy1), xf, yf - 1), n11 = grad(h(ix1, iy1), xf - 1, yf - 1);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
  };
}

// Water: a tileable height field made of several octaves of noise, turned into a normal map.
function makeWaterNormalMap(size, cells, seed, strength = 2.5) {
  const noise = makeNoise(seed);
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let h = 0, amp = 1, f = cells;
    for (let o = 0; o < 4; o++) { h += amp * noise((x / size) * f, (y / size) * f, f); amp *= 0.5; f *= 2; }
    H[y * size + x] = h;
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx2 = cv.getContext('2d'), img = ctx2.createImageData(size, size);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    img.data[i] = (-dx / len * 0.5 + 0.5) * 255;
    img.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx2.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Grass: mottled greens with soil showing through and little blade strokes.
function makeGrassTexture() {
  const N = 512, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const noise = makeNoise(7);
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let n = 0, amp = 1, f = 4;
    for (let o = 0; o < 5; o++) { n += amp * noise((x / N) * f, (y / N) * f, f); amp *= 0.55; f *= 2; }
    n = n * 0.5 + 0.5;
    const i = (y * N + x) * 4;
    const dry = Math.max(0, n - 0.62) * 2.2;                 // patches of dry / soil
    img.data[i] = 62 + n * 55 + dry * 90;
    img.data[i + 1] = 105 + n * 70 + dry * 30;
    img.data[i + 2] = 38 + n * 25 + dry * 25;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 9000; i++) {                           // grass blades
    const x = Math.random() * N, y = Math.random() * N, l = 3 + Math.random() * 6;
    g.strokeStyle = Math.random() < 0.5 ? 'rgba(140,190,80,0.35)' : 'rgba(40,80,25,0.35)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y - l); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- Particles: foam, spray and splashes ----------
class Particles {
  constructor(scene, max = 5000) {
    this.max = max;
    this.next = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.info = Array.from({ length: max }, () => ({ age: 1, life: 0, s0: 0, grow: 0, g: 0, a0: 0 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 400 } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale;
        void main() {
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(0.94, 0.97, 1.0, smoothstep(0.5, 0.12, d) * vA);
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, size, grow, gravity, alpha = 0.8) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    Object.assign(this.info[i], { age: 0, life, s0: size, grow, g: gravity, a0: alpha });
  }

  update(dt, viewportHeight, camera) {
    this.mat.uniforms.uScale.value = viewportHeight * camera.projectionMatrix.elements[5] * 0.5;
    for (let i = 0; i < this.max; i++) {
      const p = this.info[i];
      if (p.age >= p.life) { this.alpha[i] = 0; continue; }
      p.age += dt;
      const k = i * 3;
      this.vel[k + 1] -= p.g * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.05) { this.pos[k + 1] = 0.05; this.vel[k + 1] = 0; this.vel[k] *= 0.9; this.vel[k + 2] *= 0.9; }
      const t = p.age / p.life;
      this.alpha[i] = p.a0 * (1 - t) * Math.min(1, p.age * 12);
      this.size[i] = p.s0 + p.grow * p.age;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }
}

// ---------- Arm IK: point bones so the hand lands on a target ----------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

// Rotate `bone` so the direction from it to `child` points at `target` (world space).
function aimBone(bone, child, target) {
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  const cur = _b.sub(_a).normalize();
  const want = _c.copy(target).sub(_a).normalize();
  _q1.setFromUnitVectors(cur, want);
  bone.getWorldQuaternion(_q2);
  _q1.multiply(_q2);                                       // new world rotation
  bone.parent.getWorldQuaternion(_q3).invert();
  bone.quaternion.copy(_q3.multiply(_q1));
  bone.updateMatrixWorld(true);
}

// Two-bone arm: shoulder -> elbow -> hand reaches `target`, elbow bends toward `pole`.
function solveArm(upper, fore, hand, target, pole) {
  const S = upper.getWorldPosition(new THREE.Vector3());
  const a = upper.userData.len, b = fore.userData.len;
  const toT = target.clone().sub(S);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const u = toT.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const p = pole.clone().sub(u.clone().multiplyScalar(pole.dot(u))).normalize();
  const elbow = S.clone().addScaledVector(u, a * cosA).addScaledVector(p, a * sinA);
  aimBone(upper, fore, elbow);
  aimBone(fore, hand, S.clone().addScaledVector(u, d));
}

// Where the paddle blade is (boat coordinates) at stroke phase f (0..1).
// Reach forward and dig in -> pull back through the water -> lift out -> swing forward.
function bladePath(f, x0, side) {
  const out = side * 1.85;                                 // outside the hull
  if (f < 0.08) {                                          // catch: blade drops into the water
    const u = f / 0.08;
    return new THREE.Vector3(x0 + 1.1, lerp(0.35, -0.4, ease(u)), out);
  }
  if (f < 0.55) {                                          // drive: pull back through the water
    const u = (f - 0.08) / 0.47;
    return new THREE.Vector3(x0 + 1.1 - 2.3 * ease(u), -0.4, out + side * 0.1 * Math.sin(u * Math.PI));
  }
  if (f < 0.68) {                                          // exit: lift the blade out
    const u = (f - 0.55) / 0.13;
    return new THREE.Vector3(x0 - 1.2 - 0.1 * u, lerp(-0.4, 0.5, ease(u)), out);
  }
  const u = (f - 0.68) / 0.32;                             // recovery: swing forward above the water
  return new THREE.Vector3(lerp(x0 - 1.3, x0 + 1.1, ease(u)), lerp(0.5, 0.35, u) + 0.12 * Math.sin(u * Math.PI), out);
}

export function createRaceScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
  container.appendChild(labelRenderer.domElement);

  // Picture-in-picture frame (shows the boat behind when the gap is big).
  const pipEl = document.createElement('div');
  pipEl.className = 'pip';
  pipEl.innerHTML = '<span></span>';
  container.appendChild(pipEl);

  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color(0xd9e6ea);
  scene.fog = new THREE.Fog(HORIZON, 160, 700);

  // ----- Sky: a big gradient dome that follows the camera -----
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: {
      top: { value: new THREE.Color(0x3f86d8) },
      horizon: { value: HORIZON.clone() },
      ground: { value: new THREE.Color(0x8fae84) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vP;
      void main(){
        float h = vP.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, ground, pow(-h, 0.35));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.7;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x4a5a3a, 0.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 3000);
  const pipCam = new THREE.PerspectiveCamera(42, 16 / 9, 0.3, 3000);

  // ----- World -----
  const worldLen = RACE_LENGTH + 800;
  const worldMidX = RACE_LENGTH / 2;

  // Water: large slow swells + fine fast ripples on a glossy top layer (sharp sky reflections, sun glints).
  const swells = makeWaterNormalMap(256, 3, 3, 1.6);
  const ripples = makeWaterNormalMap(256, 6, 11, 2.2);
  swells.repeat.set(worldLen / 40, (RIVER_HALF * 2 + 4) / 40);
  ripples.repeat.set(worldLen / 3.5, (RIVER_HALF * 2 + 4) / 3.5);
  ripples.anisotropy = swells.anisotropy = maxAniso;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(worldLen, RIVER_HALF * 2 + 4),
    new THREE.MeshPhysicalMaterial({
      color: 0x255e57, roughness: 0.22, metalness: 0,
      normalMap: swells, normalScale: new THREE.Vector2(0.18, 0.18),
      clearcoat: 1, clearcoatRoughness: 0.06,
      clearcoatNormalMap: ripples, clearcoatNormalScale: new THREE.Vector2(0.22, 0.22),
      envMapIntensity: 0.9,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.x = worldMidX;
  water.receiveShadow = true;
  water.renderOrder = 2;                                   // after the boats' water-stoppers
  scene.add(water);

  // Banks: grass texture + big soft colour patches, so it never looks like a flat carpet.
  const grass = makeGrassTexture();
  grass.repeat.set(worldLen / 9, 140 / 9);
  grass.anisotropy = maxAniso;
  const patchNoise = makeNoise(21);
  for (const s of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(worldLen, 140, 200, 30);
    const colors = [];
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const n = patchNoise(x / 40, y / 40, 4096) * 0.5 + patchNoise(x / 13, y / 13, 4096) * 0.3;
      colors.push(0.85 + n * 0.35, 0.9 + n * 0.25, 0.8 + n * 0.2);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const bank = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 0.95 }));
    bank.rotation.x = -Math.PI / 2;
    bank.position.set(worldMidX, 0.15, s * (RIVER_HALF + 70));
    bank.receiveShadow = true;
    scene.add(bank);
    const mud = new THREE.Mesh(new THREE.PlaneGeometry(worldLen, 2.4), new THREE.MeshStandardMaterial({ color: 0x5e4f36, roughness: 1 }));
    mud.rotation.x = -Math.PI / 2;
    mud.position.set(worldMidX, 0.1, s * (RIVER_HALF + 0.7));
    scene.add(mud);
  }

  // Lane buoys down the middle: the line the boats can't cross.
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const buoyCount = Math.ceil((RACE_LENGTH + 100) / 4);
  const buoys = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.4 }), buoyCount);
  for (let i = 0; i < buoyCount; i++) {
    m.makeTranslation(-50 + i * 4, 0.12, 0);
    buoys.setMatrixAt(i, m);
    buoys.setColorAt(i, col.setHex(i % 2 ? 0xffffff : 0xe53935));
  }
  scene.add(buoys);

  // Front palms (full 3D) along both banks.
  const palmSpots = Array.from({ length: PALM_COUNT }, (_, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    return {
      x: -150 + Math.random() * (RACE_LENGTH + 320),
      z: side * (RIVER_HALF + 8 + Math.random() * 12),
      scale: 5 + Math.random() * 2.5,
      rot: Math.random() * Math.PI * 2,
    };
  });
  const placeholderPalms = new THREE.InstancedMesh(
    new THREE.SphereGeometry(2.6, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2d6b2a }), PALM_COUNT
  );
  palmSpots.forEach((p, i) => {
    m.compose(new THREE.Vector3(p.x, 3, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 0.35, 1));
    placeholderPalms.setMatrixAt(i, m);
  });
  scene.add(placeholderPalms);

  // Crowd: placeholder people in tiers along the banks, some under umbrellas (real model later).
  // Each spectator: white/cream mundu (lower body), coloured shirt, skin-tone head, black hair.
  const mundus = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.26, 0.85, 10).translate(0, -0.42, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.9 }), CROWD_COUNT);
  const bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.2, 0.62, 10).translate(0, -0.05, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.85 }), CROWD_COUNT);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 12, 10).scale(1, 1.12, 1),
    new THREE.MeshStandardMaterial({ color: 0x7a5038, roughness: 0.7 }), CROWD_COUNT);
  const hair = new THREE.InstancedMesh(new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.03, 0),
    new THREE.MeshStandardMaterial({ color: 0x141010, roughness: 0.9 }), CROWD_COUNT);
  const mundu = [0xf5f0e1, 0xffffff, 0xf3e7c9, 0xf5f0e1, 0x2c2c2c];
  const shirt = [0xffffff, 0xf3b33d, 0xd63a2f, 0x2f6fd6, 0x9c27b0, 0x4caf50, 0xffffff, 0xf5f0e1, 0xff8a65, 0xffffff];
  const crowdSpots = [];
  for (let i = 0; i < CROWD_COUNT; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const tier = Math.floor(Math.random() * 4);            // 4 rows deep
    const c = { x: -80 + Math.random() * (RACE_LENGTH + 180), z: side * (RIVER_HALF + 1.6 + tier * 1.3 + Math.random() * 0.8), y: tier * 0.25, ph: Math.random() * 6.3 };
    crowdSpots.push(c);
    placePerson(i, c, 0);
    bodies.setColorAt(i, col.setHex(shirt[i % shirt.length]));
    mundus.setColorAt(i, col.setHex(mundu[(i * 7) % mundu.length]));
  }
  scene.add(mundus, bodies, heads, hair);
  function placePerson(i, c, jump) {
    const y = c.y + jump;
    m.makeTranslation(c.x, 0.88 + y, c.z); mundus.setMatrixAt(i, m);
    m.makeTranslation(c.x, 1.2 + y, c.z); bodies.setMatrixAt(i, m);
    m.makeTranslation(c.x, 1.66 + y, c.z); heads.setMatrixAt(i, m); hair.setMatrixAt(i, m);
  }
  const UMBRELLAS = 260;
  const umbrellas = new THREE.InstancedMesh(new THREE.ConeGeometry(1.0, 0.45, 10, 1, true), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), UMBRELLAS);
  const umbColors = [0x111111, 0x111111, 0xd63a2f, 0x2f6fd6, 0xf3b33d, 0x2e7d32];
  for (let i = 0; i < UMBRELLAS; i++) {
    const c = crowdSpots[(i * 9) % CROWD_COUNT];
    m.makeTranslation(c.x, 2.15 + c.y, c.z);
    umbrellas.setMatrixAt(i, m);
    umbrellas.setColorAt(i, col.setHex(umbColors[i % umbColors.length]));
  }
  scene.add(umbrellas);
  function animateCrowd(now, focusX, excite) {
    for (let i = 0; i < CROWD_COUNT; i++) {
      const c = crowdSpots[i];
      if (Math.abs(c.x - focusX) > 90) continue;
      placePerson(i, c, Math.max(0, Math.sin(now * 0.012 + c.ph)) * 0.35 * excite);
    }
    for (const mesh of [mundus, bodies, heads, hair]) mesh.instanceMatrix.needsUpdate = true;
  }

  const addLabel = (text, cls, x, y, z) => {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(x, y, z);
    scene.add(obj);
  };

  // Start line, distance markers and a finish gate.
  const line = (x, color) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, RIVER_HALF * 2), new THREE.MeshBasicMaterial({ color }));
    l.position.set(x, 0.06, 0);
    l.renderOrder = 3;
    scene.add(l);
  };
  line(0, 0xffeb3b);
  for (let d = 100; d < RACE_LENGTH; d += 100) addLabel(`${d} m`, 'marker-label', d, 1, -RIVER_HALF - 1);
  line(RACE_LENGTH, 0xffffff);
  const gateMat = new THREE.MeshStandardMaterial({ color: 0xc62828 });
  for (const s of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 12), gateMat);
    pole.position.set(RACE_LENGTH, 6, s * (RIVER_HALF - 0.5));
    pole.castShadow = true;
    scene.add(pole);
  }
  const bannerTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 128;
    const g = cv.getContext('2d');
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#111' : '#fff'; g.fillRect(i * 64, 0, 64, 128); }
    g.fillStyle = '#c62828'; g.fillRect(300, 14, 424, 100);
    g.fillStyle = '#fff'; g.font = 'bold 76px Impact, sans-serif'; g.textAlign = 'center'; g.fillText('FINISH', 512, 92);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(RIVER_HALF * 2, 4.5), new THREE.MeshStandardMaterial({ map: bannerTex, side: THREE.DoubleSide }));
  banner.position.set(RACE_LENGTH, 10, 0);
  banner.rotation.y = Math.PI / 2;
  scene.add(banner);

  const particles = new Particles(scene);

  // ----- Boats -----
  const boats = TEAMS.map((team, i) => {
    const g = new THREE.Group();
    g.position.z = LANE_Z[i];

    const placeholder = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(BOAT_LEN, 1, 2.4), new THREE.MeshStandardMaterial({ color: 0x4a2f17 }));
    hull.position.y = 0.5;
    placeholder.add(hull);
    g.add(placeholder);

    const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3), new THREE.MeshStandardMaterial({ color: 0x3a2412 }));
    flagPole.position.set(BOAT_LEN / 2 - 3, 2, 0);
    g.add(flagPole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), new THREE.MeshStandardMaterial({ color: team.color, side: THREE.DoubleSide }));
    flag.position.set(BOAT_LEN / 2 - 3.9, 3, 0);
    g.add(flag);

    const rowersGroup = new THREE.Group();
    g.add(rowersGroup);

    const syncEl = document.createElement('div');
    syncEl.className = 'sync-label';
    syncEl.textContent = 'SYNC!';
    syncEl.style.opacity = '0';
    const syncLabel = new CSS2DObject(syncEl);
    syncLabel.position.set(4, 6, 0);
    g.add(syncLabel);

    scene.add(g);
    return { group: g, placeholder, rowersGroup, syncEl, flag };
  });

  // An invisible "water stopper" shaped like the inside of the hull. It is drawn before the water
  // and blocks it, so you never see river water inside the boat.
  function buildWaterStopper(hullRoot) {
    hullRoot.updateMatrixWorld(true);
    const parentInv = new THREE.Matrix4().copy(hullRoot.parent.matrixWorld).invert();
    const BINS = 48, half = new Array(BINS).fill(0);
    const v = new THREE.Vector3();
    hullRoot.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      const toLocal = new THREE.Matrix4().multiplyMatrices(parentInv, o.matrixWorld);
      for (let i = 0; i < pos.count; i += 2) {
        v.fromBufferAttribute(pos, i).applyMatrix4(toLocal);
        if (v.y < -0.35 || v.y > 0.35) continue;          // hull skin around the waterline
        const bin = Math.floor(((v.x + BOAT_HALF_LEN) / BOAT_LEN) * BINS);
        if (bin >= 0 && bin < BINS) half[bin] = Math.max(half[bin], Math.abs(v.z));
      }
    });
    const pts = [];
    for (let i = 0; i < BINS; i++) {
      const x = -BOAT_HALF_LEN + ((i + 0.5) / BINS) * BOAT_LEN;
      pts.push(new THREE.Vector2(x, Math.max(0, half[i] * 0.86 - 0.06)));  // stay just inside the hull
    }
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x, 0);
    for (const p of pts) shape.lineTo(p.x, p.y);
    for (let i = pts.length - 1; i >= 0; i--) shape.lineTo(pts[i].x, -pts[i].y);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2);                              // lie flat (x along boat, y -> z)
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    const stopper = new THREE.Mesh(geo, mat);
    stopper.position.y = 0.03;
    stopper.renderOrder = 1;
    return stopper;
  }

  // ----- Load the real models -----
  const models = { boatman: null };
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let lastRoster = [];

  loader.load(MODEL_URL('boat'), (gltf) => {
    const src = gltf.scene;
    fixMaterials(src, maxAniso);
    src.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const box = new THREE.Box3().setFromObject(src);
    const s = BOAT_LEN / (box.max.x - box.min.x);
    let stopperGeo = null;
    boats.forEach((b) => {
      const hull = src.clone(true);
      hull.scale.setScalar(s);
      hull.position.x = -((box.max.x + box.min.x) / 2) * s;
      hull.position.y = -0.6 - box.min.y * s;
      b.group.remove(b.placeholder);
      b.group.add(hull);
      const stopper = stopperGeo ? new THREE.Mesh(stopperGeo.geometry, stopperGeo.material) : buildWaterStopper(hull);
      if (!stopperGeo) stopperGeo = stopper;
      stopper.position.y = 0.03;
      stopper.renderOrder = 1;
      b.group.add(stopper);
    });
  }, undefined, (e) => console.warn('boat.glb failed to load, keeping placeholder', e));

  loader.load(MODEL_URL('palm'), (gltf) => {
    let mesh = null;
    fixMaterials(gltf.scene, maxAniso);
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const base = new THREE.Matrix4().makeTranslation(0, -box.min.y, 0).multiply(mesh.matrixWorld);
    const palms = new THREE.InstancedMesh(mesh.geometry, mesh.material, PALM_COUNT);
    const q = new THREE.Quaternion();
    palmSpots.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale)).multiply(base);
      palms.setMatrixAt(i, m);
    });
    palms.frustumCulled = false;
    scene.remove(placeholderPalms);
    scene.add(palms);
    buildForest(mesh, base, box);
  }, undefined, (e) => console.warn('palm.glb failed to load, keeping placeholder', e));

  // The forest behind the front palms: the palm is photographed once from the side and from above
  // into textures, and those pictures are used on flat "cutout" trees. Hundreds of trees, almost free.
  function buildForest(mesh, base, box) {
    const shoot = (w, h, setupCam) => {
      const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Scene();
      s.add(new THREE.HemisphereLight(0xffffff, 0x667755, 3.2));
      const d = new THREE.DirectionalLight(0xfff0d6, 3.5); d.position.set(3, 5, 4); s.add(d);
      const one = new THREE.Mesh(mesh.geometry, mesh.material);
      one.matrixAutoUpdate = false;
      one.matrix.copy(base);
      s.add(one);
      const sizeY = box.max.y - box.min.y, sizeX = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      const cam = setupCam(sizeX, sizeY);
      const prevTarget = renderer.getRenderTarget(), prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
      const prevTone = renderer.toneMapping;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(s, cam);
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevColor, prevAlpha);
      renderer.toneMapping = prevTone;
      return { tex: rt.texture, sizeX, sizeY };
    };
    const side = shoot(256, 512, (sx, sy) => {
      const c = new THREE.OrthographicCamera(-sx / 2, sx / 2, sy, 0, 0.1, 100);
      c.position.set(0, 0, 50); c.lookAt(0, 0, 0); c.position.y = 0; c.updateProjectionMatrix();
      return c;
    });
    const top = shoot(256, 256, (sx, sy) => {
      const c = new THREE.OrthographicCamera(-sx / 2, sx / 2, sx / 2, -sx / 2, 0.1, 100);
      c.position.set(0, sy + 20, 0); c.up.set(0, 0, -1); c.lookAt(0, 0, 0); c.updateProjectionMatrix();
      return c;
    });
    const sideMat = new THREE.MeshLambertMaterial({ map: side.tex, alphaTest: 0.45, side: THREE.DoubleSide });
    const topMat = new THREE.MeshLambertMaterial({ map: top.tex, alphaTest: 0.45, side: THREE.DoubleSide });
    // Two crossed vertical cards + one canopy card seen from above.
    const card = new THREE.PlaneGeometry(side.sizeX, side.sizeY).translate(0, side.sizeY / 2, 0);
    const card2 = card.clone().rotateY(Math.PI / 2);
    const cards = new THREE.BufferGeometry();
    const merge = (geos) => {
      const posA = [], uvA = [], nA = [], idx = [];
      let off = 0;
      for (const g of geos) {
        const gi = g.index ? g : g.toIndexed?.() ?? g;
        posA.push(...g.attributes.position.array); uvA.push(...g.attributes.uv.array); nA.push(...g.attributes.normal.array);
        for (const k of g.index.array) idx.push(k + off);
        off += g.attributes.position.count;
      }
      cards.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
      cards.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
      cards.setAttribute('normal', new THREE.Float32BufferAttribute(nA, 3));
      cards.setIndex(idx);
    };
    merge([card, card2]);
    const canopy = new THREE.PlaneGeometry(top.sizeX, top.sizeX).rotateX(-Math.PI / 2).translate(0, side.sizeY * 0.86, 0);

    const forestSides = new THREE.InstancedMesh(cards, sideMat, FOREST_COUNT);
    const forestTops = new THREE.InstancedMesh(canopy, topMat, FOREST_COUNT);
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < FOREST_COUNT; i++) {
      const sideSign = i % 2 === 0 ? -1 : 1;
      const z = sideSign * (RIVER_HALF + 22 + Math.pow(Math.random(), 0.8) * 110);
      const x = -250 + Math.random() * (RACE_LENGTH + 500);
      const s = 5 + Math.random() * 3;
      q.setFromAxisAngle(up, Math.random() * Math.PI);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
      forestSides.setMatrixAt(i, m);
      forestTops.setMatrixAt(i, m);
    }
    forestSides.frustumCulled = forestTops.frustumCulled = false;
    scene.add(forestSides, forestTops);
  }

  loader.load(MODEL_URL('boatman'), (gltf) => {
    fixMaterials(gltf.scene, maxAniso);
    models.boatman = gltf.scene;
    setRoster(lastRoster);
  }, undefined, (e) => console.warn('boatman.glb failed to load, keeping placeholder', e));

  // ----- Rowers -----
  let rowerViews = new Map();
  const BONES = {
    spine: 'mixamorigSpine', spine1: 'mixamorigSpine1', head: 'mixamorigHead',
    lArm: 'mixamorigLeftArm', lFore: 'mixamorigLeftForeArm', lHand: 'mixamorigLeftHand',
    rArm: 'mixamorigRightArm', rFore: 'mixamorigRightForeArm', rHand: 'mixamorigRightHand',
  };

  function makeRower(team) {
    if (!models.boatman) {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.6, 4, 8), new THREE.MeshStandardMaterial({ color: TEAMS[team].color }));
      body.position.y = 1.5;
      const holder = new THREE.Group();
      holder.add(body);
      return { rower: holder, bones: null };
    }
    const rower = cloneSkinned(models.boatman);
    rower.scale.setScalar(ROWER_SCALE);
    rower.rotation.y = Math.PI / 2;                        // model faces +Z, boat travels +X
    const bones = {};
    for (const [k, n] of Object.entries(BONES)) {
      const b = rower.getObjectByName(n);
      if (b) { b.userData.rest = b.quaternion.clone(); bones[k] = b; }
    }
    rower.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    return { rower, bones };
  }

  function makePaddle() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0xb98a52, roughness: 0.7 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.75, 8), wood);
    shaft.position.y = 0.875 + 0.45;                       // shaft above the blade
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.9, 0.04), new THREE.MeshStandardMaterial({ color: 0x9a6a36, roughness: 0.7 }));
    blade.position.y = 0.45;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8), wood);
    grip.rotation.z = Math.PI / 2;
    grip.position.y = 0.45 + 1.75;
    for (const p of [shaft, blade, grip]) { p.castShadow = true; g.add(p); }
    g.userData.length = 0.45 + 1.75;                       // blade centre -> top grip
    return g;
  }

  function setRoster(players) {
    lastRoster = players;
    for (const v of rowerViews.values()) v.label.parent?.remove(v.label);
    boats.forEach((b) => b.rowersGroup.clear());
    rowerViews = new Map();

    for (const p of players) {
      if (p.team == null || p.seat == null) continue;
      const { x, z, side } = seatOffset(p.seat);
      const group = boats[p.team].rowersGroup;

      const { rower, bones } = makeRower(p.team);
      rower.position.set(x, models.boatman ? 0.55 - 0.65 * ROWER_SCALE : 0, z);
      group.add(rower);

      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.13 * ROWER_SCALE, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: TEAMS[p.team].color })
      );
      if (bones?.head) group.add(cap);

      const paddle = makePaddle();
      group.add(paddle);

      const el = document.createElement('div');
      el.className = 'rower-label';
      el.textContent = p.name;
      const label = new CSS2DObject(el);
      label.position.set(x, 3.3, z + side * 1.5);
      group.add(label);

      rowerViews.set(p.id, { rower, bones, cap, paddle, side, x, label, el, group, team: p.team, splashed: 0 });
    }
  }

  // Pose one rower for stroke phase f (0..1), or "ready" (blade poised forward) when f is null.
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const fwdLocal = new THREE.Vector3(1, 0, 0);
  function poseRower(v, f) {
    const s = v.side;
    const phase = f == null ? 0.995 : f;
    const bladeL = bladePath(phase, v.x, s);
    // Top grip sits inboard, roughly over the blade, at chest height; the shaft leans with the stroke.
    const drive = phase < 0.55 ? clamp01((phase - 0.08) / 0.47) : phase < 0.68 ? 1 : 1 - (phase - 0.68) / 0.32;
    const topL = new THREE.Vector3(bladeL.x + lerp(-0.25, 0.35, drive), 1.55 + 0.15 * (1 - drive), s * 0.55);
    const axisL = topL.clone().sub(bladeL).normalize();
    const L = v.paddle.userData.length;

    // Place the paddle (boat coordinates): its Y axis along the shaft, blade face pushing water backwards.
    const yAx = axisL;
    const n = fwdLocal.clone().sub(yAx.clone().multiplyScalar(fwdLocal.dot(yAx))).normalize();
    const xAx = new THREE.Vector3().crossVectors(yAx, n);
    v.paddle.matrix.makeBasis(xAx, yAx, n).setPosition(bladeL.x, bladeL.y, bladeL.z);
    v.paddle.matrix.decompose(v.paddle.position, v.paddle.quaternion, v.paddle.scale);

    if (!v.bones) return bladeL;
    const B = v.bones;
    // Body: lean forward to reach at the catch, sit back at the end of the pull, twist toward the paddle.
    for (const k of Object.keys(B)) B[k].quaternion.copy(B[k].userData.rest);
    const lean = lerp(0.42, -0.08, drive);
    B.spine?.rotateX(lean);
    B.spine1?.rotateY(-s * 0.18);
    v.rower.updateMatrixWorld(true);

    // Hands: the outer hand grips the shaft low, the inner hand holds the top grip.
    const lowL = bladeL.clone().addScaledVector(axisL, L * 0.52);
    const highL = bladeL.clone().addScaledVector(axisL, L * 0.98);
    const lowW = v.group.localToWorld(lowL.clone());
    const highW = v.group.localToWorld(highL.clone());
    const groupQ = v.group.getWorldQuaternion(_q3.clone());
    const outer = s < 0 ? ['lArm', 'lFore', 'lHand'] : ['rArm', 'rFore', 'rHand'];
    const inner = s < 0 ? ['rArm', 'rFore', 'rHand'] : ['lArm', 'lFore', 'lHand'];
    const poleOuter = new THREE.Vector3(-0.4, -1, s * 0.7).applyQuaternion(groupQ);
    const poleInner = new THREE.Vector3(-0.5, -0.6, -s * 0.8).applyQuaternion(groupQ);
    for (const [names, target, pole] of [[outer, lowW, poleOuter], [inner, highW, poleInner]]) {
      const [u, f2, h] = names.map((k) => B[k]);
      if (!u || !f2 || !h) continue;
      if (u.userData.len == null) {                         // measure arm bone lengths once
        u.userData.len = u.getWorldPosition(tmp).distanceTo(f2.getWorldPosition(tmp2));
        f2.userData.len = f2.getWorldPosition(tmp).distanceTo(h.getWorldPosition(tmp2));
      }
      solveArm(u, f2, h, target, pole);
    }
    return bladeL;
  }

  // ----- Camera director -----
  const cam = { pos: new THREE.Vector3(-30, 20, 30), look: new THREE.Vector3(0, 0, 0), fov: 50 };
  const want = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, up: new THREE.Vector3(0, 1, 0) };
  const pip = { active: false, team: 1, pos: new THREE.Vector3(), look: new THREE.Vector3(), alpha: 0 };
  let prevPhase = null, cutUntil = 0, cutType = null, nextCutAt = 0, cutIdx = 0;
  let snap = true;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // How far back the chase camera must sit to fit `width` metres of river in view.
  function distanceToFit(width) {
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(50) / 2) * camera.aspect);
    return (width / 2) / Math.tan(hfov / 2);
  }

  function chaseShot(game, now, out) {
    const [a, b] = game.boats;
    const gap = Math.abs(a.x - b.x);
    const far = game.phase === 'race' && gap > PIP_GAP;
    const leadX = Math.max(a.x, b.x);
    // Close race: frame BOTH boats. Big gap: follow the leader (the other boat goes in the PiP window).
    const cx = far ? leadX : (a.x + b.x) / 2;
    const spanNeeded = (far ? 0 : gap) + BOAT_LEN + 14;
    const D0 = 33.6;                                          // length of the base offset below
    const zoom = THREE.MathUtils.clamp(distanceToFit(spanNeeded) * 1.15 / D0, 1, 2.3);
    const prog = leadX / RACE_LENGTH;
    const sprint = game.phase === 'race' && prog > 0.85 ? 0.78 : 1;
    const sway = Math.sin(now * 0.00031) * 3, bob = Math.sin(now * 0.00023) * 1.2;
    const k = zoom * sprint;
    out.pos.set(cx - 18 * k, (15 + bob) * k, 24 * k + sway);
    out.look.set(cx + 6, 0, 0);
    out.fov = 50;
    return far;
  }

  function direct(game, now, dt) {
    const phase = game.phase;
    if (phase !== prevPhase) { snap = true; prevPhase = phase; cutUntil = 0; nextCutAt = now + 11000; }
    want.up.set(0, 1, 0);
    const [r, bl] = game.boats;
    const leader = r.x >= bl.x ? 0 : 1, trailer = 1 - leader;
    const L = game.boats[leader], T = game.boats[trailer];
    let far = false;

    if (FORCE_CLOSE) {
      const view = params.get('v') || 'side';
      const rx = r.x + seatOffset(2).x, rz = LANE_Z[0] + r.z;
      if (view === 'front') { want.pos.set(rx + 7, 2.6, rz - 1.5); want.look.set(rx, 1.0, rz); }
      else { want.pos.set(rx + 1.5, 2.4, rz - 6.5); want.look.set(rx, 1.0, rz); }
      want.fov = 45; snap = true;
    } else if (FORCE_TOP && phase !== 'lobby') {
      const cx = Math.max(r.x, bl.x) - 10;
      want.pos.set(cx + 6, 70, 0.01); want.look.set(cx + 6, 0, 0); want.up.set(0, 0, -1); want.fov = 50;
    } else if (phase === 'lobby') {
      const ang = now * 0.00012;
      want.pos.set(Math.cos(ang) * 46, 15, Math.sin(ang) * 46);
      want.look.set(4, 1, 0);
      want.fov = 45;
    } else if (phase === 'countdown') {
      const t = clamp01(1 - (game.startAt - now) / COUNTDOWN_MS);
      const rowX = seatOffset(2).x;
      if (t < 0.36) {
        // Shot 1: low dolly arcing around the Red crew as they warm up.
        const u = ease(t / 0.36);
        want.pos.set(rowX - 9 + 15 * u, 2.3, LANE_Z[0] - 4.8 - 1.5 * u);
        want.look.set(rowX, 1.4, LANE_Z[0]);
        want.fov = 42;
        if (t < 0.02) snap = true;
      } else if (t < 0.66) {
        // Shot 2: sweep across the front of both boats, crews facing the camera.
        const u = ease((t - 0.36) / 0.3);
        want.pos.set(34 - 4 * u, 4 + 2 * u, -16 + 32 * u);
        want.look.set(6, 1.2, 0);
        want.fov = 40;
        if (t < 0.38) snap = true;
      } else {
        // Shot 3: crane up into the race camera.
        const u = ease((t - 0.66) / 0.34);
        const end = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
        chaseShot(game, now, end);
        want.pos.lerpVectors(V(30, 6, 16), end.pos, u);
        want.look.lerpVectors(V(6, 1.2, 0), end.look, u);
        want.fov = 40 + 10 * u;
      }
    } else if (phase === 'race') {
      far = chaseShot(game, now, want);
      if (params.get('cuts') === 'off') nextCutAt = Infinity;   // debug: no TV cuts
      const prog = L.x / RACE_LENGTH;
      if (CINEMATIC_CUTS && now > nextCutAt && cutUntil < now && prog < 0.82 && prog > 0.05) {
        cutType = ['alongside', 'headon', 'overhead'][cutIdx++ % 3];
        cutUntil = now + 3800;
        nextCutAt = now + 11000;
        snap = true;
      }
      if (cutUntil > now) {
        // Cuts always centre on the leader when the boats are far apart, so we never stare at empty water.
        const focusX = far ? L.x : (r.x + bl.x) / 2;
        const outerSide = leader === 0 ? -1 : 1;
        if (cutType === 'alongside') {
          want.pos.set(L.x + 6, 3.0, LANE_Z[leader] + L.z + outerSide * 8.5);
          want.look.set(L.x + 6, 1.2, LANE_Z[leader] + L.z);
          want.fov = 45;
        } else if (cutType === 'headon') {
          want.pos.set(L.x + 42, 5, far ? LANE_Z[leader] * 0.6 : 0);
          want.look.set(focusX + 4, 1, far ? LANE_Z[leader] : 0);
          want.fov = far ? 30 : 38;
        } else {
          const spanX = far ? BOAT_LEN + 16 : Math.abs(r.x - bl.x) + BOAT_LEN + 16;
          want.pos.set(focusX + 2, Math.max(48, spanX * 0.75), 0.01);
          want.look.set(focusX + 2, 0, 0);
          want.up.set(0, 0, -1);
          want.fov = 50;
        }
      } else if (cutType) { cutType = null; snap = true; }
    } else if (phase === 'finished') {
      const since = now - (game.finishAt || now);
      if (since < 3500) {
        want.pos.set(RACE_LENGTH + 3, 3.5, RIVER_HALF - 1);
        want.look.set(RACE_LENGTH - 6, 1.5, 0);
        want.fov = 48;
      } else {
        const W = game.boats[game.winner ?? 0];
        const ang = (now - game.finishAt) * 0.00015;
        want.pos.set(W.x + Math.cos(ang) * 30, 11, LANE_Z[game.winner ?? 0] + Math.sin(ang) * 30);
        want.look.set(W.x, 1.5, LANE_Z[game.winner ?? 0]);
        want.fov = 45;
        if (since < 3550) snap = true;
      }
    }

    const k = snap ? 1 : 1 - Math.exp(-dt * (phase === 'countdown' ? 8 : 3));
    cam.pos.lerp(want.pos, k);
    cam.look.lerp(want.look, k);
    cam.fov += (want.fov - cam.fov) * k;
    snap = false;

    let shake = 0, punch = 0;
    for (const b of game.boats) {
      const age = now - (b.syncFlashAt || -1e9);
      if (age < 350) shake = Math.max(shake, 1 - age / 350);
      if (age < 450) punch = Math.max(punch, 1 - age / 450);
    }
    camera.position.copy(cam.pos);
    if (shake) camera.position.add(V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.5 * shake));
    camera.up.copy(want.up);
    camera.lookAt(cam.look);
    camera.fov = cam.fov - 5 * punch;
    camera.updateProjectionMatrix();

    // Picture-in-picture: chase the trailing boat.
    pip.active = far;
    if (pip.active) {
      const outerSide = trailer === 0 ? -1 : 1;
      const tz = LANE_Z[trailer] + T.z;
      const pp = V(T.x - 16, 9, tz + outerSide * 14), pl = V(T.x + 5, 0.8, tz);
      if (pip.team !== trailer || pip.alpha === 0) { pip.pos.copy(pp); pip.look.copy(pl); pip.team = trailer; }
      pip.pos.lerp(pp, 1 - Math.exp(-dt * 4));
      pip.look.lerp(pl, 1 - Math.exp(-dt * 4));
      pipCam.position.copy(pip.pos);
      pipCam.lookAt(pip.look);
      const span = pipEl.firstChild;
      const txt = `${TEAMS[trailer].name.toUpperCase()} · ${(L.x - T.x).toFixed(0)} m behind`;
      if (span.textContent !== txt) span.textContent = txt;
      pipEl.style.borderColor = TEAMS[trailer].css;
    }
    pip.alpha = pip.active ? 1 : 0;
    pipEl.classList.toggle('on', pip.active);

    sky.position.copy(camera.position);
    sun.position.set(cam.look.x + 40, 80, cam.look.z + 30);
    sun.target.position.copy(cam.look);
  }

  // ----- Per-frame update -----
  function update(game, now, dt) {
    game.boats.forEach((b, i) => {
      const g = boats[i].group;
      g.position.x = b.x;
      g.position.z = LANE_Z[i] + b.z;
      g.rotation.y = b.yaw;
      g.rotation.x = b.roll;
      g.position.y = Math.sin(now * 0.002 + i) * 0.05;
      const flash = 1 - (now - (b.syncFlashAt || 0)) / 800;
      boats[i].syncEl.style.opacity = flash > 0 ? flash.toFixed(2) : '0';
      boats[i].syncEl.style.transform = flash > 0 ? `scale(${1 + flash * 0.4})` : '';
      boats[i].flag.rotation.y = Math.sin(now * 0.008 + i * 2) * 0.25;
    });
    scene.updateMatrixWorld();

    // Wake foam along the hull and behind it, spray from the bow when fast.
    game.boats.forEach((b, i) => {
      const speed = b.v + (now < b.surgeUntil ? b.surgePower : 0);
      if (speed < 0.4) return;
      const g = boats[i].group;
      const n = Math.min(6, Math.floor(speed * dt * 9 + Math.random()));
      for (let k = 0; k < n; k++) {
        const along = -BOAT_HALF_LEN + Math.random() * BOAT_LEN * 0.9;
        const side = Math.random() < 0.5 ? -1 : 1;
        g.localToWorld(tmp.set(along, 0.1, side * 1.75));
        particles.emit(tmp.x, 0.08, tmp.z, -speed * 0.15, 0, side * 0.6, 2.6, 0.6, 1.3, 0, 0.55);
      }
      if (speed > 4.5 && Math.random() < speed * dt * 2) {
        for (const side of [-1, 1]) {
          g.localToWorld(tmp.set(BOAT_HALF_LEN + 0.5, 0.3, side * 0.4));
          particles.emit(tmp.x, 0.3, tmp.z, speed * 0.3, 1.2 + Math.random(), side * (1.2 + Math.random()), 0.7, 0.3, 0.3, 9.8, 0.85);
        }
      }
    });

    // Rowers: paddle stroke, hands on the paddle, splashes.
    const iv = 60000 / (game.bpm || 56);
    for (const [id, v] of rowerViews) {
      const p = game.players.get(id);
      if (!p) continue;
      let strokeStart = p.strokeAt || 0;
      if (game.phase === 'countdown') strokeStart = game.anchor + Math.floor((now - game.anchor) / iv) * iv;
      const f = (now - strokeStart) / STROKE_ANIM_MS;
      const phaseF = game.phase !== 'lobby' && f >= 0 && f < 1 ? f : null;
      const bladeL = poseRower(v, phaseF);

      if (phaseF != null && phaseF > 0.07 && phaseF < 0.3 && v.splashed !== strokeStart) {
        v.splashed = strokeStart;
        v.group.localToWorld(tmp.copy(bladeL));
        for (let k = 0; k < 10; k++) {
          particles.emit(tmp.x, 0.15, tmp.z, (Math.random() - 0.6) * 1.6, 1.4 + Math.random() * 2.2,
            v.side * (0.3 + Math.random()), 0.65, 0.22, 0.25, 9.8, 0.9);
        }
        particles.emit(tmp.x, 0.08, tmp.z, 0, 0, 0, 1.4, 0.5, 1.2, 0, 0.6);
      }
      if (phaseF != null && phaseF > 0.1 && phaseF < 0.55 && Math.random() < 0.5) {
        v.group.localToWorld(tmp.copy(bladeL));               // foam trail while the blade pulls
        particles.emit(tmp.x, 0.08, tmp.z, 0, 0, v.side * 0.2, 1.2, 0.35, 0.8, 0, 0.45);
      }

      if (v.bones?.head) {
        v.bones.head.getWorldPosition(tmp);
        v.group.worldToLocal(tmp);
        v.cap.position.set(tmp.x, tmp.y + 0.12 * ROWER_SCALE, tmp.z);
      }

      const cls = p.strokeAt ? (p.q >= 0.75 ? 'good' : p.q >= 0.35 ? 'ok' : 'bad') : '';
      const wantCls = `rower-label ${cls}`;
      if (v.el.className !== wantCls) v.el.className = wantCls;
    }

    const focusX = (game.boats[0].x + game.boats[1].x) / 2;
    const excite = game.phase === 'race' || game.phase === 'finished' ? 1 : game.phase === 'countdown' ? 0.5 : 0.15;
    animateCrowd(now, focusX, excite);

    swells.offset.x += dt * 0.012; swells.offset.y += dt * 0.006;
    ripples.offset.x -= dt * 0.03; ripples.offset.y += dt * 0.018;

    direct(game, now, dt);
    particles.update(dt, renderer.domElement.height, camera);
  }

  let W = 1, H = 1;
  function resize() {
    W = container.clientWidth; H = container.clientHeight;
    renderer.setSize(W, H);
    labelRenderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function render() {
    renderer.setViewport(0, 0, W, H);
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    if (pip.active) {
      // Draw the trailing boat into the PiP frame (bottom-right corner).
      const pw = Math.round(W * 0.28), ph = Math.round(pw * 9 / 16), px = W - pw - 18, py = 64;
      Object.assign(pipEl.style, { width: `${pw}px`, height: `${ph}px`, right: '18px', bottom: `${py}px` });
      pipCam.aspect = pw / ph;
      pipCam.updateProjectionMatrix();
      renderer.setScissorTest(true);
      renderer.setScissor(px, py, pw, ph);
      renderer.setViewport(px, py, pw, ph);
      particles.mat.uniforms.uScale.value = ph * renderer.getPixelRatio() * pipCam.projectionMatrix.elements[5] * 0.5;
      renderer.render(scene, pipCam);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
    }
  }

  return { setRoster, update, render };
}
