// The 3D top view shown on the laptop.
// Real models (boat, boatman, palm) load from /public/models. Until they finish loading,
// simple placeholder shapes are shown, so the game never waits on a slow download.
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// The Meshy exports don't set a metal value, and glTF's default is "fully metal", which renders
// near-black. Wood, leaves and skin aren't metal, so force it off.
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
import { RACE_LENGTH, TEAMS, MAX_PER_TEAM } from './config.js';

const RIVER_HALF = 18;          // river is 36 m wide, so the palm-lined banks stay in view
const BOAT_Z = [-7, 7];         // Red lane above, Blue lane below (as seen on screen)
const BOAT_LEN = 34;            // metres, bow to stern
const ROWS = Math.ceil(MAX_PER_TEAM / 2);

// Debug: add ?cam=20&tilt=15 to host.html to look closer / from an angle.
const params = new URLSearchParams(location.search);
const CAMERA_HEIGHT = Number(params.get('cam')) || 58;  // lower = more zoomed in on the boats
const CAMERA_TILT = Number(params.get('tilt')) || 0;    // metres the camera sits "south" of the boats
const ROWER_SCALE = 1.4;        // boatman size (1 = model's own size)
const STROKE_ANIM_MS = 650;     // how long one paddling motion takes on screen
const PALM_COUNT = 260;

const MODEL_URL = (name) => `${import.meta.env.BASE_URL}models/${name}.glb`;

// Seat 0,2,4… sit on the left side, 1,3,5… on the right, front to back.
export function seatOffset(seat) {
  const row = Math.floor(seat / 2);
  const side = seat % 2 === 0 ? -1 : 1;
  const span = BOAT_LEN - 16;   // keep rowers away from the narrow bow and the tall stern
  const x = span / 2 - row * (span / Math.max(1, ROWS - 1));
  return { x, z: side * 0.8, side };
}

// Paddling pose: a = +1 is the "catch" (leaning forward, arms reaching),
// a = -1 is the "finish" (sitting back, arms pulled in), 0 is resting.
// Values were found by testing this Mixamo skeleton's bone axes.
function poseRower(bones, a) {
  const fwd = Math.max(0, a), back = Math.max(0, -a);
  const set = (bone, axis, angle) => {
    if (!bone) return;
    bone.quaternion.copy(bone.userData.rest);
    if (angle) bone.rotateOnAxis(axis, angle);
  };
  const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
  set(bones.spine, X, 0.45 * fwd - 0.15 * back);
  set(bones.lArm, Z, 1.0 * fwd - 0.3 * back);
  set(bones.rArm, Z, -1.0 * fwd + 0.3 * back);
  set(bones.lFore, Z, 0.2 * fwd + 0.6 * back);
  set(bones.rFore, Z, -0.2 * fwd - 0.6 * back);
}

// Stroke timeline -> pose value: reach forward, pull back hard, recover to rest.
function strokeCurve(s) {
  if (s <= 0 || s >= 1) return 0;
  if (s < 0.3) return s / 0.3;                       // 0 -> 1   reach
  if (s < 0.7) return 1 - ((s - 0.3) / 0.4) * 1.6;   // 1 -> -0.6 pull
  return -0.6 + ((s - 0.7) / 0.3) * 0.6;             // -0.6 -> 0 recover
}

