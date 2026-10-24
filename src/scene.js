// The 3D race view shown on the laptop.
// - Real models (boat, boatman, palm) load from /public/models; placeholders show until they arrive.
// - A "camera director" runs the cinematic intro, the race chase cam, TV-style cuts and the finish.
// - Water ripples, sky, foam wakes, bow spray and paddle splashes make it feel alive.
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import {
  RACE_LENGTH, TEAMS, MAX_PER_TEAM, COUNTDOWN_MS, RIVER_HALF, LANE_Z, BOAT_HALF_LEN, CINEMATIC_CUTS,
} from './config.js';

const BOAT_LEN = BOAT_HALF_LEN * 2;
const ROWS = Math.ceil(MAX_PER_TEAM / 2);
const ROWER_SCALE = 1.4;        // boatman size (1 = model's own size)
const STROKE_ANIM_MS = 650;     // how long one paddling motion takes on screen
const PALM_COUNT = 260;

// Debug: host.html?cam=top gives the old flat top view for the whole race.
const params = new URLSearchParams(location.search);
const FORCE_TOP = params.get('cam') === 'top';

const MODEL_URL = (name) => `${import.meta.env.BASE_URL}models/${name}.glb`;
const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

// Seat 0,2,4… sit on the left side, 1,3,5… on the right, front to back.
export function seatOffset(seat) {
  const row = Math.floor(seat / 2);
  const side = seat % 2 === 0 ? -1 : 1;
  const span = BOAT_LEN - 16;   // keep rowers away from the narrow bow and the tall stern
  const x = span / 2 - row * (span / Math.max(1, ROWS - 1));
  return { x, z: side * 0.8, side };
}

// Meshy exports leave "metal" at its default (fully metal), which renders near-black.
function fixMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const mat of [].concat(o.material)) {
      mat.metalness = 0;
      mat.metalnessMap = null;
      mat.needsUpdate = true;
    }
  });
}

// Paddling pose: a = +1 "catch" (leaning forward, arms reaching), a = -1 "finish" (pulled back).
function poseRower(bones, a) {
  const fwd = Math.max(0, a), back = Math.max(0, -a);
  const set = (bone, axis, angle) => {
    if (!bone) return;
    bone.quaternion.copy(bone.userData.rest);
    if (angle) bone.rotateOnAxis(axis, angle);
  };
  const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
  set(bones.spine, X, 0.5 * fwd - 0.2 * back);
  set(bones.lArm, Z, 1.05 * fwd - 0.35 * back);
  set(bones.rArm, Z, -1.05 * fwd + 0.35 * back);
  set(bones.lFore, Z, 0.2 * fwd + 0.6 * back);
  set(bones.rFore, Z, -0.2 * fwd - 0.6 * back);
}

// Stroke timeline -> pose value: reach forward, pull back hard, recover to rest.
function strokeCurve(s) {
  if (s <= 0 || s >= 1) return 0;
  if (s < 0.3) return s / 0.3;
  if (s < 0.7) return 1 - ((s - 0.3) / 0.4) * 1.6;
  return -0.6 + ((s - 0.7) / 0.3) * 0.6;
}

