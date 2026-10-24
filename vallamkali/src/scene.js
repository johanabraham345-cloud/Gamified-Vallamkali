// The 3D top view shown on the laptop. Everything here is a PLACEHOLDER shape
// (boxes, capsules, spheres). Later, swap them for real .glb models (see README).
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RACE_LENGTH, TEAMS, MAX_PER_TEAM } from './config.js';

const RIVER_HALF = 25;          // river is 50 m wide
const BOAT_Z = [-7, 7];         // Red lane above, Blue lane below (as seen on screen)
const BOAT_LEN = 34;
const ROWS = Math.ceil(MAX_PER_TEAM / 2);

// Seat 0,2,4… sit on the left side, 1,3,5… on the right, front to back.
export function seatOffset(seat) {
  const row = Math.floor(seat / 2);
  const side = seat % 2 === 0 ? -1 : 1;
  const span = BOAT_LEN - 10;
  const x = span / 2 - row * (span / Math.max(1, ROWS - 1));
  return { x, z: side * 0.75, side };
}

export function createRaceScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b9d9);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x335533, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
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
    new THREE.MeshStandardMaterial({ color: 0x2f7a74, roughness: 0.35, metalness: 0.1 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.x = worldMidX;
  scene.add(water);

  for (const s of [-1, 1]) {
    const bank = new THREE.Mesh(
      new THREE.PlaneGeometry(worldLen, 80),
      new THREE.MeshStandardMaterial({ color: 0x3f8f3a })
    );
    bank.rotation.x = -Math.PI / 2;
    bank.position.set(worldMidX, 0.02, s * (RIVER_HALF + 40));
    scene.add(bank);
  }

  // Palm trees (placeholder: flat green blobs), drawn as one instanced mesh for speed.
  const palmCount = 320;
  const palms = new THREE.InstancedMesh(
    new THREE.SphereGeometry(2.6, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2d6b2a }),
    palmCount
  );
  const m = new THREE.Matrix4();
  for (let i = 0; i < palmCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = -150 + Math.random() * (RACE_LENGTH + 300);
    const z = side * (RIVER_HALF + 5 + Math.random() * 30);
    const s = 0.7 + Math.random() * 0.7;
    m.compose(new THREE.Vector3(x, 3, z), new THREE.Quaternion(), new THREE.Vector3(s, 0.35, s));
    palms.setMatrixAt(i, m);
  }
  scene.add(palms);

  // Crowd (placeholder: colourful boxes) along both banks.
  const crowdCount = 700;
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 1.6, 0.8), new THREE.MeshStandardMaterial(), crowdCount);
  const shirt = [0xffffff, 0xf3b33d, 0xd63a2f, 0x2f6fd6, 0x9c27b0, 0x4caf50];
  const c = new THREE.Color();
  for (let i = 0; i < crowdCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = -60 + Math.random() * (RACE_LENGTH + 120);
    const z = side * (RIVER_HALF + 1 + Math.random() * 3);
    m.makeTranslation(x, 0.8, z);
    crowd.setMatrixAt(i, m);
    crowd.setColorAt(i, c.setHex(shirt[i % shirt.length]));
  }
  scene.add(crowd);

  const addLabel = (html, cls, x, y, z) => {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = html;
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
  for (let d = 50; d < RACE_LENGTH; d += 50) addLabel(`${d} m`, 'marker-label', d, 1, -RIVER_HALF - 2);
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

    const hull = new THREE.Mesh(new THREE.BoxGeometry(BOAT_LEN, 1, 2.4), new THREE.MeshStandardMaterial({ color: 0x4a2f17 }));
    hull.position.y = 0.5;
    g.add(hull);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(BOAT_LEN, 0.05, 0.4), new THREE.MeshStandardMaterial({ color: team.color }));
    stripe.position.y = 1.03;
    g.add(stripe);

    // The tall curved stern of a chundan vallam (placeholder: tilted block at the back).
    const stern = new THREE.Mesh(new THREE.BoxGeometry(7, 0.8, 1.4), new THREE.MeshStandardMaterial({ color: 0x3a2412 }));
    stern.position.set(-BOAT_LEN / 2 - 2.5, 2, 0);
    stern.rotation.z = 0.45;
    g.add(stern);

    // Pointed bow.
    const bow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 4, 4), new THREE.MeshStandardMaterial({ color: 0x4a2f17 }));
    bow.rotation.z = -Math.PI / 2;
    bow.position.set(BOAT_LEN / 2 + 2, 0.5, 0);
    g.add(bow);

    const rowersGroup = new THREE.Group();
    g.add(rowersGroup);
    scene.add(g);
    return { group: g, rowersGroup };
  });

  // id -> { oarPivot, side, label }
  let rowerViews = new Map();

  function setRoster(players) {
    for (const v of rowerViews.values()) v.label.parent?.remove(v.label);
    boats.forEach((b) => b.rowersGroup.clear());
    rowerViews = new Map();

    for (const p of players) {
      if (p.team == null || p.seat == null) continue;
      const { x, z, side } = seatOffset(p.seat);
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.45, 0.6, 4, 8),
        new THREE.MeshStandardMaterial({ color: TEAMS[p.team].color })
      );
      body.position.set(x, 1.5, z);
      boats[p.team].rowersGroup.add(body);

      // Oar pivots at the rower's side of the boat and sweeps forward/back.
      const oarPivot = new THREE.Group();
      oarPivot.position.set(x, 1.3, side * 1.2);
      const oar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, 3.2), new THREE.MeshStandardMaterial({ color: 0xc89a5b }));
      oar.position.z = side * 1.6;
      oarPivot.add(oar);
      boats[p.team].rowersGroup.add(oarPivot);

      const el = document.createElement('div');
      el.className = 'rower-label';
      el.textContent = p.name;
      const label = new CSS2DObject(el);
      label.position.set(x, 3, z + side * 1.4);
      boats[p.team].rowersGroup.add(label);

      rowerViews.set(p.id, { oarPivot, side, label, el });
    }
  }

  function update(game, now, dt) {
    game.boats.forEach((b, i) => { boats[i].group.position.x = b.x; });

    for (const [id, v] of rowerViews) {
      const p = game.players.get(id);
      if (!p) continue;
      const t = (now - (p.strokeAt || 0)) / 450;
      const angle = t < 1 ? Math.sin(t * Math.PI) * 0.8 : 0;
      v.oarPivot.rotation.y = -v.side * angle;

      const cls = p.strokeAt ? (p.q >= 0.75 ? 'good' : p.q >= 0.35 ? 'ok' : 'bad') : '';
      const want = `rower-label ${cls}`;
      if (v.el.className !== want) v.el.className = want;
    }

    // Camera follows the leading boat, a little ahead of it.
    const lead = Math.max(...game.boats.map((b) => b.x));
    const target = Math.min(lead + 12, RACE_LENGTH + 10);
    camX += (target - camX) * Math.min(1, dt * 3);
    camera.position.set(camX, 95, 0);
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