export function createRaceScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b9d9);
  // Soft all-around light so models aren't flat. (A Poly Haven sky HDRI can replace this later.)
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5a3a, 1.0));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.0);
  sun.position.set(60, 120, 40);
  scene.add(sun);

  // Camera looks straight down; boats travel left -> right on screen.
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 3000);
  camera.up.set(0, 0, -1);
  let camX = 0;

  // ----- World -----
  const worldLen = RACE_LENGTH + 500;
  const worldMidX = RACE_LENGTH / 2;

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(worldLen, RIVER_HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0x2c6a63, roughness: 0.7, metalness: 0 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.x = worldMidX;
  scene.add(water);

  for (const s of [-1, 1]) {
    const bank = new THREE.Mesh(
      new THREE.PlaneGeometry(worldLen, 80),
      new THREE.MeshStandardMaterial({ color: 0x4a8f3c })
    );
    bank.rotation.x = -Math.PI / 2;
    bank.position.set(worldMidX, 0.02, s * (RIVER_HALF + 40));
    scene.add(bank);
  }

  // Palm positions are decided once, used by the placeholder and then the real model.
  const palmSpots = Array.from({ length: PALM_COUNT }, (_, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    return {
      x: -120 + Math.random() * (RACE_LENGTH + 260),
      z: side * (RIVER_HALF + 1.5 + Math.random() * 8),  // a line of palms right along the riverbank
      scale: 5 + Math.random() * 2.5,             // ~9-14 m tall palms
      rot: Math.random() * Math.PI * 2,
    };
  });
  const m = new THREE.Matrix4();
  const placeholderPalms = new THREE.InstancedMesh(
    new THREE.SphereGeometry(2.6, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2d6b2a }), PALM_COUNT
  );
  palmSpots.forEach((p, i) => {
    m.compose(new THREE.Vector3(p.x, 3, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 0.35, 1));
    placeholderPalms.setMatrixAt(i, m);
  });
  scene.add(placeholderPalms);

  // Crowd (placeholder: colourful boxes) along both banks. Real crowd models come later.
  const crowdCount = 700;
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 1.6, 0.8), new THREE.MeshStandardMaterial(), crowdCount);
  const shirt = [0xffffff, 0xf3b33d, 0xd63a2f, 0x2f6fd6, 0x9c27b0, 0x4caf50];
  const c = new THREE.Color();
  for (let i = 0; i < crowdCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    m.makeTranslation(-60 + Math.random() * (RACE_LENGTH + 120), 0.8, side * (RIVER_HALF + 1 + Math.random() * 3));
    crowd.setMatrixAt(i, m);
    crowd.setColorAt(i, c.setHex(shirt[i % shirt.length]));
  }
  scene.add(crowd);

  const addLabel = (text, cls, x, y, z) => {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(x, y, z);
    scene.add(obj);
  };

  // Start line, distance markers and finish line.
  const line = (x, color) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, RIVER_HALF * 2), new THREE.MeshBasicMaterial({ color }));
    l.position.set(x, 0.06, 0);
    scene.add(l);
  };
  line(0, 0xffeb3b);
  for (let d = 100; d < RACE_LENGTH; d += 100) addLabel(`${d} m`, 'marker-label', d, 1, -RIVER_HALF - 2);
  line(RACE_LENGTH, 0xffffff);
  for (const s of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0xc62828 }));
    pole.position.set(RACE_LENGTH, 4, s * RIVER_HALF);
    scene.add(pole);
  }
  addLabel('FINISH', 'finish-label', RACE_LENGTH, 9, 0);

  // ----- Boats -----
  const boats = TEAMS.map((team, i) => {
    const g = new THREE.Group();
    g.position.z = BOAT_Z[i];

    // Placeholder hull, removed once boat.glb has loaded.
    const placeholder = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(BOAT_LEN, 1, 2.4), new THREE.MeshStandardMaterial({ color: 0x4a2f17 }));
    hull.position.y = 0.5;
    placeholder.add(hull);
    g.add(placeholder);

    // Team-coloured pennant on a pole near the bow, so you can tell the boats apart from above.
    const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3), new THREE.MeshStandardMaterial({ color: 0x3a2412 }));
    flagPole.position.set(BOAT_LEN / 2 - 3, 2, 0);
    g.add(flagPole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1),
      new THREE.MeshStandardMaterial({ color: team.color, side: THREE.DoubleSide }));
    flag.rotation.x = -Math.PI / 2;
    flag.position.set(BOAT_LEN / 2 - 3.9, 3.4, 0);
    g.add(flag);

    const rowersGroup = new THREE.Group();
    g.add(rowersGroup);

    // "SYNC!" pop-up above the boat when the team strokes together.
    const syncEl = document.createElement('div');
    syncEl.className = 'finish-label';
    syncEl.textContent = 'SYNC!';
    syncEl.style.background = '#2e7d32';
    syncEl.style.opacity = '0';
    const syncLabel = new CSS2DObject(syncEl);
    syncLabel.position.set(0, 6, 0);
    g.add(syncLabel);

    scene.add(g);
    return { group: g, placeholder, rowersGroup, syncEl };
  });

  // ----- Load the real models -----
  const models = { boat: null, boatman: null, palm: null };
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let lastRoster = [];

  loader.load(MODEL_URL('boat'), (gltf) => {
    const src = gltf.scene;
    fixMaterials(src);
    const box = new THREE.Box3().setFromObject(src);
    const s = BOAT_LEN / (box.max.x - box.min.x);           // stretch to 34 m long
    boats.forEach((b) => {
      const hull = src.clone(true);
      hull.scale.setScalar(s);
      hull.position.x = -((box.max.x + box.min.x) / 2) * s; // centre it
      hull.position.y = -0.6 - box.min.y * s;               // keel 0.6 m under water
      b.group.remove(b.placeholder);
      b.group.add(hull);
    });
    models.boat = src;
  }, undefined, (e) => console.warn('boat.glb failed to load, keeping placeholder', e));

  loader.load(MODEL_URL('palm'), (gltf) => {
    let mesh = null;
    fixMaterials(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) return;
    // The compressed model stores positions as small integers, so don't edit the geometry;
    // fold the model's own transform into each palm's matrix instead.
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    const base = new THREE.Matrix4().makeTranslation(0, -box.min.y, 0).multiply(mesh.matrixWorld); // trunk base at y = 0
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
    models.palm = palms;
  }, undefined, (e) => console.warn('palm.glb failed to load, keeping placeholder', e));

  loader.load(MODEL_URL('boatman'), (gltf) => {
    fixMaterials(gltf.scene);
    models.boatman = gltf.scene;
    setRoster(lastRoster);                                  // rebuild rowers with the real model
  }, undefined, (e) => console.warn('boatman.glb failed to load, keeping placeholder', e));

  // ----- Rowers -----
  // id -> { rower, bones, head, cap, paddle, side, el }
  let rowerViews = new Map();

  function makeRower(team, side) {
    if (!models.boatman) {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.6, 4, 8),
        new THREE.MeshStandardMaterial({ color: TEAMS[team].color }));
      body.position.y = 1.5;
      const holder = new THREE.Group();
      holder.add(body);
      return { rower: holder, bones: null, head: null };
    }
    const rower = cloneSkinned(models.boatman);
    rower.scale.setScalar(ROWER_SCALE);
    rower.rotation.y = Math.PI / 2;                          // model faces +Z, boat travels +X
    const bones = {};
    const names = {
      spine: 'mixamorigSpine', lArm: 'mixamorigLeftArm', rArm: 'mixamorigRightArm',
      lFore: 'mixamorigLeftForeArm', rFore: 'mixamorigRightForeArm', head: 'mixamorigHead',
    };
    for (const [k, n] of Object.entries(names)) {
      const b = rower.getObjectByName(n);
      if (b) { b.userData.rest = b.quaternion.clone(); bones[k] = b; }
    }
    rower.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
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

      const { rower, bones, head } = makeRower(p.team, side);
      // Hips sit just above the gunwale; legs are hidden inside the hull.
      rower.position.set(x, models.boatman ? 0.55 - 0.65 * ROWER_SCALE : 0, z);
      group.add(rower);

      // Team-coloured cap, so teams are easy to tell apart.
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.13 * ROWER_SCALE, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: TEAMS[p.team].color })
      );
      if (head) group.add(cap);

      // Short paddle (thuzha) on this rower's side, blade in the water.
      const paddle = new THREE.Group();
      paddle.position.set(x + 0.3, 1.2, side * 1.35);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2), new THREE.MeshStandardMaterial({ color: 0xc89a5b }));
      shaft.position.y = -0.9;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.05), new THREE.MeshStandardMaterial({ color: 0xa8763e }));
      blade.position.y = -1.9;
      paddle.add(shaft, blade);
      paddle.rotation.x = side * 0.35;                       // angled out over the side
      group.add(paddle);

      const el = document.createElement('div');
      el.className = 'rower-label';
      el.textContent = p.name;
      const label = new CSS2DObject(el);
      label.position.set(x, 3.2, z + side * 1.6);
      group.add(label);

      rowerViews.set(p.id, { rower, bones, head, cap, paddle, side, label, el, group });
    }
  }

  const tmp = new THREE.Vector3();

  function update(game, now, dt) {
    game.boats.forEach((b, i) => {
      const g = boats[i].group;
      g.position.x = b.x;
      g.position.z = BOAT_Z[i] + b.z;   // sideways drift
      g.rotation.y = b.yaw;             // turning
      g.rotation.x = b.roll;            // leaning
      const flash = 1 - (now - (b.syncFlashAt || 0)) / 700;
      boats[i].syncEl.style.opacity = flash > 0 ? flash.toFixed(2) : '0';
    });
    scene.updateMatrixWorld();

    for (const [id, v] of rowerViews) {
      const p = game.players.get(id);
      if (!p) continue;
      const a = strokeCurve((now - (p.strokeAt || 0)) / STROKE_ANIM_MS);

      if (v.bones) poseRower(v.bones, a);
      // Paddle sweeps forward at the catch and back through the pull.
      v.paddle.rotation.z = -a * 0.7;

      if (v.head) {
        v.rower.updateMatrixWorld(true);
        v.head.getWorldPosition(tmp);
        v.group.worldToLocal(tmp);
        v.cap.position.set(tmp.x, tmp.y + 0.12 * ROWER_SCALE, tmp.z);
      }

      const cls = p.strokeAt ? (p.q >= 0.75 ? 'good' : p.q >= 0.35 ? 'ok' : 'bad') : '';
      const want = `rower-label ${cls}`;
      if (v.el.className !== want) v.el.className = want;
    }

    // Camera follows the leading boat, a little ahead of it.
    const lead = Math.max(...game.boats.map((b) => b.x));
    const target = Math.min(lead + 12, RACE_LENGTH + 10);
    camX += (target - camX) * Math.min(1, dt * 3);
    camera.position.set(camX, CAMERA_HEIGHT, CAMERA_TILT);
    camera.lookAt(camX, 0, 0);
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