// ---------- Procedural textures (generated once, no image files needed) ----------
function makeWaterNormalMap() {
  const N = 256, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx2 = cv.getContext('2d'), img = ctx2.createImageData(N, N);
  const waves = Array.from({ length: 10 }, () => ({
    fx: 1 + Math.floor(Math.random() * 6), fy: 1 + Math.floor(Math.random() * 6),
    ph: Math.random() * 6.28, a: 0.3 + Math.random(),
  }));
  const h = (x, y) => waves.reduce((s, w) => s + w.a * Math.sin((w.fx * x + w.fy * y) * 2 * Math.PI / N + w.ph), 0);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
    const len = Math.hypot(dx, dy, 6);
    const i = (y * N + x) * 4;
    img.data[i] = (-dx / len * 0.5 + 0.5) * 255;
    img.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
    img.data[i + 2] = (6 / len * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx2.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeGrassTexture() {
  const N = 256, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.fillStyle = '#4f8a3a';
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 3500; i++) {
    const shade = 50 + Math.random() * 60;
    g.fillStyle = `rgba(${shade * 0.6},${shade + 40},${shade * 0.4},0.35)`;
    g.fillRect(Math.random() * N, Math.random() * N, 2 + Math.random() * 4, 2 + Math.random() * 4);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- Particles: foam, spray and splashes ----------
class Particles {
  constructor(scene, max = 4000) {
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

export function createRaceScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color(0xd9e6ea);
  scene.fog = new THREE.Fog(HORIZON, 140, 650);

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
  scene.add(sky);

  // Reflections and soft light come from the same sky.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.7;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5a3a, 0.6));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);

  // ----- World -----
  const worldLen = RACE_LENGTH + 700;
  const worldMidX = RACE_LENGTH / 2;

  const waterNormals = makeWaterNormalMap();
  waterNormals.repeat.set(worldLen / 14, (RIVER_HALF * 2) / 14);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(worldLen, RIVER_HALF * 2 + 4),
    new THREE.MeshStandardMaterial({
      color: 0x24605a, roughness: 0.12, metalness: 0,
      normalMap: waterNormals, normalScale: new THREE.Vector2(0.45, 0.45),
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.x = worldMidX;
  water.receiveShadow = true;
  scene.add(water);

  const grass = makeGrassTexture();
  grass.repeat.set(worldLen / 10, 12);
  for (const s of [-1, 1]) {
    const bank = new THREE.Mesh(new THREE.PlaneGeometry(worldLen, 120), new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 }));
    bank.rotation.x = -Math.PI / 2;
    bank.position.set(worldMidX, 0.15, s * (RIVER_HALF + 60));
    bank.receiveShadow = true;
    scene.add(bank);
    // Muddy edge where the bank meets the water.
    const mud = new THREE.Mesh(new THREE.PlaneGeometry(worldLen, 2.2), new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 1 }));
    mud.rotation.x = -Math.PI / 2;
    mud.position.set(worldMidX, 0.1, s * (RIVER_HALF + 0.6));
    scene.add(mud);
  }

  // Lane buoys down the middle: the line the boats can't cross.
  const buoyCount = Math.ceil((RACE_LENGTH + 100) / 4);
  const buoys = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.4 }), buoyCount);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  for (let i = 0; i < buoyCount; i++) {
    m.makeTranslation(-50 + i * 4, 0.12, 0);
    buoys.setMatrixAt(i, m);
    buoys.setColorAt(i, col.setHex(i % 2 ? 0xffffff : 0xe53935));
  }
  scene.add(buoys);

  // Palms along both banks.
  const palmSpots = Array.from({ length: PALM_COUNT }, (_, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    return {
      x: -150 + Math.random() * (RACE_LENGTH + 320),
      z: side * (RIVER_HALF + 2 + Math.random() * 14),
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

  // Crowd (placeholder people: body + head) along both banks. Real crowd model comes later.
  const crowdCount = 1200;
  const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.28, 0.8, 3, 8), new THREE.MeshStandardMaterial({ roughness: 0.9 }), crowdCount);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.8 }), crowdCount);
  const shirt = [0xffffff, 0xf3b33d, 0xd63a2f, 0x2f6fd6, 0x9c27b0, 0x4caf50, 0xffffff, 0xf5f0e1, 0xff8a65];
  const crowdSpots = [];
  for (let i = 0; i < crowdCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const c = { x: -60 + Math.random() * (RACE_LENGTH + 140), z: side * (RIVER_HALF + 1.6 + Math.random() * 3.5), ph: Math.random() * 6.3 };
    crowdSpots.push(c);
    m.makeTranslation(c.x, 0.85, c.z); bodies.setMatrixAt(i, m);
    m.makeTranslation(c.x, 1.55, c.z); heads.setMatrixAt(i, m);
    bodies.setColorAt(i, col.setHex(shirt[i % shirt.length]));
  }
  scene.add(bodies, heads);
  // Crowd near the boats bounces with excitement.
  function animateCrowd(now, focusX, excite) {
    for (let i = 0; i < crowdCount; i++) {
      const c = crowdSpots[i];
      if (Math.abs(c.x - focusX) > 90) continue;
      const jump = Math.max(0, Math.sin(now * 0.012 + c.ph)) * 0.35 * excite;
      m.makeTranslation(c.x, 0.85 + jump, c.z); bodies.setMatrixAt(i, m);
      m.makeTranslation(c.x, 1.55 + jump, c.z); heads.setMatrixAt(i, m);
    }
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
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

    // Team pennant near the bow.
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

  // ----- Load the real models -----
  const models = { boatman: null };
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let lastRoster = [];

  loader.load(MODEL_URL('boat'), (gltf) => {
    const src = gltf.scene;
    fixMaterials(src);
    src.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const box = new THREE.Box3().setFromObject(src);
    const s = BOAT_LEN / (box.max.x - box.min.x);
    boats.forEach((b) => {
      const hull = src.clone(true);
      hull.scale.setScalar(s);
      hull.position.x = -((box.max.x + box.min.x) / 2) * s;
      hull.position.y = -0.6 - box.min.y * s;
      b.group.remove(b.placeholder);
      b.group.add(hull);
    });
  }, undefined, (e) => console.warn('boat.glb failed to load, keeping placeholder', e));

  loader.load(MODEL_URL('palm'), (gltf) => {
    let mesh = null;
    fixMaterials(gltf.scene);
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
  }, undefined, (e) => console.warn('palm.glb failed to load, keeping placeholder', e));

  loader.load(MODEL_URL('boatman'), (gltf) => {
    fixMaterials(gltf.scene);
    models.boatman = gltf.scene;
    setRoster(lastRoster);
  }, undefined, (e) => console.warn('boatman.glb failed to load, keeping placeholder', e));

  // ----- Rowers -----
  let rowerViews = new Map();

  function makeRower(team) {
    if (!models.boatman) {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.6, 4, 8), new THREE.MeshStandardMaterial({ color: TEAMS[team].color }));
      body.position.y = 1.5;
      const holder = new THREE.Group();
      holder.add(body);
      return { rower: holder, bones: null, head: null };
    }
    const rower = cloneSkinned(models.boatman);
    rower.scale.setScalar(ROWER_SCALE);
    rower.rotation.y = Math.PI / 2;                       // model faces +Z, boat travels +X
    const bones = {};
    const names = {
      spine: 'mixamorigSpine', lArm: 'mixamorigLeftArm', rArm: 'mixamorigRightArm',
      lFore: 'mixamorigLeftForeArm', rFore: 'mixamorigRightForeArm', head: 'mixamorigHead',
    };
    for (const [k, n] of Object.entries(names)) {
      const b = rower.getObjectByName(n);
      if (b) { b.userData.rest = b.quaternion.clone(); bones[k] = b; }
    }
    rower.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
    return { rower, bones, head: bones.head };
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

      const { rower, bones, head } = makeRower(p.team);
      rower.position.set(x, models.boatman ? 0.55 - 0.65 * ROWER_SCALE : 0, z);
      group.add(rower);

      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.13 * ROWER_SCALE, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: TEAMS[p.team].color })
      );
      if (head) group.add(cap);

      const paddle = new THREE.Group();
      paddle.position.set(x + 0.3, 1.2, side * 1.35);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2), new THREE.MeshStandardMaterial({ color: 0xc89a5b }));
      shaft.position.y = -0.9;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.05), new THREE.MeshStandardMaterial({ color: 0xa8763e }));
      blade.position.y = -1.9;
      paddle.add(shaft, blade);
      paddle.rotation.x = side * 0.35;
      group.add(paddle);

      const el = document.createElement('div');
      el.className = 'rower-label';
      el.textContent = p.name;
      const label = new CSS2DObject(el);
      label.position.set(x, 3.2, z + side * 1.6);
      group.add(label);

      rowerViews.set(p.id, { rower, bones, head, cap, paddle, blade, side, label, el, group, team: p.team, splashed: 0 });
    }
  }

  // ----- Camera director -----
  const cam = { pos: new THREE.Vector3(-30, 20, 30), look: new THREE.Vector3(0, 0, 0), fov: 50 };
  const want = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, up: new THREE.Vector3(0, 1, 0) };
  let prevPhase = null, cutUntil = 0, cutType = null, nextCutAt = 0, cutIdx = 0;
  let snap = true;   // jump straight to the next shot instead of gliding there
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  function chaseShot(game, now, out) {
    const [a, b] = game.boats;
    const cx = (a.x + b.x) / 2, gap = Math.abs(a.x - b.x);
    const prog = Math.max(a.x, b.x) / RACE_LENGTH;
    const zoom = 1 + Math.min(gap / 45, 0.9);
    const sprint = game.phase === 'race' && prog > 0.85 ? 0.75 : 1;
    const sway = Math.sin(now * 0.00031) * 3, bob = Math.sin(now * 0.00023) * 1.2;
    out.pos.set(cx - 18 * zoom * sprint, (15 + bob) * zoom * sprint, 24 * zoom * sprint + sway);
    out.look.set(cx + 6, 0, 0);
    out.fov = 50;
  }

  function direct(game, now, dt) {
    const phase = game.phase;
    if (phase !== prevPhase) { snap = true; prevPhase = phase; cutUntil = 0; nextCutAt = now + 11000; }
    want.up.set(0, 1, 0);
    const [r, bl] = game.boats;
    const cx = (r.x + bl.x) / 2;

    if (FORCE_TOP && phase !== 'lobby') {
      want.pos.set(cx + 6, 70, 0.01); want.look.set(cx + 6, 0, 0); want.up.set(0, 0, -1); want.fov = 50;
    } else if (phase === 'lobby') {
      // Attract mode: slow orbit around the boats on the start line.
      const ang = now * 0.00012;
      want.pos.set(Math.cos(ang) * 46, 15, Math.sin(ang) * 46);
      want.look.set(4, 1, 0);
      want.fov = 45;
    } else if (phase === 'countdown') {
      const t = clamp01(1 - (game.startAt - now) / COUNTDOWN_MS);
      if (t < 0.36) {
        // Shot 1: low dolly that arcs around the Red rowers as they warm up, from behind to beside them.
        const u = ease(t / 0.36);
        const rowX = seatOffset(0).x;
        want.pos.set(rowX - 9 + 14 * u, 2.3, LANE_Z[0] - 4.5 - 1.5 * u);
        want.look.set(rowX, 1.5, LANE_Z[0]);
        want.fov = 40;
        if (t < 0.02) snap = true;
      } else if (t < 0.66) {
        // Shot 2: sweep across the front of both boats, rowers facing the camera.
        const u = ease((t - 0.36) / 0.3);
        want.pos.set(36 - 4 * u, 4 + 2 * u, -16 + 32 * u);
        want.look.set(9, 1.2, 0);
        want.fov = 40;
        if (t < 0.38) snap = true;
      } else {
        // Shot 3: crane up and back into the race camera.
        const u = ease((t - 0.66) / 0.34);
        const end = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
        chaseShot(game, now, end);
        want.pos.lerpVectors(V(32, 6, 16), end.pos, u);
        want.look.lerpVectors(V(9, 1.2, 0), end.look, u);
        want.fov = 40 + 10 * u;
      }
    } else if (phase === 'race') {
      chaseShot(game, now, want);
      const prog = Math.max(r.x, bl.x) / RACE_LENGTH;
      // TV-style cuts every ~11 s (not in the final sprint).
      if (CINEMATIC_CUTS && now > nextCutAt && cutUntil < now && prog < 0.82 && prog > 0.05) {
        cutType = ['alongside', 'headon', 'overhead'][cutIdx++ % 3];
        cutUntil = now + 3800;
        nextCutAt = now + 11000;
        snap = true;
      }
      if (cutUntil > now) {
        const leader = r.x >= bl.x ? 0 : 1, L = game.boats[leader];
        const outer = leader === 0 ? -1 : 1;
        if (cutType === 'alongside') {
          // Tracking shot beside the leading boat: see the boatmen paddle up close.
          want.pos.set(L.x + 6, 3.2, LANE_Z[leader] + L.z + outer * 9);
          want.look.set(L.x + 9, 1.3, LANE_Z[leader] + L.z);
          want.fov = 45;
        } else if (cutType === 'headon') {
          want.pos.set(Math.max(r.x, bl.x) + 42, 5, 0);
          want.look.set(cx + 6, 1, 0);
          want.fov = 38;
        } else {
          want.pos.set(cx + 6, 62, 0.01);
          want.look.set(cx + 6, 0, 0);
          want.up.set(0, 0, -1);
          want.fov = 50;
        }
      } else if (cutType) { cutType = null; snap = true; }
    } else if (phase === 'finished') {
      const since = now - (game.finishAt || now);
      if (since < 3500) {
        // Finish-line camera, low on the bank, watching boats cross (in slow motion).
        want.pos.set(RACE_LENGTH + 3, 3.5, RIVER_HALF - 1);
        want.look.set(RACE_LENGTH - 6, 1.5, 0);
        want.fov = 48;
      } else {
        // Victory orbit around the winning boat.
        const W = game.boats[game.winner ?? 0];
        const ang = (now - game.finishAt) * 0.00015;
        want.pos.set(W.x + Math.cos(ang) * 30, 11, LANE_Z[game.winner ?? 0] + Math.sin(ang) * 30);
        want.look.set(W.x, 1.5, LANE_Z[game.winner ?? 0]);
        want.fov = 45;
        if (since < 3550) snap = true;
      }
    }

    // Glide toward the wanted shot (or jump on a cut).
    const k = snap ? 1 : 1 - Math.exp(-dt * (phase === 'countdown' ? 8 : 3));
    cam.pos.lerp(want.pos, k);
    cam.look.lerp(want.look, k);
    cam.fov += (want.fov - cam.fov) * k;
    snap = false;

    // SYNC: camera shake + zoom punch.
    let shake = 0, punch = 0;
    for (const b of game.boats) {
      const age = now - (b.syncFlashAt || -1e9);
      if (age < 350) shake = Math.max(shake, 1 - age / 350);
      if (age < 450) punch = Math.max(punch, 1 - age / 450);
    }
    camera.position.copy(cam.pos);
    if (shake) camera.position.add(V((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(0.5 * shake));
    camera.up.copy(want.up);
    camera.lookAt(cam.look);
    camera.fov = cam.fov - 5 * punch;
    camera.updateProjectionMatrix();

    // Sky follows the camera; the shadow area follows what we're looking at.
    sky.position.copy(camera.position);
    sun.position.set(cam.look.x + 40, 80, cam.look.z + 30);
    sun.target.position.copy(cam.look);
  }

  // ----- Per-frame update -----
  const tmp = new THREE.Vector3();
  const local = new THREE.Vector3();

  function update(game, now, dt) {
    game.boats.forEach((b, i) => {
      const g = boats[i].group;
      g.position.x = b.x;
      g.position.z = LANE_Z[i] + b.z;
      g.rotation.y = b.yaw;
      g.rotation.x = b.roll;
      g.position.y = Math.sin(now * 0.002 + i) * 0.05;           // gentle bob on the water
      const flash = 1 - (now - (b.syncFlashAt || 0)) / 800;
      boats[i].syncEl.style.opacity = flash > 0 ? flash.toFixed(2) : '0';
      boats[i].syncEl.style.transform = flash > 0 ? `scale(${1 + flash * 0.4})` : '';
      boats[i].flag.rotation.y = Math.sin(now * 0.008 + i * 2) * 0.25; // flag flutter
    });
    scene.updateMatrixWorld();

    // Wake foam from the stern and sides, spray from the bow when fast.
    game.boats.forEach((b, i) => {
      const speed = b.v + (now < b.surgeUntil ? b.surgePower : 0);
      if (speed < 0.4) return;
      const g = boats[i].group;
      const n = Math.min(6, Math.floor(speed * dt * 9 + Math.random()));
      for (let k = 0; k < n; k++) {
        const along = -BOAT_HALF_LEN + Math.random() * BOAT_LEN * 0.9;
        const side = Math.random() < 0.5 ? -1 : 1;
        local.set(along, 0.1, side * 1.7);
        g.localToWorld(tmp.copy(local));
        particles.emit(tmp.x, 0.08, tmp.z, -speed * 0.15, 0, side * 0.6, 2.6, 0.6, 1.3, 0, 0.55);
      }
      if (speed > 4.5 && Math.random() < speed * dt * 2) {
        for (const side of [-1, 1]) {
          g.localToWorld(tmp.set(BOAT_HALF_LEN + 0.5, 0.3, side * 0.4));
          particles.emit(tmp.x, 0.3, tmp.z, speed * 0.3, 1.2 + Math.random(), side * (1.2 + Math.random()), 0.7, 0.3, 0.3, 9.8, 0.85);
        }
      }
    });

    // Rowers: stroke animation, paddles, caps, splashes.
    const iv = 60000 / (game.bpm || 56);
    for (const [id, v] of rowerViews) {
      const p = game.players.get(id);
      if (!p) continue;
      // During the intro everyone does warm-up strokes on the drum; in the race it's the real strokes.
      let strokeStart = p.strokeAt || 0;
      if (game.phase === 'countdown') strokeStart = game.anchor + Math.floor((now - game.anchor) / iv) * iv + v.side * 40;
      const s = (now - strokeStart) / STROKE_ANIM_MS;
      const a = game.phase === 'lobby' ? Math.sin(now * 0.0015 + v.side) * 0.08 : strokeCurve(s);

      if (v.bones) poseRower(v.bones, a);
      v.paddle.rotation.z = -a * 0.75;

      // Splash as the blade digs in at the start of the pull.
      if (s >= 0.3 && s < 0.6 && v.splashed !== strokeStart) {
        v.splashed = strokeStart;
        v.blade.getWorldPosition(tmp);
        for (let k = 0; k < 9; k++) {
          particles.emit(tmp.x, 0.15, tmp.z, (Math.random() - 0.7) * 1.5, 1.5 + Math.random() * 2,
            v.side * (0.3 + Math.random()) * (v.team === 0 ? 1 : 1), 0.65, 0.22, 0.25, 9.8, 0.9);
        }
        particles.emit(tmp.x, 0.08, tmp.z, 0, 0, 0, 1.4, 0.5, 1.2, 0, 0.6);
      }

      if (v.head) {
        v.rower.updateMatrixWorld(true);
        v.head.getWorldPosition(tmp);
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

    waterNormals.offset.x += dt * 0.025;
    waterNormals.offset.y += dt * 0.012;

    direct(game, now, dt);
    particles.update(dt, renderer.domElement.height, camera);
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function render() {
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  return { setRoster, update, render };
}
